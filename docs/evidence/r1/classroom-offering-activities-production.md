# POST-LIVE-OPS-02 班级用途与单次活动边界生产证据

> **结论**：`DEPLOYED / PENDING_USER_ACCEPTANCE`。2026-08-28 在产品负责人明确要求“推送生产”后，完成迁移重编号、生产只读 preflight、当前 PostgreSQL 写前备份、迁移完整回滚/零残留/formal、应用原子发布和独立机器 postflight。产品负责人尚未在生产页面实际新建短期专题课或公开课。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `POST-LIVE-OPS-02`；classroom offering / one-off activity boundary；`DEPLOYED / PENDING_USER_ACCEPTANCE` |
| `measured_value`, `threshold` | migration `20260828000210_classroom_offering_and_activity_kind` 在同一生产基线上完成 `SERIALIZABLE` rollback 与独立零残留核查后正式提交，ledger=`211→212`；3 个既有班级全部回填 `long_term_formal`，`short_term_topic=0`；既有活动/报名=`3/0`，新增 `public_class` 约束可用；服务 active/running、`NRestarts=0`、`ExecMainStatus=0`，发布后 journal error=`0`，公网 health 与 zh/en login=`200/200/200` |
| `commit_sha`, `migration_head`, `environment` | 功能提交 `5c8f606`，迁移重编号/生产候选 `c7c82192d6bf093423d3a81581733fb3833ef74b`；head=`20260828000210_classroom_offering_and_activity_kind`，LF 规范化 checksum=`6d728bd22a678e6c19056e0b23f934d983663cce6a98ae0d2b07e802d3d6f748`；Xiaomi / production，current=`20260828-075322` / `c7c8219…`，previous=`20260828-071313` / `087b497…` |
| `dataset_manifest` | 写前/写后 auth/profile/student/guardian/course/lecture/release/class/session/enrollment/attendance/activity/activity-registration/Storage/error=`14/14/5/2/103/1330/2977/3/16/1/0/3/0/125725/1949`；除 schema、RPC、约束、3 行默认回填和 migration ledger 外未创建或修改业务对象，未写 Storage |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-28T07:44:40Z`；`2026-08-28T07:56:00Z`；Codex；产品负责人明确指令“推送生产”，生产页面实际操作验收仍 `pending` |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 目标/窗口/备份 preflight → 当前 PostgreSQL backup → migration rollback/零残留/formal → `publish-mathin-xiaomi.ps1 -Action Publish` → 服务、HTTP、数据库、ACL、PostgREST 和业务计数 postflight；未运行生产写态 Playwright、未创建账号或夹具 |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260828-075322/release.json`；previous `/home/swing/services/mathin/releases/20260828-071313/release.json`；数据库备份 `/mnt/openlist-disk/Backups/Mathin/mathin-db-prechange-20260828T074643Z-classroom-offering-c7c8219/`，dump bytes=`270778627`、TOC=`4075`、SHA-256=`a2c3730653872f8f251f5649b14554ba6ea019c3c4c3db6bb60be13f8c001856`、manifest SHA-256=`61263984002dd2599410838d9a22f48b4ee2c12cda1e4ed7847d74bfa9a54ba4`；Storage 回退继续引用同日已验证全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497`；本轮未 prune/restore |
| `failure_ticket` | `not_applicable`。首次只读 SQL 使用历史“family”标签而非实际 `student_guardians` 表，在写入前由 PostgreSQL 拒绝，修正后通过；PostgREST 新列探针到达数据库并按既有 anon 表权限返回 `42501`，未放宽权限；Chrome 现有登录会话的两次只读导航因扩展连接超时自动中止，没有页面点击或业务写入，因此人工 UI 验收仍 pending |

## 生产边界与结果

- `classrooms.purpose=production|test` 继续表达数据治理用途；`offering_type=long_term_formal|short_term_topic` 独立表达长期正式课或短期专题课。历史班级只按默认值回填，不根据课次数量猜测。
- 活动域新增 `public_class`；体验课在 UI 中明确为单次体验课。活动仍只记录一个举行时间及一次报名/到场结果；固定名单连续 3–4 次或更多课使用短期专题班。
- `create_class` 与 `create_free_class_with_sessions` 的新参数均位于末尾并带 `long_term_formal` 默认值，因此 previous 应用继续兼容新 schema；authenticated 保持执行权限，anon 保持拒绝。

## 写前备份、迁移与 postflight

- preflight 锁定 Xiaomi、`https://supabase.mathin.club`、数据库指纹 `10e3f97e…1a0c`、current/previous、ledger 211、候选迁移缺失、未来两小时排课 0。最近领域事件只是上一轮部署的 `permission.insert`，唯一活跃数据库会话是 Realtime WAL sender。
- 当前 PostgreSQL-only 备份在外置挂载完成；备份前后匿名业务计数完全相同，dump、TOC、两份计数和 manifest 的 `sha256sum -c` 全部通过。迁移 rollback 后独立连接确认 ledger、字段、约束和函数签名完全恢复，再执行相同正式事务。
- 应用从提交 `c7c8219…` 在本机和 Xiaomi 各完成 lint/typecheck/production build，原子切换后 loopback、Caddy 和公网 health 均通过。匿名 `/zh/dashboard/classes/new` 与 `/en/dashboard/activities` 分别正确 307 到对应语言登录；数据库、Storage 和错误计数无漂移。

## 回退与尚未证明

- 应用问题优先切回 previous `20260828-071313`；它依赖的旧 RPC 调用因新参数有默认值而与当前 schema 兼容。数据库异常可使用本轮精确写前 dump 恢复；未发生异常，未执行 rollback/restore。
- 尚未由产品负责人在生产实际选择两种班级用途、创建短期专题班或公开课并核对列表/详情。机器 postflight 与匿名路由只证明发布、权限和数据合同，不替代登录后的产品验收。
