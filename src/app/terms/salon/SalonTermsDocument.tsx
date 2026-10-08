import type { ComponentType } from "react";
import Link from "next/link";
import { Eyebrow, Card } from "@/components/ui";

/**
 * サロン向け利用規約の1つの版を表示する枠（/terms/salon と /terms/salon/[version] で共有・§26 C2）。
 *
 * 本文（Body）は `@/lib/salon-terms` の台帳から渡す。この枠は見出し・版の表示・
 * 「現在の版ではない」旨の注記だけを持ち、本文の中身には関与しない。
 * データ取得なしの完全静的。インライン style 禁止・赤なし（30_design.md §2・§7）。
 */
export default function SalonTermsDocument({
  version,
  Body,
  isCurrent,
}: {
  version: string;
  Body: ComponentType;
  isCurrent: boolean;
}) {
  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <div className="stack stack-sm center-text">
          <Eyebrow>Terms</Eyebrow>
          <h1 className="headline">サロン向け利用規約</h1>
          <p className="muted">{version} 版</p>
        </div>

        {!isCurrent && (
          <p className="note-fine center-text">
            この版は現在の版ではありません。現在の版は{" "}
            <Link className="help-url" href="/terms/salon">
              こちら
            </Link>
            です。
          </p>
        )}

        <Card className="stack stack-md">
          <Body />
        </Card>
      </div>
    </main>
  );
}
