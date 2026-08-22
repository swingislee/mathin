# Mathin R1 发布证据索引

本目录是 R1-Live 与 R1-0～R1-18 的唯一仓库内证据入口。它保存可审查的小摘要、结构化结果和外部 artifact 索引，不把大日志、视频、截图、secret、token、测试凭据或可识别未成年人 PII 提交到 Git。

当前唯一施工阶段为 **R1-Live-2 · 首个真实教师闭环**。R1-Live 只保留两个结果门：Gate 1 `PASS`、Gate 2 `BLOCKED`；首个闭环固定为正式教师整班点名，见 [R1-Live 差距表](r1-live.md)与[目标核查及生产备份](r1-live-target-audit.md)。原 R1 暂停在 R1-9，SML-0 为独立并行轨道。

## 存储合同

| 载体 | 保存内容 | 保留期 | 访问角色 |
| --- | --- | --- | --- |
| `docs/evidence/r1/` | 阶段摘要、命令结果、失败 ticket、外部 artifact URL/path、SHA-256 和审批记录；单文件原则上不超过 1 MiB | 随 Git 历史永久保存 | 仓库读权限持有者 |
| CI artifact | 可重跑的构建、测试、E2E、性能、无障碍日志和无 PII 截图 | 至少 90 天；进入正式发布包的文件在过期前复制到受控对象存储 | 仓库 Actions 读权限持有者 |
| 受控对象存储 | 恢复/回滚、14 天 RC、生产清理、视觉签收视频等发布关键大件 | 至少保留至 `v1.0.0` 后 365 天；法规或业务要求更长时从其规定 | `swingislee` 及在对应阶段明确登记的复核人 |

开发机临时文件、聊天附件和未记录 hash 的外部链接不构成发布证据。证据含用户数据时先去标识化；无法去标识化的材料只能进入受控对象存储，并在索引记录数据范围和最小访问角色。

## 记录格式

每个阶段使用 `r1-N.md`，每条证据包含：

```text
gate_id, domain, result, measured_value, threshold
commit_sha, migration_head, environment, dataset_manifest
started_at, finished_at, actor, approver
command_or_runbook, artifact_url_or_path, artifact_hash, retention, access_roles
failure_ticket
```

`artifact_hash` 使用 SHA-256。尚未产生的字段写 `not_applicable` 或带 owner/截止阶段的 `pending`，不得留空；硬门需要的字段为 `pending` 时，该 gate 不得记为通过。

## 阶段索引

| 阶段 | 状态 | 日期 | 证据 |
| --- | --- | --- | --- |
| R1-Live | Gate 1 passed；Gate 2 current/blocking | 2026-08-23 | [真实教师点名闭环差距表](r1-live.md)；[目标核查、应用/数据库发布、正式管理员交接、manifest 激活、真实教师注册/岗位保护与当前生产备份](r1-live-target-audit.md)；[仓库写入目标保险丝](../../runbooks/r1-write-target-policy.md)；[正式对象保护 manifest](../../runbooks/r1-live-object-protection-manifest.md)。Xiaomi 已固定为当前生产目标，危险写入口与 purge 数据库合同 fail-closed；唯一正式管理员、首名真实教师双岗位、active 8 条 protected/0 条 purge manifest、当前 PostgreSQL+Storage 同批次备份和数据库 head `20260822000300_r1_live_enrollment_status_transition` 均已核验，因此 Gate 1 `PASS`。应用 current 为 `20260822-162416` / `6dfb3af…`，previous 为 `20260822-072101` / `ef1eb77…`。本机固定账号 Golden Path 1/1 与当前两 Gate 源码合同 52/52 均通过；新学年合同另通过最终空库重建、旧库升级、回滚式晋级断言及固定主管 zh/en 只读旅程，生产部署尚待完成。产品负责人已通过正式 UI 创建 1 个 production 班级和 15 个课次，主讲 1、学辅 0；建班页隐藏学辅 UUID 导致最终才报 `VALIDATION` 的问题已改为字段所在步骤就地校验并发布。生产报名和点名仍为 0，正式教师保存/再读、管理员可见和无权限拒绝尚未执行，因此 Gate 2 未通过 |
| R1-0 | passed | 2026-07-28 | [规划真相源与发布边界冻结](r1-0.md) |
| R1-1 | passed | 2026-07-28 | [机构配置、规则与 Feature Flag](r1-1.md) |
| R1-2 | passed | 2026-07-28 | [Jobs、通知、文件与外部集成](r1-2.md) |
| R1-3 | passed | 2026-07-28 | [账户、安全、同意与管理员支持](r1-3.md) |
| R1-4 | passed | 2026-07-28 | [Work-items 混合模型与轻审批](r1-4.md) |
| R1-5 | passed | 2026-07-31 | [学生/家庭门户、课堂连续性与集成 CI 总门](r1-5.md) |
| R1-6 | passed | 2026-08-01 | [教学成果、阶段报告、通知与客户读取](r1-6.md) |
| R1-7 | passed | 2026-08-01 | [初始化、导入、质量、修复与导出](r1-7.md) |
| R1-8 | passed | 2026-08-12 | [财务安全关闭](r1-8.md)；`BUG-R1M-024` 与 `BUG-R1M-025` 已由迁移 `20260804000100` 修复，并在 commit `e231d7c` 复验：`pnpm r1:test` 15 个文件、99 项全绿，`SUPABASE_DB_SSH=xiaomi pnpm r1:db-audit` 的 12 个 SQL 断言文件全部通过并输出 `R1-8 finance safe-close assertions passed`；脚本均在事务中回滚，不留写入。具体 artifact 与 hash 由 r1-8 阶段证据登记 |
| R1-9 | paused for R1-Live | 2026-08-14 | [P6-AIX-2 爱学习 v31 多难度子门](r1-9-aixuexi-courseware.md)已关闭，开发库为 G+/X+/A+ 12 门/170 讲/5442 页；[两套课程来源 manifest v4 与受控导出 runner](r1-9-courseware-source-manifest.md)已同步 102 门/1305 讲/2610 条 Production 1.0 目标。批准副本、E 系列 provenance、真实 inventory、Storage/H5 字节审计和非执行者复核仍 pending；除首个真实课次所用讲次可读外，不阻塞 R1-Live |
| R1-10～R1-18 | queued after R1-Live | — | Notebook 两个数据库子门和非五模块 Playwright 本地基线等已完成增量继续保留。完整公开模块、视觉、全量 E2E、指标、清理/release、恢复和 14 天观察移入 R1-Live 后；R1-15 旧“只保留管理员”planner 在增加正式对象保护 manifest 前不可执行，R1-18 不得删除 R1-Live 真实数据 |
