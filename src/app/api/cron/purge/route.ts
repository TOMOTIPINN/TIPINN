import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  getMessageQuota,
  getMessageQuotaConsumption,
} from "@/lib/line-messaging";
import { notifyQuotaNearLimit } from "@/lib/security-alert";

/**
 * GET /api/cron/purge — login_attempts の保存期間ワーカー（migration 0038 の呼び出し側）。
 *
 * Vercel cron（vercel.json・1日1回 JST 3:00 = UTC 18:00）が叩く。**呼び出し元は Vercel cron のみ**
 * （画面・スタッフ導線からは一切呼ばない）。やることは `purge_old_login_attempts()`（0038）を
 * 1回呼ぶだけ＝30日より古い認証試行ログを削除する。
 *   ・**保存期間「30日」は SQL 側（0038）にしか持たない。** ここで日数を再計算すると、
 *     関数を直したときに片方だけ古い定義が残る（CLAUDE.md「導出ロジックを二重化しない」）。
 *     削除件数は「呼ぶ前後の総件数の差」として観測する＝日数の定義に触れずに済む。
 *   ・件数取得はあくまで観測用。失敗しても purge 自体は成功扱いにし、deleted は null で返す。
 *   ・0038 の revoke で service_role の EXECUTE も外れていたため、0040 で grant 済み
 *     （未適用だと rpc が 42501 permission denied for function で落ちる）。
 *
 * この cron には **LINE 配信通数の上限接近チェックが相乗りしている**（checkLineQuota）。
 * 専用 cron を足さないのは、日1回でよい観測のために Vercel cron の枠を増やす必要がないため。
 * purge の**後**に実行し、try/catch で完全に分離する＝チェックが何をしようと purge の
 * 既存処理・レスポンスには一切影響しない（レスポンスの形も変えていない）。
 *
 * 認可: Vercel cron は CRON_SECRET を Authorization: Bearer で付与する。一致しなければ 401。
 * 書き込みは supabaseAdmin・サーバー側のみ（RLS deny-by-default）。
 */
export const runtime = "nodejs";

/**
 * 当月の上限に対して「これを超えたら運営者へ知らせる」割合。
 *
 * env にしないのは、運用で動かす値ではないから（動かすなら根拠と一緒にこの行を書き換える）。
 * 0.8 の根拠: cron は日1回なので、残り20%＝現状の送信ペースなら数日分の猶予がある。
 * プラン変更は即日反映されないため、気付いてから動くのにこの程度の余裕が要る。
 */
const QUOTA_ALERT_RATIO = 0.8;

export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[purge] missing CRON_SECRET");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const before = await countLoginAttempts();

  const { error } = await supabaseAdmin.rpc("purge_old_login_attempts");
  if (error) {
    console.error("[purge] purge_old_login_attempts failed:", error);
    return NextResponse.json({ error: "purge_failed" }, { status: 500 });
  }

  const after = await countLoginAttempts();
  const deleted = before !== null && after !== null ? before - after : null;

  // purge とは無関係の相乗り処理。**必ず purge の後**に置き、結果を返り値に混ぜない。
  await checkLineQuota();

  return NextResponse.json({ ok: true, before, after, deleted });
}

/**
 * LINE 配信通数が当月上限に近づいていないかを見て、閾値超えなら運営者へ1通 push する。
 *
 * ・**例外を投げない**。ここで何が起きても purge の成否・レスポンスに影響させない。
 * ・使うのは読み取り専用の GET 2本だけ＝**このチェック自体は通数を1通も消費しない**。
 * ・API エラー時は console.error のみで**通知しない**（通数が読めないこと自体を LINE で
 *   知らせようとすると、LINE 障害時に障害通知が連鎖して増える）。
 * ・type='none'（上限未設定）は接近の判定ができないので console.warn だけ出して抜ける。
 * ・**状態を持たない**。閾値を超えている間は毎日1通届く（notifyQuotaNearLimit の注記参照）。
 */
async function checkLineQuota(): Promise<void> {
  try {
    const [quota, consumption] = await Promise.all([
      getMessageQuota(),
      getMessageQuotaConsumption(),
    ]);

    if (!quota.ok) {
      console.error("[purge] quota 取得に失敗", {
        status: quota.status,
        body: quota.body,
      });
      return;
    }
    if (!consumption.ok) {
      console.error("[purge] quota/consumption 取得に失敗", {
        status: consumption.status,
        body: consumption.body,
      });
      return;
    }
    if (quota.type === "none") {
      console.warn("[purge] LINE quota type=none（上限未設定）。接近チェックをスキップ");
      return;
    }

    const limit = quota.value;
    const { totalUsage } = consumption;
    // 正常系の観測値だが warn で出す（このリポジトリは error / warn しか使わない）。
    // 通数はレスポンスに混ぜない方針なので、ログが唯一の観測点になる＝必ず残す。
    console.warn("[purge] LINE 配信通数", {
      totalUsage,
      limit,
      ratio: QUOTA_ALERT_RATIO,
    });

    // limit=0 のガード: 0 で割ると 0 >= 0 が常に成立し、毎日アラートが出続ける。
    if (limit > 0 && totalUsage >= limit * QUOTA_ALERT_RATIO) {
      await notifyQuotaNearLimit({
        totalUsage,
        limit,
        thresholdRatio: QUOTA_ALERT_RATIO,
      });
    }
  } catch (e) {
    // notify 側も含めて例外は投げない設計だが、相乗り処理が purge を道連れにしないよう二重に守る。
    console.error("[purge] LINE 通数チェックで例外", e);
  }
}

/**
 * login_attempts の総件数（観測用）。取れなければ null を返して呼び出し側を止めない
 * （削除は済んでいるのに 500 を返して cron を失敗扱いにしないため）。
 */
async function countLoginAttempts(): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("login_attempts")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[purge] count failed:", error);
    return null;
  }
  return count ?? null;
}
