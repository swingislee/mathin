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

## 单个家庭的来源核对与实际使用

产品负责人指定原样本中的一名学生后，使用 `--family` 搜索全部已提取来源中的姓名、电话及明确身份关联。将下面的学生姓名替换为指定对象：

```powershell
node scripts/history-import-trial.mjs --prepare '--family=学生姓名' --attestation=.tmp/history-import-trial/preflight.json
node scripts/history-import-trial.mjs --apply '--family=学生姓名' --attestation=.tmp/history-import-trial/preflight.json
```

家庭清单与执行记录保存到 `.tmp/history-import-trial/family-<摘要>/`，使用独立批次；已存在的原文继续复用。对同一家庭批次重放验证新增为零。

家庭核对区分明确关联、相关候选与班级名单中的姓名。横向名单保留目标姓名所在单元格，整行仍作为共享来源保存；名单中的其他孩子不会因此归入该学生身份。覆盖数字只表示现有可检索资料中的命中位置。

开发管理员从已有学生的 `?tab=followups` 进入，可直接阅读续报沟通背景、测评与报名来源，逐项查看来源覆盖和当前档案差异，再使用原有表单记录本次跟进。展示来源中已经发生的事实，不将来源编辑时间变成业务发生时间。重复报名日期与缴费字段按对应课程段读取。

当前学生分类、性别和年级与源资料有差异时并列展示，后续按业务定义及人工核对结果更正；这一增量继续保留当前业务表与工作范围。完整生命周期恢复与当前名单启用仍有独立退出条件。
