# 历史资料实际导入测试

本增量把一小批真实历史原文写入本机 Supabase，并在开发页面读取数据库中的持久记录。来源选择、身份匹配、工作范围和完整性先在小批样本中验证，产品负责人随后检查原文可读性与归属。

## 本轮范围

- 输入复用历史预览已封存的原始资料提取结果，核对 SQLite 文件与来源 manifest 的 SHA-256。
- 身份重新读取当前目标库的已完成来源导入记录。选取 3 个已有学生、3 个已有线索，另选 2 个归属候选案例、2 个当前未匹配案例。
- 保存完整来源字段及原始值；日期缺失保持缺失，导入时间单独保存。阶段、年级、当前工作名单继续使用原业务记录。
- `history_import_records` 的学生／线索外键只承载明确匹配。候选保存在候选资料中，共用电话本身不确立同一孩子。
- `history_import_batches` 保存批次与输入指纹，`history_import_batch_records` 保存本批来源记录清单；相同记录与批次重复执行复用已有行，输入变化明确报错。

本轮页面是开发管理员入口，位于 `/zh/dashboard/history-import/test` 与 `/en/dashboard/history-import/test`。已关联学生的跟进页提供历史原文入口。原来的 `/dashboard/history-import` 继续提供全部来源预览。

## 执行

1. 按 `docs/agent/operations.md` 核对主机、实际 Supabase origin、监听进程、Docker 本地管道、网关端口映射、数据库网络与 `pg_control_system()` 指纹。将本次事实写入 gitignored 的 `.tmp/history-import-trial/preflight.json`，字段为 `checkedAt`、`host`、`supabaseOrigin`、`systemIdentifier`、`listeners`。有效期为一小时。
2. 将 `20260906000100_history_import_archive.sql` 按本机迁移流程执行。先保存当前 schema，在事务内应用 migration 并运行 `scripts/sql/history-import-trial-assertions.sql`，回滚后确认三张新表均无残留，再原子提交 migration 与规范化 checksum。该 SQL 断言只使用已有身份及本功能的合成档案，调用方负责回滚。
3. 准备精确样本：

```powershell
node scripts/history-import-trial.mjs --prepare --attestation=.tmp/history-import-trial/preflight.json
```

4. 实际写入，然后用相同命令重放一次，检查第二次 `insertedRecords=0`：

```powershell
node scripts/history-import-trial.mjs --apply --attestation=.tmp/history-import-trial/preflight.json
```

导入程序每次重新核对本地连接、监听进程、网络与当前身份；写事务再次检查数据库指纹。事务内比较身份、沟通、报名、课次、续费、工作项和提醒等 38 张现有表的数量与内容摘要，并逐字段检查入库原文。任一不变量变化时整批回滚。

`.tmp/history-import-trial/plan.json`、`fresh-identity-snapshot.json`、`attempt-*.json` 和 HTTP 检查结果包含私有资料，保持在忽略目录。仓库保存实现、合成测试与匿名证据。

## 验证与下一步

定向检查使用 `tests/history-import-trial.test.ts`、受影响历史入口边界测试、SQL RLS 断言、类型检查和固定开发账号的 HTTP/API 读取。数据库原文应与导入计划逐字段相同；管理员可见，其他身份不可见。产品负责人在页面验收查询与原文展示。

当前批次完成历史原文落库、已有身份关联与幂等重放。全量历史迁移、候选归属决定、普通新名单的全范围查重、四个生命周期里程碑回填与本轮工作名单启用继续作为后续业务增量。当前程序限定本机试验，生产迁移采用独立的明确批次和生产 runbook。
