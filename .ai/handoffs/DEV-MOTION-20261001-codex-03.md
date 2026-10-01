# DEV-MOTION-20261001 · 首行工具栏

- 用户授权：2026-10-01 要求精简并统一行程工具首行，参考微课编辑区与 3D 工作区；补充要求常用批量设置保留直接录入。
- 分支：`codex/motion-ruler-codex`；base：`a743aa51078c4d3c83c6b0cf786c8325fbc76489`；代码 head：`745adf8f4ca29438561d16a2cb6d08e7ab83a602`。
- 状态：实现和定向检查完成，待当前集成人登记范围并接收；尚未进入主 checkout 的开发页面，人工视觉验收待完成。
- 独占改动：`src/features/tools/motion-lab/MotionLab.tsx`、`NumField.tsx`、`README.md` 和 `tests/motion-lab-interactions.test.ts`；共享改动仅为 `messages/zh.json`、`messages/en.json` 各一个 `tools.motion.help` 词条，以及 `CHANGELOG.md` 一行说明。
- 首行直接复用 `SpatialIconButton`，统一图标、悬停名称、选中与禁用态；测距尺改为按钮开关。全程、计时、统一时间、统一速度保持常显，输入支持回车或确认图标。长说明收进帮助浮窗，Esc 关闭并返回触发按钮。
- 模型、场景保存、播放、求解、长按、角色拖动和测距逻辑保持现有实现；未改空间工作区或微课按钮基础组件。
- 检查通过：行程交互 8 项、既有数字教具场景 4 项、相关 ESLint、本组件及依赖的定向 TypeScript 检查。提交时实际暂存 7 个文件通过隐私 hook。最后只针对确认图标点击路径重跑受影响用例，结果通过。
- 全库 `tsc` 报 `tests/agent-coordination.test.ts` 的 4 处既有 `taskId` 类型错误（97、105、106、117 行）；该文件和协作脚本均未修改。定向配置保存在忽略的 `.tmp/motion-toolbar.tsconfig.json`。
- 没有浏览器自动化、生产操作、数据库写入或服务重启。接收前核对 `main` 工作树与 index；共享消息和 CHANGELOG 按本提交范围集成，复用已通过的窄检查。
- 人工验收：开发端查看首行统一样式；直接录入统一时间／速度并回车或点击确认；切换尺子、增减跑道、播放／暂停／回到起点；打开帮助再用 Esc 关闭。交付入口为 `http://192.168.5.213:3130/zh/tools/motion-lab`。
