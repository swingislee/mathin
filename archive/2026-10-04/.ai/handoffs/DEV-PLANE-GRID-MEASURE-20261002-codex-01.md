# DEV-PLANE-GRID-MEASURE-20261002 · Codex 第 01 次交接

- 发出方 / 接收方：`plane_grid_measure_deep` worker → 本批 root 集成人。
- 目的：钉板与面积单位 v2 领域实现交付，等待独立复核与总合同接入。
- 关联任务卡：`.ai/tasks/DEV-PLANE-GRID-MEASURE-20261002.md`。
- 分配基线：`4f9939250a10267a1d7a01e3ea2fda81a5eb9ab7`；已消费集成人提供的共用对象旁动作、`referenceGrid` 与 `construction.projectPoint` 合同。
- 代码 base / head：`d85fcd3335b798c016f30ac1237988a283f035b6` / `28cc98ea63410efe39e00d1f252a693cdb170eeb`。领域交付只需 cherry-pick 后者，共用合同不重复集成。
- 分支 / worktree：`codex/plane-grid-measure-deep-codex` / `D:/code/2026/2026-07_mathin/.worktrees/plane-grid-measure-deep-codex`。

## 行为与文件

- `src/features/tools/plane-grid-measure/`：纯几何、材料模型、严格校验、双语工作台描述符及领域说明。
- `34-create`：自围多边形、矩形与可编辑快捷材料；增删控制点；连续拖动、格点终点；按需内部/边界点、面积、Pick 关系、真实垂高直角、三角分割与独立分片移动/拼回。
- `11-create`：自绘目标，追加/点放/搬动/复制/删除单位方格；可追加十块独立方格及 10 × 10 格参考目标；允许重叠、凹口、部分覆盖、目标外摆放。
- 面积覆盖先将所有方格并集拆成不重叠竖条，再裁剪真实目标三角剖分；多个目标分别报告，不把目标间的重叠再累加为整体结果。
- 40 舞台单位为一格边，cm/dm 读数按 10/100 转换，换单位不改材料。领域绘制自己的格点，关闭公共 30 单位网格。
- `tests/plane-grid-measure.test.ts`：41 项领域、数学、描述符、恢复及 SQL 源码边界检查。
- `supabase/migrations/20261002000200_tool_plane_grid_measure.sql`：只追加 polygon/state/scene 三个 helper，异常返回 false，撤销公开与客户端角色 execute；未改总分发器或业务数据。

## 合同与下游

- 导出 `planeGridMeasureScenes`、`isValidGridMeasureState`、`projectGridPoint`。
- 沿用 `PlanarState` 六键：`phase=0`、`marks=[]`；全局 `nextId/active/unit`；多边形 `kind/count/base/apex/split.ID` 和 `v.ID.i`，分片位移 `part.ID.i`；单位方格 `kind.ID` 和 `tile.ID`。
- 精确键白名单，4 多边形、每个 32 控制点、合计 96 点、100 单位方格；整数格点下 0.5 格面积合法。自交、相邻回折、近重复点、非法引用、非有限数、未知键、幽灵分片均拒绝。
- 对象旁菜单引用已有 action/operation ID，由公共 `SpatialContextActions` 宿主执行；编辑柄仅在编辑面板显示。关闭选择后切换观察不会重新选中材料。
- `projectGridPoint` 保证可见首钉点与闭合比较一致，面积材料关闭吸附时保留自由位置。
- root 接 `catalog/contract/scene-registry`、新版工具入口、公共控制清单与 SQL 总入口。旧 11/34/56、v1 与冻结副本未修改。

## 已运行检查

环境：Node 22.16.0，TypeScript 5.9.3，Vitest 4.1.10。

- `node node_modules/vitest/vitest.mjs run tests/plane-grid-measure.test.ts`：最终 41/41 通过。覆盖半格三角形、凹 L 形、分片面积守恒、共线插点、非法交叉、重复/部分/越界覆盖、100 cm²、单位换算、准确状态再读、真实高与直角、公共入口及闭合投影。
- `node node_modules/eslint/bin/eslint.js src/features/tools/plane-grid-measure tests/plane-grid-measure.test.ts`：零错误、零警告。
- TypeScript Compiler API：读取仓库 `tsconfig.json`，仅以领域 `geometry.ts/model.ts/validation.ts/scenes.tsx` 与本任务测试为入口，连带其类型依赖，`noEmit=true/incremental=false`；diagnostics=0。
- `git diff --cached --check`、实际 staged diff 范围复核、`node scripts/check-staged-secrets.mjs` 与实际提交 pre-commit：通过，七个领域文件。
- Vitest 的 Windows 依赖解析子进程最初被沙箱阻止；经现有批准流程以同一命令运行后通过。没有重装或改动 node_modules junction。

## 未覆盖与下一步

- 本 worker 未运行 SQL、未连接或写入数据库、未启动/重启服务，无共享端口或数据库占用。
- 原生 PostgreSQL helper 执行/回滚与总入口、课件/课堂 snapshot/snap 动画/旧 v1 回读由集成人按本批合同补集成检查；领域测试不冒充这些结果。
- root 复核并集成领域代码与本交接，接入 v2 目录与严格总校验；随后通过统一局域网开发入口交付人工操作验收。
- 人工重点：画凹多边形后点回可见钉点闭合，编辑与拖动手感；在同一现场开启高/分割/面积观察；把半重叠方格挪入/移出自画目标并切换 cm/dm；撤销及恢复起点。
- 本次状态：机器定向检查通过；开发页面集成、产品人工验收、数据库安装、部署与正式 Gate 均未由本 worker 宣称完成。
- 未提交修改 / 运行进程：领域代码提交时工作树干净；本交接是单独文档提交；没有本任务后台进程。
- 接收确认：待接收。集成人在原协作通道确认并绑定所审代码 head。
