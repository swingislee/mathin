# Dashboard 视觉与交互收口

> 执行基线：远端 `main`，commit `3539ede7d69ab4f44ba353d62b3cc2fb6aaba36f`  
> 建议仓库路径：`docs/plan/24-dashboard-visual-interaction-closeout.md`  
> 任务性质：Dashboard 全局视觉与交互收尾  
> 后续规划：财务模块业务信息架构、活动模块业务信息架构

---

## 1. 目标

当前 Dashboard 的页面骨架、路由结构、对象工作区和公共组件已经稳定。

本轮集中处理实际使用中仍然可见的问题：

```text
页面之间的视觉密度差异
亮色与暗色主题下的局部表现
移动端遮挡、拥挤和弹层可用性
页面根部的细小横向溢出
主要操作与状态反馈的一致性
多入口对象页的返回动线
```

完成后，Dashboard 应具备以下体验：

- 页面切换时视觉连续；
- 同类组件具有一致的层级和密度；
- 主要操作容易识别；
- 异步操作有清楚反馈；
- 移动端可以完整操作；
- 页面根部保持稳定，无轻微左右晃动；
- 从工作队列进入对象后可以回到原来的工作位置。

---

## 2. 本轮页面范围

优先检查以下代表性页面。

### 普通页面

```text
/dashboard
/dashboard/students
/dashboard/classes
/dashboard/courses
/dashboard/followups
/dashboard/finance
```

### 对象详情与工作区

```text
/dashboard/students/[studentId]
/dashboard/classes/[classId]
/dashboard/courses/[courseFamilyId]
/dashboard/sessions/[sessionId]
/dashboard/courseware/lectures/[lectureId]
/dashboard/courseware-assets/[assetId]
```

### 表单与特殊页面

```text
/dashboard/students/import
/dashboard/classes/new
/dashboard/courses/new
/dashboard/access-control
/dashboard/data-maintenance
```

发现公共组件问题时，同步检查其他使用该组件的页面。

---

## 3. 固定产品决定

### 3.1 Tabs 与上下文切换

以下组件继续使用 `flex-wrap`：

```text
RouteTabs
DashboardCommandTabs
ObjectTabs
StageNavigation
TrackSwitcher
ObjectContextSwitcher
```

选择项在当前宽度放不下时自然换行，所有选项保持可见。

检查重点：

- 换行后的行距；
- 标签高度；
- active 状态；
- 390px 下的点击区域；
- 容器宽度；
- 1–2px 的细小横向溢出。

### 3.2 高级筛选

`FilterBarMore` 继续承担次要筛选条件。

实际测试重点：

- 面板位置；
- 视口边界；
- Select 与 Popover 的层级；
- 键盘弹起后的可操作区域；
- 当前有效筛选数量；
- 重置后的状态。

### 3.3 现有页面架构

本轮沿用：

```text
DashboardShell
DashboardPage
DashboardPageChrome
DashboardCommandPanel
DashboardContentGrid
ObjectWorkspace
WorkspaceSplitShell
WorkspaceRail
dashboard-routes.ts
```

修改集中在公共组件样式、页面组合细节和真实交互缺陷。

---

## 4. 视觉收口

### 4.1 页面整体

逐页检查：

- 页面标题、命令面板和正文左边线；
- 页面顶部与正文之间的间距；
- 主栏与侧栏的顶部对齐；
- 宽屏空间利用；
- 移动端内容顺序；
- sticky 区域与正文的层次；
- 页面切换时的横向稳定性。

### 4.2 卡片与 Section

重点统一：

```text
圆角
边框
背景
标题字号
标题与正文间距
Section 之间的间距
空状态高度
```

同类摘要优先使用：

```text
DashboardSummaryCard
DashboardStatGrid
DashboardAside
```

业务内容继续保留各自的组件和信息结构。

### 4.3 颜色与主题

亮色、暗色分别检查：

- 页面背景；
- 卡片背景；
- 边框；
- sticky chrome；
- active 导航；
- Tabs；
- 输入框；
- Badge；
- 风险、成功和危险状态；
- Rail；
- Dialog 与 Sheet；
- Dashboard 侧栏插图。

重点判断：

- 信息层级是否清楚；
- muted 文字是否易读；
- 边框是否自然；
- 语义色是否一致；
- active 状态是否明确；
- 插图是否影响导航文字。

### 4.4 字体层级

统一检查：

```text
页面标题
对象标题
Section 标题
卡片标题
字段标签
正文
辅助说明
编号与产品码
```

长中文和长英文标题都需要经过测试。

---

## 5. 交互收口

### 5.1 主要操作

每个页面明确一个主要操作。

常见主要操作包括：

```text
新建
保存
记跟进
进入课堂
打开工作台
应用替换
```

其他操作放入次要按钮或更多菜单。

危险操作使用独立分组和确认流程。

### 5.2 异步状态

检查高频操作的完整反馈：

```text
点击
pending
成功
失败
刷新或跳转
```

统一要求：

- pending 期间防止重复提交；
- 按钮或局部区域显示进行中状态；
- 成功后显示 toast、关闭弹层或进入目标页面；
- 失败信息清楚；
- 表单内容在失败后保留；
- 状态切换后页面信息及时刷新。

### 5.3 Dialog、Sheet 与菜单

检查：

- 初始焦点；
- Escape；
- 遮罩点击；
- 关闭后的焦点位置；
- 移动端高度；
- 虚拟键盘；
- 保存按钮可达性；
- DropdownMenu 的操作分组；
- 危险确认流程。

### 5.4 表单

重点检查：

```text
学生导入
班级创建
课程产品创建
学生档案
责任分配
素材替换
```

检查内容：

- label 与输入对应；
- 必填项和辅助说明；
- 字段宽度；
- 错误位置；
- 多步骤进度；
- 移动端操作按钮；
- disabled 和 readonly 的视觉区别。

---

## 6. 返回动线

当前课次、讲次和素材工作区已经支持安全来源返回。

本轮将同一能力扩展到：

```text
学生详情
班级详情
课程产品
课程版本
```

### 6.1 默认返回

| 对象 | 默认返回 |
|---|---|
| 学生 | 学生列表或回收站 |
| 班级 | 班级列表 |
| 课程产品 | 课程产品库 |
| 课程版本 | 课程产品总览 |

### 6.2 优先覆盖的入口

```text
跟进队列 → 学生详情
财务订单 → 学生详情
班级名单 → 学生详情
今日工作 → 班级或课次
课表 → 班级或课次
课程使用情况 → 班级
课件队列 → 课程或讲次
```

入口链接通过：

```ts
withReturnTo(targetHref, currentHref)
```

详情页通过：

```ts
resolveReturnTarget(...)
```

返回地址继续使用 Dashboard 路由合同和当前使用环境进行校验。

对象内部稳定父子关系继续使用默认父页面，例如课程版本返回课程产品总览。

---

## 7. 横向溢出专项检查

### 7.1 页面根部

核心页面在固定视口下检查：

```js
document.documentElement.scrollWidth ===
document.documentElement.clientWidth
```

Dashboard 主画布保持稳定。

### 7.2 合法的内部横向滚动

以下内容可以拥有自己的横向滚动区域：

```text
宽表格
课表
时间轴
课件画布
```

这些容器使用明确的 selector 和边界。

### 7.3 重点排查位置

```text
RouteTabs
ObjectContextSwitcher
DashboardPageChrome
ObjectBar
FilterBarMore
WorkspaceRail
表格容器
课表
TileWorkspace
```

常见来源：

```text
w-fit
min-w-max
shrink-0
负 margin
absolute right
边框与小数像素
100vw
容器 padding 与显式宽度叠加
```

修复优先采用：

```text
min-w-0
max-w-full
flex-wrap
明确的内部滚动容器
合理的 overflow-clip
```

---

## 8. 测试方式

### 8.1 固定视口

重点使用：

```text
390 × 844
1024 × 768
1440 × 900
```

Panel 工作区补充：

```text
1920 × 1080
```

### 8.2 主题

每个代表性页面检查：

```text
light
dark
```

### 8.3 浏览器缩放

检查：

```text
80%
100%
125%
150%
```

重点观察：

- 横向溢出；
- 长标题；
- sticky 区域；
- Tabs 换行；
- 弹层位置；
- 表格宽度。

### 8.4 代表性状态

每类页面至少检查：

```text
有数据
空状态
pending
失败
只读
长标题
危险确认
```

---

## 9. 施工顺序

### 阶段 A：人工巡检

- 固定测试账号和数据；
- 逐页截图；
- 记录实际问题；
- 按公共组件归类。

### 阶段 B：全局视觉

- 侧栏；
- PageHeader；
- ObjectBar；
- Tabs；
- 卡片；
- 输入；
- Badge；
- 页面间距；
- 亮暗主题。

### 阶段 C：普通页面

- 学生；
- 班级；
- 课程；
- 跟进；
- 财务；
- 创建与导入流程。

### 阶段 D：对象与工作区

- 学生详情；
- 班级详情；
- 课程产品与版本；
- 课次；
- 讲次；
- 素材。

### 阶段 E：交互状态

- pending；
- toast；
- 错误；
- Dialog；
- Sheet；
- DropdownMenu；
- 表单。

### 阶段 F：返回动线

- 学生；
- 班级；
- 课程；
- 真实入口传播；
- 安全校验。

### 阶段 G：溢出与最终验收

- 根页面宽度；
- 内部滚动容器；
- 浏览器缩放；
- 亮暗主题；
- 移动端；
- 自动检查。

---

## 10. 自动检查

建议新增：

```text
scripts/verify-doc24-dashboard-closeout.mjs
tests/dashboard-closeout.spec.ts
```

覆盖：

- 核心页面根部横向溢出；
- 普通对象页来源返回；
- 每页唯一主要操作；
- 对象页唯一返回入口；
- Tabs 保持 `flex-wrap`；
- 关键 Dialog 和 Sheet 的打开与关闭；
- 固定视口截图。

CI 继续执行：

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm messages:check
pnpm doc21:audit
pnpm doc22:audit
pnpm doc23:audit
pnpm doc24:audit
```

---

## 11. 完工标准

本轮完成时应满足：

1. 代表性页面在亮色与暗色下视觉统一；
2. 页面切换时左右边界稳定；
3. 同类卡片、Tabs、输入和状态拥有一致视觉；
4. Tabs 与上下文切换使用 `flex-wrap`，所有选项可见；
5. 核心页面根部无细小横向滚动；
6. 合法横向滚动限制在具名内部容器；
7. 主要操作层级清楚；
8. 高频异步操作具有 pending、成功和失败反馈；
9. Dialog、Sheet 和菜单在桌面与移动端可完整操作；
10. 学生、班级和课程支持合理来源返回；
11. 亮色、暗色、390、1024、1440 三档完成签收；
12. 既有检查和 doc24 检查全部通过。

---

## 12. 后续规划

Dashboard 收口完成后，分别建立：

### 财务模块业务信息架构

重点包括：

```text
订单
收款
退款
优惠券
奖学金
账户
报表
家庭账单
```

### 活动模块业务信息架构

重点包括：

```text
活动列表
活动详情
报名
候补
签到
结果
通知
附件
历史
```

---

## 13. 最终目标

本轮完成后，Dashboard 应呈现为一套已经完成产品级收尾的工作台：

```text
页面层级清楚
主要操作稳定
状态反馈明确
移动端完整可用
亮暗主题协调
页面宽度稳定
多入口动线顺畅
```
