import Link from "next/link";

/**
 * /staff/received/[reviewId] の not-found 境界（HTTP 404 を返す）。
 *
 * page.tsx が notFound() を投げる条件は2つ:
 *   ①レビューが存在しない ②存在するが閲覧権限がない（他サロン・他人宛て）
 * この2つは **意図的に同じ応答**にしている。区別すると「そのIDが実在するか」を
 * 総当たりで判別できるオラクルになるため（page.tsx の canView コメント参照）。
 * したがってここで 403 と 404 を出し分けてはいけない。文言も理由を示唆しない。
 *
 * トーン: サロンUI世界。¥は出さない・インラインstyle禁止（§8）。
 */
export default function StaffReceivedNotFound() {
  return (
    <main className="page">
      <div className="container stack center-text animate-in">
        <p className="muted">この評価は見つかりませんでした。</p>
        <Link href="/staff" className="btn btn-quiet btn-block">
          ホームへ
        </Link>
      </div>
    </main>
  );
}
