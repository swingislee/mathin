# DEV-PARENT-PREVIEW-SUPABASE-20261002 · codex 第 01 次交接

- 发出方 / 接收方：Supabase 子任务 / root 集成任务。
- 目的：交付可复用的本机开发样例；数据库检查与装载由 root 唯一串行执行。
- 关联任务卡：[小程序可操作开发数据](../tasks/DEV-PARENT-PREVIEW-SUPABASE-20261002.md)。
- 代码 base：`b0fcf6b8aec9ecb0475956bce1a283b093b87bb6`。
- 代码 head：`54ef0eca9ed14b64897e17dfaacc1c7b43a9acca`；包含首个增量 `856aeaeee77b1397022a723bf686122f0dd79a18`。
- 分支 / worktree：`codex/parent-preview-supabase-codex` / `.worktrees/parent-ios-supabase-codex`。

## 行为与范围

- `scripts/parent-assessment-fixtures-local.mjs` 从已忽略的本机账号清单解析六个固定角色；提供只读 `--preflight`、`--inventory`，以及 `--check`、`--apply`。写入复用既有本机目标核验；检查回执绑定源码、私有角色输入、数据库目标及写前摘要，并限时使用。
- `supabase/fixtures/parent-assessment-local.sql` 复用既有家长、两名学生、教师、管理员与测试班。首次补两条明确标注开发演示的 lead 与教师关联，一名孩子留给页面新申请，另一名通过现有申请和教师回复 RPC 进入待家长确认。另补本批固定标识的未来公开活动、两节未来课次和登记示例；既有已发送报告继续使用。
- 同一业务标识已存在时保留预约状态、候选时间、教师及表单内容。归属冲突、其他关联 lead、失效测试班、已被人工移除的教师关系等情况停止；活动归属 marker 使用空值安全比较。
- `supabase/tests/parent_assessment_fixtures.sql` 在回滚事务中验证真实认证角色下的新申请、幂等重放、教师回复、家长确认、过期版本拒绝、未绑定家长拒绝，以及已有报告和课表投影。确认后再执行 fixture，核对受影响关系摘要保持一致。
- `tests/parent-assessment-fixtures.test.ts` 覆盖私有清单角色解析、注入和角色重叠拒绝、检查回执输入/目标/时间边界及新增式 fixture 路径。
- 无表、迁移、Auth 身份或共享 HTTP 合同变更；不创建测评活动到场事实、报告或冻结课堂资源。

## 验证与实际装载

- worker：`node --check`、定向 Vitest 4/4、定向 ESLint、`git diff --check`、提交前暂存隐私扫描通过。worker 未连接数据库，未启动共享开发服务。
- root 复核首个四文件增量后提出 marker 空值比较改进；代码 head 已处理，并增加教师关系重放保护。
- root 于 2026-10-02 在已核对的 Windows 本机开发目标执行精确最终代码 `--check`：事务回滚、原数据摘要一致、重复 fixture 保留已确认状态均通过。随后 `--apply` 成功；主分支对应集成提交 `2ccb417d`。
- 最终脱敏 inventory：固定六个身份；两名孩子各一条 lead、各两名当前可选教师；第一名可以新申请且无既有邀约；第二名为 `awaiting_parent` 且有两个未来共同时间；未来活动一条、课次两条、登记示例一条、既有已发送报告两份。
- 原始数据库错误及目标核验记录保留在忽略的 `.tmp/parent-assessment-fixtures/`。本单仅记录脱敏结果。

## 接续状态

- 未提交修改 / 运行进程 / 共享资源占用：交接提交后工作树干净；无本 lane 运行进程与共享端口占用。
- 接收方下一步：继续真实 HTTP 和固定家长小程序读取，人工分别验收新申请与确认预约。若后续人工改动使样例不再满足入口条件，先查看 `--inventory`，保留实际业务操作。
- 微信登录/绑定：已向 Next.js 子任务提供现有 Auth identity、票据、审计与资料快照约束；后续代码由其独立交付并互审，本增量不改认证。
- 产品状态：开发库样例已装载；真实客户端与产品人工验收由集成任务继续。生产部署与正式 Gate 不涉及。
- 接收确认：root 已复核、集成并完成最终代码的真实本机检查和装载；HTTP 与客户端结果由集成任务另记。
