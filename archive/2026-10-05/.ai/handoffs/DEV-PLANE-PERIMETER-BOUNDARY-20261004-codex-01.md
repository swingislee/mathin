# 组合边界与独立边段平移 · worker 交接

- 登记任务：`DEV-PLANE-PERIMETER-BOUNDARY-20261004`。
- 分支：`codex/plane-perimeter-boundary-codex`，起点 `9420bb0d`；原双折分支保留。
- 代码提交：`4de290a258ab303f1ca2e5f1d1218db761f53faa`，9 个登记独占新文件。
- 状态：worker 机器检查通过，待 root 共享接线；未连接 DB、服务、浏览器或生产，尚无人工教学验收。

## 接线接口

- 版本／场景：`plane-perimeter-lesson-v3` / `10-boundary`。
- `plane-perimeter-boundary/model.ts`：`createPerimeterBoundaryState`、`isValidPerimeterBoundaryState`。
- `plane-perimeter-boundary/scenes.tsx`：`planePerimeterBoundaryScene`。
- `tests/fixtures/plane-perimeter-boundary-cases.ts`：`planePerimeterBoundaryCases()`，含合法／拒绝、v2 版本隔离和 title trim／UTF-16 边界。
- `20261004031400_tool_plane_perimeter_boundary.sql`：`tool_plane_perimeter_boundary_state_is_valid(jsonb)`、`tool_plane_perimeter_boundary_scene_is_valid(jsonb)`；显式撤销全部 public／anon／authenticated／service_role 权限，0315 总分发由 root 接入。

## 实际能力及合同

- 描述符包装旧周长，保留原材料、自绘、普通顶点编辑、定量拉伸／顶点、描边和拉直；旧目录未改。
- 对选定成员的实际世界坐标做直边分割与两侧覆盖分类，分别推导外环、孔环、公共接缝、被覆盖原边。点接触归同一拓扑连通部分但可有多个外环；孔边界长度独立列出，并包含在全部边界总长中。
- 交点／T 接点／重合边端点统一分段；先按坐标舍入尺度识别共线，再处理非平行交点，避免旋转后的平行舍入残差产生伪分割。原边长及派生边界不缓存进存档。
- `unionMember.<id>` 为严格 0/1，四个观察开关默认关闭；追加材料保持在当前组合外，可逐片加入或组合全部。
- `edgeSource`／`edgeActive` 为严格整数引用；每条来源边存 `edgeMove.<index>` 局部位移，范围 ±50000。拖动与准确输入使用世界坐标，两端每帧同位移，方向和长度保持。
- 正交凹形按自身两方向排齐，旋转／镜像保持；斜边材料可自由取边与平移，禁用两方向排齐。台阶与凹口作为普通可编辑追加材料，实际凹口周长不替换成包围盒。
- 来源刚体变换保留局部位移；来源顶点形状改变才归零其副本位移，移除来源才清副本。其他纸片与原纸在边段操作中保持。
- 延续 16 纸片、192 顶点与 256 键预算；已覆盖含 32 边来源的 242 点键组合。旧 v2 不接纳新键。

## 已完成的窄检查（2026-10-05）

- 两份定向测试 18/18 通过；包含 30 组独立轴对齐 oracle 的原序、逆序及旋转镜像对照，共边／窄缝／包含／重合／孔与岛、非正交交点、全部动画帧刚性、字段／容量和旧描述符桥接。
- 独占源码、测试、夹具 TypeScript 0 诊断；8 个 TS/TSX 文件 ESLint 通过。
- `git diff --cached --check` 与实际 9 文件暂存隐私扫描通过。
- Vitest 在 Windows 沙箱内缓存重命名报 EPERM，获准后仅在沙箱外运行上述定向用例；未引入数据库／服务动作。

## root 最小剩余事项

- 接入 catalog、contract、scene-registry、control-inventory、0315 与数据库类型，保留共享准确小数输入提交 `828987ca`。
- 执行本次新 fixture 的 TS／SQL 一致性及既定宿主／版本保存检查；以上 worker 已通过结果可复用。
- 交付局域网开发入口，人工确认组合边界显示、边段拖动／排齐、教学表达和原有操作。
