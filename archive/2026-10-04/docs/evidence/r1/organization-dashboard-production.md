# DEV-ORG-1 / DEV-DASH-1 / DEV-DASH-2 生产发布证据

> **结论**：`DEPLOYED / PENDING USER ACCEPTANCE`。2026-08-29 在产品负责人明确指令“推送到生产”后，完成生产只读 preflight、新鲜 PostgreSQL 写前备份、7 个 migration 的完整回滚/零残留演练、正式迁移、应用原子发布和独立机器 postflight。登录态 Chrome 的自动刷新连续超时，因此没有把生产页面人工验收记为通过。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `DEV-ORG-1 / DEV-DASH-1 / DEV-DASH-2`；机构/场地/教学设置、后台职能导航、列表性能与表格/分隔语义；`DEPLOYED / PENDING USER ACCEPTANCE` |
| `measured_value`, `threshold` | ledger=`212→219`，head=`20260829000100_classroom_personal_scope_default`；7/7 migration checksum 与 Git 归一化文本 hash 一致；1 个旧文本教室 `3305` 在唯一活跃校区内生成同名结构化教室，1 个班级默认教室和 15 个课次地点完成回填；服务 active/running、`NRestarts=0`、`ExecMainStatus=0`，loopback/Caddy health 与 zh/en login 均通过，新 release 启动后 operational error 增量=`0` |
| `commit_sha`, `migration_head`, `environment` | `34f07e83fa7d8d724a93052c30013f402b7e6b4c`；`20260829000100_classroom_personal_scope_default`；Xiaomi / production，current=`20260828-174731` / `34f07e8…`，previous=`20260828-075322` / `c7c8219…` |
| `dataset_manifest` | auth/profile/student/guardian/course/lecture/release/class/session/enrollment/attendance/activity/activity-registration/Storage=`14/14/5/2/103/1330/2977/3/16/1/0/3/0/125725`；管理员 verified MFA=`1`。正式迁移新增 1 个结构化教室并回填 1 个班级、15 个课次的结构化地点；未创建账号、学生、班级、课次、报名、点名或 Storage 对象。operational error `1949→1950` 的唯一增量发生在应用切换前，是旧 release 的 H5 图片代理 `fetch failed`；新 release 启动后增量为 0 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-28T17:28:37Z`；`2026-08-28T17:57:43Z`；Codex；产品负责人明确指令“推送到生产”，生产登录态页面人工验收仍 `pending` |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 目标/范围/备份 preflight → PostgreSQL custom dump → `SERIALIZABLE` migration rollback/零残留/formal → `publish-mathin-xiaomi.ps1 -Action Publish` → release、HTTP、route manifest、PostgREST、数据库 ACL、MFA 和业务不变量 postflight；未运行生产写态 Playwright、未创建账号或夹具 |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260828-174731/release.json`；previous `/home/swing/services/mathin/releases/20260828-075322/release.json`；数据库备份 `/mnt/openlist-disk/Backups/Mathin/mathin-db-prechange-20260828T173725Z-dev-org-34f07e8/`，dump bytes=`270780600`、SHA-256=`0c6ddb85c88246ad6116b288df9d86829ad5890d40ed733067c864d873c7abb2`、TOC=`4062`，`SHA256SUMS` SHA-256=`06727e584be50ea6d67fad114b806be1e7d839859e0be716555cf2358d847384`；Storage 回退继续引用同日已验证全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497`；本轮未 prune/restore；仓库维护者/Xiaomi 运维角色 |
| `failure_ticket` | `not_applicable`。首次回滚演练以非 owner `postgres` 执行，在第一处 DDL 被生产 owner 边界拒绝且事务自动回滚；独立连接确认 ledger/列/函数/权限/教室零残留后，按真实 migration owner `supabase_admin` 完成完整回滚演练与正式事务。登录态 Chrome 只读刷新两次超时，没有页面点击或写入，因此人工 UI 验收保持 pending |

## 生产 preflight 与迁移

- 目标由执行主机 Xiaomi、`https://supabase.mathin.club`、数据库指纹 `10e3f97e…1a0c`、current/previous 和 ledger 共同锁定。本机 `.env.local` 仍指向 loopback 开发 origin；本轮所有生产写入均显式通过 `ssh xiaomi`。
- 候选迁移前，活跃校区级规则/Feature Flag 覆盖=`0/0`，重复学年=`0`，未来两小时课次=`0`。唯一旧教室文本为 `3305`，候选匹配数为 0；生产只有 1 个活跃校区，满足已批准的单校区自动创建规则。
- 写前备份的数据库前后计数完全一致，dump、TOC、两份计数、manifest 和 `SHA256SUMS` 均独立校验通过。本批次不写 Storage，复用同日 PostgreSQL+Storage 全量备份作为 Storage 回退点。
- 7 个 migration 先在同一 `SERIALIZABLE` 事务中执行并回滚；独立连接确认 ledger 仍为 212、V2 列/函数/权限与结构化教室均无残留。正式事务使用完全相同的 Git archive 文件、checksum 和断言，提交后独立连接复核 ledger 219、旧/新 RPC 共存、代码字段列权限关闭、管理员 MFA 和业务计数。

## 应用与 postflight

- 本地和 Xiaomi 均完成 ESLint、TypeScript 和 Next.js 16.2.11 production build；发布器创建 immutable release 并把 current 原子切换到 `20260828-174731`。previous 保留 `c7c8219…`，其旧字段/RPC 调用继续与当前兼容 schema 共存。
- 服务最终为 active/running，`NRestarts=0`、`ExecMainStatus=0`；发布器切换瞬间有一次毫秒级 loopback 连接拒绝，随后在健康等待窗口内通过，未触发自动回退。systemd 唯一 warning 是停止旧进程时的预期 SIGTERM 143，journal error=`0`。
- `/api/health`、Caddy、zh/en login 通过；匿名新校区/学年路由按语言精确 307 到 login。production route manifest 包含机构资料、校区、学年和能力发布，旧 `/dashboard/organization-settings` route 不存在。PostgREST OpenAPI=`200`，匿名直接读场地表按 ACL 返回 `401/42501`。
- 登录态 Chrome 中原有 Dashboard 仍持有发布前客户端状态；刷新和新标签页导航均因浏览器控制通道超时而中止。该结果不代表页面失败，也不能证明页面通过；产品负责人仍需在生产手动刷新后验收职能侧栏、校区/教室、学年日历、班级表格和表格/分隔语义。

## 回退边界

- 应用问题优先切回 previous `20260828-075322` / `c7c8219…`；当前 schema 保留旧 `classrooms.room`、默认校区/学年校区兼容列、旧设置与建班 RPC，并继续双写一个回退窗口。
- 数据库默认 forward-fix；只有确认数据破坏并由事故负责人选择恢复点后，才使用本轮精确写前 dump 进入独立恢复流程。本轮没有执行应用 rollback、数据库 restore、备份 prune 或旧合同删除。
- 兼容字段、旧 RPC 与旧数据语义的退休继续需要产品负责人完成生产页面验收、previous 退休验收和单独生产授权。
