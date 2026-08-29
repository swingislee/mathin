# 自研课堂互动状态同步热修 · 生产发布证据

> **结果**：`PRODUCTION APP DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING REAL IPAD CLASSROOM ACCEPTANCE`
>
> **日期**：2026-08-29
>
> **范围**：仅应用 release；没有 migration、数据库写入、Storage 写入或测试造数

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain` | `HOTFIX-20260829-CLASSROOM-INTERACTION-SYNC`；`classroom-interaction-state` |
| `commit_sha`, `environment` | `59cc3424d6a9e624f0a44bb3695939cbe0ee39b6`；Xiaomi / production |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-29T03:31:00Z`；`2026-08-29T03:42:10Z`；Codex；产品负责人明确要求“部署生产” |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 与 [`r1-production-deployment-preflight.md`](../../runbooks/r1-production-deployment-preflight.md)：只读目标/锁/备份/课次/数据基线 → `publish-mathin-xiaomi.ps1 -Action Publish` → HTTP/systemd/journal/bundle/数据库 postflight |
| `artifact_url_or_path`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260829-033955/release.json`；previous `/home/swing/services/mathin/releases/20260829-031327/release.json`；应用问题可原子回切 previous；仓库维护者/Xiaomi 运维角色 |

## 生产 preflight

- 执行主机为 Xiaomi，运行时 origin 为 `https://mathin.club` / `https://supabase.mathin.club`；数据库指纹为 `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`。
- 写前 current/previous 为 `20260829-031327` / `bf81aa4ef5c20376a2700517f3932e881a1e6436` 与 `20260828-195733`；用户级 `mathin.service`、loopback health 正常，部署锁和备份锁均可取得，未来两小时课次为 0。
- 最近全量数据库与 Storage 备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497`、最近 PostgreSQL 写前备份 `mathin-db-prechange-20260828T195236Z-admin-self-role-ba98a8e` 均存在。本批次不写数据库或 Storage，不重复生成约 48 GiB 全量备份。
- 数据基线：ledger/head=`220` / `20260829000200_admin_self_staff_roles`；profiles/classes/sessions/microcourses/selected-session=`14/4/19/0/0`；teacher/research 岗位成员=`6/4`；课堂事件总数/`game_state`=`91/70`；Storage objects/bytes=`125725/51428257520`；`operational_errors=1950`，latest=`2026-08-28T17:46:02.824Z`。

## 发布与机器 postflight

- 提交 `5783b930…` 补齐 `game-page-v1` 数独镜像链、100ms 合并广播与 32 KiB payload 上限；提交 `59cc342…` 登记本机验证证据。两笔提交已推送 `origin/main`。
- 发布器首次在受限 Windows 执行环境完成编译后因 `spawn EPERM` 停止，尚未上传或切换生产。使用相同候选在受限环境外重跑后，本机 lint/typecheck/build 与 Xiaomi frozen install/production build 全部通过，随后完成原子切换。
- postflight current=`20260829-033955` / `59cc3424d6a9e624f0a44bb3695939cbe0ee39b6`，previous=`20260829-031327` / `bf81aa4ef5c20376a2700517f3932e881a1e6436`。服务 `active/running`、`NRestarts=0`、`ExecMainStatus=0`；loopback/Caddy health 正常，zh/en login=200，匿名课堂 live 路由精确 307 到同 locale login，发布窗口 journal error=0。
- 生产 server bundle 同时包含 `game-mirror-v1` 与 `classroom-interaction-sync` 合同。数据库指纹、ledger/head、业务计数、岗位、课堂事件、Storage、错误基线和未来课次与 preflight 完全一致，证明应用发布未改 schema 或业务事实。

## 待真实课堂验收

机器 postflight 证明正确 release 已运行及同步合同进入生产 bundle，不替代真实设备验收。产品负责人仍需在同一正式课次中使用教师 iPad 控制页和至少一台展示/学生设备检查：填入一个数字与“突出一行”均在其他设备实时出现；展示端刷新或晚加入后从 `game_state` replay 收敛到相同棋盘。该检查完成前结果保持 `pending real iPad classroom acceptance`。

结构化字段：`result=production_app_deployed_machine_postflight_pass`，`dataset_manifest=production-read-only-pre-postflight`，`artifact_hash=not_applicable`，`failure_ticket=none`。
