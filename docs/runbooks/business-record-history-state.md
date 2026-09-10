# 来源业务记录与工作流衔接

> 当前状态（2026-09-08）：开发端已按本期依据区分当前工作与历史查询，待产品人工验收。当前范围以 [Base 业务事实与当前工作范围](base-authority-workflow.md) 为准；后文保留初始迁移过程。

来源记录使用现有 Lead、测评、活动、报名、分班和续报模型。业务页面统一按日期、学期、负责人和工作进度查询；`source_record_id` 等字段保留来源凭据，业务操作沿用现有权限与审计。来源归属不明确时，在实际使用该记录时确认学生，再继续分班等操作。

- 一对一沟通、散测和普通个人到访归入 1v1 测评；明确的集体测试、体验课或选拔活动保留对应类型。参与内容空白且没有明确到场或成绩证据时，按一次未到预约导入；明确到场、未到和实际测评记录优先。
- 测评等级使用 `X+ / G+ / A / A+ / S / C`。未达 A、基础、培优等不能唯一对应的表达保存在备注。思维与学习力分属不同维度；分数的满分只采用原记录明确给出的值。
- 原表“学科老师”对应测评老师，“学服老师”对应系统当前学辅。唯一匹配的现有有效员工可进入对应人员字段，其余保留备注。全局角色名称调整由另一个任务处理。
- 首联的联系结果、加微、诺访和意向分别读取。只有意向或否定标记时仍显示这些事实，联系次数保持真实。
- 当前来源报名按学期、年级和授课安排进入分班工作表；点击学生后确认身份与目标班级，继续使用现有分班操作。历史报名用于查询和修订当时的资料。人工操作递增修订版本，后续导入保留人工结果。
- 学生 360 使用原日期精度，同一业务行只显示一次；原始来源记录和已生成报告继续保留。

### 报名确认与资料待补（2026-09-07）

产品负责人确认：明确报名事实同时确认首联和测评阶段已经发生，具体联系内容、发生日期、老师与分数继续按实际记录补录。报名班型名称为 `X+ / G+ / A / A+ / S / C` 时，与测评等级一一对应；其他班型文字保留原值供核对。

- 来源报名依据保存在原预约／报名记录的 `source_enrollment_facts`，首联事件数量、预约数量及未知时间保持真实。学生 360 显示已首联、已测评、已报名，并单列资料待补。
- 班型对应等级属于学生已知结论。已到场且同一行报名班型明确时，可补入该次测评等级；未到预约继续显示本次未到。等级无法确定所属场次时，显示“等级所属测评场次”待补项。
- 每次预约独立成行；已结束的未到预约退出待测评等工作队列，在全部记录与未到筛选中保留。原到访判定可通过原记录修订入口纠正。
- 缺失项根据当前保存的联系与测评记录重新计算。补齐后移除对应提示；查看或确认阶段本身不生成联系事件、分数、报告或测评时间。
- 身份关联使用本次明确确认的来源 ID／学生 ID 清单，并沿用来源关联审计。再次导入读取已确认关联，保留已核对的报名日期及人工修订。

本机修复命令依次为 `node --experimental-strip-types scripts/source-assessment-repair.mjs --preflight`、`--prepare`、`--check`、`--apply`。CLI 每次重新核对本机目标；`--check` 备份涉及的表、执行精确清单并回滚，`--apply` 核对相同清单与代码指纹后提交。精确身份和跨表日期决定存放在本机私有 `.tmp/source-assessment-repair/decisions.json`，原始数据与备份保留于同一私有目录。

本批开发端数据修复与真实读取检查已完成，待产品验收，见 [报名阶段与多次预约修复证据](../evidence/r1/source-assessment-completion-repair-20260907.md)。

本次实现与定向检查见 [开发端业务衔接证据](../evidence/r1/business-source-continuation-20260907.md)。本节不改变生产部署或 R1-Live Gate 状态。

## 初始迁移记录（2026-09-06）

以下描述当时的单家庭验证和隔离设计。业务查询、状态与操作以本页当前规则为准；旧 CLI 仍按各自迁移 ledger 防止重复执行。

学生档案与测评、分班、续费、活动工作表读取同一套业务事实。`record_state=current|historical` 区分记录的运营用途；测评等级、报名金额、续费意向仍保存在各自业务字段中。历史状态与业务里程碑、当前待办分开计算。

| 事实 | 权威业务表 | 本例数量 |
| --- | --- | --- |
| 测评结果 | `assessment_results`，关联 `activity_registrations` 与 `activities` | 1 |
| 活动报名与沟通记载的结果 | `activity_registrations`，关联 `activities` | 1 |
| 暑秋续费意向 | `course_opportunities` | 2 |
| 寒春报名与原授课安排 | `course_enrollments` 与 `course_enrollment_assignments` | 2 份报名、2 份安排 |
| 完整沟通 | `student_follow_ups` | 2 |
| 首联资料缺失 | 同一 Student 后续历史事实形成的查询占位 | 1 位学生 |

首联占位不创建 Lead、联系事件、日期或联系人。测评只保留原等级，未提供的分数留空。报名、活动与授课安排分别保留原日期粒度；未提供的经办人、正式课程、学期、班级外键与时刻留空。历史班级描述供查阅；后续分班使用当前流程选择真实班级。

`history_key`、`history_batch_id`、`source_record_id`、`source_field_ids`、`source_payload_sha256` 与 `history_imported_at` 保存原导入来源。原始来源与身份核对继续留在导入凭据中，业务页面查询现有业务表。

## 本机操作

执行前按根 AGENTS 与 operations 规则核对目标。CLI 使用 `history-local-target` 重新核对 Windows 主机、实际 Supabase origin、监听进程、Docker 网络和数据库指纹；仅支持已登记的隔离本机。

```powershell
node scripts/business-record-history-migration.mjs --preflight
node scripts/business-record-history-migration.mjs --check
node scripts/business-record-history-migration.mjs --apply
```

`--check` 将 schema 与原试验数据备份到 gitignored `.tmp/business-record-history/`，对照已批准的单家庭计划，执行完整迁移事务并回滚。检查覆盖逐字段一致、来源身份、原有表内容、当前必填约束、管理员/其他角色读取、历史记录修改与 RPC 拒绝。`--apply` 要求同一 migration checksum 已检查通过，执行同一合同后提交。已应用的 migration 不重复应用。

旧 `student-business-history-trial` CLI 在该迁移存在后停止写入旧结构。本次产品负责人已明确授权删除五张 `student_*_history` 旧试验表；本机已完成备份恢复演练与清理，8 条副本对应的业务事实完整保存在现有业务表。原始 `history_import_records` 是来源凭据，继续保留。

旧表清理由独立迁移 `20260906002100_retire_history_trial_tables` 执行。以下命令用于同一已批准范围的首次清理；已应用时直接停止。扩展到其他环境或资料范围时，先取得对应的明确删除授权并完成目标 preflight。

```powershell
node scripts/business-record-history-cleanup.mjs --check
node scripts/business-record-history-cleanup.mjs --apply
```

清理检查逐字段确认全部副本已有对应业务记录，执行删除、备份恢复及事务回滚演练；正式事务再比较 25 张业务、身份与来源表的内容指纹。备份保存在上述本机私有目录中。

## 组件实现入口

当前与历史的组件复用规则以 [前端规则](../agent/frontend.md#组件与客户端边界) 为准。本轮已将历史专用整行布局归入下列实现；页面重构从这些入口继续维护。

| 工作表 | 共用实现 |
| --- | --- |
| 测评 | `AssessmentUnifiedWorkbench` 的同一数据行、结果字段及 `FollowupInlineDetails` |
| 续班 | `RenewalStudentPool` 内的 `RenewalEntryRow`，按操作能力显示结果编辑或只读事实 |
| 分班 | `EnrollmentPlacementWorkbench` 的同一班级行与 `studentTile`；历史资料没有可操作的座位关系 |
| 首联 | `FirstContactRecordRow`、`FollowupPersonCell`、`FollowupEntryFields`；`LeadContactEntryRow` 提供当前业务写入控制，缺失首联只传入真实学生的查询数据 |
| 活动 | `ActivitiesManager` 的同一活动行及各列；日期、报名与结果按已有字段显示 |

首联缺失项已接入工作表的同一搜索、逐列筛选、排序与展开逻辑。当前首联的默认填写、保存及键盘行为沿用已验收版本。

## 备注归属与学生 360

- 缺失首联只显示缺失状态及说明。测评、活动和续班的备注由各自业务承载。
- 历史测评展开区只保留一份“历史反馈”，合并能力与家长反馈中的重复行。姓名、测评类型及档案入口由主行承载。
- 学生历史档案中的测评沟通并入对应测评反馈；完整续班沟通集中显示一次。原始字段仍可在来源依据中核对。
- 合并同源沟通时同时核对学生、业务类型、来源记录与原字段交集。不同来源的独立记录保持独立。
- 学生 360 使用同一业务历史读取器，并将历史事实交给现有时间线组件。测评、活动、报名及续班沟通可统一回看；共有的一次续班沟通对应的多个期别在同一节点保留结果信息。
- 缺失发生日期保留为空，界面显示“日期未记录”；仅知道日期时显示原日期，报名日期与活动举行日期分别显示。

## 逐步验收

用开发端管理员在原工作表搜索已选案例。交付入口统一使用 `http://192.168.5.213:3130`，保留语言前缀。

1. `/zh/dashboard/followups/assessments`：搜索姓名，历史行直接显示日期、A+ 与能力表现；展开只查看合并后的历史反馈。
2. `/zh/dashboard/followups/enrollments`：搜索同一姓名，显示寒春两份原班型、老师、时间与报名金额。
3. `/zh/dashboard/followups/communication?view=all`：搜索同一姓名，显示历史状态与“首联记录缺失”。
4. `/zh/dashboard/followups/renewals`：搜索同一姓名，暑秋两条意向可分别阅读，最终结果为未记录。
5. `/zh/dashboard/activities`：搜索同一姓名，查看报名日期及沟通记载的奖项，届次保留待核对。
6. 将记录状态切换到“当前”，历史行退出列表；切回“全部状态”或“历史”可再次找到。点击姓名打开学生 360，确认各业务历史及未知日期正常显示；完整档案保留对应事实和来源。

普通新业务写入继续使用当前流程。历史查询行不提供当前测评录入、报名确认、座位拖动、续费登记或首联保存操作。自动检查证明数据与权限合同；视觉、交互和业务口径以产品负责人验收为准。

## 修订历史事实

2026-09-10 开发增量：历史事实的可修订人员按 [学生参与权限](school-subject-collaboration.md) 判断。参与人在原业务表找到历史记录，点击“修订”，填写正确内容并“保存修订”。学生档案的对应记录使用同一个修订组件。修改说明可选；重新打开修订弹窗可展开修改记录，查看修改人、时间、说明和前后值。

| 入口 | 可修订内容 |
| --- | --- |
| 活动行 | 活动名称、类型、举行日期、地点、备注，以及该学生的报名日期、参与状态、奖项／结果、届次确认状态 |
| 测评行 | 测评日期、等级、分数、历史反馈 |
| 分班中的历史行 | 报名日期、学期、金额及说明、原班级、老师、教室和上课时间 |
| 续班行 | 年份、学期、最终结果、意向备注、原班级与老师 |
| 学生档案中的历史沟通 | 日期、记录人、完整沟通内容；同源测评备注进入对应测评的修订入口 |

修订直接更新原业务表，继续保留 `record_state=historical`。原记录 ID、学生关联、来源引用和原始导入凭据保持稳定；每次修订在 `business_record_revisions` 保存前后值。活动及其学生报名、报名及其原授课安排在同一事务中保存。其他人已修改记录时，页面提示重新读取，较旧的草稿不会覆盖新版本。

保存后原业务表、学生档案和已打开的 360 重新读取。历史测评的反馈修订后成为展示权威，原沟通副本继续作为来源依据，避免旧内容重新混入。清空未知日期保留空值，金额可为零；原始发生时间与本次修改时间分别保存。

组件入口为 `BusinessRecordRevisionButton` → 按需加载的 `BusinessRecordRevisionDialog`；各原业务行共用此入口。服务端 Action 复用登录态客户端，数据库 RPC 同时执行学生范围与岗位能力、字段白名单、版本与原子保存检查。原历史导入中的 PostgreSQL UUID 保持原 ID，输入校验兼容其既有版本位。

两条新增迁移仅在已核对的隔离本机应用，原业务数据未改动。复核命令如下；已应用的迁移会停止重复执行：

```powershell
node scripts/business-record-revisions.mjs --preflight
node scripts/business-record-revisions.mjs --check
node scripts/business-record-revisions.mjs --apply
node scripts/business-record-revisions.mjs --check --validation
node scripts/business-record-revisions.mjs --apply --validation
```

`--check` 的修订样本全部在事务中回滚，覆盖五类保存／再次读取、来源保留、非管理员拒绝、版本冲突、身份／状态字段拒绝、审计不可修改、畸形日期／金额、关联记录失败时整体回滚。`--apply` 只应用已通过同一 checksum 检查的 schema；正式业务纠错由管理员在页面完成。开发端已交付，待人工视觉与交互验收。
