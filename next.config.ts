import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.5.213", "127.0.0.1", "localhost"],
};

export default withNextIntl(nextConfig);
