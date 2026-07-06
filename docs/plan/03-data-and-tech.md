# Mathin 整体规划 · 03 数据模型与技术约定

## 1. 目录结构约定

```
content/                      # 课程性内容（git 管理，不入库）
  story/<chapter>/meta.json + pages/*.webp
  terms/<slug>.mdx
  minds/<slug>.mdx
src/
  app/[locale]/...            # 路由（现有结构不动，新增板块子路由）
  app/embed/[tool]/           # 纯净嵌入路由（无 locale 前缀，query 传 locale）
  components/                 # 全站共享组件（SectionShell、Star4 等）
  features/<section>/         # 板块内部组件与逻辑，禁止跨板块互相 import
    games/registry.ts         #   游戏注册表
    games/sudoku/...
    tools/registry.ts         #   工具注册表
    tools/fraction-line/...
  lib/                        # 现有：supabase、auth、utils
supabase/
  migrations/*.sql            # 所有建表与 RLS，必须以 migration 文件形式提交
```

跨板块复用的东西上移到 `src/components` 或 `src/lib`，而不是互相 import feature。

## 2. 注册表模式（games / tools / 交互演示）

```ts
// src/features/tools/registry.ts
export interface ToolDef {
  id: string;                       // 路由段，kebab-case
  category: "number" | "geometry" | "motion" | "misc";
  grades: [number, number];         // 适用年级区间
  Component: React.LazyExoticComponent<React.ComponentType<{ locale: string; embedded?: boolean }>>;
}
export const tools: ToolDef[] = [ ... ];
```

- games 同理：`GameDef` 含 `id, difficulties[], Board`，`Board` 实现统一接口 `{ difficulty, seed, onComplete(ms, proof) }`。
- terms 概念页的「看见它」交互槽通过 `interactive` frontmatter 字段查 tools/独立演示注册表。
- 新增游戏/工具 = 加一个 feature 目录 + 注册表一行，不改路由代码。

## 3. Supabase 数据模型

所有表默认 `id uuid pk default gen_random_uuid()`、`created_at timestamptz default now()`。**每张表必须 `enable row level security` 并写策略**，migration 里没有 RLS 的表不得合并。

### 3.1 账户

```sql
profiles (
  id uuid pk references auth.users on delete cascade,
  display_name text not null default '',
  avatar_url text,
  role text not null default 'student' check (role in ('student','teacher','admin'))
)
-- 触发器：auth.users 插入时自动建 profiles 行
-- RLS：所有人可读；本人可改 display_name/avatar_url；role 仅 service role 可改
```

服务端判断教师：查 `profiles.role`，封装为 `src/lib/auth.ts` 的 `requireTeacher(locale)`。

### 3.2 游戏成绩

```sql
game_scores (
  user_id uuid references profiles,
  game_id text not null,           -- 对应注册表 id
  difficulty text not null,
  seed text not null,              -- 题目种子，服务端生成
  duration_ms int not null check (duration_ms > 3000),
  proof jsonb,                     -- 完整解，服务端校验
  unique (user_id, game_id, difficulty, seed)
)
-- RLS：本人插入（经 Edge/Server Action 校验后）；排行读取走视图
```

反作弊约定：开始对局时 Server Action 发 `seed + started_at` 存 `game_sessions` 表；提交时服务端验证解正确性且 `now() - started_at ≈ duration_ms`（容差 10s）。排行榜视图 `game_leaderboard` 取每人每难度最好成绩。

### 3.3 笔记

```sql
posts ( author_id uuid, title text not null, body_md text not null, like_count int default 0 )
post_likes ( post_id uuid, user_id uuid, primary key (post_id, user_id) )
-- RLS：posts 所有人可读，作者可增删改；post_likes 本人增删；like_count 由触发器维护
```

### 3.4 教室（P4 建表，先记录设计）

```sql
classrooms         ( owner_id, name, invite_code text unique )
classroom_members  ( classroom_id, user_id, role text check (role in ('teacher','student')), pk(classroom_id,user_id) )
class_sessions     ( classroom_id, started_at, ended_at, courseware jsonb )   -- 一次课
session_events     ( session_id, user_id, type text, payload jsonb )          -- 举手/答题/翻页流水
assignments        ( classroom_id, title, content jsonb, due_at )
submissions        ( assignment_id, user_id, content jsonb, score numeric, feedback text, graded_by uuid )
-- RLS：一律以 classroom_members 成员关系为界；评分字段仅教师可写
```

课堂报告 = 对 `session_events` 的聚合查询，不单独存表。

### 3.5 白板

```sql
whiteboards        ( owner_id, title, snapshot jsonb )        -- snapshot = 笔画数组定期落盘
whiteboard_members ( whiteboard_id, user_id, can_edit bool )
-- RLS：成员可读，can_edit 成员可写 snapshot
```

## 4. 实时方案

- 统一用 **Supabase Realtime**：
  - 教室上课页：`channel("session:<id>")`，broadcast 翻页/答题/举手事件，presence 做在线名单。
  - 白板：`channel("wb:<id>")`，broadcast 增量笔画（节流 30ms 批量发送），每 30s 或离开时把全量笔画写入 `snapshot`。
- 明确不引入的东西（除非用户批准）：Yjs/CRDT、自建 websocket 服务、tldraw/excalidraw 整库。白板首版手写 Canvas 实现，功能范围以 02-3.8 为限。

## 5. 内容渲染

- MDX：用 `next-mdx-remote-client` 或 Next 官方 `@next/mdx`（**实现前二选一报用户批准**），公式用 KaTeX（`rehype-katex` + `remark-math`），代码内不写公式渲染 hack。
- 图片一律 `next/image`；story 漫画页图片放 `public/story/` 或 Supabase Storage（超过 50MB 内容后迁 Storage，届时再议）。

## 6. 路由与 proxy 增量约定

- 新增受保护路由段时，必须同步更新 `src/proxy.ts` 的 `protectedPattern` 与 `[section]/page.tsx` 白名单，两处缺一不可。
- `/embed/*` 不带 locale 前缀，需在 proxy 的 matcher/逻辑中放行（不做登录跳转，不跑 intl 中间件重定向）。
- `[section]` 动态路由只服务「壳」阶段；板块做实后改为真实嵌套路由目录（如 `app/[locale]/games/page.tsx`），并从 `[section]` 白名单移除，避免双路由冲突。

## 7. 环境与部署备忘

- Supabase 自托管，开发环境 `192.168.5.213`；生产必须 HTTPS 域名（AGENTS.md 铁律）。
- 浏览器只可见 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。
- 部署目标未定（暂按自托管 Node 服务器 `next start` 规划），不要引入 Vercel 专属特性（如 `@vercel/og` 以外的 vercel 运行时 API）。
