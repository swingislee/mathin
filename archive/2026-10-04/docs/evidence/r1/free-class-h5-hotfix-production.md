# HOTFIX-20260829 自由班排课与 H5 透明层生产证据

> **结论**：`DEPLOYED / PENDING_PRODUCTION_USER_ACCEPTANCE`。产品负责人已在开发版本通过自由班排课改动，并明确授权生产发布；2026-08-29 已把 Mathin `7601c868b34d5b44c7bae192a5dcf4ed4a1e2cbe` 发布到 Xiaomi。机器 postflight 通过，本轮没有 migration、数据库写入、Storage 写入或课程 release 重建；生产页面仍由产品负责人自行验收。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `HOTFIX-20260829-FREE-SCHEDULE-H5`；free-class scheduling / source H5 presentation；`DEPLOYED / PENDING_PRODUCTION_USER_ACCEPTANCE` |
| `measured_value`, `threshold` | Mathin 定向 Vitest 2 文件 6/6，来源工具定向 Vitest 3 文件 12/12；来源工具 TypeScript 及 Mathin 发布器的 ESLint、TypeScript、本地/远端 Next.js 16.2.11 production build 通过。生产 current/previous、服务、zh/en HTTP、匿名鉴权跳转、journal、ledger、业务与 Storage 不变量全部通过 |
| `commit_sha`, `migration_head`, `environment` | Mathin H5 修复=`557fc51`，自由班排课=`7601c86`，生产候选=`7601c868b34d5b44c7bae192a5dcf4ed4a1e2cbe`；来源/审阅工具=`26adab7bb009b25bb1e9404c01d695ef7858755e`；ledger=`219`、head=`20260829000100_classroom_personal_scope_default`；Xiaomi / production |
| `dataset_manifest` | `not_applicable`：两讲暑期 A+ 及其 source-runtime 内容在本轮修复前已存在于生产。本轮明确不重导、不重建课程 release、不改数据库或 Storage；来源工具是 localhost-only 私有 CLI，没有独立生产部署目标 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-28T18:54:32Z`；`2026-08-28T19:02:52Z`；Codex；产品负责人明确回复“通过，推送到生产”并提供两个独立提交 |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 只读 preflight → `publish-mathin-xiaomi.ps1 -Action Publish` → 无浏览器 HTTP、systemd、journal 与只读数据库 postflight。未运行课程构建/导入命令，未运行生产浏览器 |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260828-190055/release.json`；previous `/home/swing/services/mathin/releases/20260828-174731/release.json`；精确 Git commit 已登记，独立 artifact hash=`not_applicable`；immutable release 按既有策略保留；仓库维护者/Xiaomi 运维角色 |
| `failure_ticket` | `not_applicable`。首次本机构建在编译成功后被 Windows 沙箱以 `spawn EPERM` 拒绝，发生在上传/切换前；获准在沙箱外重跑后完整通过。服务刚启动时一次即时 curl 尚未连上，发布器健康重试随后通过，独立 postflight 为 `NRestarts=0`、journal error=`0` |

## 发布边界

- `557fc51` 只把 `DocStage` 的 H5 容器从白底改为透明；`7601c86` 让自由班复用课程班的每周几、日历自动排期、逐讲时间覆盖与冲突检查。两项都属于 Mathin 应用代码。
- `26adab7` 修复采集/审阅台的资源引用相对路径、CAS 校验和本地按 SHA 服务。该仓库的 `package.json` 只有私有 CLI、测试、类型检查和 localhost 审阅入口，没有部署/发布脚本或独立生产服务；因此本轮保留其独立提交，不把它转换为生产课程数据写入。
- 最近完整 PostgreSQL+Storage 备份仍为 `/mnt/openlist-disk/Backups/Mathin/mathin-20260828T052842Z-teacher-microcourse-variant-087b497/`，其 manifest 登记 `restore_executed=false`、`retention_prune_executed=false`。本轮只切换不可变应用 release，回退面为 previous，因此没有新建 48 GB 数据备份。

## 只读 preflight 与 postflight

- 写前 current/previous=`20260828-174731` / `34f07e8…` 与 `20260828-075322` / `c7c8219…`；部署锁、备份锁和并发发布/导入进程均为空，未来两小时课次为 0。
- 写前和写后数据库指纹均为 `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`，ledger/head 均为 `219` / `20260829000100_classroom_personal_scope_default`。
- auth/profile/course/lecture/release/class/session/enrollment/attendance/Storage object/Storage bytes 写前写后均为 `14/14/103/1330/2977/3/16/1/0/125725/51428257520`，证明发布未改业务数据或 Storage。
- postflight current/previous=`20260828-190055` / `7601c86…` 与 `20260828-174731` / `34f07e8…`；服务 `active/running`、`NRestarts=0`、`ExecMainStatus=0`。Caddy health、zh/en login 为 200；匿名 zh/en 新建班级均精确 307 到对应 locale login。
- 新 release 启动后 journal error=`0`；`operational_errors` 保持 `1950`，latest=`2026-08-28T17:46:02.824Z`，早于本轮 release 启动，没有发布后增量。

## 尚未证明

- 按产品负责人要求，本轮没有使用浏览器；机器 postflight 不证明自由班排课交互或 H5 透明呈现已在生产完成产品验收。
- 来源/审阅台的 `26adab7` 没有生产运行面；它只影响后续本地采集、审计与审阅，不改变当前 Mathin 课程数据。
