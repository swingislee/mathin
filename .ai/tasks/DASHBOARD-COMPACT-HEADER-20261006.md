# Dashboard 紧凑页头

## 当前交付

- 产品负责人要求参照 Claude 最新会话的单行页头讨论，直接修改 DashboardPage 外壳。
- 标题、视图标签、主操作与两侧悬浮入口安全区共用首行；根据真实控件尺寸把放不下的筛选移到下一行，响应侧栏宽度和异步内容变化。
- 返回入口收进标题旁，说明使用信息弹层，元信息进入只读摘要。沿用业务命令槽位及其挂载状态，对象工作区保持原有外壳。
- 本批文件：`src/features/school/dashboard-page/DashboardPage*`、`DashboardBackLink.tsx`、`docs/design.md` 与本任务卡；未修改其他任务文件。

## 检查与验收

- 受影响 TSX 的 ESLint 与 `git diff --check` 通过。
- 全库 TypeScript 检查对本批文件无诊断，但仍有 6 条其他文件诊断：DashboardShell 的 Button ref 类型 2 条、ParentRegistrationSettings 的错误字段 3 条、request-body-limits 测试的 RequestInit 类型 1 条；全库类型检查未通过。
- 本机 3130 服务可响应；未登录请求正常进入登录页。未运行浏览器自动化，未进行生产部署。
- 开发入口：<http://192.168.5.213:3130/zh/dashboard/schedule>；请在常用笔记本上确认首行、筛选换行及正文可用高度，也可切换班级和学服页面确认共享效果。
