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
    ];
  },
};

export default nextConfig;
