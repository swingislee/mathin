# DEV-WEB-PUSH-1 · PUSH-P5 生产暗部署证据

> **当前结论（2026-09-04）**：`PUSH-P5 COMPLETE / PRODUCTION DARK DEPLOYMENT VERIFIED / EMPLOYEE TEST NOT AUTHORIZED`。候选 `bea3d1113fc24ed97672a63866a801135972329b` 已发布为 Xiaomi production release `20260904-012426`，previous 保留 `4d20bc853611965d06ab7ba3517e6b0f417a6a8e` / `20260904-005152`；两条 migration 已正式提交且独立暗态 postflight 通过。生产 feature=false、integration disabled/secret null、cohort/subscription/web_push delivery/job=0，Worker inactive。尚未配置 secret、启用能力、加入员工或发送真实 Push。
>
> **历史结论（`f5cd95e…`）**：`READY FOR EXPLICITLY AUTHORIZED EXECUTION / PRODUCTION UNCHANGED / EMPLOYEE TEST NOT AUTHORIZED`。2026-09-03～2026-09-04 已完成当时候选冻结、Xiaomi 生产只读 preflight、新鲜 PostgreSQL 写前备份、两条 additive migration 的完整回滚与独立零残留检查。实际 app 原子发布、schema formal 和联合 postflight 未执行；当前生产仍运行原 release，Web Push feature/integration/cohort/subscription/delivery/job 均未建立或启用。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `DEV-WEB-PUSH-1 / PUSH-P5`；员工桌面 Web Push 关闭态生产底座；`PUSH-P5 COMPLETE / EMPLOYEE TEST NOT AUTHORIZED` |
| `candidate_commit`, `production_current`, `production_previous` | candidate/current=`bea3d1113fc24ed97672a63866a801135972329b` / release `20260904-012426`；previous=`4d20bc853611965d06ab7ba3517e6b0f417a6a8e` / release `20260904-005152` |
| `migration_hashes` | `20260903000750_employee_web_push_dark_runtime`=`c2154485d4af9621bd2cbb70a600b0a8ad415a69dc6763287b3cd1fd7be521ab`；`20260903000760_employee_web_push_dark_monitoring`=`eb4a0e6e6863efaf23db38604d1ea92a01cbd2f49b761caa69cddc59550ce29c` |
| `production_target` | Xiaomi / `mathin.club` / `supabase.mathin.club`；database fingerprint=`10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`；受影响对象 owner=`supabase_admin` |
| `preflight` | deploy/backup lock=`free/free`；service/backup disk=`47%/27%`；`mathin.service=active`，loopback/Caddy health=`ok`；`mathin-jobs.service=not-found/inactive`；未来两小时课次=`0`；active other DB connections=`0` |
| `database_baseline` | ledger=`242`，head=`20260903000700_courseware_page_insertions`，candidate rows=`0`；profiles/students/classrooms/sessions=`14/10/5/38`；notifications/deliveries/jobs=`193/193/3`；3 个 pending job 均为 `file.verify`，running/dead=`0/0`；Storage objects/bytes=`126428/51632996423`；operational errors=`1959`，latest=`2026-09-02T08:25:03.669Z` |
| `dark_invariants` | `notifications.web_push=false`；integration=`disabled` / secret null；subscription/rollout 表已部署但行数=`0/0`；web_push delivery/job=`0/0`；`mathin-jobs.service=inactive`，未运行 Worker |
| `backup` | `/mnt/openlist-disk/Backups/Mathin/mathin-db-prechange-20260904T011041Z-employee-web-push-bea3d1113fc2/`；dump bytes=`313081330`；TOC lines=`4587`；dump SHA-256=`98c6763bf8ffa11eab81bf4fcf4cffea7b565948976517782d6d7de8060598c0`；`SHA256SUMS` SHA-256=`42b5e02f6de4570dbdec6f67bf2a4aad61ac94a64c69c82b941639eabbaf2bb3`；发布后再次 `sha256sum -c` 全部通过 |
| `rollback_rehearsal` | 以 Git archive LF 原文和 `supabase_admin` 在 `SERIALIZABLE` 事务执行两条 migration、ledger insert、`web_push_assertions.sql` 与业务/Storage 不变量后 rollback；新连接确认 ledger/head=`242/00700`、candidate row=`0`、候选对象/集成=`0`、所有冻结计数及错误基线不变 |
| `candidate_validation` | 冻结 lockfile、全量 lint、TypeScript、双语键、定向 Vitest 27/27、固定员工/管理员暗态 Playwright 2/2、本地与 Xiaomi production build 通过。Playwright 证明 permission request=`0`、Service Worker registration=`0`、开启按钮禁用、8 项 Web Push 指标=`0`、integration disabled |
| `failure_ticket` | 写前 guard 曾分别因真实 production current 并发切换和旧字符串匹配误报停止，均发生在备份/数据库写入前；候选重建并改用 JSON commit 解析后通过。本地正式 Gate 首次 build 在编译完成后遭 Windows `spawn EPERM`，解除进程限制重跑通过。远端服务重启后的首次毫秒级探针连接未就绪，既定重试窗口内转为健康；未触发回退 |

## 2026-09-04 · UI 验收后的候选刷新

- `candidate_commit=c2ff15cf1539d46296a353b21c877c50dc7d2546`，候选工作树干净；相对 production current `8c50b48a8c4d69c6bad3fb3858bfd008dfa5b800` 只包含 `DEV-WEB-PUSH-1` 的三个提交。两条 migration 规范化 SHA-256 仍为 `c2154485…21ab` / `eb4a0e6e…e29c`，没有 schema 原文变化。
- 候选定向 ESLint、TypeScript、Vitest 17/17、暗态 Playwright 2/2、双语键 `6360 × 2` 与 production build 通过；产品负责人已确认账号设置二级菜单与铃铛标题栏桌面提醒开关布局通过。
- 2026-09-04T08:55:29+08:00 前完成新鲜只读 preflight：执行主机 `WHITEHOUSE`，本地 Supabase origin=`http://127.0.0.1:35421` 且 loopback listener 存在；SSH `xiaomi → 192.168.5.183`，远端主机=`xiaomi`，生产应用/Supabase origin=`https://mathin.club` / `https://supabase.mathin.club`，数据库指纹仍为 `10e3f97e…21a0c`。
- production current/previous 仍为 `20260903-115645` / `8c50b48…` 与 `20260903-100016` / `750bd607…`；`mathin.service=active`、`NRestarts=0`、`ExecMainStatus=0`，loopback/Caddy/公网 health 正常，Supabase Auth gateway 无 key 返回预期 `401`，最近 60 分钟 journal error 行=`0`。`mathin-jobs.service=not-found/inactive`，deploy/backup lock 均空闲，service/backup disk=`47%/27%`。
- 严格 `REPEATABLE READ READ ONLY` 数据库快照通过：ledger/head=`242 / 20260903000700_courseware_page_insertions`，候选 ledger row=`0`；profiles/students/classrooms/sessions=`14/10/5/38`，notifications/deliveries/jobs=`193/193/3`，pending/running/dead=`3/0/0`；未来两小时课次和其他 active DB connection 均=`0`。Storage objects/bytes=`126428/51632996423`，`operational_errors=1959`、latest=`2026-09-02T08:25:03.669Z`，与上一 preflight 完全一致。
- Web Push 暗态无半应用：feature/integration row=`0/0`，subscription/rollout table=`absent/absent`，候选 RPC=`0`，Web Push delivery/job=`0/0`。生产仍未变更。
- 上一候选备份 `mathin-db-prechange-20260903T155605Z-employee-web-push-f5cd95e08a68` 的 5 项 `sha256sum -c` 全部通过，已验证 TOC=`4571` 行；manifest 绑定 `f5cd95e…` 且不含 `c2ff15cf…`。因此它只作为附加恢复点保留，新候选进入写态前必须创建绑定 `c2ff15cf…` 的新鲜 PostgreSQL 备份，并用相同 migration 原文重跑完整 rollback/独立零残留 rehearsal。
- 前两次远端 preflight 编排分别因 Bash 引号和环境行解析在 `docker exec/psql` 前退出；没有数据库访问或生产写入。最终命令以 transaction read-only=`on` 完整返回。宿主机没有 `pg_restore`，TOC 行数改为读取已经 SHA 校验的 `database.toc`，没有降低备份校验范围。

## 2026-09-04 · 生产基线并发刷新后的写前重演

- 生产 `current` 在首次授权后的写前 guard 前已由另一个任务切换到 release `20260904-005152` / commit `4d20bc853611965d06ab7ba3517e6b0f417a6a8e`。guard 在备份目录创建和 `pg_dump` 前停止，因此没有把针对旧基线 `8c50b48…` 的授权套用到新基线。只读审查确认该生产提交仅移除课程资源中的旧复盘导航；将它并入 Web Push 候选后得到精确候选 `bea3d1113fc24ed97672a63866a801135972329b`，相对新 production current 只含 Web Push 变更。
- 新候选定向 ESLint、双语键 `6360 × 2`、Web Push/账号安全/课程资源导航相关 Vitest `27/27` 和 production build 通过。两条 migration 规范化 SHA-256 仍为 `c2154485d4af9621bd2cbb70a600b0a8ad415a69dc6763287b3cd1fd7be521ab` / `eb4a0e6e6863efaf23db38604d1ea92a01cbd2f49b761caa69cddc59550ce29c`。
- 用户随后精确授权：仅为 candidate `bea3d111…`、production baseline `4d20bc85…` 创建新鲜 PostgreSQL 写前备份，并执行两条 Web Push migration 的 rollback/零残留 rehearsal；授权不包含 app 发布、schema 正式提交、Web Push/Worker 启用或员工测试。首次备份调用的旧字符串 guard 错报 `CURRENT_COMMIT_DRIFT`，在目录创建和 `pg_dump` 前退出；只读核对确认 current 未漂移且没有 `.partial`，随后改用 JSON 解析 release commit。
- 新鲜 PostgreSQL-only 备份已原子转正为 `/mnt/openlist-disk/Backups/Mathin/mathin-db-prechange-20260904T011041Z-employee-web-push-bea3d1113fc2/`，manifest 精确绑定 candidate=`bea3d1113fc24ed97672a63866a801135972329b`、production current=`4d20bc853611965d06ab7ba3517e6b0f417a6a8e`、database fingerprint=`10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`。dump bytes=`313081330`，TOC lines=`4587`，dump SHA-256=`98c6763bf8ffa11eab81bf4fcf4cffea7b565948976517782d6d7de8060598c0`，`SHA256SUMS` SHA-256=`42b5e02f6de4570dbdec6f67bf2a4aad61ac94a64c69c82b941639eabbaf2bb3`；独立 `sha256sum -c` 的 5 项均通过，无 `.partial` 残留、未执行 retention prune。
- 以 candidate Git archive 的三份 LF 原文和 `supabase_admin` 在 `SERIALIZABLE` 单事务内执行 runtime migration、ledger insert、monitoring migration、ledger insert 与 `web_push_assertions.sql`。事务内断言通过：feature/channel=`false/false`，candidate ledger=`2`，subscription/rollout/web_push delivery/job=`0/0/0/0`，业务、Storage 与 operational error 基线不变；随后显式 `ROLLBACK`。
- 新连接严格只读检查得到 ledger/head=`242 / 20260903000700_courseware_page_insertions`、candidate ledger/table/function/column/constraint/index/feature/integration/delivery/job 均=`0`；写前/写后完整快照（含业务计数、Storage、错误基线、被替换函数定义、约束和 ACL 指纹）完全一致。唯一 rehearsal staging 已清理；新备份再次通过 5 项 SHA 校验。production current 仍为 `4d20bc85…`，`mathin.service=active`，loopback/Caddy health=`ok`。
- 当前只完成新候选的写前 Gate；下一步仍需针对 `bea3d111…` 的生产 app 原子发布和两条 schema 正式提交取得新的明确授权。进入员工测试的显式门仍未满足。

## 2026-09-04 · PUSH-P5 生产暗部署完成

- 产品负责人在同一任务中明确回复“发布”，授权候选 `bea3d111…` 的应用原子发布与两条 schema 正式提交；授权继续排除 secret、Worker/通道/feature 启用、cohort 写入和员工测试。执行窗口约为 `2026-09-04T01:23Z–01:29Z`，actor 为本任务 Codex，approver 为产品负责人在本任务中的明确发布指令。
- 紧邻发布的 preflight 再次确认 production current=`4d20bc85…`、候选工作树干净、备份 manifest/checksum 完整、数据库 fingerprint 正确、ledger/head=`242 / 20260903000700_courseware_page_insertions`、候选 ledger/table/feature/integration/delivery/job=`0`，未来两小时课次与其他 active connection=`0`，Worker inactive。
- 应用归档由 Git commit 直接生成，archive SHA-256=`39520229790c00e42f78c13411f87a0fa777e96e188d80aa878b50b954b17606`。发布 wrapper 在远端 build、原子切换和健康检查全程持有 deploy/backup lock，并在锁内核对旧 current，避免并发发布覆盖。Xiaomi 锁文件供应链检查和 production build 通过，release `20260904-012426` 原子切换为 current；previous=`20260904-005152 / 4d20bc85…`。
- 应用健康后，以 rehearsal 相同 Git 原文、checksum、schema owner=`supabase_admin` 和 assertions 在 `SERIALIZABLE` 事务正式提交 `00750/00760`，事务内 feature/channel=`false/false`、candidate ledger=`2`、subscription/rollout/delivery/job=`0/0/0/0`，并发送 PostgREST schema reload notification。提交后独立只读检查和 SQL assertions 再次通过，ledger/head=`244 / 20260903000760_employee_web_push_dark_monitoring`。
- 最终 postflight：current/previous 精确匹配，`mathin.service=active`、`NRestarts=0`、发布后 journal error 行=`0`；loopback、Caddy 与公网 `https://mathin.club/api/health` 均为 production `ok`。release 内 Worker runtime 已存在但 `mathin-jobs.service=inactive`。feature=false、integration disabled/secret null、cohort/subscription/web_push delivery/job=`0`；profiles/students/classrooms/sessions=`14/10/5/38`，notifications/deliveries/jobs=`193/193/3`，Storage objects/bytes=`126428/51632996423`，operational errors=`1959` 且 latest 不变。
- 发布和 schema 两个唯一 staging 均已清理；写前备份发布后再次通过 5 项 SHA 校验，未执行 retention prune。状态提升为 `PUSH-P5 COMPLETE / EMPLOYEE TEST NOT AUTHORIZED`；进入员工测试仍须完成专题 §11 的 `PUSH-G5` 并获得新的明确确认。
- 本批五份规划/证据文件通过 `git diff --check` 与状态关键字交叉核对。主工作树的 `pnpm plan:audit` 已实际运行，但被当前根 `AGENTS.md` 与审计器之间既有的 doc 25、R1-Live、六模块/zh-en 和小王子契约漂移阻断；该文件同时由另一任务修改，本批未覆盖其内容。此治理失败不改变已完成的生产 app/schema postflight，但在对应规划治理任务修复前不能宣称全仓规划审计通过。

## 已登记但不阻断关闭态 P5 的问题

- `PUSH-ISSUE-01～05/08`：员工测试窗口、外部告警出口、最终保留期、Push 企业网络、文案人工签收与生成数据库类型仍属 `G5-BLOCK / DEV-CONTINUE` 或 follow-up；它们阻断员工测试，不阻断三层关闭的生产暗部署。
- `PUSH-ISSUE-09` 已由生产基线 `4d20bc85…` 独立移除过期复盘导航并随 current `bea3d111…` 保留，发布后错误日志没有该签名新增。
- `web-push@3.6.7` 已冻结并随 Worker runtime 打包；P5 只交付运行文件，`mathin-jobs.service` 保持未安装/未启动。

## 已执行的固定发布顺序

1. 再次核对 candidate/current/backup/checksum/锁无漂移。
2. 用 schema 向后兼容候选原子发布 app；验证 current/previous、服务、HTTP、release 内 Worker runtime 和 Worker inactive。
3. 以 rehearsal 同一 Git archive、checksum、owner 和 assertions 正式提交两条 migration，刷新 PostgREST schema cache。
4. 联合 postflight 必须得到 feature=false、integration disabled/secret null、cohort/subscription/web_push delivery/job=`0`、workerStale=false，业务/Storage/错误不变量无本批新增。
5. 清理唯一 migration staging；保留本轮备份。状态只更新为 `PUSH-P5 COMPLETE / EMPLOYEE TEST NOT AUTHORIZED`，不进入员工测试。
