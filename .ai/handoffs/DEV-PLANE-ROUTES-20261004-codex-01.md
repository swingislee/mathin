# DEV-PLANE-ROUTES-20261004 · codex 第 01 次交接

- 发出方 / 接收方：`/root/plane_cell_coverage` → 本批集成人 `/root`，待接收及独立复核。
- 任务卡：`.ai/tasks/DEV-PLANE-ROUTES-20261004.md`。
- 代码 base：`ded33532ce6bad401ef4fc3828fe03cce6fabd8b`。
- 代码 head：`499eec78a16378455c3eb96043bee42e9e17f6e2`。
- 分支 / worktree：`codex/plane-routes-codex` / `.worktrees/plane-grid-measure-deep-codex`。

## 交付内容

- 新目录 `src/features/tools/plane-route-workbench/` 导出 `createGridRouteState`、`createReflectionRouteState`、`isValidRouteState`、`planeRouteScenes`；描述符分别为 `53-create` / `plane-grid-path-lesson-v2` 与 `54-create` / `plane-reflection-path-lesson-v2`。
- 53 支持 1～12 行／列、可直接及准确编辑起点 A／终点 B／必经点 W、封路、朝终点单向或四方向道路；最多 8 个独立候选、合计 480 个走访点，候选可复用道路。复制、切换、退一步、重走、移除和回放复用宿主。调整范围或条件保留有效前缀／新起点后的有效后缀，撤销恢复原现场。长度、逐点最短条数及一条最短路线由教师主动展开；最短计数使用包含必经点状态的 BFS。
- 54 支持任意 -180°～180°方向直线、A／B／线上基点 L 的直接与准确编辑、两点画线、最多 8 个独立接触候选以及总长比较。准确数学坐标与显示窗分离；全方向圆包络让任意方向的反射材料都可适合画面，不再绑定旧水平范围。镜像、最短位置与数值默认隐藏；同侧、对侧、线上及重合边界都有明确几何含义。
- 两个场景均使用同一宿主的绘制、选择、上下文按钮、准确字段、材料追加、动画、历史和只读模式。没有直接调用浏览器 `crypto.randomUUID()`。
- SQL `20261004030200_tool_plane_routes.sql` 只增加两个 private helper：`tool_plane_routes_state_is_valid(jsonb)` / `tool_plane_routes_scene_is_valid(jsonb)`。固定 search_path，严格字段／canonical ID／封路掩码／连续走访／方向合同，并回收 PUBLIC、anon、authenticated、service_role 直接执行权限。标题校验按 JS trim 和 UTF-16 长度处理。
- `planeRoutesCases()` 提供新旧版本、共享边、最大格网／候选／走访容量、任意角度、精确边界、缺字段／坏类型／越界／孤儿／断路／错误版本及标题边界 fixtures。领域 README 说明使用、数学含义和边界。

## 共享接线

- root 负责 catalog 新建版本与旧 v1 保留、contract validator、scene-registry、控制清单、SQL 总分发／catalog、生成类型及本地数据库检查。本次没有改共享旧源码。
- 两种入口的模型与描述符通过 `index.ts` 或分别从 `model.ts`、`validation.ts`、`scenes.tsx` 导入。
- 两个用途各自独立版本，旧 53／54 不能作为新 v2 材料保存，新状态也不能冒认 v1；`tests/plane-routes-integration.test.ts` 的 2 项检查待共享接线后执行。
- `tests/fixtures/plane-routes-cases.ts` 的工厂使用标准 `{ label, accepted, scene }`，其中包含真实旧 v1 accepted fixtures。helper 自身只接纳 v2，旧版 fixtures 应走总分发。

## 已运行检查

- 复用现有 Node 22.16.0 / Vitest 4.1.10 / TypeScript 5.9.3 / ESLint 9.39.4，无依赖安装。基线 pnpm 入口试图获取未缓存版本失败后，按 root 同意使用已有 Node 入口；工具链升级留给集成人。
- `node node_modules/vitest/vitest.mjs run tests/plane-routes.test.ts`：最终 **45 项通过**，包括模型、描述符显隐、context action 解析、所有动作／材料／开关终点合法、准确回放／撤销和缺少 randomUUID。Vitest 临时缓存需 Windows 权限，因此获准以相同命令执行；未改变缓存／权限规避限制。
- `node node_modules/eslint/bin/eslint.js src/features/tools/plane-route-workbench tests/plane-routes.test.ts tests/plane-routes-integration.test.ts tests/fixtures/plane-routes-cases.ts`：通过。
- Node 内存 TypeScript program 读取仓库 tsconfig，根入口为新目录 index、两个测试和 fixture，`incremental:false` / `noEmit:true`：**任务和依赖均 0 诊断**。
- `node scripts/agent-context.mjs --task DEV-PLANE-ROUTES-20261004`：分支、全部改动归属通过。
- `git diff --cached --check` / `node scripts/check-staged-secrets.mjs`：通过；提交保留 hooks，再次确认 11 个实际暂存文件通过隐私扫描。

## 边界与状态

- 网格部分路线是合法探索材料，不要求每一候选都已到 B 或经过 W；最短条数明确不是包含任意绕行的全部走法数。
- 反射点位范围 ±1000 u，接触有向距离 ±5000 u。拖动保持起拖观察窗，准确字段／追加及主动“适合画面”重设观察窗；数学材料保持独立。数值标签使用近似符号，不声称显示舍入值为精确值。
- 未运行共享版本 integration、SQL、保存回读或数据库类型生成；这些属于 root 的统一集成范围。本次未连接数据库、启动／重启服务、调用浏览器或 Playwright，未操作生产。
- 代码提交后工作树干净，无后台进程；本交接是独立文档提交。状态为源码及机器检查已交付，独立复核／共享集成／开发端交付及人工教学手感验收待完成，未关闭 Gate。
