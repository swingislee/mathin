# DEV-PARENT-IOS-SUPABASE-20261001 · Codex 第 01 次交接

- 发出方 / 接收方：Supabase 子 agent / iOS 集成人及 Next.js 子 agent。
- 目的：实现交付与数据权限合同核查。
- 关联任务卡：`.ai/tasks/DEV-PARENT-IOS-SUPABASE-20261001.md`。
- 代码 base：`8d016fdbf299779d40e4d56c55009d00850c41db`。
- 代码 head：`369a9729bde1f6f4cf9cb8e4dc9b5cb20088b5be`。
- 分支 / worktree：`codex/parent-ios-supabase-codex` / `.worktrees/parent-ios-supabase-codex`。

本次为原有 `miniapp_assessment_reports()` JSON 增加 `participantId=students.id`，支持同名孩子独立筛选。SQL 保持无参数、返回 jsonb，查询、排序、100 条上限、已发送版本、账号状态、亲子 grades 权限和函数授权全部保留；没有新表、数据写入或 RLS 放宽。代码文件为 `supabase/migrations/20261001000100_parent_report_participant_identity.sql`。

`docs/evidence/parent-ios-data-map.md` 记录现有参与人、课表、出勤、报告、练习、通知、请假/补课与相关 RPC 的实际边界。Next.js lane 已同步稳定 ID、用户 Bearer 查询、成绩/财务字段收敛、无家长错题投影等事实。旧数据库缺少测评 participantId 时，HTTP 层返回 null 并保持按 ID 筛选；应用不按姓名推断孩子。

验证：在本 worktree 执行 `node D:/code/2026/2026-07_mathin/node_modules/vitest/vitest.mjs run tests/parent-ios-learning-rls.test.ts`，Vitest 4.1.10，1 个文件 3 项通过。首次受沙箱 `spawn EPERM` 限制，获工具批准后同一命令通过。`git diff --cached --check` 与提交 hook 的 3 文件 staged privacy scan 通过；没有禁用 hook。

独立复核：Next.js 子 agent 已针对上述代码 head 回传无阻断发现，确认函数同签名、stable/search_path、已发送版本绑定、grades scope、authenticated 授权和无新表/业务写入；一致性测试覆盖本次最小差异。该结论不包含目标数据库执行。

反向复核：Supabase 子 agent 已对 Next.js head `54c3aa5ad93183a46fb3ee2f1ae1c8daaa97909c` 的 `learning-server.ts`、`learning-contract.ts`、原 `server.ts` 差异、route、DTO/OpenAPI 与定向测试进行只读核对，无阻断发现。GET 在真实用户鉴权后先核对当前学生关系，再按稳定 ID 切片；通知由本人 recipient 和原 RLS 授权，仅输出白名单；成绩与财务未从旧 summary 透传；报告仍依赖原已发布/grades RPC。POST 已读和请假继续调用原授权 RPC，失败码明确。测试覆盖账号安全门、未关联时提前拒绝、同名隔离、通知本人筛选、无 service role、查询失败不冒充空态及请假错误语义。复用 Next.js lane 回报的 28 项定向测试、范围 TypeScript、ESLint、微信 TypeScript/工程合同与暂存隐私扫描通过结果，没有重复执行。Next.js lane 另记录全仓 TypeScript 的既有 `tests/agent-coordination` 类型错误，此源码复核不将其记作本次接口通过或失败。

上述是源码合同检查，证明本次函数只增加 ID 并保留权限表达式；未连接数据库、运行 migration、创建测试身份或操作生产。真实数据库返回新字段、RLS 主体对照、iOS 构建与人工视觉验收仍未覆盖。本次没有服务进程、端口或数据库资源占用，代码提交后的工作树仅有本交接文件。

集成人下一步：完成 Next.js 与 iOS 代码复核后集成本提交；需要迁移时按目标环境规则另行执行前置核查。此交接不关闭生产阶段或 Gate，也不宣称已部署或产品已验收。

接收确认：待接收；集成人记录接收与集成状态。
