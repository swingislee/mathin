import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const isDev = process.env.NODE_ENV !== "production";

/** Supabase 自托管源（REST/Storage/Realtime 同源）。缺失时只放行同源，不猜。 */
function supabaseOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return [];
  try {
    const { origin, host, protocol } = new URL(raw);
    const ws = protocol === "https:" ? `wss://${host}` : `ws://${host}`;
    return [origin, ws];
  } catch {
    return [];
  }
}

/** docs/plan/15-§7.1。CSP 先以 Report-Only 上线观察，确认无误报再切强制。 */
function contentSecurityPolicy(frameAncestors: string): string {
  const supabase = supabaseOrigins();
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js 的启动内联脚本尚未接 nonce；切强制 CSP 前需先解决 'unsafe-inline'。
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    // Tailwind/BlockNote/KaTeX 均注入内联样式。
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...supabase],
    "font-src": ["'self'", "data:"],
    "media-src": ["'self'", "blob:", ...supabase],
    // Supabase REST + Realtime WebSocket；WebRTC 的信令走 Realtime，无额外域。
    "connect-src": ["'self'", ...supabase, ...(isDev ? ["ws:", "wss:"] : [])],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'"],
    "frame-ancestors": [frameAncestors],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  const policy = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
  return `${policy}; report-uri /api/csp-report`;
}

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // 课堂只用 WebRTC DataChannel，不取摄像头/麦克风；白板与笔记需要全屏。
    value: "camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=(), fullscreen=(self)",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // 默认 .next；bundle 量化时 NEXT_DIST_DIR=.next-bundle 构建到独立目录，
  // 不与正在运行的 dev server 争用 .next（见 scripts/bundle-report.mjs）。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["192.168.5.213", "127.0.0.1", "localhost"],
  serverExternalPackages: ["@blocknote/server-util"],
  async headers() {
    return [
      {
        // `/embed/[tool]` 的存在意义就是被外站嵌入，必须放行 frame（15-§10.10）。
        source: "/embed/:path*",
        headers: [...baseHeaders, { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy("*") }],
      },
      {
        // 其余全站禁止被嵌套：后台管钱管档案，clickjacking 面必须关死。
        source: "/:path((?!embed/).*)",
        headers: [
          ...baseHeaders,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy("'none'") },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
