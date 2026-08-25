import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async rewrites() {
    return [
      // /company で public/company/index.html を配信する
      // （public 配下は静的配信されるが、ディレクトリの index.html は自動解決されないため）
      {
        source: "/company",
        destination: "/company/index.html",
      },
      // 特定商取引法に基づく表記（店舗ごと）。上と同じ理由で拡張子なしURLを明示する。
      // 店舗が増えたらここに1行足す（到達可能なURLをこのファイルだけで把握できる状態を保つ）。
      {
        source: "/company/tokushoho-carta",
        destination: "/company/tokushoho-carta.html",
      },
      {
        source: "/company/tokushoho-niii",
        destination: "/company/tokushoho-niii.html",
      },
      {
        source: "/company/tokushoho-nun",
        destination: "/company/tokushoho-nun.html",
      },
      {
        source: "/company/tokushoho-selni",
        destination: "/company/tokushoho-selni.html",
      },
      {
        source: "/company/tokushoho-suco",
        destination: "/company/tokushoho-suco.html",
      },
      {
        source: "/company/tokushoho-lma",
        destination: "/company/tokushoho-lma.html",
      },
    ];
  },
};

export default nextConfig;
