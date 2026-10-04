# DEV-PLANE-ROLLING-20261005 · 圆对同台与双向连续滚动

- 在持续目标和明确并行授权内，补齐已批准 55 的开放材料与连续操作；35／26 的历史暂缓范围保持。
- 新目录 `plane-rolling-workbench/`，`55-create` / `plane-rolling-lesson-v2`；导出 `createRollingWorkbenchState`、`isValidRollingWorkbenchState`、`planeRollingWorkbenchScene`；fixture `planeRollingCases()`。旧 55/v1 及旧 plane-motion 不改。
- 同台最多四组独立圆对，各自圆心、固定圆和滚动圆半径、内外模式与有符号累计绕行角。当前圆对可移动、追加、复制、移除；准确参数接受合法小数。内滚与外滚按真实无滑动公式派生圆心、自转、接触点与轨迹。
- 直接滚动冻结当前圆心，跨 ±180° 连续计角；从起点可反向，经过预设一圈可继续。本次播放角度相对当前位置，过程中保持刚性与实际路径；一手势一撤销，暂停／继续与准确终点使用共享宿主。
- 数值、圆心轨道、连线和轨迹默认关闭，按需独立观察；自转标记半径是材料的一部分。派生轨迹与几何不重复保存为可伪造答案。
- worker 独占登记的新目录、两份测试、夹具、`20261004031600_tool_plane_rolling_workbench.sql` 及交接。helper 前缀 `tool_plane_rolling_workbench_`，严格 state/scene、私有权限与现有 trim／UTF-16 title 语义。root 负责 0317 分发与共享接线、类型和开发库。
- 复用干净 `.worktrees/plane-grid-measure-deep-codex`，保留运动分支，从登记后的 main 创建 `codex/plane-rolling-workbench-codex`。不修改旧模型或共享宿主，不连接 DB、生产、服务或浏览器。
- 按实际增量检查无滑动、跨圈／反向、独立材料、精确参数及保存边界。开发可用与人工教学验收分别记录；全范围审计发现的宿主数字框问题由 root 另行处理。

2026-10-05：领域 `f1038473`、默认正零修正 `1c8264b7`、共享接线 `1bbd4425` 已集成main。35项领域结果复用；7项真实宿主／版本检查通过，覆盖反向与多圈、一手势一撤销、取消、精确半径、观察保留、准确暂停继续、只读与课堂回执。52项保存夹具在本机TS/SQL通过，0316/0317已安装，仅合入2个实际生成helper类型。zh/en开发入口可启动；人工教学手感待确认，生产未发布。
