# DEV-PARENT-ASSESSMENT-SUPABASE-20261001 · 家长1对1测评数据与权限复用

## 目标与验收

- 原 iOS 用户要求复用、扩展现有 Supabase，明确不创建新表，并由 Supabase 与 Next.js 子 Agent 同步接口。小程序原会话的人类于 2026-10-01 明确测评是独立入口，用来预约老师做1对1测评；其原请求已授权两个会话协作。
- 对应 doc 04 当前开发轨，不改变 R1-Live-2 或生产 Gate。上游：[小程序家长入口](DEV-PARENT-WECHAT-20261001.md)。
- 复用 `lead_invitation_threads` 的家长意向、教师回复、双方确认流程；新增当前家长身份下的读取、申请和确认 RPC。普通活动继续使用原活动合同。
- 通过稳定学生 ID、当前亲子授权和真实任课关系检查对象范围；不公开全校教师目录或把候选时间描述为空闲库存。
- 新申请必须能按客户端 UUID 原子重放；重复确认返回同一结果，跨孩子、不同输入复用 ID、撤销权限、失效版本和非交集时间均有明确错误。

## 合同与交接

- 复核者：Next.js 子 Agent，集成人补充检查；复核绑定代码 head。
- 共享 DTO 由 [Next.js lane](DEV-PARENT-ASSESSMENT-NEXT-20261001.md) 先独立提交。字段使用 `displayName`、`timeZone`、`proposedStartsAt`、`scheduledAt`、`canConfirm`。
- RPC：`parent_assessment_overview(p_student_id)`、`request_parent_assessment(p_request_id,p_student_id,p_assessor_id,p_parent_time_options)`、`confirm_parent_assessment(p_invitation_id,p_student_id,p_time_option,p_expected_updated_at)`。
- 只有当前 `miniapp_can_participate(student,'grades')` 主体可以调用，原 lead/thread 表继续保留原权限。新建只接受唯一 `leads.student_id` 关联；已转换的真实关联可复用，不创建替代 lead。
- 新申请教师候选取当前有效 `enrollments` → `classrooms` 的真实教学责任关系，并要求教师账号有效且有 `review.write`。无有效关系以 eligibility 原因返回；现存邀约教师仅随本条邀约读取。
- 幂等元数据使用既有邀约表的 nullable `parent_request_actor` 和 `parent_request_payload`，写入后不可变；不建新表，不使用可变备注充当请求记录。

## 环境与验证

- 工作目录复用 `.worktrees/parent-ios-supabase-codex` 的干净 checkout，切到登记的新分支；原分支提交保留。
- 本卡只实现和检查源码，不连接业务库、执行迁移、造数或部署。数据库执行另需明确目标、主机/origin/监听进程的只读 preflight 与对应授权。
- 定向检查覆盖权限边界、候选教师范围、持久幂等、真实日期与上海时区、并发锁、版本与状态确认；明确区分源码检查与数据库运行结果。
- 实现先单独提交，再写交接文件记录 base/head、检查结果、未执行的迁移与运行局限。依赖中缺失迁移应使 API 返回不可用，不能返回伪造成功。

## 交付状态

- 当前：只读调查已完成，登记实现；无数据库执行或生产操作。
- 目标：可复核的 SQL 增量、窄检查和数据映射说明。数据库运行与人工预约验收仍待完成。
