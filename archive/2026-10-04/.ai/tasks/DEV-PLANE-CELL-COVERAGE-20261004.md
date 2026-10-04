# DEV-PLANE-CELL-COVERAGE-20261004 · 完整格与边界格覆盖

- 授权与阶段：用户确认多个平面工具并行深修；承接面积关系 README 中明确保留的完整格／边界格覆盖，属 doc 04 教具开发轨。
- 用户动作：在当前三角形上开启真实正交方格，区分完整位于内部的方格和有正面积交集的边界方格；逐级细分，比较内覆盖、原形及外覆盖面积。沿真实底边和垂直方向，旋转／镜像／换底正确。
- 数学合同：完整格面积总和 ≤ 原三角形面积 ≤ 所有相交格面积总和。只接触点／边不算边界格；对每格真实裁切而非用中心点或包围框判覆盖。保持有界计算，明确密度语义；原有条带是另一种阶梯近似，不能混称内覆盖。
- 新版 `18-coverage` / `plane-area-relations-lesson-v5` 基于 v4 保留全部条带、内点、共角等操作。逐对象新增覆盖开关和整数密度；原 v4 及更早严格校验不改。推荐 `coverCount.ID`（4～48）和 `coverCells.ID`；如有容量或语义问题先回报再定字段。
- 接口新增 `coverage-model.ts`、`coverage-validation.ts`、`coverage-scene.tsx`，导出 `createCoverageState`、`isValidCoverageState`、`planeCoverageScene`。总目录／版本／场景注册由 root 写入。
- SQL：`20261004020100_tool_plane_cell_coverage.sql` 仅追加 `tool_plane_cell_coverage_state_is_valid` / `tool_plane_cell_coverage_scene_is_valid` 及权限回收；总分发由 root 负责。提供 TS/SQL 共用合法／非法 fixtures，不连接数据库。
- 观察开关关闭面板后保留，精确数值只在主动测量时显示。复制／删除／跨材料动作按真实 ID 保持字段归属；容量和边界失败时原子保留，不存派生网格或面积。
- worker 使用 `.worktrees/plane-grid-measure-deep-codex` 新分支；只写登记路径，不改已有 strips 文件、共享宿主、目录、依赖或总测试。有关读数统一沿用 u／u²。
- 定向验证覆盖斜放／镜像／锐钝三角形、两种绕序、格线接触、逐级细分及面积界限、最大密度、跨材料元数据、历史／保存／课堂／旧版隔离。界面由人工验收，无生产动作。

## 接收记录

源码 `eecfc0d5`、交接 01 `4768ca8f` 与测试断言窄修复 `ae5c63af` 已集成。`/root/overlap_concave` 独立复核数学界限、严格接触、容量及 TS／SQL，无 P1/P2；领域 53 项和接线后宿主 7 项通过。32→48 为非嵌套细分，不承诺单步单调；极小交片的浮点面积限制已记证据，不影响界面格数与面积界。课堂与本机保存由集成人补齐，开发端已交付、待人工验收；见 [三项并行深修](../../docs/evidence/tools-plane-depth-20261004.md)。
