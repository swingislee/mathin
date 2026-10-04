# HOTFIX-20260831 课件来源运行时、预览加载与统一编辑工作台集中生产发布

> **结论**：`DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCTION USER ACCEPTANCE`。本 session 已在开发端验收的爱学习/Mofaxiao 来源运行时、页面加载、X+ 动画体积门和统一课件编辑工作台，以生产 current `6e0b5bd…` 为基线生成隔离候选 `05a1027…` 并原子发布。未执行 migration、课程导入、4:3 派生、数据库或 Storage 写入。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `HOTFIX-20260831-COURSEWARE-SESSION-FIXES`；source runtime / lecture preview / shared editor workbench；`DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCTION USER ACCEPTANCE` |
| `measured_value`, `threshold` | 定向 Vitest 10 文件 `72 passed / 1 conditional skip`，规划审计和 `git diff --check` 通过；标准发布器的全库 ESLint、TypeScript、本地与 Xiaomi production build、320 页静态生成、原子切换通过。postflight 为 service `active/running`、`Result=success`、`NRestarts=0`、`ExecMainStatus=0`、当前 invocation journal error=`0`，loopback/Caddy health 与 zh/en login 通过；新页级 GET bundle 存在，完整参数的匿名请求为 `401` 且 `Cache-Control=private, no-store` |
| `commit_sha`, `migration_head`, `environment` | 隔离候选=`05a1027054a80526716fcd2b993b7a1219142734`，基线=`6e0b5bda61a0de688915088fa1bdf54a32e90910`；数据库保持 ledger/head=`236 / 20260830000700_teacher_microcourse_editor_unification`；Xiaomi / production；current=`20260831-052938`，previous=`20260830-084610` |
| `dataset_manifest` | pre/postflight 的 profiles/classrooms/sessions/microcourses/selected-session/teacher/research/Storage objects/Storage bytes=`14/4/19/3/3/6/4/125917/51524182412`；未来两小时课次=`0`；`operational_errors=1956`、latest=`2026-08-30T07:14:43.609Z`，发布后无增量；未修改账号、岗位、班课、微课、课程 release、审核快照、数据库或 Storage 对象 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-31T05:17:00Z`；`2026-08-31T05:33:01Z`；Codex；产品负责人明确指令“修复完成，查找本session里所有未推送到生产的修复，集中推送到生产” |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 与 [`r1-production-deployment-preflight.md`](../../runbooks/r1-production-deployment-preflight.md)：真实 current/previous、目标 origin、稳定数据库指纹、ledger、锁、备份与匿名数据基线只读 preflight → 从 current 建立隔离 worktree → 移植尚未上线的 session 提交 → 推送候选分支 → `publish-mathin-xiaomi.ps1 -Action Publish` → systemd/HTTP/bundle/鉴权/数据库/Storage 独立 postflight |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260831-052938/release.json`；previous `/home/swing/services/mathin/releases/20260830-084610/release.json`；候选分支 `origin/codex/session-production-20260831`。应用问题可原子回切 previous；数据库/Storage 复用已核对的 PostgreSQL 写前备份 `mathin-db-prechange-20260830T042220Z-tmc-unification-8b9b195` 与 PostgreSQL+Storage 全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497`；`artifact_hash=not_applicable`，未 restore/prune；仓库维护者/Xiaomi 运维角色 |
| `failure_ticket` | `none`。隔离 worktree 首次并行启动两个 pnpm 命令造成依赖软链接竞争，随后串行安装并通过；沙箱曾拒绝依赖/Vite 子进程，获准后在同一候选重跑通过。新 release 启动瞬间首个 loopback curl 早于监听而失败，发布器随后重试成功；独立 postflight 无重启、无错误日志。这些均未造成生产数据或服务故障。 |

## 发布范围

- 爱学习来源运行时保留已挂载页面，按来源拥有的 player 版本与页面声明绑定解析，统一修复 `digest` 未定义和“源 player 图片模块导出与账本不一致”；4:3 来源页继续走同一运行时合同。
- Mofaxiao 与共享讲次预览改为按当前页和相邻页预热，关闭预热竞争与选中页错位；页级读取从 Server Action 改为鉴权 GET，浏览器并行取数并复用已准备资源，降低全页翻页闪烁和持续 loading。
- X+ 纯动画只在生成视频确实小于原包时采用视频，避免体积反增；导入器复用已验证对象，但本次生产发布没有重跑导入。
- 正式课件与教师微课共用 `CoursewareEditorWorkbench` 和顶栏工具原语，保留 PageDoc/source-runtime/composition 各自 adapter、权限与写态，不在 Mathin 另造来源元素适配器。

## 待产品验收

机器 postflight 只证明版本、构建、鉴权、健康和数据不变量。产品负责人仍需在生产登录态复验爱学习一年级/二年级、Mofaxiao E 系列的首页、16:9/4:3、连续翻页、此前 digest/账本错误页，以及正式课件/教师微课共用编辑工作面；确认前保持 `PENDING PRODUCTION USER ACCEPTANCE`。

## 2026-08-31 扩大范围根修与生产数据升级

> **结论**：`DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCTION USER ACCEPTANCE`。产品负责人确认“直接扩大范围，修复并推送生产”后，应用候选 `dbff5c9…` 原子发布，随后只对爱学习秋季 G+/X+/A+ 三包执行 source-runtime 版本化升级；暑期 `AXX26A-QG-01-SUM` 与 Mofaxiao 数据均不在写入 manifest 中。

- 应用 current/previous=`20260831-073147` / `dbff5c9…` 与 `20260831-052938` / `05a1027…`；标准发布器的 ESLint、TypeScript、本地/远端 production build 与 320 页静态生成通过，service、loopback/Caddy health 正常，当前 invocation journal error=`0`。
- 三包 dry-run 与 formal 均覆盖 G+ `56/1641/11132`、X+ `84/2767/19729`、A+ `30/1034/15591`（讲/页/binding）；formal 汇总 `sourceRuntimeUpgraded=5442`、`databaseConflicts=0`、未解释 `baselineDrift=0`。
- postflight 的三包 manifest SHA 与 staged artifact 一致，runtime package 分别为 G+ `553901d9…`、X+ `4f3cce74…`、A+ `9105ec7c…`，全部 5442 页为 projection 32；双轨 current page head 各 5442 且 revision 错位为 0，双轨 release binding 合计 92904，历史 release 1 各保留 170 条。
- X+ 一年级第 1 讲首页 current revision 使用 `aix-lottie-video` 与 `cbb04208…` / `1,983,848` bytes MP4；旧 `2d6907b6…` / `54,512,144` bytes 来源 JSON 只作为不可变来源证据保留，current Viewer 节点和 image-only 预热均不请求它。第 30 页 current release 的 Viewer package 已是 `4f3cce74…`。
- Storage 从 `125917 / 51524182412` 增至 `126177 / 51619654863`（对象/bytes），即 `+260 / +95472451`；主要增量为三包新 Viewer 文件和一个压缩首页视频，没有覆盖或删除旧对象。
- 按产品负责人意见取消了无必要的第二份 50 GB Storage 全量备份；刚启动的 `.partial` 已停止并清理。由于本次对象、revision、release 均为追加写，只保存 340 条双轨 current-head 前后清单与三包 package manifest，路径 `/mnt/openlist-disk/Backups/Mathin/mathin-courseware-heads-20260831T081748Z-dbff5c9/`，目录内 `SHA256SUMS` 复验通过；回退不删除新增对象。
