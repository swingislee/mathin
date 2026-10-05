import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/uuid.ts"],
    rules: {
      "no-restricted-properties": ["error", {
        property: "randomUUID",
        message: "局域网 HTTP 兼容：使用 @/lib/uuid 的 newId()；纯服务端使用 node:crypto 的命名导入（AGENTS.md）。",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 原生客户端使用各自的工具链，微信类型和页面不进入网页规则。
    "apps/**",
    // 本地生成物、隔离验证环境与大型工具缓存，不属于仓库源码。
    ".tmp/**",
    "archive/**",
    ".worktrees/**",
    ".rc-worktrees/**",
    ".codex/**",
    ".pnpm-store/**",
    ".prod-backups/**",
    ".next-*/**",
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    // 参考资料与历史 demo，不参与构建
    ".claude/**",
  ]),
]);

export default eslintConfig;
