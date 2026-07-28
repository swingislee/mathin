# Dashboard 对象详情页与专业工作区整体重建规划

> **规划状态**：`complete`
>
> **当前用途**：UI-L3 对象页、工作区与响应式一致性竣工记录。
>
> **权威边界**：不作为当前施工单；现有自动审计和代码是落地证据。
>
> **剩余项**：发布多角色/多断点签收见 doc 25。
>
> **最后核对**：2026-07-28。

> 建议仓库路径：`docs/plan/23-dashboard-object-pages-workspaces-rebuild.md`
> 校准基线：远端 `main`，commit `a9447b9cedec731208b5f95a8b15c754d4e2e262`
> 前置状态：doc 21、doc 22 已施工完成并推送
> 适用范围：学生详情、班级详情、课程产品/版本、课次工作区、讲次工作区、课件素材替换工作区
> 规划性质：整体重建页面结构，不是现有页面的样式微调  
> 核心要求：保留业务能力，拆除旧页面骨架；先完成真实参考页，再提取经过验证的公共组件

---

## 1. 当前仓库施工状态

### 1.1 doc 21 已完成的基础设施

doc 21 已建立普通 Dashboard 页面的统一基础：

```text
DashboardShell
├── 唯一水平 gutter
├── 固定侧栏
├── 全局悬浮控件安全区
├── 普通页面整体滚动
└── panel workspace 内部滚动模式
```

现有普通页面组件：

```text
src/features/school/dashboard-page/
├── DashboardPage.tsx
├── DashboardPageChrome.tsx
├── DashboardPageHeader.tsx
├── DashboardPageIdentity.tsx
├── DashboardCommandPanel.tsx
├── DashboardCommandTabs.tsx
├── DashboardPageBody.tsx
├── DashboardContentGrid.tsx
├── DashboardPageSection.tsx
├── DashboardPageSummary.tsx
└── dashboard-page.types.ts
```

已经具备：

- 统一左右坐标；
- 页头和命令面板共同 sticky；
- 悬浮控件安全区；
- 状态、筛选和操作的统一命令面板；
- container query；
- 12 列内容网格；
- 8 + 4 主栏/侧栏；
- `doc21:audit`；
- 旧 `PageHeader` 已删除。

因此 doc 23 **不得重新创建**：

```text
ObjectDetailLayout       ← 已有 DashboardContentGrid
ObjectSummaryAside       ← 已有 DashboardAside
普通详情页 Header        ← 已有 DashboardPageHeader
普通详情页 Body          ← 已有 DashboardPageBody
普通详情页宽度系统       ← 已由 DashboardShell / DashboardPage 决定
```

---

### 1.2 doc 22 已完成的基础设施

doc 22 已完成：

- `dashboard-routes.ts` 路由合同；
- 三套导航从合同派生；
- URL 信息架构清理；
- 动态参数业务语义化；
- 旧 URL hard cut；
- active environment 守卫；
- 唯一 active 导航项；
- `/dashboard/courses/new`；
- 旧 Course Variant ID 兼容删除；
- `doc22:audit` 与真实路由树双向校验。

当前 canonical 对象路由：

```text
/dashboard/students/[studentId]
/dashboard/classes/[classId]
/dashboard/sessions/[sessionId]
/dashboard/courses/[courseFamilyId]
/dashboard/courseware/lectures/[lectureId]
/dashboard/courseware-assets/[assetId]
```

doc 23 不负责重新设计 URL、权限、环境和创建方式。

只允许在现有路由合同中补充页面表现元数据，例如：

```ts
shellMode: "page" | "panel"
```

不得复制一份独立页面模式路由表。

---

## 2. 六个对象页当前真实状态

### 2.1 学生详情

当前已经使用：

```text
DashboardPage
DashboardCommandPanel
DashboardContentGrid
DashboardMainColumn
DashboardAside
```

当前改进：

- 已接入统一坐标；
- 主内容 8 列；
- 监护邀请、可见范围和合并进入 4 列侧栏；
- 生命周期操作进入命令面板。

仍存在：

- 主栏仍是原有超长纵向内容；
- 档案、跟进、学习、视频、课评、作业、财务连续堆叠；
- 侧栏放的是操作面板，不是稳定摘要；
- 没有对象子视图；
- 状态、跟进状态和绑定码全部塞进 `meta`；
- `StudentLifecycleActions` 仍可能展示多个同级操作。

结论：

> 学生详情继续使用 `DashboardPage`，但正文信息结构必须整体重组；不得再造 ObjectDetailLayout。

---

### 2.2 班级详情

当前使用：

```text
ObjectWorkspace
ObjectBar
ContextBar
```

已经具备：

- 标题、返回、上下文和状态；
- 一个主操作；
- 设置 Sheet；
- URL 驱动的四个 Tab；
- Session Drawer。

仍存在：

- `ObjectBar` 与 doc 21 的身份体系平行；
- 返回链接排在标题、状态之后，移动端还被隐藏；
- `ContextBar` 同时允许 Tabs 和 filters；
- 没有稳定摘要侧栏；
- 班级上下文被拼成一条长字符串；
- 异常提示仍是正文横幅；
- 当前 Tab 只是显示旧业务面板，页面级信息没有重组。

结论：

> 班级页必须验证“对象工作区 + 主侧栏”，不能只替换 ObjectBar 或外包一层 grid。

---

### 2.3 课程产品 / 课程版本

当前已经具备：

```text
ObjectWorkspace
ObjectBar
VariantMatrix
VariantSelector
TeachingPlan
UsagePanel
ResponsibilityPanel
```

仍存在：

- Family 与 Variant 正文结构差异大；
- Family 仍是“描述 → 矩阵 → 责任”的纵向堆叠；
- Variant 有额外身份统计卡，重复 ObjectBar；
- VariantSelector 没有独立上下文切换语义；
- Usage 与 Responsibility 位于正文底部；
- readiness 只是身份卡里的数字；
- 没有稳定决策侧栏。

结论：

> 课程页最接近参考工作区，但当前实现不能直接作为标准，必须重建 Family 和 Variant 两种蓝图。

---

### 2.4 课次工作区

当前使用：

```text
ObjectWorkspace scroll="internal"
ObjectBar
ContextBar
SessionPrepPanel
SessionLivePanel
SessionPostworkPanel
```

已经具备内部滚动、三个阶段和主动作算法。

仍存在：

- `pre/live/post` 使用 `tab` 参数，实际语义是工作阶段；
- 阶段切换使用语义不清的 `ContextBar`；
- 没有右侧上下文或决策区；
- 班级、时间、讲次、时长信息不足；
- 返回固定班级，不支持从课表进入后的安全来源返回；
- 当前只是三个旧业务 Panel 的切换壳。

---

### 2.5 讲次工作区

当前使用：

```text
LectureWorkspaceShell
ObjectWorkspace scroll="internal"
ObjectBar
ContextBar
StatusStrip
DecisionRail
```

已经具备：

- 主区 + 决策栏；
- 内部滚动；
- 轨道切换；
- 权威预览；
- 流程状态；
- 责任分配与使用情况。

仍存在：

- `LectureWorkspaceShell` 是讲次专用，但结构实际可复用；
- `DecisionRail` 壳层是通用的，命名却过于业务化；
- 主区仍是多个卡片纵向堆叠；
- Responsibility 与 Usage 挤占主工作区；
- 轨道切换被当作通用 ContextBar；
- ObjectBar 与 Rail 各自处理安全区，缺乏统一 workspace chrome 合同。

---

### 2.6 课件素材替换工作区

当前外层：

```text
DashboardPage
```

`SharedAssetReplacementEditor` 内部自行拥有：

- 轨道导航；
- 使用树；
- 勾选状态；
- 当前素材；
- 上传；
- 暂存；
- 新旧对比；
- 替换影响；
- 应用；
- 回滚；
- 两栏布局。

仍存在：

- 专业编辑器被当作普通页面；
- `DashboardShell.isPanelWorkspace()` 未识别素材详情；
- 外层页面滚动与内部长内容叠加；
- 标题是通用“素材详情”，不是素材名；
- 轨道导航藏在业务组件；
- 业务组件超过 250 行并拥有页面布局职责；
- 右侧栏为自制结构，不复用现有 Rail；
- 主操作不在统一顶部或 Rail。

结论：

> 素材详情必须进入 panel workspace，并拆解单体编辑器；不得只换标题。

---

## 3. 校准后的任务定义

doc 23 不是：

```text
给旧页面套新组件
替换页头
统一 className
把原整页塞入 Tabs
```

doc 23 是：

> 在不重写数据查询、权限和 Server Actions 的前提下，重建六个对象页的顶层 JSX、信息分组、操作层级和滚动结构，并将 doc 21 与现有 stage 体系中的重复能力合并成一套稳定组件语言。

---

## 4. 基础设施处理合同

### 4.1 必须保留

```text
DashboardShell gutter
DashboardPageChrome sticky / safe area
DashboardPageBody container query
DashboardContentGrid / DashboardMainColumn / DashboardAside
DashboardCommandPanel
dashboard-routes.ts
active environment
doc21:audit
doc22:audit
```

允许修复缺陷，不得另造平行替代品。

---

### 4.2 保留名称但必须重写

```text
ObjectWorkspace
ObjectBar
```

#### ObjectWorkspace

保留：

- `ambient` / `internal`；
- objectBar / navigation / statusStrip；
- 内部单一滚动原则。

新增：

- workspace container query；
- 可组合主区 + Rail；
- 与 route contract 的 `shellMode` 对齐；
- 明确 ambient 使用 Dashboard 主滚动；
- 明确 internal 禁止 body 滚动。

不得变成拥有大量业务布尔参数的万能组件。

#### ObjectBar

必须重写：

- 返回入口位于对象身份之前；
- 移动端不得隐藏唯一返回；
- 上下文改为结构化 slot，不能只接长字符串；
- title / context / status / action 有稳定区域；
- 不依赖 flex-wrap 随机换行；
- 不再单独手写返回链接。

---

### 4.3 必须提取的共享原语

#### A. DashboardBackLink

来源：

```text
DashboardPageIdentity 返回链接
ObjectBar 返回链接
```

目标：

```text
src/features/school/dashboard-page/DashboardBackLink.tsx
```

统一：

- 图标；
- label；
- hover/focus；
- 安全 `returnTo`；
- 移动端行为。

普通页和工作区可有尺寸变体，但不得再平行手写 Link。

---

#### B. RouteTabs

来源：

```text
DashboardCommandTabs
ContextBar 中的 Tabs + Link
```

目标：

```text
src/features/school/navigation/RouteTabs.tsx
```

统一：

- URL 导航；
- `aria-current`；
- badge；
- 横向滚动；
- 键盘访问；
- active 状态。

保留薄封装：

```text
DashboardCommandTabs
ObjectTabs
```

---

#### C. WorkspaceSplitShell

来源：

```text
LectureWorkspaceShell
素材编辑器自制两栏
```

目标：

```text
src/features/school/object-workspace/WorkspaceSplitShell.tsx
```

统一：

- 主区；
- Rail；
- panel 高度；
- container query；
- 窄屏退化；
- 滚动边界。

`LectureWorkspaceShell` 最终删除。

---

#### D. WorkspaceRail

来源：

```text
DecisionRail
素材编辑器右侧 aside
```

目标：

```text
src/features/school/object-workspace/WorkspaceRail.tsx
```

统一：

- 桌面宽度；
- 独立滚动；
- 标题；
- safe area；
- section 间距；
- 移动端抽屉或下沉。

---

### 4.4 必须删除或拆分

```text
ContextBar
LectureWorkspaceShell
SharedAssetReplacementEditor 的页面布局职责
```

`ContextBar` 拆成：

```text
ObjectTabs
StageNavigation
TrackSwitcher
局部 filters
```

`SharedAssetReplacementEditor` 拆成：

```text
AssetReplacementController
AssetUsageTree
AssetReplacementPreview
AssetReplacementRail
AssetReplacementHistory
```

---

## 5. 组件提取原则

### 5.1 先重建，再抽取

禁止：

```text
先猜六页需要什么
→ 造万能 ObjectWorkspace
→ 把旧页面塞进去
```

采用：

```text
课程页重建
→ 班级页验证重复
→ 提取稳定原语
→ 课次页验证 API
→ 学生与编辑型工作区迁移
```

### 5.2 两页验证门槛

除现有基础组件的直接重构外，新公共组件至少满足两项：

- 已在两个重建页面出现；
- DOM 基本一致；
- 响应式一致；
- 滚动一致；
- 无业务数据依赖；
- props 可用稳定语义描述。

不得提取：

- 只有一个页面使用；
- 需要大量布尔 props；
- 需要整页业务对象；
- 内部判断权限；
- 内部请求数据；
- 仅颜色和间距相似。

### 5.3 只复用页面语言

可以复用：

```text
返回
身份
状态外壳
URL Tabs
主侧栏
Rail
滚动
Section
操作菜单外壳
```

不得跨域复用：

```text
学生跟进
班级课次
课程版本矩阵
课次阶段业务
课件决策
素材替换状态
权限判断
数据加载
Server Actions
```

---

## 6. 页面模式进入路由合同

当前 `DashboardShell.isPanelWorkspace()` 硬编码：

```text
courseware/lectures/[lectureId]
sessions/[sessionId]
schedule
```

扩展 `dashboard-routes.ts`：

```ts
export type DashboardShellMode = "page" | "panel";

interface DashboardRoute {
  shellMode?: DashboardShellMode;
}
```

默认 `page`。

标记为 `panel`：

```text
schedule
sessionDetail
coursewareLecture
coursewareAssetDetail
```

新增：

```ts
resolveDashboardShellMode(pathname)
```

`DashboardShell` 不再维护 `isPanelWorkspace()` 路径分支。

验收：

- Shell 不再手写 route segment；
- 素材详情进入 panel；
- route contract 为唯一模式来源。

---

## 7. 三种最终骨架

### 7.1 普通对象详情

适用：学生。

```text
DashboardPage
├── DashboardPageChrome
│   ├── DashboardPageHeader
│   └── DashboardCommandPanel
│       ├── ObjectTabs
│       └── 主操作 + overflow
└── DashboardPageBody
    └── DashboardContentGrid
        ├── DashboardMainColumn
        └── DashboardAside
```

滚动：Dashboard main 唯一滚动。

不得新建 ObjectDetailLayout。

### 7.2 普通对象工作区

适用：课程、班级。

```text
ObjectWorkspace ambient
├── ObjectBar
├── ObjectTabs / ContextSwitcher
└── DashboardContentGrid
    ├── DashboardMainColumn
    └── DashboardAside
```

滚动：Dashboard main 唯一滚动。

### 7.3 Panel 工作区

适用：课次、讲次、素材。

```text
ObjectWorkspace internal
├── ObjectBar
├── StageNavigation / TrackSwitcher
├── WorkspaceSplitShell
│   ├── MainWorkspace
│   └── WorkspaceRail
└── ObjectStatusStrip（可选）
```

滚动：

- Dashboard main 不滚动；
- MainWorkspace 独立滚动；
- WorkspaceRail 独立滚动；
- 禁止第三个纵向滚动容器。

---

## 8. 第一参考实现：课程产品 / 版本

### 8.1 Family 蓝图

```text
ObjectWorkspace ambient
├── ObjectBar
│   ├── 返回课程库
│   ├── 产品名称
│   ├── 出版社 · 学段 · 学科 · 版本
│   ├── 状态 / 测试
│   └── overflow
└── DashboardContentGrid
    ├── Main
    │   ├── 产品说明
    │   └── VariantMatrix
    └── Aside
        ├── 产品摘要
        ├── 产品负责人
        └── 版本风险 / 缺失提示
```

| 当前 | 新位置 | 处理 |
|---|---|---|
| ObjectBar | ObjectBar | 重写 |
| family description | Main | 保留 |
| VariantMatrix | Main | 保留 |
| ResponsibilityPanel | Aside | 移动 |
| identity 长字符串 | structured context | 拆分 |
| 纵向责任面板 | 删除原位置 | 不重复 |

### 8.2 Variant 蓝图

```text
ObjectWorkspace ambient
├── ObjectBar
│   ├── 返回产品总览
│   ├── 版本名称
│   ├── 产品码 · 年级 · 季节 · 班型
│   ├── 状态
│   ├── 主操作
│   └── overflow
├── ObjectContextSwitcher
│   └── VariantSelector
└── DashboardContentGrid
    ├── Main
    │   └── TeachingPlan
    └── Aside
        ├── Readiness
        ├── Usage
        └── Responsibility
```

| 当前 | 新位置 | 处理 |
|---|---|---|
| 额外身份统计卡 | 删除 | 信息拆入 context / Aside |
| VariantSelector | ContextSwitcher | 从卡片移出 |
| TeachingPlan | Main | 保留 |
| UsagePanel | Aside | 移动 |
| ResponsibilityPanel | Aside | 移动 |
| readiness 数字 | Aside | 重组 |
| 底部两列 grid | 删除 | 不保留 |

课程阶段只允许建立最小必要组件，不得先造万能渲染器。

---

## 9. 第二参考实现：班级详情

最终蓝图：

```text
ObjectWorkspace ambient
├── ObjectBar
│   ├── 返回班级列表
│   ├── 班级名称
│   ├── 课程版本 · 主讲 · 学辅
│   ├── 运营状态 / 测试 / 归档
│   ├── 主操作
│   └── overflow
├── ObjectTabs
│   ├── 课次
│   ├── 学生
│   ├── 教学准备
│   └── 运营记录
└── DashboardContentGrid
    ├── Main
    │   └── 当前 Tab
    └── Aside
        ├── 班级摘要
        ├── 下一节课
        ├── 异常 / 风险
        └── 当前职责
```

| 当前 | 新位置 | 处理 |
|---|---|---|
| ContextBar | ObjectTabs | 删除 ContextBar |
| contextSummary 长字符串 | structured context | 重写 |
| anomaly 横幅 | Aside 风险 | 删除横幅 |
| 当前 Tab 面板 | Main | 保留业务组件 |
| Session Drawer | 页面并列 | 保留 |
| ClassroomSettingsSheet | overflow | 保留逻辑 |

不得增加没有现有数据支持的新卡片。

---

## 10. 第三参考实现：课次

最终蓝图：

```text
ObjectWorkspace internal
├── ObjectBar
│   ├── 返回来源 / 班级
│   ├── 讲次名称
│   ├── 班级 · 日期时间 · 时长
│   ├── 状态
│   └── 主操作
├── StageNavigation
│   ├── 课前
│   ├── 课堂
│   └── 课后
└── WorkspaceSplitShell
    ├── MainWorkspace
    │   └── 当前阶段 Panel
    └── WorkspaceRail
        ├── 课次摘要
        ├── 完成状态
        └── 下一步
```

Query 参数 hard cut：

```text
?tab=pre|live|post
→
?stage=pre|live|post
```

不保留兼容。

支持安全：

```text
?returnTo=/dashboard/schedule...
```

默认回班级。

三个业务 Panel 保留，外部骨架重写。

---

## 11. 学生详情整体重建

最终蓝图：

```text
DashboardPage
├── Header
│   ├── 返回学生列表 / 回收站
│   ├── 学生姓名
│   └── 年级 · 状态 · 负责人
├── DashboardCommandPanel
│   ├── ObjectTabs
│   ├── 主操作：记跟进
│   └── overflow：资料、账号、生命周期、合并
└── DashboardPageBody
    └── DashboardContentGrid
        ├── Main
        │   └── 当前 Tab
        └── Aside
            ├── 学生摘要
            ├── 下一次跟进
            ├── 当前班级
            └── 风险 / 账号状态
```

Tabs：

```text
overview
followups
learning
videos
guardians
finance（有权限）
```

| 当前 | 新位置 | 处理 |
|---|---|---|
| StudentProfileEditor | overview | 保留 |
| FollowUpForm + timeline | followups | 移动 |
| 学习数据 | learning | 分 Section |
| session videos | videos | 从 learning 拆出 |
| GuardianInvitePanel | guardians | 从 Aside 移出 |
| GuardianScopePanel | guardians | 从 Aside 移出 |
| StudentFinancePanel | finance | 从长主栏移出 |
| StudentMergePanel | overflow / 危险区 | 不固定占 Aside |
| Provision account | overflow / account | 降级 |
| LifecycleActions | 主操作 + overflow | 拆分 |
| bindCode | Aside | 不塞 Header meta |

强制删除：

- 原连续主栏；
- 原三个操作型 Aside；
- 学习卡混放视频/课评；
- Header meta 完整状态串；
- 多个同级生命周期按钮。

---

## 12. 讲次工作区整体重建

最终蓝图：

```text
ObjectWorkspace internal
├── ObjectBar
│   ├── 返回课程版本 / returnTo
│   ├── 第 N 讲 · 名称
│   ├── 课程版本
│   ├── 未发布修改
│   └── 主操作
├── TrackSwitcher
│   ├── 原生 16:9
│   └── 适配 4:3
├── WorkspaceSplitShell
│   ├── MainWorkspace
│   │   ├── 目标摘要
│   │   └── 权威预览
│   └── WorkspaceRail
│       ├── 流程决策
│       ├── 责任分配
│       └── 使用情况
└── ObjectStatusStrip
```

| 当前 | 新位置 | 处理 |
|---|---|---|
| LectureWorkspaceShell | WorkspaceSplitShell | 删除专用 Shell |
| DecisionRail | WorkspaceRail | 泛化 |
| ContextBar | TrackSwitcher | 删除 |
| objectives 卡 | Main 紧凑摘要 | 保留 |
| preview 卡 | Main 核心 | 扩大 |
| effective owner | Rail | 移动 |
| ResponsibilityPanel | Rail | 移动 |
| Usage | Rail | 移动 |
| StatusStrip | 底部 | 保留/重命名 |

---

## 13. 素材替换工作区整体重建

### 13.1 路由表现

```text
coursewareAssetDetail.shellMode = "panel"
```

删除素材详情外层 `DashboardPage`。

### 13.2 蓝图

```text
ObjectWorkspace internal
├── ObjectBar
│   ├── 返回素材库
│   ├── 素材名称
│   ├── MIME · 尺寸 · revision
│   ├── 当前轨道
│   └── 已选择 N / M
├── TrackSwitcher
└── WorkspaceSplitShell
    ├── MainWorkspace
    │   ├── AssetUsageTree
    │   └── AssetReplacementPreview
    └── WorkspaceRail
        ├── 当前素材
        ├── 上传与备注
        ├── 应用替换
        └── 回滚历史
```

### 13.3 单体拆分

```text
AssetReplacementController.tsx
AssetUsageTree.tsx
AssetReplacementPreview.tsx
AssetReplacementRail.tsx
AssetReplacementHistory.tsx
```

Controller 只管理状态和 actions，不再拥有页面级导航/grid。

强制删除：

- `DashboardPage` 外壳；
- 编辑器内部 `<nav>`；
- 编辑器内部页面级 `xl:grid-cols`；
- 通用“素材详情”标题；
- 自制右栏壳；
- 一个组件同时拥有导航、主区和侧栏。

---

## 14. 最终组件目录

```text
src/features/school/
├── dashboard-page/
│   ├── DashboardPage.tsx
│   ├── DashboardPageChrome.tsx
│   ├── DashboardPageHeader.tsx
│   ├── DashboardPageIdentity.tsx
│   ├── DashboardBackLink.tsx
│   ├── DashboardCommandPanel.tsx
│   ├── DashboardCommandTabs.tsx
│   ├── DashboardContentGrid.tsx
│   └── ...
├── navigation/
│   └── RouteTabs.tsx
└── object-workspace/
    ├── ObjectWorkspace.tsx
    ├── ObjectBar.tsx
    ├── ObjectTabs.tsx
    ├── ObjectContextSwitcher.tsx
    ├── StageNavigation.tsx
    ├── TrackSwitcher.tsx
    ├── WorkspaceSplitShell.tsx
    ├── WorkspaceRail.tsx
    ├── ObjectStatusStrip.tsx
    ├── return-target.ts
    └── index.ts
```

最终删除：

```text
stage/ContextBar.tsx
curriculum/LectureWorkspaceShell.tsx
```

`stage/` 中剩余通用工作区原语迁移后，不得继续并存两套。

---

## 15. 禁止最小改动完成

不得以以下方式宣布完成：

- 只替换 Header；
- 只替换 ObjectBar；
- 只在旧 JSX 外包 ObjectWorkspace；
- 把原整页塞进一个 Tab；
- 保留原卡片顺序，只增加 Aside；
- 保留 ContextBar，再加 ObjectTabs；
- 同时保留新旧返回/状态/操作；
- 只改 gap/padding/width；
- 增加空侧栏；
- 为兼容保留新旧组件；
- 新建第三套页头、Tabs、Rail；
- 创建十几个布尔 props 的万能组件。

每页必须：

```text
重写顶层 JSX
重新分组内容
删除旧骨架
```

---

## 16. 允许复用与必须重组

允许原样复用：

```text
数据查询
Server Actions
权限
capabilities
业务表单
VariantMatrix
TeachingPlan
RosterPanel
SessionGroupList
TeachingReadinessPanel
OperationalRecordsPanel
SessionPrepPanel
SessionLivePanel
SessionPostworkPanel
LectureCoursewarePreview
```

允许内部重构：

```text
StudentLifecycleActions
ResponsibilityPanel
UsagePanel
StatusOverflowMenu
ClassroomSettingsSheet
素材替换状态逻辑
DecisionRailContent
```

必须重建：

```text
顶层 JSX
身份区
返回
操作层级
Tabs / Stage / Track
主栏与侧栏
Rail
滚动
移动端退化
```

---

## 17. 响应式与滚动合同

普通对象页：

```text
Dashboard main 滚动
Aside 不独立滚动
使用 container query
宽屏 8 + 4
窄屏 Aside 下沉
```

Panel：

```text
Dashboard main overflow hidden
ObjectBar 固定
导航固定
MainWorkspace 独立滚动
WorkspaceRail 独立滚动
StatusStrip 固定（可选）
```

新工作区建立：

```text
@container/workspace
```

不得只用 viewport breakpoint 判断固定侧栏后的可用空间。

移动端：

- 返回始终可见；
- ObjectBar 高度受控；
- 主操作可收进 overflow；
- Tabs/Stage 单行横向滚动；
- Rail 抽屉或有限高度下沉；
- 不同时展示两个长滚动区；
- 无横向溢出。

---

## 18. 返回来源合同

新增：

```text
object-workspace/return-target.ts
```

规则：

1. `returnTo` 为站内 Dashboard 路径；
2. 命中 route contract；
3. active environment 可访问；
4. 不允许旧路由；
5. 不允许外部 URL；
6. 无效时回 canonical parent；
7. 不以 history 作为唯一返回。

默认：

| 对象 | 默认返回 |
|---|---|
| student | students |
| class | classes |
| course family | courses |
| variant | family overview |
| session | class detail |
| lecture | course variant |
| asset | courseware-assets |

---

## 19. 施工顺序

### A. 基线审计

- 保存六页三档截图；
- 记录 DOM、滚动容器和现有操作；
- 冻结业务回归测试。

### B. shellMode

- 扩展路由合同；
- Shell 从合同解析；
- 素材进入 panel；
- 删除硬编码 `isPanelWorkspace()`。

### C. 共享底层原语

- DashboardBackLink；
- RouteTabs；
- DashboardCommandTabs 薄封装；
- ObjectTabs；
- ObjectBar 重写；
- ObjectWorkspace container。

### D. 课程参考实现

- Family / Variant 蓝图；
- 删除额外身份卡；
- Usage / Responsibility 移 Aside；
- 截图签收。

### E. 班级参考实现

- 删除 ContextBar；
- ObjectTabs；
- 主侧栏；
- 风险移 Aside；
- 稳定课程页 API。

### F. 两页验证后抽取

- 只抽课程与班级真实重复；
- 删除未使用 slot；
- 禁止万能 props；
- 组件测试。

### G. 课次

- `tab` → `stage`；
- StageNavigation；
- WorkspaceSplitShell；
- WorkspaceRail；
- returnTo；
- 滚动回归。

### H. 学生

- 六 Tabs；
- 内容重组；
- 生命周期主操作/overflow；
- 稳定摘要 Aside；
- 删除旧堆叠。

### I. 讲次

- Shell/Rail 泛化；
- TrackSwitcher；
- Responsibility / Usage 入 Rail；
- 预览成为主区核心。

### J. 素材

- panel；
- 拆单体；
- 使用通用 Shell/Rail；
- 移除内部 nav/grid；
- 上传/应用/回滚回归。

### K. 清理

- 删除 ContextBar；
- 删除 LectureWorkspaceShell；
- 清理 stage imports；
- 清理重复返回；
- 增加 doc23 audit。

---

## 20. 推荐提交顺序

```text
Commit 1  shellMode 与 panel 解析
Commit 2  BackLink / RouteTabs / ObjectBar
Commit 3  课程 Family / Variant
Commit 4  班级详情
Commit 5  稳定并提取课程/班级公共组件
Commit 6  课次与 StageNavigation
Commit 7  学生详情
Commit 8  WorkspaceSplitShell / Rail 与讲次
Commit 9  素材工作区与编辑器拆分
Commit 10 删除旧组件、审计和回归
```

不得在一个提交中重建六页。

---

## 21. 自动审计

新增：

```text
scripts/verify-doc23-object-workspaces.mjs
```

检查：

### 21.1 禁止旧组件

对象页不得引用：

```text
stage/ContextBar
curriculum/LectureWorkspaceShell
```

### 21.2 禁止重复返回

对象页不得直接出现：

```text
ArrowLeft
router.back()
```

唯一允许位置为共享 BackLink。

### 21.3 素材页必须是 panel

素材详情不得引用：

```text
DashboardPage
```

### 21.4 宽度回流

继续执行 doc21 audit，并检查对象工作区：

```text
mx-auto + max-w-*
重复水平 padding
```

### 21.5 shellMode

- panel route 必须存在；
- Shell 不得手写 segments；
- session / lecture / asset 必须 panel。

### 21.6 ContextBar 零引用

```bash
rg 'ContextBar' src/app/[locale]/dashboard src/features/school
```

预期零业务引用。

---

## 22. 截图验收

每页至少：

```text
1440 × 900
1024 × 768
390 × 844
```

讲次和素材额外：

```text
1920 × 1080
```

检查：

- 身份位置；
- 返回可见；
- 状态仅一次；
- 主操作一个；
- Aside/Rail 有真实内容；
- 主区为视觉重点；
- 不再是原卡片纵向列表；
- 无双滚动；
- 无空侧栏；
- 移动端动线完整。

没有截图，不得只以 build 通过宣布完成。

---

## 23. 完工标准

1. 21 的普通页面体系未被平行重造；
2. 22 的 route contract 成为 shellMode 唯一来源；
3. Shell 不再硬编码 panel 路径；
4. BackLink 被两套页头复用；
5. RouteTabs 被命令和对象导航复用；
6. ContextBar 删除；
7. ObjectBar DOM 重写；
8. 移动端返回可见；
9. 课程 Family/Variant 按蓝图重建；
10. 班级按蓝图重建；
11. 课次使用 StageNavigation；
12. 学生完成内容分 Tab，而非整页塞入 Tab；
13. 讲次使用通用 WorkspaceSplitShell；
14. 素材进入 panel；
15. 素材编辑器完成拆分；
16. DecisionRail 壳层泛化为 WorkspaceRail；
17. LectureWorkspaceShell 删除；
18. 每页顶层 JSX 重写；
19. 原有内容顺序已重新分组；
20. 没有第三套页头、Tabs、分栏或 Rail；
21. 普通对象页只有 Dashboard main 滚动；
22. panel 只有主区与 Rail 两个明确滚动区；
23. workspace container query 生效；
24. 三档截图签收；
25. 全功能回归通过；
26. lint、typecheck、build、doc21/22/23 audit 全过。

---

## 24. 最终原则

最终形成：

```text
doc 21 普通页面体系
+
一套对象工作区体系
+
一套共享导航与返回原语
+
各业务域自己的内容组件
```

统一：

```text
对象身份
返回
状态
操作优先级
URL 导航
主侧栏
滚动
响应式动线
```

不统一：

```text
学生、班级、课程、课次、课件、素材的业务内容
```

最终目标：

> 用户进入任何对象页都能立即理解“我在处理什么、下一步做什么、怎样返回”；后续 agent 也只能沿着两套明确页面骨架施工，不能继续保留旧骨架或制造第三套组件。

---

## 25. 施工记录与实际偏差（2026-07-27 完成）

按 §20 的十次提交顺序执行，每次提交独立跑 `lint` / `typecheck` / `build` / `messages:check` / `doc21:audit` / `doc22:audit`，并在真实浏览器上按 §22 的视口截图签收。

### 25.1 与规划一致的部分

§6 shellMode、§7 三种骨架、§8–§13 六页蓝图、§14 组件目录、§18 返回来源合同、§21 审计、§23 完工标准逐条落地。`ContextBar`、`LectureWorkspaceShell`、`DecisionRail`（壳层）、`SharedAssetReplacementEditor`、`StudentLifecycleActions`、`ProvisionStudentAccountButton` 全部删除，零引用由 `pnpm doc23:audit` 守住。

### 25.2 有意偏离规划的决定

1. **素材页的 panel 标记推迟到 Commit 9**，不是随 §19-B 一起翻转。在它自己的工作区重建之前标成 panel，会让中间几个提交里出现一个被 `overflow-hidden` 裁掉且无法滚动的素材页。每个提交都必须是可交付的。

2. **`StatusStrip` 落在 `dashboard-page/` 而不是 §14 设想的 `object-workspace/ObjectStatusStrip`**。规划假设它是工作区专用的，实际上它同时被 4 个普通页面用作 `DashboardPage` 的 `summary` 槽位。改名为 “Object...” 会让那些调用点说谎——它是共享的页面语言，和 `DashboardSummaryCard` 同类。

3. **新增 `WorkspaceMain`**（§14 未列出）。§7.3 要求 panel 有且只有主区与 Rail 两个滚动区。如果由 `ObjectWorkspace internal` 自带 `ScrollArea`，等于宣布 panel 只能有一个滚动区，分栏工作区就得绕过壳层自己搭。把主区的滚动做成一个具名组件，“谁在滚动”在 JSX 上一眼可见——panel 页面最常见的回归就是不知不觉多出第三个滚动容器。

4. **`ObjectBar` 的上下文条目没有 `secondary` 布尔**。规划允许按重要性取舍，实现改为由**数组顺序 + 溢出裁切**表达：越靠后越先消失。加一个开关只是让同一件事有两种说法，还会在 `display:none` 与 `:first-child` 之间制造分隔符错位（§5.2 禁止布尔 props 堆积）。

5. **导航切换条不使用横向滚动**（用户在施工中提出）。§17 原写“Tabs/Stage 单行横向滚动”，实际改为换行。横向滚动条在没有触控板的桌面端等于把后几个标签藏起来——学生页的“监护人”“费用”会消失在看不见的右边，且没有任何滚动提示。代价是课程版本页的 sticky 顶部在 390×844 下达到约 35%（超出 doc21 的四分之一预算）：那一页有一个三维的上下文切换器（年级 × 班型 × 课程季节），全部可见比全部可达更重要。

### 25.3 施工中发现并修掉的真实缺陷

均为改造过程中在真实浏览器上实测发现，不是规划预见的：

1. **390px 下 ObjectBar 标题被压成零宽**。左上菜单安全区 64 + 右上悬浮控件安全区 128 已吃掉一半宽度，再加一个状态徽标和一个主操作按钮，`truncate` 把标题截成 “P…”。改为窄容器下标题独占第一行。
2. **上下文条目等比压缩**。原先每项 `shrink`，溢出时一起被压成“MFH… · 1… · 暑”。改 `shrink-0`，整项被右侧裁掉，靠前的条目保持完整可读。
3. **课次缺省阶段固定落“课前”**。一节已上完的课打开时停在空面板上，而右边 Rail 正写着“下一步：处理课后”。改为缺省阶段跟课次状态走。
4. **课次摘要重复两份**。Rail 补上摘要后，`SessionPrepPanel` 顶部那份成了同屏第二遍（§15 禁止新旧并存），删除；顺带修掉 `<dt>/<dd>` 直接挂在 `<section>` 上的无效嵌套。
5. **学生侧栏与学习 Tab 重复出勤率/星星**。侧栏收敛为**信号**（缺勤次数、待批作业），指标留在学习 Tab。
6. **返回箭头画了两遍**。`backToAssetLibrary` 等文案自带 `←`，而 `DashboardBackLink` 已经渲染图标。清理文案里的箭头，并删掉零引用的 `backToCourses` / `backToLectures`。
7. **课程版本页身份行与上下文切换器重复三维坐标**。年级 / 季节 / 班型在切换器里本就高亮着，身份行只留产品码。

### 25.4 验收证据

- `pnpm lint` / `typecheck` / `build` / `messages:check` / `doc21:audit` / `doc22:audit` / `doc23:audit` / `p4i1:boundary-audit` 全过；`doc23:audit` 已接入 CI。
- 六个对象页 × 三档视口（panel 页额外 1920×1080）真实浏览器截图；结构探针逐页确认：返回入口恰好一个、侧栏导航唯一高亮、无横向溢出、普通页只有 `<main>` 一个滚动区、panel 页 `<main>` 为 `overflow-y: hidden` 且滚动发生在主区与 Rail 内部。
- 剩余人工项：亮 / 暗双主题的逐页视觉签收。
