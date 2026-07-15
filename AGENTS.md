# Mathin 工程约定

Mathin 是一个中英双语（zh/en，中文为默认语言）的数学探索网站。本文件是 Claude Code 与其他 Agent 工作时的权威工程约定，涵盖技术栈、架构与 Next.js 16 迁移要点。

## 开始任务前的必读文档

所有实现任务：

- 阅读 `docs/plan/00-overview.md`。
- 阅读 `docs/plan/04-roadmap.md`，确认当前阶段，不得抢跑。
- 阅读与当前任务直接相关的规划文件，不要默认读取整个 `docs/plan/`。

按任务类型补充阅读：

- UI、视觉、交互：`01-design-system.md`
- 页面布局与路由：`02-pages.md`
- 数据库、鉴权、RLS、registry：`03-data-and-tech.md`
- shadcn/ui 组件选择：`01-design-system.md` 的“§6 shadcn/ui 能力目录”
- 历史 UI 债务迁移：读取 `14-...md` 的“§6.5”，仅在相关任务中读取




## 技术基线

- Node.js >= 20.9（当前开发环境 Node.js 22），TypeScript >= 5.1，pnpm。
- **Next.js 锁定稳定版 16.2.10**（App Router、React 19、Turbopack 默认构建器）。禁止使用 16.3 canary/preview。
- Tailwind CSS 4、next-intl、Supabase SSR、shadcn/ui（`components.json`）。
- 无测试套件。需要 `.env.local`（从 `.env.example` 复制），填入自托管 Supabase 的 URL 与 publishable key。
- 路由边界逻辑写在 `src/proxy.ts`（导出 `proxy`），**禁止新增 `middleware.ts`**——它在 Next.js 16 中已废弃。

### UI 组件约束

- 页面、业务组件和功能模块中不得直接新增原生 `<input>`、`<select>`、`<table>` 等控件。
- 应优先使用项目已有的 `components/ui/` 组件；缺失时先检查 shadcn/ui 是否提供对应组件。
- shadcn/ui 基础组件或底层无障碍封装内部可以使用原生 HTML 元素。
- 禁止在业务代码中使用 `window.confirm()`。
- 禁止为了单个页面重复手搓已有的 badge、card、dialog、drawer、table 等组件。

### 客户端边界（Server / Client Components）

- 新增页面、区块、布局**默认是 Server Component**。数据获取、鉴权、静态壳留在服务端。
- `"use client"` 只允许出现在**确实使用 hook（`useState`/`useEffect`/`useRef` 等）或 DOM 事件**的组件上；不允许标在页面级/区块级容器上（除非整块本身就是交互体，如白板、课堂实时、BlockNote 编辑器、three.js 星系、游戏棋盘、磁贴拖拽）。
- 边界要**向下推到叶子**：整页里只有一个按钮/一个开关需要交互时，把那个交互抽成独立的 client 叶子组件，让页面壳保持服务端渲染，而不是给整页标 `"use client"`——后者会把整页的 JS 白发给浏览器、拖慢首屏。
- 重、且非首屏必需的 client 组件用 `next/dynamic` 懒加载（参考 `src/features/games/boards.tsx`、`src/features/tools/components.tsx`：模块级 `dynamic()` 常量 + switch 分发，避免 `react-hooks/static-components` 把查表判成渲染期建组件）。
- 量化基线：`pnpm bundle:report`（`scripts/bundle-report.mjs`）给出每路由 gzip JS 体积排名，动边界前先量、动完再量对比。

### 动态数据的 Suspense 就绪（为将来 cacheComponents 预付）

- **新增受保护/数据页：把读请求期数据（`cookies()`/`await searchParams`/远程查询）的动态子树包在 `<Suspense>` 里，或给该路由配 `loading.tsx`**（形状对得上的骨架，参考 `src/features/school/list-skeleton.tsx` 与后台各 `loading.tsx`）。首屏静态壳（页头、导航、标题）留在 Suspense 之外先出。
- **为什么现在就要**：本项目当前**刻意未启用 `cacheComponents`**（见下「Next 16 破坏性变化」）。将来若做 `use cache` 全量迁移（规划 doc 15 §4 的 P4G-6b），主要工作量正是给每个读 `cookies()` 的页补 Suspense 边界。新页写的时候就带上边界＝把那一份迁移成本**预付**掉，让这笔债保持持平而非随页数增长。这是「暂缓大迁移」成立的前提。
- **禁止**为了缓存去用 `unstable_cache`——它在 Next 的弃用路径上（将由 `use cache` 取代），本项目不引入任何计划移除的 API。需要缓存时走 `cacheComponents` + `use cache`（届时单列迁移任务），在那之前只读页保持每请求动态、写后用 `router.refresh()`。

### Server Action 入参校验

- Server Action 的入参必须过 zod schema，禁止把 `String(...)` / `Number(...)` / `Date.parse` 这类手写 coercion 散落在 action 体内。RLS 挡越权，挡不住合法用户提交负数金额、超长文本、非法枚举与 NaN。
- schema 与 action 同文件放置；共享原语在 `src/features/school/actions/schemas.ts`（金额、文本上限、日期、uuid）。
- 校验失败一律返回 `{ ok: false, code: "VALIDATION" }`（`parse()` 抛 `VALIDATION`，由 action 的 catch 转成 `ActionResult`）。UI 侧无需逐个声明该码的文案，`useAction` / `ActionForm` 已兜底成 `common.invalidInput`。
- 只拒绝畸形输入，不在校验里顺手改业务规则。搜索串一类不入库的入参用截断而非拒绝。

## 常用命令

```bash
pnpm dev        # 开发服务器 0.0.0.0:3130（局域网：http://192.168.5.213:3130）
pnpm lint       # eslint . —— Next.js 16 的 next build 不再执行 lint
pnpm typecheck  # tsc --noEmit
pnpm build
```

## 测试账号

自托管开发库上已存在一套固定的 5 个可复用测试账号（admin / teacher / sales / student / parent，均为 `@mathin.local`），角色/staff_role_members/学生档案/监护人关联均已预绑定。凭据与 ID 见 `.claude/test-accounts.local.md`（已 gitignore，不在仓库中，需要登录或模拟这些用户时读取该文件）。**所有人工/agent 测试复用这套账号，不要新建。** 如果任务确实需要新账号或不同账号（如测试未认领的绑定码流程、多子女家长、越权场景），先向用户确认。

## 架构

### 路由 / 国际化

每个路由都在 `src/app/[locale]/` 下，URL 始终带 `/zh` 或 `/en` 前缀（`src/i18n/routing.ts` 中 `localePrefix: "always"`）。翻译文案在 `messages/{zh,en}.json`。页面间跳转使用 `src/i18n/navigation.ts` 提供的 locale-aware 导航函数，而不是 `next/link`/`next/navigation` 原生 API。

### 板块（Sections）

内容板块是单一的动态路由 `src/app/[locale]/[section]/page.tsx`，白名单区分公开板块（`story`、`games`、`minds`、`terms`、`tools`）和受保护板块（`dashboard`、`classroom`、`notebook`、`whiteboard`），统一渲染共享的 `SectionPage` 组件。新增板块需要同时更新这两份白名单和两个语言的 messages 文件。

### 鉴权（两层，缺一不可）

1. `src/proxy.ts` 运行 next-intl 中间件、刷新 Supabase auth cookie，并对受保护路径做*乐观*跳转到 `/{locale}/login`。它不是授权层。
2. 受保护页面必须独立调用 `src/lib/auth.ts` 中的 `requireUser(locale)`，其内部使用 `supabase.auth.getUser()`。**服务端授权禁止使用 `getSession()`。** 真正的数据授权依赖数据库 RLS。

登录/注册是 `src/app/[locale]/(auth)/actions.ts` 中的 Server Actions（注意 `next` 跳转参数会做 open redirect 校验）；邮箱确认/OAuth 回调是 `src/app/[locale]/auth/callback/route.ts`。Supabase 客户端：`src/lib/supabase/client.ts`（浏览器端）、`server.ts`（Server Components/Actions）、`config.ts`（环境变量校验）。

### 服务端身份验证

- 当前项目的受保护页面统一调用 `requireUser(locale)`。
- `requireUser(locale)` 当前通过 `supabase.auth.getUser()` 获取并验证用户。
- 未经专门的鉴权迁移任务，不得绕过、复制或替换该入口。
- 禁止使用 `getSession()` 返回的用户对象作为服务端授权依据。
- Proxy 只负责 Cookie 刷新和乐观跳转，数据库授权最终依赖 RLS。

## Next.js 16 必须遵守的破坏性变化

> **禁止同步读取 Request API。** `cookies()`、`headers()`、`draftMode()`、页面的 `params` 和 `searchParams` 只能异步访问。页面 props 使用 `Promise<...>` 并 `await`。

> **`middleware.ts` 已废弃。** 使用 `proxy.ts` 和 `proxy` 导出。Proxy 固定使用 Node.js runtime，不要配置 Edge runtime，也不要把它当成完整授权层；受保护页面必须再次验证用户。

> **Turbopack 是 `next dev` 和 `next build` 的默认构建器。** 不需要 `--turbo`。自定义 webpack 配置不会自动兼容。

> **`next lint` 已移除，且 `next build` 不再执行 lint。** 使用 `eslint .`；`next.config` 中的 `eslint` 选项也已移除。

- `revalidateTag(tag)` 单参数形式已废弃。SWR 场景使用 `revalidateTag(tag, "max")`；Server Action 需要 read-your-writes 时使用 `updateTag(tag)`。
- `next/legacy/image` 已废弃，使用 `next/image`；`images.domains` 已废弃，远程图片使用 `remotePatterns`。带 query string 的本地图片必须配置 `images.localPatterns.search`。
- 图片默认行为：`minimumCacheTTL` 为 4 小时、默认 quality 仅 `[75]`、本地 IP 优化默认禁止、最大重定向数为 3、默认 `imageSizes` 不含 16。
- 并行路由的每个 slot 必须显式提供 `default.tsx`，否则构建失败。
- 全局 `scroll-behavior: smooth` 不再被路由自动覆盖；需要旧行为时在 `<html>` 添加 `data-scroll-behavior="smooth"`。
- AMP、`serverRuntimeConfig`、`publicRuntimeConfig`、`experimental.dynamicIO`、`unstable_rootParams` 已移除；`experimental.dynamicIO` 的替代项是顶层 `cacheComponents`，本项目暂不启用。
- `unstable_cacheLife`/`unstable_cacheTag` 已稳定为 `cacheLife`/`cacheTag`；`unstable_cache` 逐步由 `use cache` 取代。

## 官方资料

- [Next.js 16.2](https://nextjs.org/blog/next-16-2)
- [Next.js 16](https://nextjs.org/blog/next-16)
- [Next.js 15 → 16 升级指南](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy)
- [Supabase Next.js SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
