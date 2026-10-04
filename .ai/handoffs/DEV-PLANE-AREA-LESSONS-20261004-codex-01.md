# DEV-PLANE-AREA-LESSONS-20261004 · Codex 第 1 次交接

- 发出方 / 接收方：面积课程实现者 / 本批集成人。
- 目的：实现交付，待独立复核与共享接线。
- 关联任务卡：[面积剪拼教学能力](../tasks/DEV-PLANE-AREA-LESSONS-20261004.md)。
- 代码 base / head：`ded33532ce6bad401ef4fc3828fe03cce6fabd8b` / `9791365dee60a1c679984e3c548fa68f136319f1`。
- 分支 / worktree：`codex/plane-area-lessons-codex` / `.worktrees/plane-invariants-codex`。

## 本次行为与文件

- `src/features/tools/plane-paper-lessons/` 新增几何、状态与场景。原自由绘制、直线剪刀、纸片材料、边与编辑点保留；同台可加至 4 组课堂材料，组内每片独立拖动与绕当前世界坐标支点旋转。全台真实纸片共用 16 片 / 192 顶点预算。
- 14 从当前平行四边形及当前边确定底边，可改用相邻边；大倾斜按真实高度逐刀切分，搬动后继续切仍继承原片姿态，完整剖分后刚性拼成长方形。
- 15 / 16 从实际三角形 / 梯形复制第二片并半周转拼摆；底、高、偏移和上底来自当前材料且可修改。
- 17 按已确认范围支持六顶点正交缺角原图，提供两种分割、独立补入材料、原图 / 补入 / 合计面积；任意自由凹多边形仍沿用原剪刀。未宣称通用凹多边形补形布尔工作流。
- 46 以一片三角形和两片不全等梯形分成三份等面积；解除约束后可移动斜切线，面积按真实各片重算。恢复约束时回到等面积位置。
- 58 从当前直角三角形生成同一组四片，在同一外框中依次刚性重排成中央余白和两块余白布局；自由搬出或重叠时，当前余白按外框实际差集计算。
- 每组可解组为当前姿态的普通纸片，随后继续自由剪切、编辑、镜像；组操作只处理当前组，其他材料保持。辅助线、面积与结论默认不显示。尺寸和面积统一为 30 舞台坐标 = 1 u。
- `supabase/migrations/20261004030100_tool_plane_area_lessons.sql` 仅新增严格 helper 及撤销直接执行的 ACL；没有总分发、业务数据、RLS 或服务操作。
- 两份测试和 `tests/fixtures/plane-area-lessons-cases.ts` 覆盖几何不变量、场景接口、真实材料保留、参数 / 姿态、刚性帧与严格输入。

## 合同与接线

- 新版：`plane-area-lesson-v3`；新场景：`14-lessons`；旧 `14-create` 与 v1 / v2 源文件未改。
- `model.ts` 导出 `createAreaLessonState`、`isValidAreaLessonState`；`scenes.tsx` 导出 `planeAreaLessonScene`。
- SQL 导出 `tool_plane_area_lessons_state_is_valid(jsonb)`、`tool_plane_area_lessons_scene_is_valid(jsonb)`；几何辅助函数也在同一迁移内，全部保留私有执行边界。
- fixture factory：`planeAreaLessonCases()`，每项 `{ label, accepted, scene }`。包含合法六类参数化几何、容量边界、旧版错配、未知键、错误类型、假关系与动画投影等。
- `lessonFrame` / `lessonCutFrame` 是绘制中间帧字段；领域 `isExact` 返回 false，严格保存校验拒绝。准确动画端点与原始材料分别完整保留；14 切线仅在一刀完成后才提交新分片。
- 根接线范围：catalog、contract、scene-registry、工具注册 / inventory、runtime、SQL 总分发及实际生成类型；本提交不碰这些共享文件。

## 检查与边界

- Node `v22.16.0`，Vitest `v4.1.10`。
- `node ../../node_modules/vitest/vitest.mjs run tests/plane-area-lessons.test.ts tests/plane-area-lessons-integration.test.ts`：26 项通过，最近一轮覆盖切线追踪与选边映射的最终代码。
- 定向 ESLint：新目录、两份测试、fixture 全通过。
- TypeScript Compiler API 以新 scene 和三份测试 / fixture 为根，仅核对本任务诊断：无诊断；未把全库检查当作本任务通过证据。
- `git diff --cached --check` 与 `node scripts/check-staged-secrets.mjs`：通过，7 个已暂存文件；提交 hook 保持启用并通过。
- 当前检查证明领域数学与场景接口合同；共享 v3 保存 / 课堂回放、SQL fixture 对照由根接线后补。未启动浏览器、开发服务或数据库连接，也未执行迁移。
- 未提交改动 / 运行进程 / 共享资源：代码提交后工作树干净；本单单独提交；没有遗留服务或后台检查。
- 未决问题：等待根进行独立复核、共享接线与本地 SQL / 保存合同对照；发现问题仍由实现者修复。
- 人工验收 / 部署 / Gate：未人工验收，未部署，未关闭 Gate；本提交仅为待集成的实现增量。
- 接收方下一步：复核 `9791365d`，按需 cherry-pick 代码和交接提交，补共享接线验证，再统一交付开发页面。
- 接收确认：待接收；由集成人记录原会话确认与复核结论。
