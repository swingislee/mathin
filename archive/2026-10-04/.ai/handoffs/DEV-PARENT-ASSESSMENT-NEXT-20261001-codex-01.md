# DEV-PARENT-ASSESSMENT-NEXT-20261001 · Codex 第 1 次交接

- 发出方 / 接收方：Next.js lane / Supabase lane 与集成人。
- 目的：共享合同与独立测评 HTTP 实现交付。
- 关联任务卡：[家长 1 对 1 测评共用接口合同](../tasks/DEV-PARENT-ASSESSMENT-NEXT-20261001.md)。
- 代码 base：`8aeeddddd49b3ceffaa7470d8d2d3006b8b40781`。
- 合同提交：`3ac186bf28dbe5d8676ec611275b6ad0ad50f560`，先交付 DTO、OpenAPI schemas、说明和微信生成副本。
- HTTP 提交：`25792d1a845e3d37d47f6c01e5aae43ebc168466`；互审修复后代码 head：`4e7f2ffe659199f22c8ee0cc2b4e0eaf823861b6`。
- 分支 / worktree：`codex/parent-assessment-next-codex` / `.worktrees/parent-ios-next-codex`。

## 行为与合同

- 新增 `GET /api/v1/parent/assessments?participant=...`，返回资格、有限范围真实教师与本人孩子的 1 对 1 邀约；`POST` 接收 `request` 和 `confirm`。沿用 Bearer `auth.getUser()`、账号安全门、32 KiB JSON 上限与 `private, no-store` 响应。
- 只调用 `parent_assessment_overview(p_student_id)`、`request_parent_assessment(p_request_id,p_student_id,p_assessor_id,p_parent_time_options)`、`confirm_parent_assessment(p_invitation_id,p_student_id,p_time_option,p_expected_updated_at)`，不使用管理员 client 代理业务写入。
- 状态、教师、时间和持久幂等由数据库授权并决定。HTTP 保留原客户端请求 ID、原始微秒时间版本与历史重放输入；UUID 统一小写以兼容原生 UUID 输出。幂等和时间变化对外归一为 `CONFLICT`。
- 输出逐字段校验并丢弃未登记字段；确认学生/邀约 ID 一致、共有时段确为双方成员、状态与提议/确认时间不矛盾。RPC 缺失、响应不完整或越出本次孩子范围时返回 `UNAVAILABLE`，不伪造空列表或成功状态。
- `sharedTimeOptions` 仅为未来精确交集；`after_school` 保留为意向。`proposedStartsAt` 只出现在等待家长时，`scheduledAt` 只在 confirmed/completed 表示实际预约时刻。completed 是邀约流程结束，可能刚进入测评登记，不能推定测评结果或报告完成。
- 变更文件：`contracts/parent-api/{portal.ts,openapi.json,README.md}`、微信生成的 `lib/api-types.ts`、新增 assessment route、`assessment-contract.ts`、`assessment-server.ts` 与 `tests/parent-assessment.test.ts`。原活动预约、学校邀约操作与原生 iOS UI 未修改。

## 验证与复核

- Node.js `22.16.0`、Vitest `4.1.10`、TypeScript `5.9.3`。
- `node node_modules/vitest/vitest.mjs run tests/parent-assessment.test.ts`：修复后 29/29 通过。覆盖身份与账号门、有限 RPC、字段白名单、跨孩子隔离、原生大写 UUID、输入上限、冲突、历史重放与错误响应。测试使用模拟 RPC，不能证明 PostgreSQL 权限、并发或持久事实。
- 定向 ESLint：新增 route、contract、server 和测试通过；UUID 修复后重查受影响 contract 与测试通过。
- `node scripts/sync-parent-contract.mjs --check` 与 `node scripts/check-parent-foundation.mjs` 通过；后者在 HTTP 路径加入后再次通过。
- 类型检查：使用仓库 tsconfig 选项，根文件限定为共用 DTO、新增 contract/server/route/test 与现有 `.d.ts`，检查传递依赖，`noEmit=true`、`incremental=false`，通过。
- 全库 `tsc --noEmit --incremental false` 未通过：仅 `tests/agent-coordination.test.ts:97/105/106/117` 的 `taskId` 属性与现有 `{ working?: boolean }` 类型不符。该文件及 `scripts/agent-context.mjs` 相对 base 无修改，本卡未改跨任务文件。未将定向类型通过记作全库通过。
- `git diff --check` 和各代码提交的实际 staged 隐私 hook 通过。
- Supabase lane 已只读复核代码 head `4e7f2ffe...`：大写 UUID 兼容发现已修复，其余 RPC、身份、错误和投影合同无阻断发现。
- 本 lane 只读复核 Supabase head `e5ffec41158f7cc75812daf749d47391f8c4fe30`：初始 metadata 约束冻结可变 kind 的兼容问题已修复，学服可以沿原流程切换类型；家长重放返回 CONFLICT。三个 RPC 与本 HTTP 字段、参数和失败语义一致，未发现其他源码阻断项。

## 后续与状态

- 无未提交代码修改，无运行中的服务或检查进程，无数据库或共享端口占用。本 lane 未连接数据库、执行 migration、创建身份、写入业务数据或部署。
- 集成人合并本合同/HTTP/UUID 补丁与已复核 SQL；全库协作登记类型错误由对应所有者处理。数据库真实事务验证结果由实际执行者单独记录。
- 数据库迁移未安装时接口明确返回不可用。安装与业务试运行仍按目标环境授权执行；之后再由固定身份核验完整申请、教师回复、确认与再读。
- 产品人工验收、目标环境部署与 Gate：本卡均未完成，不以源码或模拟 HTTP 检查替代；客户端业务入口由微信 lane 接入。
- 接收确认：待集成人接收；本交接引用已完成的双方只读复核结论。
