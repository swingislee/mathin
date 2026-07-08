# Mathin 整体规划 · 08 P4 教室与画板执行计划

> 本文是 P4 的权威执行计划，地位等同 `07-p3-notebook.md` 之于 P3。前置阅读：`00-overview.md`、`02-pages.md` §3.6/§3.8、`03-data-and-tech.md` §3.4/§3.5/§4、`04-roadmap.md` P4。
>
> P4 不是从零开发：功能原型已在旧项目 **mathin2025**（`D:\code\2025\mathin2025`）中跑通过一轮，更早的 **mathin-4-4**（`D:\code\2024\mathin-4-4\next`）留下了 yjs-supabase 协同的失败经验。本文先盘点旧资产与踩过的坑，再给出技术结论与任务拆分。执行 agent 迁移时**只搬运设计与算法，不复制粘贴旧代码风格**——新代码必须符合本仓库规范（设计 token、next-intl、`requireUser`、RLS、shadcn 优先）。
>
> **v2 修订（2026-07-07）**：应用户要求，上课面板整体改为**离线优先**架构（见 §3.4）——一堂课在候课时预载完成后，断网应可完整上完；加星面板以「教师手持平板轻松记录实时学情」为源头需求重新设计（§3.5）。

## 1. 范围与非目标

**做**（对应 04-roadmap P4 五条 + 离线优先修订）：

1. 白板：独立可用的协作画板（`/whiteboard`），也是教室上课页的板书组件。
2. 教室结构：`classrooms` / `classroom_members`、邀请码加入、教室主页。
3. 上课页：**候课预载 → 离线可上完整课**；课件翻页同步、加星评分（平板面板）、举手答题、插入 tools/白板、课堂报告；网络恢复后事件回传。
4. 作业：布置 / 提交 / 批改。
5. dashboard 教室卡。

**不做**（旧项目有但明确放弃，除非用户重启议题）：

- mathin2025 的教培 CRM 全套：`teachers`/`students`/`classes`/`courses`/`rooms`/`attendance`、校区、课费、季节班型、学生编号序列。新项目的「教室」是轻量师生空间（老师开教室 + 邀请码），不是机构排课系统。
- 独立 `edu_core` schema：新表全部放 `public` schema，与 P2/P3 一致，靠 RLS 隔离。
- Yjs/CRDT、自建 websocket 服务、tldraw/excalidraw 整库（03-§4 约束继续有效，理由见 §3.1）。
- 完整 PWA/Service Worker 离线（00 长期暂缓项）。P4 的离线 = **页面不刷新前提下的整课离线**（§3.4）；「离线中刷新页面还能活」需要 SW 预缓存 app shell，属 PWA 议题，如实测中刷新致死成为高频事故再报用户重启该议题。
- 评论、私信、多教师协作管理教室。

## 2. 旧资产盘点

### 2.1 迁移（设计与算法直接复用）

| 旧资产（mathin2025） | 内容 | 去处 |
| --- | --- | --- |
| `components/HandWriting/CanvasBoard.tsx` | 双层 canvas（落笔层 base + 预览层 draft）、perfect-freehand 笔迹渲染、0–1 归一化坐标（跨端分辨率无关）、四种橡皮（S/M/L 碎擦 + 整线擦命中检测）、ResizeObserver 自适应 | `src/features/whiteboard/` 画布核心，算法照搬、同步层重写（见 §3.2） |
| `components/HandWriting/CanvasStore.ts` | zustand 全局工具态（tool/color/size）、多画板注册与批量清空/保存 | 同上，保留 store 模式 |
| `components/HandWriting/WhiteToolbar.tsx` + `ColorSlider.tsx` | 工具条交互：橡皮子菜单记忆、预设色/自定义 HSL、粗细预设 | 重写为设计系统 6 色 + token，交互沿用 |
| `sessions/_components/usePageController.ts` | 翻页同步模式：乐观更新 → 持久化 → 广播 | 上课页翻页；「失败回滚」在离线态改为「入队不回滚」（§3.4） |
| `sessions/_components/useStarsCounts.ts` + `StudentRanking.tsx` | 星星评分模式：**append-only 事件行 + 聚合查询 + 广播通知刷新 + 乐观增减 + 原子撤销**（删最新一行而非 count−1） | §3.5 加星面板；数据落 `session_events`，聚合思路不变 |
| `sessions/[sessionId]/demo/page.tsx` | 上课页布局：16:9 舞台自适应（宽高双向反算，绕过 Safari flex bug）、主画板按页隔离 + 副画板全课共享、课件底层 + 板书覆盖层、指针工具时 `pointer-events:none` 穿透 | 上课页布局蓝本 |
| `board_pages` 快照 + 空页删除逻辑 | 快照为空数组时删行而非存空 | 白板快照持久化细节 |

### 2.2 借鉴教训后重写（旧实现的坑）

- 白板同步层：旧版每笔一条 `board_ops` INSERT + 广播，需 RPC 定期清空操作流 → 新版**广播即时、持久化只走防抖快照**，删掉 op 流水表。
- 远端实时性：旧版对端只在 pointerup 后才看到整条笔迹 → 新版笔画进行中节流广播增量点。
- 频道安全：旧版 broadcast 频道完全公开，任何登录者可伪造翻页/加星事件 → 新版私有频道 + `realtime.messages` RLS（自托管 Realtime v2.102.3 已支持，实测容器健康）。
- 页面卸载时异步保存竞态：旧版在 effect cleanup 里 fire-and-forget 调 `saveAll` → 新版笔迹按页存 store（canvas 无状态化，切页重绘），保存与组件生命周期解耦。

### 2.3 弃用（mathin-4-4 的 yjs-supabase 路线）

`utils/supabase/y-supabase.ts`（自研 SupabaseProvider）+ `note_diffs` 表的教训，作为决策依据记录：

1. **持久化失控**：每次防抖保存 INSERT 一行二进制 diff，`note_diffs` 只增不减，加载要 `mergeUpdatesV2` 全部历史行。
2. **带宽浪费**：resync 定时器每 5s 广播**全量** `encodeStateAsUpdate`，房间越久越大。
3. **无鉴权**：频道公开，任何人可注入 update。
4. **上游弃养**：y-supabase 作者自述不建议生产使用。

## 3. 技术结论

### 3.1 白板不需要 CRDT——「协同升级问题」的正面回答

07-p3 §8 留下的悬念是「P4 若教室/白板确需 CRDT 再引入 Hocuspocus」。结论：**不需要，P4 全程零 Yjs**。

- 白板的数据单元是**整条笔迹**（带 uuid），操作只有「加一条 / 删一条 / 清空」，天然可交换（commutative）：两人同时画互不冲突，乱序到达结果一致。CRDT 解决的是**同一数据单元内部**的并发合并（如同一段文字两人插字符），白板不存在这个问题。
- 课堂数据（翻页、加星、答题）更进一步是**单写者或按人分流**的：翻页/加星只有教师写，答题各写各的——离线合并也不存在冲突。这是 §3.4 离线架构能保持简单的根本原因。
- mathin-4-4 的痛苦来自 y-supabase 的实现质量（§2.3），不是「缺 CRDT」。富文本多写者协同（notebook 双人同编一篇）才真正需要 Yjs，不在 P4 范围；07-p3 §8 的 Hocuspocus 路径继续作为未来备选保留。

### 3.2 白板同步架构

```
绘制中   pointermove ──节流≈40ms──▶ stroke:progress {id, 新增点}    对端画在 draft 层
落笔完   pointerup   ────────────▶ stroke:commit  {完整 StrokeNorm} 对端落到 base 层（自愈丢包）
擦除     eraseLine / eraseFrag / clear
光标     presence（含用户名/颜色）
持久化   防抖(≈10s) + 每30s 定时 + 离开时：全量笔迹数组 → whiteboards.snapshot jsonb
晚加入   读 snapshot 兜底 + sync:request → 任一在线端回 sync:response 全量（按需，分块发送）
```

要点：

- **无 op 流水表**。任何已连接客户端内存里的笔迹 Map 就是全量状态，谁保存快照都是完整的；`board_ops` 表和清流 RPC 整体删除。
- **坐标契约**：归一化统一以 CSS 像素为基准（旧版混用 CSS px 与设备 px，dpr≠1 时有隐性偏差，重写时修正）。
- 撤销 = 本地栈只记**自己的**笔迹 id，撤销即发 `eraseLine`；不做全局历史。导出 PNG = base canvas `toBlob`。
- **画布比例（用户 2026-07-08 拍板）**：独立白板 16:9；**上课页主板书必须 4:3**（16:9 屏幕里要同时放 4:3 课件 + 主板书 + 学生名录）。`CanvasSurface` 对比例无感知——笔迹相对父容器归一化，父容器给什么纵横比就是什么，两处直接复用同一组件。
- 独立白板（`/whiteboard/[id]`）的传输走 T2 服务器通道即可（§3.4 的 T0/T1 是课堂专属增强，白板组件对传输层无感知）。
- 新依赖：`perfect-freehand`（约 4KB 无传递依赖）；复用已有 zustand。

### 3.3 实时频道、鉴权与权威模型

- 频道命名沿 03-§4：白板 `wb:<whiteboardId>`，上课 `session:<sessionId>`。
- **私有频道**：建 `realtime.messages` 的 RLS 策略——`wb:*` 校验 `whiteboard_members`（读=成员，写=can_edit），`session:*` 校验 `classroom_members`。客户端 `channel(name, { config: { private: true } })` + `realtime.setAuth(accessToken)`。
- **权威模型（v2 修订）**：
  - **上课期间**：教师主控设备是权威（单写者），所有课堂事件先落本地事件流（§3.4），广播/回传都只是这条流的传输与收敛。离线时翻页**不回滚、入队**。
  - **课后与在线旁观**：DB 是收敛后的权威记录。远端学生跟随、课堂报告、历史回看一律以 DB 为准。
  - broadcast payload 永远只是提示，接收端不直接信任其中的业务数值；伪造广播最多让人白刷新一次。
- **自托管 Realtime 限额（实测 `_realtime.tenants`）**：`max_events_per_second=100`、`max_bytes_per_second=100KB`、`max_concurrent_users=200`——**全站共享**。P4-0 需 SSH 调高（笔画流一人就占 ~25 msg/s），且这是「课堂同步不能全押服务器通道」的硬佐证。
- 降级纪律同 P3：私有频道配置受阻不阻塞（公开频道 + DB 权威仍不可篡改），PR 描述注明。

### 3.4 课堂离线优先架构（v2 新增，源头需求：上课稳定不依赖网络）

**部署事实**：自托管 Supabase 在家庭局域网（192.168.5.x）；上课地点若在外部场地，教室里只有本地 WiFi/热点，外网可能不稳或没有。结论：课堂的实时性必须由**教室内部**保证，服务器只做课前准备与课后归档。

**一堂课的生命周期**：

1. **备课（在线）**：建课次、上传课件、排页（图片/工具页/白板页）。**试讲**（P4-6 补，用户需求：备课 ≠ 正式上课）：`/live?mode=rehearsal`，教师直达舞台预演——事件流为纯内存 ephemeral（不写 outbox、不挂 T0/T1/T2、不动 `started_at`/`current_page`），已下课的课次也可试讲 = 课后复盘随手写画不留痕。
2. **候课（在线，开课前）**：进入候课检查单页——①课件全部页下载为 blob 存入 IndexedDB；②名单与历史数据载入；③多设备配对（§T1 握手）与联机自检；④申请 Screen Wake Lock。**全绿才亮「开始上课」**。
3. **上课（可完全离线）**：一切操作先写本地（内存 + IndexedDB outbox），UI 零等待网络；教室内设备经 T0/T1 互相同步；有外网时 T2 并行走一份。**上课页内零路由跳转**——翻页、开白板、发题全部是页内状态切换，绝不触发 Next.js 导航（离线时拉不到 chunk 就死）。
4. **课后（网络恢复）**：outbox 幂等回传 `session_events` 与板书快照；报告基于服务器聚合。**重新开课**（P4-6 补）：下课横幅上教师可一键重开——清 `ended_at` + 再发一条 `session_ctl start`（reducer 里 start 同时清 ended，按时间序回放收敛到最后一次状态），误点下课/拖堂续讲都走这条路。

**同步三层**（同一事件流的三种传输层，自动级联，业务代码无感知）：

| 层 | 通道 | 场景 | 可靠性 |
| --- | --- | --- | --- |
| **T0 同设备多窗** | BroadcastChannel API | 平板/电脑 HDMI 或投屏接大屏，展示窗 + 控制窗同一设备 | 零网络依赖，**物理课堂的推荐保底形态** |
| **T1 局域网 P2P** | WebRTC DataChannel | 教师平板 ↔ 教室大屏电脑（多设备） | 候课时经 T2 信令握手；建立后不依赖外网存续 |
| **T2 服务器** | Supabase Realtime broadcast | 在线时始终并行；远端学生/旁观依赖它 | at-most-once，不承担课堂可靠性 |

**事件模型**：

- 课堂事件 = `{ id: uuid(客户端生成), device_id, seq(每设备单调递增), type, payload, at(客户端时间) }`。
- 去重靠 `(device_id, seq)`；排序靠单写者天然有序（翻页/加星只有教师设备写，答题按学生分流），**不依赖时钟对齐**。
- 传输层双载荷（P4-5 起）：`ev` 持久事件（进 outbox 回传 DB、晚加入可重放）与 `fx` 短命效果（板书笔迹 op/绘制中增量、视频对时——高频、可丢、不落库；最终状态由对应持久事件收敛，如 `board_snapshot`）。
- 回传：`insert … on conflict (id) do nothing`，分批 + 指数退避；恢复网络先 `refreshSession()`（JWT 一小时过期，长课 + 断网后旧 token 必失效）再 flush。
- T1 细节：信令（SDP/ICE）在候课时经 T2 交换；DataChannel 消息 >16KB 分块；教室 WiFi 若开 AP 隔离 P2P 会失败——候课自检直接测通断亮红/绿灯，红灯时提示「改用手机热点或单设备双窗（T0）」。离线中刷新页面 = T1 无法重新握手（信令需要服务器），自检文案要写明「上课中勿刷新」。
- **T1 跨设备直连依赖局域网 coturn（P4-6 实测结论）**：浏览器把 host 候选混淆成 mDNS `.local` 名——同机双浏览器能解析（本机应答），手机↔电脑跨 AP/有线边界组播常被路由器丢弃，host 对全废；公网 STUN 在国内不可达（Google 被墙、Cloudflare UDP 不稳）。解法 = 在 supabase 宿主机（192.168.5.183，docker 容器 `coturn`，UDP 3478 + 中继段 49160–49200，ufw 已放行 192.168.5.0/24）跑 coturn：**LAN STUN 返回的 srflx 就是客户端真实局域网地址**（中间无 NAT），绕开 mDNS；LAN TURN 兜底 AP 隔离（中继仍在局域网内，断外网可用）。ICE 地址经 `NEXT_PUBLIC_WEBRTC_STUN/TURN/TURN_USER/TURN_PASS` env 注入（见 `.env.example`），TURN 密码在 xiaomi `~/services/coturn-turn-pass.txt`。验收方式：Playwright 学生端加 `--force-webrtc-ip-handling-policy=default_public_interface_only` 隐藏全部 host 候选，等价模拟手机 mDNS 失效，仍必须连通。

### 3.5 加星面板（从源头需求设计）

源头需求：**老师手里拿着平板，以最轻的操作实时记录学情，结果立刻出现在大屏上。**

- 控制端（平板，横屏）：学生卡片网格，触控目标 ≥44px；**点卡片 = +1 星**，本地回显 <1 帧（先画后传）；长按 = 撤销该生最新一颗星（沿旧版原子语义：删最新一行事件，绝不 count−1 写回）；星多时折叠为 `★×n`。
- 展示端（大屏）：星星落到学生名字上有轻量动画（尊重 `prefers-reduced-motion`），经 T0/T1 延迟应在百毫秒级。
- 加星只是 `session_events` 的一种 type（`star` / `star_undo`），走 §3.4 的统一事件流——离线可用是自动获得的，不是单独实现的。
- 面板同时是出勤/举手/答题状态的实时视图（同一事件流的不同 type 聚合）。

### 3.6 教室数据流

- 星星/答题/举手/板书快照统一进 `session_events` append-only；排行与报告 = 聚合查询，不建报告表（03-§3.4 已定）。
- 课件 = `class_sessions.courseware jsonb`：有序页数组（每页带客户端 uuid），页类型：
  - `image` / `video`：Storage 路径（私有 bucket `courseware`，见 §4）。候课时 `storage.download()` 为 blob 存 IndexedDB。**视频跨端同步播放（用户 2026-07-08 要求）**：教师端是唯一控制者，play/pause/seek 走持久事件 `video_ctl`（晚加入重放到位），播放中每 4s 一发 fx 对时（可丢），跟随端漂移 >1s 才校正；自动播放被浏览器策略拦截时降级静音播放 + 「开启声音」按钮。
  - `game`（**用户 2026-07-08 拍板：项目游戏可作为课件页插入课堂，师生实时交互演示**）：`{ gameId, difficulty, seed }`——本项目游戏题面由 `createRng(seed)` 确定性推导（P2 既有约束），游戏页**零资源预载、天然离线**，候课单直接绿灯。上课页实时互动（P4-5 已落）：三游戏共用轻状态 `{values, selected}`，教师操作防抖 350ms 发 `game_state` 全量镜像（单写者），大屏/学生端只读跟随。
  - `board`：空白板页（主板书区变整页白板）。既可备课时排入，也可**上课中临时插入**（`page_insert` 持久事件 + 在线时回写 courseware；离线晚加入者靠事件重放还原排布）。
  - **工具快捷窗（用户 2026-07-08 拍板，取代原「tool 页暂缓」结论）**：tools 是本仓组件（`tools/registry.ts` 直接渲染 `Component embedded`），**不走 iframe、零网络、天然离线**——原暂缓理由不成立。形态与游戏页不同：不是课件页而是**上课中随叫随到的浮窗**（教师经 `tool_ctl` 事件镜像开/关，全端同步弹出；窗内操作各端本地交互，学生可跟着摆弄，输入镜像等有真实教学场景再议）。
- 不迁移旧 `resources`/`lectures` 资源库表结构（courses→lectures→lecture_resources 三层是教培排课体系的一部分，随 CRM 一起放弃；新模型课件直接内嵌在课次 jsonb 里）。**旧演示资源可用**：`.claude/过往实践/01_Preliminary_graphics_rules/` 是「图形规律初步」一讲的 28 页图片+动画（Supabase Storage 磁盘目录格式，每个文件名是目录、内含版本 uuid 文件），`supabase_data.sql` 里 `edu_core.resources` 有对应中文页标题（课前热身/追本溯源/新知探索/选题/捉虫时刻/总结/闯关）——验证与演示时按此顺序组一堂真实结构的课。
- 数据获取沿本仓库既有模式（Server Action + zustand），**不引入 SWR**；「广播到达即刷新 + 兜底轮询」思路保留。
- **舞台课件图不用 `next/image`**（优化器在服务端，离线即死）：候课预载的 blob 经 `URL.createObjectURL` 直接给原生 `<img>`/`<video>`。这是对 03-§5「图片一律 next/image」的**明确豁免**，仅限上课页舞台。

## 4. 数据模型（migrations，经 SSH 直接执行）

按 03-§3.4/§3.5 落地，全部 `public` schema、全部开 RLS：

```sql
whiteboards        ( id, owner_id, title, snapshot jsonb default '[]', created_at, updated_at )
whiteboard_members ( whiteboard_id, user_id, can_edit bool default true, pk(whiteboard_id,user_id) )
-- owner 全权；成员可读；can_edit 成员可写 snapshot；owner 建行时触发器自动插成员行

classrooms         ( id, owner_id, name, invite_code text unique, created_at )
classroom_members  ( classroom_id, user_id, role check in ('teacher','student'), pk(classroom_id,user_id) )
class_sessions     ( id, classroom_id, title, courseware jsonb, current_page int default 0,
                     started_at, ended_at )
session_events     ( id uuid pk,             -- 客户端生成，幂等回传的关键
                     session_id, user_id, device_id text, seq bigint,
                     type text, payload jsonb, at timestamptz,   -- 客户端时间，报告展示用
                     created_at timestamptz default now(),        -- 服务器时间，仅审计
                     unique(session_id, device_id, seq) )
-- Storage：私有 bucket `courseware`（select=教室成员、insert/delete=教师，路径首段=classroom_id）；
-- 图片/视频体积远超笔记贴图，bucket 级 file_size_limit 放宽，客户端直传
assignments        ( id, classroom_id, title, content jsonb, due_at, created_at )
submissions        ( id, assignment_id, user_id, content jsonb, submitted_at,
                     score numeric, feedback text, graded_by uuid, graded_at )
-- RLS 以 classroom_members 为界；current_page/评分/star 类事件仅教师可写；
-- 邀请码加入走 SECURITY DEFINER RPC（避免向非成员暴露 classrooms 全表读）；
-- session_events 不设「下课后禁写」时间锁——离线课的事件必然晚到
-- 私有频道：realtime.messages 增 wb:*/session:* 两条策略（§3.3）
```

细则：`invite_code` 8 位可读随机串碰撞重试；`session_events` 建 `(session_id, type)` 索引；快照写入沿 P3 的 1MB 上限纪律。

## 5. 前端架构

```
src/features/whiteboard/
  store.ts            # 工具态 + 按页笔迹 Map（canvas 无状态化）
  strokes.ts          # StrokeNorm 类型、perfect-freehand 渲染、命中检测（纯函数）
  CanvasSurface.tsx   # 双层 canvas + pointer 逻辑
  useBoardSync.ts     # §3.2 协议，传输层可注入（独立白板注入 T2；课堂注入事件层）
  Toolbar.tsx         # 工具条（shadcn + 设计 token 六色）
  actions.ts          # 白板 CRUD / 快照保存 / 成员邀请
src/features/classroom/
  sync/
    eventlog.ts       # 课堂事件流：uuid/device_id/seq、内存态、IndexedDB outbox
    transports.ts     # T0 BroadcastChannel / T1 WebRTC / T2 Realtime，级联与健康态
    flush.ts          # 幂等回传：refreshSession → 分批 insert → 退避重试
  actions.ts          # 教室/课次/作业 Server Actions（requireUser + 角色校验）
  prep/…              # 候课检查单（预载、配对、自检、Wake Lock）
  live/…              # 上课页（舞台、加星面板、右栏、底部条）——页内状态机，零导航
```

- 路由（P4-4 落地形态）：`/whiteboard`、`/whiteboard/[id]`、`/classroom`、`/classroom/[id]`、`/classroom/[classId]/session/[sessionId]`（课件管理）、`…/session/[sessionId]/live`（候课与上课同一路由——候课→上课是页内状态切换而非导航，`?role=display` 区分展示窗），全部在 `[locale]` 下；`src/proxy.ts` 的 `/classroom` 前缀保护已覆盖。
- 上课页板书 = 复用 `CanvasSurface`+`useBoardSync`，传输层注入课堂事件层；快照落 `session_events`（type=`board_snapshot`，payload 含 page 键；main 按页隔离、side 全课一块，沿旧版 pageKey=-1 约定）。
- 双语文案进 `messages/{zh,en}.json`（`whiteboard.*`、`classroom.*`）。

## 6. 任务拆分（每条 = 一次提交，视觉节点截图报批）

- **P4-0 依赖与基建**：装 `perfect-freehand`；SSH 调高 `_realtime.tenants` 限额并验证 Realtime Authorization，结论写进 `docs/supabase-self-hosting.md`；roadmap 标记（已完成）。
- **P4-1 白板单人闭环**：`whiteboards`/`whiteboard_members` migration；列表页 + 画布页；笔/四种橡皮/六色/粗细/撤销/清空/导出 PNG；防抖快照保存与恢复。验收：刷新后笔迹完整；未授权读他人白板被 RLS 拒。
- **P4-2 白板协同（T2）**：私有频道笔画流（含绘制中增量）+ presence 光标 + 邀请协作 + 晚加入同步。验收：双浏览器互见对方**正在画**的笔迹；只读成员无法产生笔迹；连续绘制期间零 DB 写入、停顿后单次快照。
- **P4-3 教室结构**：`classrooms`/`classroom_members` migration + 邀请码 RPC；教室列表（师/生视角）+ 新建 + 加入 + 教室主页骨架。验收：学生凭码入班、非成员访问被拒。
- **P4-4 课堂事件层与候课**：`class_sessions`/`session_events` migration + `courseware` bucket；`sync/` 三件套（先 T0 + outbox + flush，T1 留接口）；课件管理（图片/视频上传、插游戏页/白板页、排序）；候课检查单（blob 预载、Wake Lock、自检）；**最小上课壳**（课件页展示 + 翻页 + 简版加星，`?role=display|control` 双窗）供事件层验收。验收：**拔网线测试**——断网状态下 T0 双窗完整走完翻页+加星，恢复网络后事件完整入库、无重复。
- **P4-5 上课页·同步与互动**：舞台正式布局（4:3 课件/主板书 + 副板书 + 名录）+ 主/副板书（笔迹 op 走 fx 短命通道、快照落 `board_snapshot`，main 按页 uuid 隔离、side 全课一块）+ §3.5 加星面板（点卡 +1、长按撤销）+ 游戏页实时互动（`game_state` 镜像）+ 视频同步播放（`video_ctl`）+ 工具快捷窗（`tool_ctl`）+ 上课中临时插白板页（`page_insert`）+ 举手/发题/作答 + presence 在线名单（在线场景）。验收：04-roadmap 模拟课（1 教师 + 2 学生）+ 离线课（教师单机双窗）双场景通过。
- **P4-6 局域网 P2P（T1）**：WebRTC 配对（候课信令握手，T2 同频道 `p2p-signal` 事件）+ DataChannel 传输层（ev/fx 双载荷、>9KB 分块、ping 测延迟、12s 看门狗拆卡死协商重配）+ 自检红绿灯与热点提示 + **局域网 coturn**（§3.4，跨设备直连的先决条件）。随轮补：备课试讲模式（rehearsal ephemeral 事件流）与下课后重新开课（生命周期缺口，用户实测提出）。验收（2026-07-08 已过）：学生端隐藏全部 host 候选（模拟手机 mDNS 失效）仍经 LAN srflx 直连、往返 ≤1ms；试讲零落库；下课→重开双端收敛。
- **P4-7 报告、作业与 dashboard**：课堂报告聚合页；`assignments`/`submissions` migration + 布置/提交/批改三视图；dashboard 教室卡。验收：越权改分被 RLS 拒；全阶段 lint/typecheck/build 绿 + 四档视觉截图。

排序理由：T0+outbox（P4-4）先于 T1（P4-6）——单设备双窗 + HDMI 已能保底完成「离线上完整课」的核心场景，WebRTC 是不确定性最大的一块，独立成期、失败不阻塞。

## 7. 隐含坑清单（执行 agent 必读，在 07-§10 基础上追加）

**Realtime / 网络层**

- broadcast 是 **at-most-once**：无 ack、无重放、限流时静默丢弃。任何依赖它的状态都要有自愈路径（`stroke:commit` 带全量点、聚合数据靠「通知到达即重查」）。
- 自托管租户限额 100 events/s、100KB/s **全站共享**（§3.3），P4-0 必须先调高；频道名里不要放页码等易变量（旧版一条频道 + payload 过滤是对的，频道重建成本高）。
- `realtime.setAuth`：JWT 一小时过期，长课必须在 token 刷新时重新 setAuth，否则私有频道静默掉线；presence 抖动（重连引发离开/加入风暴）要在 UI 层去抖。
- supabase-js 在断网时请求会长时间悬挂：outbox flusher 一律 `AbortController` 短超时 + `navigator.onLine` 预判 + 指数退避；Realtime 自动重连的退避参数要配置，避免离线时重连风暴耗电（平板场景）。

**离线 / 设备层**

- **上课页内禁止路由跳转**：离线时任何 Next.js 导航都可能拉不到 chunk 直接白屏。翻页/开白板/发题都是页内状态。同理，离线中刷新页面必死（无 SW），候课页要写明「上课中勿刷新」并尽量用 Wake Lock 防锁屏。
- iOS Safari：后台页签会被冻结/回收（WebSocket 断、定时器停，回来可能整页重载）——课堂设备建议引导访问/单应用模式；`navigator.storage.persist()` 申请持久存储（Safari 对 IndexedDB 有 7 天回收策略）。
- canvas 内存：iOS 对画布总面积有硬上限。**不为每页保留 canvas 实例**，笔迹数据在 store、切页时重绘（这同时消灭了旧版 unmount 异步保存竞态）。
- 触控：stylus/手写笔用 `pointerType` 区分做防误触（手掌拒绝）；容器保留旧版 `touch-none`/`WebkitUserSelect` 全套；橡皮光标是自绘 div，别用系统 cursor。
- 时钟不可信：跨设备排序用 `(device_id, seq)`，报告展示用事件自带 `at` 并容忍乱序；绝不用服务器 `created_at` 排课堂时间线（离线事件是晚到的）。

- **局域网 HTTP 是非安全上下文**（开发经 `http://192.168.5.213:3130`、上课设备走本地 IP 时同理）：`crypto.randomUUID`、Wake Lock、Service Worker、剪贴板等 API 不存在或被禁。所有此类调用必须能力检测 + 兜底（uuid 用 `crypto.getRandomValues` 手拼 v4，见 `strokes.ts` 的 `newStrokeId`；Wake Lock 缺失时候课单降级为「请手动关闭自动锁屏」提示）。生产 HTTPS 后自然恢复，但**不得假设安全上下文存在**。

**数据 / 逻辑层**

- 星星撤销 = 删该生最新一行事件（原子 RPC 或单写者本地裁决），**绝不 count−1 写回**。
- 快照为空数组时删行/写空要与加载逻辑一致（旧版 `save_board_snapshot` 空页分支教训）。
- 幂等回传依赖客户端 uuid 主键 + `on conflict do nothing`；分批提交，单批失败不影响已成功批次（记录 flush 水位）。
- `session_events` 不设时间锁，但 RLS 必须校验 `user_id = auth.uid()` 且教师专属 type（star/翻页/评分）校验成员角色——离线晚到不等于放松鉴权。
- broadcast `self: false` 记得配，否则自己的笔迹画两遍；`removeChannel` 在 effect cleanup 里做。
- WebRTC DataChannel 单条消息 >16KB 要分块（`sync:response` 全量状态尤其）；SDP 信令只在候课期做，掉线重握手需要回到有网环境。
- 秘钥纪律与 migration SSH 流程同 P3（`docs/supabase-self-hosting.md`）。
