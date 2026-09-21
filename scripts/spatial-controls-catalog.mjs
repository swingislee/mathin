// 使用仓库已有 TSX 测试运行器渲染实际 SVG，不启动浏览器或维护另一套图标 path。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/spatial-controls-catalog.test.ts"], {
  cwd: root, stdio: "inherit", env: { ...process.env, MATHIN_WRITE_SPATIAL_CATALOG: "1" }, windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
