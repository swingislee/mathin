# Mathin R1 发布证据索引

本目录是 R1-Live 与 R1-0～R1-18 的唯一仓库内证据入口。它保存可审查的小摘要、结构化结果和外部 artifact 索引，不把大日志、视频、截图、secret、token、测试凭据或可识别未成年人 PII 提交到 Git。

当前唯一施工阶段为 **R1-Live-2 · 生产单老师试用**。R1-Live 只保留两个结果门：Gate 1 `PASS`、Gate 2 `BLOCKED`；生产端已进入 1 名正式教师小范围试用，首个闭环仍固定为整班点名、持久再读与权限对照，见 [R1-Live 差距表](r1-live.md)与[目标核查及生产备份](r1-live-target-audit.md)。开发端可并行预演产品负责人选中的新功能，但只有开发初验、生产发布及 postflight 各自形成证据后才能提升对应环境结论。原 R1 暂停在 R1-9，SML-0 为独立并行轨道。

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
| DEV-CW-SOURCE-1 · 来源课件运行时与暑期 A+ | machine postflight/browser visual smoke passed；production deployed；pending product acceptance | 2026-08-28 | [全量生产备份、来源运行时迁移、秋季三包升级、暑期 A+ 两讲/13 空占位、双 release 与两讲 4:3 互动实看证据](courseware-source-runtime-production.md) |
| DEV-TMC-1/2 · 普通教师短期微课与课次多方案 | development checks passed；production schema/app deployed / flag v2 true；read-only browser smoke passed；pending product acceptance | 2026-08-28 | [首版闭环、多方案协作/选用、班级重新启用、SQL/Vitest/Playwright/CI、全量备份、迁移、双 release 与 postflight 证据](teacher-microcourse-dev.md) |
| POST-LIVE-OPS-02 · 班级用途与单次活动边界 | production schema/app deployed；machine postflight passed；pending product acceptance | 2026-08-28 | [迁移重编号、当前数据库备份、rollback/formal、原子 release、权限/业务不变量与 HTTP postflight](classroom-offering-activities-production.md) |
| 课堂体验升级 M0–M5 | Stage A/B1/B2 passed；Stage B3 remediation deployed / H5 flag false / pending production acceptance | 2026-08-26 | [开发端验收摘要](classroom-experience-dev.md)与[M5 生产分段启用](classroom-experience-m5-candidate.md)：隔离提交 `964ca5e` 已部署共同 bridge、`cw_h5_input_profiles` 与外层透明无边框、强调色 SVG + 滑轨的 `112×44px` Smart 二态开关；board/input/layout=`v2/true`，H5=`v3/false`，空档案表不授权现有 package。新鲜 PostgreSQL-only 备份、migration rollback/formal、双 build、原子切换和独立 postflight 通过；生产人工验收与逐包档案登记仍待完成 |
| R1-Live | Gate 1 passed；Gate 2 single-teacher production trial/blocking；课堂 B3 remediation、phone/password P0、账号中心第一阶段、教师微课多方案、来源课件运行时与班级/活动分类 pending acceptance | 2026-08-28 | [真实教师点名闭环差距表、手机号 P0、账号中心与课堂发布证据](r1-live.md)；[目标核查、应用/数据库发布、正式管理员交接、manifest 激活、真实教师注册/岗位保护、当前生产备份及 2026-08-25 环境误判事件](r1-live-target-audit.md)；[教师微课与多方案生产证据](teacher-microcourse-dev.md)；[来源课件运行时与暑期 A+ 生产证据](courseware-source-runtime-production.md)；[班级/活动分类生产证据](classroom-offering-activities-production.md)；[仓库写入目标保险丝](../../runbooks/r1-write-target-policy.md)；[正式对象保护 manifest](../../runbooks/r1-live-object-protection-manifest.md)。生产 current/previous=`20260828-075322` / `c7c8219…` 与 `20260828-071313` / `087b497…`，ledger=`212`、head=`20260828000210_classroom_offering_and_activity_kind`；课堂 B1/B2 已人工通过，B3 修复底座已部署但 H5 flag 仍 false。独立开发轨均已发布但不关闭 R1-Live Gate 2。正式账号、既有班课/活动对象、Storage 和错误计数无漂移；课堂 B3、账号中心、教师微课生产写态、来源课件、班级/活动分类、真实手机号邀请注册/login 及正式教师点名保存/再读与权限对照仍待人工闭环 |
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
