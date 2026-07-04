import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import SalonNav from "@/components/SalonNav";
import SalonQr from "./SalonQr";

/**
 * サロン・オンボーディング（/manager/salon/new・サロンUI世界 / Phase 1・Stripe未接続 / [[auth-method-line-b]]）。
 * 店長が新しいサロンを登録する。店名（必須）／ロゴ（任意）／通知遅延（任意・既定180）を入力し、
 * 送信すると /api/manager/salon/new が salon_id・visit_token を採番して salons へ INSERT する。
 *
 * 認可: /dashboard と同型。未ログイン→LINEログイン（returnTo）／非manager→/staff へ redirect。
 * 完了（?created=<id>）: 登録サロンの visit_token から /visit?salon=&t= のURLを作り、QR表示＋PNG保存を出す。
 * 書き込みは API（service_role・サーバー側）。トーン: サロンUI＝ミント・¥なし・赤なし・インラインstyle禁止。
 *
 * ※ Phase 1 では作成者を新サロンの staff/manager に紐付けない（スタッフ招待導線は現サロン文脈）。
 */
const ERROR_MESSAGE: Record<string, string> = {
  form: "送信データを読み取れませんでした。もう一度お試しください。",
  name: "店名を入力してください（50文字以内）。",
  notify: "通知遅延は30〜360分の数値で入力してください。",
  type: "対応していない形式です。PNG / JPEG / WebP を選んでください。",
  size: "ロゴ画像が大きすぎます（上限2MB）。",
  upload: "ロゴのアップロードに失敗しました。時間をおいて再度お試しください。",
  save: "登録に失敗しました。時間をおいて再度お試しください。",
};

const NOTIFY_DEFAULT = 180;
const NOTIFY_MIN = 30;
const NOTIFY_MAX = 360;

export default async function ManagerSalonNewPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const { created, error } = await searchParams;

  // 認可（/dashboard と同型）: 未ログイン→ログイン（returnTo保持）／非manager→/staff。
  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/salon/new")}`,
    );
  }
  const ctx = await getStaffContext();
  if (!ctx || ctx.role !== "manager") {
    redirect("/staff");
  }

  // ── 完了画面（登録直後）─────────────────────────────
  if (created) {
    const { data: salon } = await supabaseAdmin
      .from("salons")
      .select("name, visit_token")
      .eq("id", created)
      .maybeSingle<{ name: string; visit_token: string }>();

    if (salon?.visit_token) {
      const baseUrl = process.env.APP_BASE_URL!;
      const visitUrl = `${baseUrl}/visit?salon=${created}&t=${salon.visit_token}`;
      const qr = await QRCode.toDataURL(visitUrl, { margin: 1, width: 240 });

      return (
        <main className="page page-top">
          <div className="container stack animate-in">
            <SalonNav />
            <header className="stack-sm">
              <Eyebrow className="eyebrow-mint">Salon created</Eyebrow>
              <h1 className="headline">{salon.name} を登録しました</h1>
              <p className="muted">
                店頭に掲示する来店受付QRです。お客様がこのQRを読み込むと来店が記録されます。
              </p>
            </header>

            <Card>
              <div className="qr-block">
                <SalonQr
                  qr={qr}
                  url={visitUrl}
                  fileName={`echo-visit-${created}.png`}
                />
                <p className="invite-url">{visitUrl}</p>
              </div>
            </Card>

            <section className="stack-sm">
              <Link href="/manager/staff" className="btn btn-outline btn-block">
                スタッフを招待する
              </Link>
              <Link href="/dashboard" className="btn btn-quiet btn-block">
                ダッシュボードへ
              </Link>
            </section>
          </div>
        </main>
      );
    }
    // visit_token が引けない異常時はフォームに戻す（下の通常表示にフォールスルー）。
  }

  // ── 入力フォーム ───────────────────────────────────
  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <SalonNav />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">New salon</Eyebrow>
          <h1 className="headline">サロンを登録</h1>
          <p className="muted">
            店名を入力して登録すると、店頭に掲示する来店受付QRが発行されます。ロゴは後から変更できます。
          </p>
        </header>

        {error && (
          <div className="notice notice-error">
            {ERROR_MESSAGE[error] ?? "エラーが発生しました。"}
          </div>
        )}

        <Card>
          <form
            action="/api/manager/salon/new"
            method="post"
            encType="multipart/form-data"
            className="stack-md"
          >
            <div className="field-group">
              <label className="field-label" htmlFor="name">
                店名（必須）
              </label>
              <input
                id="name"
                name="name"
                className="field"
                type="text"
                maxLength={50}
                required
                placeholder="例：echo 表参道"
              />
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="logo">
                ロゴ画像（任意・PNG / JPEG / WebP・2MBまで）
              </label>
              <input
                id="logo"
                name="logo"
                className="field"
                type="file"
                accept="image/png,image/jpeg,image/webp"
              />
              <span className="field-help">
                未設定でも登録できます。あとで店舗プロフィールから変更できます。
              </span>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="notify_after_minutes">
                感想リマインドの通知遅延（任意・{NOTIFY_MIN}〜{NOTIFY_MAX}分）
              </label>
              <input
                id="notify_after_minutes"
                name="notify_after_minutes"
                className="field"
                type="number"
                min={NOTIFY_MIN}
                max={NOTIFY_MAX}
                step={1}
                placeholder={String(NOTIFY_DEFAULT)}
              />
              <span className="field-help">
                来店から感想リマインドを送るまでの時間です（既定{NOTIFY_DEFAULT}分）。
              </span>
            </div>

            <button type="submit" className="btn btn-outline btn-block">
              登録して来店QRを発行
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}
