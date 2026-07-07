"use client";

import { useState } from "react";
import { ImageAdjuster } from "@/components/ImageAdjuster";

/**
 * スタッフ プロフィール編集フォーム（A2 / client）。
 * 写真（ドラッグ＆ズーム位置調整・@/components/ImageAdjuster）／職種（プリセット＋自由入力hybrid）／一言（100字）。
 *
 * ネイティブの multipart フォームPOST（/api/manager/staff/update）。JSでの送信制御はしない。
 * 写真の調整UI（ロゴと共通の汎用 ImageAdjuster）が photo / photo_pos_x/y / photo_zoom を出力する。
 */
const NAME_MAX = 50;
const BIO_MAX = 100;
const JOB_TITLE_MAX = 30;

// 職種プリセット（datalist 候補）。自由入力も可。権限 role とは無関係。
const JOB_TITLE_PRESETS = [
  "スタイリスト",
  "トップスタイリスト",
  "ジュニアスタイリスト",
  "アシスタント",
  "店長",
  "受付",
  "ネイリスト",
  "アイリスト",
];

export function StaffEditForm({
  staffId,
  initialName,
  initialPhotoUrl,
  initialPhotoX,
  initialPhotoY,
  initialPhotoZoom,
  initialJobTitle,
  initialBio,
}: {
  staffId: string;
  initialName: string;
  initialPhotoUrl: string | null;
  initialPhotoX: number;
  initialPhotoY: number;
  initialPhotoZoom: number;
  initialJobTitle: string;
  initialBio: string;
}) {
  const [bio, setBio] = useState(initialBio);

  return (
    <form
      action="/api/manager/staff/update"
      method="post"
      encType="multipart/form-data"
      className="stack-md"
    >
      <input type="hidden" name="staffId" value={staffId} />

      {/* 写真（ドラッグ＆ズーム位置調整・ロゴと共通の汎用UI） */}
      <ImageAdjuster
        initialImageUrl={initialPhotoUrl}
        initialX={initialPhotoX}
        initialY={initialPhotoY}
        initialZoom={initialPhotoZoom}
        fileFieldName="photo"
        posXFieldName="photo_pos_x"
        posYFieldName="photo_pos_y"
        zoomFieldName="photo_zoom"
        fileLabel="写真を選ぶ"
        emptyLabel={
          <>
            まだ写真が
            <br />
            設定されていません
          </>
        }
      />

      {/* 名前（必須・staff.name は NOT NULL） */}
      <div className="field-group">
        <label className="field-label" htmlFor="name">
          スタッフ名
        </label>
        <input
          id="name"
          name="name"
          type="text"
          className="field"
          defaultValue={initialName}
          maxLength={NAME_MAX}
          required
          placeholder="例：山田 はな"
          autoComplete="off"
        />
      </div>

      {/* 職種（プリセット＋自由入力） */}
      <div className="field-group">
        <label className="field-label" htmlFor="job_title">
          役職・肩書き
        </label>
        <input
          id="job_title"
          name="job_title"
          type="text"
          className="field"
          defaultValue={initialJobTitle}
          maxLength={JOB_TITLE_MAX}
          list="job-title-presets"
          placeholder="例：スタイリスト"
          autoComplete="off"
        />
        <datalist id="job-title-presets">
          {JOB_TITLE_PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <span className="field-help">
          候補から選ぶか、自由に入力できます。
        </span>
      </div>

      {/* 一言 */}
      <div className="field-group">
        <label className="field-label" htmlFor="bio">
          ひとこと
        </label>
        <textarea
          id="bio"
          name="bio"
          className="field"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
          maxLength={BIO_MAX}
          rows={3}
          placeholder="お客様に向けた短い自己紹介や意気込みなど"
        />
        <span className={`field-count${bio.length >= BIO_MAX ? " is-limit" : ""}`}>
          {bio.length} / {BIO_MAX}
        </span>
      </div>

      <button type="submit" className="btn btn-outline btn-block">
        保存する
      </button>
    </form>
  );
}
