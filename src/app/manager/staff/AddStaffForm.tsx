"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eyebrow } from "@/components/ui";

/**
 * スタッフ新規追加フォーム（A1 管理画面・二重送信防止 / fetch 制御版）。
 *
 * ★ネイティブ form POST をやめ、onSubmit で preventDefault + fetch にする。
 *   旧・ネイティブ POST 版は、送信時に入力を `disabled` にすると HTML 仕様で disabled な
 *   フォーム部品が送信データから脱落し、`name` が欠落 → API が invalid_name(400) → 「作成中…」
 *   のまま復帰導線が無くハングしていた（2026-07-12）。fetch は DOM シリアライズに依存せず
 *   送信ボディを **state から明示的に組む**ため、disabled による脱落が原理的に起きない。
 *
 * 二重送信防止（多層）:
 *   ・submitting 中はボタン disabled ＋「作成中…」＋ onSubmit 冒頭の再入ガード。
 *   ・フォームを開いた時点で uuid（idempotency_key）を1個生成して送る。サーバー（migration 0023）は
 *     unique 制約＋upsert(on conflict do nothing) で2回目を握り潰す。
 *   ・成功後は次の追加のために key を新規再生成＝別スタッフの追加は別 key になる（正当な追加を殺さない）。
 *
 * 復帰保証: 成功/失敗/通信例外のいずれでも finally で submitting を必ず false に戻す。
 *
 * uuid は useState 初期化関数ではなく useEffect で生成（SSR とクライアント hydration で別値になる
 * のを避ける）。生成前は key 空＝ボタン disabled。
 *
 * 公開同意の確認（0045）: staff 行は作られた瞬間から顧客に氏名が表示される（本人のログイン不要）。
 *   そのため「本人に説明し同意を得た」ことを**追加する前に**店長に確認させ、行に記録する。
 *   未チェックならボタンを押せないが、**これは UI の補助にすぎない**。真の検証はサーバー側
 *   （/api/manager/staff が false/欠落を 400 で弾く）＝クライアントの制御だけに頼らない。
 */
export default function AddStaffForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState<"staff" | "manager">("staff");
  const [idemKey, setIdemKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setIdemKey(crypto.randomUUID());
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 再入ガード: 送信中 or key 未生成 or 同意未確認なら何もしない。
    if (submitting || !idemKey || !consent) return;

    // クライアント側の name 検証（サーバーの invalid_name に頼らず、投げる前に弾く）。
    const trimmed = name.trim();
    if (!trimmed) {
      setError("スタッフ名を入力してください。");
      return;
    }
    if (trimmed.length > 50) {
      setError("スタッフ名は50文字以内で入力してください。");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      // body は form.elements ではなく state から明示的に組む（disabled 脱落を回避・要件1）。
      const res = await fetch("/api/manager/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          role,
          idempotency_key: idemKey,
          // 店長が本人への説明と同意取得を確認した、という申告。
          // サーバー側でも必ず検証される（ここを外しても通らない）。
          publish_consent_confirmed: consent,
        }),
      });

      if (!res.ok) {
        setError("追加に失敗しました。時間をおいて再度お試しください。");
        return; // finally で submitting 解除
      }

      const data = (await res.json()) as { staff_id?: string };
      if (!data.staff_id) {
        setError("追加に失敗しました。時間をおいて再度お試しください。");
        return;
      }

      // 成功: 次の追加のために state をリセット。特に idempotency_key を新規再生成することで、
      // （client 遷移で本コンポーネントが再マウントされない場合でも）別スタッフの追加が別 key になる（要件4）。
      setName("");
      setConsent(false); // 次の1人ぶんの確認を、前の人の確認で済ませない。
      setIdemKey(crypto.randomUUID());
      // 追加したスタッフの QR を出すため ?created= 付きで戻る。server 再描画で一覧＋QRが反映される。
      router.push(`/manager/staff?created=${encodeURIComponent(data.staff_id)}`);
      router.refresh();
    } catch {
      setError("通信に失敗しました。接続を確認して再度お試しください。");
    } finally {
      // 成功/失敗/例外いずれでも必ず解除（要件3）。成功時は遷移後に再描画されるため実害なし。
      setSubmitting(false);
    }
  }

  const disabled = submitting || !idemKey || !consent;

  return (
    <form onSubmit={handleSubmit} className="stack-md">
      <Eyebrow className="eyebrow-mint">Add staff</Eyebrow>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      <div className="field-group">
        <label className="field-label" htmlFor="name">
          スタッフ名
        </label>
        <input
          id="name"
          name="name"
          className="field"
          type="text"
          maxLength={50}
          required
          placeholder="例：山田 はな"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
        />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="role">
          役割
        </label>
        <select
          id="role"
          name="role"
          className="field"
          value={role}
          onChange={(e) =>
            setRole(e.target.value === "manager" ? "manager" : "staff")
          }
          disabled={submitting}
        >
          <option value="staff">スタッフ</option>
          <option value="manager">店長</option>
        </select>
      </div>

      {/* 公開同意の確認（0045）。追加した瞬間から顧客に氏名が出るため、追加の手前に置く。
          マークアップは既存の manager/visit/page.tsx と同じ field-group + field-label +
          field-help 構成（新しい CSS クラスを増やさない）。 */}
      <div className="field-group">
        <label className="field-label" htmlFor="publish_consent">
          本人に、氏名・写真などがお客様に表示されることを説明し、同意を得ています
        </label>
        <input
          id="publish_consent"
          name="publish_consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={submitting}
        />
        <span className="field-help">
          確認しないと追加できません。確認した店長と日時を記録します。
        </span>
      </div>

      <button
        type="submit"
        className="btn btn-outline btn-block"
        disabled={disabled}
      >
        {submitting ? "作成中…" : "追加してQRを表示"}
      </button>
    </form>
  );
}
