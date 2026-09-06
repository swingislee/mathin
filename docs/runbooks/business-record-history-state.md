# 现有业务记录的历史状态

> 状态：本机开发案例已合并，待产品人工验收。当前试验访问范围为开发端管理员。

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
| 报名分班 | `EnrollmentPlacementWorkbench` 的同一班级行与 `studentTile`；历史资料没有可操作的座位关系 |
| 首联 | `FirstContactRecordRow`、`FollowupPersonCell`、`FollowupEntryFields`；`LeadContactEntryRow` 提供当前业务写入控制，缺失首联只传入真实学生的查询数据 |
| 活动 | `ActivitiesManager` 的同一活动行及各列；日期、报名与结果按已有字段显示 |

首联缺失项已接入工作表的同一搜索、逐列筛选、排序与展开逻辑。当前首联的默认填写、保存及键盘行为沿用已验收版本。

## 逐步验收

用开发端管理员在原工作表搜索已选案例。交付入口统一使用 `http://192.168.5.213:3130`，保留语言前缀。

1. `/zh/dashboard/followups/assessments`：搜索姓名，历史行直接显示日期、A+ 与能力表现；展开查看家长情况。
2. `/zh/dashboard/followups/enrollments`：搜索同一姓名，显示寒春两份原班型、老师、时间与报名金额。
3. `/zh/dashboard/followups/communication?view=all`：搜索同一姓名，显示历史状态与“首联记录缺失”。
4. `/zh/dashboard/followups/renewals`：搜索同一姓名，暑秋两条意向可分别阅读，最终结果为未记录。
5. `/zh/dashboard/activities`：搜索同一姓名，查看报名日期及沟通记载的奖项，届次保留待核对。
6. 将记录状态切换到“当前”，历史行退出列表；切回“全部状态”或“历史”可再次找到。学生档案仍汇总同一组事实。

普通新业务写入继续使用当前流程。历史查询行不提供当前测评录入、报名确认、座位拖动、续费登记或首联保存操作。自动检查证明数据与权限合同；视觉、交互和业务口径以产品负责人验收为准。
