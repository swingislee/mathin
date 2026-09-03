# Mathin 整体规划 · 04 R1 路线图

> **规划状态**：`active`
>
> **当前施工阶段**：`R1-Live-2 · 生产单老师试用`
>
> **R1 暂停位置**：`R1-9 · P6-9 与 Production 1.0 完整性`；已有来源 manifest、导出器和课程结果保留，真实 1305 行 inventory、全量对象审计及 R1-10～18 不阻塞首次内部生产使用。
>
> **SML 暂停位置**：`SML-0 · 合同与金标冻结`；空间数学可按独立权限或 Feature Flag 并行，不进入 R1-Live Gate。
>
> **当前运行状态**：Gate 1 已通过，Gate 2 仍等待正式教师点名持久再读与权限对照。2026-08-30 讲次课件预览 hotfix preflight 已只读确认 Xiaomi 数据库 ledger=`236`、head=`20260830000700_teacher_microcourse_editor_unification`，当时应用已运行 `76f0f9a…`；本轮只把来源提交 `50a1648…` 移植为生产候选 `a165004…`，current/previous=`20260830-080555` / `a165004…` 与 `20260830-045421` / `76f0f9a…`。本地及 Xiaomi production build、原子 release、健康/鉴权/bundle/业务不变量 postflight 通过；未执行 migration，岗位、班课、微课、课程 release、审核快照和 Storage 未写入。生产管理员 verified MFA=`1`，教师/教研岗位成员=`6/4`；班级/课次/报名/点名与 Storage=`4/19/1/0/125917`，Storage bytes=`51524182412`，`operational_errors=1956` 且发布后无增量。课堂、教师微课重构及既有 hotfix 的产品人工验收仍分别 pending，不关闭 Gate 2。
>
> **当前 P0 状态**：2026-08-25 产品负责人确认内部教师更习惯手机号注册登录。`手机号或邮箱 + password` 已部署生产：手机号只接受绑定具体号码的一次性员工邀请，不发送/伪造验证码，不开放全局邀请码手机号注册，账号仍以单一 `auth.users.id` 为主体。机器 postflight 已通过；真实教师尚未消费手机号邀请并完成 password 登录，因此状态为 `DEPLOYED / PENDING USER ACCEPTANCE`。
>
> **双轨执行**：生产端由 1 名正式教师在现有正式班级、课次和花名册上持续试用，优先反馈 P0/核心 P1；开发端可并行尝试产品负责人选中的新功能。新功能只有在开发目标完成受影响检查并由产品负责人初步验收后，才成为生产候选；完成精确版本/迁移登记、生产 preflight、可回退发布和 postflight 后，才能记为生产已部署。开发通过不等于生产通过，新功能也不改变 Gate 2 的点名与权限退出条件。
>
> **核对日期**：2026-09-03；生产事实仍沿用 2026-08-30 已确认的 ledger/head=`236 / 20260830000700_teacher_microcourse_editor_unification`、应用 `a165004…`、讲次课件预览性能 hotfix 及去标识化 postflight；`76f0f9a…` 与 ledger 236 在该轮 preflight 前已运行，不把此前发布归因于该 hotfix。`DEV-SCHOOL-OPS-1` 当前先以真实小地推种子验收 Phase 1C 的批量分配与初次电联；该开发预演没有生产 schema、数据库、Storage 或写入。其余依据 active doc 00/25/30、代码与迁移、本机隔离验证、Xiaomi 运行核查和 `mathin-R1-Live-讨论稿.md`。

## 1. 两个交付事件

| 事件 | 完成结果 | 不作为前置条件 |
| --- | --- | --- |
| **R1-Live · 内部生产试运行** | Gate 1 与 Gate 2 均通过：正式数据有当前备份和防误清底座；1 名公司教师以正式身份、真实班级/课次/花名册完成一次整班点名，记录可再次读取，管理员可见，无权限主体不可见 | 六个公开模块内容完整、1305 讲全量来源审计、全量视觉/E2E/容量/恢复演练、受控 rollback 演练、错误 release 标签、独立观察员验收、14 天 RC |
| **Production 1.0 · `v1.0.0`** | doc 00 的完整产品合同、doc 25 的量化硬门、正式课程基线、恢复演练和发布审批全部成立 | 仅有明确接受且不影响安全、数据正确性和核心旅程的例外 |

R1-Live 完成即代表 Mathin 进入公司内部生产使用。它产生的身份、班级、课次、学生和考勤都是正式业务事实，后续初始化、演练或发布不得按测试/RC 数据删除。

### 1.1 施工与门禁规则

1. R1-Live 只保留两个结果 Gate。原 Gate 0 变为永久范围规则；原 Gate 3 的最低保险丝并入 Gate 1；原 Gate 4 与 Gate 2 重复，独立观察改为上线后可用性证据。
2. 只有越权/泄露、数据丢失、无效引用、并发或历史破坏、登录不可用、核心入口不可达、核心闭环无法完成等 P0/核心 P1 才能硬阻断。
3. 内容完备度、课程/备课成熟度、审核轮次、教师时间冲突、点名时机、资源预载、完整运维演练和观察窗口是提示、任务或 Production 1.0 证据，不得阻止管理员或教师作出可逆的日常运营决定。
4. 当前 Gate 已规划且不扩张范围的步骤由 Agent 在每轮目标、写态、可逆性、漂移和证据自检后直接推进，不拆成重复“允许”确认。需要真实身份/班级输入、人工登录验收、清理、不可逆动作或范围扩张时才停下。
5. 状态只允许 `PASS`、`BLOCKED`、`UNKNOWN`、`NOT REQUIRED`。代码存在但未在目标环境运行，不能记为目标环境 `PASS`。
6. 当前阶段采用双轨施工：生产端保持 1 名正式教师的小范围真实试用；开发端允许按产品负责人选择实现新功能。未晋级的开发变更不得修改生产状态，也不得把开发数据、固定开发账号或测试结论登记为生产事实。
7. 新功能按“明确范围与风险 → 相关定向检查 → 开发端人工初验 → 独立 Git 提交 → 生产目标/备份与 current/previous preflight → 小增量发布 → 健康、错误增量和业务不变量 postflight”晋级。任一步失败即停留或回退到开发端；涉及迁移、鉴权、权限、清理或不可逆数据动作时继续执行对应的更严格门禁。

### 1.2 运行时检查分类

| 分类 | 继续硬阻断 | 只提示或形成待办 |
| --- | --- | --- |
| 身份与权限 | 未登录、无 capability、越过班级/课次/学生 scope | 岗位组合是否“理想”、是否由独立人员复核 |
| 数据结构 | 畸形输入、无效课程/讲次引用、已删除课次、冻结并发冲突、历史物理删除 | 课程有多少讲未完成、备课产物/审核/检查项是否齐全 |
| 班级运营 | 无名称、无有效主讲、无有效学期、排课引用不属于所选课程 | 自由班、无课件 release、教师时间冲突、是否立即启用 |
| 课堂执行 | 非任课教师、课次不存在/取消、冻结快照结构不一致 | 点名尚未完成、课件仍在预载、网络/P2P 警告、无 release 的空白课堂 |
| 运维 | 没有当前备份、生产可被 reset/seed/purge、没有可识别的 current/previous 或错误查询位置 | 完整恢复演练、受控 rollback 演练、错误 release 标签、全量监控/RPO/RTO |

### 1.3 测试结果口径

- `pnpm r1:live:test` 只运行当前两个 Gate 的源码级合同：正式身份安全、建班/学年结构、课堂连续性、生产写目标和对象防误清；当前为 6 个文件、52 项。它不能替代隔离数据库 SQL、固定账号 Playwright、生产只读核查或真实教师闭环。
- `pnpm r1:regression` 保留 R1-1～16 累积的 23 个文件、179 项历史合同，用于定位旧阶段回归，不计作当前 R1-Live 的 179 项门禁。`pnpm r1:test` 仅作为 `r1:live:test` 的兼容别名。
- `pnpm test` 继续运行 93 个文件的全量 Vitest 回归，其中包含 279 项独立 SML 测试；全量回归留在工程 CI，但其总数和通过状态不直接改变 R1-Live Gate。CI 不再在全量测试后重复运行历史 179 项集合。

## 2. R1-Live Gate 状态

| Gate | 状态 | 已完成证据 | 唯一退出差距 |
| --- | --- | --- | --- |
| **Gate 1 · 可安全开始** | **PASS** | 生产目标组合指纹、部署和匿名计数已登记；危险 fixture/rebuild/import 拒绝 Xiaomi；唯一正式 admin 已完成 verified MFA，首名真实教师为 active `staff` 并有 `research`/`teacher` 岗位；生产 purge 仍要求当前数据库指纹、active manifest、显式 `purge_allowed` test 根和精确影响计数，当前准删数为 0。2026-08-30 postflight 数据库 ledger/head=`236 / 20260830000700_teacher_microcourse_editor_unification`，应用 current/previous=`20260830-080555` / `a165004…` 与 `20260830-045421` / `76f0f9a…`；原子发布健康门和 `operational_errors` 查询位置已知。最近 PostgreSQL 写前备份 `mathin-db-prechange-20260830T042220Z-tmc-unification-8b9b195` 与 PostgreSQL+Storage 同批次全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497` 已核对 | 无。previous 实际回切、恢复演练、异机/静态加密备份和错误 release 标签属于 Production 1.0 |
| **Gate 2 · 首个真实教师闭环** | **BLOCKED** | 学生、班级、课次、报名、点名 UI/RPC 与 RLS 已实现；本轮运行时合同允许自由班/未完整课程启用，备课质量项、点名前置、资源预载和无 release 均不阻断开课；本机隔离固定账号 Golden Path 1/1 已完成建班→自动课次→`lead` 报名→教师保存迟到/备注→换页再读。生产已有 1 个 production 班级、15 个课次和 1 条 active 报名，主讲 1、学辅 0；学年修复只调整三类对象的周期引用，未升年级，应用已发布且健康 | 正式教师完成登录→进入课次→开课/点名→保存→刷新/重登再读；正式管理员可见，匿名及一个既有无权限主体不可见；P0/核心 P1=0 |

`R1-Live-N` 表示当前只关闭 Gate N。Gate 1 通过后推进 `R1-Live-2`；Gate 2 通过后立即向第一批公司教师开放，不再追加新的上线 Gate。

生产单老师试用已经开始，但 Gate 2 状态仍由表中的目标环境结果决定。开发端新功能的实现、机器检查或人工初验均不能替代正式教师点名持久再读和权限对照。

## 3. 首个真实教师闭环

```text
正式教师登录
→ 进入 /[locale]/dashboard/classes
→ 打开分配给自己的 production 班级和真实课次
→ 允许在课件未完整、未完成备课审核或尚未点名时进入课堂
→ 为花名册逐人登记 present / absent / late / leave
→ 保存
→ 刷新、退出并重新登录
→ 再次打开同一课次，确认记录仍存在
→ 正式管理员读取同一记录
→ 匿名请求和一个既有无权限主体不能读取该班记录
```

| 层 | R1-Live 合同 |
| --- | --- |
| 身份 | 当前使用邮箱/password 和一次性员工邀请；`auth.users.id` 是唯一账号锚点。手机号、OTP、微信/QQ 绑定按 [`r1-live-auth-identities.md`](r1-live-auth-identities.md) 后续启用，不延迟首个闭环 |
| 建班 | 管理员决定 planning/active；正式自由班、课程未完整和教师冲突只提示。创建向导在字段所在步骤就地校验名称、主讲、学期、日期、时间、时长与排课日；学辅可留空，若与新主讲相同则立即清除并提示。服务端仍校验权限、输入及 course/family/lecture 引用 |
| 备课/开课 | 备课产物、三项审核、检查项和 release 是质量信号。教师可冻结当前 release，也可把 `releaseId=null` 的空白/本次覆盖快照用于课堂；点名和资源预载不再是开始按钮前置 |
| 写入 | `saveAttendanceAction` 最多接收 200 条合法状态并 upsert；可在课前、课中或课后登记 |
| 授权 | 本班教师与管理员可读写允许范围；匿名和无关系主体拒绝。前端隐藏不替代数据库 RLS |
| 错误 | 核心失败必须显式显示；R1-Live 能按时间、route、digest 查到即可，release 标签进入 Production 1.0 |

班级 `operational_status` 表示运营人员的选择，不是课程或备课认证。课程/讲次发布、审核、冲突和准备度继续展示并形成工作项；真正的硬门只留在创建时的引用完整性、权限和不可变历史边界。无 release 课次开课时冻结空白/覆盖层快照，后续发布不改写已开课历史。

## 4. 已关闭阶段：R1-Live-1

Gate 1 已按以下顺序关闭：

1. **目标、身份和防误清（已完成）**：Xiaomi 目标指纹、唯一 admin MFA、真实教师岗位、写入口 target policy、current/previous、健康探针、错误查询位置和 protected-only active manifest 均已登记。当前 `purge_allowed=0`，所以没有任何永久清理候选。
2. **运行时门禁收敛（生产部署完成）**：迁移 `20260822000100` 先移除全课程 release 完整度门；`20260822000200` 再把自由班/启用、备课产物审核、点名前置、资源预载和无 release 收敛为提示，同时保留权限、输入、引用、状态和冻结守卫。Xiaomi 账本、函数定义/权限、应用 release、双语登录、匿名重定向和业务/Storage 零漂移 postflight 均已通过。
3. **当前备份（已完成）**：`mathin-20260822T093529Z` 同批次保存当前 PostgreSQL custom dump 与 Storage 归档；数据库 TOC 3661 项、Storage 125135 个文件、源前后清单和全部 SHA-256 均通过独立只读复核，生产指纹/账本/对象计数无漂移。备份位于 Xiaomi 外置 exFAT 盘，读取边界与未加密/同机限制已登记；恢复、异机副本和静态加密仍属 Production 1.0。

当前进入 `R1-Live-2`。人工验收发现旧学期模型把现有班级的秋季课次挂在 `2026 春季学期`；产品负责人确认春季结束日为 `2026-06-29`，并采用“学年头部 + 暑/秋/寒/春四个日期可后补周期 + 显式预览后升年级”的方案。`20260823000100_r1_live_school_year_periods` 已通过最终空库重建、旧库升级不变量、回滚式晋级演练、52/52 当前 Gate 合同、完整 CI、固定主管 zh/en 只读旅程、生产 preflight、完整回滚演练和独立 postflight，并与应用 `20260822-181331` / `b899942…` 同步上线。生产现有 1 个班级、15 个课次和 1 条报名均归到 `2026–2027` 秋季，其他业务事实不变，2026 学年没有启用，学生没有升年级。随后按产品负责人的生产试用反馈收敛班级命令区、shadcn 日历/日期时间控件、通知描述、备课待办窗口和绘图工具栏，`20260823000200_r1_live_preparation_attention_window` 与应用 `20260822-193605` / `5041fe1…` 已上线；这些体验项依次接受人工产品验收，不新增 Gate。2026-08-23 起，生产主线转为单老师持续试用，首个硬退出动作仍是正式教师点名持久再读与权限对照；产品负责人选中的新功能可在开发端并行预演，并按 §5.2 的晋级门逐项部署，不要求等待 Gate 2 关闭。正式业务写入不要求每新增一行就替换 active protection manifest：现有 purge 必须命中显式 `purge_allowed` test 根，且 production 根在数据库层永久拒绝。只有未来准备授权具体清理根时，才针对当时的删除闭包生成新的 replacement manifest 并单独审批。

## 5. R1-Live-2 双轨施工

### 5.1 生产端单老师试用

- **已完成**：隔离目标的建班→空白/未完整课件开课→报名→点名保存→重新读取 Golden Path；复用固定账号和 gitignored manifest，未注册账号，执行后可变业务对象残留为 0。
- 生产端当前只由 1 名正式教师使用现有 production 班级、15 个课次和真实花名册；正式姓名、联系方式、截图和视频只进入受控证据位置。
- 首个 Gate 2 证据仍执行登录→课次→点名保存→刷新/重登再读→管理员读取→既有无权限主体拒绝；生产试用中发现的 P0/核心 P1 优先于开发端新功能。
- 教师冲突、备课完成率、视觉细节和非核心模块问题不改变 Gate 2 退出条件；可以进入待办池，也可以由产品负责人选入开发预演轨。
- Gate 2 通过后直接开放第一批内部教师；独立观察员、14 天/5 节课堂、跨浏览器矩阵和完整运维演练作为 Production 1.0 扩容证据。

### 5.2 开发端新功能预演与生产晋级

- 每项新功能先写清用户动作、受影响路由/表/RPC、数据与权限风险、生产可见范围和回退办法；默认只在本机隔离开发目标使用固定开发账号验证。
- 实现后先运行覆盖变更风险的最窄机器检查。UI/交互执行受影响测试与必要静态检查；数据库/API、鉴权、共享模块或发布边界变更增加相应集成、RLS、安全或构建检查。
- 机器检查通过后交由产品负责人在开发端做初步验收。只有目标旅程可用、无已知 P0/核心 P1、双语与失败状态符合该功能范围，并得到明确“可上生产”的确认，才进入生产候选。
- 可扩展互动使用版本化 capability provider 和统一 conformance：普通 renderer 复用既有输入原语时不逐个建立人工里程碑；只有新增输入原语、修改路由/输入所有权算法、跨 iframe 协议或真实设备回归才触发新的人工输入 Gate。显式 provider 声明与未知能力 fail-closed 仍是安全边界。
- 课堂体验升级 M0–M4 已于 2026-08-25 在本机开发目标完成产品负责人整体验收；M5 候选 `8c303a2` 完成 Stage A 后，产品负责人于 2026-08-26 确认 Stage B1 与 B2 通过。Stage B3 核对到 production 当前课次/发布引用含 399 条 H5-kind 页面记录、409 条 binding，均指向未接 bridge 的 `aixuexi-page-doc-v1`，遂关闭 H5 开关；这些记录不等于 399 个实际 iframe，Aixuexi 全量 revision 只读审计为 5442 页、其中 9 页含 `embedded_h5`。共同 bridge、包 SHA-256 权威表、单一 Smart 开关与工具派生回退锁已通过隔离提交 `964ca5e` 部署；H5 开关保持 false，空档案表不授权任何现有 package。生产已有 v2 checkpoint，不得直接切回不认识 v2 的旧 bundle。
- 生产部署以独立可回退提交为单位，记录精确 commit/migration 和目标；发布前核对生产指纹、最近可用备份、current/previous、迁移/数据影响与回退点，发布后核对健康、错误增量、核心 Smoke 和受影响业务不变量。未完成 postflight 的功能只记为“已部署待验收”，不能记为生产通过。
- 开发新功能不自动成为 Gate 2 blocker。只有它修改共享登录、授权、班级、课次、课堂或点名链路时，才追加对应 R1-Live Smoke；失败时先回退或关闭该功能，保持单老师试用可继续。

#### DEV-ORG-1 · 机构设置与校区/教室重构

`DEV-ORG-1` 是产品负责人于 2026-08-28 选入并于 2026-08-29 明确授权发布的开发预演增量，当前状态为 **DEPLOYED / PENDING USER ACCEPTANCE**，不改变 R1-Live Gate 2。用户闭环固定为“维护机构资料与统一时区 → 在校区目录下维护教室 → 建班选择默认教室 → 单节调课或批量应用未来默认 → 课表按场地筛选 → 用机构级学年、教学日历和排课默认生成课次”。校区只作为教室的上一级目录，不承担班级、员工、权限、学年、规则或 Feature Flag 作用域；不建设全局校区切换、校区员工授权和跨校区交通规则。

页面按工作对象拆分：`/dashboard/organization` 维护机构名称与 IANA 时区，`/dashboard/campuses` 及详情页维护校区和教室，`/dashboard/academic-years` 统一承载学年、教学日历和内联的新班级默认课次时长，`/dashboard/schedule` 只承载课表；系统“运行与错误”下承载能力发布。产品负责人于 2026-08-29 确认旧地址不保留兼容跳转，因此 `/dashboard/organization-settings`、`/dashboard/schedule/calendar` 与 `/dashboard/schedule/defaults` 直接退役。校区/教室内部代码由数据库生成且不进入页面、表单和公开 DTO；原始 JSON 规则编辑器停止新写入，历史版本只读，财务发布门继续固定关闭。

数据增量按“兼容数据层 → 校区/教室资源页 → 班级/课次闭环 → 日历排课 → 设置与开关拆分 → 旧合同清理”提交。首轮增加结构化 `default_room_id`、课次 `room_id` 与来源字段，保留并双写旧 `classrooms.room`、默认校区列和旧 RPC 至少一个生产回退窗口。旧文本教室、多校区歧义、学年/周期冲突和仍生效的校区级规则或开关必须在迁移 preflight 中 fail-closed；开发验收并明确退休 previous 后，才能以单独授权增量删除兼容字段和函数。任何生产 preflight、备份、迁移、发布或回退仍须单独授权。

开发验收覆盖数据库回填/RLS、机构时区边界、日历优先级、结构化教室冲突、未来课次传播、zh/en 资源页和固定账号完整旅程。机器检查通过只记为“开发可验收”；产品负责人确认后才可成为生产候选。

截至 2026-08-29，兼容数据层与产品页面 commits `596f498`～`0d47f77`、代码字段隐藏修复 `bc018c2`、固定账号旅程 `9aba9aa` 及后续 Dashboard 增量已随候选 `34f07e8…` 上线。生产 preflight 确认唯一旧教室文本 `3305`、唯一活跃校区、有效校区级规则/开关覆盖 0、学年重复 0；7 个 migration 通过新鲜 PostgreSQL 备份、完整回滚/零残留演练和正式事务，把 ledger 从 212 推进到 219，并回填 1 个结构化教室、1 个班级和 15 个课次。应用 current/previous=`20260828-174731` / `34f07e8…` 与 `20260828-075322` / `c7c8219…`，机器 postflight 通过；登录态 Chrome 刷新超时，产品负责人生产页面验收仍为 **UNKNOWN**。证据见 [`organization-dashboard-production.md`](../evidence/r1/organization-dashboard-production.md)。

#### DEV-DASH-1 · 后台职能导航与可扩展资源列表

`DEV-DASH-1` 是产品负责人于 2026-08-29 提出并明确授权发布的后台信息架构增量，当前状态为 **DEPLOYED / PENDING USER ACCEPTANCE**，不改变 R1-Live Gate 2。侧栏使用“总览 → 学科运营 → 教学 → 教研 → 组织管理 → 系统管理”的职能顺序；学科运营覆盖学生从线索、活动、跟进到在读服务的生命周期，教学承载班级、学年和课表，教研承载课程产品、研发任务、审核与课件资源。所有可见 staff 入口使用不同语义图标，单一的 90 分钟排课默认不再占用侧栏条目。

机构资料、校区目录和教学日历采用线性设置区或表格，不再默认堆叠卡片。班级无显式 scope 时先选择本人任教班级，其次本人负责班级，仅在两者均为空时回退到全部班级并提示；个人班级保留信息卡，`all` 与 `test` 使用同一套 shadcn `Table` 圆角完整描边表格壳，列表按 20 条分页。课件资源库首屏和后续页每次只读取 11 条判断下一页、最多展示并生成 10 条预览签名，避免为整库对象生成临时 URL。

本机提交 `e8107e0`、`06f5104`、`b644d14` 与 migration `20260829000100_classroom_personal_scope_default` 已落地；定向 Vitest 4 文件 22/22、TypeScript、受影响 ESLint、zh/en 消息合同、路由审计及固定开发账号 Playwright 2/2 通过。该增量已随 `34f07e8…` 上线；production route manifest 已确认机构、校区、学年与能力发布路径存在，旧设置路径不存在，PostgREST schema cache 与匿名拒绝通过。生产登录态侧栏、班级 scope 和资源分页仍待产品负责人刷新后人工验收。

#### DEV-DASH-2 · Dashboard 表格与分隔语义统一

`DEV-DASH-2` 是产品负责人于 2026-08-29 提出并明确授权发布的视觉语义增量，当前状态为 **DEPLOYED / PENDING USER ACCEPTANCE**，不改变 R1-Live Gate 2。Dashboard 顶层数据表统一复用共享外壳：shadcn `Table`、`rounded-2xl`、完整 `border-line` 和 `bg-card`；宽表只在表格自己的滚动容器内横向滚动。表格表头与数据行的边界服务于行列辨识，可以保留；普通列表、表单字段、状态摘要和导航不得借用表格分隔语义。

普通页面固定只有一条页头结构线：它位于页面标题之后。横向状态导航、筛选和页面操作位于该线下，并与正文属于同一工作区；命令面板底部及正文顶部不得再增加重复分割线。机构资料、学年概览和排课默认使用字段间距、标签层级与局部底色组织，不再为每个字段画上下边线；只有教学日历、排课默认等真正独立的大内容板块可以在区块起点使用一条分割线。

验收至少覆盖机构资料、全部班级、学生、校区、教学日历、课件资源和系统错误表；固定管理员 zh/en 页面须确认页头单线、横向导航下方无线、顶层表格外壳一致，390px 下宽表滚动仍局限在表格容器。生产发布已完成，人工页面验收仍需在当前 release 上执行。

本机提交 `e1e8c87` 已落地共享 `DashboardTableShell`，并迁移 Dashboard 与学校运营组件内全部 shadcn `Table` 使用点；机构资料、学年、排课默认、活动列表与个人班级摘要已移除逐项分割线。定向 Vitest 3 文件 14/14、TypeScript、全量 ESLint、doc 24 Dashboard 审计、固定管理员 Playwright 1/1 和本地/生产双 build 通过；该代码已随 `34f07e8…` 上线。Chrome 自动刷新超时，因此生产视觉签收仍为 pending。

#### HOTFIX-20260829 · 自由班自动排课与来源 H5 透明层

产品负责人已在开发版本通过自由班排课改动并授权上线。`557fc51` 把来源 H5 容器白底改为透明，`7601c86` 让自由班按选中周几与教学日历依次自动排课、允许逐讲改时间并复用冲突检查；应用候选 `7601c86…` 已通过本地/远端 production build 和无浏览器 postflight 上线。两讲暑期 A+ 内容不重导，数据库、课程 release 与 Storage 写前写后完全一致。来源/审阅工具 `26adab7` 是 localhost-only 私有 CLI 提交，没有独立生产服务；详细边界见 [`free-class-h5-hotfix-production.md`](../evidence/r1/free-class-h5-hotfix-production.md)。

#### HOTFIX-20260829 · 管理员自授员工岗位

产品负责人报告顶层管理员无法给自己分配教师/教研岗位，因而不能为其他老师的短期专题班制作课件。`dc8b5b0` 把员工页与 `grant_staff_role` / `revoke_staff_role` 的 self-target 规则改为只对顶层 admin 放行，普通 staff 自授岗和管理员自停用继续拒绝；生产 rollback rehearsal 又发现旧函数保留显式 anon execute，`ba98a8e` 按当前 RPC 标准收紧为仅 authenticated 执行。最终 migration `20260829000200_admin_self_staff_roles`、应用 `ba98a8e…` 已通过新鲜写前备份、完整 rollback/零残留/formal、双 production build 与独立 postflight，ledger=`220`、current=`20260828-195733`。发布没有替管理员实际新增岗位；产品负责人仍须在员工页自行授予所需岗位并验证短期班课件制作。完整证据见 [`admin-self-role-hotfix-production.md`](../evidence/r1/admin-self-role-hotfix-production.md)。

#### HOTFIX-20260829 · 教研课次页课件入口

生产 `ba98a8e…` 已包含 DEV-TMC-2 schema 与权限，但普通课次页仍用任课教师 `canPrepare` 决定是否显示“编辑课件”，导致教研虽能从审核队列进入方案工作区，却在老师的课次页只看到只读提示。`bf81aa4` 把入口拆成课件制作权与教学运营权：任课教师或同时具备 `courseware.review + courseware.microcourse.author` 的教研都能打开方案；教研仍看不到试讲、完成备课、点名、课堂控制和“本节使用”。定向 Vitest 9/9、固定账号 Playwright 1/1、双 production build 与 app-only 原子发布通过，current/previous=`20260829-031327` / `bf81aa4…` 与 `20260828-195733` / `ba98a8e…`；ledger、业务、Storage 和错误基线零漂移，生产页面刷新验收 pending。证据见 [`teacher-microcourse-research-entry-hotfix-production.md`](../evidence/r1/teacher-microcourse-research-entry-hotfix-production.md)。

#### HOTFIX-20260829 · 教师微课来源预览

产品负责人在生产导入正式课程整讲后，来源页持续停在加载态，提交审核后通用审核页又显示没有已发布课件。生产只读核对确认待审快照未丢失：32/32 页均为来源运行时页，283/283 个必需绑定完整。根因是空 `binding.kind` 让解析器跳过钉死 `cw_asset_objects` 的 H5 kind/hash，并按普通对象生成错误签名；通用讲次审核入口同时只读取 current release，无法预览首次发布前的提交快照。`6185352` 已以 pinned object 为权威解析 H5 package，并把教师微课 active review 转到不可变微课审核路由。定向 Vitest 17/17、固定账号 Playwright 2/2、双 production build、app-only 原子发布与独立 postflight 通过，current/previous=`20260829-045135` / `6185352…` 与 `20260829-033955` / `59cc342…`；ledger、业务、审核快照、Storage 与错误基线零漂移，生产页面刷新验收 pending。证据见 [`teacher-microcourse-source-preview-hotfix-production.md`](../evidence/r1/teacher-microcourse-source-preview-hotfix-production.md)。

#### HOTFIX-20260830 · 讲次课件预览翻页性能

产品负责人明确要求把来源提交 `50a1648` 热推生产。生产当时已运行 `76f0f9a…`，直接 cherry-pick 只在来源 runtime 及其测试与父级握手补丁相邻处冲突；隔离候选 `a165004…` 保留这两个文件在 `50a1648` 的最终实现，排除父级 `65e3638` 的微课列表 UI、文案和规划改动。讲次只读预览改为首屏当前页、浏览器页缓存、未命中页级 Action、相邻页预取与 History API 查询参数同步；来源 runtime 按 immutable package/entry 复用 iframe，页面只更换 render payload；教师微课同讲 binding 和 signed URL 改为批量读取。定向 Vitest 10/10、messages 5205×2、发布器全库 ESLint/TypeScript、本地和 Xiaomi production build、原子切换与独立 postflight 通过，current/previous=`20260830-080555` / `a165004…` 与 `20260830-045421` / `76f0f9a…`。ledger/head、业务、Storage 与 `operational_errors` 零漂移；机器检查不证明真实多页课程的冷／热翻页手感，状态为 **DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCTION USER ACCEPTANCE**。证据见 [`courseware-preview-performance-hotfix-production.md`](../evidence/r1/courseware-preview-performance-hotfix-production.md)。

#### HOTFIX-20260829 · 自研课堂互动状态同步

产品负责人报告教师在 iPad 操作自编数独时，填数与突出显示只改变本机。根因是 `game-page-v1` 新适配链只传递 `interactive`，遗漏既有 `GameMirrorState` 的 `mirror/onMirror`，因此没有生成全班 durable `game_state`；历史 `type=game` 路径正常，旧测试也只覆盖该路径。本机热修已补齐 `LiveShell → DocCoursewarePage → StagePreview → GamePageStage → SudokuBoard` 双向镜像，并把连续操作改为每 100ms 合并发送最新状态，避免 trailing debounce 在教师持续点击期间长期不广播。

同一增量建立独立于输入路由的版本化 `ClassroomInteractionSyncProvider`：所有 Mathin 自研 docVersion、微课 mode 和游戏 registry 项必须声明 snapshot、语义 command 或课堂只读，并通过 `pnpm classroom:interaction-sync:audit`。当前自编数独使用 `game-mirror-v1`；自研 H5 与 `spatial-page-v1` 在各自 `h5-state-v1` / `spatial-command-v1` 完成前 fail closed 为课堂只读。定向 Vitest 6 文件 72/72、同步审计 4/4、TypeScript、受影响 ESLint、规划审计和本地 Chromium 课堂合同 2/2 通过；新增双窗口用例在同一个正式本地课次验证控制页填数/突出行后展示页重放，既有 H5 合同保持通过。该热修已以 `59cc342…` 完成应用-only 原子发布和机器 postflight，且继续包含在当前 `a165004…`；当前为 **DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING REAL IPAD ACCEPTANCE**。机器结果不替代真实 iPad Safari、跨设备局域网或产品验收，也不修改数据库、Storage、R1-Live Gate 2 或暂停中的 SML 施工状态；证据见 [`classroom-interaction-sync-hotfix-production.md`](../evidence/r1/classroom-interaction-sync-hotfix-production.md)。

#### DEV-TMC-1 · 普通教师短期微课孵化与校内共享

`DEV-TMC-1` 是独立开发轨 Gate，不改变 R1-Live Gate 2。能力由 `teaching.teacher_microcourses_v1` 独立控制；2026-08-27 已授权部署并启用，关闭开关仍是即时 fail-closed 回退面。2026-08-29 产品负责人更正产品语义：教师微课的根对象是一个自由班，同班多个课节各自导入或自制课件并选择“本节使用”方案，这些课件按课节顺序共同组成一门多讲 `microcourse`；一个课节只对应一个稳定讲次，同课节的并行方案审核发布后成为该讲次的不同 immutable release，“本节使用”决定当前 release。课程保留来源班级的年级和运营学期用于追溯，但教师微课可能跨年级、班型和季节使用，三者只能作为可选筛选面，不能继续充当唯一定位课程的版本矩阵。课程族页改为教师微课专用的目录—详情工作区：宏观展示全部微课及场次数量/完成度，支持标题、讲次、主题、关键词和来源维度组合筛选，选择条目后在同一页查看教学计划与课件预览。既有“每个课次方案各映射一门单讲课程”的实现和“年级 × 班型 × 季节唯一寻址”页面均是待替换旧模型。

已落地范围包含正式课程当前 release 的整讲快照与锁定来源基底、可编辑叠加层、文字/图片/标题页、注册表驱动的教师自编游戏块、单文件离线 H5、版本化元数据、受控主主题和教研退回/通过/发布。班级级更正保留这些课次内容能力，只把目录投影、标题/年级/学期元数据和其他教师建班改为一班一课、多课节多讲。首个通用 game block 适配器为数独，统一支持四宫、六宫和九宫原型题；`microcourse-page-v1 mode=sudoku` 与顶层教师微课 `game-page-v1` 已退出仓库当前运行合同，本地版本化 migration 将 27 条相关 revision 原位升级为 `courseware-composition-v1` 内嵌 `sudoku-authored-v2`，应用解析、编辑、审核、冻结与课堂均 fail closed，生产迁移仍须单独授权后先于相应应用部署。来源不包含已发布教师微课，避免递归嵌套；H5 不包含 AI、低代码、多文件或 ZIP。普通教师只获得本人任教自由班课次的 `courseware.microcourse.author`，不获得全局 `course.manage` 或 `courseware.page.edit`。

开发验收必须同时覆盖作者/他人草稿隔离、提交快照不可替换、发布/退回/撤回/新版切换原子性、4/6/9 宫数独唯一解与未完成草稿审核阻断、H5 离线 CSP、自由课次冻结、其他教师搜索建班以及 zh/en 旅程。功能由 `teaching.teacher_microcourses_v1` 控制；本地机器检查和产品初验完成后仍须另行取得生产迁移与启用授权。

截至 2026-08-27，本机实现与机器检查为 **PASS**：基础闭环 commits `cd3b2bf`、`26698e3`、`96f3301`、`a4fa9e4`、`5c13d5d`、`f418dd9` 已通过三份 SQL 断言、微课 Vitest 17/17、普通教师—教研—主管 zh/en Playwright 1/1 和当前 R1-Live 合同 60/60；commit `dd9a755` 把来源选择改为课次检索与整讲事务插入；commit `1135099` 以 migrations `20260827000300`～`20260827000400` 增加通用 `game-page-v1`、服务端不可变校验凭证和来源 capability predicate。migrations `20260827000600`～`20260827000700` 又把来源入口改为复用课程产品 `CoursePicker`：先选生产正式课程，再列课次名称与页数，不再加载页面预览；普通教师通过独立作者权限分支访问同一筛选 RPC，不获得 `class.create`。本机 migration head=`20260827000700_teacher_microcourse_course_catalog_access`，事务回滚/权限矩阵、微课 Vitest 4 文件 21/21 与同一固定账号完整 Playwright 1/1 通过；此前最终 `pnpm ci:checks` 16/16、全量 Vitest 106 文件 742 通过/1 条件跳过及 production build 证据保持有效。

生产状态为 **DEPLOYED / PENDING USER ACCEPTANCE**：首轮 12 个 migration 经新鲜 PostgreSQL-only 备份、完整 rollback/零残留/formal 后把 ledger 推进到 `206`，`bc76f68` 于 2026-08-27 上线并把 `teaching.teacher_microcourses_v1` 推进到 version 2 / true。2026-08-28 来源运行时发布后，DEV-TMC-2/班级重新启用再经同批次 PostgreSQL+Storage 全量备份、三 migration rollback/零残留/formal 和双 release，把当前状态推进到 ledger=`211`、current/previous=`20260828-071313` / `20260828-071024`、commit=`087b497…`。HTTP、真实作者只读课程目录权限、数据库 ACL、既有业务/Storage 计数、journal、应用错误和登录态审核页只读 smoke 均通过。该结果不替代产品负责人在生产页面完成实际写态旅程，当前产品验收仍为 **UNKNOWN**。详细边界见 [doc 26 §十三](26-teacher-workflow-upgrade.md#十三dev-tmc-1-普通教师短期微课) 与[实现/发布证据](../evidence/r1/teacher-microcourse-dev.md)。

#### DEV-TMC-2 · 课次课件多方案协作与选用

`DEV-TMC-2` 是产品负责人在开发端选入并于 2026-08-28 明确授权部署的独立增量，当前状态为 **DEPLOYED / PENDING USER ACCEPTANCE**，不改变 R1-Live Gate 2。它把自由课次课件从“一个作者草稿”调整为“同一课次可有多个课件方案”：本课任课教师和具备 `courseware.review` 的教研均可直接创建方案；编辑他人方案时生成保留来源关系的新方案，不覆盖对方 head，也不经过认领、交付、退回等前置流程。一个方案内部继续使用自动保存 revision，只有并行教学设计才显示为方案。

主讲教师在开课前显式选择“本节使用”方案；只有任课教师可以改变该选择，教研不因此获得班级、花名册、点名或课堂控制权限。开课继续冻结所选方案当时的页面 revision、资源 revision、H5 hash 与游戏校验事实，后续任何方案修改都不回写当前或历史课堂。课次内创建、修改、选择和试讲不要求教研审核；只有把某一方案发布到校内“教师微课”目录时，才继续使用 DEV-TMC-1 的审核与 immutable release 链路。

本机 migrations `20260828000100_teacher_microcourse_variants` / `20260828000110_teacher_microcourse_variant_runtime`、回滚数据库断言、TypeScript、双语键、全库 ESLint、定向 Vitest 以及固定账号 Playwright 均通过；浏览器证据同时覆盖既有“制作—上课—审核发布—选课建班”旅程和新增“教师/教研派生—教师选用—冻结”旅程。生产候选同时纳入 `20260827000800_classroom_reactivation`，排除未获授权的班级课型/活动类型增量；三迁移以 `087b497…` 和同 schema current/previous 上线，生产未创建方案或其他夹具。该结果仍是 **DEPLOYED / PENDING USER ACCEPTANCE**，产品负责人写态页面验收为 **UNKNOWN**。详细合同见 [doc 26 §十四](26-teacher-workflow-upgrade.md#十四dev-tmc-2-课次课件多方案协作与选用)。

#### DEV-TMC-3 · 教师微课班级级归并更正

生产只读诊断确认现有同一自由班的 3 个课节、3 个已选方案和 1 名作者，被旧实现投影成 3 门单讲草稿；其中 2 门学期为空，2026-08-29 13:38～13:39（Asia/Shanghai）连续触发 3 次课程详情 Zod 500。目录兼容补丁 `5224752` 已在本机允许微课可空课程季节并显式展示“暂未设置学期”，定向 Vitest 8/8、TypeScript、双语消息合同与受影响 ESLint 通过；该提交尚未发布生产。

数据更正必须把一个自由班表示为一门教师微课，把来源课节按顺序表示为稳定多讲，并以班级年级与 `term_id → school_terms.term` 固定课程目录维度；同课节并行方案保留独立草稿/审核快照，但发布到同一讲次的连续 release_no，不再增加课程或讲次。“本节使用”、课堂冻结与已冻结历史继续保留。生产归并前须对当前 1 班/3 课节/3 方案做明确映射预览、备份、完整 rollback/零残留演练和 release/审核快照/Storage 不变量核对，并重新取得 schema/app 发布授权。当前状态为 **LOCAL CONTRACT CORRECTED / DATA MIGRATION NOT DEPLOYED**。

#### DEV-TMC-4 · 教师微课课程浏览与维护工作台

`DEV-TMC-4` 是产品负责人于 2026-08-30 选入的独立增量，权威范围见 [`29-teacher-microcourse-browser-redesign.md`](29-teacher-microcourse-browser-redesign.md)。本轮 hotfix 的生产 preflight 已检出应用 current=`76f0f9a…`、数据库 ledger/head=`236 / 20260830000700_teacher_microcourse_editor_unification`，证明相关 schema/app 在本轮开始前已进入生产；本 hotfix 没有执行这些 migration，也不补写此前部署授权或 postflight。当前状态据此记为 **PRODUCTION APP/SCHEMA DETECTED / PREVIOUS DEPLOYMENT EVIDENCE RECONCILIATION PENDING / PRODUCT ACCEPTANCE PENDING**。它在 DEV-TMC-3 的“一班一课、多课节多讲”根对象上增加 766 使用场景树、机构学术维度、课程适用范围、目录—表格—轻量预览浏览器、同名归并、课程级维护方向与默认版本管理；现有课次方案、immutable release、课堂冻结和历史引用继续作为内容权威。

Phase 1～5 的本机隔离 Supabase、固定开发身份、migration LF checksum、受影响 ESLint、TypeScript、定向 Vitest 与自动回滚数据库合同证据继续有效。2026-08-30 的生产发现只证明运行版本与 schema 已存在，不证明课程切换性能、真实写态、历史归并结果或产品页面已经验收；此前部署证据完成对账前不得把本段提升为生产通过。本轮 `a165004…` 仅部署讲次课件预览性能补丁，不改变 R1-Live Gate 2。

#### DEV-CW-1 · 课程产品统一课件工作区

`DEV-CW-1` 回应课程产品中 E 系列、爱学习及后续导入课程缺少单页 16:9/4:3 修订闭环的问题，权威规划见 [doc 16 §14](16-p6-courseware-platform.md#14-dev-cw-1-课程产品统一课件工作区待产品逐步确认)。目标主路径为“课程产品 → 课程/版本 → 讲次 → 指定页面 → 统一课件工作区”，并把共享内容修订、分轨版式、页面上下文资源替换、插入能力和 draft/review/release 放在同一对象上下文内。研发任务只保留责任／待处理投影，公共资源保留高级治理与回滚；旧适配校对与旧 Studio 不再作为平行生产空间。

产品负责人于 2026-08-31～09-03 依次确认 Step 0～8D。Step 3B 把文字／图片／形状节点与图层能力收敛为共享组件；Step 4A/4B 打通共享 4:3 控制器、旧 A～F 映射和单页草稿；Step 5A/5B 打通页面上下文影响预览、单样本替换与回滚；Step 6 让爱学习来源 Viewer 通过共享编辑桥获得选择、文字、几何、图层、网格与历史能力。Step 7B 已收敛审核入口并退役旧直发／批量适配发布链；Step 7C 确认三端共享工作台与编辑组件真实复用；Step 8A/8B 完成爱学习双轨草稿与正式 PageDoc／爱学习共享的文字、公式、形状、图片和 H5 插入持久化。Step 8D 生产只读事务盘点确认 77,060 个正式可编辑页面和 154,120 个可插入轨道 head 无需存量回填。当前 Step 8E 为 **NARROW RELEASE CANDIDATE PREPARED / AWAITING PRODUCTION WRITE AUTHORIZATION**：从生产应用 `a165004…` 直接建立候选 `d8fe305d…`，排除开发主线的 125 个并行提交，只包含 111 个课件相关文件和 6 条 migration；候选构建、定向合同与本地事务回滚通过，生产只读结构快照已登记。没有生产写入或发布，也不改变 R1-Live Gate 2。

#### DEV-SCHOOL-OPS-1 · 学辅运营与教学履约主干

`DEV-SCHOOL-OPS-1` 是产品负责人于 2026-09-01 选入的独立开发预演，权威里程碑见 [`30-mathin_school_ops_architecture_plan.md`](30-mathin_school_ops_architecture_plan.md)。规划型 `/dashboard/school-ops` 页面、导航和快照已删除；Phase 2 已把活动详情收敛为“名单与到访 / 本场测评登记”两个角色工作节点，测评、学情、家长关注、老师建议和报名去向在同一学生行完成，后台仍分别写入 Participation、AssessmentResult 与 ActivityRoute。2026-09-02 取得两组真实小地推脱敏导出后，Phase 1B 已让数据收件箱逐行校验并只写 `leads`、来源记录与意向标签，第一组 1071 行形成 1071 个未分配种子，第二组 157 行保持 dry-run（138 拟新增／11 复用／8 待判断／0 错误）。2026-09-03 当前进入 **Phase 1C · 种子批量分配与初次电联**：`/dashboard/leads` 增加整页／Shift 连续选择、批量分配、“我的初次电联”和追加式沟通记录；种子表压缩为身份、意向、负责人、最近沟通和池内状态，来源批次与下一动作退出该表，老师不再手填确认月份／周次／日期／人员。状态为 **DEVELOPMENT READY / AWAITING PRODUCT OWNER UI AND INTERACTION ACCEPTANCE**；显式建立／关联 Student、加入具体活动和业务组配置未暗做，没有 Xiaomi／生产迁移、业务写入、Storage 或发布动作。

#### DEV-STAFF-ONBOARD-1 · 员工批量建档

`DEV-STAFF-ONBOARD-1` 是产品负责人于 2026-09-02 选入的独立开发增量，当前状态为 **DEVELOPMENT READY / AWAITING PRODUCT OWNER UI AND INTERACTION ACCEPTANCE**，不改变 R1-Live Gate 2。用户闭环现固定为“主管及以上在员工页粘贴或上传 `姓名 / 手机号或邮箱 / 中文岗位名（空格分隔）` 名单 → 生成版本化 ImportBatch 并逐行预检 → 直接创建 Auth 账号、员工档案与预先核准岗位 → 自动下载且仅本次可见的首次登录密码 → 员工首次登录必须输入并二次确认新密码”。建档完成后该员工立即可作为排课、班级和交接目标；本人改密前的 staff 权限与 staff-wide RLS 读取保持关闭，改密后再进入必要同意流程，系统不代替员工记录隐私同意。首次密码遗失且该员工仍处于待首次改密状态时，持有 `staff.invite` 的主管可在员工行重新生成密码；旧密码立即失效，新密码仍只显示一次，首次改密完成后入口消失。导入端同时识别魔法校 `姓名 / 手机号 / 性别 / 岗位` 四列：表格剪贴板优先以 Tab 分列，岗位单元格内的逗号只拆来源岗位，性别不写入；常见来源岗位预映射为 Mathin 岗位，`前台`、`财务` 等无安全等价项必须由操作者明确映射或忽略。

本机 migrations `20260902001000_staff_direct_provisioning`、`20260902001100_staff_initial_password_hardening` 与 `20260902001200_staff_initial_password_reissue` 在既有 `20260902000700` 预检账本上增加窄化权限 `staff.invite`、direct provisioning reservation、失败行重试、首次改密状态、service-role 完成 RPC、Auth 建档临时密钥清理，以及带 10 分钟并发占位的首次密码重签账本。重签先保留可回退的 hash 状态，再更新 Auth 密码并确认；Auth 更新失败恢复旧 hash，成功或员工完成首次改密时清除临时比较 hash。`director` 与原有 `staff.manage` 持有者可建档和重签待首次改密密码，停用员工、修改岗位和提升既有顾客身份仍要求 `staff.manage`。密码只由受信 Server Action 交给 Auth Admin API 和本次响应，数据库不保存明文，Auth 元数据也不保留邀请码键。旧账户支持页不再签发 claim 邀请，只保留旧 pending 邀请撤销并引导到员工页。迁移回滚演练、正式本机应用与独立 postflight 通过；固定管理员仍为 `admin / active / staff` 且既有 58 项权限全部保留。当前账号／profile／邀请／员工批次为 `12/12/12/5`，这些记录均早于 migration 012，本次新重签账本为 0；数据库回滚行为断言、相关 Vitest 17/17、受影响 ESLint、TypeScript、双语键和生成类型摘要检查通过。页面、首次登录、密码重签与交接操作仍待产品负责人人工验收；未授权 Xiaomi／生产迁移、身份创建、业务写入或发布。

## 6. 原 R1 工作重新定位

| 原阶段 | 已有结果 | R1-Live 处理 | Production 1.0 处理 |
| --- | --- | --- | --- |
| **R1-0～R1-4** | 治理、机构配置、运行内核、账户安全、work-items 已关闭 | 复用 Gate 1 所需目标、身份和错误查询，不重做 | 保留原 M4/正式环境证据要求 |
| **R1-5～R1-8** | 学生/家庭、成果、数据维护、财务安全关闭已关闭 | 复用学生、班级、点名、权限和防误清合同；财务继续关闭 | 完成全角色/正式环境验收 |
| **R1-9** | P6-AIX-2、1305 讲来源 manifest/只读导出核心已落地 | 课程/讲次/release 完整度不阻断建班和开课；无 release 时冻结空白/覆盖层快照 | 完成 Terms、全量课件 inventory、Storage/H5 审计和 release 基线 |
| **R1-10** | Story 完整章节仍有缺口 | 不影响点名核心路径时进入上线后池 | 完成完整章节、Terms 关联、双语回退和无障碍 |
| **R1-11** | Games/Minds/Tools 完整旅程仍有缺口；Notebook 数据库子门已完成 | 保留已有增量，未完成能力可隐藏 | 完成四模块关键旅程、Notebook 完整写态、越权和视觉验收 |
| **R1-12** | 跨模块、公共质量和全站视觉仍有缺口 | 只修影响首个闭环的可用性缺陷 | 完成六模块贯通、zh/en 回退、全站小王子视觉、SEO/a11y/浏览器门 |
| **R1-13** | 全量指标/遥测未完成 | R1-Live 只要求错误有可查询位置 | 完成统一指标、报表、隐私与告警 |
| **R1-14** | 正式 Playwright 框架与本地基线已落地 | 只补 Gate 2 Golden Path 和适用越权用例 | 完成写态、zh/en、跨浏览器、连续无 flaky、并发和文件矩阵 |
| **R1-15** | 只读生产基线 planner 已落地 | 不执行清理；现有 `purge_allowed=0` 足以保护真实使用 | 在隔离副本生成当次准删根/闭包 manifest，演练显式测试数据清理和 2610 条 baseline release-1 |
| **R1-16** | 发布 preflight、secret scan、current/previous、健康门和当前 DB/Storage 同批次备份已存在 | Gate 1 已复用并通过 | 完成恢复/rollback 演练、异机/静态加密备份、release 错误标签、监控与 RPO/RTO |
| **R1-17～R1-18** | 尚无真实 RC，清理未执行 | 不阻塞；真实使用即观察起点，禁止删除真实数据 | 14 天/5 节课堂、发布审批；只清理 manifest 明确批准的 test 根 |

## 7. 独立并行与上线后池

- Spatial Math / 3D 继续独立路由、权限或 Feature Flag；默认普通教师不可见未完成能力。修改共享认证、导航、数据库或课堂链路时回归 R1-Live Smoke。
- Terms/Minds/Story 长内容、1305 讲全量审计、Notebook 完整写态、完整视觉矩阵、全量 E2E、容量、指标、完整恢复/rollback、财务/活动深化和长期重构进入上线后池。
- 上述池中的事项不会自动开工；只有产品负责人明确选中的新功能可在当前单老师试用期进入开发预演轨，并按 §5.2 独立晋级生产，其余继续排队。
- `POST-LIVE-AUTH-01`（2026-08-25 产品负责人提前启动独立热修；第一阶段 migration `20260825000800` 与应用 `72d8127` 已部署 Xiaomi，机器 postflight 通过，待产品人工验收）：把现有各身份可达的 `/dashboard/account-security` 升级为传统设置页式统一账号中心，先交付头像、全站显示名称、语言、只读登录 identity、既有安全/恢复与隐私能力；业务档案保持只读关联。验证码、邮箱/手机号自助绑定和微信/QQ 仍按 provider 阶段后续交付。该项不改变 R1-Live Gate 2，完整合同见 [`r1-live-auth-identities.md`](r1-live-auth-identities.md) §6E。
- `POST-LIVE-UX-02`（2026-08-23 已提前收敛并上线，待逐项人工验收）：班级管理子页面使用与 Dashboard 一致的标题分割线和水平命令工作区，本项不改变点名主链。
- `POST-LIVE-UX-03`（2026-08-23 已提前收敛并上线，待逐项人工验收）：共享 Select 统一纸色/星夜配色和悬浮反馈；日期/时间表单改用 shadcn `Calendar` + `Popover` 组成的共享控件，不再使用业务层原生 date/time/datetime-local。
- `POST-LIVE-OPS-01`（2026-08-23 已提前收敛并上线，待逐项人工验收）：备课待办在开课前 14 天出现、开课前 7 天到期，此后向主管投影逾期待办；开课后提交显示“补交”。生产当前教师投影由 15 条缩为 1 条。
- `POST-LIVE-NOTIFY-01`（2026-08-23 已提前收敛并上线，待逐项人工验收）：未知事件也显示事件类型及 payload 中首个可读对象/变化字段，不再只显示“系统状态有更新”；既有通知入口继续承担跳转。
- `POST-LIVE-CANVAS-01`（2026-08-23 已提前收敛并上线，待逐项人工验收）：共享绘图工具栏支持向屏幕下缘收起/展开；备课工具栏已移到翻页工作区，并移除常驻的方向键/PageUp/PageDown/空格提示文案。
- `POST-LIVE-OPS-02`（2026-08-28 已部署 / 待产品验收）：班级保留 `purpose=production|test` 数据治理轴，新增 `offering_type=long_term_formal|short_term_topic` 区分长期正式课与短期专题课；活动新增显式公开课类型，并在新建面板说明活动只对应一个举行时间和一次报名/到场结果，固定名单连续 3–4 次或更多课应建短期专题班。旧班级默认回填长期正式课，不按历史课次数量猜测。migration rollback/formal、当前数据库备份、应用 release 与机器 postflight 已通过；生产实际新建两类班级和公开课仍待产品负责人操作验收，不改变 Gate 2。
- `POST-LIVE-PERF-01`（2026-08-30 新增 / R1 问题收集期 / 非 Gate 2 blocker）：把全站页面导航、同页对象切换和重型预览的“明显卡顿感”作为独立体验优化池。讲次只读课件预览的页级读取、缓存、相邻预取和来源 runtime 复用已以 `a165004…` 部署，机器 postflight 通过但真实冷／热翻页手感待产品验收；首个教师微课课程族切换样本仍未解决，该动作已只更新本地选择与 URL，候选瓶颈继续是首次 quick-preview 的 Auth／RPC 往返和短生命周期缓存。R1 期间继续按路由、动作、冷／热状态、RSC／API／DB／renderer 分段记录，Gate 2 后或产品负责人明确提前选择时集中优化；初筛清单与记录格式见 doc 15 §6.5。它不表示功能缺失，也不允许用客户端 History API 绕过必要的鉴权、RLS 或服务端读取。
- 单老师生产试用中的真实问题按 P0/P1/P2 排序；Gate 2 通过后的 14 天观察用于决定扩大用户范围和恢复 Production 1.0 施工顺序。
- `cacheComponents`、原生 App、更多游戏/章节和高级 BI 继续延期。

## 8. 已关闭基础阶段

| 阶段 | 关闭日期 | 结果 | 证据 |
| --- | --- | --- | --- |
| R1-0 | 2026-07-28 | 范围、责任、证据和阶段唯一性冻结 | [`r1-0.md`](../evidence/r1/r1-0.md) |
| R1-1 | 2026-07-28 | 机构/校区、规则、Feature Flag 与 fail-closed | [`r1-1.md`](../evidence/r1/r1-1.md) |
| R1-2 | 2026-07-28 | Jobs、通知、文件与集成运行内核 | [`r1-2.md`](../evidence/r1/r1-2.md) |
| R1-3 | 2026-07-28 | 账户、安全、同意、员工邀请和支持 | [`r1-3.md`](../evidence/r1/r1-3.md) |
| R1-4 | 2026-07-28 | Work-items 与轻审批 | [`r1-4.md`](../evidence/r1/r1-4.md) |
| R1-5 | 2026-07-31 | 学生/家庭门户与课堂连续性 | [`r1-5.md`](../evidence/r1/r1-5.md) |
| R1-6 | 2026-08-01 | 教学成果、阶段报告与通知 | [`r1-6.md`](../evidence/r1/r1-6.md) |
| R1-7 | 2026-08-01 | 初始化、导入、质量、修复与导出 | [`r1-7.md`](../evidence/r1/r1-7.md) |
| R1-8 | 2026-08-01 | 财务安全关闭 | [`r1-8.md`](../evidence/r1/r1-8.md) |

Gate 关闭的同一变更更新实现/运行证据、[`docs/evidence/r1/README.md`](../evidence/r1/README.md)、doc 00/04/25、受影响专题状态头，并运行 `pnpm plan:audit`。R1-Live Gate 关闭不自动宣称对应领域达到 doc 25 的 Production 1.0 M4。
