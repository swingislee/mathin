# Mathin 整体规划 · 01 设计系统

设计基调：**小王子（公版）世界观 + 简洁不花哨**。手绘感来自「线条、留白、柔和纸色」，而不是堆插画和动画。全站像一本安静的绘本：大量留白、细线描边、少量温柔的颜色点缀。

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

> **修订**：五个公开板块（story/games/minds/terms/tools）的主题设计已升级为「五星球主题」，各有完整色板与分风格设计语言，见 `05-planet-themes.md`（以其为准）。下表仅对功能板块（dashboard/classroom/notebook/whiteboard）继续生效。

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

| 用途 | 字体 | 加载方式 |
| --- | --- | --- |
| 标题（中/英） | 霞鹜文楷 LXGW WenKai（开源 OFL，楷体手写感贴合小王子） | `next/font/local`，woff2 子集放 `src/fonts/`（只子集常用字 + 页面标题用字，控制体积；构建时若缺文件则回退系统楷体 `"Kaiti SC","KaiTi",serif`） |
| 正文（中） | 系统栈：`"PingFang SC","Microsoft YaHei",sans-serif` | 不加载 webfont，保证速度 |
| 正文（英）/ UI | 系统栈：`ui-sans-serif,system-ui` | |
| 数学公式 | KaTeX 自带字体（terms 板块引入 KaTeX 时一并处理） | P1 阶段处理 |
| 等宽 | `ui-monospace` | |

规则：标题字体只用于 `h1/h2` 与 Logo「Mathin」；正文、按钮、表单一律系统字体。禁止引入 Google Fonts 远程链接（国内网络不稳定），webfont 一律自托管。

## 3. 线条与形状语言

- **描边**：装饰性图形（星球、星轨、分隔）用 `1.5px–2px` 的 `--crater` 色描边，模拟手绘线稿；功能性边框（卡片、输入框）用 `1px --line`。
- **圆角**：卡片 `rounded-2xl`（1rem）；按钮、输入框 `rounded-full`；大容器 `rounded-[2rem]`。全站不出现直角卡片。
- **星轨虚线**：连接性装饰（学习线、章节时间线）统一用 SVG `stroke-dasharray="1 8" stroke-linecap="round"` 的圆点虚线，色 `--crater`，这是全站最重要的视觉母题（「星与星之间的航线」）。
- **星星装饰**：四角星（✦ 形，同 Main.png 中的星星），做成 `<Star4 />` SVG 组件，填充 `--star`；每屏最多 3–5 颗、只出现在留白处，禁止铺满。
- **阴影**：只允许 `shadow-sm`，禁止大阴影和发光效果。
- **插画**：新插画必须遵循 Main.png 画风 —— 米色/棕色线稿 + 低饱和填色 + 大量留白；由用户提供或确认，agent 不得自行生成上线。

## 4. 排版与间距

- 内容容器：正文类页面 `max-w-3xl`，卡片网格类 `max-w-5xl`，教室/白板全宽。
- 页面纵向节奏：区块间距 `space-y-16`（桌面）/ `space-y-10`（移动）。
- 字号阶梯（Tailwind）：h1 `text-4xl md:text-5xl`、h2 `text-2xl md:text-3xl`、正文 `text-base leading-7`、辅助 `text-sm`。h1 不超过 `text-5xl`（现首页 `text-6xl` 属于过大，需收敛）。
- 中文排版：正文 `leading-7` 以上；中英文之间由文案保证空格，不做 CSS hack。

## 5. 动效

- 只用 CSS transition：`transition-[color,background,transform,opacity] duration-200`。
- hover 允许的效果：颜色过渡、`-translate-y-0.5` 轻浮起、下划线展开；禁止旋转、缩放超过 1.03、弹跳。
- 页面级动画只有一处例外：首页星球导航的缓慢漂浮（`animation: float 6s ease-in-out infinite`，位移 ≤ 6px）。
- 必须尊重 `prefers-reduced-motion: reduce`：关闭所有 animation，保留 opacity 过渡。

## 6. 组件规范

**shadcn/ui 优先（铁律）**：任何可复用组件一律经 shadcn/ui 统一管理——新建组件前必须先查 shadcn/ui 是否已有同类组件，有则 `pnpm dlx shadcn@latest add <name>` 引入并把默认 token 类改写为本设计系统 token（参照已适配的 `dialog.tsx`/`slider.tsx`），禁止绕开它重复造轮子。允许清单：`button dialog slider sheet dropdown-menu input label tabs card badge avatar tooltip separator skeleton sonner`。超出清单先问用户。

自定义组件（放 `src/components/`，逐步建设）：

| 组件 | 职责 |
| --- | --- |
| `SectionShell` | 子页面统一骨架：SiteHeader + 面包屑 + 标题（含 accent 下划线短横）+ 内容槽（详见 02） |
| `Star4` | 四角星 SVG 装饰 |
| `StarPath` | 星轨虚线 SVG（水平/自定义 path 两种用法） |
| `PlanetLink` | 首页/导航用的圆形星球入口（圆 + 描边 + 标签） |
| `EmptyState` | 空状态：一颗星 + 一句话（替代现在的 comingSoon 纯文本） |

按钮变体约定（shadcn button 上定制）：`primary` = rose 底白字；`secondary` = 透明底 crater 描边；`ghost` = 无边框 muted 文字。一个视图同屏只允许一个 primary。
