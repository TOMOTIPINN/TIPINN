"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Image from "next/image";
import { SALON, STYLISTS as INITIAL_STYLISTS, type Stylist } from "@/lib/mock-data";
import styles from "./admin.module.css";
import staffStyles from "./staff.module.css";

// MVP用モックチップデータ
interface TipRecord {
  id: string;
  stylistId: string;
  stylistName: string;
  amount: number;
  message: string;
  senderName: string;
  status: "completed" | "pending" | "failed";
  createdAt: Date;
}

function generateMockTips(stylists: Stylist[]): TipRecord[] {
  const tips: TipRecord[] = [];
  const messages = [
    "いつもありがとうございます！",
    "素敵なカットでした✨",
    "また来ます！",
    "最高の仕上がりです💕",
    "カラーがとても綺麗です🎨",
    "",
    "リフレッシュできました！",
    "子供も喜んでました😊",
  ];
  const names = ["たろう", "花子", "", "ゆうき", "さくら", "", "けんた", "みゆ", "あき"];
  const amounts = [200, 500, 500, 1500, 3000, 500, 200, 1500];

  for (let i = 0; i < 25; i++) {
    const stylist = stylists[Math.floor(Math.random() * stylists.length)];
    const daysAgo = Math.floor(Math.random() * 14);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(
      10 + Math.floor(Math.random() * 10),
      Math.floor(Math.random() * 60)
    );

    tips.push({
      id: `tip-${i}`,
      stylistId: stylist.id,
      stylistName: stylist.name,
      amount: amounts[Math.floor(Math.random() * amounts.length)],
      message: messages[Math.floor(Math.random() * messages.length)],
      senderName: names[Math.floor(Math.random() * names.length)],
      status: Math.random() > 0.05 ? "completed" : "pending",
      createdAt: date,
    });
  }

  return tips.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

// ==========================================
// スタッフ編集モーダル
// ==========================================
interface StaffModalProps {
  stylist: Partial<Stylist> | null;
  isNew: boolean;
  onSave: (data: Partial<Stylist>, file: File | null) => void;
  onClose: () => void;
  isUploading: boolean;
}

function StaffModal({ stylist, isNew, onSave, onClose, isUploading }: StaffModalProps) {
  const [name, setName] = useState(stylist?.name || "");
  const [slug, setSlug] = useState(stylist?.slug || "");
  const [message, setMessage] = useState(stylist?.message || "");
  const [thankYouMessage, setThankYouMessage] = useState(stylist?.thankYouMessage || "");
  const [isActive, setIsActive] = useState(stylist?.isActive ?? true);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState(stylist?.avatarUrl || "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  // slugを名前から自動生成（新規のみ）
  const handleNameChange = (value: string) => {
    setName(value);
    if (isNew) {
      // ひらがな/カタカナをローマ字に簡易変換しない。
      // ユーザーに手動入力させる
    }
  };

  const handleSave = () => {
    if (!name.trim() || !slug.trim()) return;
    onSave(
      {
        ...stylist,
        name: name.trim(),
        slug: slug.trim(),
        message: message.trim(),
        thankYouMessage: thankYouMessage.trim(),
        isActive,
      },
      avatarFile
    );
  };

  return (
    <div className={staffStyles.modalOverlay} onClick={onClose}>
      <div
        className={staffStyles.modalContent}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={staffStyles.modalTitle}>
          <span>{isNew ? "➕" : "✏️"}</span>
          {isNew ? "スタッフを追加" : `${stylist?.name}を編集`}
        </h2>

        {/* アバター写真 */}
        <div className={staffStyles.formGroup}>
          <label className={staffStyles.formLabel}>プロフィール写真</label>
          <div className={staffStyles.avatarUpload}>
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="プレビュー"
                className={staffStyles.avatarPreview}
              />
            ) : (
              <div className={staffStyles.avatarPlaceholder}>📷</div>
            )}
            <div className={staffStyles.uploadArea}>
              <button
                className={staffStyles.uploadBtn}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                📁 写真を選択
              </button>
              <p className={staffStyles.uploadHint}>
                JPG/PNG形式、推奨: 400×400px
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className={staffStyles.hiddenInput}
              />
            </div>
          </div>
        </div>

        {/* 名前 */}
        <div className={staffStyles.formGroup}>
          <label className={staffStyles.formLabel}>表示名（ニックネーム）</label>
          <input
            type="text"
            className={staffStyles.formInput}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="例: たくま"
          />
        </div>

        {/* Slug */}
        <div className={staffStyles.formGroup}>
          <label className={staffStyles.formLabel}>
            URL用ID（英数字・ハイフン）
          </label>
          <input
            type="text"
            className={staffStyles.formInput}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="例: takuma"
          />
        </div>

        {/* メッセージ */}
        <div className={staffStyles.formGroup}>
          <label className={staffStyles.formLabel}>一言メッセージ</label>
          <textarea
            className={staffStyles.formTextarea}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="お客様へのメッセージを入力..."
          />
        </div>

        {/* お礼メッセージ */}
        <div className={staffStyles.formGroup}>
          <label className={staffStyles.formLabel}>お礼メッセージ（応援後に表示）</label>
          <textarea
            className={staffStyles.formTextarea}
            value={thankYouMessage}
            onChange={(e) => setThankYouMessage(e.target.value)}
            placeholder="応援してくれた方へのお礼..."
          />
        </div>

        {/* アクティブ状態 */}
        <div className={staffStyles.formGroup}>
          <label className={staffStyles.formLabel}>表示状態</label>
          <div
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "4px",
            }}
          >
            <button
              className={`${staffStyles.editBtn}`}
              style={
                isActive
                  ? { background: "rgba(16, 185, 129, 0.25)", color: "#34D399" }
                  : {}
              }
              onClick={() => setIsActive(true)}
              type="button"
            >
              ✅ 表示
            </button>
            <button
              className={`${staffStyles.editBtn}`}
              style={
                !isActive
                  ? { background: "rgba(239, 68, 68, 0.25)", color: "#F87171" }
                  : {}
              }
              onClick={() => setIsActive(false)}
              type="button"
            >
              🚫 非表示
            </button>
          </div>
        </div>

        {/* アクション */}
        <div className={staffStyles.formActions}>
          <button
            className={staffStyles.cancelBtn}
            onClick={onClose}
            type="button"
          >
            キャンセル
          </button>
          <button
            className={staffStyles.saveBtn}
            onClick={handleSave}
            disabled={!name.trim() || !slug.trim() || isUploading}
            type="button"
          >
            {isUploading ? "保存中..." : isNew ? "追加する" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 削除確認モーダル
// ==========================================
interface DeleteModalProps {
  stylist: Stylist;
  onConfirm: () => void;
  onClose: () => void;
}

function DeleteModal({ stylist, onConfirm, onClose }: DeleteModalProps) {
  return (
    <div className={staffStyles.modalOverlay} onClick={onClose}>
      <div
        className={staffStyles.modalContent}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={staffStyles.modalTitle}>
          <span>⚠️</span> スタッフを削除
        </h2>
        <div className={staffStyles.deleteConfirm}>
          <p className={staffStyles.deleteConfirmText}>
            <span className={staffStyles.deleteConfirmName}>
              {stylist.name}
            </span>
            さんを削除しますか？
            <br />
            この操作は取り消せません。
          </p>
          <div className={staffStyles.formActions}>
            <button
              className={staffStyles.cancelBtn}
              onClick={onClose}
              type="button"
            >
              キャンセル
            </button>
            <button
              className={staffStyles.confirmDeleteBtn}
              onClick={onConfirm}
              type="button"
            >
              🗑 削除する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// メインページ
// ==========================================
export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "staff">("dashboard");
  const [stylists, setStylists] = useState<Stylist[]>(INITIAL_STYLISTS);
  const [tips, setTips] = useState<TipRecord[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<"today" | "week" | "month">("week");
  const [selectedStylist, setSelectedStylist] = useState<string>("all");

  // Staff management state
  const [editingStylist, setEditingStylist] = useState<Partial<Stylist> | null>(null);
  const [isNewStylist, setIsNewStylist] = useState(false);
  const [deletingStylist, setDeletingStylist] = useState<Stylist | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setTips(generateMockTips(stylists));
  }, [stylists]);

  // Toast notification
  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ==========================================
  // スタッフ CRUD
  // ==========================================
  const handleSaveStylist = async (data: Partial<Stylist>, file: File | null) => {
    setIsUploading(true);

    try {
      let avatarUrl = data.avatarUrl || "";

      // 写真がアップロードされた場合
      if (file && data.slug) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("slug", data.slug);

        try {
          const res = await fetch("/api/admin/upload", {
            method: "POST",
            body: formData,
          });

          if (res.ok) {
            const result = await res.json();
            avatarUrl = result.avatarUrl;
          } else {
            // 本番環境ではファイルアップロード不可のため、ローカルURLを使用
            avatarUrl = data.avatarUrl || `/stylists/${data.slug}.jpg`;
          }
        } catch {
          // ネットワークエラー時はそのまま進行
          avatarUrl = data.avatarUrl || `/stylists/${data.slug}.jpg`;
        }
      }

      if (isNewStylist) {
        // 新規追加
        const newId = `stylist-${String(stylists.length + 1).padStart(3, "0")}`;
        const newStylist: Stylist = {
          id: newId,
          salonId: "salon-001",
          name: data.name || "",
          slug: data.slug || "",
          avatarUrl: avatarUrl || `/stylists/${data.slug}.jpg`,
          message: data.message || "",
          thankYouMessage: data.thankYouMessage || "",
          isActive: data.isActive ?? true,
        };
        setStylists((prev) => [...prev, newStylist]);
        showToast(`${data.name}さんを追加しました ✅`);
      } else {
        // 既存の更新
        setStylists((prev) =>
          prev.map((s) =>
            s.id === data.id
              ? {
                  ...s,
                  name: data.name || s.name,
                  slug: data.slug || s.slug,
                  avatarUrl: avatarUrl || s.avatarUrl,
                  message: data.message ?? s.message,
                  thankYouMessage: data.thankYouMessage ?? s.thankYouMessage,
                  isActive: data.isActive ?? s.isActive,
                }
              : s
          )
        );
        showToast(`${data.name}さんの情報を更新しました ✅`);
      }

      setEditingStylist(null);
      setIsNewStylist(false);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteStylist = () => {
    if (!deletingStylist) return;
    setStylists((prev) => prev.filter((s) => s.id !== deletingStylist.id));
    showToast(`${deletingStylist.name}さんを削除しました`);
    setDeletingStylist(null);
  };

  // ==========================================
  // ダッシュボード集計
  // ==========================================
  const filteredTips = useMemo(() => {
    let filtered = tips;

    const now = new Date();
    if (selectedPeriod === "today") {
      filtered = filtered.filter(
        (t) => t.createdAt.toDateString() === now.toDateString()
      );
    } else if (selectedPeriod === "week") {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter((t) => t.createdAt >= weekAgo);
    } else {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter((t) => t.createdAt >= monthAgo);
    }

    if (selectedStylist !== "all") {
      filtered = filtered.filter((t) => t.stylistId === selectedStylist);
    }

    return filtered;
  }, [tips, selectedPeriod, selectedStylist]);

  const totalAmount = filteredTips
    .filter((t) => t.status === "completed")
    .reduce((sum, t) => sum + t.amount, 0);

  const totalCount = filteredTips.filter(
    (t) => t.status === "completed"
  ).length;

  const avgAmount = totalCount > 0 ? Math.round(totalAmount / totalCount) : 0;

  const stylistRanking = useMemo(() => {
    const map = new Map<
      string,
      { name: string; total: number; count: number }
    >();
    filteredTips
      .filter((t) => t.status === "completed")
      .forEach((t) => {
        const existing = map.get(t.stylistId) || {
          name: t.stylistName,
          total: 0,
          count: 0,
        };
        existing.total += t.amount;
        existing.count += 1;
        map.set(t.stylistId, existing);
      });
    return Array.from(map.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filteredTips]);

  const formatDate = (date: Date) => {
    return `${date.getMonth() + 1}/${date.getDate()} ${date
      .getHours()
      .toString()
      .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div>
              <h1 className={styles.title}>
                <span className={styles.titleIcon}>📊</span>
                管理ダッシュボード
              </h1>
              <p className={styles.salonName}>{SALON.name}</p>
            </div>
            <div className={styles.headerBadge}>
              <span className={styles.liveDot} />
              <span>リアルタイム</span>
            </div>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className={staffStyles.tabNav}>
          <button
            className={`${staffStyles.tabBtn} ${
              activeTab === "dashboard" ? staffStyles.tabBtnActive : ""
            }`}
            onClick={() => setActiveTab("dashboard")}
            id="tab-dashboard"
          >
            📊 ダッシュボード
          </button>
          <button
            className={`${staffStyles.tabBtn} ${
              activeTab === "staff" ? staffStyles.tabBtnActive : ""
            }`}
            onClick={() => setActiveTab("staff")}
            id="tab-staff"
          >
            👥 スタッフ管理
          </button>
        </div>

        {/* ==========================================
            Dashboard Tab
            ========================================== */}
        {activeTab === "dashboard" && (
          <>
            {/* Period Filter */}
            <div className={styles.periodFilter}>
              {(
                [
                  { key: "today", label: "今日" },
                  { key: "week", label: "今週" },
                  { key: "month", label: "今月" },
                ] as const
              ).map((period) => (
                <button
                  key={period.key}
                  className={`${styles.periodBtn} ${
                    selectedPeriod === period.key ? styles.periodBtnActive : ""
                  }`}
                  onClick={() => setSelectedPeriod(period.key)}
                  id={`period-${period.key}`}
                >
                  {period.label}
                </button>
              ))}
            </div>

            {/* Summary Cards */}
            <div className={styles.summaryGrid}>
              <div className={`${styles.summaryCard} ${styles.summaryCardPrimary}`}>
                <span className={styles.summaryLabel}>合計金額</span>
                <span className={styles.summaryValue}>
                  ¥{totalAmount.toLocaleString()}
                </span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>件数</span>
                <span className={styles.summaryValue}>{totalCount}件</span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>平均金額</span>
                <span className={styles.summaryValue}>
                  ¥{avgAmount.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Stylist Ranking */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <span>🏆</span> スタイリスト別ランキング
              </h2>
              <div className={styles.rankingList}>
                {stylistRanking.map((s, i) => (
                  <div key={s.id} className={styles.rankingItem}>
                    <span className={styles.rankNumber}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                    </span>
                    <span className={styles.rankName}>{s.name}</span>
                    <span className={styles.rankCount}>{s.count}件</span>
                    <span className={styles.rankTotal}>
                      ¥{s.total.toLocaleString()}
                    </span>
                  </div>
                ))}
                {stylistRanking.length === 0 && (
                  <p className={styles.emptyText}>データがありません</p>
                )}
              </div>
            </section>

            {/* Stylist Filter */}
            <div className={styles.stylistFilter}>
              <select
                className={styles.stylistSelect}
                value={selectedStylist}
                onChange={(e) => setSelectedStylist(e.target.value)}
                id="stylist-filter"
              >
                <option value="all">全スタイリスト</option>
                {stylists.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Tip History */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <span>📋</span> チップ履歴
              </h2>
              <div className={styles.tipList}>
                {filteredTips.map((tip) => (
                  <div key={tip.id} className={styles.tipItem}>
                    <div className={styles.tipLeft}>
                      <div className={styles.tipMeta}>
                        <span className={styles.tipStylist}>
                          {tip.stylistName}
                        </span>
                        <span
                          className={`${styles.tipStatus} ${
                            tip.status === "completed"
                              ? styles.statusCompleted
                              : styles.statusPending
                          }`}
                        >
                          {tip.status === "completed" ? "完了" : "処理中"}
                        </span>
                      </div>
                      {tip.message && (
                        <p className={styles.tipMessage}>💬 {tip.message}</p>
                      )}
                      <div className={styles.tipFooter}>
                        <span className={styles.tipDate}>
                          {formatDate(tip.createdAt)}
                        </span>
                        {tip.senderName && (
                          <span className={styles.tipSender}>
                            from {tip.senderName}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={styles.tipAmount}>
                      ¥{tip.amount.toLocaleString()}
                    </span>
                  </div>
                ))}
                {filteredTips.length === 0 && (
                  <p className={styles.emptyText}>
                    この期間のチップデータはありません
                  </p>
                )}
              </div>
            </section>
          </>
        )}

        {/* ==========================================
            Staff Management Tab
            ========================================== */}
        {activeTab === "staff" && (
          <>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <span>👥</span> スタッフ一覧
                <span style={{ 
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                  fontWeight: 400,
                  marginLeft: "auto"
                }}>
                  {stylists.length}名
                </span>
              </h2>

              <div className={staffStyles.staffGrid}>
                {stylists.map((stylist) => (
                  <div key={stylist.id} className={staffStyles.staffCard}>
                    <div className={staffStyles.staffCardHeader}>
                      <img
                        src={stylist.avatarUrl}
                        alt={stylist.name}
                        className={staffStyles.staffAvatar}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "/logo.png";
                        }}
                      />
                      <div className={staffStyles.staffInfo}>
                        <div className={staffStyles.staffName}>
                          {stylist.name}
                          <span
                            className={`${staffStyles.staffStatusBadge} ${
                              stylist.isActive
                                ? staffStyles.statusActive
                                : staffStyles.statusInactive
                            }`}
                            style={{ marginLeft: "8px" }}
                          >
                            {stylist.isActive ? "● 表示中" : "● 非表示"}
                          </span>
                        </div>
                        <div className={staffStyles.staffSlug}>
                          /{SALON.slug}/{stylist.slug}
                        </div>
                      </div>
                      <div className={staffStyles.staffActions}>
                        <button
                          className={staffStyles.editBtn}
                          onClick={() => {
                            setEditingStylist(stylist);
                            setIsNewStylist(false);
                          }}
                          id={`edit-${stylist.slug}`}
                        >
                          編集
                        </button>
                        <button
                          className={staffStyles.deleteBtn}
                          onClick={() => setDeletingStylist(stylist)}
                          id={`delete-${stylist.slug}`}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <div className={staffStyles.staffMessage}>
                      💬 {stylist.message || "メッセージ未設定"}
                    </div>
                  </div>
                ))}

                {/* Add Staff Button */}
                <button
                  className={staffStyles.addStaffBtn}
                  onClick={() => {
                    setEditingStylist({});
                    setIsNewStylist(true);
                  }}
                  id="add-staff-btn"
                >
                  ➕ スタッフを追加
                </button>
              </div>
            </section>
          </>
        )}

        {/* Footer */}
        <footer className={styles.footer}>
          <p>
            powered by <span className="gradient-text">tipinn</span>
          </p>
        </footer>
      </div>

      {/* Edit Modal */}
      {editingStylist !== null && (
        <StaffModal
          stylist={editingStylist}
          isNew={isNewStylist}
          onSave={handleSaveStylist}
          onClose={() => {
            setEditingStylist(null);
            setIsNewStylist(false);
          }}
          isUploading={isUploading}
        />
      )}

      {/* Delete Modal */}
      {deletingStylist && (
        <DeleteModal
          stylist={deletingStylist}
          onConfirm={handleDeleteStylist}
          onClose={() => setDeletingStylist(null)}
        />
      )}

      {/* Toast */}
      {toast && <div className={staffStyles.toast}>{toast}</div>}
    </div>
  );
}
