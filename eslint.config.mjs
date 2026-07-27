import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 参考资料与历史 demo，不参与构建
    ".claude/**",
  ]),
  {
    // docs/plan/21 §23 阶段 J：防止页面级限宽回流。
    // Dashboard 的宽度由 DashboardShell 唯一决定；页面里再出现 mx-auto 就意味着
    // 有人又开始在页面根上重新居中，页面之间的横向跳动会立刻回来。内容需要限宽
    // 用 DashboardMainColumn / DashboardReadingColumn 在页面内部解决。
    files: ["src/app/**/dashboard/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'JSXAttribute[name.name="className"] Literal[value=/(^|\\s)mx-auto(\\s|$)/]',
          message: "Dashboard 页面不得用 mx-auto 重新居中：宽度由 DashboardShell 决定，内容限宽请用 DashboardMainColumn / DashboardReadingColumn（docs/plan/21 §3.2）。",
        },
      ],
    },
  },
]);

export default eslintConfig;
