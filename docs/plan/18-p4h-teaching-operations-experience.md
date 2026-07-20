# Mathin 整体规划 · 18 P4H 教学运营体验重构

> **主题**：从产品使用者视角重做课程、班级、课次与多岗位工作流。
>
> **提出日期**：2026-07-19；**课程域重构修订**：2026-07-20（P6-8 完成后，按真实页面复盘）。
>
> **执行对象**：本文刻意写成低歧义实施规格，可交给低智能 Agent 逐项执行。
>
> **前置阅读（每个执行 Agent 都必须读）**：`00-overview.md`、`01-design-system.md`、`04-roadmap.md`、本文，以及当前任务直接涉及的 `10-school-backend.md`、`11-p4c-dashboard-refit.md`、`12-p4d-student-lifecycle.md` 或 `16-p6-courseware-platform.md`。禁止默认读取整个 `docs/plan/`。
>
> **与 P6 的关系**：P6-8 已完成，2026-07-20 复盘时工作树为 clean。P4H 现在接管 `courses/courseware/lectures` 的产品信息架构；P6 的 DocStage、页 revision、讲 release、资源替换与双轨数据模型保持不变。P4H-0～6 应在 P6-9 的最终浏览验收前完成；P6-9 的全量导入可在 P4H-3 schema 验收后执行，但“865 讲可浏览”的最终验收必须使用 P4H-5/6 的新入口。
>
> **与 P4I 的关系（2026-07-20 追记）**：P4H 已全部 0→11 完成，随后在同日试用复盘中被 `19-p4i-final.md`（P4I）修订。**本文与 doc 19 冲突处一律以 doc 19 为准**，执行 agent 不再按本文 §3 路由合同、导航、员工首页或多岗位视角实现新页面。具体被取代的部分：
>
> - §3 路由合同（`/dashboard/courses`、`/dashboard/courseware`、`/dashboard/classes/[id]?session=`）→ doc 19 §20 新路由（`/dashboard/curriculum/products`、`/dashboard/curriculum/lectures/[id]`、`/dashboard/classes/[classroomId]` 与独立 `/dashboard/sessions/[sessionId]`）；
> - “制作工作台”/`courseware` 命名与左侧平级入口 → doc 19 §4 的“课程研发”分组（研发任务/课程产品/适配校对/公共资源）；
> - 讲次详情与预览的拦截路由承载页 → doc 19 §9 讲次工作区（唯一 canonical URL + 覆盖层）；
> - 课次入口从班级详情内嵌抽屉（§3、§8.3）→ doc 19 §14 独立课次工作区，快速抽屉收缩为仅排课操作（doc 19 §15.2）；
> - 员工首页磁贴池（§9 多岗位工作台）→ doc 19 §6 今日工作（现在/我的工作/今天的安排/需要关注，不可拖拽隐藏）；
> - 多岗位“视角切换”心智 → doc 19 §2.5～2.7 的工作集合筛选 + 对象上下文镜头（不是角色模式）。
>
> 继续保留、doc 19 直接复用、不重做的部分：§5 生命周期状态机（版本/讲次/班级/课次状态与转换 RPC）、§6 capability 模型（权限 = 岗位权限 × 对象关系 × 当前状态）、`course_staff_assignments`/assignment 表结构与继承规则、§2.3 安全不变量（禁止物理级联删除、学辅不进 `classroom_members`、403≠404 等）、P4H-0～10 已落地的数据库 schema 与 RPC。

---

## 0. 执行纪律（不得自行解释）

1. **一条任务一个提交**：P4H-0～P4H-11 每条独立提交，提交信息包含任务号。
2. **严格串行**：除 P4H-0 外，不得跳过前置任务。不得把多个任务合并成一个“大重构”提交。
3. **先保护现有改动**：开始前运行 `git status --short` 并把输出贴进任务记录。所有开始任务前已存在的修改和未跟踪文件都视为用户/P6 Agent 所有；P4H Agent 不得覆盖、回滚、移动或顺手格式化。若当前任务会修改其中任一文件，立即停止并要求先提交、隔离或明确交接。
4. **禁止物理级联删除**：业务 UI 和普通 Server Action 不得对 `course_families`、`courses`、`course_lectures`、`classrooms`、`class_sessions` 执行 `.delete()`。
5. **禁止权限偷渡**：主管、教研、学辅不能为了“能打开页面”被写进 `classroom_members`。该表继续只表达真实课堂成员。
6. **禁止把 403 伪装成 404**：已知对象存在但无操作权时显示权限解释或跳到管理视图；只有确实不存在或完全不可披露时用 `notFound()`。
7. **服务端边界**：列表、详情、权限和取数默认 Server Component；搜索选择器、抽屉、筛选交互是叶子 Client Component。
8. **Server Action 校验**：所有新 Action 入参必须走 zod；失败返回 `{ok:false,code:"VALIDATION"}`；权限必须服务端复核。
9. **UI 组件**：使用现有 shadcn `Button/Input/Select/Table/Dialog/AlertDialog/Command/Popover/Badge/Tabs/Tooltip`。业务代码不得新增原生 `input/select/table`，不得使用 `window.confirm()`。
10. **国际化**：所有 UI 文案同步写入 `messages/zh.json` 和 `messages/en.json`；执行 `pnpm messages:check`。
11. **数据库**：迁移只做前向追加和安全收紧；上线前用开发库重建/断言验证。不得手工改线上表后不留 migration。
12. **完成门槛**：每条任务至少运行目标测试、`pnpm lint`、`pnpm typecheck`；涉及路由/构建的任务再运行 `pnpm build`。

---

## 1. 已核实的现状与根因

| 编号 | 现状 | 代码证据 | 后果 |
| --- | --- | --- | --- |
| F1 | 建班页把第一门课程自动选中，普通 Select 一次加载全部课程 | `ClassBuildWizard.tsx` | 72+ 课程不可快速寻找，容易误选 |
| F2 | 后台班级详情只软删未开始课次；旧教室入口仍物理删除任意课次 | `school/actions/classes.ts`、`classroom/actions.ts`、`SessionActions.tsx` | 同一对象两套删除规则，存在历史事件级联丢失风险 |
| F3 | 主管在后台可读课次，但课次名链接到课堂成员专属路由 | `SessionListPanel.tsx` → `/classroom/.../session/...` | RLS 返回空后落入怪异 404 |
| F4 | 课程按原规划不提供删除，只能 disabled；页面不解释引用和影响 | `actions/courses.ts`、`CourseCrud.tsx` | 用户不知道应该“下架”而非“删除” |
| F5 | 班级有 `archived_at` 和 archive Action，但缺少完整 UI、筛选和恢复路径 | `classes.ts`、`actions/classes.ts` | 归档数据与正常班混在一起，测试班难清理 |
| F6 | 全局 404 固定给“去看图鉴” | `app/[locale]/not-found.tsx` | 后台走失时出口不符合层级直觉 |
| F7 | 权限并集被误当作对象操作权 | `getMyPerms` + 后台/课堂两套路由 | “能看全部”被错误理解为“能上这节课” |
| F8 | 教师、教研、学辅、主管共享同一张数据库式列表，默认内容不随任务变化 | `courses/page.tsx`、`classes/page.tsx` | 用户第一屏看不到自己的下一步工作 |
| F9 | 现有 72 行 `courses` 被当成 72 门顶层课程展示；实际全部是 E 系列的“年级 × 课程季节 × 班型”版本 | `teaching-plans.json`：72 行标题前缀均为 `E系列数学` | 用户看不到稳定的大课程产品，只看到重复 SKU |
| F10 | 课程页同时管理 `school_terms`，出现“新建学期” | `courses/page.tsx` → `TermManager` | 运营学年学期与课程春/暑/秋/寒季节混为一谈 |
| F11 | 有三套重复目录：课程详情讲次表、课件中台课程表、课件中台讲次表 | `/dashboard/courses/[id]`、`/dashboard/courseware`、`/dashboard/courseware/[courseId]` | 同一对象从不同入口看到不同页面与返回链路 |
| F12 | 浏览态直接暴露课程标题输入、逐讲保存、上移/下移与删除 | `CourseCrudPanel`、`LectureEditor` | “先看教学计划”被高风险编辑控件淹没，权限难以解释 |
| F13 | 旧模板编辑器只改 `courseware_template` 页引用；P6 工作台又编辑 page doc/revision/release | `/courses/[id]/lectures/[lectureId]` 与 `/courseware/[courseId]/[lectureId]/[pageId]` | “模板、讲次、预览、课件”形成两套编辑心智 |
| F14 | 预览返回讲次列表后进入另一套目录，再返回课程时进入课件中台课程列表 | P6-4/7 的 back links | 返回不是回到用户刚才的教学计划上下文 |

P4H 的目标不是给旧表格补按钮，而是先统一六个不可混用的领域词：

- **课程产品（`course_families`）**：用户认知中的“大课程”，例如“学而思 E 系列 · 小学数学 · 全国版”。
- **课程版本（现有 `courses`）**：课程产品下唯一的“年级 × 课程季节 × 班型”组合；MFHK 编码属于这一层。
- **讲次（`course_lectures`）**：一个课程版本的教学计划行，例如第 1 讲《图形规律初步》。
- **课件（P6 `cw_*` + release）**：某一讲次的可预览、可编辑、可发布页面内容；它不是另一门课程，也不是顶层目录。
- **班级（`classrooms`）**：学生、教师、学辅、排课和进度的运营容器，引用一个课程版本。
- **上课课次（`class_sessions`）**：班级中一次计划或已经发生的教学事实。全文后续所称“课次”只指 `class_sessions`，不再与“讲次”混用。

---

## 2. 产品目标、非目标与硬性不变量

### 2.1 产品目标

1. 任一岗位进入课程或班级页面，第一屏看到的是自己要处理的任务。
2. 课程浏览最多两层：课程产品库 → 产品教学计划；讲次只读预览在产品页浮层打开，只有明确进入制作才离开浏览流。
3. 课程选择支持产品名/版本名/编码/讲次名模糊搜索和年级/课程季节/班型筛选。
4. 主管管理、教研研发、教师授课、学辅客勤四种职责清晰分离；多人兼岗时用视角切换，不把所有动作混在一起。
5. 正常业务不物理删除课程、班级、课次；下架、归档、取消、作废都有明确语义和恢复路径。
6. 测试数据有显式标记、独立视图、批量归档和受控清理流程。
7. 无权限与不存在分开处理，404 的主要出口永远是语义上一级。
8. 浏览态只负责“看这门课教什么、是否准备好、被哪些班使用”；编辑态必须由一个明确按钮进入，不在浏览列表常驻输入框、保存和删除。
9. `school_terms` 的学年学期管理归排课/运营；`courses.term` 的春暑秋寒统一称“课程季节”，课程页不再出现“新建学期”。

### 2.2 非目标

- 不重写 P6 DocStage、H5 渲染器、页 revision、讲 release、双轨和资源替换逻辑；只收口它们的入口、壳层、返回链路和浏览/编辑模式。
- 不引入第三方搜索服务；课程量级先用 PostgreSQL `ilike` + 结构化筛选。
- 不开发短信、微信、邮件实际发送集成；P4H 只提供学辅通知任务与状态记录。
- 不做永久删除正式历史数据的普通 UI。
- 不重做学生、财务、活动模块。
- 不把所有后台详情改成多层嵌套路由。
- 不照搬参考截图的购买、收藏、商品详情或视觉资产；只借鉴“产品 → 版本选择 → 教学计划”的信息结构。
- 不把运营 `school_terms` 复制一份到课程域；既有 `courses.term_id` 先停止使用并标记 legacy，本期不破坏性删列。

### 2.3 不变量

1. 已开课课次的 `courseware`、`courseware_resolved`、事件、板书、考勤、课评和报告必须保留。
2. 课程下架不影响已建班级；教研发布新版不影响已冻结课次。
3. 学辅不是课堂成员，默认不能订阅直播频道或读取课堂资产。
4. `course.manage` 只代表课程研发能力，不代表班级授课能力。
5. `class.view.all` 只代表管理读取，不代表进入直播。
6. 永久清理 CAS 资源只能由“零引用垃圾回收”完成，不能跟随课程/班级级联删除。
7. 现有 72 个 MFHK `courses` ID、865 个 `course_lectures` ID、P6 page/revision/release/binding ID 全部保持不变；新增产品层只能加父级关系，禁止重建或重绑。
8. `courseware_template` 保留为课堂解析/兼容投影，不再提供一套独立的人工作业界面；用户编辑页内容只经 P6 workbench Action/RPC。

---

## 3. 最终信息架构与路由合同

```text
/dashboard
├─ /dashboard/courses                                      课程产品库
│  └─ /dashboard/courses/[familyId]?variant=[courseId]     产品页 + 版本选择 + 教学计划
│       └─ ?lecture=[lectureId]&page=1&track=...            同页只读预览状态，不新增路由
├─ /dashboard/courseware                                   教研制作任务台，不再重复列课程
│  ├─ /dashboard/courseware/lectures/[lectureId]?page=...  唯一讲次课件工作台
│  ├─ /dashboard/courseware/assets                         公共资源 Tab 的可分享 URL
│  └─ /dashboard/courseware/adapt                          适配审核 Tab 的可分享 URL
├─ /dashboard/classes
│  └─ /dashboard/classes/[classId]?session=[sessionId]      课次管理抽屉
├─ /dashboard/schedule                                     排课 + 学年学期管理
└─ /classroom/[classId]/session/[sessionId]                 只有真实授课/学习角色进入
```

这是一棵“浏览树 + 一个工作台”，不是两棵课程树：

- `/courses` 回答“我们有什么课程、这个版本教什么”；
- `/courseware` 回答“教研现在要制作/审核什么”；
- `/courseware/lectures/[lectureId]` 是工具，不是目录；
- `/classes` 回答“哪些学生在什么时候由谁上哪个版本”。

### 3.1 课程产品页 query 合同

`/dashboard/courses/[familyId]` 只允许以下 query：

| 参数 | 含义 | 规则 |
| --- | --- | --- |
| `variant` | 当前 `courses.id` | 必须属于该 family 且当前视角可读；无值时按 grade → courseSeason（数据库 term）→ class_type 选第一个可用版本 |
| `lecture` | 只读预览的 `course_lectures.id` | 必须属于当前 variant；否则忽略并显示产品页，不泄露对象 |
| `page` | 预览页序号 | 1-based，越界钳制到合法范围 |
| `track` | `native-16x9` / `adapted-4x3` | 非法值回落到该讲当前发布轨 |
| `scope` | `research` / `teaching` / `all` / `test` | 保留来源视角，返回课程库时不丢失 |

版本切换只替换 `variant` 并清除 `lecture/page/track`；打开讲次预览只追加 query；关闭预览回到同一 family + variant。不得依赖 `router.back()` 或任意 `returnTo` URL。

### 3.2 唯一课件工作台合同

唯一 canonical route：

```text
/dashboard/courseware/lectures/[lectureId]?page=[pageDocId]&track=[track]&mode=preview|edit
```

- 默认 `mode=preview`；即使教研有编辑权，也要显式点“进入编辑”才显示属性面板和写操作。
- `mode=edit` 必须同时具备对应 `courseware.page.edit` / `courseware.release.publish` 能力；无权时回到 preview 并显示说明，不伪装 404。
- 左侧页缩略图、中央舞台、右侧检查器属于同一个 workbench shell；切页、切轨、预览/编辑不得再换路由树。
- 页增删、修订、发布、回滚、资源替换继续调用 P6 既有服务端 Action/RPC；P4H 不复制业务逻辑。
- 页级“删除”沿用 P6 soft-delete；讲次级不提供物理删除。
- 页头固定提供“返回教学计划”，服务端由 lecture → course → family 计算准确地址和 variant，不接受外部返回地址。

### 3.3 旧路由迁移表

| 旧地址 | 新行为 | 禁止行为 |
| --- | --- | --- |
| `/dashboard/courses/[courseId]`（旧 variant UUID） | 服务端识别为 variant 后 308 到 family 页并带 `variant` | 不再渲染第二套详情 |
| `/dashboard/courses/[courseId]/lectures/[lectureId]` | 308 到唯一 workbench；原 `CoursewareTemplateEditor` 退出用户界面 | 不再编辑 `courseware_template` 数组 |
| `/dashboard/courseware/[courseId]` | 308 到 family 页并带 `variant` | 不再显示重复讲次目录 |
| `/dashboard/courseware/[courseId]/[lectureId]` | 308 到 workbench `mode=preview` | 不保留另一套预览壳 |
| `/dashboard/courseware/[courseId]/[lectureId]/[pageId]` | 308 到 workbench `mode=edit&page=[pageId]` | 不保留页级嵌套路由 |

`/dashboard/courseware/assets`、`assets/[assetId]`、`adapt` 是任务工具的可分享地址，可以保留；但从侧栏移除独立“资源库”项，只在“制作工作台”的二级 Tabs 中出现。

### 3.4 禁止新增的后台路由

禁止新增 `/dashboard/classes/[classId]/sessions/[sessionId]`。后台点击课次时：

- URL 变为 `/dashboard/classes/[classId]?session=<uuid>`；
- 班级详情保持在原页面；
- Client 叶子打开课次管理抽屉；
- 关闭抽屉时移除 `session` query；
- 刷新带 query 的 URL 能重新打开同一抽屉。

### 3.5 课程页 scope

`/dashboard/courses?scope=...` 只允许：

| scope | 出现条件 | 数据集合 | 默认用户 |
| --- | --- | --- | --- |
| `research` | 有 `course.manage` | 含待完善/近期使用版本的产品 family | 教研 |
| `teaching` | 有教师责任关系 | 本人任教班级所引用版本对应的 family | 教师 |
| `all` | 有 `course.view` 且管理范围允许 | 全部可读 family | 主管/校长 |
| `test` | 有 `course.manage` | 含 `purpose='test'` 版本的 family | 教研/管理员 |

默认选择优先级：`research` → `teaching` → `all`。用户手动切换后把最后 scope 存入 query，不新增数据库偏好表。

学辅若只有销售/跟进/班级责任而无 `course.view`，侧栏不显示课程库；课程摘要从班级详情读取。

课程库按 family 去重；命中 product_code 或讲次名时，结果卡说明“命中版本：一年级秋季 A / MFHK00007”，不得重新展开成 72 行。

### 3.6 班级页 scope

`/dashboard/classes?scope=...` 只允许：

| scope | 数据集合 | 默认用户 |
| --- | --- | --- |
| `teaching` | 本人为 primary_teacher/assistant_teacher，或未来课次 teacher_override | 教师 |
| `support` | 本人为 learning_support | 学辅 |
| `all` | 有 `class.view.all` 的全部班级 | 主管/教务 |
| `test` | 可管理且 `purpose='test'` | 主管/管理员 |

有合法 `scope` query 时使用该值；没有 query 时：仅管理者默认 `all`，仅学辅默认 `support`，具备 teaching 关系者默认 `teaching`，其他情况按 `all` → `support` 回落。不得为“记住视角”新增数据库字段或 localStorage。

---

## 4. 四种视角的页面合同

### 4.1 主管 / 校长

**课程库第一屏**：

- 看到课程产品 family，而不是 72 个组合版本；
- 摘要显示产品数、可用版本数、已下架版本数、课件不完整讲次数；
- 产品卡默认按“有异常优先，最近使用其次”，显示覆盖年级/课程季节/班型、使用班级数和整体完成度；
- 进入产品页后切换版本、查看教学计划和讲次预览；
- 只有 `course.view` 时完全只读；即使另有管理权限，浏览态也不直接显示输入框。

**班级第一屏**：

- scope=`all`；
- 异常徽章：缺主讲、未来 7 天课件未齐、排课冲突、已结束未点名；
- 主要动作是“管理”，不是“进入课堂”；
- 点击课次打开管理抽屉；
- 只有本人也是该班教师/该课次代课教师时，抽屉额外显示“进入课堂”。

### 4.2 教研（定义：拥有 course.manage 的老师）

**课程库第一屏**：

- scope=`research`；
- 默认只看“包含待完善版本”和“未来 7 天将被班级使用”的产品；
- 产品卡突出异常版本数、讲次完成度、待发布数和最近将使用时间；
- 产品页默认仍为教学计划浏览态，主动作只有“编辑教学计划”；进入显式编辑态后才出现改名、排序、新增和归档；
- 点讲次先在产品页只读预览；点“编辑这讲课件”才进入唯一 workbench；发布动作只在 workbench 出现；
- “制作工作台”是待完善/最近编辑/待发布/适配审核/公共资源任务队列，不再重复展示课程目录；
- 产品页可打开“使用中的班级”抽屉，但不因此获得课堂操作权。

**班级第一屏**：

- 若本人没有任何教学责任，侧栏班级入口可隐藏；从课程详情的使用班级抽屉进入只读班级摘要；
- 若本人兼任教师，则显示 scope=`teaching`；
- `course.manage` 不得让其进入未任教班级的直播。

### 4.3 教师

**课程库第一屏**：

- scope=`teaching`；
- 只显示当前任教班级引用版本对应的课程产品；
- 产品卡主要信息是“我在教的版本”“下次使用该版本的课次”和“是否备好”；
- 可切到本人有教学关系的版本、查看教学计划、预览权威课件和从班级侧编辑课次覆盖层；
- 没有 `course.manage` 时不得修改课程源、讲次名或 release。

**班级第一屏**：

- scope=`teaching`；
- 下一节课置顶；
- 行内主按钮随状态变化：备课 → 候课 → 继续上课 → 复盘；
- 不显示班级删除、课程下架、测试数据清理；
- 对未开始课次只可发起调课/请假工作流，不能直接取消（除非另有 `class.manage`）。

### 4.4 学辅（销售权限 + 教务协作）

**课程库第一屏**：

- 默认无独立课程库入口；
- 在班级详情只读显示课程产品、版本（年级/课程季节/班型）、讲次进度和课件准备状态；
- 不显示课程编辑、release、资源库。

**班级第一屏**：

- scope=`support`；
- 每行突出：下一课时间、待通知人数、请假/补课、未点名、待跟进；
- 主要动作是“客勤与跟进”；
- 可按已有权限办理报名、转班、退班、收款和跟进；
- 不能改权威课程、不能控制直播、不能取消历史课次；
- 学辅兼教师时可在 `support` 与 `teaching` 间切换。

---

## 5. 生命周期与动作矩阵

### 5.1 课程产品与课程版本

`course_families` 和 `courses` 都有生命周期，但承担不同语义：

- family 的上下架控制整套产品是否继续对外选用；family 下架时所有版本停止进入新建班选择，但不影响既有班级。
- variant 的上下架只控制一个“年级 × 课程季节 × 班型”组合；产品页仍保留该组合的历史入口。
- 当前 72 个 MFHK 版本全部挂到同一个 production family；不得把 72 行合并、复制或重建。

保留现有 `courses.status`，不新增重复的 lifecycle 字段：

| 技术状态 | 产品文案 | 可用于新建班级 | 可恢复 | 删除规则 |
| --- | --- | --- | --- | --- |
| `draft` | 草稿 | 否 | — | 无任何班级/release 引用时可移入回收站 |
| `enabled` | 可用 | 是 | — | 不可删除，只能下架 |
| `disabled` | 已下架 | 否 | 可重新上架 | 不影响既有班级 |
| `trashed_at is not null` | 回收站 | 否 | 可恢复到 draft | 仅测试/未使用草稿允许永久清理 |

课程迁移必须把 status check 扩展为 `draft|enabled|disabled`，现有数据保持原值。

### 5.2 讲次

`course_lectures` 新增 `status` 与归档字段；“讲次删除”从普通产品动作中彻底移除：

| 状态 | 文案 | 教学计划表现 | 规则 |
| --- | --- | --- | --- |
| `draft` | 草稿 | 仅教研编辑态可见 | 无 release/课次引用时可继续编辑 |
| `active` | 可用 | 浏览态正常显示 | 可预览、可被班级排课引用 |
| `archived` | 已归档 | 默认折叠，历史班级仍可回看 | 不再用于新排课；可恢复 |

固定规则：

- 浏览态没有重命名、上移、下移、保存、删除控件；
- “编辑教学计划”是一个明确模式，整页只有一个“保存更改”，批量事务保存名称/目标/顺序；不得每行各自保存；
- 归档前必须显示 page/release/class/session 引用计数；有引用也允许归档，但禁止物理删除；
- 永久清理只允许 `purpose='test'` 或未使用 draft，且 pages=0、releases=0、sessions=0，由 admin/testdata.purge 在 P4H-10 处理；
- 现有 `deleteLectureAction` 在 P4H-0 起拒绝普通调用，P4H-2 后由 `archive_lecture` / `restore_lecture` 取代；
- `courseware_template` 不再由单独模板编辑器直接写；讲次课件页的增删改走 P6 workbench。

### 5.3 班级

新增 `operational_status`：

| 状态 | 文案 | 允许的核心操作 |
| --- | --- | --- |
| `planning` | 筹备中 | 配课程、配教师/学辅、排课、检查资源、启用 |
| `active` | 进行中 | 日常教学、报名、调课、客勤 |
| `completed` | 已结班 | 报告、续费、只读历史、归档 |
| `archived_at is not null` | 已归档 | 只读、取消归档 |
| `trashed_at is not null` | 回收站 | 只读影响、恢复；正式历史通常不允许进入此状态 |

规则：

- 新建班级一律先保存为 `planning`；
- 资源/教师/排课检查通过后才能激活；
- `purpose='test'` 可带警告激活，但必须保留黄色测试标识；
- 有 active enrollment、订单或已开始课次的班级不能移入回收站，只能结班/归档；
- 归档不删除成员、报名、课次、作业和历史数据。

### 5.4 上课课次

保留现有 `deleted_at` 作为内部软取消标记，UI 永远不再称“删除”：

| 推导状态 | 条件 | UI 动作 |
| --- | --- | --- |
| 计划中 | started_at、ended_at、deleted_at 均空 | 改时间、换教师、取消 |
| 已取消 | deleted_at 非空 | 恢复、重新排期 |
| 上课中 | started_at 非空、ended_at 空 | 继续、下课 |
| 已结束 | ended_at 非空 | 报告、考勤、课评、复盘 |
| 已作废 | voided_at 非空 | 只读；从运营统计/课消中排除，历史数据保留 |

操作菜单始终存在。不能执行的动作显示 disabled + Tooltip 原因，不允许简单隐藏导致用户猜测。

---

## 6. 数据模型与数据库合同

### 6.1 migration 1：生命周期与责任关系

basename 固定为 `p4h_lifecycle_and_assignments.sql`。执行时先按文件名排序读取 `supabase/migrations/` 当前最大 migration，分配一个**严格更大且未占用**的合法 `YYYYMMDDHHMMSS` 前缀；不得复用本文编写时已经被 P6 占用的 `20260719000100`。把最终文件名写进任务记录，后续 P4H migration 依次使用更大的未占用时间戳。若同 basename 已存在，停止并报告，不得创建第二份。

必须包含：

```sql
alter table public.courses
  add column purpose text not null default 'production'
    check (purpose in ('production','test')),
  add column trashed_at timestamptz,
  add column trashed_by uuid references public.profiles(id) on delete set null;

alter table public.courses drop constraint if exists courses_status_check;
alter table public.courses add constraint courses_status_check
  check (status in ('draft','enabled','disabled'));

alter table public.course_lectures
  add column status text not null default 'active'
    check (status in ('draft','active','archived')),
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id) on delete set null;

alter table public.classrooms
  add column purpose text not null default 'production'
    check (purpose in ('production','test')),
  add column operational_status text not null default 'active'
    check (operational_status in ('planning','active','completed')),
  add column trashed_at timestamptz,
  add column trashed_by uuid references public.profiles(id) on delete set null;

alter table public.class_sessions
  add column cancelled_by uuid references public.profiles(id) on delete set null,
  add column cancel_reason text not null default '',
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles(id) on delete set null,
  add column void_reason text not null default '';

create table public.classroom_staff_assignments (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  responsibility text not null
    check (responsibility in ('primary_teacher','assistant_teacher','learning_support')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (classroom_id,user_id,responsibility)
);
```

还必须：

- 建立 `(user_id,responsibility,classroom_id)` 索引；
- 建立每班最多一个 primary_teacher 的 partial unique index；
- 将现有 `classrooms.owner_id` 对应 teacher 回填为 primary_teacher；
- 将同班其它 teacher member 回填为 assistant_teacher；
- archived_at 非空的班级回填 `operational_status='completed'`；
- 不把任何 staff 自动回填为 learning_support；
- 给新表启用 RLS；
- select：本人 assignment、`class.view.all`、admin；
- insert/update/delete：`class.manage` 且对象作用域允许；
- 新增 `is_classroom_staff_assigned(classroom_id,user_id,responsibility default null)` SECURITY DEFINER helper；
- 给 classrooms 与 class_sessions 追加 assignment scope 的 select policy，但不向 session_events、realtime.messages、Storage 对象追加 support policy；
- learning_support 读取花名册/客勤摘要走受控查询或 RPC，不因 assignment 获得课堂事件正文；
- 不给 authenticated 直接 delete `courses/course_lectures/classrooms/class_sessions`；
- 现有 865 个讲次全部回填为 `active`，行数与 ID 不变；
- 增加注释说明 assignment 与 classroom_members 的区别。

### 6.2 migration 2：受控状态转换与影响预览

basename 固定为 `p4h_lifecycle_rpcs.sql`；时间戳使用 P4H-1 之后下一个未占用值。

新增 SECURITY DEFINER RPC：

| RPC | 权限 | 核心规则 |
| --- | --- | --- |
| `transition_course_status(course_id,target)` | course.manage | target 仅 draft/enabled/disabled；回收站课程拒绝 |
| `trash_course(course_id)` | course.manage | 仅 draft/test，且无 classrooms、class_sessions、published release 引用 |
| `restore_course(course_id)` | course.manage | 清 trashed，恢复 draft |
| `get_course_lifecycle_impact(course_id)` | course.view | 返回 lecture/release/class/session/object counts，不返回 signed URL |
| `archive_lecture(lecture_id)` | course.manage | 保留 pages/releases/sessions；只改 status/archived 字段 |
| `restore_lecture(lecture_id)` | course.manage | archived → active；保留原 no 与全部内容 |
| `get_lecture_lifecycle_impact(lecture_id)` | course.view | 返回 page/release/class/session counts，不返回 doc/URL |
| `save_teaching_plan(course_id,base_updated_at,lectures[])` | course.manage | 单事务校验名称/目标/顺序与乐观锁；不得前端逐行保存 |
| `transition_classroom_status(classroom_id,target)` | class.manage | planning/active/completed；active 前跑准备检查 |
| `archive_classroom(classroom_id,archived)` | class.manage | 只改 archived_at，历史不动 |
| `trash_classroom(classroom_id)` | class.manage | 无 active enrollment、订单、started session 才允许 |
| `restore_classroom(classroom_id)` | class.manage | 清 trashed，恢复 planning |
| `assign_classroom_staff(classroom_id,user_id,responsibility)` | class.manage | 事务内维护 assignment；教学责任同步课堂 teacher member |
| `remove_classroom_staff(classroom_id,user_id,responsibility)` | class.manage | primary 必须先有替代者；support 不触碰 classroom_members |
| `cancel_session(session_id,reason)` | class.manage | 仅未开始；写 deleted_at/cancelled_by/reason |
| `restore_session(session_id)` | class.manage | 仅未开始且已取消 |
| `void_session(session_id,reason)` | session.void | 仅已结束；保留全部子表 |

RPC 统一：

- `auth.uid()` 为空抛 UNAUTHENTICATED；
- 权限不够抛 FORBIDDEN；
- 行级范围不符抛 FORBIDDEN_SCOPE；
- 状态不符使用固定错误码，例如 SESSION_ALREADY_STARTED、COURSE_IN_USE、CLASSROOM_HAS_HISTORY、PREP_INCOMPLETE；
- 对目标行 `for update`；
- 在同一事务写 `domain_events`；
- `set search_path=public,pg_temp`；
- revoke public/anon，grant authenticated。

assignment 同步规则固定为：

- 新 primary_teacher：更新 `classrooms.owner_id`，确保同人存在 classroom_members teacher 行；旧 primary 降为 assistant_teacher，除非调用方显式移除；
- assistant_teacher：确保同人存在 classroom_members teacher 行；
- learning_support：只写 assignment，绝不写 classroom_members；
- 移除最后一条 teaching responsibility 时才删除对应 teacher member；
- 不能在没有替代者的情况下移除 primary_teacher；
- 所有 staff user 必须是 profiles.role staff/admin，否则抛 INVALID_STAFF;
- assignment 变化写 domain_events。

`save_teaching_plan` 只更新讲次元数据和顺序，绝不能更新 `courseware_template`、page doc、revision、release 或 binding。并发版本不一致抛 `STALE_WRITE`，UI 保留未保存草稿并提示刷新对比。

### 6.3 migration 3：课程产品层与 72 版本原位归组

basename 固定为 `p4h_course_families.sql`；时间戳使用 P4H-2 之后下一个未占用值，归 P4H-3 执行。

新增：

```sql
create table public.course_families (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  publisher text not null default '',
  stage text not null default '',
  subject text not null default '',
  edition text not null default '',
  description text not null default '',
  cover_path text,
  purpose text not null default 'production'
    check (purpose in ('production','test')),
  status text not null default 'enabled'
    check (status in ('draft','enabled','disabled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.courses
  add column family_id uuid references public.course_families(id) on delete restrict;
```

当前数据回填固定规则：

1. 先断言 seed 明确列出的 72 个 MFHK product_code 在 `courses` 中各存在且仅存在一行、这些行标题前缀全部是 `E系列数学`、每行 `(grade,term,class_type)` 唯一，且其讲次合计 865；任一断言不成立立即回滚，不做模糊标题归组。允许表内存在用户另建的非 seed 测试/草稿课程。
2. 幂等插入一个 `slug='xueersi-e-primary-math-cn'` 的 production family：`title='E 系列小学数学'`、`publisher='学而思'`、`stage='小学'`、`subject='数学'`、`edition='全国版'`。
3. 只按 `supabase/seed/teaching-plans.json` 的显式 72 个 product_code 把现有课程挂到该 family；不得更新这些课程或讲次的 ID、标题、编码、顺序与 P6 引用。
4. 对不在 seed 清单内的现有课程，不猜测它属于 E 系列，也不丢弃：每个 course 原位创建一个一对一 legacy family（slug=`legacy-course-<course uuid>`，title/purpose/status 继承该 course），并把映射明细写进 migration audit。后续可由教研显式合并，本任务不自动合并。
5. 回填后断言 E 系列 family 下 variants=72、lectures=865，且所有现有 course 的 family_id 均非空；再把 `courses.family_id` 改为 not null。
6. 新增 active variant 唯一索引 `(family_id,grade,term,class_type) where trashed_at is null`。
7. 给 family 启用 RLS：`course.view` 可读作用域内 family；`course.manage` 才可写；authenticated 无 DELETE grant。
8. 更新 `scripts/seed-courses.mjs`：先 upsert family，再写带 `family_id` 的 variant；禁止让 clean rebuild 因 not-null 失败。

字段语义固定：

- `courses.term` 继续保存 `1=暑期、2=秋季、3=寒假、4=春季`，TypeScript/UI 一律命名 `courseSeason`，不再叫 school term。
- `school_terms` 只表示 `year + semester + starts_on/ends_on` 的运营日历，管理入口移到 `/dashboard/schedule`。
- `courses.term_id` 是 P4E 遗留字段；P4H 停止从课程产品页和建班选择器读写它，但本期不 drop。`classrooms/class_sessions/enrollments.term_id` 继续正常使用。
- `cover_path` 首期允许为空，使用设计系统生成的课程封面占位；不得直接复制参考站截图或来源不明封面。

同时新增 SECURITY DEFINER RPC / 查询合同：

| 名称 | 用途 |
| --- | --- |
| `transition_course_family_status(family_id,target)` | family 草稿/上架/下架；下架不修改子版本和既有班级 |
| `get_course_family_impact(family_id)` | 聚合 variant/lecture/release/class/session/object counts |
| `list_course_families(scope,filters,page)` | family 去重列表，匹配 variant/lecture 时返回 matched variant 摘要 |
| `get_course_family_detail(family_id,variant_id)` | family 元数据、可选维度、选中 variant 教学计划、readiness；不下发 page doc/URL |

### 6.4 权限键

在 `src/features/school/permissions.ts` 及 migration 内只新增：

- `schedule.manage`：管理运营学年学期和排课设置；默认 principal，admin 恒有；`course.manage` 不再隐式获得此能力。
- `session.void`：默认仅 principal；admin 恒有。
- `testdata.purge`：内置岗位默认不给；admin 恒有。

不得新增“research/teacher/support view”之类岗位名权限。岗位视角由已有权限和 responsibility 关系推导。

`courseware.template.edit` 作为 P4 兼容权限键暂不从 registry 删除，避免角色/审计记录断裂；但 P4H 新 UI 和 canonical workbench 不得再用它授权写 `courseware_template`。讲次元数据由 `course.manage` 管，P6 页内容由 `courseware.page.edit` 管，发布由 `courseware.release.publish` 管。是否最终移除旧键只在 P4H-11 无引用审计后决定。

### 6.5 TypeScript 类型

新增 `src/features/school/teaching-operations/types.ts`，集中定义：

- `CoursePurpose`
- `CourseStatus`
- `CourseFamilySummary`
- `CourseVariantSummary`
- `LectureStatus`
- `CourseSeason`
- `ClassroomPurpose`
- `ClassroomOperationalStatus`
- `StaffResponsibility`
- `CourseScope`
- `ClassroomScope`
- `CourseCapabilities`
- `ClassroomCapabilities`
- `SessionCapabilities`

禁止在组件内重复声明字符串 union。

数据库 migration 应用后重新生成并提交 `src/lib/database.types.ts`，再运行 `pnpm db:types:check`。

---

## 7. 能力模型合同

新增目录 `src/features/school/teaching-operations/`：

```text
types.ts
capabilities.ts
scopes.ts
course-queries.ts
classroom-queries.ts
readiness.ts
```

### 7.1 最终能力公式

```text
最终能力 = 岗位权限 ∩ 对象关系 ∩ 当前状态
```

关系判定：

- teaching：primary_teacher、assistant_teacher，或该 session 的 teacher_override；
- support：learning_support；
- management：class.view.all / class.manage；
- research：course.manage。

### 7.2 CourseCapabilities 固定字段

```ts
interface CourseCapabilities {
  canViewFamily: boolean;
  canViewVariant: boolean;
  canPreviewLecture: boolean;
  canEditFamily: boolean;
  canManageVariants: boolean;
  canEditTeachingPlan: boolean;
  canOpenCoursewareWorkbench: boolean;
  canPublishRelease: boolean;
  canTransitionFamily: boolean;
  canTransitionVariant: boolean;
  canArchiveLecture: boolean;
  canViewUsingClasses: boolean;
  canCreateClass: boolean;
  reasons: Partial<Record<
    "familyEdit" | "variantManage" | "planEdit" | "workbench" |
    "publish" | "familyTransition" | "variantTransition" |
    "lectureArchive" | "usingClasses" | "createClass",
    string
  >>;
}
```

`course.manage` 允许 family/variant/讲次元数据管理，但不能替代 `courseware.page.edit` 或 `courseware.release.publish`。组件不得因为用户是 teacher/admin 就自行显示编辑按钮，只消费服务端 capabilities。

### 7.3 SessionCapabilities 固定字段

```ts
interface SessionCapabilities {
  canOpenManagement: boolean;
  canPrepare: boolean;
  canEnterLive: boolean;
  canReschedule: boolean;
  canAssignSubstitute: boolean;
  canCancel: boolean;
  canRestore: boolean;
  canVoid: boolean;
  canViewReport: boolean;
  canMarkAttendance: boolean;
  canWriteReview: boolean;
  reasons: Partial<Record<
    "prepare" | "live" | "reschedule" | "substitute" | "cancel" |
    "restore" | "void" | "report" | "attendance" | "review",
    string
  >>;
}
```

组件不得自行用 `startedAt` + permission 拼另一套条件；只消费 capabilities。

### 7.4 主管读取与课堂读取

- 后台管理查询可以由 class.view.all / report.view.all 读取汇总。
- `/classroom` 路由继续依赖课堂成员/真实授课关系。
- 不修改 `getSessionAssetUrls` 的“教室成员”安全边界。
- 不给主管、教研、学辅签发课堂资产 URL。

---

## 8. 页面与组件合同

### 8.1 侧栏与学年学期归位

改 `src/features/school/nav.ts`：

- “课程”继续指向 `/dashboard/courses`，按 `course.view` 显示。
- “课件中台”改名“制作工作台”，仅任一 `courseware.page.edit/release.publish/asset.manage` 显示。
- 从侧栏移除独立“资源库”；公共资源和适配审核收进制作工作台 Tabs。
- 教师只有课程读取权时看“课程”，不看“制作工作台”；学辅默认两者都不看。

从 `courses/page.tsx` 移除 `TermManager` 和 `listSchoolTerms()`。把 `TermManager` 重构成 `/dashboard/schedule` 的“学年学期设置”Dialog/Sheet；只有 `schedule.manage` 显示入口，两个学期 Action 同样服务端校验该权限，不再校验 `course.manage`。课程筛选中的春/暑/秋/寒文案统一为“课程季节”，禁止复用“学年学期”文案键。

### 8.2 课程产品库

目标文件：

- 改 `src/app/[locale]/dashboard/courses/page.tsx`
- 新增/改 `src/features/school/teaching-operations/course-queries.ts`
- 新增 `CourseScopeSwitch.tsx`、`CourseFamilyFilters.tsx`、`CourseFamilyList.tsx`

页面合同：

1. 顶部只有标题、视角 scope、搜索/筛选；`course.manage` 可在 overflow 中“新建课程产品”，但首期默认页面不突出创建按钮。
2. 一张卡/一行代表一个 family，不代表 variant。当前 seed 页面正常情况下只出现一张 E 系列产品卡。
3. 搜索覆盖 family title/publisher/subject/edition、variant title/product_code、lecture name；服务端返回 matched variant 摘要。
4. 常驻筛选：q、grade、courseSeason、classType；“更多筛选”：family/variant status、purpose、readiness。
5. 卡片固定显示：封面占位、产品名、出版社/学段/学科/版本、可用版本维度、讲次准备完成度、使用班级数、异常数。
6. 排序：当前 scope 的待处理异常优先、未来使用时间其次、updated_at desc。
7. 主动作固定为“查看教学计划”；不得在卡片常驻“改名/保存/删除/发布”。
8. 无结果保留筛选并显示“清除筛选”；移动端为单列卡片，无横向滚动。
9. family/variant 下架都走 overflow → 影响预览 → AlertDialog；普通页面永远没有“永久删除”。

### 8.3 课程产品页：版本选择 + 教学计划

改 `src/app/[locale]/dashboard/courses/[id]/page.tsx`，其中 `[id]` 从此表示 `familyId`；旧 variant UUID 只执行 §3.3 redirect。

第一屏固定顺序：

1. 左侧课程封面；右侧产品标题与 publisher/stage/subject/edition/description。
2. 三组紧凑选择器：年级、班型、课程季节。选项来自真实 variant matrix；不存在的组合 disabled，不得选完再报错。
3. 当前版本摘要：显示完整版本名、MFHK product code、可用状态、讲次/已发布/待完善计数。
4. 角色动作：所有可读者“预览教学计划”；`class.create` 额外“用此版本建班”；`course.manage` 额外“编辑教学计划”和 overflow“管理产品/版本”。不实现收藏、购买。
5. 主区默认 Tab 只有“教学计划”；“使用中的班级”和“变更记录”用 Sheet/折叠区，不再增加详情路由。

桌面结构基线（参考图只参考信息顺序，不复刻视觉和交易按钮）：

```text
┌────────课程封面────────┐  E 系列小学数学
│                       │  学而思 · 小学 · 数学 · 全国版
│                       │  年级  [1] [2] [3] [4] [5] [6]
└───────────────────────┘  班型  [A] [B] [S]
                           季节  [春] [暑] [秋] [寒]
                           当前版本：一年级秋季 A · MFHK00007 · 可用
                           [用此版本建班] [编辑教学计划，仅教研] [更多]

教学计划
No.  讲次名称             教学内容/目标        课件准备       动作
01   图形规律初步         ……                   69 页·已发布   预览
02   加减巧算初步         ……                   待完善          预览
```

移动端先标题/元数据，再三组横向可滚动选择器，再教学计划卡片；封面缩为摘要图，不把桌面表格硬压进 390px。

教学计划表固定列：讲次序号、讲次名称、教学内容/目标、课件页数、准备状态、只读预览。整行可打开 `?lecture=` 预览；无编辑权时没有任何写控件。

讲次预览浮层：

- 使用 Dialog/Sheet 的全屏移动端适配壳，内容动态加载 P6 Viewer；每次只取当前页 doc 与 URL，不把整讲 doc 下发客户端。
- 服务端准入是 `course.view` + 当前 family/variant scope + 已发布 release；不得复用 `COURSEWARE_STUDIO_PERMS` 把普通教师/主管挡在外面，也不得只凭 `is_staff` 绕过对象 scope。
- 顶部保留讲次名、页码、16:9/4:3 切换和关闭；关闭回到同 variant。
- 教研有 `courseware.page.edit` 时显示次要按钮“编辑这讲课件”，进入 canonical workbench；教师/主管不显示。
- 无 current release 时显示“课件尚未发布”；教研可进入制作，其他人只见说明。

### 8.4 显式教学计划编辑态

新增叶子 `TeachingPlanEditor.tsx`，只在点击“编辑教学计划”后动态加载：

- 顶部持续显示“正在编辑 · 未发布到班级”，底部 sticky actions 只有“取消”和一个“保存更改”。
- 行内允许编辑讲次名和教学目标；顺序用上移/下移或现有无依赖能力实现，不为拖拽新增库。
- 行尾只有 overflow：预览课件、归档讲次、恢复讲次；禁止常驻垃圾桶。
- 新增讲次走 Dialog，默认 `draft`；只有元数据和课件 readiness 满足规则后才可设 active。
- “归档讲次”先打开影响预览，明确 pages/releases/classes/sessions 均保留；有历史引用时文案是“停止新排课”，不是删除。
- 保存调用单个 `save_teaching_plan`；不得循环 `updateLectureAction`，不得每行单独 toast。
- family 元数据和 variant matrix 分别在“编辑产品信息”“管理版本”Dialog/Sheet 中处理，不与讲次行混排。
- `CourseCrudPanel`、`LectureEditor`、`CoursewareTemplateEditor` 退出正式入口；确认无引用后再在 P4H-11 删除死代码。

### 8.5 制作工作台与唯一讲次 workbench

`/dashboard/courseware` 不再调用 `loadCoursewareCourses()` 画另一张课程表，改为教研任务台：

- Tabs：待完善、最近编辑、待发布、适配审核、公共资源。
- 列表项按讲次组织，固定显示 family / 当前版本 / 讲次 / 轨道 / draft 与 release 状态 / 最近编辑者和时间。
- 搜索可命中 family、product code、讲次；点列表项直接到 canonical workbench。
- `assets` 与 `adapt` 可保留当前静态子路由，但视觉上属于同一任务台 Tabs，返回“制作工作台”，不返回课程目录。

canonical `.../courseware/lectures/[lectureId]`：

- Server Component 壳读取权限、lecture → variant → family breadcrumb、当前页与当前轨；完整工作台入口要求任一 P6 studio 权限，Viewer/Editor 是懒加载 Client 叶子。普通 `course.view` 用户在产品页预览，不因此获得制作工作台入口。
- preview 与 edit 共用左侧页列表和中央舞台；右侧检查器、保存草稿、页增删/复制、发布/回滚只在 edit mode 出现。
- 首次进入一律 preview；“进入编辑”切 `mode=edit`；离开有未保存草稿时用应用内 AlertDialog，不用 `window.confirm()`。
- 页切换只改 `page` query；轨切换只改 `track`；切页不得离开 workbench shell。
- 页软删除继续用 `soft_delete_cw_page`；整讲发布继续用 `publish_lecture_release`；不得恢复旧 `courseware_template` 编辑 Action。
- 面包屑固定“课程产品 → 当前版本 → 第 N 讲”；主返回固定到 family + variant，解决所有循环返回。

### 8.6 可搜索 CoursePicker

新增 `src/features/school/teaching-operations/CoursePicker.tsx`：

- 使用 Command + Popover；初始无选中值；输入防抖 250ms；服务端最多返回 30 个 variant 候选。
- 搜索 family/variant title、product_code、lecture name；快捷筛选 grade/courseSeason/classType。
- 结果按 family 分组，但最终选择值必须是现有 `courses.id`；每项显示“E 系列小学数学 · 一年级 · 秋季 · A · MFHK00007”和 ready/total。
- 默认只查 family/variant 都 enabled 且 trashed_at 为空；purpose=test 仅 test 建班模式可见。
- 不完整项黄色 Badge，production 班可选但只能进入 planning；空结果不得自动新建课程。
- 键盘上下/Enter/Escape 可用；不得把 72 个版本及 865 讲一次性全部下发客户端。

### 8.7 建班向导

重构 `ClassBuildWizard.tsx`，固定四步：

1. 选择课程版本：CoursePicker 或显式“自由班”次要入口；选中后就地显示 family 摘要与讲次计划，不跳课程页。
2. 班级信息：名称、主讲、学辅、容量、教室、正式/测试。
3. 排课：选择运营 `schoolTerm`、起始日、星期、时间、时长、逐课调整、冲突提示。
4. 确认：课程版本、课程完整度、教师冲突、课次数、测试标记。

规则：

- 不默认选择第一门课程或第一位教师；课程季节不能代替运营学年学期。
- 选择课程后班名只填 placeholder，不强写值；切换版本清空旧 lecture overrides 并提示一次。
- 提交创建 planning 班；检查全绿时可勾选“创建后立即启用”。
- 正式班准备不完整时不能立即启用；测试班可带警告启用。
- 提交失败保留全部输入；成功跳班级详情。

### 8.8 班级列表

目标文件：`classes/page.tsx`、`classes.ts`、`ClassroomScopeSwitch.tsx`、`ClassroomFilters.tsx`、`ClassroomList.tsx`。

筛选：q（班级/family/版本/产品码）、teacher、support、grade、schoolTerm、operational status、purpose、readiness/anomaly。

每行固定字段：班级 + 正式/测试 Badge、课程产品 + 版本、主讲 + 学辅、报名/容量、已上/总课次、下一课、readiness、异常徽章、与当前视角匹配的一个主动作。禁止用同一个“打开”链接承担所有角色。

### 8.9 班级详情与课次抽屉

班级详情只保留四个轻量 Tab/锚点：sessions、students、readiness、records。默认：teaching → sessions，support → students，all → sessions + 顶部异常摘要。

课次行点击：

- teaching 且 canPrepare/canEnterLive：主按钮进入教学路由；
- management/support：设置 `?session=id` 打开 `SessionManagementDrawer`；
- research：默认不从班级列表进入课次；从课程侧只看使用摘要。

抽屉只分五区：状态/时间/主讲代课、课件准备、考勤客勤摘要、报告课评、capabilities 对应动作；不嵌套详情路由。

### 8.10 404 与无权限

新增 `src/components/not-found-actions.tsx` Client 叶子：用项目 i18n `usePathname`，通过固定 `resolveSemanticParent(pathname)` 映射到**真实存在的**上级路由；主按钮“返回上一级”，次按钮“返回首页”；不使用 `router.back()`。

首期语义映射至少包含：

- `/dashboard/courses/*` → `/dashboard/courses`
- `/dashboard/courseware/lectures/*` → `/dashboard/courseware`
- `/dashboard/courseware/assets/*` → `/dashboard/courseware/assets`
- `/dashboard/classes/*` → `/dashboard/classes`
- `/classroom/[classId]/session/*` → `/classroom/[classId]`

其它路径只有在删除最后一段后命中已知 routable parent 白名单才使用该 parent；否则主按钮直接回首页。不得生成 `/dashboard/courseware/lectures` 这类并不存在的“上一级”，也不得依赖浏览器历史。

改全局 `not-found.tsx` 移除图鉴 CTA。已知业务详情继续通过 `SchoolPageHeader.backHref` 给精确上级。

新增 `AccessBoundaryNotice`：对象存在但当前用户只能管理查看时提供管理视图；完全无权时显示统一无权限文案；不泄露课程资源 URL、学生隐私或课堂事件正文。

---

## 9. 学辅任务模型

P4H 不接第三方通知，但必须能记录任务闭环。

固定 basename：`p4h_support_tasks.sql`，时间戳使用当时下一个未占用值，归 P4H-9 执行：

```sql
create table public.class_support_tasks (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  session_id uuid references public.class_sessions(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  kind text not null check (kind in (
    'preclass_notice','absence_check','makeup_followup','postclass_followup'
  )),
  status text not null default 'pending'
    check (status in ('pending','done','skipped')),
  due_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  note text not null default '',
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
```

规则：

- learning_support 只读/写自己负责班级的任务；
- class.view.all 可读全校；
- followup.write 才能完成课后跟进；
- attendance.mark 或 class.manage 才能处理客勤异常；
- 不自动发送任何外部消息；
- 完成任务写 domain_events；
- 首期任务可由课次创建/变更流程生成，不做定时 cron。

---

## 10. 任务拆分表

### P4H-0 · 数据安全止血与错误出口（立即执行）

**依赖**：无；开始时仍必须重新确认工作树，不能把 2026-07-20 的 clean 结论当永久事实。

**只做**：

1. 新增 basename 为 `p4h_delete_guard.sql` 的 migration，按 §6.1 的规则分配未占用时间戳，revoke authenticated 对 courses/classrooms/class_sessions/course_lectures 的直接 DELETE；
2. 删除 `classroom/actions.ts` 的物理 `deleteClassSession`；
3. 旧 `/classroom/[id]` 页面移除 DeleteSessionButton；
4. 移除 `CourseCrudPanel` 的讲次垃圾桶；`deleteLectureAction` 改为固定拒绝 `LECTURE_DELETE_DISABLED`，等待 P4H-2 的归档 RPC；
5. 后台课次名暂时不再跳成员专属路由；P4H-8 再接抽屉；
6. 全局 404 改“上一级 + 首页”；
7. 增加回归测试或静态断言，确保业务源码没有对上述四类表的 `.delete()`。

**禁止**：本任务不改数据库生命周期、不重做列表、不做 CoursePicker。

**验收**：

- `rg -n 'from\\("(class_sessions|classrooms|courses|course_lectures)"\\).*delete' src` 零命中；
- 已结束课次无删除按钮；
- 讲次浏览/编辑区无删除按钮，直调旧 Action 返回固定错误码；
- 主管点击后台课次不进入课堂 404；
- 未知三级路径的 404 主按钮到二级路径；
- lint/typecheck/build 全绿。

### P4H-1 · 生命周期 migration 与 assignment 地基

**依赖**：P4H-0。

**执行**：§6.1 migration、权限键、数据库类型、基础 TS union；包含 865 个讲次原位回填 `status='active'`。

**验收**：

- 原 72 courses 行数不变；
- 原 865 course_lectures 行数、ID、course_id、no 不变；
- 原 classrooms/class_sessions 行数不变；
- owner teacher 均有 primary_teacher assignment；
- learning_support 回填 0 行；
- 正式表无物理 delete grant；
- DB rebuild、types check、lint/typecheck 全绿。

### P4H-2 · 状态 RPC、影响预览和 capabilities

**依赖**：P4H-1。

**执行**：§6.2、§7；包含讲次归档/恢复/影响预览、整份教学计划事务保存和 CourseCapabilities。

**测试文件**：

- `tests/p4h-lifecycle.test.ts`
- `tests/p4h-capabilities.test.ts`
- `supabase/tests/p4h_teaching_operations_assertions.sql`

**必测矩阵**：

- manager 非教师：canOpenManagement=true，canEnterLive=false；
- research 非教师：canEditTeachingPlan=true；有 page.edit 时 canOpenCoursewareWorkbench=true；canEnterLive=false；
- teacher 本班：canPrepare/live=true；
- support：canOpenManagement=true，prepare/live=false；
- 未开课可取消/恢复；
- 已开课取消拒绝；
- 课程被班级引用时 trash 拒绝；
- 正式历史班级 trash 拒绝；
- void 保留 session_events 行数；
- 有 release/课次引用的讲次可归档但不可物理删除；恢复后 ID/引用不变；
- `save_teaching_plan` 并发 base 过期返回 STALE_WRITE，且不部分写入；
- course.manage 无 page.edit 时可改讲次元数据但不能进入课件编辑态。

### P4H-3 · 课程产品 family migration 与术语分离

**依赖**：P4H-2。

**执行**：§6.3；本任务只做 schema、显式回填、RLS/RPC/query contract、seed 兼容和数据库类型，不改页面。

**停止条件**：seed 的 72 个 product_code、标题前缀、组合唯一或其 865 讲任一断言不成立时事务回滚并询问用户；非 seed course 按 §6.3 建一对一 legacy family，不构成停止条件。禁止改成标题模糊分组继续执行。

**验收**：

- E 系列 family 的 slug/元数据与 §6.3 一致，且其 variants=72、lectures=865；所有额外 course 各有一对一 legacy family；
- 所有 `courses.family_id` 非空，迁移前后 courses/lectures 总行数不变；
- 72 个 course ID、865 个 lecture ID 与 migration 前快照逐一相同；
- variant 唯一索引有效，无法插入同 family/grade/courseSeason/classType 的第二个 active variant；
- `scripts/seed-courses.mjs` 在空库可重建，在已有库幂等；
- `school_terms` 与 `courses.term` 的代码类型/注释不再共用命名；`courses.term_id` 未删除；
- `cw-import.mjs` 仍按 product_code 定位原 course，无需重绑 P6 数据；
- P4H DB assertion、db types、lint/typecheck 全绿。

**P6-9 接缝**：本任务完成后允许执行 P6-9 全量数据导入；但 P6-9 的浏览 UI 总验收等待 P4H-6。

### P4H-4 · 侧栏收口、学年学期归位与课程产品库

**依赖**：P4H-3。

**执行**：§8.1、§8.2。

**验收角色**：principal、research、teacher、sales/support。

**验收**：

- 课程页不再显示 `TermManager` 或“新建学期”；排课页能打开同一套学年学期管理；
- 只有 schedule.manage 可创建/启用运营学期；只有 course.manage、没有 schedule.manage 的教研直调被拒；
- 侧栏只有“课程”和有权限时的“制作工作台”，不再单列“资源库”；
- 当前 72 个 E 系列版本在产品库只显示 1 张 family 卡；
- research/teacher/principal scope 返回同一 family 的不同可见版本摘要；
- support 无 course.view 时无课程入口；
- 搜索 MFHK 编码或讲次名仍命中 family，并说明命中的版本；
- 筛选文案明确为年级/课程季节/班型；
- 移动端 390px 无横向滚动，zh/en 齐全；
- 列表 payload 无 page doc、binding 或 signed URL。

### P4H-5 · 课程产品页与显式教学计划编辑态

**依赖**：P4H-4。

**执行**：§8.3、§8.4；旧 variant `/courses/[id]` 同步接 §3.3 redirect。

**验收**：

- family 页可按年级/班型/课程季节切到全部真实组合，不存在组合 disabled；URL `variant` 可复制并恢复状态；
- 默认第一屏是课程元数据 + 版本选择 + 教学计划，不出现输入框/保存/垃圾桶；
- 点击讲次在同页 query 浮层只读预览，关闭后 variant 不丢失；
- principal 只读、teacher 只读、research 有明确“编辑教学计划”；
- 教学计划编辑只有一个保存按钮，事务批量更新；STALE_WRITE 不覆盖他人修改；
- 有历史引用讲次只能归档/恢复，引用计数与 P6 release 均不变；
- “用此版本建班”只对 class.create 显示并把 courseId 带到 P4H-7；
- `CourseCrudPanel` 与 `CoursewareTemplateEditor` 不再从正式产品页可达。

### P4H-6 · 唯一课件工作台与旧路由 308 收口

**依赖**：P4H-5。

**执行**：§3.2、§3.3、§8.5；复用 P6 Viewer/Editor/Action，不改 doc/revision/release 语义。

**验收**：

- `/dashboard/courseware` 是按讲次组织的任务队列，不再重复 72 个课程和讲次目录；
- preview/edit/切页/切轨始终停在 `/courseware/lectures/[lectureId]` 的同一 shell；
- 首次进入是 preview；无 page.edit 者伪造 `mode=edit` 仍不能写；
- 返回教学计划准确到 family + variant；
- §3.3 五类旧 URL 全部 308 到 canonical 地址，无重定向环；
- 旧模板路由不再写 `courseware_template`；P6 page soft-delete、revision、release、双轨、资源替换回归全绿；
- 从工作台进入 assets/adapt 后返回制作工作台，不进入课程目录；
- `pnpm bundle:report` 课程产品页不因编辑器显著增重，workbench 重组件保持懒加载；
- P6-9 以新入口抽查已导入讲次可浏览。

### P4H-7 · CoursePicker 与建班向导

**依赖**：P4H-6。

**执行**：§8.6、§8.7。

**验收**：

- 初始课程/教师均未选择；
- 输入产品码 3 个字符能在 500ms 内得到结果；
- family/版本/编码/讲次模糊搜索正确，年级/课程季节/班型组合筛选正确；
- 切换课程清空旧排课 override；
- 正式不完整课程只能建 planning；
- test 班带明确 Badge；
- 服务端仍校验 course enabled/purpose/teacher；
- 直接伪造 disabled production courseId 被拒；
- 创建成功后 primary_teacher 与 learning_support assignment 正确，support 未进入 classroom_members；
- 全流程键盘可操作。

### P4H-8 · 班级列表、班级详情与课次抽屉

**依赖**：P4H-7。

**执行**：§8.8、§8.9。

**验收**：

- 主管默认 all，教师默认 teaching，学辅默认 support；
- 多岗位可切换且 query 可分享；
- 主管课次打开管理抽屉，不进入课堂；
- 教师本课次出现备课/上课；
- support 只见负责班；
- cancelled 课次在“已取消”折叠组，可恢复；
- 已结束课次没有取消；
- 禁用动作都有原因；
- 无后台第三层 session route。

### P4H-9 · 教研/教师/学辅/主管工作台接缝

**依赖**：P4H-8。

**执行**：

1. `classroom_staff_assignments` 管理 UI；
2. 学辅任务表与任务卡；
3. dashboard 磁贴链接带正确 scope；
4. 教研课程磁贴进 research scope，制作磁贴进按讲次任务台；
5. 教师磁贴进 teaching scope；
6. 学辅磁贴进 support scope；
7. 主管异常磁贴进 all scope。

**禁止**：不实现外部通知发送。

**验收**：

- 同一账号 research+teacher 两个视角都存在；
- sales+learning_support 看得到客勤任务和负责班；
- support 不进入直播、不拿 asset URL；
- 移除 learning_support assignment 后相应班级立即消失；
- principal+teacher 可以管理全校，也只能进入自己授课课次。

### P4H-10 · 测试数据视图、回收与受控清理

**依赖**：P4H-9。

**执行**：

- course families/variants/classes 的 test scope；
- 批量归档测试班；
- 影响预览；
- admin-only 永久清理入口；
- CAS 零引用报告，首期只报告不自动删除 Storage。

**永久清理前确认**：

- 必须输入对象显示名；
- 二次显示将删除的 metadata 计数；
- 有 production 引用则整体拒绝；
- 写 domain_events；
- 清理失败必须事务回滚；
- 不允许前端循环逐行 delete。

**验收**：

- 正式数据不会出现在 test scope；
- 测试班批量归档可逐一恢复；
- 共享资源不被删除；
- 无 testdata.purge 者看不到且直调被拒；
- 清理一套无引用 test course+class 后正式课程/班级/资源计数不变。

### P4H-11 · 全角色 E2E、死代码清理与文档完成

**依赖**：P4H-10。

**执行**：

1. 全局 grep 删除旧 delete/archived 双逻辑；
2. 旧 classroom 页面只保留教学动作；
3. 确认 §3.3 旧路由无内部 Link 后，删除死的重复列表/模板编辑组件；redirect page 保留至少一个发布周期；
4. 更新 `04-roadmap.md` 状态；
5. 更新 `.claude/test-accounts.local.md` 的第二学生与岗位组合说明（本地文件，不提交）；
6. 添加 P4H DB/route audit 脚本和 package script；
7. 真实浏览器走全角色矩阵。

**E2E 路径**：

1. principal：产品库 all → E 系列 → 切版本 → 只读讲次预览 → 班级 all → 课次抽屉 → 无直播按钮；
2. research：产品库 research → 编辑教学计划 → 讲次只读预览 → 唯一 workbench 编辑/发布 → 返回原版本 → 使用班级摘要；
3. teacher：我的班级 → 备课 → 候课/上课；
4. support：负责班级 → 课前通知 → 客勤异常 → 课后跟进；
5. multi-role：scope 切换不串数据；
6. test：建测试班 → 带不完整课程 → 归档 → 恢复 → 管理员清理；
7. legacy routes：五类旧地址都到 canonical，无重复目录、无循环返回；
8. 404：课程/班级/课次各自返回正确上级；
9. P6：抽样讲 preview/edit/track/page/asset/release 回归，冻结课次仍 pin 原 release。

**最终命令**：

```powershell
pnpm lint
pnpm typecheck
pnpm messages:check
pnpm db:types:check
pnpm exec vitest run tests/p4h-lifecycle.test.ts tests/p4h-capabilities.test.ts
pnpm build
```

---

## 11. 完整权限矩阵

| 动作 | 主管 | 教研 | 教师 | 学辅 |
| --- | --- | --- | --- | --- |
| 查看课程产品库 | course.view/all scope | course.view/research scope | 默认仅任教关联 family | 默认无入口 |
| 切版本/查看教学计划 | 是，只读 | 是，默认只读 | 本人任教版本只读 | 班级摘要只读 |
| 修改产品/版本元数据 | 有 course.manage 时 | 是 | 兼教研时 | 否 |
| 修改讲次名/目标/顺序 | 有 course.manage 时 | 是 | 兼教研时 | 否 |
| 归档/恢复讲次 | 有 course.manage 时 | 是 | 兼教研时 | 否 |
| 只读预览已发布课件 | 是 | 是 | 本人任教版本 | 默认否 |
| 进入课件 edit mode | 有 courseware.page.edit 时 | 有 page.edit 时 | 兼教研且有 page.edit 时 | 否 |
| 发布 release | 有 courseware.release.publish 时 | 有 release.publish 时 | 兼教研且有权限时 | 否 |
| 永久删除讲次 | 否；仅 P4H-10 testdata purge | 否 | 否 | 否 |
| 管理运营学年学期 | schedule.manage | 默认否 | 默认否 | 仅显式授予教务角色时 |
| 查看全部班级 | class.view.all | 否；只看课程使用摘要 | 否 | 否 |
| 查看本人任教班 | 若有教学关系 | 若有教学关系 | 是 | 若兼教师 |
| 查看本人负责班 | 若有 support 关系 | 若有 support 关系 | 若兼学辅 | 是 |
| 建班/改排课 | class.create/class.manage | 默认否 | 默认否 | 有教务权限且在范围内 |
| 报名/转班/退班 | enrollment.manage | 默认否 | 默认否 | 是 |
| 备课/进入直播 | 仅真实授课关系 | 仅真实授课关系 | 是 | 仅兼教师 |
| 查看全部报告 | report.view.all | report.view.all | 本人任教 | 负责班摘要 |
| 课前通知/课后跟进 | 可监督 | 默认否 | 可写教学跟进 | 是 |
| 取消未开课课次 | class.manage | 默认否 | 默认发起申请 | 有教务权限时 |
| 作废已结束课次 | session.void | 默认否 | 否 | 否 |
| 永久清理测试数据 | admin/testdata.purge | 否 | 否 | 否 |

多岗位权限取并集，但直播/备课仍必须命中对象 teaching 关系。

---

## 12. 文案与错误码清单

### 12.1 必备中文概念

- 课程产品、课程版本、讲次、课件、班级、上课课次
- 课程库、制作工作台、我的教学内容、教研任务、使用中的班级
- 年级、课程季节、班型、学年学期
- 教学计划、编辑教学计划、只读预览、编辑这讲课件、返回教学计划
- 草稿、可用、已下架、测试、回收站
- 可用讲次、已归档讲次、停止新排课、恢复讲次
- 筹备中、进行中、已结班、已归档
- 我的授课、我负责的班级、全部班级、测试数据
- 主讲教师、助教、学辅
- 取消课次、恢复课次、作废课次
- 课件准备完成度、准备不完整
- 管理视图、授课视图、客勤与跟进
- 返回上一级、返回首页

### 12.2 固定错误码

- COURSE_IN_USE
- COURSE_TRASHED
- COURSE_NOT_ENABLED
- COURSE_FAMILY_DISABLED
- COURSE_VARIANT_NOT_IN_FAMILY
- LECTURE_DELETE_DISABLED
- LECTURE_ARCHIVED
- LECTURE_NOT_IN_VARIANT
- STALE_WRITE
- CLASSROOM_HAS_HISTORY
- CLASSROOM_HAS_ACTIVE_ENROLLMENTS
- CLASSROOM_PREP_INCOMPLETE
- SESSION_ALREADY_STARTED
- SESSION_NOT_CANCELLED
- SESSION_ALREADY_VOIDED
- FORBIDDEN_SCOPE
- INVALID_TRANSITION
- TESTDATA_HAS_PRODUCTION_REFERENCE

UI 只能针对这些已知码映射具体文案；未知码走统一 actionFailed。

---

## 13. 查询与性能约束

1. 产品库每页 20 个 family；CoursePicker 搜索最多返回 30 个 variant 候选。
2. variant/lecture/readiness/班级数/下一课次必须批量聚合，不允许按 family 或 variant 逐行 N+1。
3. 搜索串截断 80 字并转义 `% _ \\`。
4. 课程产品库和产品详情初始请求不得下发 page doc、bindings、signed URL；只有打开 `lecture` 预览才按当前页懒取。
5. 班级列表不得下发 roster 全量，只返回 count。
6. 管理抽屉按单课次懒取详情。
7. CoursePicker 首次不加载 72 个版本或 865 讲明细；输入/筛选后仅返回紧凑候选。
8. 讲次预览每次只下发一页 doc 和该页 URL；切页复用 P6 当前按页加载合同。
9. 任何新 client bundle 前后执行 `pnpm bundle:report`；产品库和产品页不得因引入 Viewer/Editor 显著变大，重组件必须动态加载。

---

## 14. 数据回填、上线与回滚

### 14.1 回填

- courses.purpose 全部 production；
- 显式 72 个 MFHK courses 归入 `xueersi-e-primary-math-cn` family，原 course/lecture/P6 ID 不变；
- course_lectures.status 全部 active；
- classrooms.purpose 全部 production；本地固定测试班由 P4H-10 执行时单独标 test，不把本地 ID 写入 migration；
- classrooms.operational_status：archived → completed，其余 → active；
- owner teacher → primary_teacher；
- 其他 teacher members → assistant_teacher；
- 不猜 learning_support。

### 14.2 上线顺序

1. P4H-0 revoke delete；
2. P4H-1 lifecycle/assignment schema；
3. P4H-2 RPC/capabilities；
4. P4H-3 family schema 与显式 72 版本回填；
5. P4H-4/5 产品库与教学计划；
6. P4H-6 canonical workbench/redirect；
7. P4H-7/8 建班与班级；
8. P4H-9 多岗位工作台；
9. P4H-10 test cleanup；
10. P4H-11 E2E/文档。

不得先上线依赖新列的 UI 再补 migration。

### 14.3 回滚原则

- P4H migration 不删除旧列；
- 新列有默认值，旧代码可继续读；
- family 关系使用 `on delete restrict`；紧急回滚前端时保留 family_id，不把 72 个版本重新建表或清空；
- 旧 course/courseware URL 的 redirect 至少保留一个发布周期，回滚 UI 也不得删除 P6 数据；
- assignment 新表可停用而不影响 classroom_members；
- revoke DELETE 如需紧急回滚，只能通过新 migration 恢复，不手工 grant；
- 已写入的 cancelled/voided/history 不回滚删除。

---

## 15. Definition of Done

P4H 只有同时满足以下条件才能标完成：

- 课程产品库只按 family 展示，当前 E 系列 72 版本不再铺成 72 行；
- 课程浏览只有“产品库 → 产品教学计划”两层，讲次预览留在同页；
- `/courseware` 只有一个按讲次任务台和一个 canonical workbench，不再存在第二套课程/讲次目录；
- 浏览态无课程/讲次输入框、逐行保存或删除；编辑教学计划必须显式进入且只有一个保存动作；
- “新建学期”不在课程页，课程季节与运营学年学期文案/数据合同分离；
- 建班课程选择可模糊搜索和筛选；
- 主管、教研、教师、学辅默认视角符合 §4；
- 多岗位 scope 切换正确；
- 主管管理课次不再落课堂 404；
- 业务源码不存在产品/版本/讲次/班级/课次物理 delete；
- 讲次归档不改变任何 page/release/class/session 引用；
- 课程下架不影响既有班级；
- 测试数据独立且可恢复；
- 已完成课次不可取消但可受控作废；
- support 无直播/资产权限；
- 404 返回上一级；
- DB assertions、Vitest、lint、typecheck、messages、build 全绿；
- roadmap 与本文件进度同步；
- 每个 P4H 子任务有独立提交和验收记录。

---

## 16. 遇到以下情况必须停止并询问用户

1. 发现 production 数据已经依赖物理删除才能维持业务；
2. 需要删除或重绑 P6 已发布 release/CAS 对象；
3. seed 明确列出的 72 个 product_code 不能按 §6.3 显式归为一个 E 系列 family，或该 family 回填后不是 72 variants / 865 lectures；
4. 发现 `courseware_template` 仍是某条生产编辑链路的唯一权威数据，无法安全退出旧模板 UI；
5. 一个班级必须支持多个 primary_teacher；
6. 学辅需要真实发送短信/微信/邮件；
7. 需要让主管实时旁听课堂；
8. 需要把 learning_support 加入 classroom_members；
9. 测试数据与正式数据无法可靠区分；
10. 永久清理影响到 production 引用；
11. 计划 basename 已存在，或无法分配严格递增且未占用的 migration 时间戳；
12. 当前工作树有未提交改动且任务会修改同一文件，无法确定所有权。

除此之外，按本文固定决策执行，不再让执行 Agent 自行重新设计产品。
