# Motion Lab 一秒按钮图形修正

- 任务：DEV-MOTION-20261001；分支：`codex/motion-one-second-codex`。
- 用户反馈：1s 按钮不清晰，并明确要求以图形改善辨识度，不增加可见文字描述。
- base：`ffc0025f89dc4e644a8ca42a008eb0701dd0eb7e`（已接收的一秒功能与规则确认）；源码 head：`6cfc5e734ea73b1eb9de458278c11ea67cf4e22d`。
- 实现：中央数字「1」的秒表 SVG，20 px 图形、正文墨色，沿用原 30 px `SpatialIconButton`、无障碍名称及点击回调。`ApplyField.shortcut` 接收图标节点；帮助的既有首句与 README/CHANGELOG 按图形更新。
- 精确范围：MotionLab.tsx、NumField.tsx、README.md、双语 `tools.motion.allTimeHint`、CHANGELOG 原功能行。数学、输入来源、冻结场景与测试文件均保持已检查版本。
- 验证：2026-10-02 00:04 的 `motion-lab-interactions.test.ts` 13 项通过；两组件 ESLint 与 Motion Lab 定向 TypeScript 通过；diff 检查、任务范围核对及真实暂存六文件隐私 hook 通过。复用前一批数学与场景检查。
- 集成：仅接收本次源码及本交接增量即可；不重放前一批已接收提交。开发入口 `/zh/tools/motion-lab`，集成后由原会话核对开发资源。
- 状态：机器检查通过，待开发端人工视觉验收；没有数据库、生产、服务重启或 Gate 操作。
