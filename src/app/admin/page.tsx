"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { SALON, STYLISTS } from "@/lib/mock-data";
import styles from "./admin.module.css";

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

function generateMockTips(): TipRecord[] {
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
    const stylist = STYLISTS[Math.floor(Math.random() * STYLISTS.length)];
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

export default function AdminPage() {
  const [tips, setTips] = useState<TipRecord[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<"today" | "week" | "month">("week");
  const [selectedStylist, setSelectedStylist] = useState<string>("all");

  useEffect(() => {
    setTips(generateMockTips());
  }, []);

  const filteredTips = useMemo(() => {
    let filtered = tips;

    // Period filter
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

    // Stylist filter
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

  // Stylist ranking
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
            {STYLISTS.map((s) => (
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

        {/* Footer */}
        <footer className={styles.footer}>
          <p>
            powered by <span className="gradient-text">tipinn</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
