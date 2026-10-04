# 测评快速登记与逐题完成开关

> 范围：`DEV-SCHOOL-OPS-1` 开发增量；不改变生产阶段或正式 Gate。

## 产品行为

- `/dashboard/followups/assessments` 中的 1 对 1 测评在详情提供快速登记，主行“当前工作”列保留唯一逐题入口。原预约成为参与记录前，保存也可原子承接原 Lead；仅保存反馈不会伪造 Student、到场或逐题完成。
- 快速登记保存分数、等级、学情、建议、家长反馈和归类，受 `review.write` 的原逐题范围，或 `followup.write` 的原跟进范围约束。逐题权限保持原样，系统开关继续使用 `system.operations.manage`。
- `assessment.require_teacher_completion` 是机构级布尔开关，默认 `false`。在“系统 → 运行与错误 → 能力发布”选择“生成测评结果前必须完成逐题测评”，创建启用或停用版本；沿用生效时间、变更原因、版本审计和回退入口。
- 关闭时，有分数、等级或学情/建议的快速登记可以生成结果；单独家长反馈或归类仍只是运营记录。开启时，所有快速内容仍可保存，新的最终结果等待逐题完成；开关变化保留已经生成的结果。
- 学服归类不以最终测评完成为前提。实际报名继续沿用既有参与资格检查，不因允许提前沟通而扩张报名权限。
- 逐题专业结果与快速内容分别留存。老师完成后，学服补录不会覆盖其分数、观察和实际测评人；详情显示各类记录的实际操作者及时间，结果列标明结果来源。旧记录只显示已有操作者事实，不推断历史岗位。

## 数据与兼容范围

迁移：`20260907000100_assessment_optional_question_entry`。

- 新增 `assessment_quick_entries`，保存快速内容、版本、操作者及本次生成结果时间；`assessment_entry_events` 追加保存前后内容与操作者，客户端只有受范围保护的读取权。
- `assessment_results` 新增 `result_source`、`result_finalized_at`。逐题过程可保存中间结果，只有真实完成才带最终时间；快速登记通过相同数据库判定。既有业务行不回填、不修改结论。
- `assessment_entry_actors` 是遵循底表 RLS 的最新来源投影，不把安排老师等同于快速录入人。
- 新 RPC `save_assessment_quick_entry` 以服务端身份记录作者，检查源对象、范围、历史状态、可用参与状态及快速登记版本；冲突返回 `ASSESSMENT_ENTRY_CONFLICT`，保留客户端草稿。
- 旧的邀约/1 对 1 汇总 API 转入同一快速登记判定；活动集中测评保持原逻辑。反馈与归类复用 `activity_followup_contacts`、`activity_routes`；补齐 Lead 负责范围内的归类读取。
- 现有共用 `guard_business_record_state` 的一处跨表字段判断改用 JSON 读取，解决新增活动时引用不存在的 `opportunity_id` 的错误；历史状态、来源校验及修订权限保持原义。

## 隔离开发验证与应用

脚本在每次调用时核对 Windows 本机、实际 Supabase origin、监听进程、Docker 本地端点与网络、数据库系统标识。固定开发账号通过邮箱解析当前 UUID；测试线索、预约和测评只存在于回滚事务，不新增账号或学生档案。

```powershell
node scripts/assessment-quick-entry.mjs --preflight
node scripts/assessment-quick-entry.mjs --check
node scripts/assessment-quick-entry.mjs --check-history
node scripts/assessment-quick-entry.mjs --apply
```

`--check` 覆盖可选/强制、开关权限、提前反馈归类、旧入口、并发冲突、双方来源、逐题结果保护、未建参与的预约、越权和不可变审计。`--check-history` 复用历史修订合同检查共用守卫。两者按事务回滚，并核对既有 21 类对象逐字段摘要不变。正式应用只运行已匹配规范化摘要的迁移，记录本机 ledger；不执行业务补录或生产写入。

回退优先使用开关恢复逐题前置策略，并退回兼容应用版本；新增字段和审计保留。迁移回退演练使用事务 rollback，不通过删除快速记录或历史事实恢复界面。生产迁移、应用发布和正式验收分别申请授权及执行对应 runbook。

## 2026-09-07 开发交付记录

- 上述迁移已应用到核对后的本机隔离库；规范化摘要为 `bee3d3d41ab69894b61f704f574a8dfab3382a705406d7ffa7471215d8593b33`。快速登记和历史修订事务检查通过，既有 21 类业务对象的原字段摘要不变。
- 应用后只读核对：开关关闭，匿名无快速 RPC/表读取权限，快速登记表及来源事件表均为零行，未留下测试记录。数据库类型从已迁移目标生成并通过迁移摘要核对。
- 受影响的测评、动作授权、阶段、归类、系统开关与历史修订 Vitest 通过；本次源码及测试 ESLint、双语 key 对齐和文本检查通过。
- 全库 TypeScript 检查仍报告 `business-record-feedback`、`communication-workbench-render`、`enrollment-placement-workbench` 三个既有测试文件中的 4 处 Provider `children` 类型错误；本次功能文件没有类型错误，未修改这些无关测试。
- 页面未登录 HTTP 健康检查通过；没有启动浏览器控制或截图。当前状态为“开发端已交付，待人工视觉与业务验收”，没有生产发布或正式 Gate 关闭。
