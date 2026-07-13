# Mathin 工程约定与 Next.js 16 迁移要点

本项目锁定稳定版 **Next.js 16.2.10**。截至 2026-07-06，npm 的 `latest` 为 16.2.10；16.3 仍属于 preview/canary，禁止用于生产依赖。

## 技术基线

- Node.js >= 20.9（当前开发环境 Node.js 22），TypeScript >= 5.1，pnpm。
- App Router、React 19、Turbopack、Tailwind CSS 4、next-intl、Supabase SSR、shadcn/ui。
- **UI 组件铁律**：任何可复用控件动手前先查 `docs/plan/01-§6` 的 shadcn/ui 能力目录（"需要什么→用什么"决策表），有则 `add` 不手搓——禁止再新增原生 `<input>/<select>/<table>`、`window.confirm()`、内联手搓 badge/card、手搓抽屉等（历史债务清单与迁移计划见 `docs/plan/14-§6.5`）。
- 中文是默认语言，路由始终带 `/zh` 或 `/en` 前缀。
- 路由边界逻辑写在 `src/proxy.ts`，不要新增 `middleware.ts`。

## 必须注意的破坏性变化

> **禁止同步读取 Request API。** `cookies()`、`headers()`、`draftMode()`、页面的 `params` 和 `searchParams` 在 Next.js 16 中只能异步访问。页面 props 使用 `Promise<...>` 并 `await`。

> **`middleware.ts` 已废弃。** 使用 `proxy.ts` 和 `proxy` 导出。Proxy 固定使用 Node.js runtime，不要配置 Edge runtime，也不要把它当成完整授权层；受保护页面必须再次验证用户。

> **Turbopack 已成为 `next dev` 和 `next build` 默认构建器。** 不需要 `--turbo`。自定义 webpack 配置不会自动兼容。

> **`next lint` 已移除，且 `next build` 不再执行 lint。** 使用 `eslint .`；`next.config` 中的 `eslint` 选项也已移除。

- AMP、`serverRuntimeConfig`、`publicRuntimeConfig`、`experimental.dynamicIO`、`unstable_rootParams` 已移除。
- `experimental.dynamicIO` 的替代项是顶层 `cacheComponents`；本项目暂不启用 Cache Components。
- `revalidateTag(tag)` 单参数形式已废弃。SWR 使用 `revalidateTag(tag, "max")`；Server Action 需要 read-your-writes 时使用 `updateTag(tag)`。
- `unstable_cacheLife`/`unstable_cacheTag` 已稳定为 `cacheLife`/`cacheTag`；`unstable_cache` 逐步由 `use cache` 取代。
- `next/legacy/image` 已废弃；使用 `next/image`。`images.domains` 已废弃；远程图片使用 `remotePatterns`。
- 图片默认行为变化：`minimumCacheTTL` 为 4 小时、默认 quality 仅 `[75]`、本地 IP 优化默认禁止、最大重定向数为 3、默认 `imageSizes` 不含 16。
- 带 query string 的本地图片必须配置 `images.localPatterns.search`。
- 并行路由的每个 slot 必须显式提供 `default.tsx`，否则构建失败。
- 全局 `scroll-behavior: smooth` 不再被路由自动覆盖；需要旧行为时在 `<html>` 添加 `data-scroll-behavior="smooth"`。
- `next dev` 输出位于 `.next/dev`，并与 build 输出分离；同类命令使用锁文件防止并发实例。

## Next.js 16.2 主要特性

- 更快的开发启动和 Server Components 渲染，包含大量 Turbopack 修复。
- 生产默认错误页更新；开发终端显示 Server Function 执行；hydration overlay 明确标注 Server/Client diff。
- `next start --inspect` 可调试生产服务器。
- Build Adapters API 稳定；`ImageResponse` 性能和 CSS/SVG 支持增强。
- `<Link transitionTypes>` 支持 App Router View Transitions。
- `unstable_catchError`、`unstable_retry` 等仍为实验 API，不作为项目基础能力。

## Supabase 安全约定

- 浏览器只允许读取 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；不得提交 secret/service-role/JWT/数据库密码。
- Server Components 和 Proxy 使用 `auth.getUser()` 验证身份，禁止用 `getSession()` 作为服务端授权依据。
- Proxy 只负责乐观跳转和刷新 Cookie，真正的数据授权依靠服务端验证及数据库 RLS。
- 生产环境不得使用 `192.168.*` 地址，且必须通过 HTTPS 域名连接 Supabase。

## 官方资料

- [Next.js 16.2](https://nextjs.org/blog/next-16-2)
- [Next.js 16](https://nextjs.org/blog/next-16)
- [Next.js 15 → 16 升级指南](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy)
- [Supabase Next.js SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
