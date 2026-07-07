# Mathin 整体规划 · 08 P4 教室与画板执行计划

> 本文是 P4 的权威执行计划，地位等同 `07-p3-notebook.md` 之于 P3。前置阅读：`00-overview.md`、`02-pages.md` §3.6/§3.8、`03-data-and-tech.md` §3.4/§3.5/§4、`04-roadmap.md` P4。
>
> P4 不是从零开发：功能原型已在旧项目 **mathin2025**（`D:\code\2025\mathin2025`）中跑通过一轮，更早的 **mathin-4-4**（`D:\code\2024\mathin-4-4\next`）留下了 yjs-supabase 协同的失败经验。本文先盘点旧资产与踩过的坑，再给出技术结论与任务拆分。执行 agent 迁移时**只搬运设计与算法，不复制粘贴旧代码风格**——新代码必须符合本仓库规范（设计 token、next-intl、`requireUser`、RLS、shadcn 优先）。

## 1. 范围与非目标

**做**（对应 04-roadmap P4 五条）：

1. 白板：独立可用的协作画板（`/whiteboard`），也是教室上课页的板书组件。
2. 教室结构：`classrooms` / `classroom_members`、邀请码加入、教室主页。
3. 上课页：课件翻页同步、学生答题与实时评分（星星）、插入 tools/白板、课堂报告。
4. 作业：布置 / 提交 / 批改。
5. dashboard 教室卡。

**不做**（旧项目有但明确放弃，除非用户重启议题）：

- mathin2025 的教培 CRM 全套：`teachers`/`students`/`classes`/`courses`/`rooms`/`attendance`、校区、课费、季节班型、学生编号序列。新项目的「教室」是轻量师生空间（老师开教室 + 邀请码），不是机构排课系统。
- 独立 `edu_core` schema：新表全部放 `public` schema，与 P2/P3 一致，靠 RLS 隔离。
- Yjs/CRDT、自建 websocket 服务、tldraw/excalidraw 整库（03-§4 约束继续有效，理由见 §3）。
- 评论、私信、多教师协作管理教室。

## 2. 旧资产盘点

### 2.1 迁移（设计与算法直接复用）

| 旧资产（mathin2025） | 内容 | 去处 |
| --- | --- | --- |
| `components/HandWriting/CanvasBoard.tsx` | 双层 canvas（落笔层 base + 预览层 draft）、perfect-freehand 笔迹渲染、0–1 归一化坐标（跨端分辨率无关）、四种橡皮（S/M/L 碎擦 + 整线擦命中检测）、ResizeObserver 自适应 | `src/features/whiteboard/` 画布核心，算法照搬、同步层重写（见 §3.2） |
| `components/HandWriting/CanvasStore.ts` | zustand 全局工具态（tool/color/size）、多画板注册与批量清空/保存 | 同上，保留 store 模式 |
| `components/HandWriting/WhiteToolbar.tsx` + `ColorSlider.tsx` | 工具条交互：橡皮子菜单记忆、预设色/自定义 HSL、粗细预设 | 重写为设计系统 6 色 + token，交互沿用 |
| `sessions/_components/usePageController.ts` | 翻页同步模式：**乐观更新 → 写库（权威） → broadcast（提示） → 失败回滚** | 上课页翻页，模式原样保留 |
| `sessions/_components/useStarsCounts.ts` + `StudentRanking.tsx` | 星星评分模式：**append-only 事件行 + 聚合查询 + broadcast 通知 revalidate + 乐观增减 + 原子撤销**（`remove_latest_star` 删最新一行而非做减法） | 上课页评分右栏；数据落 `session_events`，聚合思路不变 |
| `sessions/[sessionId]/demo/page.tsx` | 上课页布局：16:9 舞台自适应（宽高双向反算，绕过 Safari flex bug）、主画板按页隔离 + 副画板全课共享、课件图片/视频底层 + 板书覆盖层、指针工具时 `pointer-events:none` 穿透 | 上课页布局蓝本 |
| `board_pages` 快照 + 空页删除逻辑 | 快照为空数组时删行而非存空 | 白板快照持久化细节 |

### 2.2 借鉴教训后重写（旧实现的坑，见 §3.1）

- 白板同步层：旧版每笔一条 `board_ops` INSERT + 广播，需 RPC 定期清空操作流 → 新版**广播即时、持久化只走防抖快照**，删掉 op 流水表。
- 远端实时性：旧版对端只在 pointerup 后才看到整条笔迹 → 新版笔画进行中节流广播增量点。
- 频道安全：旧版 broadcast 频道完全公开，任何登录者可伪造翻页/加星事件 → 新版私有频道 + `realtime.messages` RLS（自托管 Realtime v2.102.3 已支持，实测容器健康）。

### 2.3 弃用（mathin-4-4 的 yjs-supabase 路线）

`utils/supabase/y-supabase.ts`（自研 SupabaseProvider）+ `note_diffs` 表的教训，作为决策依据记录：

1. **持久化失控**：每次防抖保存 INSERT 一行二进制 diff，`note_diffs` 只增不减，加载要 `mergeUpdatesV2` 全部历史行。
2. **带宽浪费**：resync 定时器每 5s 广播**全量** `encodeStateAsUpdate`，房间越久越大。
3. **无鉴权**：频道公开，任何人可注入 update。
4. **上游弃养**：y-supabase 作者自述不建议生产使用。

## 3. 技术结论

### 3.1 白板不需要 CRDT——这是本次「协同升级问题」的正面回答

07-p3 §8 留下的悬念是「P4 若教室/白板确需 CRDT 再引入 Hocuspocus」。结论：**不需要，P4 全程零 Yjs**。

- 白板的数据单元是**整条笔迹**（带 uuid），操作只有「加一条 / 删一条 / 清空」，天然可交换（commutative）：两人同时画互不冲突，乱序到达结果一致。CRDT 解决的是**同一数据单元内部**的并发合并（如同一段文字两人插字符），白板不存在这个问题。
- mathin-4-4 的痛苦来自 y-supabase 的实现质量（§2.3 四条），不是「缺 CRDT」；mathin2025 换成 op 广播后协同本身是好用的，痛点只剩持久化方式和频道安全（§2.2）——这两条本次修掉。
- 富文本多写者协同（notebook 双人同编一篇）才真正需要 Yjs，那不在 P4 范围；07-p3 §8 的 Hocuspocus 路径继续作为未来备选保留，不删。

### 3.2 白板同步架构（新）

```
绘制中   pointermove ──节流≈40ms──▶ broadcast stroke:progress {id, 新增点}   对端画在 draft 层
落笔完   pointerup   ────────────▶ broadcast stroke:commit  {完整 StrokeNorm} 对端落到 base 层
擦除     eraseLine/eraseFrag/clear ▶ broadcast 同旧版
光标     presence（Realtime presence，含用户名/颜色）
持久化   防抖(≈10s) + 每30s 定时 + 离开页面时：全量笔迹数组 → whiteboards.snapshot jsonb
晚加入   读 snapshot 兜底 + broadcast sync:request → 任一在线端回 sync:response 全量（按需，不定时轮播）
```

要点：

- **无 op 流水表**。任何已连接客户端内存里的笔迹 Map 就是全量状态（含收到的远端笔迹），谁保存快照都是完整的；`board_ops` 表和 `save_board_snapshot` 清流 RPC 整体删除。可接受的极端丢失窗口：绘制者在防抖间隔内崩溃且无其他在线端保存。
- **坐标契约**：归一化统一以 CSS 像素为基准（旧版混用了 `getBoundingClientRect` 的 CSS px 与 `canvas.width` 的设备 px，dpr≠1 时有隐性偏差，重写时修正并写单元注释）。
- 撤销 = 本地栈只记**自己的**笔迹 id，撤销即广播 `eraseLine`；不做全局历史。
- 导出 PNG = base canvas `toBlob`。
- 新依赖：`perfect-freehand`（约 4KB，无传递依赖）、复用已有 zustand；不新增其他包。

### 3.3 实时频道与鉴权

- 频道命名沿 03-§4：白板 `wb:<whiteboardId>`，上课 `session:<sessionId>`。
- **私有频道**：建 `realtime.messages` 的 RLS 策略——`wb:*` 校验 `whiteboard_members`（读=成员，写=can_edit），`session:*` 校验 `classroom_members`。客户端 `channel(name, { config: { private: true } })` 并 `realtime.setAuth(accessToken)`。
- **broadcast 永远只是提示，DB 才是权威**：翻页写 `class_sessions.current_page`（RLS 仅教师可 update）、加星/答题写 `session_events`（Server Action + 角色校验）。收广播只触发「跟随/刷新」，不直接信任 payload 里的业务数值。伪造广播最多让人白刷新一次。
- 降级路径（与 P3 同款纪律）：若私有频道在自托管实例上配置受阻，公开频道 + 上述「DB 权威」原则仍保证不可篡改，只损失防骚扰；在 PR 描述注明即可，不为此阻塞。Realtime Authorization 的开关在 compose env（`docs/supabase-self-hosting.md` 补记），agent 可 SSH 直接配置验证。

### 3.4 教室数据流

- 星星/答题/举手统一进 `session_events (session_id, user_id, type, payload)` append-only；排行 = 聚合查询（撤星沿旧版思路删该生最新一行 star 事件，SECURITY DEFINER RPC 保原子）。课堂报告 = 对 `session_events` 聚合，不建报告表（03-§3.4 已定）。
- 课件 = `class_sessions.courseware jsonb`：有序页数组，页类型 `image`（Storage 路径）| `tool`（tools registry id，iframe 嵌 `/embed/[tool]`）| `board`（空白板页）。不迁移旧 `resources`/`lectures` 资源库。
- 数据获取沿用本仓库既有模式（Server Action + zustand + broadcast 触发刷新），**不引入 SWR**（旧项目用 SWR，仅其「广播到达即 revalidate + 兜底轮询」的思路保留）。

## 4. 数据模型（migrations，经 SSH 直接执行）

按 03-§3.4/§3.5 落地，全部 `public` schema、全部开 RLS：

```sql
whiteboards        ( id, owner_id, title, snapshot jsonb default '[]', created_at, updated_at )
whiteboard_members ( whiteboard_id, user_id, can_edit bool default true, pk(whiteboard_id,user_id) )
-- owner 全权；成员可读；can_edit 成员可写 snapshot；owner 建行时触发器自动插入成员行

classrooms         ( id, owner_id, name, invite_code text unique, created_at )
classroom_members  ( classroom_id, user_id, role check in ('teacher','student'), pk(classroom_id,user_id) )
class_sessions     ( id, classroom_id, title, courseware jsonb, current_page int default 0,
                     started_at, ended_at )
session_events     ( id, session_id, user_id, type text, payload jsonb, created_at )
assignments        ( id, classroom_id, title, content jsonb, due_at, created_at )
submissions        ( id, assignment_id, user_id, content jsonb, submitted_at,
                     score numeric, feedback text, graded_by uuid, graded_at )
-- RLS 以 classroom_members 为界；current_page/评分字段仅教师可写；
-- 邀请码加入走 SECURITY DEFINER RPC（避免向非成员暴露 classrooms 全表读）
-- 私有频道：realtime.messages 增 wb:*/session:* 两条策略（见 §3.3）
```

细则：`invite_code` 用 8 位可读随机串，碰撞重试；`session_events` 建 `(session_id, type)` 索引；快照写入沿 P3 的 1MB 上限与尺寸校验纪律。

## 5. 前端架构

```
src/features/whiteboard/
  store.ts            # 工具态 + 画板注册（迁 CanvasStore）
  strokes.ts          # StrokeNorm 类型、perfect-freehand 渲染、命中检测（纯函数，可测）
  CanvasSurface.tsx   # 双层 canvas + pointer 逻辑（迁 CanvasBoard 绘制部分）
  useBoardSync.ts     # §3.2 同步协议（broadcast/presence/快照防抖）
  Toolbar.tsx         # 工具条（shadcn + 设计 token 六色）
  actions.ts          # 白板 CRUD / 快照保存 / 成员邀请
src/features/classroom/
  actions.ts          # 教室/课次/作业/事件 Server Actions（requireUser + 角色校验）
  usePageSync.ts      # 翻页同步（迁 usePageController 模式）
  useSessionEvents.ts # 星星/答题/举手（迁 useStarsCounts 模式，去 SWR）
  live/…              # 上课页组件（舞台、右栏、底部条）
```

- 路由：`/whiteboard`、`/whiteboard/[id]`、`/classroom`、`/classroom/[id]`、`/classroom/[id]/live/[session]`，全部在 `[locale]` 下、proxy 保护名单已含 whiteboard/classroom 前缀（核对 `src/proxy.ts`）。
- 上课页的板书 = 复用 whiteboard 的 `CanvasSurface`+`useBoardSync`，频道换 `session:<id>`、快照落 `session_events`（type=`board_snapshot`，payload 含 page 键；main 按页隔离、side 全课一块，沿旧版 pageKey=-1 约定）。
- 双语文案全部进 `messages/{zh,en}.json`（`whiteboard.*`、`classroom.*` 命名空间）。

## 6. 任务拆分（每条 = 一次提交，视觉节点截图报批）

- **P4-0 依赖与基建**：装 `perfect-freehand`；SSH 检查/开启 Realtime Authorization 并把结论写进 `docs/supabase-self-hosting.md`；roadmap 当前阶段标记移到 P4。
- **P4-1 白板单人闭环**：`whiteboards`/`whiteboard_members` migration；列表页 + 画布页；笔/四种橡皮/六色/粗细/撤销/清空/导出 PNG；防抖快照保存与恢复。验收：刷新后笔迹完整；未授权用户读他人白板被 RLS 拒。
- **P4-2 白板协同**：私有频道 broadcast 笔画流（含绘制中增量）+ presence 光标 + 邀请协作 + 晚加入同步。验收：双浏览器互见对方**正在画**的笔迹（不是画完才出现）；只读成员无法产生笔迹；连续绘制期间零数据库写入、停顿后单次快照写入。
- **P4-3 教室结构**：`classrooms`/`classroom_members` migration + 邀请码 RPC；教室列表（师/生视角）+ 新建 + 加入 + 教室主页骨架。验收：学生凭码入班、非成员访问教室页被拒。
- **P4-4 上课页·同步**：`class_sessions` migration + 课件管理（图片上传/工具页/白板页排序）；上课页布局（舞台 + 主/副板书 + 工具条）；教师翻页学生实时跟随；presence 在线名单。验收：翻页同步 <1s，学生端无翻页控制权（UI 隐藏 + RLS 拒写）。
- **P4-5 上课页·互动与报告**：`session_events` migration；举手、发题作答、星星评分（乐观 + 原子撤销）；下课生成课堂报告（聚合页）。验收：04-roadmap 的模拟课全流程（1 教师 + 2 学生）。
- **P4-6 作业与 dashboard**：`assignments`/`submissions` migration；布置/提交/批改三视图；dashboard 教室卡。验收：越权改分被 RLS 拒；全阶段 lint/typecheck/build 绿 + 四档视觉截图。

## 7. 执行 agent 常见坑（在 07-§10 基础上追加）

- 画布组件必须是 client 组件且不做 SSR（`next/dynamic` `ssr:false` 只能写在 client 组件里）。
- `supabase.channel()` 的清理：effect 返回里 `removeChannel`，依赖数组变化会重订阅——频道名里的变量（页码等）不要进频道名，进 payload 过滤（旧版 CanvasBoard 用一条频道 + payload 过滤 boardType/pageIndex，是对的）。
- broadcast `self: false` 记得配，否则自己的笔迹画两遍。
- 触摸设备：canvas 必须 `touch-none`，上课页容器禁用长按呼出菜单（旧 demo 页那组 `WebkitUserSelect/touchAction` 样式有效，保留）。
- 星星撤销不要用「count-1 写回」，沿用删最新一行的原子 RPC。
- 快照为空数组时删行/写空要与加载逻辑一致（旧版 `save_board_snapshot` 的空页分支教训）。
- 秘钥纪律与 migration SSH 流程同 P3（`docs/supabase-self-hosting.md`）。
