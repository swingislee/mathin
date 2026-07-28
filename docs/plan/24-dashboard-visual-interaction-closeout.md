# Dashboard 视觉与交互收口

> **规划状态**：`complete`
>
> **当前用途**：UI-L4 视觉与交互工程收口记录。
>
> **权威边界**：工程任务完成不等于生产 M4；不得重开整轮 UI 改造。
>
> **剩余项**：人工视觉签收、warning token、残余业务卡和正式 E2E 在 doc 25 R1-12/14 关闭。
>
> **最后核对**：2026-07-28。

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

## 13. 施工记录与实际偏差（2026-07-28 完成）

执行方式先做了一件计划里没写的事：**阶段 A 用脚本做，不用眼睛做**。逐页截图能发现颜色和间距问题，但发现不了 1–2px 的溢出，也发现不了"这个元素其实被裁掉了"。所以阶段 A 是 Playwright + 固定测试账号跑 26 个页面 × 4 档视口，逐元素量 `getBoundingClientRect`，按证据列问题清单，再按公共组件归类。后面每一步改完都重跑同一个脚本。

### 13.1 §7 横向溢出：根节点检查不够

计划 §7.1 给的判据是 `documentElement.scrollWidth === clientWidth`。**这条判据全程是绿的，但页面确实在横向滚动。**

原因是 `main[data-dashboard-canvas]` 写的是 `overflow-y-auto`，而 CSS 规定：`overflow-x` 与 `overflow-y` 只要有一个不是 `visible`，另一个的 `visible` 就会被计算成 `auto`。于是主画布自己成了滚动容器，溢出被它吃掉，根节点永远看不到。

所以实际判据改成**两条都要**：根节点不溢出，且 `[data-dashboard-canvas]` 的 `scrollWidth === clientWidth`。三个真实来源：

| 来源 | 位置 | 机制 |
|---|---|---|
| `flex-1` + `min-w-56` | `AdaptReviewFilters` | `flex-1` 的 basis 是 0，而 flex 换行判据看的正是 basis——两个 Select 永不换行，再被 min-width 撑出 50px |
| 槽位不换行 | `DashboardCommandFilters` / `DashboardCommandState` | 筛选控件各自的 `min-w-*` 只能往外顶 |
| `w-fit` 缺 `max-w-full` | `RouteTabs` | 祖先没传下可用宽度时按 max-content 铺开 |

第一条现在是审计里的一条静态规则：同一个 class 串里 `flex-1`/`flex-auto` 不得与正数 `min-w-*` 并存（`min-w-0`/`min-w-full` 是解法，不算）。全仓扫出四处，全部改成 `basis-*`。

### 13.2 §3.1 Tabs：三处用 `overflow-x-auto` 把产品决定反过来说

计划已经把"换行、所有选项可见"定为固定决定，但代码里有三处 `overflow-x-auto`（跟进队列的时间桶、课件审阅的 Tabs、孩子切换）。桌面端没有滚动提示，等于把后几个选项藏起来——跟进页 390px 下七个时间桶后四个完全在视野外，而这一页的用户就是靠"逾期几条"决定今天先打哪通电话。三处全部改回换行，并把 `flex-wrap` 落到 `DashboardCommandState`/`DashboardCommandFilters` 两个槽位本身，让下一个页面不必再各自决定。

`ObjectBar` 的上下文行是同一类问题的另一半：它在两档视口下都 `overflow-hidden`，班级详情的"主讲/学辅"、课次详情的后三项在手机上**不可见且没有任何提示**。改成窄容器换行、宽容器仍单行裁切，分隔符只在单行档出现（否则每个折到行首的条目前会挂一个像项目符号的"·"）。

### 13.3 §3.2 高级筛选：两个坐标系不一致

`FilterBarMore` 的面板 `absolute right-0` 以按钮为参照，宽度却写成 `min(32rem, 100vw-2rem)` 按视口算。390px 下按钮已经贴到右边线，面板左边缘落到视口外 −54px，左侧的 label 与第一列控件直接不可见。改为以筛选条为定位参照 + `min(32rem, 100%)`，两个坐标系统一。实测 390/1024/1440 × 四个列表页展开后面板均落在画布内（390 下 16..374）。

### 13.4 §4.2 卡片：先统一外观，再抽原语

同一角色的区块卡当时有五种写法（`rounded-xl p-5`、`rounded-2xl p-4`、`rounded-2xl p-5`、裸 `border`、`border border-line`），标题在 `font-medium` / `font-medium text-ink` / `text-sm font-medium text-ink` 之间摇摆，空状态是一行 60px 的 `<p>` 去替换半屏高的表格——"筛掉最后一条"在视觉上等于整页塌陷。

新增三个原语（`DashboardCard` / `DashboardCardShell` / `DashboardEmptyCard`），按设计系统 §1 统一到 `rounded-2xl`，卡片标题收敛为两档且**只有两档**：正文区块 `text-base`、侧栏摘要 `text-sm`（`DashboardSummaryCard`）。审计钉住这两档，也钉住"dashboard 页面文件不得再手搓卡片外壳"——`loading.tsx` 除外，它整份就是占位骨架，职责恰恰是模仿真实卡片的形状。

顺带修掉课件审阅五个队列的页级 `mt-6`：`DashboardPageBody` 已经给了 `pt-5`，叠起来让这一页比别的页多出 24px 顶部留白，正是"页面之间的视觉密度差异"的一个具体来源。

### 13.5 §6 返回动线：真正的缺口在对象**内部**

计划要求把来源返回扩展到学生/班级/课程。实施时发现更隐蔽的一条：**对象内部导航会把来源弄丢**。课次的 stage 链接、讲次的换轨与翻页链接都是从 `baseHref` 重新拼的，从课表进课次、切一次"课后"，`returnTo` 就没了。

所以 `return-target.ts` 拆成两个函数：`parseReturnTo` 只回答"这个来源合不合法"（不合法返回 `null`），`resolveReturnTarget` 在它上面套兜底。分开是必要的——只有前者能区分"用户确实从课表来"和"这是兜底值"，合在一起就会把 canonical 父页面当成来源钉进 URL，之后每切一次 Tab 都在地址上滚一层假 `returnTo`。`preserveReturnTo` 据此给对象内部链接带上已校验的来源。

§6.2 的七条入口全部接线；课程**版本**层仍然默认回产品总览——§6 明确保留这条稳定父子关系。顺带修掉跟进队列"下单"链接指向的 `#finance` 锚点：doc 23 把财务改成 `?tab=` 之后它已经落不到任何元素上。

### 13.6 §5 交互：两处结构性缺陷

**弹窗高度。** `DialogContent` 只有居中变换，没有任何高度约束；`fixed` + `translate-y(-50%)` 的后果是溢出的部分**滚不到**。实测 390×420 视口下"新建学生"弹窗占 −60..480，上下各被切掉 60px，取消/创建两个按钮都够不着。加 `max-h-[calc(100dvh-2rem)]` + `overflow-y-auto` 后同一弹窗是 16..404、内部可滚 152px。用 `dvh` 不用 `vh`：移动端地址栏收起时 `vh` 会多算一截，正是"保存按钮差一点点够不着"那类问题的来源。抽屉同理。

**重复提交。** `useAction` 只暴露 `pending`，防重完全依赖调用点写 `disabled={pending}`——而 `useTransition` 的 pending 要等下一次渲染才为真，`run` 闭包里拿到的还是旧值，一次双击的两下落在同一帧里，两个请求都会发出去。收款、下单、退款都走这条路径。改为在 `run` 里加一道同步的 `useRef` 在途闸门，与渲染时序无关；调用点的 `disabled={pending}` 继续保留，那管的是"看得出正在处理"，不是正确性。

**主操作层级（§5.1）。** 只统计命令面板操作区与 ObjectBar 时，25 个页面全部 ≤ 1，看起来已经成立。把统计范围放宽到整块画布后露出真相：五个页面有两到三个 `bg-rose`。最典型的是建班向导——它把 rose 当**选中态**用（四个步骤芯片 + "正式班/测试班"开关，选中那个就是 primary），一屏里三处 rose 在喊，真正的"下一步"反而不突出。选中态改用设计系统 §1 的月亮黄强调底色（和命令面板的"筛选"同一条理由），rose 只留给流程主操作。另外三处是卡片内的次要动作跟着穿了主行动色：岗位权限的"新建角色"（该页主操作是矩阵"保存"）、责任分配的"添加"、财务侧栏的"新建优惠券/发放奖学金"——财务页本来就没有命令面板主操作，于是这两颗成了整页最响的东西，而它们远不如订单本身重要。

收敛后的稳定状态是：**每页至多一个"页面级"主操作（命令面板或 ObjectBar），加上至多一个"区域级"主操作**——表单的保存、Rail 的流程决策。后者刻意保留：一个表单的"保存资料"如果降成次要按钮，用户会以为它可选；讲次工作区的"提交校对"住在 Rail 这个专门的决策区里，与 ObjectBar 的"进入课件工作台"是两个不同层级的下一步。学生详情（记跟进 + 保存资料）与讲次（进入课件工作台 + 提交校对）就是这条规则下的两个正例，不是遗漏。

统计过程本身还有个值得记下的坑：朴素地按 `bg-rose` 文本匹配会把 Checkbox 一起算进去——它的 class 串里带 `data-[state=checked]:bg-rose`，未勾选时也命中，岗位权限页因此一度报出 53 个"主操作"。

### 13.7 §10 自动检查：脚本落地，spec 不落地

`scripts/verify-doc24-dashboard-closeout.mjs` + `pnpm doc24:audit` 已上线并接进 CI（排在 doc21/22/23 之后）。七类规则：命令面板槽位不得用横向滚动兜溢出、Tabs 保持换行、`flex-1` 与 `min-w-*` 不得并存、页面不得手搓卡片外壳且圆角/标题字号收敛、弹层高度约束不得消失、五个对象页必须消费 `returnTo` 且对象内部保留、`useAction` 的同步闸门不得删除。另加一条 §7.2 的横向滚动**白名单**：只有课表、版本矩阵、课件画布工具条三个具名容器可以横向滚动，其余一律视为兜底。这条当场扫出两处冗余——跟进看板和课评抽屉在 `components/ui/table` 自带的滚动容器外又套了一层，"谁负责横向滚动"有两个答案，已删。

计划建议的 `tests/dashboard-closeout.spec.ts` **没有落地**。本仓库的测试栈是 vitest（`tests/**/*.test.ts`），没有 Playwright 依赖，新增测试框架属于 00-overview §5 铁律 2 要求先报批的范围。浏览器回归沿用仓库既有做法（`.claude/skills/verify` 的 scratchpad Playwright 脚本），静态可断言的部分全部下沉进了 audit 脚本。若后续要把浏览器回归纳入 CI，需要单列一次依赖报批。

### 13.8 验收结果

- `lint` / `typecheck` / `build` / `messages:check`（2645 键 × 2 语言）全过；`doc21:audit` / `doc22:audit` / `doc23:audit` / `doc24:audit` 全过。
- 溢出与布局回归：26 页 × 7 档宽度（390 / 960 / 1024 / 1152 / 1440 / 1800 / 1920，其中 960 / 1152 / 1800 等价于 1440 窗口下的 150% / 125% / 80% 缩放）× 亮暗双主题 = **364 次检查，0 处失败**——根节点与主画布横向溢出均为 0，无越界元素。
- 返回动线回归 13 条全过：六条真实动线（含切 Tab / 切 stage 后来源不丢）、四类攻击载荷（`//evil.com`、绝对外链、非 dashboard 站内页、合同里已删除的路由）被拒并回落兜底、合法来源被接受、今日工作 37 条对象链接全部带 `returnTo`。
- 主操作层级：25 页统计，页面级主操作全部 ≤ 1；表单保存与 Rail 决策作为区域级主操作按上文规则保留。
- 表单：六个表单页在 390px 下输入控件全部有可访问名称，高度全部 ≥ 32px。
- 弹层：初始焦点在弹层内、Escape 可关、390×420 极端视口下不溢出且底部动作区可达。

过程中出现过四次 dev-server 500 / `ERR_ABORTED`（暗色首次编译素材详情页、总览、运行与错误页），全部无法复现——逐个连续重试 4–6 次均 200，最后一轮回归内置首访重试后是 0 次触发。判定为 Turbopack 冷编译竞态，非页面缺陷。

### 13.9 未做与遗留

- **亮/暗逐页视觉签收仍是人工项。** 脚本能证明"没有溢出、层级结构一致"，证明不了"这个灰在暗色下够不够读"。截图已按 26 页 × 亮暗 × 390/1440 生成，等用户过目。
- **告警语义色仍是散落的 amber 阶梯**（`amber-700 dark:amber-300` / `amber-800 dark:amber-300` / `amber-950 dark:amber-100`）。本轮只补齐了三处**缺 dark 变体**的 `text-amber-600`（暗色卡底上对比度不足）。把告警色收敛成一个 `--warn` token 属于新增配色决策，按 00-overview §5 铁律 7 需要先问用户。
- **`features/` 下仍有约 70 处手搓卡片。** 审计只对 `app/[locale]/dashboard/**` 的页面文件强制使用原语——那是"页面之间密度差异"最直接可见的地方，也是能一次改干净、不留半迁移状态的边界。业务组件的迁移随后续改动逐个进行。

---

## 14. 最终目标

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
