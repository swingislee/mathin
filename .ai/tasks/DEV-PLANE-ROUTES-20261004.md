# DEV-PLANE-ROUTES-20261004 · 两种路线的同台比较

- 场景分别为 `53-create` / grid-path v2 与 `54-create` / reflection-path v2，两种用途保持独立入口。新目录 `plane-route-workbench/`，导出 `createGridRouteState`、`createReflectionRouteState`、`isValidRouteState`、`planeRouteScenes`。
- 53：教师配置格网、起终点与候选路线；每条路线独立记录，第二路线可以复用第一条的边；保留有效已绘路线，修改范围对失效部分有明确处理。可标长度及比较最短路，不提前显示结论。
- 54：任意方向直线反射、A/B 与接触点可直接及准确编辑；同台保留多条候选进行总长比较，可开启镜像与最短路径观察，不把原 ±180°轴能力缩小。避免固定舞台边界造成某方向反射不可达。
- 复用统一宿主、撤销/只读/课堂，不另写交互平台。旧 v1 保持原可读版本。
- SQL `20261004030200_tool_plane_routes.sql` 只添加严格 `tool_plane_routes_state_is_valid(jsonb)` / `tool_plane_routes_scene_is_valid(jsonb)`；root 写总分发与类型。
- worktree 复用 `.worktrees/plane-grid-measure-deep-codex`。定向覆盖复用边、候选独立、可编辑起终点、任意轴、共线/退化边界、反射最短值、保存/课堂和历史；无 DB/服务/浏览器操作。
