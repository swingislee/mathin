# DEV-PLANE-POLYGONS-20261004 · 三角形与四边形同台建构

- 用户持续目标覆盖全部现有平面工具，已授权并行。按现行教学规范提供有用起点、自建材料与同台观察；原获批 06/07/08 在归档审核意见中保持范围。
- 新目录 `plane-polygons/`，场景 `06-create` / `plane-polygons-lesson-v2`，导出 `createPolygonWorkbenchState`（model.ts）、`isValidPolygonWorkbenchState`（validation.ts）、`planePolygonWorkbenchScene`（scenes.tsx）。root 负责共享目录/合同/注册/分发。
- 06：可添加独立小棒、三棒闭合关系与四边活动框架；长度可准确调整、直接操作，同一舞台保留多组。三角形可行/不可行情形真实表达，不把不等式用假闭合画出来。
- 07：自绘或添加任意合法三角形，选择当前材料拆出三个真实角并按连续刚性旋转/平移拼成平角，原三角形参照保留；不只演示唯一固定示意图，不默认展示结论。
- 08：三角形、任意简单四边形及矩形/正方形/平行四边形/菱形/梯形的准确材料，参数和直接操作保持相应约束；任意方向、选不同底及真实高可主动观察。家族名称按真实几何或明确约束，变成自由形状须显式。
- 使用共享材料盘、绘制/点编辑、精确参数、对象旁动作、HeightMark、语义动画/只读/历史/课堂；多个材料累计，不做顶部全场替换模式。
- SQL `20261004030400_tool_plane_polygon_workbench.sql` 只新增 `tool_plane_polygon_workbench_state_is_valid` / `tool_plane_polygon_workbench_scene_is_valid` 及私有 ACL。状态严格字段、数量与TS一致；提供 `planePolygonWorkbenchCases` fixtures。root 负责 0305 总分发和本机安装。
- 旧版06/07/08继续按v1读取，不修改巨大 legacy scenes.tsx 或共享构造。必要检查按本次几何与持久边界选取，不跑全量、不连接DB、不启动服务、不用浏览器替代人工验收。
- 复用 `.worktrees/plane-relations-deep-codex` 新分支。小切片可各自提交，完成后留简短交接与真实剩余项。
