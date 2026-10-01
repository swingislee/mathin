# DEV-PARENT-ASSESSMENT-SUPABASE-20261001 · Codex 第 1 次交接

- 发出方 / 接收方：Supabase 子 Agent `/root/supabase` → 当前集成人 `/root`、Next.js 复核者 `/root/nextjs`。
- 目的：实现交付与互审结果；关联任务卡：[家长测评数据与权限复用](../tasks/DEV-PARENT-ASSESSMENT-SUPABASE-20261001.md)。
- 代码 base：`8aeeddddd49b3ceffaa7470d8d2d3006b8b40781`；代码 head：`e5ffec41158f7cc75812daf749d47391f8c4fe30`，包含初始实现 `b7f3e022` 与互审兼容修复。
- 分支：`codex/parent-assessment-supabase-codex`；工作目录复用 `.worktrees/parent-ios-supabase-codex`。

## 实现与兼容

- `supabase/migrations/20261001000200_parent_assessment_requests.sql` 仅扩展既有邀约表的两个不可变请求元数据列，并增加家长概览、申请与确认 RPC 及私有辅助函数。未新建表或 lead，未扩大原表 RLS，未改写教师回复、活动登记或测评完成流程。
- 当前学生 / 监护权限与有效账号决定入口授权；`leads.student_id` 决定身份归属；当前有效班级报名及教学责任决定新邀约教师候选。使用唯一现存非 invalid 线索，允许已转换线索；不能证明的申请资格有明确原因。
- 请求使用客户端 UUID 和初始规范化 payload 原子重放；确认采用状态、原始数据库版本和上海时区未来精确共同格。`after_school` 保留为意向。`sharedTimeOptions` 仅含可确认的未来具体格；不提供全局教师库存或占位承诺。
- 元数据不冻结可修改的邀约 kind。旧学服将原测评改为其他业务类型后，家长原请求的重放明确返回 `CONFLICT`，保持原业务修改能力并避免错误投影。
- `tests/parent-assessment-rls.test.ts` 固定上述安全合同；`docs/evidence/parent-assessment-data-map.md` 记录来源、权限、时间、并发与运行边界。
- 共享 DTO 首提交 `3ac186bf`，与 Next.js 最终代码 `4e7f2ffe659199f22c8ee0cc2b4e0eaf823861b6` 的 RPC 参数、字段、状态和错误映射逐项一致。

## 验证与复核

- 使用已有主 checkout 的 Vitest 执行 `tests/parent-assessment-rls.test.ts`，9/9 源码合同通过；测试文件 ESLint、`git diff --cached --check` 和 staged privacy hook 通过。源检查不能替代数据库执行或产品验收。
- Next.js 子 Agent 已只读复核代码 head `e5ffec41158f7cc75812daf749d47391f8c4fe30`，确认 kind 兼容问题已修复，未发现其他阻断项；未在复核中执行数据库。
- 本 Agent 已只读复核 Next.js 最终 head `4e7f2ffe659199f22c8ee0cc2b4e0eaf823861b6`。初审发现合法大写 UUID 被 HTTP 精确比较误判；现已通过 schema 小写归一及 GET / request / confirm 测试解决。未发现其余阻断项，复用该 lane 的 29/29、定向静态与类型检查结果。
- 本 lane 未连接业务数据库、执行迁移、创建测试数据或部署。集成人另统一执行本机 PostgreSQL 验证；忽略目录已交付参数化的只读 fixture 定位与事务测试脚本，不提交实际身份、连接配置或原始日志。
- 集成人只读确认现有固定家长、学生、教师及未绑定家长可复用；两个 fixture 学生均有同一家长的 grades 权限，因此反向测试使用固定未绑定家长访问该学生。目标 fixture 当前关联线索为 0、当前可选教师条件不成立。脚本明确跳过正向申请、教师回复与确认；不补造 lead 或班级。
- 本机待执行的窄验证覆盖 SQL 安装、时间解析、匿名和辅助函数 ACL、当前家长概览、未绑定家长拒绝、`NO_LINKED_LEAD` 申请拒绝，以及事务回滚零残留。实际运行和安装结果由集成人单独登记。

## 交付边界与下一步

- 交接前工作树干净；没有运行中的本 lane 进程、开发服务或数据库连接。临时 SQL 文件均位于已忽略的 `.tmp/`。
- 接收方按两个实现提交集成源码，再记录其统一执行的数据库验证和安装结果；客户端按共同 HTTP 合同接入。
- 正向预约闭环仍需经确认的现有业务关系或单独授权的明确测试 fixture 验证，不以缺失的 fixture 推定通过。
- 状态为源码实现与互审完成；本交接不声明开发端完整业务已可验收、生产已部署、用户已验收或 Gate 已关闭。
- 接收确认：待集成人记录；只读复核结论已在已授权的协作消息中回传，并绑定上述代码 head。
