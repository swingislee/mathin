# iOS 家长端现有数据与权限映射

核对日期：2026-10-01。任务 `DEV-PARENT-IOS-SUPABASE-20261001`，代码基线 `8d016fdbf299779d40e4d56c55009d00850c41db`。本证据是仓库源码合同核查；没有连接数据库、执行 migration、创建身份或写入业务数据。当前生产阶段与 Gate 保持 doc 04 的状态。

## 数据权威与三端接入

iOS、微信和 Next.js 继续使用 `auth.users.id` 作为账号主体，`students.id` 作为孩子/参与人主体，`student_guardians` 作为亲子关系。名字是显示字段；所有孩子切换和报告筛选使用稳定 ID。

`/api/v1/parent/**` 使用现有 Bearer 接口。`src/features/parent-portal/server.ts` 的 `authorize()` 调用 `auth.getUser(token)`，校验 `parent | student`、active 账号、密码安全状态和必要同意，再使用该用户的 Supabase 客户端查询。SECURITY DEFINER RPC 以各自函数内的身份/scope 校验授权；普通表查询继续受 RLS 约束。读取学习数据不使用 service role。

## 能力映射

| 页面能力 | 已有数据 / RPC | 可用事实与权限边界 |
| --- | --- | --- |
| 账号与孩子切换 | `profiles`、`students`、`student_guardians`；`get_my_students()` | 返回 `id,name,grade,status`；本人账号或当前亲子关系，剔除 deleted 学生；孩子无需独立登录账号。 |
| 课表与课程卡片 | `class_sessions`、`classrooms`、active `enrollments`、`session_changes`；`get_my_schedule(p_from,p_to)` | 返回 `session_id,classroom_id,student_id,classroom_name,lecture_name,scheduled_at,duration_min,teacher_name,student_name`；包含最新跨班补课，剔除 deleted 学生/课次。可按班级 ID 聚合窗口内课程；窗口内课次不是全部已购课时。 |
| 出勤 | `session_attendance`；`get_my_attendance(p_from,p_to)` | 返回学生/课次 ID、名称、时间、`present | absent | late | leave` 与备注；本人或当前亲子关系。 |
| 学习概况 | `get_my_learning_summary()` | 最新十列包含年级、下次课、近 30 天出勤率、近 5 次作业分数、星标、缴费状态、未来 7 天课次数、待交作业数。旧函数按亲子关系聚合，没有独立 `grades/finance` scope 过滤；本次 API 避免透传成绩与财务字段。未开学生账号时待交数可为 null。 |
| 已发送测评报告 | `assessment_workflow_states.sent_report_id`、`assessment_reports`、`activity_registrations.student_id`；`miniapp_assessment_reports()` | 仅已发送版本，沿用 `miniapp_can_participate(student,'grades')`；不从内部评估草稿表补资料。新 migration 为现有 JSON 增加 `participantId`。 |
| 已发布课后反馈 | `learning_result_heads.published_revision_id`、`learning_result_revisions`；`get_my_session_reviews(p_from,p_to)` | 仅 `session_review` 且 `published`，本人或 guardian `grades` scope；`student_id` 已可直接映射 `participantId`。 |
| 知识总结、阶段报告 | `get_my_knowledge_summaries_v2(p_from,p_to)`、`get_my_stage_reports()` | 已有家庭发布投影可继续扩展；本次未复制结果表，也未将草稿当已发布内容。 |
| 练习与附件 | `assignments`、active `enrollments`、既有 `miniapp_practice_submissions/uploads`；`miniapp_my_practices()`、`miniapp_submit_practice(...)` | 继续 `/portal`、`/media` 已有合同；练习需要 grades，视频另需 video；附件仅私有 Storage 短时授权。 |
| 活动与预约 | `activities`、既有 `miniapp_activity_publications`、`activity_registrations` | 继续现有公开活动、预约、取消 RPC；预约状态写回现有报名表。 |
| 通知 | `notifications`；`mark_notification_read(p_notification_id)` | 用户客户端读取 `recipient_id=auth.uid()` 的未归档通知；RLS 仍限定本人。原 RPC 仅标记本人通知，并以 NOT_FOUND 拒绝其他通知 ID。通知是账号消息，不按显示姓名猜孩子归属。 |
| 请假与补课进度 | `session_leave_requests`、`session_changes`；`list_my_session_leave_requests()` | 返回孩子/课次 ID、原因、申请状态、最近补课课次与 `to_schedule | scheduled | completed | cancelled`。当前亲子关系成员可见；家长申请不等于已经改动教师排课。 |
| 请假申请 | `submit_session_leave_request(p_session_id,p_student_id,p_reason)` | 当前亲子关系、未来且未结束/未删除课次、active enrollment；原失败码包含 `SESSION_NOT_FOUND/SESSION_NOT_LEAVABLE/STUDENT_NOT_ENROLLED`，HTTP 层需明确转换。 |
| 错题本 | 暂无家长可用的错误答案投影 | `get_my_learning_check_results()` 是 student-only，返回解释/独立/提示/模仿/未完成等掌握程度，不能作为错题题干或答题正误。当前界面应说明尚未开放。 |
| 课程购买、优惠券、积分兑换、商城 | 现有本轮家长接口无对应可用合同 | 本轮不创建独立业务表或伪造订单、余额、课时、权益。课程页面从真实课表/练习/发布结果展示已接入事实。 |

## 本次最小数据库合同升级

`20261001000100_parent_report_participant_identity.sql` 只用 `create or replace function` 替换无参数、返回 jsonb 的 `miniapp_assessment_reports()`。唯一数据差异是 JSON 新增 `'participantId',s.id`；原字段、发送版本关联、排序、100 条上限、账户/学生/grades 校验均保留。没有表、列、RLS 策略或业务数据变化，无需重新生成数据库函数类型。

旧微信客户端忽略新增字段。Next.js 为反馈报告补已有 `student_id`；升级前数据库的测评报告缺少 ID 时，新客户端采用明确缺失状态，按孩子筛选时不按姓名关联。迁移尚未执行，因此“含 participantId 的测评结果在真实数据库可读”仍待目标环境验证。

代码回退可恢复原函数定义，保留原有 JSON 字段和授权即可；应用客户端同时保留对缺失 participantId 的兼容。任何开发数据库或生产数据库应用仍先执行对应目标核查和授权流程。

## 源码依据与验证界限

- `20260712000200_p4d0_student_lifecycle.sql`：未删除学生与当前亲子关系。
- `20260712001300_p4e_business_compliance_org.sql`：`guardian_can` 逐 scope 校验。
- `20260730010000_r1_family_portal_visibility.sql`、`20260730010200_r1_leave_makeup_family_journey.sql`：稳定孩子 ID、课表/出勤、补课与请假投影。
- `20260801000100_r1_learning_result_independence.sql`：只读已发布 revision 的课后反馈。
- `20260825000200_classroom_roster_star_v2.sql`：当前学习概况十列。
- `20260728000300_r1_platform_runtime.sql`、`20260729000100_r1_notification_experience.sql`：通知 RLS 与本人已读。
- `20260922010000_parent_miniapp_portal.sql`、`20260922010100_parent_miniapp_storage_read.sql`：既有三端可复用的 portal、练习与媒体权限。
- `20260731001100_r1_student_learning_check_results.sql`：student-only 学习检查，家长读取已发布结果。

定向测试 `tests/parent-ios-learning-rls.test.ts` 比对升级前后的函数，证明除稳定 ID 外原查询未变，并检查现有账户/grades 门、匿名授权和无新表/业务写入边界。它是源码合同检查，不能替代目标数据库 migration、真实 RLS 对照或产品人工验收。
