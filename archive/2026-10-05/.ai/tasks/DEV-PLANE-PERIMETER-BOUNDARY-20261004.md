# DEV-PLANE-PERIMETER-BOUNDARY-20261004 · 组合边界与边段平移

- 持续目标及明确并行授权内，补齐已批准 13 的真实组合边界／公共边和 43 的边段平移；不是新增题库或自动给出教学结论。
- 新增 `plane-perimeter-boundary/`，包装已有周长描述符，保留 v2 的自绘、自由编辑、锁量顶点、描边和拉直。新场景 `10-boundary` / `plane-perimeter-lesson-v3`；导出 `createPerimeterBoundaryState`、`isValidPerimeterBoundaryState`、`planePerimeterBoundaryScene`，夹具 `planePerimeterBoundaryCases()`。
- 13：所有实际边在交点、T 接点与共线重叠端点处分段，两侧纸片覆盖分类得到真实并集。分别表达外环、孔环、分离分量、公共接缝与被遮住的原边；长度由实际边推导，原材料仍可编辑。
- 43：从选中纸片取出最多 32 条独立边段副本，原纸保持；逐段直接拖动、准确位移、还原。两端按相同位移连续运动，长度与方向保持；旋转／镜像正交凹形按自身两方向排齐，非正交材料保留自由平移。台阶／凹口是追加起点，真实边长不由包围盒代替。
- 持久化仅增加成员／显隐、来源／选择及边段位移；并集边界与长度实时推导。沿用 16 材料、192 顶点及共享 256 键预算，引用和孤立字段严格检查。
- worker 独占登记的新目录、两份定向测试、fixture、`20261004031400_tool_plane_perimeter_boundary.sql` 和交接。SQL helper 前缀 `tool_plane_perimeter_boundary_`，导出 state/scene 校验，全部私有；title 使用现有 trim／UTF-16 语义。
- 复用干净的 `.worktrees/plane-invariants-codex`，从本登记后的 main 创建 `codex/plane-perimeter-boundary-codex`；原双折分支与提交保留。旧 perimeter/construction 不改。catalog、contract、宿主、0315 分发、本地 DB、类型和交付由 root 接管。
- 只做本增量所需的几何／交互合同检查，不连接数据库、生产、服务或浏览器；开发端交付与人工教学验收分别记录。

2026-10-05：领域 `4de290a2`、共享接线 `1bbd4425` 已集成main。复用18项领域检查；真实宿主已覆盖独立边段拖动、准确小数位移、原纸保持、暂停继续、只读，以及旧v2／新v3课堂一次回执。53项新保存夹具在本机TS/SQL通过，0314/0315已安装，实际生成2个helper类型。zh/en开发入口可启动；人工教学验收与生产发布待后续确认。
