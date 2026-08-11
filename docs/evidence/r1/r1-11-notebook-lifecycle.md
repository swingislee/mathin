# R1-11 · Notebook 审核发布生命周期子门（进行中）

## 状态

2026-08-12 完成可追溯审核、revision 内容字段不可变、平台下架锁和新提交源笔记一致性合同。该子门已通过开发环境 E1/E2 与数据库负向审计；完整写态 release E2E 和视觉签字仍未完成，R1-11 保持 pending。

| 字段 | 值 |
| --- | --- |
| `gate_id` | `NOTEBOOK-R1-11-PUBLICATION-LIFECYCLE-20260812` |
| `domain` | Notebook draft/review/published/withdrawn/revised / revision / event / moderation / RLS |
| `result` | `pass`（生命周期与数据库边界子门） |
| `measured_value` | 两个 migration 均先完整执行后回滚，再只应用开发库；R1 DB audit 13/13；Notebook Vitest 6/6；TypeScript、ESLint、双语 3808 keys×2、初始化 manifest、生成数据库类型通过；`/zh/notebook/me` 修复后 Chromium 1/1。 |
| `threshold` | 作者不能直写 posts/revision/event；平台锁不能靠重发绕过；active 子笔记不能被归档父级联删除；NULL 决策状态变化=0；伪造/过期快照创建 revision=0；新提交绑定 locked source version/title/content，hash 可由 title+canonical JSON content 重算。旧 revision 的 source version 可为未知。 |
| `commit_sha` | `8c9cb8c`；安全复核 follow-up `ffe3ec6` |
| `migration_head` | 开发库 `20260812000300_r1_notebook_lifecycle_security_followup.sql`；正式生产未连接、未变更。 |
| `environment` | Windows Node.js 22；小米自托管 Supabase 开发库；非生产。 |
| `dataset_manifest` | 固定开发角色与 SQL 事务夹具；写入全部回滚，不保存正文、凭据或未成年人 PII。 |
| `started_at` | `2026-08-12T00:48:00+08:00` |
| `finished_at` | `2026-08-12T01:43:51+08:00` |
| `actor` | Codex desktop agent |
| `approver` | `not_applicable`（开发安全子门；正式发布审批仍在 R1-18） |
| `command_or_runbook` | migration 单事务回滚；`SUPABASE_DB_SSH=xiaomi pnpm r1:db-audit`；Notebook Vitest/ESLint/TypeScript/messages/init-plan/db-types；Chromium 定向复跑。 |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-11/notebook-publication-lifecycle-20260812.txt` |
| `artifact_hash` | `41ef2eca128f1e41af048701e879422dbceed594243999e84b5cc5af38ecae67` |
| `retention` | 本摘要与小型 artifact 随 Git 历史永久保存。 |
| `access_roles` | 仓库读权限持有者 |
| `failure_ticket` | 完整私有写作→提交→管理员审核→公开读取/互动→撤回的写态 Playwright、跨用户/角色越权、视觉签字与普通 Note CRUD ActionResult 统一仍 pending。 |
