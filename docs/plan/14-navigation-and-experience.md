# Mathin 整体规划 · 14 导航与体验骨架（页面之间 · 动作之后 · 会话之间 · 层级之内）

> 本文与 `13-foundations-and-hardening.md` 是一对：13 号补后端横切地基（审计/事件/测试），14 号补**前端体验骨架**。两者是同一个洞的两端——13 号的 `domain_events` 一旦落地，14 号的"未读/变化流"UI 才有数据源；**§4 明确依赖 13-§3.1**，两份计划必须咬合执行。
>
> **本文来自四轮 UX 审计的收敛结论**：Mathin 的每一个页面/组件大多**单件做得对**（`match.tsx` 有 `aria-live`、staff actions 有错误码白名单、Radix 弹层焦点管理完善），但**页面之间、动作之后、会话之间、层级之内的"连接组织"系统性缺席**。系统连续地建模了数据与权限，却几乎没有建模**用户的旅程**——他在哪、来自哪、离开时留下什么、回来时错过什么、能否被所有人走完。四轮观察是同一根脊柱的四个切面：
>
> | 切面 | 缺什么 | 本文对应 |
> | --- | --- | --- |
> | 宏观·页面之间 | 板块间无持久导航，学完一个知识点无处可去 | §2 |
> | 微观·动作之后 | 提交无确认、失败一句笼统话、完赛无出口 | §3 |
> | 时间·会话之间 | 无未读/变化/待办/继续，每次登录冷启动 | §4（依赖 13-§3.1） |
> | 空间·层级之内 | 无面包屑、无障碍斑块、切语言丢位置 | §5 |
>
> **定位**：本文是横切**体验**线，非新功能板块。任务用 `P4F-*` 前缀，与 P4D/P4E 交错执行（见 §9）。前置阅读：`01-design-system.md`（token/组件三变体，本文所有新组件必须走设计系统）、`02-pages.md`（各页布局）、`00-overview.md`（九板块与导航层级现状）。执行纪律同前：本文没写的视觉决策停下来问用户；新组件先查 shadcn/ui（全局铁律）；每条任务一次提交，提交前 `pnpm lint && pnpm typecheck && pnpm build`（先停 dev server）；所有文案走 next-intl 双语同步。

---

## 1. 范围与非目标

**范围**：四轮 UX 审计的 16 个观察，按"四切面 + 共享原语 + 移动端"归类。每项给现状证据（已核实到具体文件/行）、组件级钩子、验收标准。核心主张：**立一层共享交互原语（导航层 + 反馈原语 + 变化流 + 面包屑/无障碍基线），比逐页打补丁杠杆高一个数量级。**

**非目标**：
- 不重做已验证优秀的单件（`match.tsx` 无障碍、Radix 弹层、staff 错误码范式保留并**推广**，不推翻）。
- 不做社交向消息系统（评论/私信/关注仍暂缓）；§4 的"变化流"是**运营/学情通知**（课评发布、作业批改、缴费到期、跟进分派），走 13-§3.1 `domain_events`，与社交无关。
- 不引入重前端框架/状态库；zustand（P3 已用）+ Server Components + shadcn 足够。新增依赖仅 `sonner`（shadcn 官方 toast），报批后 `pnpm dlx shadcn@latest add sonner`。

---

## 2. 宏观层：贯穿全站的板块导航（页面之间）

### 2.1 公开五板块之间无持久导航——"漫游"是伪命题

**现状证据**：`src/components/site-header.tsx` 顶栏只有 Logo + `LocaleSwitcher` + `ThemeToggle` + `UtilitySheet`（汉堡）。五个公开板块（story/games/minds/terms/tools）**只作为星球存在于首页** `src/app/[locale]/page.tsx`（第 23–27 行 planet 定义）。`UtilitySheet`（`utility-sheet.tsx` 第 9 行 `items`）只含四个**受保护**板块。**两套互不相交的导航宇宙**：首页星球图（公开）+ 抽屉（功能），中间无统一切换器。用户点进 `/terms` 想去 `/games`，唯一路径是 Logo→首页→再点——每次横向跳转强制绕经首页。

**修法**：
1. 顶栏或抽屉加一层**全站板块导航**（九板块统一入口，按登录态显隐功能板块）。视觉走小王子星球语言，避免退化成普通导航条——顶栏展开的星球带
2. `UtilitySheet` 从"只有功能板块"扩为"公开 5 + 功能 4 两组"，成为全站统一的板块跳板。

**验收**：从任意板块内页，一步可达其余任意板块，不经首页中转。

### 2.2 板块之间不互相喂养——终点站而非枢纽

**现状证据**：跨板块链接 `grep`，terms 仅 `path-trail.tsx`（terms 内部路径），**无一处从概念页链到相关 game/tool**。而愿景（`00-overview` §2）要求 tools 嵌入 terms 概念页、games 有教学功能。数据底座（注册表、`/embed/[tool]`）已就绪，缺的是 UI 织连。

**修法**：概念页四段结构（`02-3.3`）末尾加"下一步"区——链到相关工具（可 `/embed` 内嵌）、相关游戏、前后置概念（已有）。game 完赛屏、tool 页反向链回其知识点（依赖 13-§3.3 内容稳定 uid 做锚点，别挂 slug）。建一张轻量"内容关联"映射（uid↔uid↔toolId↔gameId），随内容入 git。

**验收**：学完"分数的意义"，页面呈现"去玩分数数轴/去练数和游戏/下一个概念"三类出口；从工具/游戏可回到对应知识点。

---

## 3. 微观层：动作反馈原语（动作之后）

### 3.1 全站无统一反馈系统——几十个表单各搓各的

**现状证据**：`useActionState` 全站 **0 次**；**未安装任何 toast 库**（`package.json` 无 sonner/`@radix-ui/react-toast`；`actions.ts:882` 出现的 "toast" 仅是注释）。代表性 `FollowUpForm.tsx`：手动 `useState` 管每字段 + `useTransition` 管 pending + 本地 `error` + 行内错误文字——每个 CRUD 表单重造一遍。

**已有的好种子（推广而非重造）**：staff 模块已有 `StaffActionResult = { ok: true } | { ok: false; code: string }` + `STAFF_ERROR_CODES` 白名单（`actions.ts:882–902`），因生产脱敏而用**返回值带回错误码、UI 翻译**——这是正确范式，但只在 staff 一个模块用。

**修法**：
1. 装 sonner（shadcn 官方），全局挂 `<Toaster>`（走设计系统 token）。
2. 把 `ActionResult<T> = {ok:true;data?} | {ok:false;code}` **提升为全模块共享类型**，所有 Server Action 统一返回它（不再靠 throw + 前端 catch 猜）。
3. 建共享 `<ActionForm>` / `useAction` 原语：内建 pending 态、成功 toast、失败按 code 翻译成具体文案、可选成功后跳转。所有学校表单迁移到它。

**验收**：任一表单提交，成功出"✓ 已保存"toast、失败出**具体可自救**的文案；新表单默认继承反馈，无需手搓。

### 3.2 成功静默 + 失败笼统（上一轮"静默失败"的前端孪生）

**现状证据**：`FollowUpForm` 提交成功 = 清空字段 + `router.refresh()`，**无正向确认**（第 34–41 行）；失败 = `catch { setError(t("followUpFailed")) }`（第 43 行）——**丢弃真实错误，永远同一句话**。校验不过 / 权限不足 / 网络断，用户看到的完全相同，无从自救。

**修法**：并入 §3.1——成功走 toast 正向确认；失败按 `ActionResult.code` 分流文案（复用 3.1 白名单机制，扩到全模块）。高频写入场景（点名/收款/跟进）尤其需要"已保存"确认以消除"存没存"的自我怀疑。

**验收**：三类失败（校验/权限/网络）给三种可操作提示，而非一句"失败"。

### 3.3 完成态无出口——游戏完赛通向不了排行榜，课堂下课不自动到报告

**现状证据**：
- 游戏 `match.tsx` `phase === "done"`（第 129–140 行）只显示"完成用时 + 已记录/失败/未记录" + 重玩按钮，**无排行榜/下一局/返回列表链接**。而 P2 核心是竞速排名——多巴胺时刻无门通向"我排第几"。
- 课堂 `LiveShell.tsx` 退出是 `ArrowLeft`→`/classroom/{classId}/session/{id}`（第 591、662 行，`aria-label="exit"`）。课堂报告路由**存在**（`.../session/[sessionId]/report/page.tsx`），但"下课"动作**不主动领用户去报告**——门造好了，不在该开的时候开。

**修法**：确立**"完成态 CTA"约定**——任何终结性动作屏必须给下一步出口。
- 游戏完赛屏加：查看排行榜（我的排名高亮）、再来一局/升难度、返回游戏列表。
- 课堂"下课"后引导到报告页（教师视角的课堂报告是 P4 验收收尾），而非只留返回箭头。

**验收**：完赛后一键达排行榜并看到自己排名；下课后自然过渡到课堂报告。

---

## 4. 时间层：跨会话连续性 / 变化流（会话之间）★依赖 13-§3.1

### 4.1 无未读 / 无变化 / 无待办 / 无继续——每次登录都是冷启动

**现状证据**：全站搜 `unread/badge/lastSeen/resume/未读/待办徽标` 实质命中 **0**。没有红点、没有"距上次登录 N 条新消息"、没有"2 份作业待批改"角标、没有"继续上次"。用户被迫成为轮询循环：家长要自己翻档案/财务/作业页打捞"孩子这周有无新课评、有无该交的费"；学辅要挨页查"有无新分派、哪条跟进到期"。看板本应"打开就知道有什么需要我"，现在只呈现静态现状。

**这是 13-§3.1 `domain_events` 缺席的 UI 端表现**——后端无事件流，前端就无未读可显示，两者是一枚硬币两面。

**修法（前端部分，后端见 13-§3.1）**：
1. `user_event_reads(user_id, last_read_at)` 或每事件 `read_at`——记录"看到哪"。
2. 顶栏**变化流铃铛**：拉取 `domain_events` 中与我相关、晚于 `last_read_at` 的事件，按类型（课评发布/作业批改/缴费到期/跟进分派/试听到场）成组呈现，点击直达对应页。
3. dashboard 磁贴层加"新增/待办"角标语汇（复用 P4C 磁贴壳）。
4. 关键长流程（笔记编辑、课堂）留"继续上次"入口。

**验收**：登录后铃铛显示"我不在时发生的、与我有关的变化"，逐条可直达；已读后角标清零；家长/学辅无需逐页打捞即知"要我处理什么"。

---

## 5. 空间层：方向感与可达性（层级之内）

### 5.1 深层页面无面包屑、无返回——三层深靠浏览器后退

**现状证据**：`SchoolPageHeader.tsx` 仅 28 行，**无面包屑、无返回链接、无上级入口**。而路由三层深：`courses/[id]/lectures/[lectureId]`、`students/[id]`→订单下钻。回上一级只能按浏览器后退，跳兄弟节点无路。后台是高频钻取场景，缺坐标层则持续轻微迷失。

**修法**：`SchoolPageHeader` 增加**面包屑**（走 shadcn/ui，若无则查 `breadcrumb` 组件报批）+ 显式"返回上一级"。层级数据从路由段推导。

**验收**：任一深层页顶部显示完整层级路径，逐级可点回上层。

### 5.2 无障碍是斑块的——能做对却没统一做

**现状证据**：
- 全站**无 skip-to-content 跳过链接**——键盘/读屏用户每页先 Tab 过 Logo/语言/主题/抽屉才够到正文。
- Radix 弹层仅 6 文件（`ui/{command,dialog,popover}` + `utility-sheet` + `notebook/editor/TitleField` + `school/DashboardShell`）；`notebook/workspace/WorkspaceFrame.tsx` **手搓 `fixed inset-0` 弹层**——通常缺 Radix 免费给的焦点陷阱/`aria-modal`/Esc 关闭/滚动锁。
- `LocaleSwitcher.tsx` `aria-label="切换语言"` **硬编码中文**（英文读屏用户听到中文）。

关键在**一致性**：代码库明明会做无障碍（`aria-live`、多处 `aria-label`、Radix），但没系统化，读屏体验取决于撞上哪个组件。教育产品面向学校（有无障碍义务）与能力多样的孩子。

**修法**：
1. 全局布局加 skip-to-content 链接（`sr-only` 聚焦可见）。
2. 手搓弹层（`WorkspaceFrame` 等）迁到 Radix Dialog 或 shadcn `dialog`，统一焦点陷阱/Esc/滚动锁。
3. `aria-label` 等无障碍文案全部走 next-intl，扫一遍硬编码。
4. 定一条无障碍基线清单（skip link / 弹层焦点 / 可见焦点环 / 图标按钮 aria-label / 对比度），纳入验收。

**验收**：键盘可一步跳过导航到正文；所有弹层焦点受困且 Esc 可关；读屏文案随 locale 切换；基线清单全过。

### 5.3 切换语言丢失当前位置

**现状证据**：`LocaleSwitcher` 用 `router.replace(pathname, { locale })` 保留**路由**，但 `pathname` 不含 query——切语言丢掉 `?status=lead` 筛选、分页、展开 tab 等 URL 态；客户端页内存态（半填表单、笔记编辑器）因 re-render 丢失。双语是核心承诺，任务中切换却有隐性代价。

**修法**：`LocaleSwitcher` 切换时携带 `searchParams`（`usePathname` + `useSearchParams` 拼回）；对重内存态页（编辑器）在切换前提示或走 URL 持久化关键态。

**验收**：在筛选/分页后切语言，筛选与页码保持；重态页给出保护。

---

## 6. 共享原语层（脊柱本身——让上述四层系统化而非逐页打补丁）

上四层的每个"修法"若逐页实现，只会复制斑块。真正的杠杆是**先立原语，页面消费原语**：

| 原语 | 服务对象 | shadcn/依赖 |
| --- | --- | --- |
| 全站板块导航层（`<SectionNav>` + 扩展 `UtilitySheet`） | §2.1 | 现有 Radix dialog |
| `ActionResult` 共享类型 + `<ActionForm>`/`useAction` + `<Toaster>` | §3.1/3.2/3.3 | **sonner**（新增，报批） |
| "完成态 CTA" 约定（终结屏必给下一步） | §3.3 | 约定，无依赖 |
| 变化流 `useUnread`/`<ChangeBell>` | §4 | 依赖 13-§3.1 `domain_events` |
| `<Breadcrumb>` + `SchoolPageHeader` 升级 | §5.1 | shadcn breadcrumb（报批） |
| 无障碍基线（skip link / 弹层统一 / i18n aria） | §5.2 | Radix / shadcn dialog |
| `route+query+locale` 保位导航 helper | §5.3 | next-intl navigation |

**原则**：这些原语一旦立好，P4D 后续每个新表单/新流程**默认继承**反馈、导航、无障碍、面包屑，不再手搓也不再遗漏——这正是"补脊柱 vs 列肋骨"的差别。

### 6.5 shadcn-first 组件债（用户强调的一等问题：能复用 shadcn/ui 就不手搓）

**背景**：`AGENTS.md`/全局铁律要求"新组件先查 shadcn/ui、能复用就不手搓"。但审计发现整个 P4B/P4C/P4D 期间该反射系统性缺失——遇到需要控件时默认手搓样式常量或用原生元素，而非 `pnpm dlx shadcn@latest add`。toast 漏装只是冰山一角。

**成本实锤（不是风格偏好）**：`src/features/school/controls.ts` 是一份**手抄的 shadcn input/select**（`inputClass = selectClass = "rounded-lg border border-line bg-card ..."`）。其注释自白：原先各处裸 `<input>/<select>` 手写 `bg-background`（未定义 token）→ 暗色卡片上渲染脏色 → 专门起 P4C-0 §3.5 任务补救。**这个 bug 用 shadcn `input`/`select` 根本不会发生**——它们是主题测试过、暗色适配好的。违反 shadcn-first 直接导致了一次返工。

**债务清单（已实测）**：

| shadcn 组件 | 现顶替方式 | 规模 | 处置 |
| --- | --- | --- | --- |
| `input` | 原生 `<input>` + 手抄 `inputClass`（controls.ts） | **102 处 / 40 文件** | 安装 + 逐步迁移，`controls.ts` 保留为薄封装或废弃 |
| `select` | 原生 `<select>` + `selectClass` | **32 处**（状态/年级/学期/角色/跟进态等核心字段） | 安装 Radix-based `select`，业务下拉优先迁 |
| `table` | 原生 `<table>` | **12 文件**（学生/课程/班级/排行榜/课堂报告/员工） | 安装 `table`，后台表格统一 |
| `sonner`（toast） | 无（动作无反馈，见 §3.1） | 未装 | **P4F-0 安装**（反馈原语基座） |
| `alert-dialog` | `window.confirm()` | 4+ 处（**删学生/笔记/活动**等破坏性动作） | 安装，所有 confirm() 迁走 |
| `badge` | 内联 `rounded-full px-2 text-xs` | **35 文件** | 安装，统一状态/种类标签 |
| `sheet` | Radix Dialog 手搓抽屉（`inset-y-0 right-0`） | 4 处（UtilitySheet/DashboardShell/WorkspaceFrame/MotionLab） | 安装，抽屉统一（同时解 §5.2 手搓弹层焦点问题） |
| `checkbox` | 原生 `type="checkbox"` | 7 处 | 安装 |
| `label` | 原生 `<label>` | 21 处 | 安装，配 `form` |
| `skeleton` | 无（加载空白，见 §3/14 加载态） | 未装 | 安装，配 loading.tsx |
| `breadcrumb` | 无（见 §5.1） | 未装 | 安装 |
| `form` / `tooltip` / `tabs` / `dropdown-menu` / `separator` | 手搓/无 | 若干 | 按需安装，报批后加 |

**处置纪律**：
1. **先安装、再迁移，不一次性大重构**：按 §9 分批，每迁一批跑 lint/typecheck/build + 亮暗双主题视觉回归（shadcn 组件默认 theme-aware，迁移本身会顺带修掉一批暗色脏色隐患）。
2. **token 适配**：shadcn 默认用 `--background/--foreground` 等中性 token，Mathin 用小王子 token（`--card/--ink/--line/--moon`）——安装后按 memory「shadcn 优先铁律」的 token 适配法改写组件内变量，**不改组件结构**。
3. **破坏性动作优先**：`window.confirm()` → `alert-dialog` 排在最前（删学生/笔记/活动的体验与设计一致性最敏感）。
4. **`controls.ts` 的归宿**：迁移完成后，`inputClass/selectClass` 要么删除，要么降为 shadcn `input` 的薄样式补充；禁止新代码再引用它手搓表单。
5. **新反射写入执行约定**：本文与 `AGENTS.md` 重申——**任何新控件动手前先 `shadcn` 查一遍**；本节债务清单即"反面清单"，新代码不得再增其中任一模式。

---

## 7. 移动端：空间磁贴退化 + 手势冲突

**现状证据**：`TileWorkspace.tsx` 网格 `grid-cols-1`（移动）→ `md:grid-cols-4 lg:grid-cols-6`；拖拽/缩放走 `onPointerDown`（第 381、420 行），**全文无 `touch-action` 声明**。后果：P4C 精心做的 2D 空间工作台在手机上**塌成单列堆叠**（空间价值归零），且拖拽手势与页面滚动抢事件（"想拖磁贴结果页面滚走")。而家长——最该用手机的角色——恰撞上最差移动体验。

**修法**：磁贴工作台补一套**移动端独立设计**（不是塌缩）：手机上默认"编排锁定"只读浏览，进入显式"编辑模式"才允许拖拽，且拖拽区加 `touch-action: none` 隔离滚动。家长端磁贴优先呈现"本周课次 + 待交作业"等只读信息卡。

**验收**：手机上磁贴默认不与滚动冲突；家长首屏在小屏是可读信息流而非难拖的网格。

---

## 8. 板块 × 体验项影响矩阵（整体视角落点）

执行任一项前对照此表，确认所有触达面被覆盖（●=直接改造，○=受益/需回归）。

| 体验项 \ 板块 | 首页home | story | games | minds | terms | tools | classroom | notebook | whiteboard | school后台 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 全站板块导航 | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| 2.2 板块互导飞轮 | | ○ | ● | ○ | ● | ● | | | | |
| 3.1/3.2 反馈原语+toast | | | ● | | | | ● | ● | ● | ● |
| 3.3 完成态 CTA | | ○ | ● | | ○ | | ● | ● | | ○ |
| 4 变化流/未读 ★ | | | ○ | ○ | ○ | | ● | ● | | ● |
| 5.1 面包屑 | | | | | ● | | ● | ● | | ● |
| 5.2 无障碍基线 | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| 5.3 语言保位 | ○ | ○ | ○ | ○ | ● | ○ | ○ | ● | ○ | ● |
| 7 移动端磁贴 | | | | | | | | | | ● |

**读法**：2.1 与 5.2 横跨全部十列——它们是把整站焊在一起的两条基线（导航 + 无障碍），应最先立原语。school 与 classroom/notebook 列 ● 最密，是体验改造主战场；terms 列 ● 集中在"互导飞轮 + 面包屑 + 语言保位"，与其内容纵深（未来 P6）天然合并。★=依赖 13 号。

---

## 9. 任务拆分与排期（P4F-*，与 P4D/P4E 交错）

排期原则：①先立原语再改页面（避免复制斑块）；②与 13-§3.1 咬合的变化流待 `domain_events` 落地后接；③无障碍/导航基线越早越省（每个新页都受益）。

| # | 任务 | 触发时机 | 关键验收 |
| --- | --- | --- | --- |
| **P4F-0** | 装 sonner + `<Toaster>` + `ActionResult` 共享类型 + `<ActionForm>`/`useAction` 原语 | **先于 P4D 剩余表单**（活动/课评/视频都将受益） | §3.1 验收；一个样板表单迁移打通 |
| **P4F-0b** | **shadcn-first 债补齐（§6.5）**：安装 `input/select/table/alert-dialog/badge/sheet/checkbox/label/skeleton/breadcrumb`，token 适配；`window.confirm()`→`alert-dialog` 优先 | **与 P4F-0 同批**（是所有后续迁移的组件基座） | §6.5 全部 shadcn 组件到位；破坏性动作全走 alert-dialog；亮暗回归无脏色 |
| **P4F-1** | 全站板块导航层 + `UtilitySheet` 扩为公开+功能两组（形态先与用户确认） | P4F-0 后尽早 | §2.1 验收 |
| **P4F-2** | 无障碍基线：skip link + 手搓弹层迁 Radix + i18n aria + 基线清单 | 随 P4F-1（同碰布局/弹层） | §5.2 验收 |
| **P4F-3** | 存量学校表单迁移到 `<ActionForm>`（成功 toast + 失败分流文案） | P4F-0 后，随 P4D 各模块 | §3.2 验收；三类失败三种提示 |
| **P4F-4** | `SchoolPageHeader` 升级：面包屑 + 返回上级 | 随 P4D 深层页改造 | §5.1 验收 |
| **P4F-5** | 完成态 CTA：游戏完赛屏加排行榜/下一局出口；课堂下课→报告过渡 | 独立小项，可蹭 P2/P4 回归 | §3.3 验收 |
| **P4F-6** | 语言保位导航 helper（route+query+locale） | 随 P4F-1 | §5.3 验收 |
| **P4F-7 ★** | 变化流：`useUnread` + 顶栏 `<ChangeBell>` + 磁贴待办角标 | **13-§3.1 `domain_events` 落地后** | §4 验收 |
| **P4F-8** | 板块互导飞轮：概念页"下一步"区 + 内容关联映射 + 反向链 | **随 terms 内容纵深期**（依赖 13-§3.3 uid） | §2.2 验收 |
| **P4F-9** | 移动端磁贴独立设计（编辑模式 + touch-action + 家长只读信息流） | P4C 磁贴回归时 | §7 验收 |

**与 13/P4D 的咬合点**：P4F-0（反馈原语）应**先于** P4D 尚未开工的活动/课评/视频表单；P4F-7（变化流 UI）**必须等** 13-P4E-F1（`domain_events`）；P4F-8（互导）依赖 13-P4E-F3（内容 uid）。P4F-1/2（导航+无障碍基线）越早，后续每个新页越省。

---

## 10. 隐含坑清单

1. **导航形态是视觉决策**：§2.1 星球化导航别退化成普通导航条，也别喧宾夺主盖过首页；形态**先出方案给用户确认**再实现（`00`/`05` 星球语言约束）。
2. **toast 别滥用**：只在"用户主动动作的结果"上弹；被动/后台变化走 §4 铃铛，不弹 toast，避免打扰。
3. **变化流别变成社交通知**：§4 严格限运营/学情事件，不做评论/点赞/关注（暂缓项不变）。
4. **`ActionForm` 迁移要渐进**：存量表单逐个迁，别一次性大重构；每迁一个跑 lint/typecheck/build + 视觉回归。
5. **面包屑数据来源**：优先从路由段 + 已加载实体推导，别为面包屑多打一轮查询。
6. **无障碍回归要实测**：键盘 Tab 全流程 + 一次读屏（NVDA/VoiceOver）实走，别只看代码。
7. **移动磁贴别和 P4C 桌面逻辑纠缠**：移动是**独立呈现**而非同一套拖拽缩放塞进小屏。
8. **只加不推翻**：`match.tsx` 无障碍、staff 错误码范式、Radix 弹层都保留并推广；任何"顺手重写"冲动停下来问用户。
9. **shadcn 迁移是"换壳不换逻辑"**：§6.5 迁移只替换控件表层（原生 `<input>`→shadcn `input`），保留字段状态/校验/action 逻辑不动，逐组件小步提交；别借迁移之名重写业务。
10. **token 适配别改结构**：shadcn 组件装进来后只改内部 CSS 变量映射到小王子 token，不改组件 API/结构（memory「shadcn 优先铁律」的适配法），否则日后 `shadcn` 升级无法对齐。

## 11. 与既有文档的关系

- 与 `13-foundations-and-hardening.md` 成对：§4 变化流 UI **依赖 13-§3.1 `domain_events`**；§2.2 互导 **依赖 13-§3.3 内容 uid**。两份计划交错执行，改一处两端受益。
- 落地 `00-overview` §2 未兑现的"tools 嵌入 terms / games 教学功能"（§2.2）与导航层级理想。
- 不改 `04-roadmap` 板块顺序，作为横切体验线插入 P4D/P4E 之间与其后。
- 完成后回写 `MEMORY.md`：新增"P4F 导航与体验骨架"指针；与 [[p4e-foundations-plan]] 并列。
