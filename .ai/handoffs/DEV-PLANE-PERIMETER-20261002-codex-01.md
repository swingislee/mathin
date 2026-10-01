# DEV-PLANE-PERIMETER-20261002 · Codex 第 01 次交接

- 发出方 / 接收方：周长 worker / 本批 root 集成人。
- 目的：领域实现交付；附共用宿主只读复核。
- 关联任务卡：`.ai/tasks/DEV-PLANE-PERIMETER-20261002.md`。
- 代码 base：`4f9939250a10267a1d7a01e3ea2fda81a5eb9ab7`。
- 代码 head：`78ac2ae851dd327de2a880605928a6a9b9fe9673`。
- 分支 / worktree：`codex/plane-perimeter-deep-codex` / `.worktrees/plane-perimeter-deep-codex`。

## 行为与文件

- 新增 `plane-perimeter/model.ts`、`validation.ts`、`scenes.tsx`，输出 `planePerimeterScene` 与 `isValidPerimeterState`。
- `10-create` 可追加、自画矩形与简单凹凸多边形，复用构造模型的编辑点、增删点、长宽、复制、删除、移动和旋转。默认没有测量结论或编辑手柄。
- 绕边按真实累计长度推进；边界副本连续保长拉直、围回。原材料保留原位；下方比较区最多显示当前材料及另一份已开启边界，所有可见副本共用固定比例尺。更多材料和演示进度继续保存，点选材料即可查看。
- 复用原有按钮语义。对象旁引用 `perimeter` 操作、`construction-edit`、`construction-duplicate`，并使用相同侧栏终点。
- 新增 `tests/plane-perimeter.test.ts` 和独立 helper migration `20261002000100_tool_plane_perimeter.sql`；未修改总目录、共享模型、旧场景或 SQL 分发器。

## 精确合同与兼容

- 工具版本由集成人接为 `plane-perimeter-lesson-v2`；领域场景 ID 为 `10-create`。
- 保存构造状态的全部既有字段，`phase=0`；每个有效对象严格增加且仅增加 `walk.{id}`、`straight.{id}` 两个有限 `[0,1]` 参数。保留 16 对象、每对象 32 点、合计 192 点预算，仅允许直边对象且 `life=detail=0`。
- 新增、复制进度为零；删除清理对应参数；改点、加删点及尺寸调整只重置被改材料，刚体移动/旋转保留进度。过程帧由共用 presentation 按语义重建，暂停位置本身可精确序列化。
- `PERIMETER_UNIT=30` 舞台坐标对应 `1 u`，与共用参考网格一致；宽高字段和长度读数统一换算，保存仍用真实舞台点位。比较排版的采样及误差边界仅用于视口，不进入数学现场或周长计算。
- SQL 输出 `public.tool_plane_perimeter_state_is_valid(jsonb)` 和 `public.tool_plane_perimeter_scene_is_valid(jsonb)`；剥离并严格匹配演示参数后复用 construction helper，scene 外壳严格限制 toolId/version/title/长度，异常返回 false，四类角色执行权已撤销。只编写，未执行。
- 旧 10/12/13/43 及其 v1 数学模型保持；本增量不声称实现锁周长/锁面积变形或任意多边形并集。

## 验证

- `node node_modules/vitest/vitest.mjs run tests/plane-perimeter.test.ts`：23 项通过，Vitest 4.1.10；覆盖自绘、凹图形、输入拒绝、进度生命周期、预算、逐边保长、同尺对比、暂停继续、历史、序列化、缺少原生 randomUUID、旧 v1 与 helper 静态结构。
- `node node_modules/eslint/bin/eslint.js src/features/tools/plane-perimeter tests/plane-perimeter.test.ts`：通过。
- 使用仓库 TypeScript 配置，以 3 个领域源码和本测试为 rootNames、`incremental=false/noEmit=true` 的定向类型检查：0 diagnostics。
- 实际 staged diff 已核对，`git diff --cached --check` 通过，提交隐私 hook 通过（5 files）。
- 初次 `pnpm exec` 自动触发依赖检查/安装，并由非 TTY 删除保护中止；没有关闭保护或允许安装，后续直接运行现有依赖脚本。`node_modules` junction 保持指向主 checkout，未删除或替换。
- 本分支总 catalog/schema 尚未接入；完整保存、课件及课堂版本匹配由集成人接入后做定向验证。SQL 执行/回滚与真实页面人工视觉、触控手感未验证。

## 共用宿主只读复核

- 复核 commit：`54cf3efe3f914bcbab0ce053013a93cf911dc788`，未发现阻断项；复用 root 已报告的 47 项宿主/按钮检查，不重复运行。
- 快捷条解析原 action/operation，侧栏与就近条共用 execute/toggleOperation；只读及课堂展示端隐藏，忙碌/动画/非准确帧禁用；指针和点击不穿透，空白/Esc 取消本机选择；实际 SVG CTM 映射包含留白，无空位隐藏，不改数学状态。
- 新增宿主用例未单独断言快捷条 busy 状态，但实现复用了完整守卫；实际布局和手感继续由产品负责人验收。

## 下一步与状态

- 未提交修改 / 运行进程 / 资源占用：代码提交后工作树干净；仅本交接等待独立提交，无业务进程、数据库或端口占用。
- 接收方：复核并集成代码与交接，接 catalog/总 validator/scene registry/版本化课堂 provider/按钮清单，统一执行本机 SQL 对照验证。
- 产品人工验收：待开发端集成交付后进行。部署：未操作。Gate：不涉及。
- 接收确认：待接收；由集成人在原会话或新的接收记录中确认。
