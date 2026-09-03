# 前端、视觉与 Next.js 规则

> 读取条件：任务涉及 UI、路由、视觉、交互、页面数据边界或 Next.js 配置。产品与页面事实仍以 `../plan/00-overview.md`、`../plan/01-design-system.md`、`../plan/02-pages.md`、`../plan/05-planet-themes.md` 和当前专题文档为准。

## 技术与路由

- 基线为 Node.js 22（最低 20.9）、TypeScript 5、React 19、Tailwind CSS 4、next-intl、Supabase SSR、shadcn/ui。
- Next.js 固定稳定版 `16.2.11`；禁止升级到 16.3 canary/preview。
- 路由边界只使用 `src/proxy.ts` 的 `proxy` 导出；禁止新增已废弃的 `middleware.ts`、为 Proxy 配置 Edge runtime，或把 Proxy 当作授权层。
- `cookies()`、`headers()`、`draftMode()`、页面 `params` 和 `searchParams` 必须异步读取；页面 props 使用 `Promise<...>` 并 `await`。
- 路由均位于 `src/app/[locale]/`，URL 始终含 `/zh` 或 `/en`。站内跳转使用 `src/i18n/navigation.ts`，不用原生 `next/link` / `next/navigation`。
- Story、Games、Minds、Terms、Tools、Notebook 使用现行显式路由；`[section]` 只保留代码已承载的兼容入口。新增板块同时核对 Proxy/鉴权、导航、sitemap/SEO、registry 和双语消息。

## 双语与视觉

- 导航、表单、错误、空状态、通知模板和关键元数据必须同时维护 zh/en；英文正文未发布时必须有显式中文回退或未发布状态。
- 小王子视觉分三级：公开首页/五星球首页为场景级，内容/Notebook/身份页为内容级，Dashboard/Classroom/Whiteboard/Courseware Studio 为工作区级。工作区的信息密度、可读性和操作速度优先。
- Dashboard 默认是连续工作区：身份进入 `DashboardPage` / `ObjectBar`，筛选与操作进入 `DashboardCommandPanel`，正文进入无外框 `DashboardSection`，数据集合进入 `DashboardTableShell`，持续栏位只用结构线。
- 页面级与批量业务按钮只放 `DashboardCommandPanel` 的 actions／selection 槽；`DashboardTableShell` 必须直接从 shadcn `Table` 开始，不得在表格上方另造操作行。全选进入选择列的表头，逐列筛选／排序进入数据列表头，操作列与选择列不伪装成可筛选数据列；有纵向滚动的数据表保持表头固定。
- 普通标题、筛选、导航、表格、表单、摘要、空态和正文分组不得分别包 Card。只有产品明确要求，或对象确实需要独立搬运、选择、比较时可用 Card；产品已确认的 Card 是页面合同，不得被通用重构删除。
- 页面头只保留一条身份分隔线；section 不画上下边线；表格外框和行线只由 `DashboardTableShell` / Table 提供。禁止叠加分隔线或以 `border-y` 模拟卡片。
- 普通 section、栏位、导航、筛选集合和表格外层继承页面背景。背景色只表达已批准的独立表面、选中/状态、悬浮层可读性或课件画布底色。

## 组件与客户端边界

- 业务代码不得新增原生 `<input>`、`<select>`、`<table>` 等控件；优先复用 `components/ui/`，缺失时先检查 shadcn/ui。底层无障碍封装可以使用原生元素。
- 禁止 `window.confirm()`，也不得为单页重复手搓已有 badge、card、dialog、drawer、table 等组件。
- 页面、布局和区块默认是 Server Component。`"use client"` 只放在确实使用 hook 或 DOM 事件的交互叶子；白板、课堂实时、编辑器、three.js、游戏棋盘等整块交互体除外。
- 非首屏必需的重型客户端组件用模块级 `next/dynamic` 懒加载；变更客户端边界前后用 `pnpm bundle:report` 对比相关路由。
- 新增受保护/数据页时，将读取 `cookies()`、`searchParams` 或远程数据的动态子树放进 `<Suspense>`，或提供形状匹配的 `loading.tsx`；静态页头与导航留在边界外。
- 当前未启用 `cacheComponents`。禁止引入弃用路径上的 `unstable_cache`；正式缓存迁移须单独立项，在此之前写后使用 `router.refresh()`。

## Next.js 16 兼容清单

- Turbopack 是 `next dev` / `next build` 默认构建器；不加 `--turbo`，也不假定自定义 webpack 自动兼容。
- `next lint` 已移除，`next build` 不再执行 lint；使用 `pnpm lint`。
- SWR 场景使用 `revalidateTag(tag, "max")`；Server Action 需要 read-your-writes 时使用 `updateTag(tag)`。
- 使用 `next/image` 和 `remotePatterns`，不用 `next/legacy/image` 或 `images.domains`。本地图片 URL 带 query 时配置 `images.localPatterns.search`。
- 图片默认 `minimumCacheTTL` 为 4 小时、quality 仅 `[75]`、本地 IP 优化关闭、最大重定向 3 次，默认 `imageSizes` 不含 16；改动这些行为必须显式配置。
- 并行路由每个 slot 提供 `default.tsx`。需要旧平滑滚动行为时在 `<html>` 设置 `data-scroll-behavior="smooth"`。
- 不引入已移除的 AMP、`serverRuntimeConfig`、`publicRuntimeConfig`、`experimental.dynamicIO` 或 `unstable_rootParams`；缓存 API 使用稳定名称 `cacheLife` / `cacheTag`。

## 人工验收

- 自动化只证明覆盖到的合同，不替代视觉与交互手感。产品负责人未明确视觉通过前，不追加全量回归、跨浏览器、截图对比或发布 Gate。
- 可验收链接必须使用 `http://192.168.5.213:3130/...`；`localhost` 和 `127.0.0.1` 只用于 Agent 内部健康检查。
