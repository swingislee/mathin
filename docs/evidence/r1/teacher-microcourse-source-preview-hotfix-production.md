# HOTFIX-20260829 教师微课来源预览生产证据

> **结论**：`DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCTION USER ACCEPTANCE`。导入后的来源页不再把钉死的 H5 package 当作普通 `cw-objects` 资源签名；从通用讲次审核入口进入待审教师微课时，会转到该次提交的不可变微课审核快照。生产中既有 32 页待审作品和 283 个资源绑定保持原样，不需要重新导入或重新提交。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `HOTFIX-20260829-TMC-SOURCE-PREVIEW`；teacher microcourse imported source runtime / review snapshot routing；`DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCTION USER ACCEPTANCE` |
| `measured_value`, `threshold` | 定向 Vitest 3 文件 17/17、TypeScript、受影响 ESLint、`git diff --check`、固定开发账号 Playwright 2/2 通过；发布器全库 ESLint、TypeScript、本地 production build、Xiaomi production build、原子切换及健康门通过 |
| `commit_sha`, `migration_head`, `environment` | `6185352dca5148bc030aeca5c89e7e94412546cd`；数据库无迁移，保持 `20260829000200_admin_self_staff_roles` / ledger=`220`；Xiaomi / production，current=`20260829-045135`，previous=`20260829-033955` |
| `dataset_manifest` | 最新提交保持 `submitted`，页面/来源运行时页=`32/32`，快照资源绑定/必需绑定=`283/283`，引用的 H5 package entry 存在；pre/postflight 的 profiles/classes/sessions/microcourses/selected-session/Storage=`14/4/19/3/3/125725`，Storage bytes=`51428257520`，staff role members teacher/research=`6/4`，`operational_errors=1951` 且 latest=`2026-08-29T04:35:40.531Z`；未修改账号、岗位、班级、课次、微课、审核快照、release、数据库或 Storage 对象 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-29T04:34:48Z`；`2026-08-29T04:59:10Z`；Codex；产品负责人明确要求生产热修复 |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 与 [`r1-production-deployment-preflight.md`](../../runbooks/r1-production-deployment-preflight.md)：只读核对目标、current/previous、ledger、feature flag、待审快照、对象绑定、未来两小时课次、锁、备份和错误基线 → 推送干净提交并运行 `publish-mathin-xiaomi.ps1 -Action Publish` → HTTP/systemd/journal/数据库/业务/Storage 独立 postflight |
| `artifact_url_or_path`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260829-045135/release.json`；previous `/home/swing/services/mathin/releases/20260829-033955/release.json`；应用问题可原子回切 previous。数据库/Storage 未写，继续复用最近 PostgreSQL 写前备份 `mathin-db-prechange-20260828T195236Z-admin-self-role-ba98a8e` 与全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497`；未 restore/prune；仓库维护者/Xiaomi 运维角色 |

## 根因与修复边界

- 微课页面保存的是不可变来源 revision 及绑定 revision。生产数据中 `cw_page_asset_bindings.kind` 可为空，而钉死的 `cw_asset_objects.kind` 为 `h5`；绑定 key 也不是 package SHA-256。旧解析器只在 `storagePath` 为空时读取对象记录，因此跳过了权威 kind/hash，把 package 当作普通 `cw-objects` 路径签名，iframe 一直停留在“正在加载源课件…”。
- 新解析器对 kind 为空、kind 为 H5 或缺路径的绑定统一读取钉死对象，以对象 kind 和 SHA-256 为权威描述；H5 继续走不可变 `cw-h5/packages/<sha256>/` 入口，普通图片路径不变。
- 通用讲次审核页只预览当前已发布 release，而待审教师微课首次发布前没有 current release。讲次工作区现在只对有审核权且属于教师微课的 active review cycle 跳转到 `/dashboard/courseware/review/microcourses/<cycleId>`，该路由读取提交时冻结的页面、资源、H5 和元数据快照；普通课程审核路径不变。
- 修复没有改变 RLS、审核状态、发布事务、来源快照或 Storage 内容，也没有为普通教师扩大课程管理权限。

## 验证与生产 postflight

- 新增单元合同覆盖“空 kind 的来源运行时绑定必须以钉死 H5 对象 digest/kind 解析”和“普通图片保持原路径”；UI 合同覆盖通用讲次入口转入不可变微课审核页。
- 本机固定账号 Playwright 复用隔离开发账号，完成普通教师制作—试讲—提交—教研审核—发布—目录闭环，以及教师/教研并行方案旅程，2/2 通过。
- release `20260829-045135` / `6185352d…` 启动后服务 active/running，`NRestarts=0`、`ExecMainStatus=0`；loopback/public health 正常，zh/en login=200，匿名审核路由=307，release 后 journal error=0；最新来源 package entry 由生产应用返回 200。
- ledger/head、feature flag、岗位、业务计数、最新待审快照、Storage 与 `operational_errors` 均与 preflight 一致。Chrome 登录态自动读取在重页面导航时超时，未把该结果冒充为页面通过；产品负责人刷新编辑页与审核页确认来源内容可见后，本项才改为用户已验收。
