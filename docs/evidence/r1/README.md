# Mathin R1 发布证据索引

本目录是 R1-0～R1-18 的唯一仓库内证据入口。它保存可审查的小摘要、结构化结果和外部 artifact 索引，不把大日志、视频、截图、secret、token、测试凭据或可识别未成年人 PII 提交到 Git。

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
| R1-0 | passed | 2026-07-28 | [规划真相源与发布边界冻结](r1-0.md) |
| R1-1 | passed | 2026-07-28 | [机构配置、规则与 Feature Flag](r1-1.md) |
| R1-2 | passed | 2026-07-28 | [Jobs、通知、文件与外部集成](r1-2.md) |
| R1-3 | passed | 2026-07-28 | [账户、安全、同意与管理员支持](r1-3.md) |
| R1-4 | passed | 2026-07-28 | [Work-items 混合模型与轻审批](r1-4.md) |
| R1-5 | passed | 2026-07-31 | [学生/家庭门户、课堂连续性与集成 CI 总门](r1-5.md) |
| R1-6 | passed | 2026-08-01 | [教学成果、阶段报告、通知与客户读取](r1-6.md) |
| R1-7 | passed | 2026-08-01 | [初始化、导入、质量、修复与导出](r1-7.md) |
| R1-8 | passed | 2026-08-12 | [财务安全关闭](r1-8.md)；`BUG-R1M-024` 与 `BUG-R1M-025` 已由迁移 `20260804000100` 修复，并在 commit `e231d7c` 复验：`pnpm r1:test` 15 个文件、99 项全绿，`SUPABASE_DB_SSH=xiaomi pnpm r1:db-audit` 的 12 个 SQL 断言文件全部通过并输出 `R1-8 finance safe-close assertions passed`；脚本均在事务中回滚，不留写入。具体 artifact 与 hash 由 r1-8 阶段证据登记 |
| R1-9 | in progress | 2026-08-13 | 当前阶段为 `R1-9 · P6-9 与跨阶段非五模块生产准备`；[P6-AIX-2 爱学习 v31 多难度子门](r1-9-aixuexi-courseware.md)已关闭，开发库为 G+/X+/A+ 12 门/170 讲/5442 页；[两套课程来源 manifest v3 合同](r1-9-courseware-source-manifest.md)已同步正式 102 门/1305 讲/2610 条目标 release-1，并把每条轨道绑定到捕获时 head 指向的唯一不可变 release。只读 exporter、真实 1305 行 inventory、Storage/H5 实际字节审计与非执行者复核仍 pending；Story、Games、Minds、Terms、Tools 巡检暂缓，R1-9 尚未关闭 |
| R1-10～R1-18 | pending | — | 各阶段关闭时新增对应索引；Notebook 的[发布归属与互动隐私](r1-11-notebook-readiness.md)及[审核发布生命周期](r1-11-notebook-lifecycle.md)数据库子门已通过，完整私有写作/审核/公开互动/撤回与越权 release E2E、视觉签字仍待完成；[非五模块 Playwright 基线](r1-14-playwright-baseline.md)已有本地 9 条绿证据但 release target attestation、写态、zh/en、跨浏览器仍 pending；R1-15 只读 baseline preflight、[R1-16 部署 Preflight](r1-16-deployment-preflight.md)和[仓库 Secret Scan](r1-16-repository-secret-scan.md)已形成 E1/E2 子门，尚未执行快照清理、独立部署或恢复演练。五条公开线仍在 1.0 范围，恢复并通过原发布门前不得关闭 R1-12 或 R1-18 |
