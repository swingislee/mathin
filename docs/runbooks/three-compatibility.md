# 全仓 Three 运行兼容

> 2026-09-15：开发端已交付，待人工视觉与交互验收。覆盖当前全仓自研 3D 运行链，不改变生产状态、课堂协议或冻结资源。

## 覆盖范围

| 画布入口 | 消费范围 | 渲染与阴影 |
| --- | --- | --- |
| `galaxy-scene.tsx` | Terms 知识星系 | 连续帧，关闭阴影 |
| `planet-scene.tsx` | Terms 星球与岛屿 | 连续帧，关闭阴影 |
| `VoxelCanvas.tsx` | 体素、立方体结构；工具、课件编辑及课堂共用 renderer | 按需帧，关闭阴影 |
| `PolyhedronFoldCanvas.tsx` | 多面体、正方体展开与剪棱 | 按需帧，关闭阴影 |
| `DiceTeachingCanvas.tsx` | 骰子教学 | 按需帧，PCF 阴影 |

独立工具与 `/embed/spatial-lab` 共用上述入口。`src/lib/three-runtime.ts` 提供纯配置 `THREE_SHADOWS`，全部画布显式选择关闭或 PCF；不增加画布包装层，也不改变原有阴影启用范围。

## 兼容处理

- 当前业务源码没有直接创建 Three Clock。计时由共用 Fiber 提供，既有补丁在 ESM、CJS 开发和生产构建统一使用 Timer，并保留 Fiber 9 的公开时钟及手动帧合同；Terms 与 Drei Stars 的累计时间读取继续有效。
- Fiber 的布尔阴影默认值、`soft` 别名和旧对象参数统一归一为 `PCFShadowMap`。重新配置时同样生效，`BasicShadowMap`、`VSMShadowMap`、关闭阴影和更新标记保持原语义。
- 精确固定已验证的 Three 0.185.1、类型 0.185.0、Fiber 9.6.1、Drei 10.7.7。没有升级实际安装版本；锁文件保存补丁 hash，并验证应用、Drei、Fiber、three-stdlib 共用同一 Three 实例与同一已修补 Fiber。
- 已核对自研 `src`、`scripts` 与 `public` 内联脚本，以及实际使用的 OrbitControls、Line、Html、Stars、纹理等依赖路径。未接入的库示例／可选类不是当前运行消费者；引入新 3D 依赖时应补对应运行测试。历史说明、第三方库定义和测试负例中的旧名称不等于运行时调用。

Three 官方迁移说明要求用 Timer 替代 Clock，并将 WebGL 软阴影迁移至已有柔化效果的 PCF，参见[迁移指南](https://github.com/mrdoob/three.js/wiki/Migration-Guide)。具体兼容层与回退方法见[补丁说明](../../patches/README.md)。

## 验证与后续维护

- `tests/three-repository-compatibility.test.ts` 扫描交付源码中的 Clock／旧阴影调用及别名，登记全部 Canvas 入口、统一配置和渲染模式，核对精确版本与依赖实例一致性；随常规 Vitest 自动执行。
- `tests/react-three-fiber-timer.test.ts` 直接加载三种构建验证真实 Fiber 根：自动启停、重启、独立时钟、共享帧 delta、手动 advance、按需空闲恢复，以及所有阴影参数的连续重配。
- 上述检查、相机与教学动画、体素／多面体和课堂只读接入合同均通过；全仓 TypeScript 和本次受影响 ESLint 检查通过。复用开发进程，Terms 星系／星球、空间实验室与嵌入页的 zh/en HTTP 检查成功，实际交付模块包含新兼容配置。
- 机器检查不替代视觉验收。未运行生产部署、数据库变更、全量发布构建或正式 Gate。当前已冻结课件及外部 H5 保持原资源与版本，不做批量改写。

以后升级 Three／Fiber／Drei 时，将四项版本、兼容补丁、Canvas 清单及上述检查作为一组复核。新增画布需要登记其渲染模式和阴影需求；原关闭阴影的页面继续保持关闭，启用阴影使用统一 PCF 配置。
