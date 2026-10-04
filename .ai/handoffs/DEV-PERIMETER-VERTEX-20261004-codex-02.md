# DEV-PERIMETER-VERTEX-20261004 · Codex 第 02 次交接

- 发出方 / 接收方：原实现者 / 本批 root 集成人及只读复核者。
- 目的：修复独立复核发现的倾斜共线 P2；接续 codex-01，不替换其原始检查记录。
- 关联任务卡：`.ai/tasks/DEV-PERIMETER-VERTEX-20261004.md`；本交接路径已在 main `1801299a` 登记。
- 本次 base / 代码 head：`d22defd3bb3a9500173a6978784167bbaad51941` / `8b77afb7c6ccf1ff0d9775d15d7bda7c79528ed6`。
- 分支 / worktree：`codex/perimeter-vertex-codex` / `.worktrees/plane-invariants-codex`。

## 问题与修复

三点 `(100,100)`、`(106,115)`、`(120,150)` 准确共线，但 `hypot` 舍入使半短轴平方算成约 `1.913e-13`，旧 `minorSquared <= 0` 分支未进入线段极限；直接向前移 15 的定周长请求被保留原状。

`vertex-model.ts` 现先核对点在线段内部，并使用与叉积乘积尺度相称的 IEEE 舍入界识别共线。可分辨的近共线点仍走真实椭圆；短轴用有理化的距离余量求解，避免 `a-c` 消去为零。没有把构造模型较宽的接触容差当作共线精度阈值。

`tests/plane-perimeter-vertex.test.ts` 增加原复现和法向高度 `1e-3 / 1e-5 / 1e-7` 的窄椭圆回归，验证切向移动、真实高度、只改一个点与准确周长。其余文件、版本、持久字段及交互入口不变。

## 检查与下一步

- `node ../../node_modules/vitest/vitest.mjs run tests/plane-perimeter-vertex.test.ts tests/plane-perimeter-vertex-integration.test.ts`：2 文件、26 项通过（领域 17 / 宿主 9）；沿用经批准的 Vitest 缓存权限例外。
- 精确覆盖上述两个修改文件的 ESLint 与项目 compilerOptions 下 options/global/syntactic/semantic TypeScript 诊断通过（0 诊断）。
- diff 检查及实际两文件暂存隐私扫描通过；提交保留 pre-commit hook。
- 不受本次变化影响的既有整体拉伸 57 项继续复用 codex-01 已通过结果；无数据库、服务或浏览器操作。
- root 取入本修复后由复核者确认 P2 关闭；人工手感、部署及 Gate 状态保持。
- 本文件单独提交后工作树干净，无运行进程。接收确认：待接收。
