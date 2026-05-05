"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Stylist, Salon, TipOption } from "@/lib/mock-data";
import { TIP_OPTIONS as DEFAULT_TIP_OPTIONS } from "@/lib/mock-data";
import { DEFAULT_SITE_CONFIG, type SiteConfig } from "@/lib/site-config";
import styles from "./stylist.module.css";

type Step = "landing" | "tip" | "thanks";

interface StylistPageProps {
  stylist: Stylist;
  salon: Salon;
}

export default function StylistPage({ stylist, salon }: StylistPageProps) {
  const isTeam = stylist.slug === "team";
  const [step, setStep] = useState<Step>("landing");
  const [selectedAmount, setSelectedAmount] = useState<number>(500);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [isCustom, setIsCustom] = useState(false);
  const [message, setMessage] = useState("");
  const [senderName, setSenderName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [tipOptions, setTipOptions] = useState<TipOption[]>(DEFAULT_TIP_OPTIONS);

  const finalAmount = isCustom ? parseInt(customAmount) || 0 : selectedAmount;

  // サイト設定を取得
  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          if (data && data.home) {
            setConfig(data);
            // チップ選択肢もDB設定から取得
            if (data.tipOptions && data.tipOptions.length > 0) {
              setTipOptions(data.tipOptions);
            }
          }
        }
      } catch {
        // フォールバック: デフォルト設定
      }
    }
    fetchConfig();
  }, []);

  useEffect(() => {
    if (step === "thanks") {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const handleSelectAmount = (option: TipOption) => {
    setSelectedAmount(option.amount);
    setIsCustom(false);
  };

  const handleCustomToggle = () => {
    setIsCustom(true);
    setSelectedAmount(0);
  };

  const handlePayment = async () => {
    if (finalAmount < 100) return;
    setIsProcessing(true);

    // MVP: PayPay決済のシミュレーション
    // 実際のPayPay API連携は後で実装
    await new Promise((resolve) => setTimeout(resolve, 1500));

    setIsProcessing(false);
    setStep("thanks");
  };

  const sl = config.stylistLanding;
  const ts = config.tipSelection;
  const tp = config.thanksPage;

  // ================ LANDING PAGE ================
  if (step === "landing") {
    return (
      <div className="page-wrapper">
        <div className={styles.container}>
          {/* Salon Header */}
          <header className={styles.header}>
            <div className={styles.salonBadge}>
              <Image
                src={salon.logoUrl}
                alt={salon.name}
                width={28}
                height={28}
                className={styles.salonLogoSmall}
              />
              <span className={styles.salonLabel}>{salon.name}</span>
            </div>
          </header>

          {/* Stylist Profile */}
          <section className={styles.profileSection}>
            <div className={styles.avatarContainer}>
              <div className={styles.avatarRing}>
                <Image
                  src={stylist.avatarUrl}
                  alt={stylist.name}
                  width={140}
                  height={140}
                  className={styles.avatarImage}
                />
              </div>
              <div className={styles.avatarGlow} />
            </div>

            <h1 className={styles.stylistName}>{isTeam ? config.home.teamName : stylist.name}</h1>
            <p className={styles.greeting}>
              {isTeam ? (
                <>ご来店<br />ありがとうございました！</>
              ) : (
                <>{sl.greeting1}<br />{sl.greeting2}</>
              )}
            </p>
          </section>

          {/* Message Card */}
          <section className={styles.messageCard}>
            <div className={styles.messageIcon}>{sl.messageIcon}</div>
            <p className={styles.messageText}>{stylist.message}</p>
          </section>

          {/* Support CTA */}
          <div className={styles.landingCta}>
            <button
              className="btn-primary"
              onClick={() => setStep("tip")}
              id="btn-start-support"
            >
              <span>{sl.ctaButtonEmoji}</span>
              <span>{sl.ctaButtonText}</span>
            </button>
            <p className={styles.ctaSubtext}>
              {sl.ctaSubtext}
            </p>
          </div>

          {/* tipinn branding */}
          <footer className={styles.footer}>
            <p className={styles.footerText}>
              powered by <span className="gradient-text">tipinn</span>
            </p>
            <Link
              href="/legal/tokushoho"
              className={styles.legalLink}
              id="link-tokushoho-landing"
            >
              特定商取引法に基づく表記
            </Link>
          </footer>
        </div>
      </div>
    );
  }

  // ================ TIP SELECTION ================
  if (step === "tip") {
    return (
      <div className="page-wrapper">
        <div className={styles.container}>
          {/* Back Button */}
          <header className={styles.tipHeader}>
            <button
              className={styles.backButton}
              onClick={() => setStep("landing")}
              id="btn-back"
            >
              ← 戻る
            </button>
            <div className={styles.tipStylistBadge}>
              <Image
                src={stylist.avatarUrl}
                alt={stylist.name}
                width={32}
                height={32}
                className={styles.tipAvatarSmall}
              />
              <span>{stylist.name}</span>
            </div>
          </header>

          {/* Amount Selection */}
          <section className={styles.tipSection}>
            <h2 className={styles.tipTitle}>
              {ts.title1}
              <br />
              {ts.title2}
            </h2>

            <div className={styles.amountGrid}>
              {tipOptions.map((option) => (
                <button
                  key={option.amount}
                  className={`${styles.amountCard} ${
                    !isCustom && selectedAmount === option.amount
                      ? styles.amountCardActive
                      : ""
                  } ${option.isPopular ? styles.amountCardPopular : ""}`}
                  onClick={() => handleSelectAmount(option)}
                  id={`amount-${option.amount}`}
                >
                  {option.isPopular && (
                    <span className={styles.popularBadge}>人気</span>
                  )}
                  <span className={styles.amountEmoji}>{option.emoji}</span>
                  <span className={styles.amountLabel}>{option.label}</span>
                  <span className={styles.amountPrice}>
                    ¥{option.amount.toLocaleString()}
                  </span>
                  <span className={styles.amountDesc}>{option.description}</span>
                </button>
              ))}
            </div>

            {/* Custom Amount */}
            <button
              className={`${styles.customAmountToggle} ${
                isCustom ? styles.customAmountToggleActive : ""
              }`}
              onClick={handleCustomToggle}
              id="btn-custom-amount"
            >
              <span>✏️</span>
              <span>{ts.customAmountLabel}</span>
            </button>

            {isCustom && (
              <div className={styles.customAmountInput}>
                <span className={styles.currencyPrefix}>¥</span>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="金額を入力"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className={styles.amountInput}
                  min="100"
                  max="100000"
                  id="input-custom-amount"
                  autoFocus
                />
              </div>
            )}
          </section>

          {/* Message Section */}
          <section className={styles.messageSection}>
            <h3 className={styles.messageSectionTitle}>
              {ts.messageSectionTitle}
            </h3>
            <textarea
              className={styles.messageInput}
              placeholder={ts.messagePlaceholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={200}
              id="input-message"
            />
            <span className={styles.charCount}>{message.length}/200</span>
          </section>

          {/* Sender Name */}
          <section className={styles.nameSection}>
            <h3 className={styles.messageSectionTitle}>
              {ts.nameSectionTitle}
            </h3>
            <input
              type="text"
              className={styles.nameInput}
              placeholder={ts.namePlaceholder}
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              maxLength={20}
              id="input-name"
            />
          </section>

          {/* Payment CTA */}
          <div className={styles.paymentCta}>
            <div className={styles.totalAmount}>
              <span className={styles.totalLabel}>{ts.totalLabel}</span>
              <span className={styles.totalPrice}>
                ¥{finalAmount.toLocaleString()}
              </span>
            </div>

            <button
              className={`btn-paypay ${styles.payButton} ${
                finalAmount < 100 || isProcessing ? styles.payButtonDisabled : ""
              }`}
              onClick={handlePayment}
              disabled={finalAmount < 100 || isProcessing}
              id="btn-pay"
            >
              {isProcessing ? (
                <span className={styles.spinner} />
              ) : (
                <>
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="white"
                  >
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
                  </svg>
                  <span>{ts.payButtonText}</span>
                </>
              )}
            </button>

            {finalAmount < 100 && isCustom && (
              <p className={styles.minAmountNote}>
                {ts.minAmountNote}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ================ THANKS PAGE ================
  return (
    <div className="page-wrapper">
      {/* Confetti */}
      {showConfetti && (
        <div className={styles.confettiContainer}>
          {Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className={styles.confetti}
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${2 + Math.random() * 3}s`,
                backgroundColor: [
                  "#4FD1C5",
                  "#FFD93D",
                  "#A855F7",
                  "#3B82F6",
                  "#10B981",
                  "#81E6D9",
                ][Math.floor(Math.random() * 6)],
              }}
            />
          ))}
        </div>
      )}

      <div className={styles.container}>
        <div className={styles.thanksContent}>
          {/* Heart Animation */}
          <div className={styles.thanksHeart}>{tp.heartEmoji}</div>

          <h1 className={styles.thanksTitle}>
            {tp.title1}
            <br />
            {tp.title2}
          </h1>

          <p className={styles.thanksAmount}>
            ¥{finalAmount.toLocaleString()} {tp.amountSuffix}
          </p>

          {/* Stylist Thank You Message */}
          <div className={styles.thanksMessageCard}>
            <div className={styles.thanksAvatarRow}>
              <Image
                src={stylist.avatarUrl}
                alt={stylist.name}
                width={48}
                height={48}
                className={styles.thanksAvatar}
              />
              <span className={styles.thanksFrom}>{isTeam ? "CARTA スタッフ一同" : stylist.name} {tp.fromSuffix}</span>
            </div>
            <p className={styles.thanksMessage}>{stylist.thankYouMessage}</p>
          </div>

          {/* Share Section */}
          <div className={styles.shareSection}>
            <p className={styles.shareText}>
              {tp.shareText}
            </p>
            <div className={styles.shareButtons}>
              <button className={styles.shareBtn} id="btn-share-twitter">
                𝕏
              </button>
              <button className={styles.shareBtn} id="btn-share-line">
                LINE
              </button>
              <button className={styles.shareBtn} id="btn-share-copy">
                🔗
              </button>
            </div>
          </div>

          {/* Return Button */}
          <a href="/" className={styles.returnBtn} id="btn-return">
            {tp.returnButtonText}
          </a>

          <footer className={styles.footer}>
            <p className={styles.footerText}>
              powered by <span className="gradient-text">tipinn</span>
            </p>
            <Link
              href="/legal/tokushoho"
              className={styles.legalLink}
              id="link-tokushoho-thanks"
            >
              特定商取引法に基づく表記
            </Link>
          </footer>
        </div>
      </div>
    </div>
  );
}
