# Mathin 整体规划 · 09 P5 故事执行计划

> 本文是 P5 的权威执行计划，地位等同 `07`/`08` 之于 P3/P4。前置阅读：`00-overview.md`、`02-pages.md` §3.1、`05-planet-themes.md` §3.1、`04-roadmap.md` P5。
>
> **v1 修订（2026-07-08，用户拍板）**：story 板块从「漫画/动画阅读」升级为**可直接在网页上沉浸式游玩的故事游戏**——风格参照 [Messenger（messenger.abeto.co）](https://messenger.abeto.co/)：小世界漫游、对话与递送式小任务、环境音乐、15–30 分钟一章、手机浏览器可玩。规模上「相对大型游戏会很简单」。本文与 00-§21「漫画/动画形式」及 02-§3.1「漫画阅读页」冲突之处以本文为准；**漫画仍是受支持的章节媒介之一**（见 §3.7），用户脚本与美术产出节奏决定每章形态。

## 1. 范围与非目标

**做**：

1. 一个轻量**故事引擎**（场景漫游、对话、任务、数学谜题嵌入、存档），章节以注册表模式逐章上线。
2. 序章 + 第一批章节：小王子题材的数学之旅，每章一颗星球/一段旅程，10–20 分钟流程。
3. `/story` 章节时间线页（05-§3.1 旅行明信片风格）+ `/story/[chapter]` 全屏播放器。
4. 进度存档：未登录本地可玩，登录后云同步（`story_progress`）。
5. **数学即玩法**：谜题 beat 复用 P2 游戏（seed 确定性题面）与 tools 组件，章末链接 terms 概念——这是与一般叙事游戏的差异化核心。

**不做**（明确放弃，除非用户重启议题）：

- 多人在线（Messenger 的 emoji 多人是其魅力点，但需要常驻 WebSocket 服务与反滥用，P5 不做；课堂里"全班一起玩"场景已由 P4 的 game 课件页覆盖）。
- 3D 渲染（见 §3.1 技术结论）；物理引擎；战斗/失败状态/计时压力——本作无失败，节奏是"漫步与好奇"。
- 语音配音、过场视频、成就系统平台化（星星收集只做章节内计数与展示）。
- 编辑器/所见即所得剧情工具——章节脚本就是 TS 文件，作者即开发者（00-铁律）。

## 2. 风格参照解构（为什么 Messenger 感觉好）

技术事实（HN 与案例文档）：Three.js + 原生 JS，**没有用游戏引擎**；GSAP 做补间；Draco 压缩网格 + KTX2 纹理；首包 5.7MB、全量 17.5MB；WebSocket 多人；Houdini/Blender/Substance 制作资产。

体验要素（这些才是要搬的东西）：

| 要素 | Messenger 的做法 | Mathin 的移植 |
| --- | --- | --- |
| 小而完整的世界 | 一颗可绕行一周的迷你星球 | 每章一颗星球/一段场景带，边界自然（星球是圆的） |
| 无失败状态 | 只有递送与交谈，没有死亡/倒计时 | 谜题可无限尝试、可跳过（跳过则少一颗星） |
| 低认知负担 UI | 几乎无 HUD，走近才浮现提示 | 热点接近时才发光；对话框极简；无任务日志（一次只有一个心愿） |
| 环境音 | lo-fi 循环曲 + 脚步/交互音效 | 每章一首环境循环 + 少量 SFX；首次手势解锁 |
| 节奏 | 15–30 分钟通关，步行速度慢 | 每章 10–20 分钟；行走速度刻意放慢 |
| 移动可玩 | 触屏点击即走 | 点哪走哪（point-and-click）为主交互，键盘可选 |

## 3. 技术结论

### 3.1 渲染路线：自研 2.5D 分层插画场景（DOM/CSS），不引游戏引擎

三条路线的取舍：

| 路线 | 优点 | 致命问题 |
| --- | --- | --- |
| A. Three.js/R3F 低多边形 3D（Messenger 同款） | 观感最接近参照 | **资产管线不可持续**：每章需要建模/展UV/贴图/绑骨（Messenger 团队用 Houdini+Substance 的专业管线）；用户是内容作者不是 3D 美术，agent 代产 3D 资产质量不可控。技术不是瓶颈，**内容产能才是** |
| B. PixiJS / Phaser 2D 引擎 | 精灵/粒子性能好 | 自带一整套场景/资源/循环体系，与 React、next-intl、设计 token 隔离；为"每屏几十个元素"的体量引 1MB 级依赖，违反 03 的最小依赖纪律（同"零 Yjs"的判断结构） |
| **C. 自研 DOM/CSS 2.5D 场景引擎（推荐）** | 零新依赖；插画=用户已有的美术语言（05 全站插画素材本就由用户提供）；文案是真 DOM（i18n/无障碍/字体 token 全部免费）；CSS transform + Web Animations API 足以覆盖视差/行走/补间；已有 canvas 经验可做星空粒子层 | 上限低于 WebGL（大规模粒子/光照做不了）——但本作不需要 |

**结论：路线 C。** Messenger 自己也没用引擎——氛围来自美术、音频与节奏。仿其神不仿其形：3D 迷你星球的招牌镜头用 2D 就能复刻——**角色固定在画面底部中央，整个星球容器绕圆心旋转**（`transform: rotate()`，行走=旋转星球），这正是本站首页「星球」母题的天然延伸，B-612 直接可玩化。

**升级条款**：若实测出现 DOM 动画性能不可救（如粒子层需求超过数百元素），报用户批准后引入 PixiJS **只接管特效层**（星空/沙尘），场景与对话仍留在 DOM。不整体迁移。

### 3.2 故事引擎（自研，~4 个模块）

```
场景 Scene    = 背景分层（视差深度）+ 演员（精灵）+ 热点（可走/可看/可谈/出口）+ 环境（音乐/粒子预设）
对话 Dialogue = 节点图：{ speaker, text:{zh,en}, choices?, if?, do? }——条件与效果驱动剧情
状态 State    = zustand：flags（Record<string, boolean|number>）+ 星星 + 当前场景 + 存档版本号
谜题 Puzzle   = beat 类型之一：挂载 games/tools 组件，完成回调 do 效果（给星/开门/推进）
```

- **不引 Ink/Twine 等叙事引擎**：它们面向单语纯文本，双语字段、类型安全（flag 名拼错要在编译期炸）、与 React 组件（谜题 beat）互嵌都是自研更顺——对话图本质是一个 ~200 行的 reducer。
- 行走：点哪走哪。可行走区域用一条**折线路径**（1D 参数化）而非自由寻路——角色只沿路径移动，视差层按参数位置平移/旋转。这砍掉了寻路算法，也是"星球是圆的"的自然表达（路径首尾相接成环）。
- 精灵动画：4–8 帧行走/待机图集，CSS `steps()` 播放；`prefers-reduced-motion` 时停用视差与漂浮动画，保留淡入淡出。
- 章节注册表：`src/features/story/registry.ts`（同 games/tools 模式），章节 = `chapters/<slug>/script.ts`（场景与对话，类型化）+ `public/story/<slug>/`（美术与音频）。
- **章节叙事文本内嵌脚本文件（`{zh,en}` 双字段），不进 `messages/*.json`**：叙事文本量随章节线性增长且与场景逻辑强耦合，塞全局文案文件会失控；`messages` 只放播放器 UI 骨架文案（继续/音量/跳过/读档）。这是对 00-§41「内容进 content/ 目录」原则的延续——只是载体从 MDX 变为类型化 TS。

### 3.3 交互与播放器

- `/story/[chapter]` 为**全屏沉浸页**：`h-dvh`、无 SectionShell（先例：P4 上课页）；左上角唯一常驻 UI = 返回 + 静音；进入时"夜航蓝"渐暗过场（05-§3.1 的夜航氛围转给播放器）。
- 触屏优先：单击/轻触=走过去或交互；热点在角色接近时才浮现光晕（狐狸橙）。桌面追加 ←→ 键行走、E/空格交互。
- 存档：场景切换与关键 flag 变更时自动存（无手动存档 UI）；章节卡显示进度环与已得星星。

### 3.4 音频

- Web Audio API（不引 howler）：每章一首环境循环（ogg + m4a 双源，Safari 需要后者）+ ≤10 个 SFX 合并成音频雪碧图。
- 浏览器自动播放策略：首次用户手势（进入章节的"开始"按钮）解锁 AudioContext；静音状态与音量存 localStorage。

### 3.5 资产管线与体积预算

- 分层背景：webp（大图 ≤ 200KB/层，一场景 3–5 层）；精灵图集 webp；插画由用户提供或确认（00-铁律 7），未就绪用几何占位。
- **预算：每章初始加载 ≤ 3MB，全章 ≤ 6MB**（Messenger 全 3D 才 17.5MB，2D 没有借口超）。章节进入时预载当前+下一场景，`img.decode()` 预解码防切场景卡顿；加载屏 = 星空 + 一句章节引言。
- 资产放 `public/story/<slug>/`（随 git；故事资产是作品本体，不入 Supabase Storage——02-§3.1 的"届时评估迁 Storage"就此了结：不迁）。

### 3.6 数学即玩法（差异化核心）

- 谜题 beat 直接挂载 P2 游戏棋盘组件（`{gameId, difficulty, seed}`，`createRng(seed)` 确定性题面，P4 已验证过这条复用路径）与 tools 演示组件（分数数轴、相遇追击）。
- 剧情包装：谜题是剧中人的"心愿"（国王要一张 3×3 的完美王国税表=幻方；点灯人要算相遇时刻=行程工具）。解开给星星并推进对话；**可跳过**（少一颗星，不卡死流程——无失败原则）。
- 章末"旅行者的地图"：本章遇到的数学概念卡片，链接到 `/terms` 对应概念页——故事把访客送进核心板块。

### 3.7 章节媒介的灵活性

章节 `meta` 带 `kind: "playable" | "comic"`。漫画章节复用 02-§3.1 原设计（纵向长图 + 进度条），作为脚本/美术产能不足时的降级形态与两章之间的"幕间"。时间线页两种卡混排，邮票框图标区分。

## 4. 数据模型（migration，经 SSH 直接执行）

```sql
story_progress (
  user_id      uuid references profiles(id) on delete cascade,
  chapter_slug text,
  state        jsonb not null default '{}',   -- {version, flags, stars, scene, updatedAt}
  updated_at   timestamptz not null default now(),
  primary key (user_id, chapter_slug),
  check (octet_length(state::text) <= 65536)
)
-- RLS：仅本人读写（story 是公开板块，未登录全程可玩，本地 localStorage 即存档；
-- 登录后双向同步，合并策略=取 state.updatedAt 较新者，客户端裁决）
```

无其他表。星星总数、章节完成度都从 `state` 聚合，不另建统计表。

## 5. 前端架构

```
src/features/story/
  engine/
    types.ts          # Scene/Actor/Hotspot/DialogueNode/Beat/SaveState 类型
    store.ts          # zustand：剧情状态机 + 本地存档（versioned）
    SceneStage.tsx    # 分层视差渲染 + 星球旋转行走 + 热点层
    DialogueBox.tsx   # 打字机对话框 + 选项
    PuzzleBeat.tsx    # games/tools 组件挂载壳（完成回调 → do 效果）
    audio.ts          # AudioContext 单例、解锁、雪碧图 SFX
  registry.ts         # 章节注册表（slug、标题、kind、封面、顺序、状态）
  chapters/<slug>/script.ts
  actions.ts          # story_progress 读写（Server Actions）
src/app/[locale]/story/page.tsx            # 时间线（SectionShell + data-planet="earth"）
src/app/[locale]/story/[chapter]/page.tsx  # 全屏播放器（客户端组件为主）
public/story/<slug>/  # 分层背景/精灵/音频
```

路由从 `[section]` 白名单中拆出 story 独立目录（同 games 先例）；proxy 公开路径不变。

## 6. 任务拆分（每条 = 一次提交，视觉节点截图报批）

- **P5-0 拍板与样板脚本**（无代码）：①美术路线确认（2D 分层插画，本文 §3.1——若用户坚持 3D 则整体重议）；②序章脚本由用户提供或与用户共创确认（建议：B-612 出发前夜，1 个场景 + 1 个谜题 beat，10 分钟）；③每章素材清单模板定稿（背景层数、精灵帧数、音频规格），让用户知道"写一章要画什么"。
- **P5-1 引擎核心（占位美术）**：engine/ 四模块 + 全屏播放器壳 + 本地存档 + reduced-motion/触屏适配。验收：纯几何占位的测试场景里可行走、触发对话、完成一个幻方谜题 beat 得星、刷新后进度还在；手机浏览器（LAN 非安全上下文）可玩。
- **P5-2 序章上线**：真实/首批美术 + 环境音循环 + 章末概念卡；打通资产预算与预载。验收：移动端 10 分钟通玩，初始加载 ≤ 3MB，音频在 iOS Safari 正常解锁。
- **P5-3 时间线页**：05-§3.1 旅行明信片卡 + 进度环/星星 + playable/comic 混排 + 未发布章节占位。四档截图。
- **P5-4 云存档**：`story_progress` migration + 登录同步（本地优先、较新者胜）。验收：A 设备玩到一半，登录 B 设备续玩；匿名越权读他人进度被 RLS 拒。
- **P5-5 第 1 章**（用户脚本与美术齐备后）：自此"逐章上线"成为常态任务，每章走 P5-2 同款验收。
- **P5-6 收尾**：dashboard 故事进度卡（可选）、性能预算复核、四档视觉与无障碍回归。

排序理由：引擎先行（P5-1）但**必须用占位美术**——内容产能是最大不确定项，不能让工程等美术；序章（P5-2）刻意最小（1 场景 1 谜题）以最快验证"这样好玩吗"，不好玩就在最便宜的时刻调方向。

## 7. 隐含坑清单（执行 agent 必读）

- **音频自动播放**：AudioContext 必须在用户手势里 `resume()`；iOS Safari 对 ogg 不支持，必须双源；切后台要 `suspend()` 省电。
- **iOS 视口**：`100dvh` + 防止滚动回弹（播放器 `overscroll-behavior: none`、`touch-action: none` 于舞台层）；地址栏收放会触发 resize——舞台尺寸用 ResizeObserver 而非一次性测量（P4 已有先例）。
- **图片解码卡顿**：场景切换前 `img.decode()` 预解码；分层背景禁用 `loading="lazy"`（播放器内自己管预载）。
- **合成层内存**：视差层 `will-change: transform` 只在动画期间挂，常驻会在低端手机上爆合成层内存。
- **存档版本化**：`state.version` 必带；章节脚本改动（flag 改名/场景增删）要写迁移或声明不兼容重置——否则老存档载入新脚本会卡死在不存在的场景。
- **SSR/水合**：播放器整体 `"use client"`；星空等随机装饰必须用 seed（复用 `createRng`），否则服务端/客户端渲染不一致警告。
- **精灵 `steps()`**：帧数与 `animation-timing-function: steps(n)` 的 n 必须一致，图集尾帧留白会造成"闪帧"。
- **非安全上下文**（LAN http）：不用 crypto.randomUUID（已有 `newId` 兜底）、无 Wake Lock——播放器不依赖任何安全上下文 API。
- **双语文本溢出**：对话框按 en 文本最长情况留高度；打字机效果按字素簇（`Intl.Segmenter`）而非 code unit 切分，否则中文标点/emoji 会劈开。
- 秘钥纪律与 migration SSH 流程同 P3/P4（`docs/supabase-self-hosting.md`）。
