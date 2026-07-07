# Mathin 整体规划 · 07 P3 笔记板块详细设计与执行计划

> 本文由架构审计产出，是 P3 的**唯一执行依据**，优先级高于 02-3.7 / 03-3.3 / 04-P3 的旧描述（P3-0 任务会同步修订那三处）。执行 agent 在动手前必须通读本文 + `00-overview.md` 铁律 + `01-design-system.md` + `05-planet-themes.md` §5。

## 0. 背景：旧项目（D:\code\2024\mathin-4-4\next）审计结论

用户 2024 年用 BlockNote 0.12 + Next 14 + next-auth 实现过一版 Notion 式笔记，本次 P3 要吸收其优点、根治其三个痛点。执行 agent **不需要**读旧项目源码，结论都在这里。

### 0.1 要保留的优点（视觉与交互资产）

- **悬浮控制面板布局**：大屏下整个工作区是「浅色窗口里浮起的一块深色圆角面板」，面板内左侧深色侧栏 + 右侧浅色内容纸面；小屏退化为全屏、侧栏变覆盖层。这是用户点名要保留的整体视觉感受。
- **面板颜色可配置**：可切换成不同风格色调。
- 精心做过的**移动端响应**：侧栏按屏幕方向（横/竖屏）折叠、可拖拽调宽（240–480px）、路由切换后自动收起。
- 功能集：无限层级笔记树、新建/重命名/归档（回收站）/恢复/彻底删除、Cmd+K 搜索、emoji 图标、封面图、发布为公开页、图片按内容 hash 去重上传。

### 0.2 三个痛点的根因（新实现必须逐条规避）

1. **每次键入都触发库写入与广播**：旧的自定义 `SupabaseProvider` 在 Yjs 文档每次 update 时立刻把**整篇文档全量状态**编码成 JSON 数字数组写进 Postgres 列，同时全量广播，另有 60s 定时器再全量重播一遍。根因：没有防抖、没有增量同步（未实现 y-protocols 的 state-vector 差量握手）、把二进制存成 JSON 数组。→ 新方案：**编辑期间零同步网络请求，只有防抖后的单次整篇 jsonb 写入**（见 §5.1）。
2. **标题三处（侧栏树 / 顶栏 / 文档内大标题）协同失灵，必须硬刷新才恢复**：根因是 `NotesProvider` 在 layout 挂载时用**空依赖数组**订阅 `postgres_changes`，闭包捕获了首次挂载瞬间的 `user?.id`（异步 session 还没就绪 → `undefined`）和 `params.noteId`（客户端导航进入时还不存在）。只有硬刷新（直接在笔记页首挂载）时这两个值恰好正确。→ 新方案：**本地单一数据源（store）+ 乐观更新**，三处 UI 订阅同一 store，自己的编辑不依赖任何实时回路；跨端同步仅作失效通知，且订阅 effect 必须把 `userId` 列入依赖（见 §5.3）。
3. **每条实时 payload 触发一次服务端 action 再查库**：旧版收到 postgres_changes 后不是直接用 payload，而是排队再逐条调 `getById` 服务端动作回查，读放大严重。→ 新方案：广播 payload 自带增量数据（标题/图标等元信息），前端直接合并进 store。

### 0.3 旧项目缺失、本次必须补上的功能

- 保存状态指示（保存中… / 已保存 / 保存失败重试）与**离开页面前 flush**。
- 并发写保护：双标签页/双设备编辑同一篇时的冲突检测（旧版会静默互相覆盖）。
- 真正的 RLS（旧版 next-auth + 手工造 token 的 adapter 绕过了 Supabase 体系）。
- 公开发布页的服务端渲染（旧版读者也要加载整个编辑器 bundle）与摘要提取。
- 点赞/帖子流（本项目 P3 的社交闭环，旧项目没有）。
- 笔记删除时清理 Storage 孤儿图片；文档体积上限校验。
- 编辑器界面中文化（BlockNote 自带 zh 词典）。

## 1. 范围与非目标

**P3 = 个人笔记工作区（Notion 式）+ 发布为公开帖子 + 点赞 + dashboard 笔记卡。**

| 做 | 不做（明确非目标） |
|---|---|
| BlockNote 富文本编辑、自动保存 | 多人同时编辑同一篇（Yjs 协同，见 §8 升级路径，留待 P4 与教室/白板一起决策） |
| 无限层级笔记树、回收站、Cmd+K 搜索、emoji 图标 | 笔记拖拽排序（按创建时间排）、笔记间双链、版本历史 |
| 发布/更新发布/取消发布 → 公开帖子流 + 点赞 | 评论、关注、通知（00-长期暂缓清单） |
| 图片上传（Storage + hash 去重） | 封面图（列为 P3-5 可选项，时间紧则跳过） |
| 跨端「失效通知」级实时（可降级） | 离线编辑、PWA |

**修订记录（P3-0 落实到旧文档）**：用户已批准在 notebook 板块引入富文本编辑器 BlockNote（推翻 02-3.7「不引入富文本编辑器」）；**仍不引入 Yjs/CRDT 与自建 websocket 服务**（03-§4 约束继续有效，P3 用防抖 jsonb 持久化即可，理由见 §3）。

## 2. 技术选型（2026-07 调研结论与决策）

| 事项 | 结论 |
|---|---|
| 编辑器 | **BlockNote 0.51.x**（锁 minor）。0.34 起支持 React 19；用 `@blocknote/core` + `@blocknote/react` + **`@blocknote/shadcn`**（复用本项目 shadcn 组件与 CSS 变量，符合 shadcn 优先铁律）。**禁止引入任何 `@blocknote/xl-*` 包**（GPL/商业双许可）。 |
| 编辑器 UI i18n | BlockNote 菜单/斜杠命令/占位符**必须跟随站点 locale 切换**：`import * as locales from "@blocknote/core/locales"`（自带含 `zh`/`en` 在内的 22 种词典），`useCreateBlockNote({ dictionary: locale === "zh" ? locales.zh : locales.en })`。如需覆写个别词条（如空段落占位文案），用展开合并 `{ ...locales.zh, placeholders: { ...locales.zh.placeholders, default: t("editorPlaceholder") } }`，覆写文案一律来自 `messages/{zh,en}.json` 的 `notebook.editor.*`，不得内联中文/英文字符串。 |
| 持久化 | BlockNote 文档 = block 数组，直接存 `notes.document jsonb`。**不存 Yjs 二进制**。 |
| 实时 | 仅用 Supabase Realtime **broadcast 私有频道**做跨端元信息失效通知（可整体降级关闭，不影响验收）。不用 postgres_changes（自托管需额外 publication 配置且是旧版痛点来源）。 |
| 协同（不在 P3） | 2026 年成熟自托管方案是 **Hocuspocus 4**（2026-05 stable，Node 22+，自带防抖落库/增量同步/awareness）或 **y-sweet**（Rust，落 S3 兼容存储）。社区 y-supabase 仍标注「不建议生产」。P4 若教室/白板确需 CRDT，按 §8 引入，届时 notebook 可平滑升级。 |
| 服务端渲染帖子 | 发布时用 `@blocknote/server-util`（`ServerBlockNoteEditor.blocksToFullHTML`）把快照渲成 HTML 存库，读者页零编辑器 bundle。执行时若发现该包与 0.51 版本 API 有出入，以官方文档 blocknotejs.org/docs 为准；兜底方案：详情页用只读 `BlockNoteView`（`editable={false}`）客户端渲染。 |
| HTML 消毒 | 发布动作内用 `sanitize-html`（服务端）过滤生成的 HTML 后再入库（用户可控内容，防 XSS）。 |
| emoji 选择器 | 先查 shadcn 生态：推荐 **frimousse**（轻量、shadcn 风格）；不合适再退回 `emoji-picker-react`。 |
| 客户端状态 | **zustand**（新依赖，≈1KB）：笔记树 + 元信息的单一 store。 |
| 安装命令 | `corepack pnpm add @blocknote/core@^0.51 @blocknote/react@^0.51 @blocknote/shadcn@^0.51 zustand sanitize-html` + `corepack pnpm add -D @types/sanitize-html`（server-util 在 P3-4 再装）。 |

**为什么 P3 不用 Yjs**：本板块是单作者笔记，唯一并发场景是同一用户开两个标签页。CRDT 解决的是多写者合并，代价是二进制文档失去 jsonb 可查询性、需要专门的同步后端。用「防抖保存 + updated_at 乐观锁 + 冲突提示」即可覆盖单作者场景，也正面消除旧版全部痛点。这是有意的架构决策，执行 agent 不得擅自引入 Yjs。

## 3. 信息架构与路由

```
/notebook               公开帖子流（未登录可浏览）——SectionShell，cheek accent
/notebook/[postId]      帖子详情 + 点赞（点赞需登录）——SectionShell
/notebook/me            我的笔记工作区（需登录）——独立全屏布局（悬浮面板）
/notebook/me/[noteId]   工作区内打开某篇笔记（需登录）
```

- `src/proxy.ts`：`protectedPattern` 从 `notebook` 改为 `notebook\/me`，即
  `/^\/(zh|en)\/(dashboard|classroom|whiteboard|notebook\/me)(?:\/|$)/`。
- `src/app/[locale]/[section]/page.tsx`：把 `notebook` 从白名单移除（03-§6：板块做实后必须移除，避免双路由）。
- 工作区两个路由页面本身仍要调 `requireUser(locale)`（双层校验铁律）。
- 页面间跳转一律用 `@/i18n/navigation` 的 `Link/redirect/useRouter`。

## 4. 数据模型（migration，P3-1）

新文件 `supabase/migrations/2026xxxxxxxxxx_notebook.sql`（时间戳取当天）。所有表 `enable row level security`，风格对齐已有三个 migration。

```sql
-- 私人笔记
create table notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  parent_id uuid references notes(id) on delete cascade,
  title text not null default '',
  icon text,                                   -- emoji
  document jsonb,                              -- BlockNote block 数组
  version int not null default 0,              -- 乐观锁计数（见 §5.1，不要用 updated_at 比较）
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_owner_parent_idx on notes (owner_id, parent_id) where not is_archived;
-- 触发器：update 时刷新 updated_at（public.set_updated_at() 已在 profiles migration 里定义，直接复用）
-- RLS：全部操作仅 owner_id = auth.uid()（select/insert/update/delete 四条）

-- 公开帖子 = 发布时的快照，与源笔记解耦
create table posts (
  id uuid primary key default gen_random_uuid(),
  note_id uuid unique references notes(id) on delete set null,
  author_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  content jsonb not null,                      -- 快照 block 数组（供再编辑/迁移）
  content_html text not null,                  -- 消毒后的渲染结果
  excerpt text not null default '',            -- 纯文本前 ~200 字
  like_count int not null default 0,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posts_published_idx on posts (published_at desc);
create index posts_likes_idx on posts (like_count desc, published_at desc);
-- 触发器：posts 也挂 set_updated_at
-- RLS：所有人（含 anon）可 select；作者可 insert/update/delete（author_id = auth.uid()）
-- like_count 防篡改用【列级权限】（比 RLS 简单可靠）：
--   revoke insert (like_count), update (like_count) on posts from anon, authenticated;
--   like_count 只由 post_likes 的 security definer 触发器维护（函数 owner 不受此 revoke 限制）

-- 点赞
create table post_likes (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
-- RLS：所有人可 select（用于「我是否已赞」）；本人 insert/delete
-- 触发器：insert/delete 时对 posts.like_count ±1（security definer）

-- Storage：桶 note-assets（public read）
-- insert into storage.buckets (id, name, public) values ('note-assets','note-assets', true)
--   on conflict do nothing;
-- storage.objects 策略：路径首段必须等于 auth.uid()::text 才可 insert/delete；公开可 select
```

**Realtime 私有频道（可选，允许降级）**：如自托管实例已启用 Realtime Authorization，加策略允许用户读写 topic = `'notes:' || auth.uid()` 的 `realtime.messages`；如未启用或版本不支持，**跳过本段并在 PR 描述注明「跨端实时通知降级为窗口聚焦刷新」**，不得为此阻塞。

migration 由 agent 通过 SSH 直接执行（`docs/supabase-self-hosting.md` §数据库迁移），执行前做幂等检查、执行后验证。

## 5. 前端架构（`src/features/notebook/`）

禁止跨板块 import 其他 feature；可复用 `src/components` 与 `src/lib`。

```
src/features/notebook/
  types.ts            NoteMeta { id, parentId, title, icon, isArchived, updatedAt } 等
  store.ts            zustand：treeById + 派生选择器 + 乐观更新 actions
  actions.ts          "use server"：笔记 CRUD、saveNoteDoc、publish/unpublish、toggleLike
  editor/
    NoteEditor.tsx    "use client" 动态加载 BlockNote（next/dynamic ssr:false 必须在 client 组件内）
    upload.ts         图片 hash 去重上传到 note-assets
  workspace/
    WorkspaceFrame.tsx  悬浮面板布局壳（§6）
    NoteTree.tsx / TreeItem.tsx
    WorkspaceTopbar.tsx  面包屑标题 + 保存状态 + 发布按钮 + 面板色调切换
    TitleField.tsx       文档内大标题（textarea autosize）
    TrashPopover.tsx
    SearchCommand.tsx    Cmd+K（shadcn command 组件，corepack pnpm dlx shadcn@latest add command）
  post/
    PostCard.tsx / LikeButton.tsx
```

### 5.1 自动保存（根治痛点 1）

- `NoteEditor` 挂 `onChange` → 写入 store 的 dirty 标记 → **1.5s 防抖**调 `saveNoteDoc(id, editor.document, baseVersion)`。
- `saveNoteDoc`（Server Action）：zod 校验 + `JSON.stringify(document).length < 1_000_000` 上限 → `update notes set document=…, version=version+1 where id=? and version=?`（RLS 已限定 owner）→ 返回新 `version`。**乐观锁必须用整数 `version` 比较，不要用 `updated_at`**——timestamptz 经 JS 序列化往返会丢精度，等值比较会造成永久假冲突。
- 更新 0 行 = 冲突：前端 toast「本篇已在其他窗口被修改」+ 提供「加载最新版」按钮，**不静默覆盖**。
- 标题/图标同理走 `updateNoteMeta`，防抖 600ms。
- 路由切换与 `beforeunload`/`visibilitychange(hidden)` 时 flush 未保存内容（best-effort 即可，防抖窗口仅 1.5s，不必上 sendBeacon）。
- 顶栏显示保存状态三态；保存失败自动重试一次后转为红色可点重试。

### 5.2 标题三处同步（根治痛点 2）

- 侧栏树、顶栏、文档内 `TitleField` 全部读 zustand store 同一条 `NoteMeta`；任何一处编辑先同步写 store（三处立即一致），再走防抖保存。**自己的编辑不经过任何网络回路。**
- 服务端初始数据：`/notebook/me` layout（Server Component）用 `requireUser` + 查全部未归档笔记的**元信息**（不含 document），传给 client 端 provider hydrate store。document 只在打开具体笔记时查。

### 5.3 跨端同步（可降级）

- client provider 内订阅私有频道 `notes:{userId}`（**useEffect 依赖 `[userId]`，userId 未就绪不订阅**——旧 bug 的直接教训）。
- 每次 `updateNoteMeta`/`saveNoteDoc` 成功后，客户端向频道 broadcast `{ type:"meta", note: NoteMeta }` 或 `{ type:"doc", id, version }`；收到方向 store 合并 meta / 对当前打开的笔记提示刷新。
- 降级路径（Realtime Authorization 不可用时）：不订阅，改为 `window` focus 时重新拉取元信息列表。两条路径都要实现，用一个常量开关。

## 6. 工作区视觉规格（保留旧版气质，token 化）

铁律：**所有颜色只能引用 `globals.css` 里的变量**，新变量也只能定义在 `globals.css`（05-§6）。工作台基调（05-§5）：无星球装饰、无邮票王冠灯等母题；notebook accent = `--cheek`。

- 在 `globals.css` 新增工作区作用域 token（放在 `[data-workspace]` 选择器下）：
  - `--ws-window`：外层窗口底色，默认 `var(--paper)`；
  - `--ws-panel`：悬浮面板深色底（默认取星夜色系，如暗色 `--paper` 同族的深蓝夜色）；
  - `--ws-panel-ink`：面板上的浅色文字；
  - `--ws-sheet`：面板内内容纸面 = `var(--paper)`。
- **面板色调可配置**：`[data-ws-tone="night|leaf|rose|crater"]` 四组预设覆写 `--ws-panel/--ws-panel-ink`，色值一律从既有 token 派生（如 `--leaf-deep`、`--rose-deep`、`--crater` 加深），不出现新的裸色值。选择存 `localStorage`（`mathin.ws-tone`），切换入口在 WorkspaceTopbar 的下拉里。
- 布局（`WorkspaceFrame`）：
  - `lg`（≥1024px）：外层 `p-8 lg:px-16` 的 `--ws-window`，内层 `rounded-3xl shadow-lg` 的 `--ws-panel` 面板；面板内：左侧侧栏（宽 240px，可拖拽 240–480px，拖拽手柄 hover 才显形）+ 右侧 `rounded-2xl` 的 `--ws-sheet` 内容区（编辑器所在）；顶栏浮在面板上沿。
  - `<lg`：无外框，面板全屏；侧栏为覆盖层（进场动画用 CSS transition，不引 framer-motion），路由切换自动收起；汉堡按钮展开。
  - 暗色主题下 `--ws-window` 与 `--ws-panel` 自然趋近，允许面板边界弱化——用 token 的暗色档处理，不写特例色。
  - 动效遵守 `prefers-reduced-motion`。
- 编辑器主题：`@blocknote/shadcn` 直接消费项目 shadcn CSS 变量；验证亮/暗两档下菜单、拖拽手柄、代码块可读。
- 内容区版心 `max-w-3xl mx-auto`，大标题为文档内 `TitleField`（`font-display`），不重复 SectionShell 的 h1。

公开流/详情页不用工作区外框，用 `SectionShell section="notebook"`，风格与 games 列表页一致（卡片、`--cheek` accent 点赞反馈）。

## 7. 任务拆解（每个任务 = 一次提交；提交前 `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm build`；涉及视觉的任务按 00 铁律截图亮/暗 × 桌面/移动给用户确认）

### P3-0 规划文档修订 + 依赖安装
1. 修订 `docs/plan/02-pages.md` §3.7：替换为本文 §3 的四条路由描述（帖子流两条保留原意，新增工作区两条，删去「不引入富文本编辑器」句，标注「详见 07」）。
2. 修订 `docs/plan/03-data-and-tech.md` §3.3：替换为指向本文 §4 的概要；§4 实时段补一句「notebook 跨端通知用 broadcast 私有频道，详见 07-§5.3」。
3. 修订 `docs/plan/04-roadmap.md` P3 小节：任务列表替换为 P3-0…P3-5，验收标准改为本文 §9。
4. 安装依赖（§2 安装命令），锁版本提交 lockfile。
5. 产出：文档 diff + 依赖。无视觉，无截图。

### P3-1 数据库 migration
1. 按 §4 写 `supabase/migrations/…_notebook.sql`（表、索引、触发器、RLS、storage 桶与策略；Realtime 策略按可用性取舍）。
2. 参考既有 migration 的写法与命名；`set_updated_at()` 若已存在则复用。
3. 验收：SQL 在本地实例跑通（提醒用户手动执行）；用 anon key 直接 REST 读 `notes` 返回空/拒绝，读 `posts` 成功。

### P3-2 路由重构 + 工作区骨架（无编辑器）
前置：P3-1 的 migration 需用户先在自托管实例手动执行，否则本任务的功能验收无法进行（可先写代码，验收前向用户确认）。
1. §3 的 proxy 与 `[section]` 白名单调整；新建四个路由文件（帖子流页先放 EmptyState 占位，P3-4 做实）。
2. `WorkspaceFrame` + token（§6）、`NoteTree`（层级、展开/收起、活跃态）、新建/重命名（顶栏与树内联）/归档/恢复/彻底删除（`TrashPopover`）、`store.ts` + 乐观更新、`/notebook/me` layout 的元信息 hydrate。
3. 跨端通知按 §5.3（含降级开关）。
4. messages `{zh,en}.json` 新增 `notebook.*` 文案（工作区所有 UI 词条）。
5. 验收：登录后 `/notebook/me` 可建三层嵌套笔记、重命名在树/顶栏两处即时一致、归档→回收站→恢复/删除闭环、移动端侧栏覆盖层可用、未登录访问 `/notebook/me` 被弹回登录页且 `next` 参数回跳正确。截图确认。

### P3-3 BlockNote 编辑器集成
1. `NoteEditor`（dynamic ssr:false、`theme` 跟随 next-themes）+ `TitleField` + §5.1 自动保存全链路 + 保存状态指示。
2. 编辑器 UI i18n（§2 表「编辑器 UI i18n」行）：`dictionary` 由当前 locale 决定（`useLocale()`，zh→`locales.zh`、en→`locales.en`）；locale 变化时编辑器需用 `key={locale}` 重建（`useCreateBlockNote` 的选项不会响应式更新）；覆写词条走 messages 文件。
3. 图片上传 `upload.ts`：SHA-256 内容 hash（Web Crypto，不引 crypto-js）→ 路径 `{userId}/{noteId}/{hash}.{ext}`（**去重只在笔记内**——若跨笔记去重，删除笔记时就无法判断图片是否被他篇共享），`upsert:false`；捕获「resource already exists」类错误时视为去重命中，直接复用已存在文件的公开 URL。同时给 P3-2 的「彻底删除」action 补上：删行前先 `storage.remove()` 该笔记 `{userId}/{noteId}/` 前缀下的所有文件（发布过的帖子快照 HTML 中引用的图片 URL 会随之失效，属可接受行为，向用户说明即可）。
4. emoji 图标：icon picker（§2 选型行）接到 `TitleField` 上方与 `updateNoteMeta`，树条目与顶栏显示图标（emoji 选择器依赖在本任务安装）。
5. `TitleField` 的多行自适应：优先 CSS `field-sizing: content`，浏览器兼容不够再引 `react-textarea-autosize`。
6. 冲突提示路径实测：两个标签页同开一篇，A 改后 B 再改，B 必须收到冲突提示而非覆盖。
7. 验收：打字期间 Network 面板**零**保存请求，停 1.5s 恰一次；刷新后内容在；亮/暗两档编辑器菜单正常；`/zh` 下斜杠菜单/工具条/占位符为中文、切到 `/en` 同一篇笔记编辑器 UI 变英文。截图确认。

### P3-4 发布与公开流
1. `publishNote(noteId)`：读笔记 → `blocksToFullHTML` → `sanitize-html` → 提取纯文本 excerpt → upsert `posts`（依 `note_id` unique）；`unpublishNote` 删行。顶栏发布按钮三态（未发布/已发布可更新/取消发布），已发布提供公开链接复制。**sanitize-html 需显式配置**：默认会剥掉 `class` 与 `img`，须在 allowedTags 中加入 `img`/`figure`/`figcaption` 等，allowedAttributes 保留 `class`、`src`、`alt`、`href`（scheme 限 http/https），否则 BlockNote 输出的结构与样式会被清空。
2. `/notebook` 帖子流：最新/最热 tab（`searchParams`，Next 16 下是 Promise 记得 await）、分页 20 条（用 supabase `range()` offset 分页即可，最热 tab 不要求游标方案）、卡片含作者（join profiles，其 select 策略已对 anon 开放）头像昵称/标题/excerpt 两行/点赞数/时间。
3. `/notebook/[postId]` 详情：服务端渲染 `content_html`（包一层 prose 样式，图片约束 `max-w-full`）+ `LikeButton`（乐观切换，`--cheek` 反馈，未登录点击引导去登录）。
4. `generateMetadata` 输出标题/描述（excerpt）。
5. 验收：未登录浏览流与详情正常；登录发布→流中可见→另一账号点赞计数 +1 且触发器数字与 `post_likes` 行数一致；伪造 REST 直改 `like_count` 被 RLS 拒。截图确认。

### P3-5 搜索、dashboard 笔记卡与收尾
1. `SearchCommand`（Cmd+K，标题过滤，来源 = store，全键盘可用）。
2. dashboard 新增笔记卡：我最近发布的 3 篇（标题/时间/点赞数）+「去写笔记」入口，样式对齐现有成绩卡。
3. 面板色调切换落地 + 全局走查（空态文案、焦点环、`prefers-reduced-motion`、移动端回归）。
4. 可选（时间允许且用户点头）：封面图上传。
5. 验收：§9 总验收全过。截图确认。

### P3-6（默认不做）协同编辑升级
见 §8。仅当用户明确批准后才可开工，且应并入 P4 排期评估。

## 8. 附录：P4 协同升级路径（记录决策上下文，P3 不执行）

若教室/白板阶段确认需要多人实时协同，推荐拓扑：

1. 与自托管 Supabase 同机跑 **Hocuspocus 4** 容器（Node 22+）。它原生解决旧版全部痛点：内存中增量同步（y-protocols 差量握手）、**防抖落库**（`onStoreDocument` 默认 2s debounce）、awareness 光标、断线重连。
2. 鉴权：客户端把 Supabase access token 作为 provider token；Hocuspocus `onAuthenticate` 用 Supabase JWT secret/JWKS 验签 + 查文档 ACL。
3. 持久化：`extension-database` 把 Yjs 二进制存 Postgres `bytea` 列（新表 `note_docs`，与 `notes` 元信息并存）。
4. notebook 迁移：BlockNote 同时支持无协同/协同模式；把现存 jsonb `document` 作为初始内容灌入新建 Y.Doc 一次即可，UI 层只换 provider 配置。
5. 备选：y-sweet（Rust、落 S3 兼容存储，可用自托管 Supabase Storage 的 S3 端点）；不选社区 y-supabase（作者自述不建议生产）。

## 9. P3 总验收

1. 未登录：可浏览帖子流与详情；访问 `/notebook/me` 被重定向登录。
2. 登录：建嵌套笔记 → BlockNote 写作（含图片）→ 自动保存 → 发布 → 另一账号在流中看到并点赞成功。
3. 性能纪律：连续打字期间无任何网络保存请求；停顿后单次防抖写入；读者页不加载编辑器 JS（用构建产物或 Network 验证；若 §2 的 server-util 兜底方案被迫启用则此条豁免，需在 PR 描述记录原因）。
4. 一致性：标题在树/顶栏/文档三处即时一致；双标签冲突有提示不静默覆盖。
5. 安全：anon 直连 REST 读他人 `notes`、写 `posts.like_count`、往他人 Storage 路径传文件均被拒。
6. i18n：编辑器菜单/斜杠命令/占位符随 `/zh`↔`/en` 切换；自研 UI 词条全部来自 messages 文件。
7. 工程：零硬编码色值/文案；`corepack pnpm lint && typecheck && build` 全绿；亮/暗 × 桌面/移动截图经用户确认。

## 10. 执行 agent 常见坑（务必先读）

- Next.js 16：`params`/`searchParams` 是 Promise，必须 `await`；**不得创建 `middleware.ts`**（改 `src/proxy.ts`）；`next/dynamic` 的 `ssr:false` 只能出现在 client 组件里。
- 站内链接一律 `@/i18n/navigation`，URL 永远带 `/zh|/en` 前缀。
- 服务端鉴权只用 `requireUser`（内部是 `getUser()`），禁 `getSession()`。
- BlockNote 的 CSS：`@blocknote/shadcn/style.css` 在编辑器组件内导入；不要引入 mantine/ariakit 风格包。
- 新 UI 组件先查 shadcn/ui（`corepack pnpm dlx shadcn@latest add …`），无对应组件才允许手写或引第三方。
- 提交信息沿用仓库惯例（`feat: … (P3-x)`）。
