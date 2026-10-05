# DEV-PLANE-AREA-LESSONS-20261004 · 面积剪拼教学能力

- 同台保留教师材料；当前 v2 自绘/剪刀/拼摆能力继续可用。新 v3 补齐 14/15/16/17 的准确分割转化、原图/补入材料比较、46 等面积约束与解除后观察、58 同一外框中同四片的两种真实排列及余白比较。
- 新场景 `14-lessons` / `plane-area-lesson-v3`。新目录 `plane-paper-lessons/`，导出 `createAreaLessonState`、`isValidAreaLessonState`、`planeAreaLessonScene`。复用既有纯几何与共享宿主，旧 `14-create`、旧 legacy 场景不变。
- 教学操作附着当前材料或添加可操作材料，允许多个材料同台；不回退顶部切换模板。精确操作给真实分片/刚性运动和面积守恒，中间动画不是最终保存状态；默认不显示结论。
- SQL `20261004030100_tool_plane_area_lessons.sql` 提供严格 `tool_plane_area_lessons_state_is_valid(jsonb)` / `tool_plane_area_lessons_scene_is_valid(jsonb)`，TS/SQL 接受边界一致。root 写总分发、共享目录、集成和实际类型。
- worktree 复用 `.worktrees/plane-invariants-codex`。定向测试覆盖各获批操作、数学不变量、参数极端、手势、课堂/保存和旧版隔离；不连接 DB 或启动服务。
- 先提交实现与领域测试，再提交交接。教学操作若不能在本批安全完成，准确列未完成项继续同任务推进，不把普通剪刀原语当作已完成全部教学闭环。

交付：代码 `9791365d` 已集成 main `74d602e0`；新建入口与本地保存合同已接通，26 项领域结果复用，共享合同及 SQL 对照通过。开发端待人工教学手感确认，生产未变更。
