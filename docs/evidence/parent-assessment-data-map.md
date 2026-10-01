# 家长 1 对 1 测评数据映射

本增量对应 `DEV-PARENT-ASSESSMENT-SUPABASE-20261001`。共享 DTO 基线为 `3ac186bf`，SQL 为 `20261001000200_parent_assessment_requests.sql`。当前交付源码与定向检查，未连接业务数据库、执行 migration、造数或部署；数据库运行与家长实际预约验收尚未完成。

## 现有事实与入口

| 家长动作 | RPC / 现有数据 | 权限与业务边界 |
| --- | --- | --- |
| 查看当前孩子的测评 | `parent_assessment_overview(p_student_id)` → `lead_invitation_threads`、`leads.student_id` | 当前 `miniapp_can_participate(student,'grades')` 加有效账号；只返回同一学生的 `assessment_1v1` |
| 选择教师并提交意向 | `request_parent_assessment(p_request_id,p_student_id,p_assessor_id,p_parent_time_options)` | 唯一已确认线索、有效当前任课教师；只建立 `awaiting_teacher` 邀约 |
| 教师回复时间 | 现有 `set_invitation_assessor_availability` | 已分配教师的 `review.write` 和本人 assessor 范围；继续使用教师工作台 |
| 确认共同时间 | `confirm_parent_assessment(p_invitation_id,p_student_id,p_time_option,p_expected_updated_at)` | 锁定当前邀约，核验亲子关系、版本、有效教师与未来精确交集，更新为 `confirmed` |
| 教师开展测评 | 现有 `ensure_invitation_assessment_registration` / `ensure_quick_assessment_registration` | 仍由教师业务入口创建活动和登记；家长接口不创建到课或测评完成事实 |

三个家长入口仅授权 `authenticated` 执行。全部辅助函数均撤销 `public`、`anon`、`authenticated` 的执行权限；原表的 RLS 和授权保持原状。入口每次检查当前账号、账号安全和同意状态，以及当前学生本人或带 `grades` scope 的监护关系。等待写锁之后重新检查授权。已撤销关系不能通过请求 UUID 重放。

`leads.student_id` 是唯一身份桥梁。姓名、手机、`suggested_student_id`、原始来源字段和历史参与人记录均不用于建立孩子归属。唯一 `converted` 线索可复用；`invalid` 线索不能新建或首次确认。多线索只阻止新申请；同孩子已有邀约继续按实际身份读取和确认。

## 教师与时间范围

新申请教师来自 `enrollments(status='active', left_at is null)` → 当前运营状态为 `active` 且未归档、未移入回收站的 `classrooms`。教师必须是当前 `owner_id`，或当前 `classroom_staff_assignments` 中的 `primary_teacher` / `assistant_teacher`，且为有效 `staff` / `admin`、账号未锁定并具 `review.write`。历史 `school_subject_participants` 和其他邀约的 assessor 不扩充新申请名单。已有邀约仍只投影该条已分配教师的 ID 与展示名。

教师按展示名、ID 排序，最多 100 条；邀约按 `updated_at`、ID 倒序，最多 100 条。`eligibility.reason` 为 `null` 或 `NO_LINKED_LEAD`、`AMBIGUOUS_LINKED_LEAD`、`LEAD_UNAVAILABLE`、`ACTIVE_INVITATION`、`NO_ELIGIBLE_TEACHER`。越权不通过 eligibility 泄露对象状态，直接返回 `FORBIDDEN`；不可见邀约返回 `NOT_FOUND`。

时间使用 `Asia/Shanghai` 与既有 `YYYY-MM-DD@时段` 格，每组最多 84 项。新申请要求至少一项，拒绝重复、空值、多维数组和非法日历日期；具体格必须在未来，`after_school` 范围格的日期不能已过去。`parentTimeOptions` 与 `teacherTimeOptions` 保存协调候选，`sharedTimeOptions` 仅投影双方交集中未来的合法具体格，并排序去重。`after_school` 不转换为预约时间。

`awaiting_teacher`、`coordinating_time`、`awaiting_parent` 都处于协调过程。`proposedStartsAt` 仅在 `awaiting_parent` 表示既有提议时刻；`scheduledAt` 仅在 `confirmed` / `completed` 表示双方确认的测评时刻。`canConfirm` 还要求当前线索和教师有效。状态 `completed` 可能表示教师已接手并生成后续登记，不表示测评结果已完成或报告已发出。

时间格不提供全局公开空闲、排期库存或占位保证。按 doc 04，本增量沿用双方协调确认语义，未增加全校日历冲突硬门。取消、修改家长意向和全校开放预约不在这三个入口内。

## 请求重放与并发

仅在既有 `lead_invitation_threads` 增加两个 nullable 列：`parent_request_actor` 和 `parent_request_payload`。payload 保存版本、学生 ID、初选教师 ID 和规范排序后的初始候选。约束要求两列同时存在或同时为空；触发器使其创建后不可修改。业务协调继续使用原本的可修改字段，家长输出不暴露这份元数据、线索联系方式、内部摘要或事件备注。

客户端请求 UUID 同时作为邀约主键。请求级 advisory lock 串行化同一 UUID；只有当前有权访问该孩子的同一账号，以相同规范化输入重试才返回现有邀约。原请求判断先于新的申请资格和时效检查，因此学服修改当前字段、教师关系变化或时间经过不会产生第二条请求。其他账号或变更输入复用 ID 返回 `IDEMPOTENCY_CONFLICT`。

新建采用学生 → 线索行锁，并保留原有每条 lead 仅一个未关闭邀约的唯一索引；并发学服新建冲突转换为 `ACTIVE_INVITATION`。确认采用线索共享锁 → 邀约行锁，不在持有邀约锁后取得学生锁。首次确认要求 `expectedUpdatedAt` 与当前版本相同、状态为 `awaiting_parent`。相同已确认时刻的重试先返回现态，再跳过首次确认的时间与版本检查；不同时间或失效版本返回 `CONFLICT`。审计沿用 `lead_invitation_events` 和 `emit_domain_event`。

## 检查与运行限制

`tests/parent-assessment-rls.test.ts` 对源码检查公开函数授权、当前关系、UUID 桥梁、当前任课范围、不可变请求元数据、锁顺序、时区解析、确认顺序和投影白名单。此类检查不能证明 PostgreSQL 执行、真实并发、现有数据兼容或 RLS 运行结果。

本分支定向 Vitest 源码合同 9/9 通过，测试文件 ESLint 通过。集成人另持有忽略目录中的事务验证脚本；其 PostgreSQL 执行和回滚证据应由实际执行者单独登记，不能从源码检查推定。

目标数据库升级前仍需依其环境规则完成目标主机、实际 Supabase origin、监听进程和对应操作授权。升级后应使用现有固定开发身份定向验证同账号重试、跨孩子访问、权限撤销、教师回复、版本变化和持久再读；不得以临时身份或虚构教师时段替代真实业务验收。迁移未安装时 HTTP 应返回不可用，不能产生预约成功提示。
