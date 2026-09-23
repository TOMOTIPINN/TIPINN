import { notFound, redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";

/**
 * オーナー（組織の経営主体）の解決とページガード（§21 コミット3a・migration 0048）。
 *
 * ★staff.role には依存しない★
 *   オーナーであることは `organization_members` に行があることだけで決まる
 *   （40_decisions.md §21「2026-09-23 決定」2）。`getStaffContext()` も使わない＝
 *   **staff 行を持たないオーナー**（サロンの評価対象ではない経営者）でも成立する。
 *   サロン側のロール体系（staff / manager）とは別体系なので混ぜない。
 *
 * ★fail closed★
 *   取得に失敗したら null＝非オーナー扱い（`admin-guard.ts` の「設定漏れは全開放ではなく
 *   全閉」と同じ向き）。見えなくなる方に倒す。
 *
 * line_user_id は**サーバー側のセッション**から取る（クライアントからは受け取らない）。
 * PII（原則7）なのでログに出さない。PostgREST の error.message / details は
 * クエリ値を含み得るため、**error.code だけ**を出す（staff-session.ts / display-role.ts と同じ方針）。
 *
 * 全クエリは service_role でサーバー側のみ。
 */
export type OwnerSalon = { id: string; name: string };

export type OwnerContext = {
  org_id: string;
  org_name: string;
  /** その組織のサロン。並びは salons.created_at 昇順（暫定・下記）。 */
  salons: OwnerSalon[];
};

/**
 * ログイン中の人のオーナー文脈を解決する（非オーナーなら null）。
 *
 * organization_members → organizations → salons(org_id) の順に引く。
 * `organization_members` は unique(line_user_id)＝1人1組織（§21 決定3）なので maybeSingle。
 *
 * ⚠️ 店舗の並びは `salons.created_at` 昇順の**暫定**。§21 の「店舗単位の比較」（コミット3d）で
 *    正式な並び順を決めるまでのつなぎで、ここが仕様として確定しているわけではない。
 */
export async function resolveOwnerContext(): Promise<OwnerContext | null> {
  const session = await getSession();
  const lineUserId = session?.line_user_id;
  if (!lineUserId) return null;

  // 1) どの組織のオーナーか。行が無ければ非オーナー（エラーではない）。
  const { data: member, error: memberError } = await supabaseAdmin
    .from("organization_members")
    .select("org_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle<{ org_id: string }>();

  if (memberError) {
    console.error("[owner-guard] organization_members を引けませんでした", {
      code: memberError.code,
    });
    return null;
  }
  if (!member) return null;

  // 2) 組織名。FK があるので通常は必ず引けるが、引けなければ fail closed。
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("name")
    .eq("id", member.org_id)
    .maybeSingle<{ name: string }>();

  if (orgError || !org) {
    console.error("[owner-guard] organizations を引けませんでした", {
      code: orgError?.code,
    });
    return null;
  }

  // 3) 配下のサロン。salons.org_id は 0048 で NOT NULL＝組織に属さないサロンは無い。
  const { data: salonData, error: salonsError } = await supabaseAdmin
    .from("salons")
    .select("id, name")
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: true });

  if (salonsError) {
    console.error("[owner-guard] salons を引けませんでした", {
      code: salonsError.code,
    });
    return null;
  }

  return {
    org_id: member.org_id,
    org_name: org.name,
    salons: (salonData ?? []) as OwnerSalon[],
  };
}

/**
 * `/owner/**` の server page 用ガード。通れば OwnerContext を返す。
 *
 * ・未ログイン       → LINE ログインへ（returnTo を保持）
 * ・ログイン済み非オーナー → `/staff` へ（`/dashboard` が非 manager を畳むのと同型）
 *
 * ★404 では畳まない★ `/owner` はサロン世界の画面であって echo Labs 運営画面ではない。
 *   `/admin/*` が 404 で存在を伏せるのは運営画面だからで、ここは行き止まりを作らない方を採る
 *   （40_decisions.md §21 コミット3a の確定事項）。
 *
 * ★layout には置かない★ 既存の `/manager/layout.tsx`・`/dashboard/layout.tsx` は
 *   metadata 専用の pass-through で、認可は各 page が持つ。その作法に合わせる。
 *
 * `redirect()` は例外を投げる（戻り値の型は never）ので、呼び出し側では
 * 戻り値を非 null として扱える。
 */
export async function requireOwnerPage(returnTo: string): Promise<OwnerContext> {
  // 「未ログイン」と「ログイン済みだが非オーナー」を出し分けるため、ここでも session を見る。
  // resolveOwnerContext() はどちらも null に畳む（単体で安全・fail closed）。
  const session = await getSession();
  if (!session) {
    redirect(`/api/auth/line/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const ctx = await resolveOwnerContext();
  if (!ctx) {
    redirect("/staff");
  }

  return ctx;
}

/** uuid（8-4-4-4-12）。パスから受け取った salonId の形だけを見る。 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/owner/[salonId]/**` 用ガード。オーナー本人であることに加えて、
 * **その salonId が自分の組織配下であること**をサーバー側で検証する（§21 コミット3b）。
 *
 * ★salonId はパスに入っていてもクライアント入力★
 *   `50_security.md` §1.1「body / query の salon_id は絶対に信用しない」は
 *   パスパラメータでも同じ。照合は **DB から引いた `ctx.salons`** に対して行い、
 *   `salonId` で直接クエリしない（越境の余地を作らない）。
 *
 * ★配下でない／uuid として不正 → notFound()（404）★
 *   403 にすると「そのサロンは存在するが見せない」ことが分かり、
 *   **他の組織の店舗の存在確認に使える**。404 なら「存在しない」と区別が付かない
 *   （`/staff/received/[reviewId]` が他人の評価を 404 で伏せているのと同じ作法）。
 *   uuid として不正な値も同じ 404 に畳む（形式の違いを応答に出さない）。
 *
 * ★redirect() / notFound() を try/catch で囲まない★
 *   どちらも内部的に例外を投げて Next が拾う仕組みなので、catch すると
 *   リダイレクトも 404 も効かなくなる（そのまま通過してしまう）。
 */
export async function requireOwnerSalon(
  salonId: string,
  returnTo: string,
): Promise<{ ctx: OwnerContext; salon: OwnerSalon }> {
  // 未ログイン→ログイン／非オーナー→/staff は requireOwnerPage が畳む。
  const ctx = await requireOwnerPage(returnTo);

  if (!UUID_RE.test(salonId)) {
    notFound();
  }

  const salon = ctx.salons.find((s) => s.id === salonId);
  if (!salon) {
    notFound();
  }

  return { ctx, salon };
}
