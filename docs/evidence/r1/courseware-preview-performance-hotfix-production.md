# HOTFIX-20260830 讲次课件预览翻页性能生产证据

> **结论**：`DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCTION USER ACCEPTANCE`。来源提交 `50a1648` 的页级读取、浏览器内缓存、相邻页预取、History API 查询参数同步与来源 runtime iframe 复用，已按生产当时运行基线 `76f0f9a` 移植为候选 `a165004` 并发布 Xiaomi。发布未执行 migration，数据库、课程 release、审核快照和 Storage 均未写入；生产页面翻页手感仍由产品负责人实际验收。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `HOTFIX-20260830-COURSEWARE-PREVIEW-PAGING`；lecture courseware read-only preview paging / source runtime reuse；`DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCTION USER ACCEPTANCE` |
| `measured_value`, `threshold` | 适配候选定向 Vitest 2 文件 10/10、messages key parity 5205×2、`git diff --check` 通过；发布器全库 ESLint、TypeScript、本地 production build、Xiaomi frozen install/production build、原子切换及健康门通过。机器结果只覆盖版本、构建、鉴权和数据不变量，不替代真实课程冷／热翻页时延与人工手感 |
| `commit_sha`, `migration_head`, `environment` | 来源提交=`50a164806b8fa67c39c01f2c60d0289f90d5f7f6`；生产适配候选=`a1650040ce0d3891e98e96b3e9bc14a7394b76e8`，基线=`76f0f9a6e46129e00050d90f3bb59293f5818f9b`；数据库保持 ledger=`236`、head=`20260830000700_teacher_microcourse_editor_unification`；Xiaomi / production，current=`20260830-080555`，previous=`20260830-045421` |
| `dataset_manifest` | pre/postflight 的 profiles/classrooms/sessions/microcourses/selected-session/teacher-members/research-members/Storage objects/Storage bytes=`14/4/19/3/3/6/4/125917/51524182412`；未来两小时课次=`0`；`operational_errors=1956`、latest=`2026-08-30T07:14:43.609Z`，发布后未增加；未修改账号、岗位、班级、课次、微课、课程 release、审核快照、数据库或 Storage 对象 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-30T07:58:39Z`；`2026-08-30T08:10:11Z`；Codex；产品负责人明确指令“将 `50a1648` 改动热推送到生产” |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 与 [`r1-production-deployment-preflight.md`](../../runbooks/r1-production-deployment-preflight.md)：只读核对真实 current/previous、目标 origin、数据库指纹、ledger、未来课次、部署/备份锁、现有备份、业务/Storage/错误基线 → 从生产 current 建立隔离 worktree 并移植目标补丁 → 推送可追溯候选分支 → `publish-mathin-xiaomi.ps1 -Action Publish` → HTTP/systemd/journal/bundle/数据库/Storage 独立 postflight |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260830-080555/release.json`；previous `/home/swing/services/mathin/releases/20260830-045421/release.json`；候选分支 `origin/codex/hotfix-courseware-preview-50a1648`。应用问题可原子回切 previous；数据库/Storage 继续复用 preflight 已核对的 PostgreSQL 写前备份 `mathin-db-prechange-20260830T042220Z-tmc-unification-8b9b195` 与全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497`；`artifact_hash=not_applicable`，未 restore/prune；仓库维护者/Xiaomi 运维角色 |
| `failure_ticket` | `none`。目标补丁直接 cherry-pick 到生产基线时只在 `SourceRuntimeStage.tsx` 及对应测试发生冲突，因为原提交父级 `65e3638` 已先增加 iframe load/ready 去重握手；候选保留这两个文件在 `50a1648` 的最终实现，排除 `65e3638` 的微课列表 UI、文案、测试和规划改动，`git range-diff` 已复核。沙箱内 pnpm/Vite 子进程曾以 `EPERM` 停止，获准在隔离候选目录重跑后通过，未上传生产。 |

## 变更与基线边界

- 讲次只读预览初始只物化当前页；翻页命中浏览器缓存时直接切换，未命中时请求受 zod 校验且继续经过 `authorizedClient("course.view")` 的页级 Server Action，并预取相邻页。
- 翻页只在已经取得页面状态后使用 `window.history.replaceState` 同步 `page` 查询参数；它不绕过鉴权、RLS 或首次页数据读取。
- 来源课件按 immutable runtime package/entry 复用同一个 iframe，以 courseware/page render key 投递新 payload；package 或 entry 改变时仍会重建 iframe。候选同时保留父级同文件的 load/ready 去重握手，避免复用后重复投递或错过首个 payload。
- 教师微课数据层把同一讲所有页面 binding 与 signed URL 改为批量读取，并并行读取唯一 H5 manifest；本轮不修改 RPC、表结构或 Storage 对象。
- 生产 preflight 已发现 current=`76f0f9a`、ledger/head=`236 / 20260830000700_teacher_microcourse_editor_unification`，均早于本次 hotfix；本次发布只从该已运行基线增加目标补丁，不负责追溯或重放此前 schema/app 发布。

## 发布与独立 postflight

- release `20260830-080555` / `a165004…` 启动后为 `active/running`、`Result=success`、`NRestarts=0`、`ExecMainStatus=0`；loopback/Caddy health 与 zh/en login 均为 200，匿名 zh/en 课程族、讲次预览和 Studio 路由均按 locale 精确 307 到登录页。
- 生产 server bundle 包含 `loadLecturePreviewPage` 与新增失败文案；`runtimeInstanceKey` 局部变量名被 production minifier 消除，因此不把变量名 grep 当作 release 失败。Git archive commit、远端 build 和 release metadata 共同绑定 `a165004…`。
- systemd 在受控 restart 停止旧 Node 进程时记录一次 `status=143` / `Failed with result 'exit-code'`；随后同一秒启动的新 invocation 正常，`Result=success`。从新实例 Ready 时间起 journal 的 error/exception/fatal/unhandled/failed 匹配为 0。
- 数据库指纹、ledger/head、岗位、业务计数、Storage 与 `operational_errors` 和 preflight 完全一致。发布脚本没有 migration、数据库或 Storage 写入口。

## 待产品验收与剩余性能池

产品负责人需在生产真实多页课程中分别检查冷打开、连续下一页／上一页、快速跨页、16:9/4:3 轨道切换和返回原页；确认内容、页码、URL 与互动状态不串页，并比较首个未命中页与缓存命中页的等待手感。完成前只记为“已部署待人工验收”。

本 hotfix 处理讲次课件预览及共享来源 runtime，不关闭 `POST-LIVE-PERF-01` 的教师微课课程族切换样本。后者仍经过 quick-preview Route Handler 的 Auth/RPC 往返，须按 doc 15 §6.5 单独采样。
