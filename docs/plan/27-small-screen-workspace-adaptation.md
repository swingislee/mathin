# Mathin 小屏工作区适配规划

> **规划状态**：`active`
>
> **当前用途**：1024–1280px 桌面窄屏与平板横屏下 Dashboard 与备课工作区的可用性修复合同。
>
> **权威边界**：只处理横向/纵向空间分配、断点选择与面板可见性。不改数据模型、权限、路由合同与业务流程；不重开 doc 21～24 的坐标系、命令面板、路由信息架构和对象页骨架。
>
> **剩余项**：全部，见 §6 阶段表。
>
> **最后核对**：2026-08-04；依据 `DashboardShell.tsx`、`SessionPrepPanel.tsx`、`CoursewarePreviewWorkspace.tsx`、`LiveShell.tsx`、`FullScreenToolShell.tsx` 与 `OrganizationSettingsPanel.tsx` 的实测宽度推导。

---

## 1. 问题

doc 24 §8.1 的固定视口签收覆盖 390、1024、1440 三档，判据是**根节点与主画布横向溢出为 0**。该判据通过，工作区仍然不可用：溢出为 0 不能证明面板拿到了可工作的尺寸。1024–1280px 这一段（13 吋笔记本、iPad 横屏、1440 窗口下 125%/150% 缩放）是本规划的目标区间。

三条事实叠加产生问题：

| 事实 | 位置 | 后果 |
| --- | --- | --- |
| 左侧导航 `w-60` 常驻且无折叠入口，唯一的隐藏按钮是 `lg:hidden` | `DashboardShell.tsx:100`、`:133` | 侧栏出现与隐藏按钮消失是同一个 1024px 断点的互补，用户在 ≥1024 没有任何逃生口 |
| 内部布局用视口断点 `xl:` 触发多栏 | `SessionPrepPanel.tsx:109`、`CoursewarePreviewWorkspace.tsx:120`、`TodayWorkHome.tsx:112`、`LiveShell.tsx:880` | `xl:` 生效时正文只有 976px，多栏在正文里挤爆；1024–1279 无中间态 |
| 多个不可压缩的最小宽度串联 | 左栏 `minmax(24rem,30rem)`、rail `17rem`、`WorkspaceRail` 320px | 备课页 4:3 舞台在 1280 上实测约 180×135px |

`WorkspaceSplitShell.tsx:11-13` 已经写明该合同——内部布局用 `@4xl/workspace` 而非 `xl:`，因为固定侧栏与 gutter 之后浏览器宽度不等于可用宽度。本规划是把该合同补齐到未遵守的文件。

## 2. 横向像素预算

`DashboardShell.tsx:100` 侧栏 240px；`:160` gutter 在 `lg` 为 `2rem`，左右共 64px。

| 视口 | 正文可用 | panel 工作区主区（减 `WorkspaceRail` 320px） | 再减课件目录 `17rem` 后的 4:3 预览列 |
| --- | --- | --- | --- |
| 1024 | 720 | 400 | 128 |
| 1280 | 976 | 656 | 384 |
| 1440 | 1136 | 816 | 544 |

Windows 经典滚动条再扣约 15px。`/studio` 与 classroom live 走独立路由，无 dashboard 侧栏，但各自有 540px（`FullScreenToolShell.tsx:75,83`）和 544px（`LiveShell.tsx:977`）的固定侧栏预算。

## 3. 设计决定

| 决定 | 内容 | 原因 |
| --- | --- | --- |
| D1 侧栏三态 | `expanded 240px → icons 56px → hidden 0px` 循环，初值来自 cookie | 图标态保留导航可达性；隐藏态把 240px 全部让给正文。cookie 而非 localStorage，使服务端渲染首帧即为正确宽度 |
| D2 折叠入口全档存在 | 切换按钮常驻侧栏页眉；`hidden` 态由左上 `MainFloatingControl` 召回 | 移除「隐藏按钮只在手机存在」的断点耦合 |
| D3 工作区分栏可拖拽 | 备课工作区与课件预览工作区改用 `react-resizable-panels`，`autoSaveId` 持久化 | 固定轨道无法覆盖 1024–1440 的全部组合；拖拽把分配权交给教师。该库提供键盘可达的分隔条 |
| D4 内部断点一律容器查询 | dashboard 画布内的 `sm:/md:/lg:/xl:/2xl:/min-[Npx]:` 换为 `@Nxl/page:` 或 `@Nxl/workspace:` | doc 23 §17 已有合同；视口断点在 1024–1280 之间必然判错 |
| D5 全屏锁定 4:3 等比 | 4:3 舞台全屏时按 `min(100%, calc(100dvh * 4 / 3))` 反推宽度，纵横比不变 | 标注按逐轴归一化存储（`CanvasSurface.tsx:188-196`），直线/箭头旋转角按创建时纵横比烘焙（`geometry.ts:75-79`）。等比缩放下历史笔迹零错位且无需数据迁移；非等比缩放会横向拉长笔迹并使箭头角度失准 |
| D6 全屏不加滑动翻页 | 翻页只保留按钮与键盘 | 舞台被 `touch-none` 的标注 canvas 完整覆盖（`CanvasSurface.tsx:302,306`），滑动手势会被识别为画笔 |

## 4. 最小尺寸合同

| 面板 | 原下限 | 新下限 | 位置 |
| --- | --- | --- | --- |
| 备课流程条 | 384px（`minmax(24rem,30rem)`） | 320px | `SessionPrepPanel.tsx` |
| 课件目录 rail | 272px（`17rem`）/ 208px（`13rem`） | 200px | `CoursewarePreviewWorkspace.tsx` |
| 4:3 预览列 | 无 | 420px | `CoursewarePreviewWorkspace.tsx` |

三者与 gap 之和为 940px，加侧栏图标态 56px 与 gutter 64px，1024 视口下三栏并存成立。

## 5. 缺陷清单

严重度按「是否阻断该页面的主任务」判定。高＝主任务不可完成或存在真实横向溢出；中＝主任务可完成但需要额外滚动或内容截断；低＝一致性与首帧抖动。

### 5.1 高

| 文件 | 行 | 缺陷 |
| --- | --- | --- |
| `OrganizationSettingsPanel.tsx` | 274 | `lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_minmax(260px,1fr)]` 最小宽合计 732px，超出 1024 视口的 720px 正文，产生真实横向溢出；`main` 的 `overflow-y-auto` 使另一轴同为 auto，溢出静默变成横向滚动 |
| `home/TodayWorkHome.tsx` | 112 | `xl:grid-cols-4` 在正文 976px 时每列 226px，员工首页第一屏的标题与操作按钮折行 |
| `courseware/preparation-review/page.tsx` | 81、107 | 嵌套两层 `xl:` 网格，1280 下右列被钳到 380px |
| `SessionPreparationCoursewareReview.tsx` | 121、136 | `min-h-[36rem]` 超出 1024×768 的可用高度；`h-[calc(100vh-6rem)]` 用 `vh`；`xl:grid-cols-1` 写死使 rail 永远占据预览上方 32% 高度 |
| `classroom/live/LiveShell.tsx` | 880 | 唯一分栏阈值 `xl:`，1024 横屏下主板书、副板书、名录与控制条纵向堆叠，上课需滚动才能看到学生名录 |
| `stage/FullScreenToolShell.tsx` | 75、83、93 | 220px 与 320px 两栏共用 `lg:` 阈值，1024 下同时展开占 540px，舞台剩 484px；收起入口 `lg:hidden` 同时消失 |

### 5.2 中

| 文件 | 行 | 缺陷 |
| --- | --- | --- |
| `TileWorkspace.tsx` + `globals.css` | 494 / 97-102 | `lg:grid-cols-6` 与 `.tile-cell` 的 `min-width:1024px` 坐标同步，1024 下每格约 110px |
| `CoursewarePreviewWorkspace.tsx` | 120-123 | rail 与预览的分栏用 `xl:`，而该组件总是渲染在已被侧栏和 `WorkspaceRail` 扣减过的主区里 |
| `SessionPrepPanel.tsx` | 109 | 分栏用 `xl:`，1024–1279 完全无分栏 |
| `SessionLearningCheckPanel.tsx` | 301、391 | 全屏 Dialog 用 `w-screen`（含滚动条宽度）；座位网格用 `min-[900px]` 视口查询判断 iPad 布局 |
| `RolesMatrixPanel.tsx` | 115-116 | `lg:w-72` 侧栏在 1024 触发，权限矩阵主区剩 408px |
| `DataQualityPanel.tsx` | 56 | `xl:grid-cols-5`，1280 下每卡 185px |
| `DataRepairPanel.tsx`、`ClassBuildWizard.tsx` | 114 / 216 | `md:grid-cols-2 xl:grid-cols-4`，1280 挤而 1024 空 |
| `OrganizationSettingsPanel.tsx` | 197、234、259 | `md:grid-cols-3` / `md:grid-cols-4` / `lg:grid-cols-[220px_220px_1fr]`，日期控件的 min-content 使 720px 正文下逼近临界 |
| `whiteboard/Toolbar.tsx` | 178 | `max-w-[calc(100vw-1rem)]` 按视口计算上限，但工具栏定位在约 724px 的主板书列内，可能覆盖右侧副板书 |
| `ReviewDrawer.tsx` | 8 | `max-h-[85vh]` 用 `vh`；`min-w-[850px]` 表格在 1024 下后三列默认不可见 |

### 5.3 低

| 文件 | 缺陷 |
| --- | --- |
| `StageReportPanel.tsx:332` | 同一 class 串混用 `md:` 与 `@6xl/page:` |
| `SessionStudentPostworkCards.tsx:199` | `2xl:grid-cols-3` 使 1280–1535 停在两列 |
| `dashboard/loading.tsx:2` | 骨架用视口断点，真实页面用容器查询，加载完成瞬间列数跳变 |
| `LecturePreviewDialog.tsx:24`、`TeachingPlanEditor.tsx:103`、`AdaptBackgroundReworkQueue.tsx:157`、`SessionSolutionArchive.tsx:151` | `vh` 与 `dvh` 混用 |

## 6. 阶段

| 阶段 | 动作 | 退出证据 |
| --- | --- | --- |
| **S1 侧栏三态** | D1、D2；`globals.css` 的 `--main-floating-control-safe-inline-size` 解除与 1024 断点的硬耦合；zh/en 文案 | 三态在 1024/1280/1440 下切换正确；页头标题不被左上按钮覆盖；`pnpm ci:checks` 通过 |
| **S2 备课分栏** | D3、D4 应用于 `SessionPrepPanel` 与 `CoursewarePreviewWorkspace`；§4 最小尺寸合同 | 1024 下三栏并存且 4:3 舞台短边 ≥ 420px；拖拽后刷新保持布局 |
| **S3 4:3 全屏** | D5、D6；全屏内保留可拖拽 rail、工具栏与翻页 | 全屏前后同一条笔迹的归一化坐标不变；退出全屏后布局复原 |
| **S4 缺陷清零** | §5 高、中、低逐项修复 | 逐项复测；1024/1280/1440 × 亮暗横向溢出为 0 |
| **S5 防回退** | 扩展 `scripts/verify-doc24-dashboard-closeout.mjs`：dashboard 画布内禁止视口前缀的多栏声明，白名单登记例外 | 审计脚本对修复前的代码报错、对修复后的代码通过 |

## 7. 与既有门禁的关系

本规划的改动落在三个审计脚本的扫描范围内，实施时同时满足：

| 脚本 | 相关约束 |
| --- | --- |
| `verify-doc21-coordinates.mjs` | `DashboardShell.tsx` 不得出现 `lg:pr-*`；dashboard 与 school 目录不得同行出现 `mx-auto` 与 `max-w-*` |
| `verify-doc23-object-workspaces.mjs` | `DashboardShell.tsx` 必须从 `dashboard-routes.ts` 解析外壳模式，不得手写 segment 判断 |
| `verify-doc24-dashboard-closeout.mjs` | 新增横向滚动容器需登记白名单并注明类别；同一 class 串内 `flex-1` 不得与正数 `min-w-*` 共存；弹层高度约束不得删除 |

## 8. 依赖

| 依赖 | 用途 | 引入阶段 |
| --- | --- | --- |
| `react-resizable-panels`（shadcn `resizable`） | D3 的可拖拽分栏与键盘可达分隔条 | S2 |
| `@radix-ui/react-tooltip`（shadcn `tooltip`） | D1 图标态导航项的标签 | S1 |
