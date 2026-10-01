# DEV-PARENT-WECHAT-20261001 · 底栏图标与家长页布局修复

- 发出方：小程序任务；接收方：当前家长端集成人。任务卡：`.ai/tasks/DEV-PARENT-WECHAT-20261001.md`。用户本轮反馈为三个底栏图标破图及家长页排布异常。
- 源码 base / head：`c06e8cd8e0ea2e05b2631893fe9af36f9989544a` / `5dab892d4e2471d858c24e82f80f62c0508c3631`。分支：`codex/parent-wechat-discovery-codex`；工作区：`.worktrees/parent-wechat-discovery-codex`。本轮只接收上述源码提交及本交接。
- 家长页布局：微信 `style: v2` 默认按钮宽度与自动外边距覆盖了原选择器。补丁对家长页对应容器提高选择器权重并明确宽度、外边距、内边距与 flex，恢复顶部双卡片、四个预约状态入口、课程服务四列和常用工具四列。
- 底栏图标：六张包内 PNG 均可由微信图片接口读取；同图通过开发工具原底栏文件路径显示破图，改为内嵌数据后显示正常。具体底层 HTTP 故障未作断言。补丁仅在 `getDeviceInfo().platform === "devtools"` 时设置相同 PNG 的内嵌版本，真机沿用原 `app.json` 包内路径，保留三个原生 tabBar 的标签和导航。
- 变更范围为 `app.wxss`、`lib/page.ts`、`assets/tabs/simulator-icons.ts`、`tests/parent-foundation.test.ts`。没有改动页面业务、共享 API、数据或真机图标资源。生成的内嵌图标与对应 PNG 由测试逐字节校验。
- 定向检查通过：小程序 TypeScript、相关测试 TypeScript、受影响测试 ESLint；`parent-foundation` 与 `parent-wechat-discovery` 合计 29 项测试；`git diff --check`；提交钩子实际扫描 4 个暂存文件通过。
- 原生诊断：重开本任务微信项目使新增模块进入文件索引；家长页三个图标显示正常，服务与工具各为四列，`grep -i error` 无匹配。服务项从默认 184 px / 自动外边距恢复为容器四分之一宽度。取证文件仅保留在已忽略的 `.tmp/`，不提交界面个人数据。
- 状态：机器检查通过、开发工作区可验收；视觉效果仍由用户在原生页面验收。没有关闭阶段或正式 Gate。
- 接收方下一步：复核并串行接收本轮源码与交接，更新任务登记及故障修复说明；重开集成小程序项目刷新新增模块索引，并停留家长页供用户验收。沿用已经核准的本地集成授权。
- 未提交修改 / 进程：源码已单独提交；本交接另行提交。未新增常驻服务，既有开发服务和忽略的私有配置沿用。
- 接收确认：待接收方在已获授权沟通的原会话确认。
