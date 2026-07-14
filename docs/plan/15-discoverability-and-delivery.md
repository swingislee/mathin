# Mathin 整体规划 · 15 可发现性与交付质量（SEO / 内容双语 / 缓存 / CI / 性能）

> 本文是 13、14 之后的**第三条横切线**，代号 `P4G-*`。13 补后端地基（事件/学期/uid/RLS 断言/合规），14 补前端体验骨架（导航/反馈/面包屑/无障碍）——两者已按各自 §9 基本执行完毕。本文补的是**剩下那半个系统**：站被不被搜到、内容能不能真双语、数据什么时候失效、谁来自动守门、页面快不快。
>
> **为什么是现在**：13/14 让内部质量成形，但对外的一面几乎还是零——`/en` 页面的 `<html lang>` 至今写死 `zh-CN`，52 个页面只有 1 个有 `generateMetadata`，73 篇概念的文件名/永久 uid 全是**拼音**。同时 13 遗留了一个反常的资产状态：**RLS 断言、类型校验、内容 uid 校验、migration 账本、vitest 全都写好了，却没有任何东西自动运行它们**（无 `.github`，零 CI）。这两件事——"对外隐形"与"守门人已造好但没上岗"——都属于低成本、高杠杆、且拖得越久越贵。
>
> **前置阅读**：`00-overview.md`（九板块）、`03-data-and-tech.md`（内容目录约定）、`13-§3.3`（内容稳定 uid，本文 §3 直接改写其命名结论）、`14-§2.2`（互导飞轮，依赖本文 §3 的命名整改）。执行纪律同前：本文没写的决策停下来问用户；每条任务一次提交；提交前 `pnpm lint && pnpm typecheck && pnpm build`（先停 dev server）；migration 走 SSH（`CLAUDE.md` 约定），破坏性 SQL 先确认。

---

## 1. 范围与非目标

**范围**：两轮共九条此前从未被审计过的轴。第一轮五条：可发现性（SEO，§2）、内容双语架构（§3）、缓存与重新验证（§4）、CI 与自动守门（§5）、性能与取数（§6）。第二轮四条（§7）：HTTP 安全边界、输入校验覆盖、遥测盲区、依赖供应链与交付卫生。每项给已核实到文件/行的现状证据、修法、验收。

**非目标**：
- 不写英文**内容**（73 篇概念的英译是内容工程，不是本文范围）。本文只负责**打通管线接缝**，让英文内容一旦写出就能落位。
- 不改 13/14 已验证正确的成果（事件表、学期轴、断言脚本、shadcn 组件基座、面包屑/无障碍基线一律保留，只做加法）。
- 不做 CDN/边缘部署、不引入外部 SEO 服务、不上重前端性能框架。

**两个必须先记录的既有结论修正**：
1. `14-§2.2` 称互导飞轮"无一处从概念页链到相关 game/tool"——**已过时/不准确**。`content/relations.json` + `getTermRelation` / `getTermsForTool` / `getTermsForGame`（`src/lib/content.ts:91–94`）已存在，概念页已消费相关工具/游戏。真正缺的是反向链与"下一步"出口的完整度，以及**锚点的命名质量**（见 §3.2）。执行 P4F-8 时按此校正，且 P4F-8 应排在本文 P4G-1 之后。
2. `13-§3.3` 的 uid 机制正确并已落地（`content_slug_aliases` 表、`verify-content-uids.mjs`），但其命名示例与实际种子用了**拼音**。本文 §3.2 取代其命名部分。（该节设想的"旧 slug 301 跳转"在 P4G-1 中**未采用**：拼音 URL 未发布，直接失效，见 §3.2 与 §10.2；`content_slug_aliases` 表保留，服务将来真正需要改名的场景。）

---

## 2. P4G-A · 可发现性：公开半边对搜索引擎近乎隐形

公开五板块（story/games/minds/terms/tools）存在的全部理由是被搜到。当前它们几乎不可被发现，且有一个直接的正确性 bug。

### 2.1 `<html lang>` 写死 `zh-CN`——英文页面对读屏器和搜索引擎都在撒谎（**先修**）

**现状证据**：`src/app/layout.tsx:21` `<html lang="zh-CN">` 是**硬编码常量**。根 layout 在 `[locale]` 之上，拿不到 locale，于是 `/en/...` 的全部页面都向外声明"本文档是中文"。

**后果**（不止 SEO）：读屏器用中文语音引擎念英文——**14-§5.2 刚建成的无障碍基线在根节点被一票否决**；搜索引擎的语言判定与将来的 hreflang 自相矛盾；浏览器翻译/断词/字体回退全部走错分支。

**修法**：把 `<html>`/`<body>` 下沉到 `src/app/[locale]/layout.tsx`（next-intl 在 `localePrefix: "always"` 下的标准布局），`lang={locale === "zh" ? "zh-CN" : "en"}`；根 layout 只保留 `metadata` 与全局样式。注意随迁 `data-theme` cookie 逻辑与 `<Toaster>`（`layout.tsx:17–28`）。

**验收**：`/en/terms` 的 DOM 根节点 `lang="en"`；`/zh/...` 为 `zh-CN`；主题 cookie 与 toast 行为不回归。

### 2.2 52 个页面，1 个 `generateMetadata`

**现状证据**：`grep -rl generateMetadata src/app` 唯一命中 `[locale]/notebook/[postId]/page.tsx`。73 篇概念、全部游戏/工具/思维文章/星球/岛屿页——**零 per-page metadata**。根 `layout.tsx:6–10` 明明备好了 `metadataBase: https://mathin.club` 与标题模板 `%s · Mathin`，但**没有任何页面往 `%s` 里填东西**：搜索引擎看到的是几十个标题同为"Mathin"、无 description、无 OG 图的页面。地基造好了，楼没盖。

**修法**：给公开内容路由补 `generateMetadata`——概念页用 frontmatter 的 `title`/`summary`（已有），游戏/工具用 registry 的名称与简介，思维文章同概念页。统一走一个 `buildMetadata({ title, description, path, locale })` helper，避免逐页手搓（同 14-§6 的"先立原语"原则）。

**验收**：任一概念页的 `<title>` 为「百分数 · Mathin」、有 description 与 OG；分享到微信/Twitter 有正确卡片。

### 2.3 无 `sitemap.ts`、无 `robots.ts`

**现状证据**：`src/app/` 下只有 `[locale]/`、`api/`、`embed/`、`layout.tsx`、`globals.css`、`favicon.ico`。

**后果**：73 篇概念 + 星球 + 岛屿 + 游戏 + 工具没有任何索引清单可供爬虫发现；而这些页面**本来是可静态化的**（`generateStaticParams` 已用于 `minds/[slug]`、`terms/concepts/[slug]`、`terms/[planet]`、`terms/[planet]/[island]`）——预渲染做了，却没告诉任何人它们存在。

**修法**：`src/app/sitemap.ts` 从 `getTerms()`/`getMinds()`/registry 生成全量 URL（zh+en 双份 + 每条带 `alternates.languages`）；`src/app/robots.ts` 声明 sitemap 位置并屏蔽 `/dashboard`、`/classroom`、`/notebook`、`/whiteboard`、`/api`、`/embed` 等非公开路径。

**验收**：`/sitemap.xml` 列出全部公开内容页的 zh/en 两版；`/robots.txt` 指向它且不放行受保护板块。

### 2.4 无 hreflang / canonical——双语站的两半在自相残杀

**现状证据**：全库 `grep alternates|hreflang|canonical` **零命中**。

**后果**：`/zh/terms/concepts/X` 与 `/en/terms/concepts/X` 在搜索引擎眼里是两个**互相重复、彼此竞争**的页面，而不是"同一内容的两种语言"。双语是 Mathin 的核心承诺，却正在被当作重复内容惩罚。

**修法**：在 §2.2 的 `buildMetadata` 里统一产出 `alternates: { canonical, languages: { "zh-CN": ..., "en": ..., "x-default": ... } }`。**注意**：hreflang 承诺的是"这里有对应语言的版本"——在英文内容真正存在之前（§3），en 备份指向的仍是中文正文，属于**半真承诺**。因此 §2.4 与 §3 必须成对交付，不能只上 hreflang。

**验收**：每个公开页 head 含 canonical + 双语 alternates；两语版本在搜索结果中互为语言备份而非重复页。

### 2.5 无结构化数据

**现状证据**：无任何 JSON-LD。教育内容本可标注 `LearningResource` / `Course` / `BreadcrumbList`（14 的面包屑已实现，数据现成）拿富摘要。

**修法**：概念页注入 `LearningResource`（含 `educationalLevel` ← frontmatter `stage`、`teaches` ← title），全站注入 `BreadcrumbList`（复用面包屑数据），组织信息注入 `Organization`。低成本、纯加法。

**验收**：Google 富媒体测试工具校验通过，无结构化数据错误。

---

## 3. P4G-B · 内容双语架构与命名（本文最贵、最不可逆的一节）

### 3.1 DB 有 locale 维度，文件系统没有——接缝断在一半

**现状证据**（一处漂亮的不对称）：
- **DB 侧已有 locale**：`content_slug_aliases`（`20260712001200_p4e_event_term_content.sql:236–244`）的主键是 **`(locale, slug)`**，且 `locale text not null default 'zh'`——13-§3.3 落地时**正确地预留了双语位**。
- **文件系统侧没有 locale**：`src/lib/content.ts:49` `const CONTENT_DIR = path.join(process.cwd(), "content")` 是**平铺单目录**（`content/terms/`、`content/minds/`，共 73 篇 MDX）；`getTerm(slug)`（`:87`）、`getMinds()`、`getTermsByIsland()` **全部不接 locale 参数**。
- 于是概念页 `TermPage`（`terms/concepts/[slug]/page.tsx:38–40`）虽然 `await locale` 并 `setRequestLocale(locale)`，那只本地化了**外壳文案**；`getTerm(slug)` 无论 `/zh` 还是 `/en` 都返回**同一份中文 MDX**。

**结论**：UI 是真双语（messages 中英完全对等），**内容是单语**——而内容恰恰是 terms 这个最高优先级板块的本体。`/en` 用户得到的是英文按钮包着中文定义。且这不是"英文还没写"的内容问题，是**管线里根本没有放置英文的位置**。

**修法（管线接缝，不含内容翻译）**：
1. 目录改为 `content/{zh,en}/{terms,minds}/`，zh 为现有内容平移。
2. `getTerms(locale)` / `getTerm(locale, slug)` 全线加 locale 参数；**缺失回退**：`en` 无对应文件时回退 zh 正文并在页面顶部显式标注"本页尚无英文版，显示中文原文"（诚实优于假装），同时该页 `alternates` 不谎报 en 版本存在。
3. `relations.json` / uid 保持**跨语言共享**（uid 是语言中立的锚点，这正是它的意义）；`slug-aliases.json` 按 locale 分组，与 DB 的 `(locale, slug)` 主键对齐。

**验收**：`/en/terms/concepts/percentage` 在英文 MDX 存在时渲染英文正文、不存在时渲染中文正文并显式标注；zh 行为零回归。

### 3.2 拼音标识符债——**永久 uid 里冻着拼音**（用户明确要求：MDX 命名用英文数学名词；趁现在改，成本为零）

**现状证据**：
- 文件名全是拼音：`bai-fen-shu.mdx`、`fen-shu-de-yi-yi.mdx`、`chang-fang-ti-he-zheng-fang-ti.mdx`（73 篇无一例外）。
- URL 因此也是拼音：`/zh/terms/concepts/bai-fen-shu`，且 `/en/terms/concepts/bai-fen-shu`——**英文用户拿到拼音 URL**。
- 更严重：13-§3.3 引入的**永久 uid 也是拼音派生**——`uid: cn-term-bai-fen-shu`。uid 的契约是"**永不复用、永不更改、DB 只认它**"，也就是说**拼音正在被浇筑进这个系统里最不可改的东西**。
- 交叉引用同样是拼音：`deps: ["fen-shu-de-yi-yi", "bi"]`、`relations.json` 以 uid 为键。

**为什么拼音是错的**（不是风格偏好）：
1. **对搜索引擎两头不靠**。`bai-fen-shu` 既不匹配中文搜索（用户搜"百分数"）也不匹配英文搜索（用户搜 "percentage"）——它是一串**几乎没有人会搜的字符**。这条直接掐死 §2 的全部收益：URL 是最强的相关性信号之一，而当前 73 个 URL 全部浪费。
2. **对双语是伪中立**。拼音看似"中性"，实则是中文的**有损转写**：`bi.mdx`（比）、`bei.mdx`（倍）在英文侧完全不可读，且拼音同音字冲突风险内建（比/币/笔）。真正语言中立的键是**英文数学名词**——数学概念的国际通用名（`ratio`、`multiple`、`percentage`）本就是学科的规范标识。
3. **uid 的不可变性把错误永久化**。今天改是改 73 个文件；等学习数据（掌握度、作答、课件引用）挂上 uid 之后再改，就是 13-§3.3 明确警告过的"数据迁移灾难"。

**关键时间窗（已核实）**：`grep -rln "content_uid|term_uid|concept_uid" supabase/migrations src/` **零命中**——**当前没有任何数据库表引用内容 uid**（`content_slug_aliases` 只存映射本身，不构成外键耦合）。也就是说 uid 至今只是内容侧的自我约定，改名的**边际成本现在正好是零**，且这个窗口会在 P4D/未来掌握度模型接入的那一刻关闭。**这是本文里唯一一件"今天做免费、明天做很贵"的事。**

**修法（一次性整改，趁 73 篇）**：
1. **uid 改为英文数学名词**：`cn-term-bai-fen-shu` → `cn-term-percentage`。保留 `cn-term-` 前缀（它标注的是**课标体系**而非语言，仍有意义），仅把拼音本体换成英文术语。
2. **文件名/slug 同步改英文**：`bai-fen-shu.mdx` → `percentage.mdx`，URL 变为 `/zh/terms/concepts/percentage`、`/en/terms/concepts/percentage`。
3. **旧拼音 slug 直接失效，不做 301**（2026-07-14 决策，取代原「登记别名 + 永久跳转」方案）：这批拼音 URL 从未对外发布、无外链、无索引，把它们养成永久别名等于永久背一份没人访问的兼容包袱。做法是：
   - 删除 `content/slug-aliases.json` 与 `src/lib/content.ts` 里的 `getSlugAliases` / `getCurrentTermSlug`，概念页不再做 `permanentRedirect`；
   - DB `content_slug_aliases` 的 71 行拼音记录由 migration 删除，改写入英文 slug（`is_current = true`）——表本身保留，它服务的是**将来真正需要改名时**的场景；
   - 概念页 / 星球页 / 岛屿页均加 `export const dynamicParams = false`：三者都是 `generateStaticParams` 覆盖的封闭清单，未知 id 由路由层直接 404，**带真状态码**。
   - **前提：动态段之上不得有流式边界**。原 `terms/loading.tsx` 会为整棵 `/terms` 子树先发出外壳，状态码被锁死在 200，`notFound()` 只能降级为 soft 404（200 + noindex）。因此该文件被移除，骨架下沉为 `terms/(atlas)/loading.tsx` 与 `terms/graph/loading.tsx`（路由组只罩图鉴首页，不波及子路由）。
   - 失效页不用 Next 默认页：新增 `src/app/[locale]/not-found.tsx`（SiteHeader + 站内配色 + 去图鉴/回首页），**真 404 状态码 + 站内一致的 UI**。
4. **改写全部交叉引用**：`deps`、`minds`、`relations.json` 的键、以及 `content/` 内正文里的相对链接。写一个一次性迁移脚本跑完，人工只审 diff。
5. **写成校验规则而非一次性劳动**：扩展已有的 `scripts/verify-content-uids.mjs`（P4E 已建）——新增断言：uid/slug 必须为 ASCII 小写英文词、**不得匹配拼音模式**、必须在一份受控的英文数学术语表内、uid 全局唯一且不复用。此后新内容**无法**再引入拼音（进 CI，见 §5）。

**术语表纪律**：英文名以国际数学教育通用术语为准（`fraction` / `numerator` / `least-common-multiple` / `perpendicular-and-parallel`），复合概念用连字符，不用缩写。术语表落在 `content/glossary.json`（zh 名 ↔ en 名 ↔ uid），与英文内容翻译共用同一份权威命名——**它同时是 §3.1 英译工作的词汇基线**，一举两得。

**验收**：71 篇文件名/uid/deps/relations 全部为英文数学名词；访问任一旧拼音 URL 返回 **HTTP 404** 并渲染站内失效页（不是 200 soft 404、也不是跳转）；新英文 URL、星球页、岛屿页、图鉴首页、图谱页均 200；`pnpm p4e:audit` 对任何新增拼音标识符报错；DB `content_slug_aliases` 只含英文 slug。

> **范围说明**：`minds` 两篇（`shu-xing-jie-he`、`you-xu-si-kao`）本轮**不改名**，等用户对 minds 板块的定位想清楚再动。

> **对 13-§3.3 的修订**：该节的 uid 机制本身正确并已落地，但示例与实际种子用了拼音。本节取代其命名部分：**uid 本体必须是英文数学名词**。执行 P4G-1 后回改 13-§3.3 的示例。

---

## 4. P4G-C · 缓存与重新验证：文档写了，代码一次没用

**现状证据**：
- `revalidateTag` / `updateTag` / `revalidatePath` / `cacheTag` / `use cache` / `export const dynamic` / `export const revalidate`——**全站零命中**。而 `AGENTS.md` 专门写了 Next 16 的约定（"SWR 场景 `revalidateTag(tag,"max")`；Server Action 需要 read-your-writes 时 `updateTag(tag)`"）。**规范与代码已经漂移。**
- 唯一的新鲜度机制是 **`router.refresh()`，60 处**。
- 内容页有 `generateStaticParams`（5 个路由），可静态化——这部分是对的，保持。

**诊断**：数据页因 `cookies()` 强制 dynamic，每次请求重跑全部查询；而任何一次写入（改一条跟进、点一次名）都用 `router.refresh()` **把整条路由的所有查询重跑一遍**，而不是只失效变化的那一小片。这是一个自洽但粗暴的模型：正确性没问题（永远拿最新），代价是每个数据页在每次交互上都交一份全量重算的税——dashboard（§6.3，1249 行、多组查询）尤其贵。

**修法（渐进，不做大重构）**：
1. 给稳定读多写少的数据（课程、班级花名册、员工与权限、学期、内容关联）加 `use cache` + `cacheTag`，Server Action 写入后 `updateTag(tag)` 精准失效（read-your-writes 语义正是为此）。
2. **保留** `router.refresh()` 于真正需要整页刷新的场景，但不再把它当成唯一手段。
3. 高频只读聚合（dashboard 磁贴数据）优先受益。

**验收**：改一门课程后，只有该课程相关 tag 失效、其余缓存命中；dashboard 首屏查询数在无写入的重复访问中显著下降；`AGENTS.md` 的缓存约定在代码中有实际落点。

---

## 5. P4G-D · CI：守门人全部造好了，但没有一个上岗（**最便宜的一项**）

**现状证据**（这是本文最反常的发现）：
- **资产极其齐全**：`supabase/tests/p4e_security_assertions.sql`（RLS 越权断言）、`scripts/run-p4e-db-audit.mjs`、`scripts/verify-p4e.mjs`、`scripts/verify-p4d.mjs`、`scripts/verify-content-uids.mjs`、`scripts/verify-database-types.mjs`、`scripts/migration-ledger.mjs`、`tests/p4e-offline.test.ts` + `vitest.config.ts`——13 号计划把守门人**一个不落全造出来了**。
- **没有任何东西自动运行它们**：`.github` 目录**不存在**，零 CI。`package.json` 里 `p4e:audit`、`p4e:db-audit`、`db:types:check`、`migrations:ledger`、`p4e:offline-test`、`lint`、`typecheck` 全部**只在人记得敲的时候才跑**。

**诊断**：13-§5.1 论证过"当安全不可见时，唯一守门人是可重复运行、直接对库断言的测试"——论证成立，测试也写出来了，但**"可重复运行"和"实际被运行"之间还差一个 CI**。一个不会自动运行的断言脚本，在心理上比没有更危险：它制造已被守护的错觉。这是一次典型的"造了锁，没装门"。

**修法（半天量级，零新测试代码）**：
1. `.github/workflows/ci.yml`：push / PR 触发，跑 `pnpm lint && pnpm typecheck && pnpm build && pnpm p4e:audit && pnpm db:types:check && pnpm p4e:offline-test`。这一步**不写任何新测试**，只是把已有资产接上电。
2. 需要连库的项（`p4e:db-audit`、RLS 断言 SQL、`migrations:ledger`）：CI 里对**一次性起的临时 Postgres 容器**按 `supabase/migrations/` 顺序重建库再跑断言——顺带**每次 CI 都验证了"从零重建库"这条路径没断**（这本身是灾备的一半）。凭据走 GitHub Secrets，**绝不把自托管库的密钥写进仓库或 workflow**（`CLAUDE.md` 密钥纪律）。
3. 加一个 `content` 校验作业：uid/slug 命名规则（§3.2）、双语 frontmatter 齐备、relations 引用的 uid 存在。
4. 分支保护：CI 红灯不得合并。

**验收**：任意 push 自动跑完全部门禁；故意提交一个越权 RLS 策略 / 一个拼音 slug / 一处 RPC 签名漂移，CI 分别红灯；临时库能从 migration 全量重建。

---

## 6. P4G-E · 性能与取数

### 6.1 客户端边界外溢：181 个组件里 104 个是 `"use client"`（57%）

**现状证据**：`grep -rl '"use client"' src --include=*.tsx` = 104；`.tsx` 总数 181。

**诊断**：App Router 的价值在于默认服务端渲染、只把真正需要交互的叶子推到客户端。57% 说明边界在**向上外溢**——多半是"整页/整块标 client，只因里面有一个按钮或一个 `useState`"。代价是白发的 JS 与更慢的首屏。

**注意（如实记录，不许一刀切）**：本项目有**大量真正需要客户端**的部分——白板、课堂实时、BlockNote 编辑器、three.js 星系、游戏、磁贴拖拽。所以 57% 里有相当比例是合理的。因此修法不是"把数字降下来"，而是**逐个审边界**。**先量后改**。

**修法**：① 先接 bundle 分析拿到每路由 JS 体积排名；② 对体积最大的前 10 个路由审客户端边界，把 `"use client"` 下推到真正交互的叶子，把数据获取与静态壳留在服务端；③ 定一条约定写入 `AGENTS.md`：`"use client"` 只允许出现在确实使用 hook/事件的组件，不允许出现在页面级容器（除非整页交互）。

**验收**：前 10 路由的客户端 JS 体积有可测量下降；新增页面默认为 Server Component。

### 6.2 重依赖已正确分割（**此前的担忧不成立，如实纠正**）

**现状证据**：`three` / `@react-three/*` 走 `next/dynamic` + `ssr: false`（`src/features/terms/three/views.tsx:18–19`，带 `NightLoading` 占位）；BlockNote 走 `next/dynamic`（`src/features/notebook/editor/NoteEditor.tsx:6`）。

**结论**：两个最重的依赖**没有**泄漏进共享 bundle，这一块做对了，保持不动。本节不列为问题，仅在 §6.1 的 bundle 分析中做回归验证。

### 6.3 dashboard 首屏 11 连串行 await

**现状证据**：`[locale]/dashboard/page.tsx` 共 **1249 行**；`:328–354` 是一条**串行 await 链**——`params` → `requireUser` → `getTranslations`×3 → `createClient` → 2 个 supabase 查询 → `listMyClassrooms` → `getProfile` → `getMyPerms` → `layoutRow`，**11 个 await 顺序等待**，之后才在 `:431` 进入按角色分支的 `Promise.all`（分支内的并行化是对的）。

**诊断**：这 11 个里有大半**彼此独立**（3 个 `getTranslations`、最近游戏查询、`listMyClassrooms`、`getProfile`、`layoutRow` 都不依赖彼此）。它们串起来的总延迟直接加在**全站访问频率最高页面**的 TTFB 上。分支内已经会用 `Promise.all`，说明范式是会的——只是首段前奏没有被同等对待。

**修法**：把前奏中互相独立的取数合并进一个 `Promise.all`（保留 `requireUser` 在最前作为鉴权闸门，其余并行）；顺带把 1249 行的 `page.tsx` 按角色拆成若干服务端子组件（可配合 `<Suspense>` 分段流式渲染，配 14 已建的 skeleton）。

**验收**：dashboard TTFB 可测量下降；首段独立取数并行发出；页面文件拆分后单文件不超合理规模。

### 6.4 加载态覆盖 3 / 52；索引密度偏薄

**现状证据**：`loading.tsx` 仅 3 个（dashboard、terms、根 error）对 52 个页面；migrations 里 53 张表 / 58 个索引——对一个已有跨表聚合报表（课堂报告、经营统计、续费窗口）的模式而言偏薄，且**从未做过查询计划审计**。

**修法**：① 给主要数据路由补 `loading.tsx`（复用 14-§6.5 已装的 `skeleton`）；② 做一轮 `explain analyze` 审计，重点是报表类聚合与 `students` 的按归属过滤（RLS 谓词能否走索引直接决定后台列表页性能），按结果补索引。

**验收**：主要路由有骨架屏而非白屏；报表类查询无 seq scan on 大表。

---

## 7. P4G-F · 第二轮轴线：信任面与交付卫生

### 7.1 HTTP 安全响应头：一个都没有

**现状证据**：`next.config.ts` 全文只有 `allowedDevOrigins` 与 `serverExternalPackages`，**无 `headers()` 配置**；`src/proxy.ts` 也不设任何响应头；全库 `grep Content-Security-Policy|X-Frame-Options|frame-ancestors|Strict-Transport|Referrer-Policy|Permissions-Policy` **零命中**。

**后果**：
- **无 frame 防护** → 整个后台（学生档案、财务收款、权限管理）可被任意站点 iframe，clickjacking 直接可用——诱导老师在透明 iframe 上"点一下"就是一次真实的收款确认/权限授予。对一个管钱、管小学生隐私的后台，这是接近 13-§2 级别的立即项。
- **无 CSP** → 任何一处 XSS（UGC 的 notebook 帖子是现成的注入面）都能满额升级：偷 cookie、拉外域脚本、静默调 Server Action。CSP 是 XSS 的最后一道纵深，现在没有。
- **无 HSTS / Referrer-Policy / Permissions-Policy** → 降级劫持、referrer 泄漏带 token 的 URL、摄像头/麦克风权限无声明边界。
- **特别注意 `/embed/[tool]`**：这个路由**有意**被外站嵌入（`src/app/embed/[tool]/page.tsx`），所以 frame 策略必须**分路径差异化**——全站 `frame-ancestors 'none'`（或 `'self'`），仅 `/embed/*` 放开。一刀切的 `X-Frame-Options: DENY` 会把自己的 embed 能力杀掉。

**修法**：`next.config.ts` 加 `headers()`：全站 `Strict-Transport-Security`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`（按白板/课堂真实用到的能力放行）、`X-Content-Type-Options: nosniff`；frame 策略按上述分路径；CSP **先以 `Content-Security-Policy-Report-Only` 上线**观察一周（Next.js 内联脚本、three.js、Supabase Realtime WebSocket 域都要进白名单），确认无误报再切强制。

**验收**：`curl -I` 任意页面见全套安全头；外站 iframe `/dashboard` 被浏览器拒绝，iframe `/embed/number-line` 正常；CSP 强制后白板/课堂/编辑器全功能回归无 console 违规。

### 7.2 输入校验斑块：zod 装了，最敏感的模块一处没用

**现状证据**：`zod@4.4.3` 在依赖里，且 `classroom/actions.ts`、`notebook/actions.ts`、`whiteboard/actions.ts`、`school/courseware-overlay.ts` 都在用；但 **`src/features/school/actions.ts`——1352 行、全库最大的 action 文件、管学生档案/财务/权限——`grep zod` 计数为 0**，入参靠手写 `String(...)` / `Number(...)` / `Date.parse` 散落各处。

**诊断**：又一次"斑块状质量"——校验纪律存在（P3/P4 教室白板都会用 zod），但**恰好在数据最敏感、入参最杂（几十个表单）的模块缺席**。RLS 挡住越权，但挡不住"合法用户提交畸形数据"：负数金额、超长字符串、非法枚举值能否入库，取决于每处手写 coercion 是否恰好想到了。13-§3.4 的状态机白名单管住了 status 字段，其余字段无人管。

**修法**：为 school actions 建一层 zod schema（金额 `nonnegative` + 上限、字符串 `max`、枚举 `z.enum`、日期 `z.iso.datetime()`），与 14 已铺开的 `useAction`/`ActionResult` 范式合流——校验失败返回 `{ ok:false, code:"VALIDATION" }` 走既有 toast 分流。**顺带处置巨石文件**：`school/actions.ts` 1352 行（同量级还有 `LiveShell.tsx` 1251、`dashboard/page.tsx` 1249），拆按子域（students/finance/staff/follow-ups）分文件，schema 与 action 同文件放置。

**验收**：对任一 school action 提交负数金额/超长文本/非法枚举，返回 `VALIDATION` 码而非入库或 500；`school/actions.ts` 拆分后单文件回到合理规模；新 action 默认带 schema。

### 7.3 遥测盲区：错误可观测已建成，性能与产品度量为零

**现状证据**：**错误侧已经做了**——`src/instrumentation.ts` 结构化输出 + `MATHIN_ERROR_REPORT_URL` 投递 + `operational_errors` 看板（P4E-V3 成果，运行手册齐全）。但**性能与行为侧零命中**：无 `useReportWebVitals`、无任何产品分析（umami/plausible/PostHog 均无）、未提 Search Console。

**诊断**：这形成一个闭环缺口——本文 §2 做 SEO、§6 做性能，做完之后**没有任何仪表能证明它们生效**：不知道有没有人来、从哪来、搜什么词进来、LCP 是多少、哪个页面慢。13-§5.3 的"可观测性"只回答"出错了吗"，不回答"表现如何"。对一个即将靠公开内容获客的站，无度量等于闭眼开车；对 §6 的"先量后改"原则，这就是那个"量"的另一半（bundle 分析是构建期，web vitals 是真实用户侧）。

**修法**：① `useReportWebVitals` 上报到自有端点（复用 `instrumentation.ts` 的投递通道，落 `operational_errors` 同款看板或独立表）；② 自托管一个轻量产品分析（umami/plausible 二选一，部署在 xiaomi，**不引第三方云——未成年人流量数据不出自有基础设施**，呼应 13-§6.2 PIPL）；③ mathin.club 接入 Google Search Console + Bing，作为 §2 全部工作的验收仪表。

**验收**：能回答"昨天多少访客、Top 进入页、terms 概念页的 LCP p75"；Search Console 能看到收录数与搜索词；无未成年人数据流向第三方云。

### 7.4 依赖供应链与交付卫生（三个小项，合并处置）

**依赖更新机制缺失**：无 renovate / dependabot（`.github` 整个不存在），`pnpm audit` 不在任何流程里。Next.js 锁 16.2.10 是有意的（AGENTS.md 约定），但"锁定"和"无人监控安全公告"是两回事——next/react/supabase-js 的 CVE 发布时，现在没有任何机制会通知到这个仓库。**修法**：P4G-0 的 CI 里加 `pnpm audit --prod` 作业（先 warn 不阻断，观察噪声后再定级）+ 接 renovate 只开 security-patch 自动 PR（常规升级仍走人工，尊重版本锁定约定）。

**翻译键已在漂移**：脚本比对 `messages/zh.json` 与 `en.json`——**zh 独有 2 键、en 独有 2 键**。数量小，但它证明了没有自动守门时漂移必然发生（1512 键靠人肉对齐）。**修法**：修掉这 4 个键；写 `scripts/verify-messages.mjs` 断言两文件键集合全等，进 P4G-0 的 CI content 作业。

**部署形态已有据可查（如实记录，非问题）**：`docs/runbooks/p4e-production-readiness.md` + `deploy/p4e-ops/` 的 systemd 单元、备份脚本、恢复演练记录（2026-07-13 实做过一次）——P4E 的运维交付是扎实的。本节不重复，仅指出它与 §5 的关系：**运行时的门（备份/告警/错误看板）已装，构建时的门（CI）还没装**，两者合起来才是完整交付。

**验收**：CI 含 audit 与 messages 键全等断言；renovate security PR 能自动开出；4 个漂移键清零。

### 7.5 验证为优秀，记录在案（防止未来"顺手修好"）

第二轮同时核验了两处此前存疑的信任面，**结论是优秀，不许动**：

- **游戏成绩防作弊（`src/features/games/actions.ts`）**：开局由服务端生成 seed 并落 `game_sessions` 留档；提交时核对对局归属与未核销状态 → `game.verify(seed, difficulty, proof)` 验证 proof 确为该题有效解 → 客户端用时与服务端流逝时间交叉核验（容差 10s）→ 落库并一次性核销。**排行榜（P2 核心）建立在不可伪造的成绩上**——这是全库"斑块状质量"里最亮的一块，P4F-5 给完赛屏加排行榜出口时不要碰这层。
- **i18n UI 层**：1512 键双语几乎全等（漂移仅 4 键，§7.4 已列修法），UI 文案纪律是真实存在的——这反衬 §3 的问题纯在**内容**侧，不在 UI 侧。

---

## 8. 板块 × 本文项影响矩阵

（●=直接改造，○=受益/需回归）

| 本文项 \ 板块 | 首页 | story | games | minds | terms | tools | notebook | classroom | whiteboard | school 后台 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 `html lang` 修正 | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| 2.2 per-page metadata | ● | ● | ● | ● | ● | ● | ● | | | |
| 2.3 sitemap/robots | ● | ● | ● | ● | ● | ● | ○ | | | |
| 2.4 hreflang/canonical | ● | ● | ● | ● | ● | ● | ○ | | | |
| 2.5 结构化数据 | ○ | ○ | ○ | ● | ● | ○ | | | | |
| 3.1 内容 locale 接缝 | | ○ | | ● | ● | | | | | |
| 3.2 拼音→英文命名 ★ | | | ○ 关联 | ● | ● | ○ 关联 | | ○ 课件引用 | | ○ 教学计划 |
| 4 缓存/失效 | | | ○ | | ○ | | ● | ● | ● | ● |
| 5 CI 门禁 | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| 6.1 客户端边界 | ● | ● | ○ | ● | ● | ○ | ○ | ○ | ○ | ● |
| 6.3/6.4 取数与加载态 | | | | | ○ | | ● | ● | | ● |
| 7.1 安全响应头 | ● | ● | ● | ● | ● | ●(embed差异化) | ○ | ○ | ○ | ● 防clickjacking重点 |
| 7.2 输入校验补齐 | | | | | | | ○ | ○ | ○ | ● |
| 7.3 遥测(vitals+分析) | ● | ● | ● | ● | ● | ● | ○ | ○ | | ○ |
| 7.4 供应链/翻译键卫生 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

**读法**：§2.1、§5、§7.1 横跨全部十列——每个页面都在撒的谎、每次提交都该过的门、每个响应都缺的头，三者最先做。terms/minds 列是 §3 的主战场（★=不可逆，时间窗有限）。school 列在 §7.1/§7.2 双重加粗（clickjacking 面 + 校验空窗都砸在管钱管档案的模块上）。school/classroom/notebook 列的 §4/§6 项可与 P4D 各模块改造合批。

---

## 9. 任务拆分与排期（`P4G-*`）

排期三原则：①不可逆且时间窗会关闭的先做（§3.2 命名）；②让守门人先上岗，后续所有改动都被它守着（§5）；③"每页都在犯的错"优先于"某页很慢"。

| # | 任务 | 触发时机 | 关键验收 |
| --- | --- | --- | --- |
| **P4G-0** | **CI 门禁上线**：`.github/workflows/ci.yml` 接上已有的 lint/typecheck/build/p4e:audit/db:types:check/offline-test + 临时库跑 RLS 断言；含 §7.4 的 `pnpm audit`、messages 键全等断言、renovate security PR | **立即，先于一切**（此后所有任务都被它守着） | §5 + §7.4 验收 |
| **P4G-0b** | **HTTP 安全响应头**：`headers()` 全套 + frame 策略分路径（全站禁、`/embed/*` 放）+ CSP Report-Only 起步 | **立即**，与 P4G-0 同批（clickjacking 面开着一天是一天） | §7.1 验收 |
| **P4G-1** | **拼音 → 英文数学名词整改** ★不可逆：71 篇 uid/文件名/deps/relations 改名 + 旧 slug 直接失效（真 404 + 自维护失效页，不做 301）+ `verify-content-uids` 加命名断言 + `glossary.json` | **立即，在任何学习数据引用 uid 之前**（窗口会关闭） | §3.2 验收 |
| **P4G-2** | `html lang` 下沉到 `[locale]/layout.tsx` | 随 P4G-1（同为"每页都在犯"） | §2.1 验收 |
| **P4G-3** | SEO 元数据层：`buildMetadata` helper + 公开路由 `generateMetadata` + sitemap + robots + canonical/hreflang | P4G-2 后（依赖正确的 lang 与英文 slug） | §2.2/2.3/2.4 验收 |
| **P4G-4** | 内容 locale 接缝：`content/{zh,en}/` + `getTerm(locale, slug)` + 缺失回退与显式标注 | P4G-1 后（命名先定，再分语言目录） | §3.1 验收 |
| **P4G-5** | 结构化数据（LearningResource / BreadcrumbList / Organization） | 随 P4G-3 | §2.5 验收 |
| **P4G-6** | 缓存与失效：`use cache` + `cacheTag` + Server Action `updateTag`，从课程/花名册/学期切入 | 随 P4D 模块改造合批 | §4 验收 |
| **P4G-7** | 性能：bundle 分析 → 客户端边界下推 → dashboard 前奏并行化 + 拆分 + Suspense/skeleton | **先量后改**；P4G-0 之后任意时机 | §6.1/6.3 验收 |
| **P4G-8** | 索引与查询计划审计（`explain analyze` 报表类 + RLS 谓词） | 有真实数据量后 | §6.4 验收 |
| **P4G-9** | school actions 的 zod 校验层 + 巨石文件按子域拆分 | 随 P4D 各模块改造合批（与 P4F-3 的 `useAction` 范式合流） | §7.2 验收 |
| **P4G-10** | 遥测：web vitals 上报 + 自托管产品分析 + Search Console 接入 | **随 P4G-3 成对**（SEO 做了要能被度量） | §7.3 验收 |

**与 13/14/P4D 的咬合点**：P4G-1 **必须先于**任何把内容 uid 写进数据库的任务（掌握度模型、课件引用、作业挂概念）——这是本文唯一有硬性时间窗的项。P4G-1 完成后，`14-P4F-8`（板块互导飞轮）才有干净的锚点可挂。P4G-3 依赖 P4G-1（英文 slug）与 P4G-2（正确 lang）。P4G-4 与英文内容撰写（内容工程，非本文）解耦：接缝先通，内容随后填。

---

## 10. 隐含坑清单

1. **改名要一次做完，不能分批**：uid/文件名/deps/relations 是一张互相引用的网，半途而废会留下悬空引用。一次性改完，人工只审 diff。
2. **旧 URL 直接失效，且必须是"真" 404**（2026-07-14 决策，取代原「必须 301」条）：拼音 URL 未发布、无外链，不值得养成永久别名。但**流式边界会吃掉状态码**——动态段之上只要有 `loading.tsx`，外壳先发出，`notFound()` 就退化成 soft 404（200 + noindex），旧 URL 事实上仍可访问。规则：**封闭清单的动态段用 `dynamicParams = false`，且其祖先路由段不得放 `loading.tsx`**（要骨架就用路由组把它限制在具体页面上）。失效页走 `[locale]/not-found.tsx`，保持站内 UI 一致，不用 Next 默认页。
3. **hreflang 不能谎报**：英文内容不存在时，不要宣称有 en 版本（§2.4 与 §3.1 成对交付）。半真的 hreflang 比没有更伤。
4. **`html` 下沉要带全 cookie/主题逻辑**：根 layout 的 `data-theme` + `<Toaster>` 随迁，别把暗色模式或 toast 弄回归。
5. **CI 连库不得用生产库**：临时容器 + GitHub Secrets；自托管库的 `POSTGRES_PASSWORD`/`JWT_SECRET`/service key **绝不进仓库、日志、workflow 文件**。
6. **性能先量后改**：§6.1 的 57% 里有大量合理的客户端组件（白板/编辑器/3D/游戏）。没有 bundle 数据就动边界，等于凭感觉重构。
7. **缓存别缓存出越权**：`use cache` 的 tag 若跨用户共享，会把 A 的数据缓给 B。只对**与用户无关**的数据（课程目录、学期、内容关联）加缓存；一切经 RLS 按人过滤的查询**不得**进共享缓存。这条是本文最容易造成安全事故的地方，落地时必须逐个 tag 审。
8. **只加不推翻**：13/14 的成果（事件表、断言脚本、shadcn 基座、面包屑、无障碍基线）、§6.2 已做对的动态分割、以及 §7.5 记录在案的游戏防作弊层全部保留。任何"顺手重写"的冲动停下来问用户。
9. **CSP 必须 Report-Only 起步**：Next.js 内联脚本、three.js、KaTeX 字体、Supabase Realtime WebSocket、BlockNote 都可能触发违规。直接上强制 CSP 大概率当场打断白板或课堂。观察一周违规报告、白名单收敛后再切强制。
10. **frame 策略别杀掉 embed**：`/embed/[tool]` 的存在意义就是被外站嵌入，安全头必须分路径（§7.1），全局 `X-Frame-Options: DENY` 是自断一臂。
11. **zod 补校验别顺手改语义**：§7.2 只加"拒绝畸形输入"，不改任何字段的业务规则；发现现有 coercion 与 DB 约束冲突时记录下来单独议，不在校验任务里悄悄改。
12. **产品分析不出自有基础设施**：未成年人流量数据不进第三方云（13-§6.2 PIPL），自托管 umami/plausible 部署在 xiaomi，域名与备案状态确认后再开公网收集。

## 11. 与既有文档的关系

- **修订 `13-§3.3`**：uid 机制正确并已落地，但命名示例/种子用了拼音。本文 §3.2 取代其命名部分——**uid 必须是英文数学名词**；执行 P4G-1 后回改该节示例。
- **修订 `14-§2.2`**：其"无一处从概念页链到相关 game/tool"已过时（`relations.json` + `getTermRelation` 已存在并被概念页消费）。改为"数据层已就绪，缺反向链与'下一步'出口"；`P4F-8` 应排在 P4G-1 之后。
- **修订 `AGENTS.md`**：新增三条约定——(a) `"use client"` 只允许在真正交互的叶子组件（§6.1）；(b) 内容标识符必须为英文数学名词，禁止拼音（§3.2）；(c) Server Action 入参必须过 zod schema，禁止手写 coercion 散落（§7.2）。缓存约定已在 `AGENTS.md`，本文 §4 是它的首次落地。
- 与 `docs/runbooks/p4e-production-readiness.md` 互补：该手册管**运行时**的门（备份/告警/错误看板/恢复演练，已建成），本文 §5/§7 管**构建时与响应时**的门（CI/安全头/遥测）。两者合起来才是完整的交付质量面。
- 不改 `04-roadmap` 板块顺序；本文作为第三条横切线与 P4D 交错。
- 完成后回写 `MEMORY.md`：新增"P4G 可发现性与交付质量"指针，与 [[p4e-foundations-plan]]、[[p4f-navigation-experience-plan]] 并列。
