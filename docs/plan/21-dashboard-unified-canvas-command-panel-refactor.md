# Dashboard 统一内容坐标系与页面命令面板重构规划

> 状态：**2026-07-27 阶段 A–J 全部完成**，施工记录与实际偏差见文末「§30 施工记录」。  
> 建议仓库路径：`docs/plan/21-dashboard-unified-canvas-command-panel-refactor.md`  
> 适用范围：`src/app/[locale]/dashboard` 下的普通列表页、管理页、表单页和部分详情页  
> 暂不适用：`ObjectWorkspace` 工作区页面、`TileWorkspace` 首页体系  
> 规划性质：架构性 UI 重构、渐进迁移、逐页验收  
> 核心目标：取消普通 Dashboard 页面之间的宽度差异，建立唯一内容坐标系，并统一顶部命令层

---

## 1. 背景与历史原因

Dashboard 当前存在的页面宽度差异，并不是一套经过完整设计验证的页面类型系统，而是多轮布局迭代叠加后的历史结果。

### 1.1 第一版：阅读页面模型

最初页面采用类似内容阅读页的结构：

```text
宽屏浏览器
└── 居中的窄内容容器
    ├── 标题
    ├── 正文
    └── 表单或列表
```

典型实现为：

```tsx
<div className="mx-auto w-full max-w-4xl">
  ...
</div>
```

这一模式适合：

- 长文本阅读；
- 单列表单；
- 内容文章；
- 简单设置页面。

但它不适合包含大量数据、表格、卡片和操作控件的 Dashboard 工作区。

---

### 1.2 第二版：按页面扩大宽度

在测试中发现部分页面过窄，因此逐步给不同页面设置：

```text
max-w-4xl
max-w-5xl
max-w-6xl
max-w-7xl
```

这改善了局部页面的空间利用，但产生了新的问题：

- 页面切换时内容容器重新居中；
- 标题、筛选栏和正文的左右边线不断变化；
- 不同页面之间出现明显横向偏移；
- 宽度值逐渐变成页面级补丁；
- 页面布局无法形成稳定坐标系。

---

### 1.3 第三版：固定左侧导航

后续将左侧导航固定到工作区最左侧，使 Dashboard 更接近应用工作台：

```text
固定左侧导航
+
右侧主工作区
```

这一变化稳定了 Dashboard 的外层空间，但内部仍然保留不同的 `max-w-*`，因此出现：

```text
外层工作区固定
内部内容宽度变化
```

用户切换页面时，左侧导航不动，但标题、筛选、卡片和表格仍然横向跳动。

---

### 1.4 当前版：去除传统行头，改用悬浮控制

最新版进一步取消传统全局行头，将全局入口拆为：

- 左上角 Main 主入口悬浮按钮；
- 右上角全局控制与跳转悬浮按钮。

这样 Dashboard 的外部框架已经高度统一：

```text
左上角 Main 悬浮入口
固定左侧导航
右上角全局控制按钮
中间完整 Dashboard 工作区
```

在这种架构下，继续保留不同页面宽度已经没有明显设计价值，反而会造成：

- 不规则留白；
- 页面切换偏移；
- 顶部安全区难以统一；
- 命令面板左右边界不一致；
- 宽屏利用率不足；
- 人工微调时难以判断真正坐标。

---

## 2. 核心问题重新定义

本次重构不再以“恢复页面宽度语义”为目标。

新的问题定义是：

> Dashboard 已经是一个固定导航包围的应用工作台，但普通页面内部仍然使用传统居中网页的宽度逻辑。

因此需要将 Dashboard 从：

```text
多个宽度不同的网页
```

改造成：

```text
一个固定工作台中的多个功能界面
```

---

## 3. 核心设计原则

### 3.1 所有普通 Dashboard 页面共享唯一内容坐标系

所有普通页面必须共享：

- 相同的左边线；
- 相同的右边线；
- 相同的顶部标题轴；
- 相同的命令面板轴；
- 相同的正文轴；
- 相同的 Shell gutter。

页面切换时，以下边线不得变化：

```text
标题左边线
命令面板左边线
正文左边线

命令面板右边线
正文右边线
```

---

### 3.2 页面根部不再使用不同宽度

普通 Dashboard 页面根部禁止使用：

```text
mx-auto
max-w-3xl
max-w-4xl
max-w-5xl
max-w-6xl
max-w-7xl
```

页面根部统一：

```tsx
className="w-full min-w-0"
```

Dashboard 的唯一宽度由 `DashboardShell` 决定。

---

### 3.3 内容宽度在页面内部解决

取消页面根级限宽，不代表所有内容都无限拉宽。

新的原则是：

> 页面外层保持统一，具体内容块根据内容类型决定内部列宽。

例如：

- 表格使用完整宽度；
- 卡片使用响应式网格；
- 表单使用主列加侧栏；
- 长文本使用局部 `max-w-[72ch]`；
- 详情页使用主次列或标签页；
- 危险操作使用独立区域。

---

### 3.4 页头不再承载业务操作

普通页面页头只负责页面身份：

- 返回；
- 面包屑；
- eyebrow；
- 标题；
- 描述；
- 元信息；
- 左右悬浮控制安全占位。

新建、导入、导出、回收站、批量操作等全部进入页面命令面板。

---

### 3.5 筛选栏升级为页面命令面板

原 `FilterBar` 升级为：

```text
DashboardCommandPanel
```

统一容纳：

- 状态切换；
- 搜索；
- 筛选；
- 页面业务操作；
- 更多操作；
- 批量选择操作。

---

### 3.6 悬浮控制只影响顶部局部区域

右上角全局控制按钮只覆盖顶部区域，不应通过：

```text
lg:pr-24
```

让整个 Dashboard 正文永久缩窄。

全局悬浮按钮的避让改由页头内部透明占位处理。

---

## 4. 目标整体架构

```text
DashboardShell
├── FixedSidebar
├── MainFloatingControl
├── GlobalFloatingControls
└── DashboardCanvas
    └── DashboardPage
        ├── DashboardPageChrome
        │   ├── DashboardPageHeader
        │   │   ├── MainFloatingControlSafeArea
        │   │   ├── DashboardPageIdentity
        │   │   └── GlobalFloatingControlsSafeArea
        │   └── DashboardCommandPanel
        │       ├── DashboardCommandState
        │       ├── DashboardCommandFilters
        │       ├── DashboardCommandActions
        │       └── DashboardCommandSelection
        └── DashboardPageBody
            ├── DashboardPageSummary
            ├── DashboardPageContent
            └── DashboardPageFooter
```

---

## 5. 唯一内容坐标系

建议定义四条稳定边线：

```text
A：Dashboard 主工作区左边线
B：Dashboard 内容左边线
C：Dashboard 内容右边线
D：Dashboard 主工作区右边线
```

由 `DashboardShell` 的水平 padding 形成：

```text
A + Shell gutter = B
D - Shell gutter = C
```

所有普通页面遵守：

```text
标题左边线 = B
命令面板左边线 = B
正文左边线 = B

命令面板右边线 = C
正文右边线 = C
```

页头标题区域的右侧可用范围为：

```text
C - GlobalFloatingControlsSafeArea
```

页面切换时，B 和 C 必须保持不变。

---

## 6. `DashboardShell` 调整

### 6.1 当前问题

当前主内容区包含类似：

```tsx
className="
  flex min-w-0 flex-1 flex-col
  overflow-y-auto
  px-4 pb-5
  md:px-6
  lg:px-8 lg:pb-6 lg:pr-24
  2xl:px-10
"
```

其中：

```text
lg:pr-24
```

是为了避让右上角全局悬浮控制。

这会导致整个页面从顶部到底部右侧都少一块空间，形成不对称正文：

```text
左侧 gutter 较小
右侧 gutter 较大
```

---

### 6.2 目标调整

改为对称 gutter：

```tsx
className="
  flex min-w-0 flex-1 flex-col
  overflow-y-auto
  px-4 pb-5
  md:px-6
  lg:px-8 lg:pb-6
  2xl:px-10
"
```

删除：

```text
lg:pr-24
```

右上角悬浮控件只在 `DashboardPageHeader` 中通过安全占位处理。

---

### 6.3 DashboardCanvas

建议给主内容区增加明确标识：

```tsx
<main
  data-dashboard-content
  data-dashboard-canvas
  className="..."
>
  {children}
</main>
```

其职责包括：

- 唯一水平 gutter；
- 页面滚动；
- Dashboard 普通页统一坐标；
- 工作区页面的外层承载。

---

## 7. 页面组件目录

建议建立：

```text
src/features/school/dashboard-page/
├── DashboardPage.tsx
├── DashboardPageChrome.tsx
├── DashboardPageHeader.tsx
├── DashboardPageIdentity.tsx
├── DashboardPageBody.tsx
├── DashboardPageSection.tsx
├── DashboardPageSummary.tsx
├── DashboardCommandPanel.tsx
├── DashboardCommandState.tsx
├── DashboardCommandFilters.tsx
├── DashboardCommandActions.tsx
├── DashboardCommandSelection.tsx
├── DashboardContentGrid.tsx
├── DashboardMainColumn.tsx
├── DashboardAside.tsx
├── DashboardReadingColumn.tsx
├── DashboardCardGrid.tsx
├── dashboard-page.types.ts
└── index.ts
```

全局悬浮控制建议建立：

```text
src/components/global-floating-controls/
├── GlobalFloatingControls.tsx
├── GlobalFloatingControlsSafeArea.tsx
├── MainFloatingControlSafeArea.tsx
├── useFloatingControlMetrics.ts
├── floating-controls.constants.ts
└── index.ts
```

---

## 8. `DashboardPage` 类型设计

### 8.1 删除页面宽度类型

不再定义：

```ts
DashboardPageWidth
```

不再存在：

```text
narrow
form
detail
list
wide
full
```

这些类型会重新固化历史遗留。

---

### 8.2 保留页面密度

```ts
export type DashboardPageDensity =
  | "compact"
  | "default"
  | "comfortable";
```

密度只控制页面一级纵向间距。

---

### 8.3 页面 Props

```ts
export type DashboardPageBreadcrumb = {
  label: string;
  href?: string;
};

export type DashboardPageProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;

  breadcrumbs?: DashboardPageBreadcrumb[];
  backHref?: string;
  backLabel?: string;

  commandPanel?: ReactNode;
  summary?: ReactNode;
  footer?: ReactNode;

  density?: DashboardPageDensity;

  children: ReactNode;

  className?: string;
  bodyClassName?: string;
  contentClassName?: string;
};
```

最终版本不再保留：

```ts
actions?: ReactNode;
filters?: ReactNode;
status?: ReactNode;
width?: DashboardPageWidth;
```

---

## 9. `DashboardPage` 结构

```tsx
export function DashboardPage({
  title,
  eyebrow,
  description,
  meta,
  breadcrumbs,
  backHref,
  backLabel,
  commandPanel,
  summary,
  footer,
  density = "default",
  children,
  className,
  bodyClassName,
  contentClassName,
}: DashboardPageProps) {
  return (
    <div
      data-dashboard-page
      data-dashboard-page-density={density}
      className={cn("w-full min-w-0", className)}
    >
      <DashboardPageChrome>
        <DashboardPageHeader
          title={title}
          eyebrow={eyebrow}
          description={description}
          meta={meta}
          breadcrumbs={breadcrumbs}
          backHref={backHref}
          backLabel={backLabel}
        />

        {commandPanel}
      </DashboardPageChrome>

      <DashboardPageBody
        density={density}
        className={bodyClassName}
      >
        {summary ? (
          <DashboardPageSection data-dashboard-page-slot="summary">
            {summary}
          </DashboardPageSection>
        ) : null}

        <DashboardPageSection
          data-dashboard-page-slot="content"
          className={contentClassName}
        >
          {children}
        </DashboardPageSection>

        {footer ? (
          <DashboardPageSection data-dashboard-page-slot="footer">
            {footer}
          </DashboardPageSection>
        ) : null}
      </DashboardPageBody>
    </div>
  );
}
```

---

## 10. `DashboardPageBody`

```tsx
const DENSITY_CLASSES: Record<DashboardPageDensity, string> = {
  compact: "gap-3",
  default: "gap-4",
  comfortable: "gap-6",
};

export function DashboardPageBody({
  density,
  className,
  children,
}: {
  density: DashboardPageDensity;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-dashboard-page-body
      data-dashboard-page-density={density}
      className={cn(
        "@container/page flex w-full min-w-0 flex-col",
        DENSITY_CLASSES[density],
        className,
      )}
    >
      {children}
    </div>
  );
}
```

关键点：

- 不使用 `mx-auto`；
- 不使用任何 `max-w-*`；
- 不重复添加水平 padding；
- 使用 `@container/page` 为内部响应式布局提供容器。

---

## 11. 页面页头

### 11.1 页头职责

`DashboardPageHeader` 只负责：

- 页面身份；
- 返回；
- 面包屑；
- 标题；
- 描述；
- 元信息；
- 左右局部安全区；
- sticky 栈中的布局。

不再负责页面业务 actions。

---

### 11.2 页头结构

```tsx
<header data-dashboard-page-header>
  <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start">
    <MainFloatingControlSafeArea />

    <DashboardPageIdentity
      title={title}
      description={description}
      ...
    />

    <GlobalFloatingControlsSafeArea />
  </div>
</header>
```

移动端和桌面端的安全区可以由 CSS 变量自动变化。

---

### 11.3 去除固定安全 padding

逐步删除：

```text
pl-20
pr-32
lg:pr-24
2xl:pr-24
```

由真实透明占位元素参与 Grid/Flex 布局。

---

## 12. 全局悬浮控制安全区

### 12.1 目标

全局悬浮控件变化时，页头安全占位自动同步，不再人工调整。

---

### 12.2 CSS 变量

```css
:root {
  --main-floating-control-safe-inline-size: 64px;
  --global-floating-controls-safe-inline-size: 128px;
  --global-floating-controls-safe-block-size: 56px;
}
```

默认值用于 SSR 首屏和测量前状态。

---

### 12.3 测量逻辑

实际悬浮控件使用 `ResizeObserver` 测量：

- 控件宽度；
- 控件高度；
- 距离视口边缘的偏移；
- 按钮数量变化；
- 身份和权限变化；
- 浏览器缩放；
- 响应式切换。

测量结果写入 CSS 变量。

---

### 12.4 安全占位

```tsx
export function GlobalFloatingControlsSafeArea() {
  return (
    <div
      aria-hidden="true"
      data-global-floating-controls-safe-area
      className="pointer-events-none shrink-0 select-none"
      style={{
        inlineSize:
          "var(--global-floating-controls-safe-inline-size, 128px)",
      }}
    />
  );
}
```

左上角 Main 控件使用相同原理：

```tsx
export function MainFloatingControlSafeArea() {
  return (
    <div
      aria-hidden="true"
      data-main-floating-control-safe-area
      className="pointer-events-none shrink-0 select-none"
      style={{
        inlineSize:
          "var(--main-floating-control-safe-inline-size, 64px)",
      }}
    />
  );
}
```

---

## 13. `DashboardPageChrome`

### 13.1 统一 sticky 栈

推荐：

```tsx
export function DashboardPageChrome({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      data-dashboard-page-chrome
      className="sticky top-0 z-30 w-full min-w-0"
    >
      {children}
    </div>
  );
}
```

页头与命令面板共同 sticky，避免：

- 分别计算 top；
- 层级冲突；
- 滚动缝隙；
- 面板被标题遮挡。

---

### 13.2 高度控制

桌面端：

```text
页头约 64–76px
命令面板约 52–60px
总高度约 116–136px
```

移动端：

- 标题信息简化；
- 描述可隐藏；
- 面板最多两行；
- sticky 总高度不超过视口约四分之一。

---

## 14. `DashboardCommandPanel`

### 14.1 职责

统一管理：

- 状态切换；
- 搜索；
- 筛选；
- 页面操作；
- 更多菜单；
- 批量选择态；
- 响应式布局；
- 面板背景、边框和间距。

不负责：

- URL 查询参数；
- 业务状态；
- 权限；
- 数据请求；
- 弹窗业务；
- 表格选择状态本身。

---

### 14.2 组合 API

```tsx
<DashboardCommandPanel>
  <DashboardCommandState>
    <StudentScopeTabs />
  </DashboardCommandState>

  <DashboardCommandFilters>
    <StudentSearch />
    <GradeFilter />
    <TeacherFilter />
    <MoreFiltersButton />
  </DashboardCommandFilters>

  <DashboardCommandActions>
    <ImportStudentsButton />
    <NewStudentDialog />
  </DashboardCommandActions>
</DashboardCommandPanel>
```

---

### 14.3 桌面布局

```text
┌──────────────────────────────────────────────────────────────┐
│ 状态切换       搜索与筛选                             页面操作 │
└──────────────────────────────────────────────────────────────┘
```

建议：

```tsx
className="
  grid min-h-14 min-w-0
  grid-cols-[auto_minmax(0,1fr)_auto]
  items-center gap-3
"
```

规则：

- 状态区固定；
- 筛选区占剩余空间；
- 操作区右对齐；
- 面板始终占满统一内容轴。

---

### 14.4 平板布局

```text
┌────────────────────────────────────────────┐
│ 状态切换                         页面操作   │
│ 搜索与筛选                                   │
└────────────────────────────────────────────┘
```

---

### 14.5 手机布局

```text
┌────────────────────────────────────┐
│ 状态切换                    主操作 │
│ 搜索框             筛选 3    更多 │
└────────────────────────────────────┘
```

规则：

- 主操作显式；
- 次要操作收入更多；
- 复杂筛选进入 Sheet；
- 有效筛选数量显示；
- 不平铺大量 Select；
- 最多两行。

---

### 14.6 操作优先级

一级主操作，每页最多一个：

- 新建学生；
- 新建班级；
- 创建课程；
- 添加员工；
- 创建活动。

二级辅助操作：

- 导入；
- 导出；
- 下载模板；
- 回收站；
- 批量分配。

三级危险或低频操作：

- 永久删除；
- 清空测试数据；
- 重置；
- 大范围停用。

三级操作必须进入更多菜单或危险区域。

---

### 14.7 批量选择态

```tsx
<DashboardCommandPanel
  selection={
    selectedIds.length > 0 ? (
      <DashboardCommandSelection>
        <span>已选择 {selectedIds.length} 项</span>
        <BulkActionA />
        <BulkActionB />
        <ClearSelection />
      </DashboardCommandSelection>
    ) : null
  }
>
  ...
</DashboardCommandPanel>
```

选择态可以完全替换默认命令面板，减少顶部控件拥挤。

---

## 15. 状态控件语义

### 15.1 二元开关

使用 `Switch`：

- 包含已归档；
- 只看异常；
- 显示已停用。

### 15.2 多状态互斥

使用 Tabs、ToggleGroup 或分段控件：

- 全部 / 待处理 / 已完成；
- 当前 / 历史 / 回收站；
- 有效 / 停用 / 全部。

### 15.3 只读摘要

继续使用 `StatusStrip` 或 summary：

- 今日 12；
- 待处理 7；
- 逾期 3。

只读状态不能伪装成筛选按钮。

---

## 16. 内部内容布局组件

取消页面根级宽度后，需要建立内部布局语义。

### 16.1 `DashboardContentGrid`

建议默认使用 12 列容器网格：

```tsx
export function DashboardContentGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-12 gap-4 @4xl/page:gap-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
```

---

### 16.2 `DashboardMainColumn`

```tsx
<div className="col-span-12 min-w-0 @4xl/page:col-span-8">
  ...
</div>
```

---

### 16.3 `DashboardAside`

```tsx
<aside className="col-span-12 min-w-0 @4xl/page:col-span-4">
  ...
</aside>
```

---

### 16.4 `DashboardReadingColumn`

```tsx
<article className="max-w-[72ch]">
  ...
</article>
```

仅限制文字块本身，不限制页面。

---

### 16.5 `DashboardCardGrid`

根据页面容器宽度响应：

```tsx
<div
  className="
    grid grid-cols-1 gap-4
    @3xl/page:grid-cols-2
    @6xl/page:grid-cols-3
  "
>
```

---

## 17. 页面类型的内部适配策略

### 17.1 表格与列表页

适用：

- 学生；
- 班级；
- 课程；
- 员工；
- 运营；
- 报名；
- 共享资源。

策略：

```text
页面根全宽
命令面板全宽
表格全宽
必要时表格内部横向滚动
```

不再为了阅读舒适度限制表格。

---

### 17.2 卡片集合页

策略：

- 使用容器查询网格；
- 页面变宽时增加列数；
- 不通过收窄页面维持固定两列；
- 卡片自身设置合理最小宽度。

---

### 17.3 表单页

表单不能全宽拉伸。

推荐：

```text
主表单 8 列
说明或摘要侧栏 4 列
```

示例：

```tsx
<DashboardContentGrid>
  <DashboardMainColumn>
    <NewClassWizard />
  </DashboardMainColumn>

  <DashboardAside>
    <ClassCreationGuide />
    <DraftStatus />
  </DashboardAside>
</DashboardContentGrid>
```

如果没有侧栏内容：

```tsx
<div className="grid grid-cols-12 gap-6">
  <div className="col-span-12 @4xl/page:col-span-8">
    <Form />
  </div>
</div>
```

主表单从统一左边线开始，不重新居中。

---

### 17.4 阅读内容

使用局部阅读列：

```tsx
<DashboardContentGrid>
  <div className="col-span-12 @4xl/page:col-span-8">
    <DashboardReadingColumn>
      ...
    </DashboardReadingColumn>
  </div>

  <DashboardAside>
    ...
  </DashboardAside>
</DashboardContentGrid>
```

---

### 17.5 详情页

第一阶段：

```text
主内容 8 列
摘要侧栏 4 列
```

第二阶段：

```text
顶部概要
+
Context Tabs
+
主内容 / 侧栏
```

不再保留超长窄单列详情页。

---

### 17.6 危险操作页

例如测试数据页：

```text
顶部说明与警告
+
两列普通操作卡片
+
独立危险操作区域
```

危险操作不与普通操作混排。

---

## 18. 容器查询

固定侧栏应用中：

```text
浏览器宽度 ≠ 页面可用宽度
```

因此内部响应式布局应优先使用容器查询。

页面正文：

```tsx
<div className="@container/page w-full min-w-0">
```

内部组件：

```tsx
<div
  className="
    grid grid-cols-1
    @3xl/page:grid-cols-2
    @6xl/page:grid-cols-3
  "
>
```

需要根据项目当前 Tailwind 版本确认容器查询支持方式。

如果暂时无法使用容器查询，可先保留视口断点，但新组件 API 不应绑定具体视口语义，以便后续平滑迁移。

---

## 19. 现有通用组件调整

### 19.1 `SchoolPageHeader`

最终调整：

- 重命名或别名为 `DashboardPageHeader`；
- 删除 `actions`；
- 删除固定右侧 padding；
- 接入左右安全占位；
- 保留 title、description、meta、breadcrumbs、back。

---

### 19.2 `FilterBar`

处理方向：

- 不再作为页面一级布局组件；
- 删除默认 `mt-4`；
- 将内部输入控件迁入 `DashboardCommandFilters`；
- 最终降级为控件集合或废弃。

---

### 19.3 `ContextBar`

处理方向：

- 删除默认 `mt-3`；
- 普通页面的状态切换迁入 `DashboardCommandState`；
- ObjectWorkspace 继续保留；
- 暂不强行合并两套工作区。

---

### 19.4 `StatusStrip`

处理方向：

- 保持纯内容组件；
- 删除调用方页面级 `mt-*`；
- 只读数据进入 summary；
- 可交互状态进入命令面板；
- Separator 换行问题另立修复项。

---

## 20. 页面使用范例

### 20.1 学生列表

```tsx
return (
  <DashboardPage
    title={filters.recycle ? t("recycleBin") : t("title")}
    commandPanel={
      <DashboardCommandPanel>
        <DashboardCommandState>
          <StudentScopeTabs />
        </DashboardCommandState>

        <DashboardCommandFilters>
          <StudentSearch />
          <GradeFilter />
          <TeacherFilter />
          <MoreFilters />
        </DashboardCommandFilters>

        <DashboardCommandActions>
          {canImport ? <ImportStudentsButton /> : null}
          {canCreate ? <NewStudentDialog /> : null}
        </DashboardCommandActions>
      </DashboardCommandPanel>
    }
    summary={
      statusItems.length > 0 ? (
        <StatusStrip items={statusItems} />
      ) : null
    }
    footer={<StudentPagination />}
  >
    <StudentTable />
  </DashboardPage>
);
```

---

### 20.2 新建班级

```tsx
return (
  <DashboardPage
    title={t("newClass")}
    backHref="/dashboard/classes"
    backLabel={t("backToClasses")}
    breadcrumbs={[
      {
        label: t("classes"),
        href: "/dashboard/classes",
      },
      {
        label: t("newClass"),
      },
    ]}
    commandPanel={
      <DashboardCommandPanel mode="form">
        <DashboardCommandActions>
          <CancelButton />
          <SaveDraftButton />
          <SubmitButton />
        </DashboardCommandActions>
      </DashboardCommandPanel>
    }
  >
    <DashboardContentGrid>
      <DashboardMainColumn>
        <NewClassWizard />
      </DashboardMainColumn>

      <DashboardAside>
        <ClassCreationGuide />
      </DashboardAside>
    </DashboardContentGrid>
  </DashboardPage>
);
```

---

### 20.3 学生详情

```tsx
return (
  <DashboardPage
    title={student.name}
    backHref="/dashboard/students"
    commandPanel={
      <DashboardCommandPanel>
        <DashboardCommandState>
          <StudentDetailTabs />
        </DashboardCommandState>

        <DashboardCommandActions>
          <EditStudentButton />
          <StudentMoreMenu />
        </DashboardCommandActions>
      </DashboardCommandPanel>
    }
  >
    <DashboardContentGrid>
      <DashboardMainColumn>
        <StudentDetailContent />
      </DashboardMainColumn>

      <DashboardAside>
        <StudentSummary />
        <StudentQuickActions />
      </DashboardAside>
    </DashboardContentGrid>
  </DashboardPage>
);
```

---

## 21. 页面迁移范围

### 21.1 第一批：标准列表页

```text
src/app/[locale]/dashboard/students/page.tsx
src/app/[locale]/dashboard/classes/page.tsx
src/app/[locale]/dashboard/courses/page.tsx
src/app/[locale]/dashboard/staff/page.tsx
src/app/[locale]/dashboard/registration/page.tsx
src/app/[locale]/dashboard/operations/page.tsx
```

目标：

- 统一左右边线；
- 页头 actions 下移；
- 移除根 `max-w-*`；
- 建立标准命令面板；
- 验证表格全宽布局。

---

### 21.2 第二批：复杂管理页

```text
src/app/[locale]/dashboard/followups/page.tsx
src/app/[locale]/dashboard/courseware/page.tsx
src/app/[locale]/dashboard/shared-assets/page.tsx
src/app/[locale]/dashboard/adapt-review/page.tsx
src/app/[locale]/dashboard/finance/page.tsx
src/app/[locale]/dashboard/activities/page.tsx
```

目标：

- 合并筛选布局；
- 处理多状态切换；
- 处理复杂 actions；
- 处理摘要区；
- 改造宽屏单列遗留。

---

### 21.3 第三批：表单与详情页

```text
src/app/[locale]/dashboard/classes/new/page.tsx
src/app/[locale]/dashboard/students/import/page.tsx
src/app/[locale]/dashboard/students/[id]/page.tsx
src/app/[locale]/dashboard/children/page.tsx
src/app/[locale]/dashboard/shared-assets/[assetId]/page.tsx
src/app/[locale]/dashboard/operations/testdata/page.tsx
src/app/[locale]/dashboard/staff/roles/page.tsx
```

目标：

- 统一页面坐标；
- 使用内部网格；
- 处理单列遗留；
- 为详情页标签化预留结构。

---

### 21.4 暂不迁移

保留 `ObjectWorkspace`：

```text
src/app/[locale]/dashboard/classes/[id]/page.tsx
src/app/[locale]/dashboard/courses/[id]/page.tsx
src/app/[locale]/dashboard/curriculum/lectures/[lectureId]/page.tsx
src/app/[locale]/dashboard/sessions/[sessionId]/page.tsx
src/app/[locale]/dashboard/schedule/page.tsx
```

保留首页体系：

```text
TodayWorkHome
ParentHome
StudentHome
TileWorkspace
```

---

## 22. 宽屏单列遗留适配优先级

### 22.1 财务页

当前问题：

- 多个业务模块纵向堆叠；
- 全宽后会显得稀疏；
- 模块间关系不清晰。

建议：

```text
订单 / 退款
优惠券 / 奖学金
账户查询 / 状态摘要
```

使用两列或主次列布局。

---

### 22.2 学生详情页

当前问题：

- 页面过长；
- 信息密度不均；
- 单列在宽屏中浪费空间。

第一阶段：

```text
主内容 8 列
摘要侧栏 4 列
```

第二阶段引入 Tabs。

---

### 22.3 孩子详情页

建议重新组织：

- 孩子选择；
- 摘要；
- 出勤；
- 课程；
- 作业；
- 评价。

采用顶部概要加主次列。

---

### 22.4 测试数据页

建议：

```text
说明与警告
+
两列普通操作卡片
+
独立危险操作区
```

---

### 22.5 新建与导入页

采用：

```text
主表单
+
帮助 / 模板 / 状态侧栏
```

不允许通过重新居中解决表单过宽。

---

## 23. 施工阶段

### 阶段 A：建立统一坐标基线

完成：

1. 明确 `DashboardShell` 是唯一水平边界；
2. 删除整页 `lg:pr-24`；
3. 确认 Shell 左右 gutter 对称；
4. 增加 `data-dashboard-canvas`；
5. 建立固定视口截图基线。

此阶段不迁移页面。

---

### 阶段 B：建立悬浮控制安全区

完成：

- 左上 Main 控件尺寸测量；
- 右上全局控件尺寸测量；
- CSS 变量；
- 两个透明占位组件；
- 页头测试组件。

验收：

- 控件数量变化时占位自动更新；
- 缩放与断点变化正常；
- 页头不被覆盖；
- 正文不再为悬浮按钮永久留白。

---

### 阶段 C：建立统一页面骨架

完成：

```text
DashboardPage
DashboardPageChrome
DashboardPageHeader
DashboardPageBody
DashboardPageSection
DashboardPageSummary
```

硬性要求：

- 无 `width` prop；
- 无 `max-w-*`；
- 无 `mx-auto`；
- 页面正文为容器查询根。

---

### 阶段 D：建立命令面板

完成：

```text
DashboardCommandPanel
DashboardCommandState
DashboardCommandFilters
DashboardCommandActions
DashboardCommandSelection
```

建立：

- 桌面布局；
- 平板布局；
- 手机布局；
- 更多菜单；
- 筛选 Sheet；
- 批量选择态。

---

### 阶段 E：迁移学生列表样板页

只迁移：

```text
/dashboard/students
```

必须完成：

- 页头 actions 下移；
- 当前 / 回收站进入状态区；
- 搜索筛选进入 filters；
- 导入和新建进入 actions；
- 状态摘要进入 summary；
- 分页进入 footer；
- 根部删除 `mx-auto max-w-*`；
- 页面切换前后左右边线稳定。

该页面作为后续普通页标准样板。

---

### 阶段 F：迁移第一批列表页

逐页迁移，不同时修改：

- 数据查询；
- 表格字段；
- 权限；
- 文案；
- 数据结构。

每页迁移后独立回归。

---

### 阶段 G：迁移复杂管理页

重点处理：

- 多筛选折叠；
- 状态切换；
- 更多操作；
- 宽屏网格；
- 卡片列数；
- 摘要区。

---

### 阶段 H：迁移表单与详情页

先统一页面外层坐标，再进行内部宽屏适配。

顺序：

1. 删除页面根限宽；
2. 接入 DashboardPage；
3. 接入命令面板；
4. 使用内部 12 列网格；
5. 处理侧栏；
6. 再考虑 Tabs。

---

### 阶段 I：删除旧规则

完成所有普通页迁移后：

1. 删除全局规则：

```css
[data-dashboard-content] > .mx-auto {
  max-width: none;
  margin-inline: 0;
}
```

2. 删除页头 `actions`；
3. 删除页头固定安全 padding；
4. 删除 `FilterBar` 默认 `mt-4`；
5. 删除 `ContextBar` 默认 `mt-3`；
6. 清理页面一级 `mt-*`；
7. 清理普通页根 `mx-auto max-w-*`；
8. 清理兼容别名和废弃接口。

---

### 阶段 J：防止回退

CI 或 lint 检查：

```bash
rg 'mx-auto.*max-w-|max-w-.*mx-auto' 'src/app/[locale]/dashboard'
```

普通页根部不应出现匹配。

```bash
rg 'SchoolPageHeader' 'src/app/[locale]/dashboard'
```

普通页面不应直接调用旧页头。

可增加 ESLint 规则，禁止普通 Dashboard page 文件出现：

```text
max-w-
mx-auto
SchoolPageHeader
```

---

## 24. 可能影响

### 24.1 页面会明显变宽

这是预期结果。

表格、卡片和命令面板会更充分利用 Dashboard 工作区。

---

### 24.2 单列页面会暴露遗留问题

财务、详情、表单和测试数据页可能在统一宽度后显得空旷。

这不是统一宽度方案的问题，而是旧页面内部仍按窄容器设计。

应通过内部网格解决，而不是恢复页面限宽。

---

### 24.3 sticky 区域会变高

页头和命令面板共同 sticky 后需要限制高度。

---

### 24.4 动态安全区可能出现首屏轻微变化

使用合理 SSR 默认值，并保持控件尺寸稳定。

---

### 24.5 容器查询需要确认工具链

需要验证：

- Tailwind 版本；
- container query 插件或原生支持；
- 自定义断点命名；
- 构建输出。

如果当前无法立即启用，先用普通 Grid 和视口断点，但保留容器组件结构。

---

## 25. 测试方案

### 25.1 静态检查

```bash
pnpm typecheck
pnpm lint
pnpm build
```

---

### 25.2 固定视口

| 视口 | 验证重点 |
|---|---|
| 390×844 | 安全区、主操作、筛选 Sheet、无横向溢出 |
| 768×1024 | 两行命令面板、内部网格折叠 |
| 1024×768 | 固定导航后的真实可用宽度 |
| 1280×800 | 页面左右边线一致 |
| 1440×900 | 宽屏网格和命令面板 |
| 1920×1080 | 页面不居中收窄、无异常留白 |

---

### 25.3 页面切换稳定性

重点连续切换：

```text
学生
班级
课程
跟进
课件
共享资源
财务
员工
运营
```

验证：

- 标题左边线不动；
- 命令面板左边线不动；
- 操作按钮右边线不动；
- 正文左右边界不动；
- 页面不发生重新居中的横向跳动。

---

### 25.4 悬浮控件安全区

测试：

1. 隐藏右上一个按钮；
2. 增加一个按钮；
3. 改变按钮尺寸；
4. 切换身份；
5. 浏览器缩放 80%、125%、150%；
6. 长中文标题；
7. 长英文标题；
8. 平板和移动端断点。

预期：

- 标题不进入悬浮控件下方；
- 正文宽度不受影响；
- 无需修改 `pr-*`。

---

### 25.5 工作区回归

必须检查：

```text
/dashboard/schedule
/dashboard/classes/[id]
/dashboard/courses/[id]
/dashboard/curriculum/lectures/[lectureId]
/dashboard/sessions/[sessionId]
```

验证：

- 无双滚动；
- ObjectBar 正常；
- ContextBar 正常；
- 右侧决策栏正常；
- 课表横向滚动正常；
- 未被普通页面规则影响。

---

## 26. 完工标准

必须同时满足：

1. DashboardShell 成为唯一水平边界；
2. 普通页面根部全部全宽；
3. 删除普通页面级 `max-w-*`；
4. 删除普通页面级 `mx-auto`；
5. 页面切换时左右边线不变化；
6. 删除整页右侧悬浮控件安全 padding；
7. 建立左右悬浮控件动态安全占位；
8. 页头不再承载业务 actions；
9. 所有页面操作进入 `DashboardCommandPanel`；
10. 状态、筛选和 actions 形成清晰区域；
11. 所有普通页迁移到 `DashboardPage`；
12. 表单和阅读内容通过内部布局限宽；
13. 表格和卡片充分利用宽屏；
14. 单列遗留页面完成必要宽屏适配；
15. 普通页面正文成为容器查询根；
16. ObjectWorkspace 和 TileWorkspace 未被错误迁移；
17. 固定视口测试通过；
18. 页面切换稳定性测试通过；
19. 悬浮控件安全区测试通过；
20. `typecheck`、`lint`、`build` 全部通过。

---

## 27. 实施原则

- 一次只迁移一个页面；
- 先统一坐标，再改善内部布局；
- 不因单列页面暂未适配而恢复页面根限宽；
- 不同时修改业务数据和 UI 架构；
- 不在迁移过程中顺手重写业务逻辑；
- 学生列表作为标准样板；
- 先普通页，后 ObjectWorkspace；
- 页面出现横向跳动、双滚动或悬浮遮挡时，不进入下一批；
- 兼容接口只允许临时存在；
- 最终必须删除旧布局规则。

---

## 28. 推荐施工顺序摘要

```text
1. 确立 Dashboard 唯一内容坐标系
2. 删除 DashboardShell 整页右侧额外 padding
3. 建立左右悬浮控制动态安全占位
4. 建立无宽度参数的 DashboardPage
5. 建立 DashboardCommandPanel
6. 迁移学生列表样板页
7. 迁移第一批标准列表页
8. 迁移复杂管理页
9. 迁移表单与详情页
10. 针对单列遗留完成内部宽屏适配
11. 引入或完善容器查询
12. 删除旧 max-width 覆盖、旧 actions 和旧外边距
13. 完整响应式与工作区回归
14. 建立 lint / CI 防回退约束
```

---

## 29. 最终架构判断

本规划采用的最终模型不是：

```text
每个页面决定自己有多宽
```

也不是：

```text
DashboardPage 根据页面类型决定宽度
```

而是：

```text
DashboardShell 决定所有页面的唯一宽度
页面内部组件决定如何使用这段宽度
```

这与当前固定导航、左右悬浮控制和统一 Dashboard 工作区的整体方向一致，也是消除页面切换偏移、异常留白和布局错位的根本方案。

---

## 30. 施工记录（2026-07-27 完成）

### 30.1 实际落地

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| A + B | `b4f10c2` | `--dashboard-gutter` 成为唯一水平边界来源；删除整页 `lg:pr-24`；`components/global-floating-controls/` 用 ResizeObserver 把控件到视口边缘的真实距离写进 CSS 变量，透明占位读回来 |
| C + D | `0ceecfb` | `features/school/dashboard-page/`：页面骨架六件套 + 命令面板五件套 + 12 列内部网格原语 |
| E | `156c94c` | 学生列表样板页 |
| F | `60883b3` | classes / courses / staff / registration / operations / activities / videos / assignments |
| G | `ea19e14` | followups / courseware / shared-assets / adapt-review / finance |
| H | `7769716` | classes/new、students/import、students/[id]、children、shared-assets/[assetId]、operations/testdata、staff/roles |
| I + J | 本次 | 删除旧规则、退休 `SchoolPageHeader`、防回退门禁、回归 |

### 30.2 实施中被验证推翻的三个写法

这三条都是先按规划写完、再用 Playwright 量出来才发现的，值得留档：

1. **`DashboardPageChrome` 不能带 `w-full`。** 显式 `width:100%` 把宽度锁在父级内容盒上，负外边距只把整块往左推，右边线反而少一个 gutter。必须让它作为普通块级元素由外边距撑开。
2. **命令面板不能用 flex + order 排版。** 窄容器下需要「状态与主操作同一行、筛选独占第二行」是**硬要求**，靠 `flex-wrap` 只是碰运气——状态标签或操作按钮一长就各自另起一行，移动端 sticky 顶部直接吃掉小半个视口。改为显式行列定位（`grid-cols-[minmax(0,1fr)_auto]` → `@3xl/chrome` 三列）。
3. **`DashboardContentGrid` 必须 `items-start`。** grid 默认 stretch 会把主列拉到与侧栏等高，财务页那张只有一行订单的卡片被抻成一整屏空框，比迁移前更空。

另外：表格铺满统一内容轴后必须自带 `min-w-*`，否则手机上列会被挤成竖排单字，而不是按 §17.1 横向滚动。

### 30.3 与规划的偏差

1. **§14.5 的「移动端复杂筛选进入 Sheet」未实现。** 现有筛选是带 Radix `Select` 的 GET 表单，塞进 Sheet 要么复制 DOM（GET 提交会带上重复字段），要么让表单在 Sheet 关闭时卸载。改为：搜索框常驻 + 次要条件全部收进已有的 `FilterBarMore`（`<details>` 面板，留在 form DOM 子树内）并显示生效条件数。命令面板在 390px 下实测 2 行（有生效筛选时 3 行），仍在 §13.2 的高度预算内。该做法满足 §14.5 的「不平铺大量 Select / 显示有效筛选数量」，Sheet 形态本身不在 §26 完工标准内，留作后续项。
2. **§21.4「TileWorkspace 暂不迁移」按「只迁页头、不动磁贴」执行。** 磁贴网格、编辑态、拖拽与持久化完全未动；只是把「编辑布局 / 重置 / 完成」从页头 actions 移进命令面板，页头换成 `DashboardPage`。否则 `SchoolPageHeader` 会因为唯一一个调用方永久活着，§23-I.2「删除页头 actions」无法收口。
3. **`ObjectBar` 与 `DecisionRail` 一并接入了安全占位。** 它们不在页面迁移范围内，但删掉整页 `lg:pr-24` 之后，决策栏标题会被右上悬浮控件压住（讲次工作区实测），所以必须同步处理。`ObjectBar` 增加 `floatingSafeArea` 开关：右侧另有决策栏时置 `false`，避免两处重复让位白丢一截宽度。

### 30.4 验收结果

- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm messages:check` 全通过。
- **§25.3 页面切换稳定性**：学生/班级/课程/跟进/课件/共享资源/财务/员工/运营 9 页 × 6 视口（1920/1440/1280/1024/390），`chrome`、`panel`、`body`、`content` 四条轴的左右边线在同一视口内完全一致，无横向溢出。
- **§25.4 悬浮控件安全区**：移除一个控件 → 安全区 104px→52px；再加两个 → 156px；超长中文/英文标题下标题右边线始终位于控件左边线之前；正文宽度四种情况全程不变。
- **§25.5 工作区回归**：`/dashboard`、`/dashboard/schedule`、`/dashboard/classes/[id]`、`/dashboard/curriculum/lectures/[id]`、`/dashboard/sessions/[id]` 无双滚动、无横向溢出，ObjectBar / ContextBar / 决策栏 / 课表横向滚动均正常。
- **§23 阶段 J 防回退**：`pnpm doc21:audit`（`scripts/verify-doc21-coordinates.mjs`）检查页面根重新居中、`SchoolPageHeader` 复活、Shell 整页右侧 padding 回流、全局 `.mx-auto` 兜底规则回流、骨架自身引入限宽；另有一条 ESLint `no-restricted-syntax` 禁止 dashboard 路由下 `className` 出现 `mx-auto`。两道门禁都做过反向验证（人为加回 `mx-auto max-w-6xl` 时确实报错）。

### 30.5 待人工签收

固定视口截图已产出但未经用户逐页签收；§25.2 的亮/暗两档视觉验收仍需用户确认。
