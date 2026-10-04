# DEV-PLANE-CELL-COVERAGE-20261004 · codex 第 01 次交接

- 发出方 / 接收方：`/root/plane_cell_coverage` → 本批集成人 `/root`。
- 目的：完整格与边界格覆盖实现交付，供只读复核及统一集成。
- 关联任务卡：`.ai/tasks/DEV-PLANE-CELL-COVERAGE-20261004.md`。
- 代码 base：`c2c60955e74071759af1215f11d67ff43031a18b`。
- 代码 head：`eecfc0d586f9d20cbafbaa7025a3cc081f87be27`。
- 分支 / worktree：`codex/plane-cell-coverage-codex` / `.worktrees/plane-grid-measure-deep-codex`。

## 本次交付

- 新建 `coverage-model.ts`、`coverage-validation.ts` 和 `coverage-scene.tsx`，导出约定的 `createCoverageState`、`isValidCoverageState` 与 `planeCoverageScene`；新增 `18-coverage` / `plane-area-relations-lesson-v5` 领域实现，保留 v4 的全部操作描述符及桥接。
- 每对象新增 `coverCount.ID`（整数 4～48，默认 16）和 `coverCells.ID`（默认 false）；16 材料共 230 个参数、153 个开关。普通复制继承、删除清除所属字段，新构造及派生材料独立默认关闭，四边形开关严格保持 false。没有持久化网格、交片、面积或父材料关系。
- 沿真实底边及垂直方向建立方格。网格锚定该坐标系投影 bbox 的左下角，密度按实际投影宽高中较长者等分，钝角外伸包含在宽度内；每张最多扫描 48×48 格。分类使用除法前的本地点积／叉积坐标，接近共线时以二进制精确符号回退，避免固定面积阈值吞掉微小边界片；交片由逐格真实轴向裁切派生。
- 完整格面积 ≤ 原面积 ≤ 所有正面积相交格面积。点／边接触不计入；完整格含闭边界。绘制把每材料完整格和边界格合并为两个 SVG path，采用既有颜色与按钮图标。
- 观察在关闭面板、Esc、取消选择后保留；只有测量开启才显示格长、格数和 u／u² 数值。条带与覆盖开关、密度各自独立，说明文字分别布置，不把条带阶梯近似误标为内覆盖。
- 新增 41 个 TS/SQL 共用 fixtures（`planeCellCoverageCases()`，包含 accepted `visible`、16 材料、空现场、字段类型／未知／孤儿／非 canonical／旧版本冒认）；领域测试覆盖真实裁切、姿态与绕序、接触、约 10⁻¹² u² 微片、极钝角、最大密度、小数点位、嵌套细分、材料元数据与继承动作。
- 仅追加 SQL `20261004020100_tool_plane_cell_coverage.sql` 两个 helper 和权限回收。未改总分发、目录、共享版本、生成类型、旧 tests 或 strips/interior/angle 源码。领域 README 更新使用方法与范围。

## 集成人接线

- 总目录／版本／注册使用上述 v5 接口；SQL 总分发和 catalog 映射追加 `tool_plane_cell_coverage_scene_is_valid`，按任务统一执行本机 parity、保存回读、ACL 及生成类型。
- `control-inventory.ts` 登记 `relations-cell-coverage`（`grid`）、`relations-cover-cells`（`grid`）、`relations-refine-cover-cells`（`increase`）。参数 UI key 为 `coverDivisions`，持久字段为 `coverCount.ID`。
- `tests/plane-cell-coverage-integration.test.ts` 已提供 7 个版本／旧版隔离／冻结／课堂恢复／UUID 降级／撤销与重做／关闭观察／拖动取消／缩放暂停／只读与回执用例；按派工约定待 root 的共享 v5 接线后执行。

## 已运行检查

- Node `v22.16.0`、Vitest `4.1.10`、TypeScript `5.9.3`、ESLint `9.39.4`，复用主工作树依赖，无安装。
- `node ../../node_modules/vitest/vitest.mjs run tests/plane-cell-coverage.test.ts`：最终 **53 项通过**。首次运行在 sandbox Temp SSR rename 处 EPERM，获准使用同命令沙箱外执行；测试随后揭露并修复斜底除法舍入引入的假接触片，最终结果包含新增小数几何最大密度输入。
- `node ../../node_modules/eslint/bin/eslint.js src/features/tools/plane-relations/coverage-model.ts src/features/tools/plane-relations/coverage-validation.ts src/features/tools/plane-relations/coverage-scene.tsx tests/plane-cell-coverage.test.ts tests/plane-cell-coverage-integration.test.ts tests/fixtures/plane-cell-coverage-cases.ts`：通过。
- 用 Node 内存 TypeScript program 读取仓库 tsconfig（`incremental:false`、`noEmit:true`），rootNames 为上述领域 3 文件、领域测试和 fixture：**本任务与依赖均 0 诊断**。额外纳入宿主测试时，当前基线有 3 处 v5 尚未注册诊断，保留真实类型等待 root 接线，没有加转换规避。
- `git diff --cached --check`、`node scripts/check-staged-secrets.mjs`：通过；代码提交保留 `.githooks`，hook 再次确认 8 个实际暂存文件通过隐私检查。

## 边界与后续

- 4→8→16→32 是同起点嵌套细分，保持单调收紧；32→48 并非嵌套网格，不承诺任意图形这一步单调，但每一档始终满足面积界。准确输入任意 4～48 整数也保持面积界。
- 本批覆盖三角形，不添加方格复制动作，也不扩展凹形或圆弧关系。
- 未启动服务、浏览器或 Playwright，未连接数据库，未修改生产。SQL 运行、共享合同／课堂集成及独立复核由 root 统一完成。
- 代码提交后工作树干净，无后台进程与共享服务占用。本单为独立文档提交；源码不会因交接而改变。
- 产品人工视觉与教学手感验收待完成；未宣称开发入口已交付、已部署、用户已验收或 Gate 关闭。
- 接收确认：待接收，由集成人在本批登记记录代码与交接 SHA。
