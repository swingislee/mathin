# DEV-PERIMETER-VERTEX-20261004 · Codex 第 01 次交接

- 发出方 / 接收方：单顶点定量编辑实现者 / 本批集成人及独立只读复核者。
- 目的：实现交付；待接收与代码复核。
- 关联任务卡：`.ai/tasks/DEV-PERIMETER-VERTEX-20261004.md`。
- 代码 base：`c2c60955e74071759af1215f11d67ff43031a18b`。
- 代码 head：`45bda9ea43458a9f382d9437541be62ee2edb28e`。
- 分支 / worktree：`codex/perimeter-vertex-codex` / `.worktrees/plane-invariants-codex`。

## 行为与合同

- 新增明确操作 `perimeter-vertex-perimeter` / `perimeter-vertex-area`，双语名称为“定周长调顶点” / “Move a vertex at fixed perimeter”及“定面积调顶点” / “Move a vertex at fixed area”，复用 `editShape` 图标。面板复用原 `construction-measures` 开关。
- 直接抓圆柄，只改命中的一个编辑点；其余点、中心、方向、镜像及其他材料保持。面积沿邻点连线的平行线正交投影，周长沿真实焦点椭圆径向投影；共线极限沿线段，椭圆中心输入保留上一合法点。
- 按构造校验中的全部可变谓词生成解析临界事件：共线及两侧接触容差、端点包围盒、短边、折返点积、局部坐标、有向面积下限。逐区间及事件检查，在首次非法边界前停住；测试包含两端合法但中间只有极窄接触禁区的面积线及周长椭圆。
- 起拖几何冻结定量基准，`previous` 仅续接连续角方向；`bind` / `usePlanarDrag` 保持屏幕逆变换、阈值、取消、一次提交、撤销及课堂回执。没有逐帧权威写入。
- 矩形改一个点转成普通多边形；关闭 / 重复点击 / Esc 收起专用柄，恢复原普通编辑。主动开启的测量保留，整体拉伸与矩形变方形保留。
- 继续使用 `10-create` / `plane-perimeter-lesson-v2`，无新增持久字段、内容版本、数据库迁移、输入原语或跨操作永久锁。

实际文件：`plane-perimeter/vertex-model.ts`、`scenes.tsx`、`README.md`，以及 `tests/plane-perimeter-vertex.test.ts`、`tests/plane-perimeter-vertex-integration.test.ts`。共享 catalog / contract / controls / 旧集成测试由集成人维护，本分支未修改。

## 已执行的定向检查

工作目录为本 worktree，沿用仓库依赖与 Vitest 4.1.10：

1. `node ../../node_modules/vitest/vitest.mjs run tests/plane-perimeter-vertex.test.ts`：首批 14 项通过。
2. `node ../../node_modules/vitest/vitest.mjs run tests/plane-perimeter-vertex-integration.test.ts`：9 项通过，覆盖取消、失焦、丢捕获、第二触点、关闭与 Esc、撤销 / 恢复、冻结屏幕变换、只读、v2 保存 / 固定副本、课堂一次提交 / 回执 / 晚加入，环境去掉原生 `randomUUID`。
3. `node ../../node_modules/vitest/vitest.mjs run tests/plane-perimeter.test.ts tests/plane-perimeter-stretch.test.ts`：既有 57 项通过。
4. 新增最大规模输入后，仅运行 `node ../../node_modules/vitest/vitest.mjs run tests/plane-perimeter-vertex.test.ts -t 'handles 120 continuous previews'`：1 项通过，原 14 项复用已有结果。32 点材料分别连续执行 120 次定面积与 120 次定周长预览；每帧验证合法性和不变量。该用例本机 tests 耗时 148 ms，包含 240 次预览及断言，约 0.62 ms / 次的代表性均值；无硬毫秒断言，不代表浏览器完整帧预算或人工手感结论。
5. ESLint 精确覆盖上述四个 TS / TSX 文件，通过。
6. TypeScript compiler API 读取项目 `compilerOptions`，对上述四个文件运行 options / global / syntactic / semantic 诊断，结果为 0。首次发现三个新测试回调缺显式类型，已补齐纯类型注解；测试运行语义未改变。该检查不声称全仓类型 Gate。
7. `git diff --check`、`git diff --cached --check` 与 `node scripts/check-staged-secrets.mjs` 通过；提交保留 `.githooks/pre-commit`，真实暂存范围为 5 个本任务文件。

首轮 Vitest 因沙箱临时缓存重命名 `EPERM` 未启动测试，经批准在沙箱外运行同一窄命令通过。Git 暂存因 worktree index 权限阻断，经批准只暂存上述五个文件并提交；未绕过隐私 hook。

## 边界与接收动作

- 单点约束允许凹凸变化，但始终保留有向绕序、简单性、至少 1 单位边长、面积大于 1 及局部坐标 ±800 的原存档边界。目标越界时到首个合法侧边界；重复向被挡方向拖动保持该边界，反向可继续。
- 临界事件的接触容差与构造模型当前 `1e-7` 一致；未来若修改构造几何容差，应同步核对本领域事件阈值。
- 未提供新增精确点位输入面板；公开纯函数 `movePerimeterVertex` 与手势共用终点，可供后续准确参数入口复用。本批不扩展公共工作台字段合同。
- 独立代码复核、共享按钮目录与集成风险检查由集成人继续。没有启动 dev server，没有数据库连接、生产动作或浏览器自动化。
- 交接时除本交接单外无未提交修改，无运行中的任务进程或端口占用。代码尚在独立分支，开发主入口需集成后交付；视觉、手感、正式部署及 Gate 均未宣称完成。
- 接收确认：待接收；集成人可依据代码 head 及自己的接收记录确认。
