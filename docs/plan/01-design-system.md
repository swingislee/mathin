# Mathin 整体规划 · 01 设计系统

> **规划状态**：`reference`
>
> **当前用途**：全站小王子视觉语言、设计 token、字体、基础组件与 shadcn/ui 选型。
>
> **权威边界**：用于新 UI 与相关改造；已落地组件和 UI-L1～L4 证据以代码及 doc 20～24 为准。
>
> **剩余项**：按场景级、内容级、工作区级完成 1.0 人工视觉/无障碍签收，见 doc 25。
>
> **最后核对**：2026-08-23。

小王子世界观是全站主要视觉语言。`public/Main.png` 提供 B-612 主视觉、纸色、墨线、月亮黄、玫瑰红和王子绿的取色依据。全站共享低饱和纸张、手绘线条、书卷字体、星夜暗色和克制运动；插画密度按页面任务分级。

## 0. 应用强度

| 级别 | 页面 | 视觉对象 | 操作限制 |
| --- | --- | --- | --- |
| 场景级 | 首页；Story/Games/Minds/Terms/Tools 首页 | B-612/对应星球场景、角色或器物、空间化入口、`ThemePageIdentity` | 首屏 1 个主场景；标题、入口和焦点顺序不被插画遮挡 |
| 内容级 | 概念/文章/游戏/工具详情、Notebook、登录注册、帮助/错误/空状态 | 纸面、星轨、四角星、邮票/灯/罗盘/账本/旅途笔记等模块母题 | 每屏 3～5 颗装饰星；每个内容页最多 1 个专属轻动效 |
| 工作区级 | Dashboard、Classroom、Whiteboard、Courseware Studio | 基础 token、文楷/衬线、手绘线宽、星夜；品牌区或空状态保留 1 个叙事锚点 | 表格、表单、实时课堂、课件画布不放叙事装饰；不得降低数据密度和对比度 |

新插画使用原创或用户拥有的资产；不得临摹特定出版版本的插画。场景资产在 zh/en 共用，图中文字必须进入 messages 或使用独立可替换图层。

## 1. 色彩

所有色值取样自 `public/Main.png`（主图为唯一配色依据）。禁止在组件里硬编码色值，一律使用下列 CSS 变量。

### 1.1 基础色（浅色模式）

| Token | 值 | 来源与用途 |
| --- | --- | --- |
| `--paper` | `#FFFDF8` | 纸白，全站背景（沿用现有值） |
| `--ink` | `#29251F` | 墨色，正文与标题文字（沿用现有值） |
| `--muted` | `#766F65` | 次要文字（沿用现有值） |
| `--line` | `#E8E1D5` | 分隔线、卡片描边（沿用现有 `--border`） |
| `--card` | `#FFFFFF` | 卡片底色 |
| `--moon` | `#FEEDB9` | 月亮黄：主强调底色（高亮块、选中态、标签底） |
| `--star` | `#FFEBBD` | 星光金：装饰星星、次级高亮（与 moon 近似，仅用于装饰元素） |
| `--crater` | `#CBAB8F` | 陨石棕：图形描边、次级按钮描边、插画线稿色 |
| `--rose` | `#E55C60` | 玫瑰红：主行动色（主按钮、链接 hover、强调点），全页面同屏出现 ≤ 2 处 |
| `--rose-deep` | `#C94A4F` | 玫瑰红 hover/active |
| `--leaf` | `#BBCF87` | 王子绿：辅助色、成功态底色 |
| `--leaf-deep` | `#6F8B48` | 深绿：成功态文字、绿色系文字必须用此值保证对比度 |
| `--cheek` | `#FBC9C3` | 脸颊粉：极少量柔和高亮（如点赞、收藏的暖反馈） |

### 1.2 暗色模式 = 「星夜」

小王子的夜晚是深蓝星空，不是黑色。暗色模式整体替换为夜空蓝基调（替代现有偏棕的暗色）：

| Token | 暗色值 | 说明 |
| --- | --- | --- |
| `--paper` | `#191D2B` | 夜空蓝黑 |
| `--ink` | `#F2EDDF` | 暖白文字 |
| `--muted` | `#9BA0B0` | |
| `--line` | `#333A4E` | |
| `--card` | `#212637` | |
| `--moon` | `#D9BE7E` | 月亮变暗金 |
| `--star` | `#E8D9A8` | |
| `--crater` | `#8F7A64` | |
| `--rose` | `#E06A6E` | 稍提亮保证对比 |
| `--rose-deep` | `#C94A4F` | |
| `--leaf` | `#8FA968` | |
| `--leaf-deep` | `#A9C284` | 暗色下绿色文字用浅绿 |
| `--cheek` | `#B98883` | |

实现要求：改造 `src/app/globals.css`，保留现有 `.dark` / `prefers-color-scheme` 双通道机制，把旧 token（`--background`→`--paper`、`--foreground`→`--ink`、`--border`→`--line`、`--accent`→`--moon`）全局重命名并同步 `@theme inline` 映射，使 Tailwind 可用 `bg-paper text-ink border-line` 等类。

### 1.3 板块主题色

> **修订**：Story/Games/Minds/Terms/Tools 使用 doc 05 的五星球色板。Notebook 使用“旅途笔记”内容级语言；Dashboard/Classroom/Whiteboard/Courseware Studio 使用工作区级语言。下表只提供局部 accent，不决定插画密度。

每个板块指定一个 accent，用于该板块页面的标题下划线、图标、选中态。仅此一处差异，其余样式全站统一：

| 板块 | accent |
| --- | --- |
| story | `--rose`（玫瑰=故事的核心意象） |
| games | `--moon` |
| minds | `--crater` |
| terms | `--leaf`（核心板块 = 王子绿） |
| tools | `--star` |
| classroom / dashboard | `--leaf` |
| notebook | `--cheek` |
| whiteboard | `--crater` |

实现方式：`SectionShell` 组件（见 02）接收 `accent` 并设置局部 CSS 变量 `--section-accent`，子组件只用 `var(--section-accent)`。

## 2. 字体

> **2026-07-25 修订**：本节旧版“中文只在标题使用文楷、正文使用系统黑体”已被页面 UI 重构取代；实现与后续规则以 `20-ui-layout-refit.md` §7 为准。

| 用途 | 字体 | 加载方式 |
| --- | --- | --- |
| 中文正文、标题与 UI | 霞鹜文楷 LXGW WenKai（开源 OFL） | `public/fonts/lxgw-wenkai/` 自托管 `unicode-range` 分片；回退 `"Kaiti SC","STKaiti","KaiTi",serif` |
| 英文及其他语言 | Iowan Old Style / Palatino / Georgia | 系统书卷感衬线栈，不发起远程请求 |
| 数学公式 | KaTeX 自带字体（terms 板块引入 KaTeX 时一并处理） | P1 阶段处理 |
| 等宽 | `ui-monospace` | |

规则：中文页面全局使用文楷，其他语言使用气质相近的书卷感字体。当前 97 个 WOFF2 是同一字体的 Unicode 分片，浏览器按页面字符命中下载，不得误判为 97 套字体后随意删除。禁止引入 Google Fonts 远程链接。

## 3. 线条与形状语言

- **描边**：装饰性图形（星球、星轨、分隔）用 `1.5px–2px` 的 `--crater` 色描边，模拟手绘线稿；功能性边框（卡片、输入框）用 `1px --line`。
- **圆角**：卡片 `rounded-2xl`（1rem）；按钮、输入框 `rounded-full`；大容器 `rounded-[2rem]`。全站不出现直角卡片。
- **星轨虚线**：学习线、章节时间线和跨模块关系使用 SVG `stroke-dasharray="1 8" stroke-linecap="round"`，颜色 `--crater`；工作区只在品牌区、空状态或帮助区使用。
- **星星装饰**：四角星（✦ 形，同 Main.png 中的星星），做成 `<Star4 />` SVG 组件，填充 `--star`；每屏最多 3–5 颗、只出现在留白处，禁止铺满。
- **阴影**：只允许 `shadow-sm`，禁止大阴影和发光效果。
- **插画**：线稿使用米色/棕色，填色保持低饱和，主体周围保留可放标题或入口的空区；上线资产必须由用户签收。

## 4. 排版与间距

- 内容容器：正文类页面 `max-w-3xl`，卡片网格类 `max-w-5xl`，Dashboard 普通页使用统一内容坐标系，教室/白板/Studio 全宽。
- 页面纵向节奏：场景/内容页区块间距 `space-y-16`（桌面）/ `space-y-10`（移动）；工作区使用 doc 20～24 的密度与坐标系，不强制留白。
- 字号阶梯（Tailwind）：h1 `text-4xl md:text-5xl`、h2 `text-2xl md:text-3xl`、正文 `text-base leading-7`、辅助 `text-sm`。h1 不超过 `text-5xl`（现首页 `text-6xl` 属于过大，需收敛）。
- 中文排版：正文 `leading-7` 以上；中英文之间由文案保证空格，不做 CSS hack。

## 5. 动效

> 场景页已增加 `scene-rise`（700ms）和 `scene-drift`（7s、位移约 7px）；它们是页面级动画的第二类受控例外，完整约束见 `20-ui-layout-refit.md` §9。

- 只用 CSS transition：`transition-[color,background,transform,opacity] duration-200`。
- hover 允许的效果：颜色过渡、`-translate-y-0.5` 轻浮起、下划线展开；禁止旋转、缩放超过 1.03、弹跳。
- 页面级动画仅允许命名过的受控模式：首页 `float`，以及 `20-ui-layout-refit.md` 的 `scene-rise` / `scene-drift`；不得另增无规范动画。
- 必须尊重 `prefers-reduced-motion: reduce`：关闭所有 animation，保留 opacity 过渡。

## 6. 组件规范

### 6.0 Dashboard 连续工作区、Card 默认禁用与明确设计保留规则

Dashboard、Classroom、Whiteboard 和 Courseware Studio 默认使用连续工作区，不以 Card 作为页面布局原语：

- 页面身份只进入 `DashboardPage` 或 `ObjectBar`；搜索、筛选、状态切换和业务操作只进入 `DashboardCommandPanel`；
- 页面级与批量业务按钮只进入 `DashboardCommandPanel` 的 actions／selection 槽，不得在 `DashboardTableShell` 上方追加一条局部工具栏；表格外壳从 shadcn `Table` 直接开始；
- 全选放在选择列表头，数据列用 shadcn 控件承载逐列筛选／排序，选择列与操作列不提供无意义的数据筛选；数据区纵向滚动时表头固定。命令面板只保留跨列关键词搜索与页面级筛选，不重复摆放已经进入列表头的逐列筛选；
- 正文使用无外框 `DashboardSection`、`DashboardTableShell`、稳定留白和主栏／侧栏关系表达层级；标题、说明、筛选栏、导航、表格、表单、只读摘要和空状态不得各套一张 Card；
- 三栏或分栏工作台使用一块连续画布，栏间以结构线分隔；不得把每一栏做成独立圆角卡片，也不得用卡片内边距降低数据密度；
- shadcn `Card`、`DashboardCard`、`DashboardCardGrid` 和手写 `rounded-* border bg-card` 均为显式例外，不是默认方案。只有产品负责人明确要求，或对象确实需要独立搬运、选择、并列比较时才能使用，并在实现附近说明独立对象语义；
- 产品负责人提供的明确页面设计优先于通用“少用 Card”规则；设计稿中已经定义的 Card 是页面合同，后续统一语义或清债不得擅自改成无框 section。教师微课创作页的页面栏与 composition 编辑工作面属于当前明确保留的 Card 例外；
- 空状态属于它所替代的列表、表格或画布区域，保持该区域尺寸与边线，不额外生成居中的空状态卡片。

背景色按语义使用：

- 允许背景色表达已批准 Card 的独立表面、选中／状态反馈、悬浮层可读性，以及课件、游戏或 H5 画布自己的内容底色；
- 普通 section、栏位、目录、筛选集合、统计摘要和表格外层默认透明并继承页面底色，不得仅为了视觉分块添加 `bg-moon/*`、`bg-paper/*` 或 `bg-card`；
- 删除背景色时不得连带删除有业务含义的选中态，也不得把明确设计的 Card 再次拉平成“分隔线下的隐藏卡片”。

分隔线按拥有者只出现一次：

- 页面头可以保留一条页面身份分隔线；普通 `DashboardSection` 不画外框、上下边线或标题下划线，以标题和留白区分内容；
- 表格边界只由 `DashboardTableShell` 提供，表头线和行线只由 shadcn Table 提供；不得再给包含表格的 section、section header 或外层容器叠加 `border-y` / `border-b`；
- 三栏编辑器、审核器和目录—表格—预览工作台只在持续并存的栏位之间画垂直结构线；移动端堆叠时不为每栏补上下外框；
- `border-y` 不得作为“去掉圆角和底色后的卡片”继续使用。需要强调一小段状态时使用局部 tone；需要表达集合时使用表格、列表或语义导航。

本规则优先于本文件旧有的卡片形状、卡片网格和组件目录描述；这些条目只服务被明确批准的例外。现有页面按实际改造批次迁移，新建或本轮触及的工作区必须直接遵守。

### 6.1 shadcn/ui 优先（铁律 + 强制流程）

任何可复用 UI 组件一律经 shadcn/ui 统一管理，禁止绕开它手搓样式常量或用未加工的原生元素。**这条铁律此前在 P4B/P4C/P4D 被系统性违反（原生 input 102 处、select 32 处、table 12 文件、`window.confirm` 做删除确认、手抄 controls.ts 还引发暗色脏色 bug 返工），补齐计划见 `14-§6.5` + 任务 P4F-0b。**

**动手任何控件前的强制流程**：
1. **先查 §6.1 能力目录**——"我需要的交互是什么 → 对应哪个 shadcn 组件"。目录里有的，一律 `add`，不手搓。
2. 未安装则 `corepack pnpm dlx shadcn@latest add <name>`（本机 `pnpm` 不在 PATH，**必须带 `corepack` 前缀**；CLI 内部装 radix 依赖会失败，先手动 `corepack pnpm add <radix 依赖>` 再跑 CLI）。
3. 引入后把默认 token 类（`bg-background/text-muted-foreground/bg-primary`…）改写为本设计系统 token（`bg-card/text-muted/bg-rose`…），**只改内部变量映射、不改组件结构/API**，参照已适配的 `src/components/ui/dialog.tsx`、`slider.tsx`。
4. §6.2 目录里没有、确需自造的，先问用户；自造组件遵守 §6.5。

### 6.2 shadcn/ui 完整能力目录（决策表：需要什么 → 用什么）

状态图例：✅ 已装可用 · ⚠️ 债务（当前被手搓/原生顶替，见 14-§6.5，须迁移） · ○ 未装但推荐（遇到即装） · ◇ 未来阶段将需要（见 §6.3）。

**表单与输入**

| 你需要 | 组件 | 状态 |
| --- | --- | --- |
| 按钮 | `button` | ✅ |
| 单行输入 | `input` | ⚠️ 原生 102 处 + 手抄 controls.ts |
| 多行输入 | `textarea` | ✅ |
| 字段标签 | `label` | ⚠️ 原生 21 处 |
| 下拉选择（状态/年级/角色等） | `select` | ⚠️ 原生 32 处 |
| 可搜索下拉 | `combobox`（`command`+`popover` 组合） | ○（command 已装） |
| 勾选 | `checkbox` | ⚠️ 原生 7 处 |
| 单选组 | `radio-group` | ○ |
| 开关 | `switch` | ○ |
| 滑块 | `slider` | ✅ |
| 切换按钮/按钮组 | `toggle` / `toggle-group` | ○ |
| 表单校验编排（RHF+zod） | `form` | ○（与 14 的 `<ActionForm>` 配合） |
| 验证码输入 | `input-otp` | ◇ P4E-C3 手机验证码登录 |
| 日期选择 | `calendar` + `date-picker` | ✓ 已以 shadcn `Calendar` + `Popover` 建立共享 `DateTimePicker`，业务表单不再直接使用原生 date/time/datetime-local 控件 |

**覆盖层与反馈**

| 你需要 | 组件 | 状态 |
| --- | --- | --- |
| 模态对话框 | `dialog` | ✅ |
| **破坏性动作确认**（删除等） | `alert-dialog` | ⚠️ 现用 `window.confirm()` |
| 侧滑抽屉（桌面） | `sheet` | ⚠️ 手搓 Radix Dialog 4 处 |
| 移动端底部抽屉 | `drawer`（vaul） | ◇ 14-§7 移动端 |
| 悬浮层 | `popover` | ✅ |
| 操作菜单 | `dropdown-menu` | ○ |
| 右键菜单 | `context-menu` | ○ |
| 悬停卡片 | `hover-card` | ○ |
| 提示气泡 | `tooltip` | ○ |
| **Toast 通知** | `sonner` | ⚠️ 未装（14-§3 反馈原语基座） |
| 进度条 | `progress` | ○ |
| **加载骨架** | `skeleton` | ⚠️ 未装（14 加载态 / loading.tsx） |
| 加载转圈 | `spinner` | ○（现用 lucide `LoaderCircle`+animate-spin） |

**布局与导航**

| 你需要 | 组件 | 状态 |
| --- | --- | --- |
| 标签页切换 | `tabs` | ○（现手搓按钮组切换） |
| 手风琴 | `accordion` | ○ |
| 折叠区 | `collapsible` | ○（教室侧板折叠现手搓） |
| **面包屑** | `breadcrumb` | ⚠️ 未装（14-§5.1） |
| 分页 | `pagination` | ○（列表现手搓 `?page`） |
| **全站/板块导航** | `navigation-menu` | ◇ 14-§2.1 板块导航 |
| **后台侧栏** | `sidebar` | ◇ DashboardShell 现为手搓侧栏，shadcn `sidebar` 专此设计 |
| 分隔线 | `separator` | ○ |
| 受控滚动区 | `scroll-area` | ○（P4C-0「唯一滚动区」现手搓） |
| 可拖拽分栏 | `resizable` | ○（教室三段舞台/磁贴缩放现手搓） |
| 定比容器 | `aspect-ratio` | ○ |

**数据展示**

| 你需要 | 组件 | 状态 |
| --- | --- | --- |
| 表格 | `table` | ⚠️ 原生 12 文件 |
| **带排序/筛选/分页的数据表** | `data-table`（`table`+TanStack Table） | ◇ 后台学生/课程/订单列表 |
| 卡片容器 | `card` | ⚠️ 现手搓 `rounded-xl border bg-card` |
| **状态/种类标签** | `badge` | ⚠️ 内联手搓 35 文件 |
| 头像 | `avatar` | ○（员工/学生显示） |
| **图表**（财务/学情/漏斗） | `chart`（recharts） | ◇ 财务总览、掌握度、转化漏斗 |
| 空状态 | `empty` | ○（现有自造 `EmptyState`，可评估迁移） |
| 轮播 | `carousel` | ○ |
| 快捷键显示 | `kbd` | ○（notebook Cmd+K） |

### 6.3 与近期路线的映射（这些阶段一开工就该装对应组件，别再手搓）

- **P4E-C3 手机验证码登录** → `input-otp`。
- **P4F-0 反馈原语** → `sonner`（Toast）；**P4F-0b 债务补齐** → `input/select/table/alert-dialog/badge/sheet/checkbox/label/skeleton/breadcrumb` 一次性安装。
- **P4F-2 无障碍** → 手搓抽屉迁 `sheet`；**P4F-4 面包屑** → `breadcrumb`。
- **DashboardShell 重构**（如动它）→ `sidebar`；**后台列表** → `data-table` + `pagination`。
- **财务/学情看板**（P4D-3/学情中台）→ `chart`。
- **课表周视图**（P4B-4）/日期字段 → `calendar` + `date-picker`。
- **移动端磁贴/面板**（14-§7）→ `drawer`。

### 6.4 shadcn 不止是组件（平台能力，避免"以为没有就自造"）

- **CLI + `components.json`**：`shadcn add` 可从官方注册表、**任意 URL、命名空间注册表**拉取组件；本项目 `components.json` 已配置（new-york 风格、lucide 图标、`@/components/ui` 别名）。
- **Blocks**：官方提供成套区块（dashboard、sidebar、login、calendar 等整段布局），可整块 `add` 后改造，别从零拼。
- **Charts**：基于 recharts 的图表组件族（面积/柱/饼/雷达/漏斗），配 `chart` 容器与主题联动。
- **MCP**：shadcn 提供 MCP server，可让 agent 直接查询/安装组件——需要时可评估接入以固化"先查后装"的反射。
- 官方组件持续新增（2025 起有 `sidebar/sonner/input-otp/calendar/spinner/kbd/empty/data-table` 等）；**每次要造"shadcn 应该有"的东西前，先去 ui.shadcn.com/docs/components 或 MCP 确认一次**，本目录随之更新。

### 6.5 自定义组件（放 `src/components/`，仅限 shadcn 确无对应项）

| 组件 | 职责 |
| --- | --- |
| `SectionShell` | 内容型子页面骨架：边缘 SiteHeader + 面包屑 + 内容轴标题 + 内容槽（详见 02/20） |
| `Star4` | 四角星 SVG 装饰 |
| `StarPath` | 星轨虚线 SVG（水平/自定义 path 两种用法） |
| `PlanetLink` | 首页/导航用的圆形星球入口（圆 + 描边 + 标签） |
| `ThemePageIdentity` | 五个公开场景首页统一的星球身份 / h1 / 简介合同（详见 20） |
| `EmptyState` | 空状态：一颗星 + 一句话（可评估迁移到 shadcn `empty`） |

自造前自检：§6.2 目录真的没有？不能由 shadcn 组件组合而成（如 combobox=command+popover）？两者都否才自造，且遵守设计系统 token。

### 6.6 按钮变体约定（shadcn `button` 上定制）

`primary` = rose 底白字；`secondary` = 透明底 crater 描边；`ghost` = 无边框 muted 文字。一个视图同屏只允许一个 primary。
