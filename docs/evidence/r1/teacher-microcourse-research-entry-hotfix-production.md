# HOTFIX-20260829 教研课次页课件入口生产证据

> **结论**：`DEPLOYED / PENDING PRODUCTION USER ACCEPTANCE`。DEV-TMC-2 的数据库、权限和独立教研课件队列原已部署；本轮修复普通课次页仍用 `canPrepare` 隐藏“编辑课件”入口的问题。教研现在可以从其他老师的自由课次直接进入方案工作区，备课定稿、试讲、点名、课堂控制和“本节使用”仍只属于任课教师。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `HOTFIX-20260829-TMC-RESEARCH-ENTRY`；teacher microcourse session entry / teacher-research separation；`DEPLOYED / PENDING PRODUCTION USER ACCEPTANCE` |
| `measured_value`, `threshold` | 定向 Vitest 2 文件 9/9、TypeScript、双语消息 4831 keys × 2、受影响 ESLint、固定开发账号 Playwright 1/1 通过；发布器全库 ESLint、TypeScript、本地 production build、Xiaomi production build、原子切换及健康门通过 |
| `commit_sha`, `migration_head`, `environment` | `bf81aa4ef5c20376a2700517f3932e881a1e6436`；数据库无迁移，保持 `20260829000200_admin_self_staff_roles` / ledger=`220`；Xiaomi / production，current=`20260829-031327`，previous=`20260828-195733` |
| `dataset_manifest` | 生产 pre/postflight 均为 profiles/classes/sessions/microcourses/selected-session=`14/4/19/0/0`，staff role members teacher/research=`6/4`，Storage objects=`125725`，`operational_errors=1950`、latest=`2026-08-28T17:46:02.824Z`；未创建或修改账号、岗位、班级、课次、微课、选用、release、数据库或 Storage 对象 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-29T03:06:00Z`；`2026-08-29T03:17:00Z`；Codex；产品负责人要求若生产未生效则直接推送，问题核对后以同一目标的入口热修完成发布 |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 与 [`r1-production-deployment-preflight.md`](../../runbooks/r1-production-deployment-preflight.md)：只读核对 current/previous、ledger、feature flag、岗位权限、未来两小时课次、锁、备份和错误基线 → 从排除其他未提交改动的干净 `bf81aa4` worktree 运行 `publish-mathin-xiaomi.ps1 -Action Publish` → HTTP/systemd/journal/数据库/业务/Storage postflight |
| `artifact_url_or_path`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260829-031327/release.json`；previous `/home/swing/services/mathin/releases/20260828-195733/release.json`；应用问题可原子回切 previous。数据库/Storage 未写，继续复用最近 PostgreSQL 写前备份 `mathin-db-prechange-20260828T195236Z-admin-self-role-ba98a8e` 与全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497`；未 restore/prune；仓库维护者/Xiaomi 运维角色 |

## 根因与修复边界

- 生产 current `ba98a8e…` 已包含 `5361cf6` 和两条 DEV-TMC-2 migration；生产只读核对也确认 feature flag=true、research 拥有 `courseware.review` 与 `courseware.microcourse.author`。重复发布旧包不会解决问题。
- `SessionWorkspaceBody` 的入口同时要求 `detail.capabilities.canPrepare`，而该能力刻意只授予本课任课教师。数据库允许教研创建/派生方案，但课次页把按钮隐藏，截图因此只显示“当前账号不是本课任课教师”。
- `bf81aa4` 把入口条件改为：任课教师继续凭 `canPrepare + microcourse author` 进入；教研凭 `courseware.review + microcourse author` 进入。教研页面明确显示“备课档案只读，可编辑课件方案”，并隐藏试讲和完成备课；方案页及数据库继续隐藏“本节使用”、花名册、点名和课堂控制。
- 本地固定账号 Playwright 从教师建立初稿开始，随后让教研直接打开该课次页，验证入口可见、教学控制不可见、修改他人方案派生独立 head，最后由教师派生、选用并冻结。夹具按精确 ID 清理。

## 生产 postflight 与待验收

- release `20260829-031327` / `bf81aa4…` 启动后服务为 active/running，`NRestarts=0`、`ExecMainStatus=0`；loopback/public health 正常，zh/en login=200，匿名课次=307，journal error=0。
- 数据库 ledger/head、feature flag、岗位汇总、业务计数、Storage 和 `operational_errors` 与 preflight 一致；未来两小时课次为 0，发布未碰 schema 或业务事实。
- 已复用现有 Chrome 登录环境打开同一生产课次；扩展读取该重页面 DOM 连续超时，因此没有把登录态页面自动化冒充为通过。产品负责人刷新截图中的课次页，确认“编辑课件”可见并进入方案页后，本项才能从 pending 改为用户已验收。
