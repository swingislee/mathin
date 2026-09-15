# 依赖兼容补丁

## React Three Fiber 9.6.1 的 Timer 兼容

2026-09-15 经产品负责人明确授权应用。`@react-three/fiber@9.6.1` 初始化根状态时仍创建 `THREE.Clock`，而本项目锁定的 Three 0.185.1 会为此输出弃用提示。[Timer 官方说明](https://threejs.org/docs/pages/Timer.html)明确两者 API 与行为不同，因此本补丁保留 Fiber 9 的时钟合同，仅由 Timer 负责底层时间差计算。

- `@react-three__fiber@9.6.1.patch` 只修改 ESM、CJS 开发版和 CJS 生产版三个 `events` 构建中的时钟创建点；Web 与 native 入口共用这些构建。
- 保留 `start/stop/getDelta/getElapsedTime`、自动启动、可写 `elapsedTime` 与 `oldTime`，以及 `setFrameloop` 和手动 `advance` 的现有行为；公开类型仍兼容 `THREE.Clock`。
- 继续由现有 Fiber 帧循环调用时钟，未新增动画循环、事件监听或浏览器可见性策略。按需渲染后的首帧仍包含空闲时间差；应用已有的动画限步逻辑保持不变。
- 不覆盖全局 Three 类、不拦截 `console.warn`，也不修改应用里的教学动作、物理结果或持久数据。其他依赖版本保持原锁定值。

`pnpm-workspace.yaml` 登记精确包版本与补丁路径，`pnpm-lock.yaml` 登记补丁 hash；正常锁定安装会应用同一补丁。升级 Fiber 或 Three 前，先检查上游是否已经迁移时钟，再更新或撤除这项兼容层与对应测试；不要把旧补丁直接套用到其他版本。

验证入口：`pnpm test -- tests/react-three-fiber-timer.test.ts`。该测试直接加载三个实际构建并创建 Fiber 根，覆盖无弃用告警、启动与停止、重启归零、手动帧、共享帧 delta、独立画布及按需渲染。关联相机、立方体、展开图与骰子动画测试另行按受影响范围运行。

回退时同时撤回本补丁、两处包管理登记及依赖本补丁的测试，然后按恢复后的锁文件安装；应用源码与教学场景格式无需迁移。此操作属于开发依赖回退，不替代生产发布授权与流程。
