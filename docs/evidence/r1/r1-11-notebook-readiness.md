# R1-11 · Notebook 生产准备子门（进行中）

## 状态

2026-08-12 完成发布所有权、归档 fail-closed 与点赞隐私边界加固。该结果是 R1-11 Notebook 子门的 E1/E2，不代表完整审核状态机、正式 Playwright、R1-11 阶段或 1.0 发布门通过。

| 字段 | 值 |
| --- | --- |
| `gate_id` | `NOTEBOOK-R1-11-INTERACTION-PRIVACY-20260812` |
| `domain` | Notebook 私有笔记 / 公开快照 / 点赞关系 / RLS |
| `result` | pass（窄子门） |
| `measured_value` | 定向 Vitest 6/6；临时 migration 与负向 SQL 在单一事务通过并回滚；migration 应用到小米开发库后，`pnpm r1:db-audit` 13 个断言文件全部通过且夹具写入均回滚；commit `9db7b0d` 从开发 pg-meta 刷新类型摘要；最终 `pnpm ci:checks` 15/15，提交态全量 Vitest 64/386、R1 Vitest 17 个文件 112/112、生产 build 314 页。 |
| `threshold` | anon 可读点赞身份数=0；登录用户可读他人点赞关系数=0；hidden/rejected/pending 点赞成功数=0；跨用户/归档笔记发布成功数=0；`posts.note_id` 改绑成功数=0；发布关闭时恢复导致重新公开数=0。 |
| `commit_sha` | `11885f7` |
| `migration_head` | 开发库 `20260812000100_r1_notebook_interaction_privacy.sql`；正式生产未连接、未变更。 |
| `environment` | Windows Node.js 22；小米自托管 Supabase 开发库；非生产。 |
| `dataset_manifest` | `.claude/test-accounts.local.md` 固定开发角色；SQL 只记录对象 ID，不保存凭据、点赞者清单或未成年人 PII。 |
| `started_at` | `2026-08-12T00:27:08+08:00` |
| `finished_at` | `2026-08-12T00:30:00+08:00` |
| `actor` | Codex desktop agent |
| `approver` | `not_applicable`（开发安全回归；正式发布审批仍在 R1-18） |
| `command_or_runbook` | `pnpm exec vitest run tests/r1-organization-settings.test.ts`；migration + `supabase/tests/r1_notebook_assertions.sql` 单事务回滚；`SUPABASE_DB_SSH=xiaomi pnpm r1:db-audit`；`SUPABASE_META_SSH=xiaomi pnpm db:types`；`pnpm ci:checks`。 |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-11/notebook-interaction-privacy-20260812.txt` |
| `artifact_hash` | `f44c946e0d1cd24076a7520f9550fa04faaeddd5f9516733b0f5acc5d385223e` |
| `retention` | 本摘要与小型 artifact 随 Git 历史永久保存。 |
| `access_roles` | 仓库读权限持有者 |
| `failure_ticket` | 当前窄子门无未关闭缺陷；完整 draft→review→published→withdrawn/revised 版本审计、显式失败 UI 与 Playwright 角色 E2E 保持 pending。 |
