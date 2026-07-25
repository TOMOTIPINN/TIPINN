/**
 * Supabase (PostgREST) の 1000 行上限を offset ページングで越えて全行取得する共通ヘルパー。
 *
 * PostgREST は `max-rows`（既定 1000）で応答を静かに切り捨てる（エラーにならない）。
 * `.range(from, to)` を 0 起点で pageSize 刻みに回し、返却行数が pageSize 未満に
 * なったページで打ち切って全ページを結合する。集計の網羅性が要る読み取り
 * （ダッシュボードの reviews / rating_purchases / earned_stamps 等）で使う。
 *
 * 使い方（呼び出し側が .range を含む「そのページのクエリ」を組んで返す）:
 *   const rows = await fetchAllRows<ReviewRow>((from, to) =>
 *     supabaseAdmin
 *       .from("reviews")
 *       .select("...")
 *       .eq("salon_id", salonId)
 *       .order("created_at", { ascending: true })
 *       .order("id", { ascending: true })  // ← 安定ページングのため一意キーで最終ソート
 *       .range(from, to),
 *   );
 *
 * ⚠️ offset ページングは「ページ間で並びが安定していること」が前提。必ず一意なキー
 *    （通常は id）まで含めた order を付けること。付けないと境界で行の重複/欠落が起きうる。
 */

/** Supabase の select 結果を await した形（PostgrestResponse の必要部分）。PostgrestError は message を持つので構造的に適合する。 */
type RowsResponse<T> = { data: T[] | null; error: { message: string } | null };

export type FetchAllRowsOpts = {
  /** 1 ページの行数（= PostgREST の想定上限）。既定 1000。 */
  pageSize?: number;
  /** 無限ループ防止の最大ページ数。既定 50（= 5万行）。通常は到達しない。 */
  maxPages?: number;
  /** console.warn に出すテーブル名等のラベル（任意）。 */
  label?: string;
};

/**
 * buildQuery を from=0 から pageSize 刻みで呼び、全ページを結合して返す。
 * @param buildQuery (from, to) を受け取り、その範囲に `.range(from, to)` を適用済みの
 *   Supabase クエリ（await 可能な PostgrestFilterBuilder 等）を返す関数。
 *   フィルタ・order は呼び出し側が組む（このヘルパーは範囲送りだけを担う）。
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<RowsResponse<T>>,
  opts: FetchAllRowsOpts = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const maxPages = opts.maxPages ?? 50;
  const all: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    // 返却が pageSize 未満＝最終ページ（これ以上の行は無い）。
    if (rows.length < pageSize) return all;
  }

  // ここに来る＝maxPages ぶん全て満杯だった。安全弁で打ち切る（以降は取得していない）。
  console.warn(
    `[fetchAllRows] 最大ページ数 (${maxPages}) に到達${
      opts.label ? `（${opts.label}）` : ""
    }。以降のデータは切り捨てられた可能性があります。`,
  );
  return all;
}
