# Mathin 工程约定

Mathin 是一个中英双语（zh/en，中文为默认语言）、以 Terms 为核心的数学探索网站。小王子世界观是全站主要视觉语言。1.0 同时包含对外的 Story、Games、Minds、Terms、Tools、Notebook，以及对内的完整学校运营与内容发布系统。本文件是所有 Agent 的权威工程约定，涵盖规划治理、技术栈、架构与 Next.js 16 迁移要点。

## 开始任务前的必读文档

所有实现任务：

- 阅读 `docs/plan/00-overview.md`。
- 阅读 `docs/plan/04-roadmap.md`，确认当前阶段，不得抢跑。
- 当前 R1-Live/生产 1.0 任务阅读 `docs/plan/25-production-1.0-product-completeness.md` 的相关章节。
- 阅读与当前任务直接相关的专题规划文件及其**状态头**，不要默认读取整个 `docs/plan/`。

按任务类型补充阅读：

- UI、视觉、交互：`01-design-system.md`
- 小王子世界观、五星球、Notebook 与工作区视觉强度：`05-planet-themes.md`
- 页面布局与路由：`02-pages.md`
- 数据库、鉴权、RLS、registry：`03-data-and-tech.md`
- shadcn/ui 组件选择：`01-design-system.md` 的“§6 shadcn/ui 能力目录”
- 历史 UI 债务迁移：读取 `14-...md` 的“§6.5”，仅在相关任务中读取

### 规划状态与冲突处理

- `04-roadmap.md` 是唯一施工阶段入口；只有其顶部“当前施工阶段”可决定下一阶段。
- 当前主线为 R1-Live 时，只施工 doc 04 当前 Gate 的 blocker；不影响首个真实闭环的内容、视觉和完整性工作进入上线后队列，不得用旧 R1 编号顺序覆盖 Gate 顺序。
- `00`、`04`、`25` 是持续维护的 active 真相源。其他 doc 的 `complete` 表示历史阶段已竣工，不得因正文有未勾选项就重复实施；`partial` 只按状态头和 doc 25 重新收录的剩余项施工。
- 事实优先级：工程硬约束 → 00 产品宪章 → 04 阶段顺序 → 25 发布门/缺口 → 相关专题文档 → 历史正文。实现状态最终以代码、迁移和自动化证据核对。
- 文档与当前代码冲突时先查 00/04/25；如果规划确实过期，先更新 active 文档再实现，禁止按旧计划大范围返工。
- 完成阶段时同步更新专题文档状态头、04、25，并运行 `pnpm plan:audit`。
- 每完成一个可独立验收的阶段改动并通过相应验证后，必须立即提交 Git；提交只包含本任务文件，不得把已完成增量留在未提交工作树，也不得夹带用户或其他 Agent 的改动。
- R1 阶段证据统一登记在 `docs/evidence/r1/README.md`；仓库只保存无 secret/PII 的小摘要和索引，大日志、截图、视频保存到 CI artifact 或受控对象存储并登记 SHA-256、保留期和访问角色。

### 规划写作

- 先写对象、动作、原因和结果；数量、时间、路由、表/RPC、角色、状态变化和验收命令优先于形容词。
- 一句话必须增加事实、关系、解释或判断；四者都没有时删除。
- 同一结论只保留一处，其他文档用链接或增加新的证据、限制、案例。
- 结论注明证据范围。路由存在只能证明骨架，测试通过只能证明覆盖的合同，开发数据不能证明生产状态。
- 并列字段使用表格/列表；连续因果使用段落。没有历史误解需要纠正时，不使用“不是……而是……”等对照句式。


## 技术基线

- Node.js >= 20.9（当前开发环境 Node.js 22），TypeScript >= 5.1，pnpm。
- **Next.js 锁定稳定版 16.2.11**（App Router、React 19、Turbopack 默认构建器）。禁止使用 16.3 canary/preview。
- Tailwind CSS 4、next-intl、Supabase SSR、shadcn/ui（`components.json`）。
- 已有 Vitest、CI 静态/构建审计、数据库重建与 RLS/安全检查；R1-14 已建立正式 Playwright 配置与 fail-closed release runner，发布目标、写态、zh/en、跨浏览器和连续无 flaky 矩阵仍待完成。需要 `.env.local`（从 `.env.example` 复制），填入自托管 Supabase 的 URL 与 publishable key。
- 路由边界逻辑写在 `src/proxy.ts`（导出 `proxy`），**禁止新增 `middleware.ts`**——它在 Next.js 16 中已废弃。

### UI 组件约束

- 所有 UI、导航、错误、空状态、通知模板与关键元数据必须同时维护 zh/en；英文课程/文章内容可以延后，但必须有显式回退，不能以缺英文内容为由交付单语 UI。
- 小王子视觉按三级应用：公开首页/五星球首页使用场景级；内容、Notebook、身份/错误页使用内容级；Dashboard、Classroom、Whiteboard、Courseware Studio 使用工作区级。工作区保留纸色、星夜、字体、线宽和单个品牌锚点，表格、表单、实时控制与画布内禁止叙事装饰。

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

### 自研课堂互动同步门

- 新增或修改 Mathin 自研的游戏页、单文件 H5、空间/3D 文档或其他课堂互动 renderer 时，必须在 `src/features/classroom/sync/interaction-audit.ts` 声明版本化同步 provider；只传 `interactive=true` 或只完成本机 pointer/click 输入不构成课堂同步。
- 教师控制态只允许一个权威写者。可恢复操作使用有 payload 上限的 durable snapshot/semantic command 并进入现有 session event log；逐帧相机、hover、拖动中间帧等可丢表现不得冒充权威状态。展示端、学生端和晚加入端必须能从 snapshot/command replay 收敛到相同状态。
- 尚未实现同步协议的 Mathin 自研 H5 与 `spatial-page-v1` 在课堂中保持 read-only/fail-closed；不得以 local-only 交互登记为已审计。新增 `CoursewareDoc` 版本、微课 mode 或游戏课件 contract 必须让类型穷尽门和 `pnpm classroom:interaction-sync:audit` 通过。

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

## 环境边界（写操作硬门）

- **生产环境**：SSH alias `xiaomi`（`192.168.5.183`）、`https://mathin.club` 与 `https://supabase.mathin.club` 指向同一套 R1-Live 生产系统。任何 `ssh xiaomi "docker exec ..."` 都按生产操作处理；未取得产品负责人对本次生产动作的明确授权、未完成 [`docs/runbooks/r1-write-target-policy.md`](docs/runbooks/r1-write-target-policy.md) 的只读 preflight 时，禁止迁移、测试造数、业务写入、服务重载或重启。
- **本地开发环境**：Windows 主机 `192.168.5.213`；Next 开发入口为 `http://localhost:3130` / `http://192.168.5.213:3130`，本机 Docker Supabase 由 `.env.local` 指向 `http://127.0.0.1:35421`。开发迁移和固定账号验证只操作本机 Docker，不经过 `ssh xiaomi`。
- 本机与 Xiaomi 都使用 `supabase-db`、`supabase-rest` 等相同容器名。**容器名不能证明环境**。任何数据库、Storage 或服务写操作前，必须同时核对执行主机、应用实际 Supabase origin、监听进程和目标环境；其中任一不明确即停止。
- Xiaomi 过去曾承担开发用途不改变其当前生产等级；历史文档把 Xiaomi 称为“开发库”的描述不得作为当前写入依据。生产变更必须区分“开发通过”“获准部署”“已部署待验收”和“生产通过”。

## SSH 国际网络代理

- 每个新建的 SSH Shell 在执行 `curl`、`git`、`apt`、Docker 拉取或其他需访问国际网络的命令前，必须先执行 `proxy_on` 启动代理。
- SSH 脚本应使用会加载该函数的 Shell 环境，并在同一 Shell 会话中执行 `proxy_on` 与后续网络命令；内网地址和本地服务不需要经由代理。

```bash
pnpm dev        # 开发服务器 0.0.0.0:3130（局域网：http://192.168.5.213:3130）
pnpm lint       # eslint . —— Next.js 16 的 next build 不再执行 lint
pnpm typecheck  # tsc --noEmit
pnpm build
pnpm test       # 全量 Vitest 回归；93 个文件、625 项通过、1 项条件跳过，不等同 R1-Live 门禁
pnpm plan:audit # 00～25 状态头、索引与唯一阶段审计
pnpm ci:checks  # 本地复现 CI checks job 的工程门禁（清单从 ci.yml 解析），推送前跑一次
pnpm r1:live:test  # 当前两个 R1-Live Gate 的源码合同；6 个文件、52/52
pnpm r1:regression # 历史 R1-1～16 累积合同诊断；23 个文件、179/179
pnpm r1:test       # 兼容入口，等同 pnpm r1:live:test
pnpm secrets:check   # 当前跟踪树、binary ASCII 与高风险容器 secret scan
pnpm secrets:history # 完整可达 Git 历史 high-confidence secret scan
pnpm e2e        # 本地/开发目标 Playwright；复用固定开发账号，不注册新账号
pnpm e2e:release # 仅允许明确非生产 target attestation，缺角色/skip/flaky 均失败
pnpm classroom:interaction-sync:audit # 自研游戏/H5/空间互动的课堂同步 provider 与适配链审计
```

CI 的 checks job 不 fail-fast：所有静态门禁一次跑完再判定，`pnpm ci:checks` 行为一致，因此一次运行就能看到全部失败，不要只跑单个审计就推送。

### 文件摘要（hash）纪律

任何写入仓库或数据库并在其他环境复核的文件摘要（证据 `artifact_hash`、migration 账本 checksum、类型摘要），必须走 `scripts/lib/text-hash.mjs` 的 `textFileSha256` / `normalizeNewlines`，不得直接对 `readFileSync` 的原始字节取 hash。`.gitattributes` 以 `* text=auto eol=lf` 入库，Windows 工作区 checkout 出来可能是 CRLF；字节级摘要会让同一份内容在开发机与 CI clone 上不同，门禁只会在推送后才炸。

## 测试账号

本机 Docker 隔离开发库上已存在一套固定的 5 个可复用测试账号（admin / teacher / sales / student / parent，均为 `@mathin.local`），角色/staff_role_members/学生档案/监护人关联均已预绑定。凭据与 ID 见 `.claude/test-accounts.local.md`（已 gitignore，不在仓库中，需要登录或模拟这些用户时读取该文件）。**所有人工/agent 开发测试复用这套账号，不要新建，也不得把这些账号同步到 Xiaomi。** 如果任务确实需要新账号或不同账号（如测试未认领的绑定码流程、多子女家长、越权场景），先向用户确认。

这些账号只属于开发/RC 数据，不得进入正式身份清单。R1-Live 的正式身份以明确 UUID 登记：admin 角色账号恰为 1，但允许加入经批准的真实教师和其他业务用户；真实班级、课次、学生、考勤及课次冻结/引用的 immutable release、snapshot 和对象一经产生即进入受保护清单。Production 1.0 只允许在隔离副本演练并删除 manifest 明确标记的测试对象，同时保留 E 系列 1135 讲与爱学习 G+/X+/A+ 秋季 170 讲的 16:9/4:3 资源，为 1305 个 lecture 的两条轨道建立 2610 条 baseline `release_no=1`。旧“只留一个 auth 用户”的 planner 在增加正式对象保护 manifest 前不可执行；除 R1-15 隔离演练或 R1-18 明确人工授权外，任何 Agent 都不得执行清理。

## 架构

### 路由 / 国际化

每个路由都在 `src/app/[locale]/` 下，URL 始终带 `/zh` 或 `/en` 前缀（`src/i18n/routing.ts` 中 `localePrefix: "always"`）。翻译文案在 `messages/{zh,en}.json`。页面间跳转使用 `src/i18n/navigation.ts` 提供的 locale-aware 导航函数，而不是 `next/link`/`next/navigation` 原生 API。

平台顶层身份角色以数据库为准：`student | parent | staff | admin`。教师、教务、教研、学辅、销售等是 staff 角色/权限，不得新增 `profiles.role=teacher` 这类并行顶层角色。

### 板块（Sections）

Story、Games、Minds、Terms、Tools、Notebook 已有各自显式路由/功能入口，是 1.0 必须同步上线的公开产品模块；Terms 是关系中心。`[section]` 只保留当前代码明确承载的兼容/共享入口，旧文档中的“全部板块走单一动态路由”不再是目标。新增或调整板块时同时核对路由、Proxy/鉴权、导航、sitemap/SEO、内容 registry 和两种语言 messages。

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
