# HOTFIX-20260829 管理员自授员工岗位生产证据

> **结论**：`DEPLOYED / PENDING PRODUCTION USER ACCEPTANCE`。产品负责人明确要求部署生产后，2026-08-29 已把顶层管理员自授/撤销员工岗位能力发布到 Xiaomi。数据库 migration、应用 release 与独立机器 postflight 均通过；本轮没有替管理员实际新增岗位，产品负责人仍须在生产员工页完成真实自授岗验收。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `HOTFIX-20260829-ADMIN-SELF-ROLE`；staff role administration / teacher microcourse access；`DEPLOYED / PENDING PRODUCTION USER ACCEPTANCE` |
| `measured_value`, `threshold` | ledger=`219→220`，head=`20260829000200_admin_self_staff_roles`；grant/revoke 两个 SECURITY DEFINER RPC 均只允许顶层 admin 穿过 self-target guard，普通 staff 仍被拒绝；authenticated execute=`true`、anon execute=`false`。本地定向合同 2/2、此前受影响 R1-Live 63/63、事务 SQL 正负断言与固定管理员 zh/en Playwright 1/1 通过；发布器本地 lint/typecheck/build、Xiaomi production build、HTTP/systemd/journal/数据库/备份 postflight 通过 |
| `commit_sha`, `migration_head`, `environment` | 功能提交=`dc8b5b0017a4a6fe9d7380af2691bfce90de9b74`，ACL 修正及最终候选=`ba98a8e3126fa9a8f27c35c4a25106a7f527774a`；`20260829000200_admin_self_staff_roles`；Xiaomi / production |
| `dataset_manifest` | auth/profile/student/course/lecture/release/class/session/enrollment/attendance/staff-role/admin-role/Storage=`14/14/5/103/1330/2977/4/19/1/0/11/0/125725`，Storage bytes=`51428257520`。production 长期正式班=`1/15 课次/1 active 报名`，短期专题班=`1/3/0`；test 长期班=`2/1/0`。正式 admin=`1`、verified MFA=`1`；本轮未创建或修改账号、岗位成员、班级、课次、报名、点名、课程 release 或 Storage 对象 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-28T19:45:45Z`；`2026-08-28T20:01:12Z`；Codex；产品负责人明确指令“部署生产环境” |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 只读 preflight → PostgreSQL-only 写前备份 → `SERIALIZABLE` migration rollback/独立零残留/formal → `publish-mathin-xiaomi.ps1 -Action Publish` → 无登录 HTTP、systemd/journal、数据库、业务、Storage 与备份 postflight。未运行生产写态 Playwright、未创建账号或夹具、未替管理员写入岗位 |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260828-195733/release.json`；previous `/home/swing/services/mathin/releases/20260828-190055/release.json`；最终数据库备份 `/mnt/openlist-disk/Backups/Mathin/mathin-db-prechange-20260828T195236Z-admin-self-role-ba98a8e/`，dump bytes=`270920038`、TOC=`4211`、dump SHA-256=`c7f27caabec6b67e6aad3b1a97cda0597a9c5ba88e44fef7511586b84d637670`、`SHA256SUMS` SHA-256=`cafcc41762e310fe85832ea03e8ff4734fc601f96051fb54c636c79dd02e4093`；migration LF SHA-256=`55983f6f57d3509d5cca705f3558edec3ca82eb3e048691afc8af22b46fe16b1`；Storage 回退复用已验证全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497`；未 restore/prune，按既有策略保留；仓库维护者/Xiaomi 运维角色 |
| `failure_ticket` | 首个候选 `dc8b5b0` 的 rollback rehearsal 在 ACL 断言处 fail closed：现网函数对 `anon` 有显式旧授权，而候选只撤销 `PUBLIC`。事务自动回滚，独立连接确认 ledger=`219`、旧函数/ACL、岗位成员和班课均零残留。首份恢复点 `mathin-db-prechange-20260828T194545Z-admin-self-role-dc8b5b0` 保留；提交 `ba98a8e` 按仓库标准撤销 `PUBLIC, anon, authenticated` 后再授予 authenticated，并以最终候选重新备份、回滚演练与 formal，全部通过；没有生产故障或数据恢复 |

## 行为与授权边界

- 顶层 `profiles.role='admin'` 的真实管理员可以在员工页管理自己的 `staff_role_members`，用于同时承担 `teacher`、`research` 等工作岗位；管理员自己的停用动作仍不显示。
- 非管理员 staff 即使持有 `staff.manage`，仍不能给自己授岗或撤岗；包含 `permission.configure` 的岗位仍只允许顶层 admin 操作。
- 发布后的管理员岗位成员汇总仍为 0。本轮只交付能力，不代替产品负责人选择岗位，也不把管理员身份自动转换为任意员工岗位。

## 生产 preflight、migration 与 postflight

- 写前锁定 Xiaomi、`https://supabase.mathin.club`、数据库指纹 `10e3f97e…1a0c`、current/previous、ledger=`219`、未来两小时课次=`0`、部署/备份锁=`0/0`；`operational_errors=1950`，latest=`2026-08-28T17:46:02.824Z`。
- 最终 migration 使用 Git 归档 LF 原文和规范化 checksum。完整 rollback rehearsal 后独立连接确认 candidate row=`0`、旧 guard/ACL 恢复、岗位/班级/课次=`11/4/19`；formal 后独立连接确认 ledger=`220`、新 guard 生效、anon execute=false，全部业务与 Storage 汇总不变。
- 应用 release `20260828-195733` 从干净候选 `ba98a8e…` 完成本地与 Xiaomi 双 production build 后原子切换；previous=`20260828-190055` / `7601c86…`。服务 active/running、`NRestarts=0`、`ExecMainStatus=0`，loopback/Caddy/public health 与 zh/en login 为 200，匿名 zh/en 员工页均精确 307 到对应 login，journal error=`0`。
- 新 release 后 `operational_errors` 仍为 `1950`，latest 未变化；最终备份五项 `sha256sum -c` 再次全为 `OK`。两个可由 Git 重建的 migration staging 目录已精确删除；两份 PostgreSQL-only 备份均保留，未 prune。

## 回退与待验收

- 应用问题可切回 previous `20260828-190055`；新 schema 保持旧应用兼容。数据库默认 forward-fix，本轮没有业务数据变化，不需要 restore。
- 机器 postflight 不证明产品账号已完成真实自授岗。产品负责人应在生产 `/zh/dashboard/staff` 找到自己，授予所需教师/教研岗位，再确认能进入其他老师短期专题班的课件制作流程；完成前状态保持 `PENDING PRODUCTION USER ACCEPTANCE`。
- 本次关于最终候选备份、schema 漂移查询、函数 ACL、rollback/formal、Windows 定向测试和多层 Shell 的可复用教训已固化到 [`r1-production-deployment-preflight.md` §7](../../runbooks/r1-production-deployment-preflight.md#7-函数rpc-热修执行补充)。
