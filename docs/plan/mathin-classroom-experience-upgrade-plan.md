# Mathin 课堂体验升级规划

> **状态**：M0–M2 已关闭并完成开发端人工验收；M3a 原生 renderer 智能输入路由施工中，暂不进入 M3b/M4/M5<br>
> **规划日期**：2026-08-24<br>
> **仓库基线**：`swingislee/mathin`，本轮审阅基于 `main` 的 `0e30b33`<br>
> **M1 验收基线**：`43ae587` + `67989c1`；只表示开发目标已验收，尚未部署生产<br>
> **核心场景**：教师在 16:9 课堂一体机上，同时使用 4:3 主板书、整节课持续存在的副板书，以及 20 人名单与积分<br>
> **实施重点**：先关闭输入所有权、学生身份、星星语义和协议预算，再改善教师真实操作链路与视觉布局；以低性能触控一体机为性能下限<br>
> **施工关系**：本稿是 R1-Live-2 之外的候选开发线，不改变 `docs/plan/04-roadmap.md` 的当前 Gate，也不得把体验升级追加成生产单老师试用的新 blocker；只有产品负责人明确选入开发线后才开始提交代码

---

## 1. 背景

当前课堂页已经具备：

- 4:3 课件与主板书覆盖层；
- 整节课持续存在的副板书；
- 学生名单、加星、举手、作答状态；
- 数独等课件内交互；
- 黑、红、蓝三种快捷笔色；
- 主板书与副板书共享工具状态；
- 试讲、正式课堂、离线演练等运行形态。

实际数独课试用暴露出四类课堂体验问题：

1. 画笔覆盖层与课件交互互斥。教师圈画之后，必须切回鼠标才能点击数独按钮，且当前切换入口远离教师常站的屏幕右侧。
2. 数独连续填数与切换数字之间语义混乱。刚填完一个数字后切换新数字，会尝试改写上一格并触发错误提示。
3. 独立“画笔”按钮与黑、红、蓝三支快捷笔功能重复。
4. 16:9 页面中，主板书、副板书、20 人名单都需要持续关注，现有三栏横排无法兼顾主次关系和空间利用。

本轮升级把这四项整合为一次完整的课堂操作体验收口。

---

## 2. 本轮目标

### 2.1 教师操作目标

教师在主板书右侧站立时，应能连续完成：

1. 用红笔圈画题面；
2. 不切换工具，直接用笔尖点击数独数字或格子；
3. 继续书写；
4. 在主板书右下角附近完成换笔、擦除、撤销；
5. 在页面最右侧完成前后翻页；
6. 始终看到副板书中的本节课重点；
7. 始终看到 20 名学生的姓名与直观星星数量。

### 2.2 性能目标

课堂输入链路按低性能触控一体机设计：

- `pointermove` 不触发 React 高频渲染；
- 同一帧内合并笔迹点；
- 书写过程中不重复重画整条当前笔迹；
- 普通新增笔迹不重画全部历史笔迹；
- 大屏 Canvas 像素倍率设上限；
- 副板书笔迹持续累积时，书写性能不随课堂时间明显衰减；
- 智能点击判断不依赖设备是否正确上报 `pen`、`touch` 或 `mouse`。

### 2.3 兼容目标

- 旧主板书和副板书笔迹必须继续可读；若新增采样、分块或进度序号，只能增加版本化可选字段；
- 旧课堂事件和离线 outbox 必须继续可回放；学生身份或星星撤销语义升级时提供版本化聚合器和迁移证据；
- 保持数独镜像状态向后兼容；
- 试讲、正式课堂和离线演练复用同一输入状态机，但试讲不得写生产事件，离线演练不得误调用正式开课、结课或服务端写路径；
- 学生展示端不承担教师输入路由和教师控制栏。

---

## 3. 本轮边界

本轮聚焦课堂外壳、输入路由、白板性能和数独输入语义。

以下内容保持现有产品定位：

- 4:3 课件仍是完整、自包含的演示与交互区域；
- 副板书仍保存整节课重点，不随课件翻页消失；
- 20 人名单以同屏直观扫视为目标；
- 0 到 M0 冻结的视觉上限之间，积分继续直接显示对应数量的星星，不改成“单星 + 数字”；超过上限的奖励策略必须在 M0 明确，不能同时承诺“无限星星、固定卡高、20 人无滚动”；
- 数独题板内部视觉比例和具体题板排版由课件组件单独优化，不纳入课堂架构改造；
- 主板书、副板书、学生名单在教师端正常课堂中持续可见，不以临时遮挡作为主要交互方式。

### 3.1 与当前主线的关系

`docs/plan/04-roadmap.md` 当前唯一施工阶段仍是 `R1-Live-2 · 生产单老师试用`。本规划只有在产品负责人选入开发线后才能实施；开发验证、产品初验、独立可回退提交和生产部署 Gate 分开登记。本文的自动化和试讲通过只证明相应合同，不代表生产教师已经验收。

### 3.2 现有实现证据基线

| 现有事实 | 代码证据 | 对规划的约束 |
| --- | --- | --- |
| 教师、展示、学生复用同一个大型课堂壳和状态对象 | `src/features/classroom/live/LiveShell.tsx` | 新网格只默认作用于 `role="control"`；拆组件还要隔离状态订阅，不能只移动 JSX |
| 可编辑时最上层 draft Canvas 接收全部指针 | `src/features/whiteboard/CanvasSurface.tsx` | Canvas 收到的 `composedPath()` 看不到被其覆盖的数独按钮；智能路由必须由课件与 Canvas 的共同舞台祖先捕获 |
| 课堂名单来自账号成员，学情面板另有基于报名学生的稳定名单 | `LiveShell.tsx`、`src/features/school/session-learning.ts` | 未认领账号的在读学生会从现有星星名单消失；积分名单必须改用 `students.id` 与正式座次数据 |
| 星星事件的 `payload.studentId` 当前实际是学生账号 `user_id` | `src/features/classroom/live/liveState.ts`、`supabase/migrations/20260710000100_fix_star_event_shape.sql` | 支持未认领学生不是纯 UI 改动，需要版本化事件/RLS/报告兼容方案 |
| H5 已在 opaque-origin sandbox 中使用版本化注入 runtime 和 `mathin-h5-media` bridge | `src/features/courseware-doc/h5-shim.ts`、`resolve.ts`、`DocStage.tsx` | 指针能力应扩展现有 runtime 并升级版本，不能另造一个无握手的平行桥 |
| `board_snapshot` 与每个事件 payload 均受 1 MiB 数据库约束 | `supabase/migrations/20260708000400_class_sessions.sql` | 500+ 笔迹和 coalesced points 必须同时验证序列化体积、IndexedDB 配额、回放与补同步时间 |
| 正式座次已经保存稀疏 20 座并区分横向 5×4、纵向 4×5 呈现 | `src/features/school/session-learning-contract.ts`、`classroom_student_seat_order` migrations | 右栏 4×5 必须是同一座次的纵向视图，不能建立第二套“名单顺序” |
| 组织 feature flag 是数据库 fail-closed 白名单与 TypeScript 联合类型 | `organization-settings.ts`、`organization-settings-contract.ts`、`organization_feature_keys()` | 新生产开关需要 migration、默认 false 版本、类型、管理/初始化清单和回退证据 |

### 3.3 深度审阅后的硬结论

1. 智能输入首先是 DOM 输入所有权改造，其次才是阈值状态机；维持当前覆盖层结构无法满足“轻点原生按钮、移动后转为书写”。
2. `routingMode`（智能、交互锁、书写锁）必须独立于白板 `tool`（笔、橡皮、图形、选择）；否则切换锁会破坏工具状态和主/副板书目标。
3. “首版不改数据与协议”只能是调查结论，不能预设。学生稳定身份、星星原子撤销、实时进度去重或快照分块任一项触发时，都必须先走兼容 migration/协议版本。
4. 新布局仅是教师控制端合同。`role="display"` 与 `role="viewer"` 必须保留无教师控件、可随课件展示、小屏可用的独立验收矩阵。
5. 20 人是无滚动视觉基准，30 人是现有发布容量目标；21–30 人必须有明确的降级布局，不能在测试矩阵里只写“超过 20”。

---

## 4. 总体设计原则

### 4.1 主板书优先

4:3 主板书承担当前讲解、书写和课件交互，应获得页面中最大的连续区域。

### 4.2 三部分持续可见

主板书、副板书、学生积分区都属于课堂实时信息，不通过抽屉、覆盖层或频繁折叠来换取空间。

### 4.3 高频操作靠近教师右手位置

- 换笔、擦除、撤销：靠近 4:3 主板书右下角；
- 上一页、下一页：位于整个页面底部最右侧；
- 结束课程：位于右上角；
- 页面列表、插入白板、课堂工具、发题等低频操作进入底部次级区域。

### 4.4 输入判断以动作和目标为准

`pointerType` 只作为调试信息或弱提示，不作为“能否书写/能否点击”的决定条件。

### 4.5 原生交互优先

按钮点击、键盘焦点、长按、拖拽等尽量保留浏览器原生事件链，不通过每次移动反复 `elementFromPoint()` 或人工调用 `.click()` 模拟。

### 4.6 性能优化先于视觉动画

触控一体机上，书写跟手优先级高于阴影、模糊、过渡和复杂动效。书写期间应尽量减少布局、重绘和同步开销。

### 4.7 工程与视觉边界

- Classroom 按工作区级小王子视觉执行：保留纸色、星夜、字体、线宽和一个品牌锚点；实时控制、名单、Canvas 与表单内不新增叙事装饰；
- 复用 `components/ui/` 的 Button、Dialog、Popover、Tooltip 等基础能力，不在业务组件重复手搓控件，也不回退到 `window.confirm()`；
- 所有模式、错误、空状态、同步提示和可访问名称同一提交维护 zh/en；
- 不扩大页面级 Client Component。课堂交互叶子可以保持 client，静态壳、鉴权和数据读取继续在服务端；重 renderer 保持按页动态加载；
- 首屏几何优先由 CSS grid、`aspect-ratio` 与 container/viewport 条件表达，避免服务端猜窗口尺寸造成 hydration 后布局跳变。

---

## 5. 教师端新布局

### 5.1 页面结构

```text
┌──────────────────────────────┬──────────────────────┐
│                              │ 课程信息区   结束课程 │
│                              ├──────────────────────┤
│                              │                      │
│        4:3 主板书            │       副板书         │
│                              │                      │
│                              ├──────────────────────┤
│                              │ 20 人名单与星星 4×5  │
├──────────────────────────────┴──────────────────────┤
│ 次级课堂工具       三色笔 / 擦除 / 撤销   上一页 / 下一页 │
└─────────────────────────────────────────────────────┘
```

### 5.2 布局层级

页面分为两行：

1. **课堂主体区**：主板书 + 右侧课堂信息列；
2. **全宽控制栏**：横跨整个页面底部。

课堂主体区分为两列：

- 左列：4:3 主板书；
- 右列：课程信息区、副板书、学生积分区。

右列分为三行：

- 课程信息区：固定薄条；
- 副板书：占用学生区之外的全部剩余高度；
- 学生积分区：以 5 行学生卡完整显示为高度基准。

### 5.3 推荐起始尺寸

这些尺寸只作为首版原型起点。验收使用浏览器 **CSS viewport**，不是显示器标称物理分辨率；Windows 125%/150% 缩放与浏览器缩放必须进入校准。至少覆盖 `1024×768`、`1280×800`、`1366×768`、`1920×1080`，并在真实 iPad Safari、Android Chrome 与课堂一体机上走查：

- 页面外边距：`8–12px`；
- 区域间距：`8–12px`；
- 课程信息区：`44–48px`；
- 底部控制栏：`52–56px`；
- 右侧宽度：使用 `clamp()`，满足 4 列学生卡完整显示；
- 学生卡：5 行同屏，单卡继续满足至少 `44px` 的触控目标；
- 副板书：获得右列扣除信息区与学生区后的全部空间。

建议的 CSS 骨架仅表达层级，不冻结右栏像素值：

```css
.teacherClassroom {
  display: grid;
  grid-template-rows: minmax(0, 1fr) 56px;
}

.classroomBody {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    clamp(22rem, 31vw, 36rem);
}

.classroomRight {
  display: grid;
  grid-template-rows:
    48px
    minmax(0, 1fr)
    auto;
}
```

主板书仍保持严格 4:3，通过父容器实际宽高做 `aspect-fit`，不再依赖固定的 `100dvh - 6rem` 估算值。

三部分持续可见是教师控制端在已冻结最小横屏 viewport 上的合同。低于该宽度、竖屏、浏览器 UI 挤压或软键盘出现时，按 `docs/plan/27-small-screen-workspace-adaptation.md` 使用显式窄屏降级；不得靠页面横向溢出、把主板书缩到不可写，或把展示端强套教师控制端网格。底栏使用 `100dvh` 和 `env(safe-area-inset-bottom)`，浏览器缩放 `80%/100%/125%/150%` 下都不得遮住高风险操作。

### 5.4 课程信息区

右上课程信息区承载：

- 返回课堂入口；
- 课程标题；
- 试讲、离线或连接状态的紧凑标识；
- 当前页码；
- 结束课程按钮。

结束课程按钮固定在最右侧，与其他操作留出明显间隔，并继续使用危险操作确认。

窄右栏中的信息优先级固定为：

1. 未同步/错误状态与“结束课程”始终可见；
2. 当前模式和连接状态可见；
3. 页码可压缩为短格式；
4. 长课程标题单行截断并提供完整可访问名称；
5. 次级连接细节进入可键盘打开的 Popover。

中文、英文长标题、三路连接状态、pending outbox、离线演练标识同时出现时必须有专门 fixture，不能只用短中文标题验收。

### 5.5 副板书

副板书继续保持：

- 整节课一块；
- 不随课件翻页；
- 教师和学生始终可见；
- 可缩放、跟随等现有能力继续保留；
- 正常课堂默认展开；
- 不以覆盖主板书的临时大面板作为主要使用方式。

现有折叠能力可以作为窄屏或异常场景的兼容手段，不作为 16:9 教师端默认工作流。

### 5.6 20 人积分网格

学生区采用正式座次的纵向 **4 列 × 5 行**呈现，不创建独立“课堂名单顺序”：

- 20 人以内不滚动；
- 学生来自 active `enrollments`，稳定键为 `students.id`；未认领账号的在读学生也必须出现；
- 使用 `classroom_student_seat_order.position` 与现有空座，和学情面板共享同一空间记忆；
- 在线、举手和作答仍以账号 `user_id` 关联，但它只是可空运行态映射，不能再充当学生业务身份；
- 卡片第一层显示姓名与在线、举手、作答等状态；
- 卡片第二层直接排列星星；
- 点击学生卡继续加星；
- 长按可以继续作为快速撤销，但必须另有可聚焦、可键盘和屏幕阅读器操作的明确撤销入口。

星星展示规则：

- 在 M0 冻结的视觉上限内渲染实际数量的星星图标；
- 不使用“单星 + 数字”的退化显示；
- 数量较少时使用正常尺寸；
- 数量增加时允许星星适度缩小或换成两行；
- 星星序列的视觉长度继续承担快速比较功能；
- 21–30 人保持稳定座次号并进入内部纵向滚动或密度降级，首屏显示当前关注座位且不得重排；
- 加星达到视觉上限后的策略在 M0 二选一：推荐“禁止继续并给出可访问反馈”，或产品明确允许新的溢出表达；在选择前不得实现无限追加图标；
- 已开课名单默认冻结为进入课堂时的 session roster；重连发现报名变化时显示差异并由教师确认刷新，不在课中静默重排座位。

卡片需要覆盖 2–6 字中文、长英文名、空座、离线、举手、已作答、无账号、最高星数和错误/同步中状态。视觉截断不改变完整 `aria-label`；加星、撤销成功和失败通过短 `aria-live` 通知，不移动当前焦点。

### 5.7 底部控制栏

底部控制栏横跨整个页面，但按上方两列对齐：

#### 主板书下方

靠近主板书右边缘集中放置：

- 黑笔；
- 红笔；
- 蓝笔；
- 擦除；
- 撤销；
- 更多绘图工具。

这组按钮是教师书写过程中的最高频操作。

#### 页面右下方

最右侧固定放置：

- 上一页；
- 下一页。

下一页位于最右，符合课程推进方向。翻页组与绘图组之间设置明显分隔，降低误触。

#### 次级操作区

页面列表、插入白板、课堂工具、发题等进入底部左侧或“更多课堂工具”菜单。低频操作不与三色笔和翻页按钮争抢主位置。

现有学情检查、点名提醒、工具覆盖页、发题/答题汇总、副板书缩放/跟随、pending outbox 与主/副板书 `activeArea` 不能在布局重构中丢失。底栏必须持续显示当前板书目标；撤销、清空、橡皮等操作的作用域以该目标为准，切到副板书后的第一笔不得落到上一个目标。

---

## 6. 白板工具栏收口

### 6.1 移除独立画笔按钮

当前黑、红、蓝颜色按钮已经会执行 `setTool("pen")`。因此独立铅笔按钮从主工具层移除。

新的心智模型是：

- 黑色圆点 = 黑笔；
- 红色圆点 = 红笔；
- 蓝色圆点 = 蓝笔。

从橡皮、选择或其他工具返回书写时，直接点击对应颜色。

### 6.2 选中状态

颜色按钮只有在以下条件同时满足时显示选中：

```ts
tool === "pen" && color === token
```

切换到橡皮、选择或图形工具后，颜色仍然保留为下次使用的颜色，但不继续显示为当前激活工具。

### 6.3 工具栏形态

共享 `Toolbar` 保留完整白板能力，同时增加课堂紧凑形态：

```ts
<Toolbar variant="classroom" />
```

课堂形态负责：

- 三色笔；
- 擦除；
- 撤销；
- 更多颜色；
- 粗细与完整工具进入二级菜单。

独立白板可以继续使用完整形态。

### 6.4 输入模式与绘图工具正交

工具栏维护两组独立状态：

```ts
type ClassroomRoutingMode = "smart" | "interaction-lock" | "ink-lock";
type WhiteboardTool = Tool;
```

切换 `routingMode` 不覆盖当前笔色、粗细、白板 `tool` 或主/副板书 `activeArea`。三种输入模式必须在一级界面有持续可见的短状态和一键恢复智能模式的入口；“更多”菜单只承载解释和低频设置，不能成为发现当前锁定状态的唯一位置。

M0 冻结以下行为矩阵，未冻结前智能模式只对 `pen` 开放：

| 当前工具 | Smart | Interaction lock | Ink lock |
| --- | --- | --- | --- |
| `pen` | 点击已审计交互目标；移动后接管书写 | 全部交给课件 | 全部用于书写 |
| 碎擦/整线擦 | 默认保持板书所有权，避免轻点按钮意外擦除后又点击 | 全部交给课件 | 全部用于擦除 |
| 图形/选择/尺规 | 不自动套用“轻点点击、移动书写”；按能力清单明确 native 或 board | 全部交给课件 | 全部交给当前板书工具 |

模式、工具和板书目标三者都需要各自的 `aria-pressed`/可访问名称。页面切换、主副板切换、断线重连和试讲重置不得让界面显示状态与实际路由状态分离。

---

## 7. 数独输入语义修正

### 7.1 数字印章模型

数独数字按钮改为“持续数字印章”：

- 点击 `5` 后，`5` 保持选中；
- 连续点击多个空格，可连续填入 `5`；
- 切换到 `7` 时，只把当前印章改为 `7`；
- 切换印章本身不修改刚刚填好的格子；
- 切换印章本身不触发答案错误；
- “先点空格，再点数字”的输入方式继续保留；
- 候选模式继续支持同一空格连续点多个候选数。

### 7.2 焦点与输入目标

首版不必新增镜像字段，可通过现有状态区分：

- `selected` 可以继续表示视觉焦点；
- 只有“非题面且当前仍为空”的选中格，才允许数字按钮立即输入；
- 已经填入数字的选中格只保留绿色焦点框，不再作为切换数字时的写入目标。

核心条件：

```ts
const selectedIsEditableAndEmpty =
  selected !== null &&
  puzzle[selected] === 0 &&
  values[selected] === 0;
```

点击新数字时：

- 条件成立：完成“先格后数”输入；
- 条件不成立：只更新 `inputDigit`。

### 7.3 错误提示触发条件

错误提示只在教师明确尝试把数字应用到一个空格时触发：

- 点击空格应用当前数字；
- 先选空格后点击数字。

单纯切换当前数字不属于答题尝试。

错误提交不得清空当前数字印章、候选数位图或输入模式。失败格可以保留错误反馈焦点；教师随后点击另一个数字时，该动作只切换印章并退出旧失败目标，不立即向失败格再次提交。下一次点击空格后再应用新印章。

### 7.4 兼容性

这一调整：

- 不修改数独题面；
- 不修改候选数位图格式；
- 不修改课堂 `game_state` 结构；
- 不需要数据库 migration；
- 保持旧课堂镜像可恢复。

---

## 8. 智能课堂输入路由

### 8.1 默认模式

教师端主板书默认使用：

```text
Smart / 智能模式
```

目标是：

- 轻点课件按钮或格子：执行课件交互；
- 笔尖明显移动：开始书写；
- 整个过程不要求教师切换到鼠标工具。

### 8.2 不依赖 `pointerType`

课堂设备可能把触控笔上报为：

- `pen`；
- `touch`；
- `mouse`。

因此输入路由只使用以下信息作主要判断：

- 起点是否位于交互目标；
- 手势是否超过移动阈值；
- 目标声明的是点击、拖拽还是书写；
- 当前是否处于智能、交互锁或书写锁。

`pointerType`、压力、接触面积可以进入调试数据，但不作为唯一分支条件。

### 8.3 输入状态机

状态机挂在课件与板书 Canvas 的**共同舞台祖先**上，不挂在当前最上层 draft Canvas。Smart 模式下 Canvas 是纯渲染层并保持 `pointer-events: none`；`CanvasSurface` 暴露命令式、归一化的输入端口，舞台捕获器把真正属于板书的手势送进去：

```ts
interface BoardInputSink {
  begin(input: FrozenPointerInput): void;
  append(points: readonly NormalizedPoint[]): void;
  finish(reason: "up" | "lost-capture" | "page-change"): Promise<void> | void;
  cancel(reason: "pointer-cancel" | "blur" | "unmount"): void;
}
```

所有路由状态保存在 ref/纯 reducer 中，不在移动阶段更新 React state：

```text
idle
 ├─ 普通书写区按下 → inking
 ├─ 点击型控件按下 → pending-click
 └─ 原生拖拽控件按下 → native-interaction

pending-click
 ├─ 未超过阈值并松开 → 原生点击
 └─ 超过阈值 → 舞台捕获该 pointer → 回填起点 → inking → 抑制本手势 click

inking
 ├─ 本 pointer 松开 / lost capture → 排空队列并提交 → idle
 └─ cancel / blur / 页面卸载 → 按冻结策略提交或取消 → idle
```

舞台只有在接管发生后才调用 `setPointerCapture(pointerId)`。Canvas 不再通过覆盖交互元素来抢到 `pointerdown`，也不人工调用 `.click()`。

### 8.4 点击型控件

能力 registry 明确登记为 `click` 的数独格子、数字按钮和普通课件按钮属于可延迟接管的点击型目标。

处理方式：

1. 在共同舞台的原生 `pointerdown` 捕获阶段读取一次 `event.composedPath()`；此时事件目标必须是真实课件节点，而不是覆盖 Canvas；
2. 记录起点、目标和指针 ID；
3. 冻结舞台矩形、实际课件 content rect/letterbox、板书尺寸、页 `pageKey`、工具与能力版本；4:3 舞台内的 16:9 内容区和底部板书带不得共用错误的坐标变换；
4. 不立即阻止原生点击；
5. 移动距离未超过阈值时，让原生事件自然结束，确保 click 恰好一次；
6. 移动超过阈值时，由共同舞台捕获指针并把缓存起点/移动点送入 `BoardInputSink`；
7. 接管后只抑制同一 `pointerId`、同一 gesture token 对应的后续 click；
8. 接管若发生在已有焦点/pressed 状态的控件上，清理临时 pressed 视觉，但不任意移动键盘焦点。

可接管的“点击型”控件不得在 `pointerdown` 里产生不可逆业务变化。若现有组件在按下时已经改值、开始拖拽或捕获指针，必须标记为 `native/drag`，不能依赖后续取消来回滚。

### 8.5 普通书写区域

从能力清单明确标为 `ink` 的普通区域按下时立即开始书写，不等待移动阈值。`touch-action: none` 放在实际接管指针的舞台/板书输入宿主上；不能只留在 `pointer-events: none` 的 Canvas，也不能扩散到仍需原生滚动、缩放或视频控制的节点。

### 8.6 拖拽型交互

滑块、拖拽配对、几何对象和数独拖选等课件需要显式声明动态输入语义：

```html
data-classroom-input="click"
data-classroom-input="drag"
data-classroom-input="native"
data-classroom-input="ink"
```

原生语义可作为审计提示：

- `button`；
- 链接；
- 表单控件；
- `[role="button"]`；
- 数独单元格与工具按钮。

拖拽型目标在智能模式下优先保留原生拖拽，不由移动阈值抢占。数独同一个单元格在普通填数与拖选高亮模式下可以拥有不同能力，分类结果必须来自当前 renderer 状态，不能按标签名永久缓存。

建立版本化 `ClassroomInputCapability` registry，至少盘点：数独、原生文档点击步进、自研游戏拖拽、图片、视频原生控件、白板页、课堂工具覆盖层、爱学习/H5。`data-classroom-input` 是 renderer 输出的一部分，不是全局猜测器。未登记 renderer、能力版本不匹配或目标语义未知时 fail closed 到交互锁，并提供明确的书写锁入口；不能把任意 `button` 自动视为可被中途接管的点击目标。

Canvas base/draft、`BoardObjectLayer`、`InstrumentLayer`、课件 DOM 和课堂 ToolOverlay 需要一张明确的 z-layer/输入所有权表。Smart + pen 时 ink Canvas 只渲染；选择、图形、尺规或对象编辑启用时由 §6.4 的工具矩阵决定哪个板书层可交互，不能只把 draft Canvas 设为 none 后留下另一个透明层继续吞事件。

### 8.7 H5 课件

iframe 内事件不会自然冒泡到课堂父页面。现有 H5 已使用 `H5_RUNTIME_VERSION` 和 `mathin-h5-media` bridge；指针能力扩展这套 runtime，建议升级为 v3，不另建无法统一升级和缓存失效的平行脚本。合同可命名为：

```text
MathinCoursewarePointerBridge
```

握手与消息至少包括：

- `hello/capabilities/ack` 的 runtime 与协议版本；
- 父级按 frame 生成的一次性 channel token；
- frame id、pointer id、gesture token、chunk sequence；
- 交互目标能力与当前是否进入原生拖拽；
- 归一化到 iframe viewport 的按下、批量移动、松开/取消；
- 父级 takeover、click suppression 与结束确认；
- 嵌套 iframe 的逐层坐标变换与 relay 标记。

opaque-origin iframe 的 `event.origin` 是 `"null"`，因此父级必须同时验证 `event.source === iframe.contentWindow`、channel token、schema、版本、消息大小与速率；子 frame relay 也要验证直接父级。指针移动按 animation frame 批量 `postMessage`，禁止每个原始 move 一条消息。桥中不得携带 auth、学生身份或其他 PII。

导航、frame reload、崩溃、失联和超时必须清除父级 pending gesture。握手未完成、版本不兼容或 watchdog 超时时默认交互锁，并显示“此课件需手动切换书写”的可恢复提示；不使用坐标猜测和人工 `.click()` 模拟。

runtime 版本必须进入启动 URL 与离线缓存 key。v3 上线后，已缓存的 v2 注入 HTML 要么重新注入/失效，要么明确以“媒体可用、指针桥不兼容”的交互锁降级；不能让在线首次打开正常、离线复开却悄悄运行旧桥。

### 8.8 两个兜底状态

“更多”菜单中保留：

- **交互锁**：所有输入交给课件；
- **书写锁**：所有输入用于板书。

它们用于特殊设备、原生拖拽课件和未接桥的 H5 页面。正常数独课堂默认保持智能模式。锁定状态在主控制栏持续可见，切页后按 renderer 能力重新求值；H5 从不兼容页回到已审计数独页时可以提示恢复智能，但不能在教师书写过程中静默切换。

### 8.9 多点与误触保护

- 只接受 `isPrimary` 且按键状态合法的起始事件；同一块板一次只允许一个活动书写指针；
- 活动笔迹结束前忽略后续辅助指针；
- 所有 `pointerup/cancel/lostpointercapture` 都核对精确 `pointerId`，无关指针不得结束当前笔迹；
- 笔迹接管后使用 Pointer Capture，并处理 `lostpointercapture`；
- `pointercancel`、`window.blur`、`visibilitychange`、切页、尺寸变化和组件卸载都使用书面化的 commit/cancel 策略；
- pointerdown 时冻结 bounding rect、Canvas 宽高、DPR、`pageKey` 和笔宽基准；中途 resize/orientation change 先排空并结束或取消当前手势，再采用新几何，避免归一化坐标跳变；
- hover、右键、笔杆键和笔尾橡皮不自动当作主笔书写；M0 按设备记录 `button/buttons`，只有合同允许的 primary contact 启动当前工具，笔尾映射需显式启用；
- 实机覆盖“手掌先接触、笔后接触”和“笔书写中手掌接触”；`pointerType` 可以参与活动指针仲裁，但不能改变已审计目标的 click/native 能力；
- 不在 `pointermove` 中反复做 DOM 命中查询。

### 8.10 阈值与真实设备校准

移动阈值用 CSS px 和累计位移/最大偏移计算，并带滞回。2026-08-24 产品负责人根据 `5/8/12px` 快速样本冻结首版默认值为 **8 CSS px**；5px 和 12px 只保留为诊断候选，不按 DPR 换算后写入业务逻辑。`pointerType`、压力和接触面积可以进入诊断，但不得决定某个目标能否点击，也不得为 renderer 各自硬编码阈值。

浏览器自动化验证事件传播和 click 恰好一次。正式 100 次按钮轻点、50 次按钮上起笔和 50 次普通区短划的协议继续作为设备诊断工具，但不再作为 M0/M3 施工前置门；首版随独立输入 feature flag 进入教师试用，根据真实课中的误点、漏点、漏笔和出墨迟滞反馈再调整。阈值必须集中配置，调整不改变归一化笔迹、数据库事件或 renderer 能力合同；出现可重复问题时再在对应设备运行正式协议并记录无 PII 汇总。

---

## 9. 白板性能升级

### 9.1 当前主要负担

当前白板书写过程中会出现这些高成本路径：

- 每次 `pointermove` 清空临时画布；
- 每次移动重新绘制当前整条笔迹；
- 新笔迹提交后可能重绘全部历史内容；
- 本地光标和实时笔迹可能按原始事件频率发送；
- Canvas 按完整设备 DPR 扩张；
- 副板书一整节课持续累积，后半程负担大于刚开课时。

### 9.2 笔迹点逐帧合并

在 `pointermove` 中只做：

- 读取 `getCoalescedEvents()`；
- 把点追加到 ref 队列；
- 首次入队时申请一个 `requestAnimationFrame`。

每一帧统一处理该帧全部点，保证：

- 每帧最多一次预览绘制；
- 高频触控事件不会导致同等次数的 Canvas 重绘；
- 不引入 React state 更新。

实现还必须满足：

- `getCoalescedEvents()` 不存在或返回空数组时回退到当前 event；
- 按时间/事件顺序去重，丢弃相同归一化点和非法坐标；
- `pointerup`、`lostpointercapture`、切页、结课、失焦和卸载先同步排空队列，再发 final commit；
- 以距离、转角和最大时间间隔做在线重采样，保留首尾点；不能把每个硬件原始点永久写入事件，从而把渲染优化变成存储膨胀；
- 记录 raw/coalesced/resampled 三组点数，以代表性长笔迹验证视觉误差与 payload 收益。

### 9.3 增量预览

当前 `perfect-freehand` 平滑结果会受后续点影响，不能把“只画最后两个点”当成等价的增量预览。实现采用经过视觉差异测试的 tail-window/重叠片段策略，或为课堂预览提供可增量的轻量算法；松笔后用权威算法完整调和一次。临时画布只重画未冻结的尾段，不从第一点重画整条笔迹。

验收同时比较：预览无明显接缝、松笔调和不发生可感知跳变、短点/锐角/回钩/高速长线首尾不缺失。最终数据保存重采样后的完整点集，旧点集继续可渲染。

### 9.4 历史内容增量提交

基础画布区分：

- **追加型变化**：新增一条或多条笔迹，只绘制新增项；
- **结构型变化**：撤销、擦除、清空、对象编辑、主题切换、尺寸变化，执行完整重绘。

store 提供明确的 revision 与 mutation 元数据，例如 `append/erase/replace/clear/restore/theme/resize/basis-change`。正常路径不靠每次 O(n) 前缀比较来推断。只有 `append` 可以直接绘制新增 item；撤销、碎擦/整线擦、清空、远端 replace、主题、尺寸、DPR 与笔宽基准变化都执行完整重绘。SVG 形状层与 Canvas 笔迹层共享同一 revision 语义。

### 9.5 Canvas 像素倍率

课堂模式使用独立 render profile；DPR 上限只是第一道保护：

```ts
const dpr = resolveEffectiveDpr({
  requested: window.devicePixelRatio || 1,
  maxDpr: 1.5,
  cssWidth,
  cssHeight,
  maxBackingPixels,
});
```

`1.5`、单 backing store 8 MP、教师课堂所有 Canvas 合计 24 MP 作为待实测的起始护栏；M0 在最低设备上冻结最终值。主板书和副板书各有 base/draft，多块 Canvas 的总内存预算比单个 DPR 更重要。CSS 显示尺寸保持不变，超过像素预算时自动降低有效 DPR并完整重绘。

共享 `CanvasSurface` 通过 `renderProfile="classroom"` 或等价配置启用该预算；独立白板和课程批注默认行为不得被课堂优化静默改变。`ResizeObserver` 按帧去抖，Backing store 改变后只做一次完整重绘。

### 9.6 同步频率

本地视觉反馈与网络同步解耦：

- 本地笔迹每帧绘制；
- 远端光标限制到约 `20–30Hz`；
- 实时笔迹进度按帧或小批次发送；
- 松笔时发送完整最终笔迹；
- 不因同步等待阻塞本地绘制。

当前课堂实时进度可能经多种 transport 重复到达，接收端不能再对每个 chunk 盲目 `push`。进度协议增加向后兼容的 `strokeId + chunkSeq + startIndex`（或等价字段），按 `(senderDeviceId, strokeId)` 去重、排序和限窗；旧无序号消息仍走 legacy 路径，最终 `board_snapshot`/commit 是权威收敛点。结束消息发出前必须排空 rAF 队列和最后一个 progress chunk。

同一设备的持久 `append` 需要串行化或用 reducer 明确证明并发完成顺序不影响结果。尤其 `star/star_undo`、翻页和结课不能依赖异步 IndexedDB 写入完成的偶然顺序。

### 9.7 副板书长时性能

副板书重点验证：

- 500 条以上笔迹；
- 多次撤销与擦除；
- 主板书同时继续书写；
- 20 人名单和星星同时更新；
- 连续 30–60 分钟使用。

数据仍保留为可编辑笔迹，不把历史内容永久压平为图片。Canvas 本身承担渲染缓存。长时 fixture 同时记录序列化 `board_snapshot` 字节、恢复耗时、outbox 数量、IndexedDB 占用与内存；只测帧率不足以证明能完成一节课。

### 9.8 书写期间的页面成本

在 `data-inking="true"` 期间：

- 暂停非必要工具栏过渡；
- 避免大面积 `backdrop-filter` 动画；
- 学生卡加星动画不影响 Canvas；
- 不触发布局尺寸变化；
- 不更新与笔迹无关的 React 状态。

`LiveShell` 的星星、举手、连接、页、板书快照目前共享上层 React state。拆组件必须同时下推订阅边界：星星变化不重渲染舞台，板书 progress 不重渲染名单，远端 cursor 不更新整个课堂壳。开发计数器与 React Profiler fixture 对这些不变量作断言；仅把 JSX 搬到新文件不算完成。

### 9.9 调试开关

增加仅开发环境或显式参数开启的轻量统计：

- 当前输入模式；
- 浏览器上报的 `pointerType`；
- 每秒原始点数；
- 每秒绘制批次；
- Canvas CSS 尺寸、像素尺寸和 DPR；
- 完整重绘次数；
- 当前笔迹数。

正式课堂默认关闭，不持续产生运行成本。

统计信息不含学生姓名、学生 ID、课件正文和原始笔迹坐标；正式环境只有明确诊断开关时才采样，并限定内存环形缓冲、生命周期和导出动作。

### 9.10 量化性能 Gate

性能门在 fresh production build、固定课件 fixture、同一浏览器版本和登记的最低课堂设备上执行；开发机 DevTools 观感不能替代。M0 先记录旧实现基线，M2 对同一输入复测：

| 指标 | 通过线 |
| --- | --- |
| 输入到预览 | 10 秒连续书写时 p95 ≤ 2 个 60 Hz frame（33.4 ms），p99 ≤ 50 ms |
| 主线程长任务 | 课堂输入 handler 单次不得 ≥ 50 ms；10 秒样本中课堂代码造成的 long-task 总时长 < 1% |
| 追加重绘 | append-only 笔迹期间历史 full redraw 为 0；结构 mutation 后恰好按合同重绘 |
| React 隔离 | 笔迹移动不重渲染课堂壳/名单；单个学生加星不重渲染主板书 Stage |
| 长课稳定性 | 500+ 笔迹后输入延迟 p95 相对空板退化不超过 20%，无持续增长的 pending queue |
| Canvas 资源 | effective DPR、每 Canvas 和总 backing pixels 均不超过冻结预算，resize 后无旧 backing store 泄漏 |
| 路由体积 | fresh `pnpm bundle:report` 记录课堂路由前后 gzip；超过冻结预算需拆分或书面批准，不能引用旧 `.next` 产物作正式基线 |
| 首次可操作 | 固定网络/数据 fixture 记录 server data、initial payload、hydrate 到首个可用输入的耗时；M2/M4 相对 M0 基线退化不超过 10% |

### 9.11 存储与恢复 Gate

- 代表性 60 分钟 fixture 的单个 `board_snapshot` 目标不超过 768 KiB，为数据库 1 MiB check 留至少 25% 余量；运行时在 warning 水位显示可恢复提示，并只在已实现可编辑分块/压缩合同时切换到较小 checkpoint，不能假装现有全量快照会自行变小；
- 若重采样后仍不能满足余量，M2 必须先引入版本化分块 checkpoint/快照协议与 migration，禁止靠捕获异常后丢事件；
- 使用 `navigator.storage.estimate()` 记录 quota/usage，并评估 `persist()`；无法持久化、quota exceeded、IDB open/transaction 失败都进入可见错误和可导出的无 PII 诊断；
- 冷启动回放 5,000 事件上限、多个历史快照、时钟偏移和离线晚到事件，验证权威排序不依赖未经校正的客户端 `at`；
- 当前 `listSessionEvents()` 按客户端 `at` 升序并 `.limit(5000)`；M0 统计长课事件数，超过或接近上限时改为可证明完整的 cursor pagination，或“每块板最新 checkpoint + 其后 tail + 其他事件分页”。不得静默只取最早 5,000 条，也不得把所有历史全量快照都下载进首屏；
- 记录每课次累计 snapshot 字节、初始查询传输字节和 reducer 回放时间；单个 payload 未超 1 MiB 不代表数据库、网络和浏览器内存可接受；
- 页面切换和结课后重新载入，最终一笔、最后一次数独状态、星星和页码全部存在；失败时留在当前页面并提供重试，不能先导航再静默丢尾巴。

### 9.12 首屏与代码交付

课堂 live Server Page 继续负责 `requireUser()`、成员/课次/事件/名单读取与角色求值。新布局不把这些查询搬进客户端 effect。为受保护动态子树提供形状一致的 `loading.tsx` 或 Suspense 边界；骨架先表达 4:3 舞台、右栏和底栏，不闪现未经授权的教师控件。

盘点当前 `classroom/session/events/courseware/attendance/learningSetup` 的串并行关系，消除无数据依赖的 waterfall；事件 checkpoint 查询和名单映射不得重复取数。数独、H5、视频、工具等非当前页重 renderer 继续按页动态加载，feature flag 关闭时不把 v2/H5 重代码装入控制端首包。fresh bundle/initial RSC payload/hydration 指标与 §9.10 同批记录。

---

## 10. 建议组件边界

### 10.1 新增

#### `useClassroomPointerRouter.ts`

负责：

- 输入状态机；
- 共同舞台捕获、版本化目标能力分类；
- 移动阈值；
- 点击抑制；
- 指针捕获；
- 智能、交互锁、书写锁。

状态全部放在 ref 中，消费白板暴露的 `BoardInputSink`；hook 本身不持有笔迹数据，也不在覆盖 Canvas 上命中底层节点。

#### `classroom-input-capabilities.ts`

负责 renderer id/version、目标的 `click/drag/native/ink` 能力、动态能力读取和 fail-closed 默认。数独、文档、视频、自研游戏、H5、工具覆盖页逐项登记；不在 router 里堆标签名特例。

#### `ClassroomControlBar.tsx`

负责：

- 全宽底部控制栏；
- 主板书右下角绘图工具组；
- 次级课堂工具；
- 页面最右侧翻页组。

#### `ClassroomInfoBar.tsx`

负责：

- 课程标题；
- 模式与连接状态；
- 页码；
- 返回入口；
- 结束课程。

#### `ClassroomRosterGrid.tsx`

负责：

- 正式座次的纵向 4×5 学生卡布局与 21–30 人降级；
- 星星序列；
- 加星、明确撤销与长按快捷撤销；
- 20 人无滚动基准、空座和 stable `students.id`；
- 账号在线态到学生业务身份的可空映射。

### 10.2 调整现有组件

| 文件 | 主要调整 |
| --- | --- |
| `src/features/classroom/live/LiveShell.tsx` | 新教师端网格、状态编排、底部控制栏、右上信息区 |
| `src/features/classroom/live/LivePanels.tsx` | 共同舞台输入宿主、renderer 能力、学生卡拆分或适配网格 |
| `src/features/whiteboard/CanvasSurface.tsx` | 命令式输入端口、逐帧批处理、增量绘制、render profile 与像素预算 |
| `src/features/whiteboard/Toolbar.tsx` | 移除独立画笔、课堂紧凑 variant、正确激活状态 |
| `src/features/whiteboard/strokes.ts` | 增量预览与追加渲染接口 |
| `src/features/whiteboard/store.ts` | revision 与追加型/结构型 mutation 元数据 |
| `src/features/classroom/live/useClassBoard.ts`、同步 bus/transport | rAF 排空、progress chunk 序号、去重、最终快照收敛 |
| `src/features/games/sudoku/state.ts` | 数字印章与空格目标判断 |
| `src/features/games/sudoku/SudokuBoard.tsx` | 保持视觉焦点，按普通/拖选模式输出动态输入能力 |
| `src/features/courseware-doc/h5-shim.ts`、`resolve.ts`、`DocStage.tsx`、`AixuexiStage.tsx` | 扩展现有 H5 runtime、版本握手、批量指针 bridge 与 watchdog |
| `src/features/classroom/live/StudentCard.tsx` 或现有学生卡位置 | 星星视觉上限、可访问撤销、网格卡片布局 |
| `src/features/school/session-learning.ts` 及合同 | 将正式报名名单、稳定学生 ID、座次和账号映射提供给课堂控制端 |
| `messages/zh.json`、`messages/en.json` | 智能模式、交互锁、书写锁及新控制栏文案 |

### 10.3 数据与协议

以下内容可以保持不变：

- 旧白板 item 的读取结构；
- 笔迹 0–1 归一化坐标语义；
- 数独 `GameMirrorState`；
- 旧课堂页快照和旧事件的回放入口。

智能输入模式、布局与工具栏停靠属于教师本机 UI 状态，不写入课堂事件流。

是否需要 migration 由 M0 的兼容差异表决定，不能提前宣称“不需要”。已知可能触发项：

| 变化 | 为什么可能需要 migration / 协议版本 |
| --- | --- |
| 积分名单改用 `students.id` | 当前 `star/star_undo` 写的是账号 `user_id`，学生自读 RLS 与多个报告聚合器按该字段匹配 |
| 原子撤销一颗具体星 | 当前 `star_undo` 只是按回放顺序减一，无法在离线乱序和重复消息下稳定表达“撤销哪一颗” |
| progress chunk 去重 | 需要可选 sequence/start index 与 legacy reader |
| 快照分块 | 单事件 1 MiB 上限可能要求 checkpoint manifest/chunk 与恢复读路径 |
| 生产 feature flags | 允许键函数、默认 false 版本、生成类型和初始化 manifest 都是 fail-closed 合同 |

每项选择 `no change / optional v2 field / new event schema / database migration` 之一，并写出旧 reader、新 writer、双读期、回退和删除 legacy 的条件。没有这张表，不进入 M2/M3/M4 集成。

---

## 11. 数据、同步、安全与会话生命周期

### 11.1 正式名单与身份合同

课堂积分、学情检查、点名和座次必须共享一套 `SessionRosterEntry`，以 `students.id` 为业务主键：

```ts
interface SessionRosterEntry {
  studentId: string;
  name: string;
  seatPosition: number | null;
  userId: string | null;
}
```

- active `enrollments` 决定谁属于课堂名单；`classroom_members` 只决定有账号的人是否拥有直播访问权；
- `userId` 仅关联 presence、举手和作答，未认领账号时为 `null`；
- 开课时生成或冻结 roster revision/摘要；重连若发现报名或座次变化，先提示差异，教师确认后再刷新；
- 5×4 横向学情面板与 4×5 右栏按同一个 `seatPosition` 变换，空座编号和学生位置保持一致；
- 20 人是默认座位容量，21–30 人的扩展槽、滚动定位和焦点顺序要可预测；超过系统容量时 fail visible，不截断学生。

### 11.2 星星事件语义

当前 `star_undo` 是“回放时减一并下限为零”，与注释中的“原子撤销最新一颗星”不一致，并会受离线乱序影响。推荐 v2 继续使用 `star/star_undo` 类型但增加显式 schema：

```ts
type StarV2 = {
  schemaVersion: 2;
  studentId: string; // students.id
  awardId: string;
};

type StarUndoV2 = {
  schemaVersion: 2;
  studentId: string;
  awardId: string; // 被撤销的具体 award
};
```

聚合按 award set/revocation set 计算，使重复、晚到和跨 transport 顺序不改变结果。旧 v1 事件继续走 legacy 净值聚合；同一课次切换 writer 前先冻结策略，避免半节课混用两种身份而无法解释。所有报表、家长/学生可见 RLS、学习聚合和导出均加入 v1/v2 fixture。

写入策略验证目标学生是该课次班级的 active roster，不能只验证作者是教师。客户端连续点击和长按通过单队列串行，撤销只指向当前仍有效的最新 award。视觉上限、是否允许继续奖励和历史超过上限时的显示由 M0 冻结。

### 11.3 Realtime 信任边界与顺序

- 数据库 RLS 只保护持久 insert，当前 `session:<id>` broadcast send policy 允许所有课堂成员发送，不能保护瞬时 page/star/board FX。接收端校验 sender device、已知 user、当前角色和事件/FX 类型只属于防错，不能把 payload 自报的 `userId/role` 当授权；
- M0 在两种权威路径中冻结一种：拆分由 `realtime.messages` insert RLS 限制为教师可发、成员可收的 teacher-authoritative topic，或远端只在读到数据库已验证事件后应用教师控制状态。学生 hand/answer 走独立允许路径；未完成该边界前不把 broadcast 直接当权威 UI 状态；
- 所有 payload 在进入 reducer 前通过版本化 schema、大小和范围校验；未知字段可忽略，未知 schema/type fail closed 并计诊断；
- FX 按 transport event id 或 `(senderDeviceId, strokeId, chunkSeq)` 去重，不能因 T0/P2P/T2 同时到达而重复追加远端点；
- 持久事件继续遵守“先写本地 outbox，成功后再更新 UI”。同设备 append 串行分配 seq；跨设备的新 v2 语义尽量设计为交换/幂等，不新增对客户端 `at` 全序的依赖；
- final commit/`board_snapshot` 是实时 progress 的权威收敛点；收到 final 后清理同 stroke 的 pending chunk，晚到 chunk 不再复活草稿。

### 11.4 页面切换、结课与卸载屏障

新增统一 `drainClassroomWrites(reason)`，显式翻页、结束课程和路由离开按顺序执行：

1. 停止接受新输入并排空当前 pointer/rAF/coalesced 队列；
2. 发送最后 progress end，提交当前笔迹；
3. 立即落主/副板书快照与未触发的 `game_state` debounce；
4. 等待事件进入 IndexedDB outbox；在线时尽力 flush，但网络失败不删除本地事件；
5. 更新 pending/error UI；只有本地持久化成功后才翻页或导航；
6. 结课 Server Action 失败时恢复按钮并保留当前页，提供重试，禁止重复 end。

`pagehide`/浏览器崩溃只能 best effort，不能替代显式操作屏障。`visibilitychange`、offline drill 退出、H5 reload、orientation change 和组件 unmount 都有确定的 drain/cancel 分支。测试重载后的最后一笔、最后一次数独输入和最后一颗星，而不是只确认“调用了 append”。

### 11.5 可见失败与恢复

以下失败不得被 `.catch(() => undefined)` 吞掉：IndexedDB 打开/配额/事务失败、快照超预算、bridge 失联、outbox 连续 flush 失败、renderer 能力不兼容、roster 版本错位。教师端信息栏保留一条最高优先级的可恢复状态，提供重试或切换安全模式；详细诊断可复制但不含姓名、ID、课件正文和笔迹坐标。

网络断开本身不是错误：界面区分“已安全保存到本机，待同步”和“本机也未保存”。前者可继续课堂，后者停止会新增不可恢复数据的操作并明确告知教师。

### 11.6 可访问性与动作等价

- 长按撤销必须有可见或上下文菜单中的按钮等价项；键盘 `Enter/Space` 加星，明确撤销按钮可操作，触摸长按仅是快捷方式；
- 长按加入移动容差、进度提示和 `pointercancel` 清理，拖动离开卡片不触发撤销；
- 模式、工具、当前板书目标、同步失败、加星/撤销结果有中英文可访问名称和必要的 `aria-live`，但连续书写/星星动画不刷屏阅读器；
- 所有一级触控目标至少 44×44 CSS px，焦点环不被 overflow 裁切，200% zoom 下仍可操作；
- `prefers-reduced-motion` 下停用加星和面板过渡，不能影响 Canvas 跟手和状态反馈。

### 11.7 Feature flag 与回退

生产开关使用现有组织级、服务端求值、fail-closed 机制，建议命名为：

```text
teaching.classroom_input_v2
teaching.classroom_layout_v2
teaching.classroom_h5_pointer_v1
teaching.classroom_board_checkpoint_v2
```

若采用这些键，必须同步更新 `organization_feature_keys()`、`ORGANIZATION_FEATURE_KEYS`、默认 false 的 `feature_flag_versions`、数据库生成类型/初始化 manifest、管理入口和 zh/en 文案，因此本身就是 migration。开发期 query/local override 只能用于固定账号的试讲，不得作为生产放量开关，也不能从客户端把 false 覆盖成 true。

现有组织级开关不能天然表达“只给某一位真实教师/某一课次”。M0 必须证明生产环境只有一个符合条件的教师，或增加服务端求值、默认拒绝的教师/课次 rollout scope；不得把真实 UUID 写死在客户端、共享源码或证据中。

输入、布局、H5 能力和板书 checkpoint writer 独立回退；前三个开关落实 M0-A 的交互决策，第四个开关落实 M0-B 选择的存储方案 C。旧 reader 在整个双读期保留。移除旧实现以“真实教师课次证据 + 无未同步旧事件 + rollback 演练通过”为条件，不以“经过一个发布周期”单独判定。

---

## 12. 实施阶段

### 12.0 M0：合同、基线与迁移决策门

#### 前置条件

产品负责人明确把本规划选入 R1-Live-2 之外的开发线。M0 不部署生产，也不修改正在试用的 Gate 2 行为。

#### 必须冻结的决策

| 决策 | 默认建议 | 产物 |
| --- | --- | --- |
| DOM 输入所有权 | 共同舞台原生 capture；Smart 时 Canvas 纯渲染 | DOM 小原型、事件顺序记录、click-once 测试 |
| 模式/工具矩阵 | Smart 首版只自动路由 `pen`，其他工具按表保守处理 | 中英文交互合同与恢复路径 |
| renderer 能力 | 已审计清单逐页启用，未知 renderer 交互锁 | registry schema、现有 page type 盘点 |
| 名单身份 | active enrollment + stable `students.id`，账号映射可空 | `SessionRosterEntry` 合同、v1/v2 差异表 |
| 星星撤销 | v2 award/revoke set 语义 | migration/RLS/报告兼容设计 |
| 星星视觉上限 | 推荐每生 10 颗，达到上限禁止继续并反馈；产品可在 M0 改值 | 0/1/上限/历史超限 fixture 与决定记录 |
| 座次/课中变化 | 复用正式 seat position，开课冻结、差异提示后确认刷新 | 5×4/4×5 映射与 1/8/20/30 人原型 |
| 角色与 viewport | 新网格仅 control；display/viewer 独立 | 1024/1280/1366/1920 + 窄屏截图矩阵 |
| H5 | 扩展现有 runtime 并版本握手；不兼容页交互锁 | v3 message schema、威胁模型、watchdog |
| 性能/存储 | fresh production baseline；版本化 latest checkpoint、192 KiB item-boundary chunk、Worker 构建与 Canvas 像素护栏 | 可复现 fixture、命令、原始摘要、v1/v2 双读与原子写合同 |
| 灰度与回退 | 现有数据库 feature flag；M0-A 三开关加独立 checkpoint writer 开关 | migration 清单、旧 reader 删除条件 |

#### M0-A 决策记录（2026-08-24）

决策负责人为产品负责人；本记录只授权开发目标上的 M0-B 原型与基线，不授权生产部署或改变 R1-Live-2 Gate 2 行为。

| 决策 | 冻结结果 | 代码、协议或迁移影响 |
| --- | --- | --- |
| 课堂结构 | 左侧严格 4:3 主板书；右侧依次为课程信息、副板书、4×5 学生积分；全宽底栏承载高频画笔与翻页 | M4 调整教师 control 布局；display/viewer 保持独立；实际右栏宽度由 M0-B viewport 原型校准 |
| 默认输入 | Smart 只自动路由 `pen`；轻点已审计点击目标，移动后由共同舞台接管书写；其他工具按 §6.4 保守处理 | M3 建共同舞台 capture、`BoardInputSink` 与工具矩阵；未知 renderer fail closed 到交互锁 |
| renderer 能力 | 只给版本化 registry 中已审计 renderer 启用；能力未知、版本不匹配或 H5 bridge 失联时进入交互锁 | 新增 capability schema；逐页登记数独、文档、媒体、自研游戏、白板、工具覆盖页与 H5 |
| 名单身份 | active enrollment 决定名单，业务主键为稳定 `students.id`，`userId` 只作可空运行态映射 | `SessionRosterEntry`、数据库 migration、RLS、旧账号型事件/报表双读；未认领学生必须保留 |
| 星星语义 | v2 award/revoke set；撤销指向具体 `awardId`，重复、晚到和跨 transport 顺序不改变结果 | 新事件 schema、writer、RLS、聚合器、报表、导出与 v1/v2 混合 fixture |
| 星星超限 | 0–10 颗逐颗显示；第 11 颗起改为一个十星章加余星；奖励继续写入，不把视觉上限当业务上限；可访问名称包含精确总数 | M4 学生卡覆盖 0/1/10/11/13/历史高分；视觉表达与 v2 事件总数分离 |
| 21–30 人 | 复用稳定座次并在学生区内部纵向滚动；不截断、不静默重排 | M4 复用 `seatPosition`，补 1/8/20/30 人与键盘焦点原型 |
| 课中名单变化 | 开课冻结 session roster；重连发现报名或座次差异后提示，由教师确认刷新 | roster revision/摘要、差异合同与显式刷新动作；禁止课中静默重排 |
| Realtime 权威 | 数据库已验证事件收敛教师控制状态；broadcast 只承载可丢弃暂态效果，不能凭 payload 自报角色获得权威 | reducer 在版本化 schema/RLS 验证后应用；FX 去重并由 final/snapshot 收敛 |
| H5 | 扩展既有 runtime、版本握手与 watchdog；不兼容或失联页面进入交互锁 | runtime/message schema 升级与缓存失效；不新建无握手平行 bridge |
| 灰度与回退 | 输入、布局、H5 三个服务端 feature flag 独立、默认 false；旧 reader 在双读期保留 | fail-closed migration、生成类型、初始化清单、管理入口与 zh/en 文案；生产另走 preflight/postflight |

M0-A 已关闭。M0-B 的输入阈值已按产品决策冻结为首版 8 CSS px；性能与存储合同在下述基线和方案 C 决策中关闭。

#### M0-B 原型与基线施工记录（2026-08-24）

本批只产出会话内可操作原型和可复现基线，不修改课堂产品路由、数据库、事件 writer 或 feature flag。产品负责人已据此授权继续施工，M0-B 的三个验收对象冻结如下：

| 验收对象 | 已具备的行为 | 本批不证明 |
| --- | --- | --- |
| 输入所有权 | 共同舞台监听原生 Pointer Events；Smart + `pen` 下点击目标先暂存，8 CSS px 内释放保留原生 click，越阈值后转一笔并阻断 click；普通纸面立即起笔；Canvas `pointer-events:none`；可切换交互锁/书写锁 | 尚未接入 `LiveShell`；8px 是首版产品默认值，真实老师体验留到输入 flag 试用后校准 |
| 布局名单 | 严格 4:3 主板书、课程条、副板书、4 列稳定座次与全宽底栏；支持 1024×768、1280×720、1366×768、1920×1080 和 1/8/20/30 人；21–30 人只在学生区纵向滚动；未认领学生保留；超限星星按十星章加余星显示且可访问名称保留精确总数 | 尚未接正式 enrollment/seat、v2 award 或 control/display 角色分支 |
| 实机手感 | `5/8/12px` 各自独立计数；快速协议为 10/5/5，正式诊断协议为每阈值 100 次按钮轻点、50 次按钮起笔、50 次纸面短笔；只汇总次数、误判、最大移动与 `pointerType`，不保存姓名、账号或原始坐标 | 产品已选择 8px 先行；快速样本不能证明所有设备，但正式协议只在教师试用发现可重复问题时触发 |

当前可复现命令为 `pnpm classroom:m0-baseline`。fixture 固定为单块副板书 60 分钟、500 笔、50 个书写 burst/全量快照，并对 16/32/64 平均点数做敏感性测量；使用合成 ID，不含学生或教师数据。2026-08-24 开发机摘要如下，IDB 时间来自 Node `fake-indexeddb`，只能用于同代码版本相对比较：

| 平均点数/笔 | 最终 snapshot payload | 50 个全量 snapshot 累计 JSON | 恢复解析 p95（两次开发机范围） | 结论范围 |
| ---: | ---: | ---: | ---: | --- |
| 15.98 | 355.96 KiB | 8.91 MiB | 47.763–102.718 ms | 低点密度下低于 768 KiB warning 水位 |
| 31.95 | 671.27 KiB | 16.79 MiB | 92.742–94.956 ms | 仅余 96.73 KiB warning 余量；历史全量快照下载成本已经不可忽略 |
| 63.90 | 1300.57 KiB | 32.53 MiB | 201.110–215.144 ms | 超过数据库 1 MiB hard limit，现有 writer 会失败 |

因此初始恢复不能继续下载每块板的全部历史全量 snapshot；M2 固定读取“每块板最新 checkpoint + 其后 tail”，其他业务事件继续分页读取。仅做点重采样不能保证高点密度课堂守住 1 MiB 上限，不能靠截断 payload 或捕获异常后丢事件。

fresh production build 于同日通过；`pnpm bundle:report --json` 的课堂 live 路由为 28 chunks、480,704 gzip bytes。该数字是 M2–M5 改造前基线，不是性能通过结论。按推荐布局和 `effectiveDpr=1.5` 的几何投影，1024×768、1280×720、1366×768、1920×1080 的 base+draft 总 backing pixels 均低于 24 MP 起始护栏。M2 首版据此冻结 `effectiveDpr≤1.5`、单个 Canvas backing pixels `≤8 MP`、课堂所有 Canvas 合计 `≤24 MP`；三条同时满足，低端设备仍以真实老师手感复核。

##### 快速手感采样 #1（2026-08-24）

产品负责人通过 M0-B 校准原型提交第一轮无 PII 汇总：快速协议 10 次按钮轻点、5 次按钮起笔、5 次普通纸面短笔；视口宽度档 `≤1024`、DPR 2，全部 Pointer Event 上报为 `mouse`。阈值始终按 CSS px 计算；DPR 2 只说明 5/8/12 CSS px 分别对应 10/16/24 backing pixels，不改变分类合同。

| 候选阈值 | 轻点误转书写 | 按钮起笔误判为点击 | 普通纸面无效短笔 | 路由误判率（仅前两类） | 本轮判断 |
| ---: | ---: | ---: | ---: | ---: | --- |
| 5px | 9/10（90%） | 1/5（20%） | 0/5 | 10/15（66.7%） | 过于敏感；不能作为默认值 |
| 8px | 0/10 | 0/5 | 0/5 | 0/15 | 本轮唯一暂定候选 |
| 12px | 1/10（10%） | 2/5（40%） | 1/5 | 3/15（20%） | 有明显短起笔判定延迟/漏判风险 |

普通纸面从 pointerdown 立即进入 ink，表中的无效短笔只表示本次最大移动不足 2px，不属于阈值路由误判。按钮起笔跨阈值后会回放暂存起点，因此“起笔损失”在当前原型中表现为出墨延迟，而不是把前 5/8/12px 几何路径永久截掉。

样本仍有明显限制：5px 轻点的平均/最大移动为 25.55/43.09px，而同一设备 8px 轮次只有 0.21/2.13px，说明首轮操作理解、练习顺序或手势执行影响了结果；汇总也无法区分实体鼠标与被设备误报为 `mouse` 的触控笔，并且没有可确认的 `pen`/`touch` 样本。产品负责人接受这些不确定性并决定先冻结 **8 CSS px v1**，正式 100/50/50 从 M0 退出条件移到教师试用后的问题诊断。输入阈值 Gate 据此关闭；若老师课中反复出现“轻点变墨迹”或“短起笔不出墨”，再对问题设备复测并通过独立输入 flag 调整，不回写历史笔迹或事件。

##### 存储方案 C 决策（2026-08-24）

产品负责人在 A“继续追加全量快照”、B“只做重采样”和 C“版本化 checkpoint + 最新覆盖 + 分块兜底”之间选择 C，并授权继续 M2。冻结合同如下：

1. 主/副板书当前状态从 append-only `session_events` 分离；其他考勤、积分、举手等业务事件仍保持 append-only，不能借此改写审计历史；
2. 服务端按 `session + board/page key` 只暴露最新已提交 checkpoint；manifest 和其 chunk 在同一数据库事务中按递增版本提交，读者不会看到半版本；
3. item 边界分块上限为 192 KiB，单个 item 超限时先在 Worker 做自适应重采样；仍超限则显示可恢复错误，禁止静默截断、清空或假装保存成功；
4. checkpoint 序列化、重采样和分块在 Worker 中完成；同一块板只保留最新待处理任务，过期结果不得覆盖新版本；
5. IndexedDB outbox 以 `session + board/page key` 覆盖最新待同步 checkpoint，只在对应版本服务端确认后删除；恢复只装载最新 checkpoint，不回放 50 份历史全量快照；
6. 新 reader 先读 v2 checkpoint，再对没有 v2 的旧课堂回退到最新 v1 `board_snapshot`；旧 writer/reader 在独立 `teaching.classroom_board_checkpoint_v2` 开关和双读期内保留；
7. 768 KiB 仍是未分块 payload warning 水位，192 KiB 是 chunk hard budget；两者均按 UTF-8 JSON 内容测量，不以 JavaScript 字符数代替；
8. Worker、最新覆盖、原子版本、显式失败、v1/v2 双读和三条 Canvas 像素护栏都是方案 C 的组成部分，不作为低端设备上的可选优化。

布局名单原型按既定 4:3 主板书、右侧信息/副板书/4 列稳定座次、21–30 人学生区内部滚动冻结；后续真实上课反馈可通过独立布局开关调整，不回开 M0。至此 M0-B 和整个 M0 关闭；M2 只实现白板性能与恢复基础，不提前施工 M3 输入路由或 M4 正式名单/布局。

#### 退出条件

- 所有决策有负责人、日期和代码/迁移影响，不留“实现时再看”；
- 原生数独按钮上的 tap→click 与 move→ink 在 DOM 原型中成立，且不通过覆盖层命中猜测或人工 `.click()`；
- 60 分钟板书 fixture 已测得 payload/IDB/恢复基线，方案 C 已冻结 latest checkpoint、Worker 与分块合同；
- 未认领学生、旧星星事件、21–30 人、H5 不兼容页、offline tail loss 均有兼容路径；
- M1–M5 拆成可独立验收、独立提交和独立回退的增量。

M0 已关闭；M2 于 2026-08-24 完成开发端人工验收并解除对 M3a 的阻塞。M3a 只施工原生 renderer 输入路由；M3b/M4/M5 仍按里程碑顺序等待各自前置和人工验收，不得提前引入 H5 bridge、正式名单或星星 writer。

### 12.1 M1：确定性逻辑修正

#### 内容

1. 删除独立画笔按钮；
2. 三色按钮直接作为三支笔；
3. 颜色激活状态改为 `tool === "pen" && color === token`；
4. 修正数独切换数字语义；
5. 补充单元测试。

#### 主要文件

- `Toolbar.tsx`
- `sudoku/state.ts`
- `tests/sudoku-teaching-board.test.ts`
- 工具栏相关测试

#### 人工验收

- 点击黑、红、蓝任一颜色立即进入书写；
- 切到橡皮后颜色不再显示为当前工具；
- 再点原颜色可立即恢复书写；
- 选择 `5` 后连续填多个格；
- 点击 `7` 时旧格不变化、不报错；
- 下一格使用 `7`；
- 先格后数和候选模式继续正常。

---

### 12.2 M2：白板性能基础

#### 内容

M2-A 先交付书写渲染基础：

1. 将 Canvas 内部指针处理抽成可复用 `BoardInputSink`，保持默认内部宿主供独立白板使用；
2. coalesced points 按帧批处理、排空与在线重采样；
3. 当前笔迹用经过视觉差异验证的 tail-window 增量预览；
4. store mutation metadata 与追加型历史内容增量绘制；
5. `renderProfile="classroom"` 的动态 DPR/像素总预算；
6. 远端光标与实时进度降频、chunk 序号/去重和 final 收敛；
7. 页面切换/失焦/卸载的输入 drain；
8. 无 PII 的开发调试计数与性能 fixture。

M2-B 再交付方案 C 的恢复基础：

1. 新增版本化 checkpoint manifest/chunk migration、RLS 与原子保存 RPC，chunk UTF-8 JSON 不超过 192 KiB；
2. Worker 执行自适应重采样、序列化和 item-boundary 分块，同板只提交最新任务；
3. 每次最终本地白板操作立即写入 IndexedDB 增量日志；checkpoint outbox 仍以 `session + board/page key` 最新覆盖，并在同一事务中压实已纳入 checkpoint 的日志前缀，以版本确认删除服务端已接收的 checkpoint；
4. 首屏读取每块板最新 v2 checkpoint；没有 v2 时回退最新 v1 `board_snapshot`，其他业务事件独立分页；
5. 新 writer 由 `teaching.classroom_board_checkpoint_v2` 默认 false 开关控制，关闭后旧课堂仍可恢复，不能产生 reader 不认识的数据。

#### 主要文件

- `CanvasSurface.tsx`
- `strokes.ts`
- `store.ts`
- `bus.ts`、`useClassBoard.ts` 与实时笔迹传输相关文件
- checkpoint Worker、IndexedDB outbox、课堂初始读取与对应数据库 migration/RPC

#### 自动验证

- 单次 `pointermove` 不触发 React state 更新；
- 同一动画帧多次移动只产生一次绘制批次；
- 追加一条笔迹不触发完整历史重绘；
- 撤销、擦除、清空仍触发正确完整重绘；
- DPR 上限只影响渲染像素，不影响归一化坐标和命中；
- `pointerup/lostpointercapture/page-change` 排空最后一批点，错误 pointerId 不结束笔迹；
- 同一 progress chunk 经多个 transport 到达只追加一次，final 后晚到 chunk 不复活草稿；
- 旧白板 item 和 legacy progress 仍可读取；
- 独立白板未显式使用 classroom profile 时行为不变；
- §9.10 与 §9.11 的固定 fixture 达到量化 Gate。

#### 人工验收

下一次只交付两个可见、可操作对象，不用机器检查清单代替：

1. **真实书写手感**：在同一课堂页连续写短笔、长笔、急转弯，并在主/副板书切换；人工判断起止点、断线、粗细、擦除和撤销是否符合预期；
2. **500 笔后恢复**：一键装入 500 笔无 PII fixture，继续书写观察跟手感，然后刷新/重开课堂；页面显示恢复来源、checkpoint 版本、chunk 数和精确笔数，人工确认最后一笔存在且没有重复或清空。

2026-08-24 首轮恢复验收确认副板书正常，但发现主板书验收状态被错误绑定到副板书，且清空/重写后的 debounce 窗口仍显示旧 checkpoint 可刷新；较早启动的 Worker 结果也缺少 revision 入库前围栏。修正当前板书状态、Worker revision 围栏和显式“刷新恢复”等待后，页面按钮路径可以恢复，但随后实机复测确认浏览器直接刷新仍会丢失 2.5 秒 debounce 窗口内的最后一笔，因此该修正不计为 M2 恢复通过。

直接刷新缺口改用两层本机持久化：每次 `commit/replace/erase/clear/restore` 在最终操作产生时立即追加轻量 IndexedDB 日志，Worker 继续延后构建完整 checkpoint；完整 checkpoint 只压实自己覆盖到的日志序号，更晚操作必须保留。开发端定向合同已覆盖单笔恢复、清空后重写和 checkpoint 合并边界；浏览器已复现“主板书新增一笔后 80 ms 直接刷新，刷新前后均为 3 笔”，这只证明当前开发实现可供验收，不关闭 M2。下一次人工验收只检查一个对象：在主板书写一笔后立即使用浏览器刷新/F5，不点击页面内“刷新恢复”；刷新后该笔仍在，状态显示“本机增量已保存”和主板书精确笔数。

2026-08-24 产品负责人完成上述单对象验收并确认通过，主板书 debounce 窗口内直接刷新丢最后一笔的 blocker 关闭。后续不得把该单笔刷新路径机械重复列为人工验收项；M2 仍只等待其余既定的真实书写手感与 500 笔长板书恢复结论，未据此进入 M3。

同日，产品负责人继续确认真实书写手感与 500 笔长板书恢复两项均验收通过。M2 至此关闭：结论范围是开发环境白板渲染、长板书本机恢复和上述人工手感，不等同生产部署或真实课堂长期指标。下一施工项为 M3a 原生 renderer 的 Smart/交互锁/书写锁；M3b H5 bridge 继续等待 M3a 人工验收。

---

### 12.3 M3：智能输入路由（M3a 施工中）

#### 内容

1. 新增纯状态机、共同舞台 capture 与 `useClassroomPointerRouter`；
2. Smart 模式让 Canvas 退为渲染层，通过 `BoardInputSink` 接管移动后的手势；
3. 建立 renderer capability registry，只给已审计数独/文档/媒体/自研游戏逐项启用；
4. 增加持续可见的交互锁、书写锁与一键恢复智能；
5. 固化精确 pointer lifecycle、click token、resize/page change 策略；
6. M3a 先交付 native renderer；M3b 扩展现有 H5 runtime、握手、批量 bridge、watchdog 和未接桥兜底。

#### 主要文件

- 新增输入路由模块；
- `CanvasSurface.tsx`
- `LivePanels.tsx`
- `SudokuBoard.tsx`
- `DocStage.tsx`、`AixuexiStage.tsx`、`h5-shim.ts`、`resolve.ts`
- 相关消息文案

#### 自动验证

对同一状态机分别输入 `pointerType=pen/touch/mouse`，结果应一致：

- 点击型目标轻点：不产生笔迹，执行一次点击；
- 点击型目标移动超过阈值：产生一条笔迹，不执行点击；
- 普通区域按下：立即书写；
- 拖拽型目标：保持原生拖拽；
- `pointercancel`：不留下悬挂状态；
- `lostpointercapture`、`blur`、`visibilitychange`、resize 与切页按策略结束；
- 多指输入：只保留一个活动书写指针；
- 交互锁和书写锁覆盖智能判断；
- 点击目标若在 `pointerdown` 已有业务副作用，registry 拒绝中途接管；
- Playwright DOM harness 验证真实 target、原生 click 恰好一次、接管后 click 为零；
- H5 验证 source/token/schema/rate limit、坐标变换、嵌套 relay、reload 与失联清理。

#### 人工验收

- 保持红笔状态，轻点数字 `5`；
- 不切工具，轻点目标格；
- 继续拖动画圈；
- 在按钮上起笔并拖动时形成笔迹且不误触按钮；
- 鼠标、触摸和笔输入均可完成同一流程；
- 使用锁定模式时行为明确、可恢复。

#### M3a 开发交付记录（2026-08-24）

原生输入 v1 已接入开发端共同舞台，生产组织开关 `teaching.classroom_input_v2` 仍默认 `false`。当前 capability registry 只审计 `board`、`image` 与原生 `sudoku`：数独按钮/普通单元格输出 `click`，框选单元格模式动态输出 `drag`；文档、视频、其他游戏、课堂工具覆盖层与 H5 尚未审计，统一进入交互保护，不据此宣称 M3a/M3b 完成。

试讲页已用无姓名、无账号、无原始坐标上报的确定性数独 fixture 替换 M2 验收板，一级界面持续显示 `Smart / 交互锁 / 书写锁`，并只列四个本轮人工验收对象：轻点只触发题面、按钮上拖动转为起点完整的笔迹且 click 为零、交互锁不出墨、书写锁不点击题面。机器检查已覆盖 8 CSS px 边界、pointer ID/类型无关性、取消与未知 renderer fail-closed；开发浏览器已确认 Smart 轻点、交互锁和书写锁的可见行为。按钮上真实拖动接管与主观出墨手感留给产品负责人本轮人工验收，未通过前不进入 M3b。

---

### 12.4 M4：正式名单、积分语义与教师布局

#### 内容

1. M4a 先交付 `SessionRosterEntry`、stable `students.id`、座次复用和星星 v2/RLS/聚合兼容 migration；
2. 旧星星 reader、报表、家长/学生可见范围、导出和离线 outbox 通过双版本 fixture；
3. M4b 仅对 `role="control"` 移除全宽顶部标题栏并新建右上课程信息区；
4. 右列改为信息区 + 副板书 + 正式座次纵向 4×5 积分网格；
5. 底部控制栏横跨页面，保留学情检查、点名、工具、发题、active board 与 pending 状态；
6. 绘图工具贴近主板书右下角，翻页固定最右，结束课程固定右上；
7. 主板书按父容器真实尺寸进行 4:3 fit；
8. `display/viewer` 保持无教师控制栏并按自己的宽屏/小屏合同验收；
9. 21–30 人、长英文、最高星数、空座、无账号与错误状态完成降级布局；
10. Server Page 保留鉴权/角色/初始数据，补形状一致 loading/Suspense，消除无依赖 waterfall 并保持 renderer 懒加载。

#### 主要文件

- `LiveShell.tsx`
- `LivePanels.tsx`
- 新的控制栏、信息栏、积分网格组件
- `StudentCard` 及星星展示
- 正式名单/座次 loader、事件聚合、RLS 与 migration
- live route 的 Server Page/`loading.tsx` 或 Suspense 数据壳
- 课堂布局相关测试

#### 人工验收

在 1024×768、1280×800、1366×768、1920×1080 与冻结的真实设备下：

- 主板书、副板书、20 人名单同时完整可见；
- 20 人无需滚动；
- 每人星星数量可以直接按长度比较；
- 副板书获得连续书写空间；
- 课程标题与状态不压缩主板书高度；
- 三色笔、擦除、撤销靠近主板书右下角；
- 上一页、下一页位于页面最右侧；
- 结束课程位于右上角；
- 所有高频触控目标保持至少 44px；
- Windows/browser 多档缩放、长 zh/en、safe area、pending/error 和 200% zoom 下无高风险控件遮挡；
- 1、8、20 人按正式座次稳定显示，21–30 人降级可定位，未认领学生不消失；
- 展示端和学生端没有教师输入模式、星星写按钮或结束课程按钮。
- loading/hydration 不闪现越权控件，首包与首次可操作指标不超过 §9.10 预算。

---

### 12.5 M5：课堂集成与发布

#### 回归矩阵

| 维度 | 覆盖项 |
| --- | --- |
| 运行模式 | 试讲、正式课堂、离线演练 |
| 角色 | 教师控制端、学生端、展示端 |
| 页面 | 数独普通/拖选模式、图片、视频及原生控件、文档点击步进、自研拖拽游戏、白板页、工具覆盖页、兼容/不兼容 H5 |
| 输入 | 鼠标、`pen`、`touch`、设备把笔上报为 `mouse` 的模拟 |
| 学生数 | 0、1、8、20、21、30；含空座、长名、未认领账号、最高星数 |
| 白板 | 空板、长笔迹、500+ 笔迹、擦除、撤销、清空 |
| 屏幕 | 1024×768、1280×800、1366×768、1920×1080、200% zoom、iPad Safari、Android Chrome、课堂一体机 |
| 同步 | 单窗口、双窗口、多 transport 重复/乱序、断线恢复、离线补同步、IDB/配额/快照超限 |
| 生命周期 | 切页、结课、刷新、失焦、崩溃恢复、H5 reload、orientation change |
| 语言/无障碍 | zh/en 长文案、键盘、屏幕阅读器、reduced motion、44px 目标 |

#### 发布顺序

1. fresh build 完成开发矩阵、迁移重建、RLS、离线与量化性能 Gate；
2. 试讲对固定开发账号启用 input，layout 仍旧版；教师完成一节 60 分钟混合课件试讲；
3. 单独启用 layout，重复角色/viewport/名单验收；
4. H5 pointer 只对 bridge 握手成功的 package 启用；
5. 产品初验后生成独立、可回退 commit；生产前按 `docs/plan/04-roadmap.md` 当前 Gate 做 preflight，不把开发通过写成生产通过；
6. 生产只对获批真实教师开启，完成 postflight 和至少一节真实课证据；
7. 任一开关可独立回退，旧 reader 持续处理已存在 v1/outbox；
8. 满足 §11.7 删除条件后才移除旧实现。

#### 停止放量与回退条件

出现任一项即停止继续放量并关闭对应 writer/UI 开关：可复现的误点击/漏笔、最后一笔或事件丢失、学生错位/跨账号、未认领学生消失、control 权限泄漏、快照超限或本机持久化失败、H5 bridge 绕过安全降级、最低设备超过性能硬线。回退后先验证新产生的 v2 事件/outbox 仍能读取和补同步，再恢复课堂；不能回退到不认识 v2 数据的旧 bundle。

未知 H5 正确进入交互锁、网络断开但本地安全保存、21–30 人按既定方案滚动属于已设计降级，不单独触发回退。每次停止/恢复记录开关版本、课次范围、无 PII 摘要和负责人。

建议将输入升级与布局升级分成两个独立开关，便于定位问题和回退：

```text
teaching.classroom_input_v2
teaching.classroom_layout_v2
teaching.classroom_h5_pointer_v1
```

这些不是可直接使用的自由字符串；启用前完成 §11.7 的 fail-closed migration 与初始化清单。

---

## 13. 自动测试清单

### 数独

- 连续数字印章；
- 已填格只保留视觉焦点；
- 切换数字不触发错误；
- 空格先选后输入；
- 候选数连续输入；
- 错误答案仍被拒绝；
- 错误盖章后候选数与当前印章保持；随后选数只切换印章，不向旧失败格重试；
- 镜像恢复兼容。

### 工具栏

- 快捷颜色点击后工具为 `pen`；
- 非 `pen` 状态不显示颜色激活；
- 不再渲染独立铅笔按钮；
- 课堂 variant 只显示高频工具；
- 完整 variant 保持其他白板能力。

### 输入路由

- 三种 `pointerType` 使用同一行为规则；
- 纯 reducer 覆盖 idle/pending/native/inking 的合法与非法转换；
- Playwright DOM fixture 覆盖真实 target、点击与书写阈值；
- 起笔点回填；
- 4:3 舞台内 16:9 content rect、底部板书带和 CSS transform 的坐标映射；
- 原生单次点击恰好一次，接管后点击为零，不调用人工 `.click()`；
- 拖拽目标不被抢占；
- 动态数独拖选能力不会沿用普通填数分类；
- `pointercancel`、`lostpointercapture`、失焦、隐藏、resize、切页、卸载；
- unrelated pointerup 不结束当前笔迹；
- 多指保护；
- hover、右键、笔杆键、笔尾与手掌先/后接触；
- 模式/工具/active board 正交与两种锁定模式；
- Canvas/SVG 对象/尺规/课件/ToolOverlay 的 z-layer 所有权；
- 未登记 renderer fail closed；
- H5 handshake、token/source/schema/rate、坐标变换、批处理、nested frame、reload/watchdog，以及 v2 离线 cache 到 v3 的失效/降级；
- 无每移动 DOM 命中查询。

### Canvas

- coalesced points；
- 无 coalesced API 的 fallback、去重、顺序和尾队列排空；
- 在线重采样保留首尾、锐角与最大时间间隔；
- 每帧一次绘制；
- tail-window 增量预览与 final reconciliation 视觉差异；
- mutation metadata 驱动追加渲染；
- 结构变化完整重绘；
- classroom render profile、动态 DPR、单 Canvas/总 pixel budget 与 resize 释放；
- 归一化坐标不变；
- 远端进度批处理、重复/乱序 chunk 去重、final 后清理；
- 主副板书笔宽一致。

### 布局

- 正式座次在 5×4/4×5 间保持同一 position，含空座；
- 0/1/8/20 人无丢失，21/30 人降级稳定，未认领学生可见；
- 星星不数字化；
- 星星 0/1/视觉上限/历史超限与显式撤销；
- 控制栏分区；
- 右上信息区；
- 主板书 4:3；
- 1024×768、1280×800、1366×768、1920×1080 与浏览器缩放策略；
- control/display/viewer DOM 与权限隔离；
- 长 zh/en、safe area、pending/error/empty/loading；
- 触控目标尺寸、焦点可见和 200% zoom。

### 数据、权限与离线

- v1 `user_id` 星星事件与 v2 `students.id + awardId` 混合回放；
- v2 award/revoke 在重复、反序、离线晚到时结果相同；
- 未在课次 active roster 的 student target 被拒绝，学生不能写教师事件；
- 学生/家长/管理员报告、RLS 和导出继续读取允许范围内的 v1/v2；
- feature flag 未知键、缺行、未生效与 RPC 失败全部为 false；
- IDB 事务/配额失败、1 MiB 前置 guard、flush 重试与 pending 状态；
- 切页/结课 drain 后刷新，最后一笔、game state、星星、页码仍存在；
- offline drill 不触发 T2、正式 start/end 或服务端业务写，退出后的补同步可重复且幂等。

### 性能与可访问性

- 固定 production build fixture 输出 §9.10/§9.11 的机器可比指标与设备信息；
- React Profiler 证明星星不重渲染 Stage、笔迹不重渲染 roster；
- 60 分钟 fixture 的 payload、IDB、回放、内存和 input latency 达标；
- 加星/撤销有键盘等价、长按移动取消、焦点稳定和简短 live announcement；
- reduced motion、屏幕阅读器名称和所有一级 44×44 CSS px 目标通过。

---

## 14. 最终人工验收脚本

使用固定开发账号和一节包含数独普通/拖选、白板、文档点击步进、视频、自研拖拽与兼容/不兼容 H5 的试讲课次；不得为本验收创建一次性账号。

### 14.1 教师核心链路

1. 在 20 人（含空座和一个未认领账号学生）fixture 进入试讲，确认主板书、副板书和正式座次积分网格同时可见，结束课程在右上，翻页在底部最右。
2. 点击红笔，在数独题面圈出一个宫；不切工具，轻点数字 `5` 和多个空格连续填 `5`。
3. 点击 `7`，确认旧格不变化、不报错；在下一空格填 `7`。
4. 在数字按钮上按下后拖出一笔，确认形成一条起点完整的笔迹且按钮没有 click；重复短轻点，确认每次恰好一次 click。
5. 切到数独拖选模式，确认格子拖拽保持原生语义，不被 Smart 抢走。
6. 点击蓝笔继续写，切到橡皮并擦除，再点击蓝笔恢复；切主/副板书后确认一级界面显示正确目标，第一笔和撤销都作用于当前目标。
7. 用点击、键盘和长按为学生加星/撤销；确认未认领学生可操作，达到视觉上限时按 M0 决策反馈，长按移动离开不误撤销。
8. 翻页，确认主板书按页隔离、副板书持续；学情检查、点名、发题、工具覆盖和 pending 状态仍可到达。
9. 在文档、视频控件和拖拽游戏上验证 registry 行为；未知 renderer 自动进入安全交互态并能明确切到书写锁。
10. 在兼容 H5 上完成 tap、takeover ink 与 reload；在不兼容 H5 上确认不会坐标猜测或误点击。

### 14.2 恢复、角色与容量

1. 书写中分别触发 `pointercancel`、窗口失焦、旋转/resize 和切页，确认无悬挂指针、跨页笔迹或尺寸跳点。
2. 断网后完成最后一笔、数独输入和星星，刷新并恢复；确认 UI 区分“本机已保存待同步”和“本机保存失败”。
3. 在线恢复后让多个 transport 重复/乱序投递，确认远端草稿不重复、final 后不复活、v2 星星结果稳定。
4. 在笔迹刚结束时结课，确认 drain 完成后才离开；模拟 IDB/快照/Server Action 失败，确认停留当前页、数据不丢并可重试。
5. 用 control、display、viewer 三种角色双/三窗口验证：只有 control 有教师路由、积分写和结课；其他端看到正确课件、主/副板书与允许的积分状态。
6. 使用 1、8、20、21、30 人 fixture；确认 20 人无滚动，21–30 人降级后座次和焦点稳定，无学生被截断。
7. 重连时改变报名/座次，确认课堂提示差异而不静默重排，教师确认后才采用新 roster revision。

### 14.3 设备与长课

1. 在 1024×768、1280×800、1366×768、1920×1080 CSS viewport、Windows/browser 缩放和 200% zoom 下走查 zh/en 长标题、safe area 与所有高风险控件。
2. 在登记的一体机上用触控笔、手指、鼠标及“笔上报为 mouse”设备完成 §8.10 的误触样本；iPad Safari 与 Android Chrome 完成角色/窄屏走查。
3. 完成一轮 60 分钟试讲并累积 500+ 笔迹；确认 §9.10/§9.11 指标、快照水位、内存和恢复通过，不能只记录“手感尚可”。
4. 产品负责人完成教师核心链路初验并记录未覆盖项；此时状态是“用户已初验”，仍不等同生产 Gate 完成。

---

## 15. 完成标准

本轮升级完成时应满足：

- M0 的输入所有权、能力 registry、名单身份、星星上限/撤销、H5、性能预算、migration 和回退决策全部关闭；
- 教师无需为了点击已审计数独按钮而切换鼠标；原生 tap 恰好一次 click，移动接管形成一笔且 click 为零；
- 设备把触控笔识别为 `pen`、`touch` 或 `mouse` 时，智能输入规则仍成立；未知 renderer fail closed 且可恢复；
- 书写过程采用逐帧批处理、重采样、可验证的增量预览和 mutation 驱动的历史增量绘制；
- §9.10 输入延迟、重绘、React 隔离、长课与像素预算全部通过；
- §9.11 快照余量、IDB、回放和显式 drain 全部通过，最后一笔/状态在切页和结课后可恢复；
- 数独切换数字不再误改上一格；
- 三色按钮直接代表三支笔；
- Smart/交互锁/书写锁与 pen/eraser/shape/select、主/副板目标互不覆盖，界面和实际状态一致；
- 教师控制端在冻结的最小横屏以上保持 4:3 主板书、副板书和 20 人积分区持续同屏；小屏按既有工作区合同降级；
- 积分名单覆盖所有 active enrollment，使用稳定 `students.id` 与正式座次；20 人无滚动，21–30 人不截断；
- 学生积分在冻结上限内以实际星星数量呈现，撤销具有幂等 v2 语义和键盘等价动作；
- 高频绘图工具位于主板书右下角附近；
- 上一页、下一页位于页面最右侧；
- 结束课程位于右上角；
- control/display/viewer、试讲/正式课堂/离线演练、zh/en 与目标浏览器/设备通过各自回归；
- 旧课堂事件、旧白板数据、旧 outbox 和数独镜像仍可读取；任何 v2 migration 通过重建、RLS、双读和 rollback 演练；
- Realtime 瞬时消息校验 actor/role/type，progress 多 transport 去重，未知/超限 payload 不进入 reducer；
- 三个生产 feature flag 默认 false、服务端求值并可独立回退；
- 机器检查通过、开发可验收、产品初验、生产教师验收和正式 Gate 分别登记；只有真实设备和真实教师课堂证据满足放量条件后才扩大范围。
