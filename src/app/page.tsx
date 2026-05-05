"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { SALON, STYLISTS as MOCK_STYLISTS, type Stylist } from "@/lib/mock-data";
import { DEFAULT_SITE_CONFIG, type SiteConfig } from "@/lib/site-config";
import styles from "./page.module.css";

export default function HomePage() {
  const [selectedStylist, setSelectedStylist] = useState<string | null>(null);
  const [stylists, setStylists] = useState<Stylist[]>(MOCK_STYLISTS);
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);

  // Supabase APIからスタイリスト一覧＋サイト設定を取得
  useEffect(() => {
    async function fetchData() {
      try {
        // スタイリスト取得
        const res = await fetch("/api/admin/stylists");
        if (res.ok) {
          const data = await res.json();
          const rawList = Array.isArray(data) ? data : data.stylists || [];
          if (rawList.length > 0) {
            const mapped: Stylist[] = rawList
              .filter((s: Record<string, unknown>) => s.slug !== "team")
              .map((s: Record<string, unknown>) => ({
                id: s.id as string,
                salonId: (s.salon_id || s.salonId) as string,
                name: s.name as string,
                slug: s.slug as string,
                avatarUrl: (s.avatar_url || s.avatarUrl) as string,
                message: s.message as string,
                thankYouMessage: (s.thank_you_message || s.thankYouMessage) as string,
                isActive: (s.is_active !== undefined ? s.is_active : s.isActive) as boolean,
              }))
              .filter((s: Stylist) => s.isActive);
            if (mapped.length > 0) setStylists(mapped);
          }
        }

        // サイト設定取得
        const configRes = await fetch("/api/config");
        if (configRes.ok) {
          const configData = await configRes.json();
          if (configData && configData.home) {
            setConfig(configData);
          }
        }
      } catch {
        console.log("Using default data as fallback");
      }
    }

    fetchData();
  }, []);

  const h = config.home;

  return (
    <div className="page-wrapper">
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.logoWrapper}>
            <Image
              src={SALON.logoUrl}
              alt={SALON.name}
              width={48}
              height={48}
              className={styles.logoImage}
            />
            <div>
              <h1 className={styles.salonName}>{SALON.name}</h1>
              <p className={styles.poweredBy}>
                powered by <span className="gradient-text">tipinn</span>
              </p>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section className={styles.hero}>
          <div className={styles.heroEmoji}>{h.heroEmoji}</div>
          <h2 className={styles.heroTitle}>
            {h.heroTitle1}
            <br />
            <span className="gradient-text">{h.heroTitle2}</span>
          </h2>
          <p className={styles.heroSubtitle}>
            {h.heroSubtitle1}
            <br />
            {h.heroSubtitle2}
          </p>
        </section>

        {/* Staff Selection */}
        <section className={styles.staffSection}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>{h.sectionIcon}</span>
            {h.sectionTitle}
          </h3>

          {/* 箱推し（全体応援） */}
          <button
            className={`${styles.staffCard} ${styles.teamCard} ${
              selectedStylist === "team" ? styles.staffCardActive : ""
            }`}
            onClick={() => setSelectedStylist("team")}
            id="staff-team"
          >
            <div className={styles.teamAvatar}>
              <span>🏠</span>
            </div>
            <div className={styles.staffInfo}>
              <span className={styles.staffName}>{h.teamName}</span>
              <span className={styles.staffDesc}>{h.teamDesc}</span>
            </div>
            <div className={styles.checkMark}>
              {selectedStylist === "team" && "✓"}
            </div>
          </button>

          {/* Individual Stylists */}
          <div className={styles.staffGrid}>
            {stylists.map((stylist, index) => (
              <button
                key={stylist.id}
                className={`${styles.staffCard} ${
                  selectedStylist === stylist.slug
                    ? styles.staffCardActive
                    : ""
                }`}
                onClick={() => setSelectedStylist(stylist.slug)}
                id={`staff-${stylist.slug}`}
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className={styles.staffAvatar}>
                  <Image
                    src={stylist.avatarUrl}
                    alt={stylist.name}
                    width={44}
                    height={44}
                    className={styles.avatarImage}
                  />
                </div>
                <div className={styles.staffInfo}>
                  <span className={styles.staffName}>{stylist.name}</span>
                </div>
                <div className={styles.checkMark}>
                  {selectedStylist === stylist.slug && "✓"}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* CTA Button */}
        <div className={styles.ctaSection}>
          <a
            href={
              selectedStylist
                ? `/carta/${selectedStylist === "team" ? "team" : selectedStylist}`
                : "#"
            }
            className={`btn-primary ${styles.ctaButton} ${
              !selectedStylist ? styles.ctaDisabled : ""
            }`}
            onClick={(e) => {
              if (!selectedStylist) e.preventDefault();
            }}
            id="cta-support"
          >
            <span>{h.ctaButtonText}</span>
            <span className={styles.ctaArrow}>→</span>
          </a>
          <p className={styles.ctaNote}>
            {h.ctaNote}
          </p>
        </div>

        {/* Footer */}
        <footer className={styles.footer}>
          <Link
            href="/legal/tokushoho"
            className={styles.footerLink}
            id="link-tokushoho"
          >
            特定商取引法に基づく表記
          </Link>
        </footer>
      </div>
    </div>
  );
}
