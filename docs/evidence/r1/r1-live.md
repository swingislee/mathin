# R1-Live · 真实教师首个可用闭环差距表

## 结论

截至 2026-08-25，Xiaomi 已固定为 `mathin.club` / `supabase.mathin.club` 生产目标，危险开发写入继续 fail-closed。数据库账本为 191 条，head=`20260825000600_r1_live_phone_password_auth`；应用 current/previous 为 `20260825-041101` / `8ec0ba0…` 与 `20260823-123746` / `9bc9ff3…`，服务、Auth、loopback、Caddy 与公网健康均正常，最近同批次 PostgreSQL+Storage 备份仍为 `mathin-20260822T093529Z`。手机号/password P0 已部署，phone provider=true、SMS auto-confirm=false；发布前后账号/手机号账号/profile/邀请/保障记录=`14/0/14/1/0`，没有创建账号、邀请或业务数据。真实手机号邀请注册/login 与正式点名闭环均未发生，因此 Gate 2 保持 `BLOCKED`。

本文件是 E0/E1 差距审阅，不是完整生产验收。2026-08-14～22 的 Xiaomi E1/E3 运行事实，以及本机隔离目标、应用/数据库发布、正式管理员交接和 manifest 激活证据见 [`r1-live-target-audit.md`](r1-live-target-audit.md)；用户提供的 `docs/plan/mathin-R1-Live-讨论稿.md` 为产品裁决输入，现行施工顺序以 doc 04 为准。

## Gate 状态表

| Gate | 当前状态 | 已完成证据 | 缺失项 | 是否阻塞 | 最小修复范围 |
| --- | --- | --- | --- | --- | --- |
| Gate 1 · 可安全开始 | `PASS` | 目标/身份、生产危险写拒绝、0 个 purge 候选、运行时 migration/应用、current/previous、回退命令、健康探针、错误查询位置和当前 PostgreSQL+Storage 同批次备份均已确认；备份独立 SHA 与可读性复核通过 | 无 | 否 | 已关闭；恢复、异机/静态加密备份和受控 rollback 进入 Production 1.0 |
| Gate 2 · 首个真实教师闭环 | `BLOCKED` | 学生/班级/课次/分班/点名 UI、RPC、RLS 和持久化合同已实现；点名可在课前、课中或课后完成，不再阻断开课；本机隔离固定账号 Golden Path 1/1 已完成建班→自动课次→报名→教师点名保存→换页再读。生产已有 1 个 production 班级、15 个课次和 1 条 active 报名；学年/秋季归属修复已上线且未升年级 | 无正式教师保存→刷新或重登→再读、管理员可见、无权限拒绝的生产 Golden Path | 是 | 由正式教师完成一次点名并做权限对照 |

状态只允许 `PASS`、`BLOCKED`、`UNKNOWN`、`NOT REQUIRED`。范围冻结是永久规则，不再单列 Gate；旧 Gate 3 的当前备份底线并入 Gate 1，恢复/受控 rollback 演练与 release 错误标签进入 Production 1.0；旧 Gate 4 的首个教师动作并入 Gate 2，独立观察和连续运行进入上线后证据。

## 当前执行方式

- **生产轨**：1 名正式教师在现有 production 班级、课次和花名册上持续试用；真实问题按 P0/核心 P1 优先，正式数据继续受保护。
- **开发轨**：产品负责人可选择新功能在本机隔离目标预演；相关机器检查和开发端人工初验通过后，才进入独立可回退的生产发布流程。
- **证据边界**：开发通过、已部署待验收和生产通过分别登记。新功能若修改登录、授权、班级、课次、课堂或点名共享链路，生产发布后追加对应 R1-Live Smoke；任何开发结论都不替代 Gate 2 的正式点名与权限对照。

### 仓库 manifest 实现证据

- migration `20260815000100_r1_live_object_protection_manifest.sql` 不包含 manifest seed 或 Xiaomi 指纹，只建立表、trigger、内部校验与现有两个 purge RPC 的 fail-closed 合同；`20260815000200_r1_profile_role_update_guard.sql` 只恢复受信任 role 更新旁路，其他 profile 保护字段继续拒绝。
- 一次性 PostgreSQL 15 先前从零重放 181 个 bootstrap/migration/seed/fixture 输入并通过 manifest 断言；加入 role guard 后又在明确命名的临时空库重放 182 个输入（179 migrations + bootstrap/seed/fixture）并通过账户安全断言，临时库随后删除。
- 14/14 份 R1 数据库断言既有基线通过；学年断言加入后当前清单为 15 份。manifest/purge 定向 Vitest 为 2 个文件、17/17。当前 `pnpm r1:live:test` 为 6 个文件、52/52；历史 `pnpm r1:regression` 为 23 个文件、179/179；全量 Vitest 当前基线为 93 个文件、625 项通过、1 项条件跳过。三类计数分别表示当前源码合同、历史合同和工程回归，不替代目标环境证据。
- 仓库实现阶段的数据库验证和类型生成只连接 disposable loopback 容器；之后按独立明确授权向 Xiaomi 部署两个 migration。生产部署边界、断言和只读 postflight 见下文及 [`r1-live-target-audit.md`](r1-live-target-audit.md#35-两个-r1-live-migration-的生产部署)。

### 本机隔离开发目标证据

2026-08-15 在用户明确授权后，以 Supabase 官方 self-hosted `v0.8.0`（上游 commit `241bb11c0627f2981746d37033f57dbfa81d29b0`）建立名为 `mathin-isolated` 的本机开发栈。运行文件和 secret 只保存在 gitignored 的 `.tmp/mathin-supabase-selfhosted/` 与 `.env.local`，未提交凭据；Xiaomi 全程未连接、未复制、未写入。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；开发/生产连接隔离；该子项 `PASS`，Gate 1 整体 `PASS` |
| `measured_value`, `threshold` | 11/11 个服务 healthy；所有已发布端口 Host IP 恰为 `127.0.0.1`；`auth.users=11`、`profiles=11`，11/11 password login 通过；全局自助注册关闭，email provider 只用于已有账号登录，phone provider 关闭。阈值为无非 loopback 发布、固定集合精确、无自助注册、无 Xiaomi/真实业务数据，全部满足 |
| `commit_sha`, `migration_head`, `environment` | `commit_sha=302a0523b0bf27e772618ca3c8c512b7b52166b2`；当前 head `20260822000300_r1_live_enrollment_status_transition`；Windows Docker Desktop / `mathin-isolated-loopback` |
| `dataset_manifest` | PostgreSQL 15.8；当前仓库 182 个 migration SQL；本机 ledger 179 条、head `20260822000300`；课程基线沿用、Storage bucket 8、active protection manifest 0；11 个固定开发身份/profile、8 条 staff-role；Golden Path 清理后学生、班级、课次、报名、点名和课耗账本均为 0 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；2026-08-22（最新只读复核，Asia/Shanghai）；Codex；`swingislee`（对话授权“允许创建隔离 Supabase”） |
| `command_or_runbook` | 官方 self-hosted Compose + 本机 override；API `127.0.0.1:35421`、数据库 `127.0.0.1:35422`、Studio `127.0.0.1:35423`、transaction pool `127.0.0.1:35429`；应用 `.env.local` 指向 API，target policy 以 development/loopback/本地数据库指纹通过；`R1_DEV_TEST_FIXTURES=1 pnpm r1:fixed-accounts`；`pnpm e2e e2e/notebook-authenticated.spec.ts --project=credentialed-chromium`；`pnpm e2e:r1-live:golden` |
| `artifact_url_or_path`, `artifact_hash` | `.tmp/mathin-supabase-selfhosted/docker-compose.local.yml`（gitignored 本机 artifact），规范化文本 SHA-256 `28a7db50a165e5f34cd6f9dc46cc0e47931d6597a7143a99003a8dd5a2d46653`；`scripts/ensure-r1-fixed-test-accounts.mjs`，规范化文本 SHA-256 `0e533c5c77ab635fd54405951dcb895b9aa4e66956d5da1a1b8f270fdca3804a`；本地数据库指纹 `5af56ae69b51ca0a78b9357ec4792533a6e59f0a529a9a918f6ba4c93da68d0f` |
| `retention`, `access_roles`, `failure_ticket` | 保留至隔离开发目标被明确替换；本机所有者；`not_applicable` |

仓库 migration 重放到 `20260728000300_r1_platform_runtime.sql` 时，官方 self-hosted Storage 已存在 `storage.buckets.allowed_mime_types text[]`，但该表由 `supabase_storage_admin` 持有，仓库 `postgres` 角色无权重复执行 `ADD COLUMN IF NOT EXISTS`。核实列型后从下一条语句继续，未改变 Storage 表 owner，剩余迁移全部完成；此兼容偏差不涉及 Xiaomi。

固定账号连接前先对 Xiaomi 做只读集合核对：目标共 12 个 auth user，其中 11 个 `@mathin.local` 身份与 `.claude/test-accounts.local.md` 的 11 个唯一邮箱完全一致，另 1 个非固定域账号未读取到仓库、未复制到本机。新 runner 从 manifest 的 12 条角色行合并为 11 个账号，不把邮箱、密码或 UUID 写入日志/源码；本机 profile 分布为 admin 1、staff 6、student 2、parent 2，staff-role 分布为 teacher 3、research 2、sales/principal/registrar 各 1，与 Xiaomi 匿名摘要一致。账号创建后逐一密码登录 11/11，通过仓库 Playwright 固定学生账号进入 `/zh/notebook/me` 为 1/1；该浏览器证据只证明本机应用与 Auth 连接，不证明正式身份或真实业务旅程。

### Gate 2 本机建班与点名 Golden Path 证据

2026-08-22，固定主管和教师账号在 loopback 应用/数据库完成聚焦旅程：主管选择 `purpose=test` 的未完整课程，创建并立即启用班级，确认自动生成 1 个课次；随后把无 auth 账号的合成 `lead` 学生加入花名册；固定教师登录 live 课次，保存“迟到”和合成备注，再进入课后页重新打开点名抽屉，状态、备注和 `marked_by` 均一致。首次执行在报名阶段暴露 `enroll_student` 要求 `lead → enrolled`、而状态 trigger 拒绝该边的冲突；migration `20260822000300_r1_live_enrollment_status_transition.sql` 只补这一条既有受控 RPC 边，其余学生/跟进状态边保持不变。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 2`；本机建班/报名/点名持久闭环；隔离子步骤 `PASS`，Gate 2 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | `r1-live-local-chromium` 1/1 通过（业务旅程 15.3 秒，整次 runner 18.0 秒）；1 个未完整课程测试班、1 个自动课次、1 个 `lead` 学生、1 条迟到记录和 1 条备注均经 UI/RPC 写入并从独立页面再读；数据库额外核对 `marked_by` 等于固定教师。阈值为报名不报状态错误、再读完全一致、无账号创建、无外部通知、无可变残留，全部满足 |
| `commit_sha`, `migration_head`, `environment` | `302a0523b0bf27e772618ca3c8c512b7b52166b2`；本机 `179` 条 ledger、head `20260822000300_r1_live_enrollment_status_transition`、checksum `f07a186b3cfc9395f071d14717c0c4eeae543c055fcf4124e0e022be08c6bffc`；Windows Docker Desktop / `mathin-isolated-loopback`；未连接 Xiaomi |
| `dataset_manifest` | 执行前后 `auth.users=11`、`profiles=11`；email/SMS/微信/webhook 均 `disabled`，active protection manifest 0。夹具只创建随机标记的 `purpose=test` 课程族/版本/课程/讲次、无登录账号学生、班级/课次/报名/点名；对精确匹配的新测试班把四种课耗设为 0。最终学生、班级、课次、报名、点名、课耗账本和 Golden Path 课程族均为 0；每个已删除测试班的 `classroom.created` 审计事件保留 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-22（Asia/Shanghai）；2026-08-22（Asia/Shanghai）；Codex；`swingislee`（回复“继续”，推进 doc 04 已规划的 Gate 2 隔离 Golden Path） |
| `command_or_runbook` | `pnpm e2e:r1-live:golden`；runner 同时要求 loopback 应用目标、`R1_DEV_TEST_FIXTURES=1`、非 release mode 和 `assertNonProductionWriteTarget`；登录态 trace/screenshot/video 全关闭；`pnpm r1:live:test`、`pnpm test -- tests/r1-playwright-baseline.test.ts`、`pnpm ci:checks`（16/16） |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260822000300_r1_live_enrollment_status_transition.sql` `f07a186b3cfc9395f071d14717c0c4eeae543c055fcf4124e0e022be08c6bffc`；`e2e/r1-live-golden-path.spec.ts` `d156a7c55cb21f083d2036389b5b485cf60bb53db8240d543b84d818b6454708`；`e2e/support/r1-live-golden-path-fixture.ts` `35352778fe2170cb052742f738bfb8fb79e574c99cfe6c21afa3b147292fbc56`；`scripts/run-r1-live-golden-path.mjs` `c4603a8d1321d1babeee9b0f247ef70cd72d529a2045ff758b6bdb3eb92b8e9e`（均为 LF 归一化 SHA-256） |
| `retention`, `access_roles`, `failure_ticket` | migration、runner、合同和去标识化摘要随 Git 永久保留；仓库维护者；`BUG-R1-LIVE-003` 的生产数据库合同已关闭，正式业务 Golden Path 仍由 Gate 2 跟踪 |

首次完整业务链在收尾保护中发现测试班默认 `late_lessons=1` 会生成 1 条课耗账本；清理器先 fail-closed，没有继续删除关联对象。随后只对已核对的唯一 UUID、随机合成名称、`purpose=test`、合成来源和精确对象计数执行事务化清理，事务内 precheck/postcheck 均为 1，审计事件未删除；之后 runner 在点名前把精确匹配测试班的四种课耗置 0。该处理只约束本机合成夹具，不改变正式班默认课耗合同。

### Gate 2 报名状态窄修复的生产部署证据

2026-08-22，先在 Xiaomi 新连接的 `REPEATABLE READ READ ONLY` 事务核对目标指纹、旧账本/head/checksum、旧函数定义/owner/ACL、身份与业务匿名计数、active manifest 摘要和 Storage 计数。migration 与 fail-closed 前后断言随后在同一 serializable 事务完整执行并显式 `ROLLBACK`；独立连接确认旧 head、旧函数和全部计数恢复后，完全相同的前三份 SQL 正式提交。提交后的新连接只读 postflight 验证新状态边存在、旧状态边不存在，且没有账号、业务、manifest 或 Storage 漂移。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 2`；`lead → enrolled` 受控报名状态合同；生产 migration 子步骤 `PASS`，Gate 2 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | ledger `179→180`，head=`20260822000300_r1_live_enrollment_status_transition`，checksum=`f07a186b3cfc9395f071d14717c0c4eeae543c055fcf4124e0e022be08c6bffc`；`guard_student_state_transition()` 定义 SHA-256 由 `ed1e0a7…64dfb` 变为 `00cd9471…64a5`，精确新边存在、旧边不存在，owner=`postgres`、ACL 原样保留。显式回滚演练、独立回滚核查、正式提交与独立 postflight 全部通过 |
| `commit_sha`, `migration_head`, `environment` | migration source commit `302a0523b0bf27e772618ca3c8c512b7b52166b2`；`20260822000300_r1_live_enrollment_status_transition`；Xiaomi / production；数据库指纹 `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c` |
| `dataset_manifest` | pre/post 均为 auth/profile=13、profile admin/staff/student/parent=`1/8/2/2`、verified active admin MFA=1、staff-role=10、学生=4、监护关系=2、课程族/目录版本/课程/讲次/release=`2/3/102/1315/2633`、班级/课次/报名/点名/课耗账本=`0/0/0/0/0`、Storage bucket/object=`8/123602`；manifest header/active/retired=`2/1/1`、active entry/protected/purge=`8/8/0`，目标与 entries hash 均匹配 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-22（Asia/Shanghai）；独立 postflight 不晚于 `2026-08-22T15:18:57Z`；Codex；`swingislee`（在既定 R1-Live 下一项连续回复“继续”） |
| `command_or_runbook` | 只读 preflight → 文件摘要/mode 核对 → `psql -1` 完整回滚演练 → 新连接只读回滚核查 → 同一 pre/migration/post 正式 `psql -1` → 新连接只读 postflight → 精确删除主机/容器 `/tmp` 副本；未创建或修改账号、业务数据、岗位、manifest、备份或 purge 状态。两次只读 manifest 查询因本轮临时 SQL 的别名/表名错误终止；第一次回滚演练因临时断言误用不存在的 `profiles.status` 在 migration 前终止，三次均无持久写入，修正后完整链通过 |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260822000300_r1_live_enrollment_status_transition.sql`；LF 规范化 SHA-256 `f07a186b3cfc9395f071d14717c0c4eeae543c055fcf4124e0e022be08c6bffc`；修正后临时 pre/post/rollback 脚本传输 SHA-256 分别为 `5dccb426…14ff`、`8597842c…8b4`、`ca66ea84…192`，部署后不保留 |
| `retention`, `access_roles`, `failure_ticket` | migration、账本和本 Git 摘要永久保留；临时脚本已从 Xiaomi 主机/容器删除；仓库维护者/Xiaomi 运维角色；`not_applicable`（三次前置脚本错误均在任何持久写入前 fail-closed） |

### 未完成课程可建班/启用的隔离回归证据

2026-08-22，产品负责人确认部分后续讲次长期未完成是正常运营状态，不应阻止正式班创建或启用。migration `20260822000100_r1_live_incomplete_course_activation.sql` 是第一步：移除 `current_release_id`/全课程 release 完整度硬门，当时仍拒绝正式自由班、无 active 讲次、空讲次引用和非 active 讲次。随后 `20260822000200` 根据整轮门禁复核继续取消自由班、备课质量、点名前置、资源预载和无 release 硬门；现行合同见下一节。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；正式班创建/启用；仓库、隔离数据库与生产部署子步骤 `PASS`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 本机 ledger 恰有目标 migration 且 checksum 匹配；两个函数的 release 完整度硬门均已移除、结构守卫均保留；active manifest 仍为 0。回滚事务分别验证未发布讲次可“创建即 active”和“planning→active”，两班各生成一条课次且事务无持久写入；180 个 migration、版本前/后两份既有课程 seed、平台垫片和固定夹具在明确命名的一次性数据库从零重放后，完整 P4H 断言通过并自动删除临时库。固定开发主管的只读 Playwright 选中准备度 `0/10` 的 production 课程，确认告警可见、“创建后立即启用”可用且 `submitted=false` |
| `commit_sha`, `migration_head`, `environment` | `commit_sha=1187ee36863321eb3a0f07a25803c7c470073d63`；本机 head `20260822000100_r1_live_incomplete_course_activation`；Windows Docker Desktop / `mathin-isolated-loopback`；未连接 Xiaomi |
| `dataset_manifest` | 主隔离库沿用 11 个固定身份且业务计数无漂移；一次性数据库只存活于验证过程，断言中的临时课程、讲次、班级和课次整体 `ROLLBACK`，验证结束数据库与 SQL 副本均删除 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-22（Asia/Shanghai）；2026-08-22（Asia/Shanghai）；Codex；`swingislee`（产品裁决“讲次没有完全做完应在较长时间内允许”） |
| `command_or_runbook` | 本机 migration 原子应用与只读 postflight；`p4h_teaching_operations_assertions.sql` 的新增回滚合同；一次性空库顺序重放；固定开发账号只读 Playwright；`pnpm ci:checks` |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260822000100_r1_live_incomplete_course_activation.sql`；规范化文本 SHA-256 `8b49dc3ebf94b00131405dcc74a073e449f630991d949565064b2d6d121dabd3` |
| `retention`, `access_roles`, `failure_ticket` | migration、回归和去标识化摘要随 Git 永久保留；仓库维护者；`BUG-R1-LIVE-002` 已完成生产部署，真实教师行为复验并入 Gate 2 闭环 |

### 运行时门禁减法的隔离回归证据

2026-08-22，产品负责人指出现有门禁数量过多，要求按真实生产需要重新判断。实现 commit `43db4ceb6972313719fc53bb675309d45ac7adbf` 将运行时检查分成两类：权限/作用域、畸形输入、无效引用、已删除或非法状态、冻结并发与不可变历史继续 fail-closed；课程完整度、正式自由班、教师时间冲突、备课产物/审核/检查项、点名时机、资源预载和无 release 只显示运营提示。migration `20260822000200_r1_live_operational_gate_simplification.sql` 重定义建班、班级状态和兼容备课 guard；应用允许教师冻结空白/本次覆盖快照并在课前、课中或课后点名。该实现轮没有连接或修改 Xiaomi，后续生产发布见“运行时门禁与应用的生产发布证据”。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；运行时业务门禁；仓库、隔离数据库、固定账号 UI 和生产部署子步骤 `PASS`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 明确命名的一次性数据库从 bootstrap 顺序重放 181 个 migration、两份既有课程 seed、平台垫片和固定夹具后，P4H 与 doc26 SQL 断言均通过并整体回滚；主隔离库 ledger=178、head=`20260822000200`、checksum 与 migration 规范化 hash 相同，active manifest=0。固定主管账号在正式自由班确认页选中“创建后立即启用”，测试未提交；学校门户固定账号 Playwright 4/4。当时名为 `pnpm r1:test` 的历史集合为 23 文件 179/179；完整 Vitest 92 文件 621 通过、1 项既有条件跳过；当时 `pnpm ci:checks` 17/17 |
| `commit_sha`, `migration_head`, `environment` | `43db4ceb6972313719fc53bb675309d45ac7adbf`；本机 head `20260822000200_r1_live_operational_gate_simplification`；Windows Docker Desktop / `mathin-isolated-loopback`；未连接 Xiaomi |
| `dataset_manifest` | 主隔离库沿用 11 个固定身份，UI 未点击“创建班级”；数据库断言写态均在一次性库事务中回滚。验证完成后精确临时数据库 `mathin_r1_gate_audit_20260822_01` 与 `/tmp/mathin_r1_gate_audit_20260822_01` 已删除，主隔离库仍为预期 head 且 active manifest=0 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-22（Asia/Shanghai）；2026-08-22（Asia/Shanghai）；Codex；`swingislee`（产品裁决“门禁过多，需要按实际生产需要迭代”） |
| `command_or_runbook` | 本机 migration 原子应用与只读 postflight；一次性空库顺序重放；`p4h_teaching_operations_assertions.sql`、`doc26_teacher_workflow_assertions.sql`；固定账号 `school-portals.spec.ts`；当时的 `pnpm r1:test`（现为 `pnpm r1:regression`）；`pnpm test`；`pnpm ci:checks` |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260822000200_r1_live_operational_gate_simplification.sql`；规范化文本 SHA-256 `145acada7418b268c342ced431eddfbbb0b9e0e298b4bf52a6f92d2b320555a0` |
| `retention`, `access_roles`, `failure_ticket` | migration、回归和去标识化摘要随 Git 永久保留；仓库维护者；生产部署已完成，后续当前备份证据见下文 |

### 测试入口重分类证据

2026-08-22，产品负责人质疑 179 项 R1 与 621 项全量通过是否真实对应当前产品体量。只读拆分确认：179 项是 R1-1～16 累积合同，且已包含在 622 项全量 Vitest 中；全量中的 279 项属于独立 SML 轨道。commit `017e7a93917d03b50a2b0890a38bf716fa71b7d2` 因此只重组入口和汇报，不删除测试：当前两 Gate 使用 5 个直接相关文件，历史集合改名，CI 保留全量回归并移除重复执行历史集合的步骤。隔离数据库 SQL、固定账号 Playwright、生产只读核查和真实教师闭环继续单列，不以 Vitest 数量替代。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1/2`；测试治理与证据口径；仓库子步骤 `PASS`，不改变两个 Gate 的目标环境状态 |
| `measured_value`, `threshold` | `pnpm r1:live:test` 精确运行 `r1-account-security`、`p4h-class-builder`、`r1-classroom-continuity`、`r1-write-target-policy`、`r1-live-object-protection`，5 文件 48/48；兼容命令 `pnpm r1:test` 同为 48/48。`pnpm r1:regression` 保留 23 文件 179/179；`pnpm test` 保留 92 文件、621 通过和 1 项既有条件跳过；去掉全量后的重复历史子集后 `pnpm ci:checks` 为 16/16 |
| `commit_sha`, `migration_head`, `environment` | `017e7a93917d03b50a2b0890a38bf716fa71b7d2`；`20260822000200_r1_live_operational_gate_simplification`（未新增 migration）；Windows 本机仓库与 CI 等价 checks；未连接 Xiaomi |
| `dataset_manifest` | `not_applicable`；未连接数据库、未运行账号旅程、未创建或修改数据 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-22（Asia/Shanghai）；2026-08-22（Asia/Shanghai）；Codex；`swingislee`（回复“继续”，执行已提出的测试入口重分类） |
| `command_or_runbook` | `pnpm r1:live:test`；`pnpm r1:regression`；`pnpm r1:test`；`pnpm ci:checks`；`pnpm plan:audit` |
| `artifact_url_or_path`, `artifact_hash` | `package.json`，规范化文本 SHA-256 `2df2cc1ccc308a9ccd42a63cc32e7006e26e975cbfae2276ef6cd1bd85e48ae1`；`.github/workflows/ci.yml`，规范化文本 SHA-256 `4f25ec2893cb7bc2d72401fa0e6680b91a50f27c2586207cf31c2d7267a19a65` |
| `retention`, `access_roles`, `failure_ticket` | 入口、规划与去标识化摘要随 Git 永久保留；仓库维护者；`not_applicable` |

### 运行时门禁与应用的生产发布证据

2026-08-22，在用户回复“继续”后按已明确的单一 R1-Live 执行项推进。写前只读核查精确匹配 Xiaomi 数据库指纹、177 条迁移账本、旧 head/checksum、三项旧函数 hash、active manifest 和全部匿名计数；两条 migration 在一个 serializable 事务中依次执行并登记，任一断言失败都会整体回滚。随后以独立连接复核账本、函数定义/权限、manifest 内容 hash 和所有计数，再使用不可变 release/原子指针脚本发布当前提交。该轮没有创建或修改账号、岗位、manifest、业务数据或备份，没有激活准删条目，也没有执行清理。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；运行时数据库函数与生产应用同步发布；该子步骤完成时 `PASS`，后续当前备份关闭 Gate 1 |
| `measured_value`, `threshold` | 数据库 ledger `177→179`，head=`20260822000200_r1_live_operational_gate_simplification`；两个 migration checksum 与仓库规范化文本 hash 一致。`assert_session_preparation_complete`、`create_class`、`transition_classroom_status` 的生产定义 SHA-256 分别为 `59580998…09b82`、`84003eac…14b9`、`a01a1dc1…bf1a4`，三者均为 anon execute=false、authenticated execute=true。应用 current=`20260822-072101` / `ef1eb77…`、previous=`20260814-221135` / `023f5167…`；service active，loopback/Caddy/公网 health 为 production `ok`，zh/en login HTTP 200，zh/en 匿名建班页 HTTP 307 并精确回到对应语言 login。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | `ef1eb77cfbb1b5714191c0455dbf5fdc7313f208`；`20260822000200_r1_live_operational_gate_simplification`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth/profile=13、profile admin/staff/student/parent=`1/8/2/2`、verified admin MFA=1、staff-role=10、学生=4、监护关系=2、课程族=2、课程=102、讲次=1315、release=2633、班级/课次/报名/点名=`0/0/0/0`、Storage bucket/object=`8/123602`；active manifest=`1`、entry/protected/purge=`8/8/0` 且 entries hash/目标指纹一致 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-22（Asia/Shanghai）；2026-08-22 15:24（Asia/Shanghai）完成独立 postflight；Codex；`swingislee`（在既定单一部署项后回复“继续”） |
| `command_or_runbook` | 精确 preflight + 两条 migration + ledger insert 的单事务 SSH/psql；独立 `REPEATABLE READ READ ONLY` 无锁 postflight；`scripts/ops/publish-mathin-xiaomi.ps1 -Action Publish` 与 `-Action Status`；公网 curl 健康/双语登录/匿名重定向探针。首次只读审计误调用内部含 `FOR SHARE` 的 manifest resolver，被 PostgreSQL 在写入前拒绝；随后改为等价无锁字段/条目 hash 查询并通过 |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260822000100_r1_live_incomplete_course_activation.sql`，规范化文本 SHA-256 `8b49dc3ebf94b00131405dcc74a073e449f630991d949565064b2d6d121dabd3`；`supabase/migrations/20260822000200_r1_live_operational_gate_simplification.sql`，规范化文本 SHA-256 `145acada7418b268c342ced431eddfbbb0b9e0e298b4bf52a6f92d2b320555a0`；Xiaomi `/home/swing/services/mathin/releases/20260822-072101/release.json`（远端 immutable metadata，仓库不复制） |
| `retention`, `access_roles`, `failure_ticket` | migration、Git 证据与 immutable release 目录按现有策略保留；仓库维护者/Xiaomi 运维角色；`not_applicable`（只读 resolver 审计调用错误未改变目标，等价复核已通过） |

### 当前 PostgreSQL+Storage 同批次备份证据

2026-08-22，在用户对已规划的下一项回复“继续”后，先只读核对 Xiaomi 目标指纹、迁移账本、应用 release、数据库/Storage 规模、外置盘容量、挂载和访问边界。现有 `scripts/infra/p4e-backup.sh` 成功后会自动清理超期目录，本轮不含清理授权，因此没有直接运行它；一次性 fail-closed runner 只创建本次 `.partial`，按同一批次依次导出 PostgreSQL custom dump 与 Storage 归档，源发生计数或文件路径/大小/修改时间漂移就停止，所有检查通过后才原子转正。没有执行 restore、retention prune、服务切换、账号/岗位/manifest/业务写入或清理。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；当前 PostgreSQL+Storage 同批次备份；`PASS`，Gate 1 整体 `PASS` |
| `measured_value`, `threshold` | 正式目录 `/mnt/openlist-disk/Backups/Mathin/mathin-20260822T093529Z`；残留 `.partial=0`。`database.dump` 249508019 bytes、TOC 3661 项；Storage 源 50887768212 bytes/125135 文件，`storage.tar.gz` 47869458194 bytes，完整解压目录扫描为 125135 文件。数据库匿名计数前后 JSON 完全相同，Storage 路径/大小/mtime 清单前后完全相同；独立 `sha256sum -c SHA256SUMS` 的 9/9 工件均为 `OK`。阈值为同一 runner 批次、源无观测漂移、两类工件可读、摘要独立复核和无临时目录，全部满足 |
| `commit_sha`, `migration_head`, `environment` | 应用 source commit `ef1eb77cfbb1b5714191c0455dbf5fdc7313f208`；`20260822000200_r1_live_operational_gate_simplification`；Xiaomi / production；数据库指纹 `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c` |
| `dataset_manifest` | 备份前后均为 auth/profile=13、staff-role=10、学生=4、监护关系=2、课程族=2、课程=102、讲次=1315、release=2633、班级/课次/报名/点名=`0/0/0/0`、Storage bucket/object=`8/123602`、active manifest/entry/purge=`1/8/0`；备份工件含正式数据且不进入 Git，仓库只登记无 PII 的计数、路径和 hash |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-22T09:35:29Z`；备份落盘 `2026-08-22T10:32:18Z`，独立 SHA 复核不晚于 `2026-08-22T10:51:55Z`；Codex；`swingislee`（对既定下一项回复“继续”） |
| `command_or_runbook` | 精确 mount/容量/指纹/账本 preflight → `flock` + `.partial` → 容器内 `pg_dump --format=custom --no-owner` → 低优先级 `tar`/`pigz` Storage 归档 → 前后匿名计数与文件清单 `cmp` → 容器内 `pg_restore -l` + 完整 Storage tar 读取/文件计数 → SHA-256 → 原子转正与 `sync` → 独立 `sha256sum -c`/生产状态 postflight；`restore_executed=false`、`retention_prune_executed=false`。仓库侧 `pnpm plan:audit`、`pnpm r1:live:test` 48/48、`pnpm secrets:check`、`pnpm typecheck`、`pnpm build` 均通过 |
| `artifact_url_or_path`, `artifact_hash` | Xiaomi `/mnt/openlist-disk/Backups/Mathin/mathin-20260822T093529Z/`；`database.dump=dc26579cf02c3d50de9961e831636c48562fb8a6b6584e8670642038276cf5bb`；`storage.tar.gz=b736c5d78384b3c8e31a5ea81534b1ff6dec7ed0e91525222c4f4fd6743aab9c`；Storage 清单 `cebbbe252fc636dcaf89237bccc32252b92516edecff89afbf2d1f400075b90f`；`manifest.env=fa624ef33f66bc0ddb2830c887d67d31df61a3d9a2b296e3153624f027042196`；`SHA256SUMS=3c18aa352971493ce7d6f1d1952de1f9e462b559df74a026ba2e112d112d119b` |
| `retention`, `access_roles`, `failure_ticket` | 当前未启用自动 prune，在已核验 replacement 建立前不得删除；外置 `/dev/sdb1` 与系统盘分离但仍在 Xiaomi 同机。exFAT `fmask/dmask=0022` 使工件有效 mode 为 `755`，owner=`swing:swing`；主机交互 shell 仅 root/swing，OpenList 未挂载 Backups 路径，但工件未静态加密。恢复、异机副本、静态加密与正式 RPO/RTO 沿既有 Production 1.0 运维门完成；R1-Live failure ticket=`not_applicable` |

### 正式建班与填写时校验证据

生产记录确认产品负责人已成功创建 1 个 production 班级和 15 个课次，主讲分配 1 条、学辅 0 条；学辅本身是可选字段。此前失败是因为先选择学辅、再把同一人选为主讲后，学辅选项虽然从界面消失，客户端仍保留冲突 UUID，服务端直到最终提交才返回 `VALIDATION`。commit `6dfb3af96cc81ca09be9b662d7cb047025546019` 让主讲变化立即清除冲突学辅并提示，同时在每个向导步骤就地显示必填和格式错误；本机固定账号 Golden Path 复现该顺序并通过。应用已发布为 `20260822-162416`，service、loopback/Caddy/公网 health、双语登录及匿名建班重定向 postflight 均通过；应用发布没有写数据库或业务数据。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 2`；正式建班与表单校验；该子项 `PASS`，Gate 2 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 生产班级/课次/报名/点名=`1/15/0/0`、主讲/学辅=`1/0`；同一路由/digest 的失败记录 2 条；本机固定账号 Golden Path 1/1，R1-Live 48/48，CI 16/16。阈值为学辅可空、冲突即时清除、错误在字段所在步骤显示、合法建班路径通过，全部满足 |
| `commit_sha`, `migration_head`, `environment` | `6dfb3af96cc81ca09be9b662d7cb047025546019`；`20260822000300_r1_live_enrollment_status_transition`；本机隔离 Supabase + Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | 真实班级与课次由产品负责人通过正式 UI 创建；Agent 只读核查。应用发布前后均为班级/课次/报名/点名=`1/15/0/0`、主讲/学辅=`1/0`、active manifest/entry/purge=`1/8/0` |
| `started_at`, `finished_at`, `actor`, `approver` | 首次失败 `2026-08-22T15:53:01.279Z`；release 构建完成 `2026-08-22T16:25:29Z`；产品负责人执行正式建班，Codex 定位、实现、验证和发布；`swingislee`（报告失败并确认触发路径） |
| `command_or_runbook` | 生产错误与业务计数只读核查；`pnpm r1:live:test`、固定账号 `pnpm e2e:r1-live:golden`、typecheck/messages/lint/build/CI；Xiaomi 应用 publish/status 与 HTTP postflight |
| `artifact_url_or_path`, `artifact_hash` | Git commit `6dfb3af96cc81ca09be9b662d7cb047025546019`；Xiaomi `/home/swing/services/mathin/releases/20260822-162416/release.json`；`artifact_hash=not_applicable` |
| `retention`, `access_roles`, `failure_ticket` | Git 与 immutable release 按既有策略保留；仓库维护者/Xiaomi 运维角色；`BUG-R1-LIVE-004` 已关闭 |

### 学年四周期与春季边界生产部署证据

产品负责人确认 `2025–2026` 学年春季实际结束于 `2026-06-29`，并采用独立学年头部、暑/秋/寒/春四个日期可后补周期，以及显式预览后再升年级的方案。实现先在最终空库、旧库升级副本和回滚式晋级事务验证，再以固定主管账号完成 zh/en 只读页面旅程；完整 CI 为 16/16、全量 Vitest 93 文件 625 项通过及 1 项既有条件跳过。生产写前精确命中数据库指纹、180 条账本、旧春季、1 个班级、15 个课次、1 条报名、1 名五年级学生、active 8 条 protected/0 条 purge manifest 和 123602 个 Storage object。

首次生产回滚演练在替换历史 `create_campus_school_term` 时因该函数为唯一的 `supabase_admin` owner 而被 PostgreSQL 拒绝；连接退出自动回滚，新连接确认 schema、账本、业务、年级、manifest 和 Storage 全部零漂移。修正后的事务由 `supabase_admin` 会话先把该函数 owner 原子归一到 `postgres`，再以 `postgres` 运行相同迁移；完整后置断言通过后先回滚并独立复核，第二次才提交。生产提交只新增学年结构、把旧春季改为 `2025–2026` 学年第 4 周期并结束于 `2026-06-29`，以及将全在该日期之后的 production 班级、课次和报名改挂到 `2026–2027` 秋季；没有启用 2026 学年、没有升年级，也没有创建业务事件。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 2`；学年/运营周期与现有班级归属；该子项 `PASS`，Gate 2 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | ledger `180→181`，head=`20260823000100_r1_live_school_year_periods`，checksum=`31441a83…9d67`；2025 学年 active/春季 current，春季=`2026-02-01～2026-06-29`；2026 学年 planning，四周期日期为空，promotion=0。生产班级/课次/报名/点名=`1/15/1/0`，三类对象秋季归属=`1/15/1`，学生仍为五年级；active manifest/entry/protected/purge=`1/8/8/0` 且 hash 有效；Storage=`8/123602`。应用 current/previous=`20260822-181331` / `b899942…` 与 `20260822-162416` / `6dfb3af…`；service、loopback/Caddy/公网 health、zh/en login 和匿名 schedule 重定向均通过，新 release 后 `operational_errors` 增量=0 |
| `commit_sha`, `migration_head`, `environment` | `b8999422a217ecf83064bd9f02521a751d23f692`；`20260823000100_r1_live_school_year_periods`；本机隔离 Supabase + Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | 写前/事务后置/独立 postflight 对班级、课次、报名除 `term_id` 外的行摘要和全部学生行摘要做等值断言；班级状态、教师、课次时间、时长、报名状态和学生年级不变。学年激活事件=0、升年级记录=0；未创建或修改账号、岗位、manifest、点名或 Storage |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-23 生产 preflight；`2026-08-23T02:16:29+08:00` 前完成独立 postflight；Codex；`swingislee`（确认春季结束日并采用该学年方案） |
| `command_or_runbook` | LF 规范化 migration hash → 生产 `REPEATABLE READ READ ONLY` preflight → serializable 完整回滚演练 → 新连接回滚核查 → 相同事务正式提交/账本登记 → 独立只读函数、权限、业务、年级、manifest、Storage postflight → `publish-mathin-xiaomi.ps1 -Action Publish/Status` → 公网 health、zh/en login、匿名 schedule 重定向；无清理、无学年启用、无升年级 |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260823000100_r1_live_school_year_periods.sql`，LF 规范化 SHA-256 `31441a83a802b35e4c6937f68d9418b58510a88343b6fad646f65761e7019d67`；Git commit `b8999422a217ecf83064bd9f02521a751d23f692`；Xiaomi `/home/swing/services/mathin/releases/20260822-181331/release.json` |
| `retention`, `access_roles`, `failure_ticket` | migration、Git 与 immutable release 按既有策略保留；仓库维护者/Xiaomi 运维角色；首次 owner 差异由同一事务归一并以零漂移回滚证据关闭，`BUG-R1-LIVE-005` 已关闭 |

### 日常运营体验收敛与备课提醒窗口证据

产品负责人在生产试用中确认学年方案达标，并要求继续收敛班级管理命令区、下拉/日期控件、备课提醒、通知描述和绘图工具栏。实现使用 shadcn `Calendar` + `Popover` 组成共享日期/时间控件并替换业务表单中的原生 date/time/datetime-local；共享 Select 增加站点配色与悬浮反馈；班级详情把标签与动作合并为同一命令区；通知 fallback 显示事件类型和首个可读 payload 细节；共享绘图工具栏可向下收起，备课工具栏进入翻页工作区。migration `20260823000200_r1_live_preparation_attention_window` 将备课工作项设为开课前 14 天可见、前 7 天到期，逾期后向主管投影；课后备课提交在课次页标为“补交”。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 2` 支撑项；日常运营体验与备课提醒；实现、数据库和部署子项 `PASS`，逐项产品验收进行中，Gate 2 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | ledger `181→182`，head=`20260823000200_r1_live_preparation_attention_window`，LF checksum=`8014261e…6efff4`；函数新旧签名各 1 个，owner=`supabase_admin`，anon execute=false、authenticated=true。生产未完成课次=15，`T+14` 内=1、`T+7` 内=0、已开始=0；当前教师与管理员的备课投影均由 15 条变为 1 条，`due_at=scheduled_at-7 days`。班级/课次/报名/点名=`1/15/1/0`，active manifest/entry/protected/purge=`1/8/8/0`；应用 current/previous=`20260822-193605` / `5041fe1…` 与 `20260822-185849` / `3fa5919…`，发布后 `operational_errors` 增量=0 |
| `commit_sha`, `migration_head`, `environment` | `5041fe1cfd6352e1a70cfb05559bf3b5ae530205`；`20260823000200_r1_live_preparation_attention_window`；本机隔离 Supabase + Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | 生产 migration 前后班级/课次/报名/点名保持 `1/15/1/0`，manifest 保持 1 个 active、8 条 protected、0 条 purge；未创建或修改账号、岗位、班级、课次、报名、点名或 Storage，只更新函数定义和 migration 账本 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-23；Codex 实现、验证和发布；`swingislee`（提出六项生产试用反馈并明确 shadcn-ui 日历约束） |
| `command_or_runbook` | 定向 ESLint、`pnpm typecheck`、`pnpm messages:check`、5 个文件/36 项相关 Vitest；本机隔离 migration 编译与函数断言；生产只读 preflight → owner 核对 → fail-closed 事务部署/账本登记 → 独立只读 postflight → `publish-mathin-xiaomi.ps1 -Action Publish`。按产品要求未增加 Playwright、历史 179 项或全量 621/625 项回归 |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260823000200_r1_live_preparation_attention_window.sql`，LF 规范化 SHA-256 `8014261e4c348b12719053371acf10ffd0c2fece10afd110850497ac6e6efff4`；Git commit `5041fe1cfd6352e1a70cfb05559bf3b5ae530205`；Xiaomi `/home/swing/services/mathin/releases/20260822-193605/release.json` |
| `retention`, `access_roles`, `failure_ticket` | migration、Git 与 immutable release 按既有策略保留；仓库维护者/Xiaomi 运维角色；PowerShell 客户端替换与函数 owner 两次失败均在提交前停止或事务回滚，独立 postflight 证明无部分写；产品人工验收按一次一项继续 |

### 生产正式管理员身份引导与原子交接证据

2026-08-15，产品负责人明确指定 Xiaomi 上唯一非固定 Gmail 身份为未来正式管理员，并要求先改为 staff、本人绑定 MFA 后再做 admin 原子交接。写前脱敏核查确认目标恰好 1 个、当前为 active student、无学生档案/监护关系/staff 岗位、MFA=0；现有 active admin 恰好 1 个且 verified MFA=1。首次调用现有 `admin_set_identity` RPC 被 `20260728000400_r1_account_security.sql` 重定义的 profile 保护触发器拒绝，事务整体回滚；随后按用户明确授权通过受信任 PostgreSQL 管理连接直接更新这一行，事务同时锁定目标并重复全部前置/后置断言。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；正式管理员候选身份引导；staff 子步骤 `PASS`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | `candidate_count=1`；`student→staff` 恰好 1 行；active/account_status 不变；student/guardian/staff-role 关联均为 0；候选 MFA=0；active admin=1、verified admin MFA=1。阈值为目标唯一、只改 role、零附带授权、现有 admin/MFA 不变，全部满足 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `ebdb044603d69ad9052420707611cfcf23711d79`；操作时生产 head `20260814000300_p6_six_classroom_cleanup`；Xiaomi / production |
| `dataset_manifest` | auth user 总数仍为 12；profile 分布由 admin 1/staff 6/student 3/parent 2 变为 admin 1/staff 7/student 2/parent 2；目标 UUID SHA-256 `aa21999cfdc116f1846b205e6d83e2e679e91b88014ded573d60dd7366241f8e`，email SHA-256 `cbe8df0d0869c63c8a27be2ecfa35e36255a22c4292bff89bfe5e06a7fddad4a`；仓库不记录原值 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；profile `updated_at=2026-08-14T22:24:21.158Z`；Codex；`swingislee`（对话明确要求“先将该账号标记为职员”） |
| `command_or_runbook` | Xiaomi `supabase-db` 容器内 PostgreSQL；脱敏只读 preflight → fail-closed 单事务 role update → 脱敏 postflight；未触碰 auth identity、密码、session、staff-role 或业务表 |
| `artifact_url_or_path`, `artifact_hash` | 本节 Git 证据；`not_applicable`（不保存含 PII 的原始 SQL 输出） |
| `retention`, `access_roles`, `failure_ticket` | 候选身份永久保留并在 manifest 激活后纳入 protected 清单；产品/运维/安全；`BUG-R1-LIVE-001` 的生产 migration 已部署，真实调用证据仅在合法顶层身份变更时补录 |

本人完成 MFA 后，先以只读查询确认目标 verified factor 恰好为 1、仍为 active staff、现有 active admin 恰好为 1，再按此前“提权为生产库 admin”的明确授权执行一次性原子交接。单个受信任 PostgreSQL 事务锁定两个 profile，以同一条受保护更新把目标提升为 admin、把原固定开发 admin 降为 staff，并在提交前断言角色、MFA、岗位和 admin 总数；任一断言失败都会整体回滚。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；正式管理员 MFA 与原子交接；数据库子步骤 `PASS`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 目标 verified MFA=1；恰好 2 个 profile 角色行参与 `staff/admin` 对调；提交后目标为 active admin，原固定开发 admin 为 active staff；admin=1、active admin=1；双方 staff-role 均为 0。阈值为目标 MFA verified、只交换两个顶层角色、任一提交态唯一 admin、零附带岗位，全部满足 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `e6ed987c849bcdfda6ebbf89a8e7850a51b87c95`；操作时生产 head `20260814000300_p6_six_classroom_cleanup`；Xiaomi / production |
| `dataset_manifest` | auth user 总数仍为 12；profile 分布保持 admin 1/staff 7/student 2/parent 2；staff-role 绑定总数仍为 8。正式管理员 UUID SHA-256 `aa21999cfdc116f1846b205e6d83e2e679e91b88014ded573d60dd7366241f8e`、email SHA-256 `cbe8df0d0869c63c8a27be2ecfa35e36255a22c4292bff89bfe5e06a7fddad4a`；原固定开发管理员 UUID SHA-256 `fb8e182eb5dd55fb0dff11299dbc9e28cb375131d53f8f355ef99a52d1b45e48`、email SHA-256 `157d40c2b2389d34af03c8e44e9106b28c127e94acf493e776d063d35a80cc54`；仓库不记录原值 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；两个 profile `updated_at=2026-08-15T03:31:45.510Z`；Codex；`swingislee`（此前明确要求“将这个账号设置为生产库正式管理员账号”，本轮确认“已启用 MFA”） |
| `command_or_runbook` | Xiaomi `supabase-db` 容器内 PostgreSQL；脱敏只读 MFA/角色 preflight → fail-closed 两行原子 role swap → 脱敏 postflight；未触碰 Auth identity、密码、MFA factor、session、staff-role 或业务表 |
| `artifact_url_or_path`, `artifact_hash` | 本节 Git 证据；`not_applicable`（不保存含 PII 的原始 SQL 输出） |
| `retention`, `access_roles`, `failure_ticket` | 正式管理员身份永久保留并在 manifest 激活后纳入 protected 清单；产品/运维/安全；`BUG-R1-LIVE-001` 的生产 migration 已部署，真实调用证据仅在合法顶层身份变更时补录 |

#### 日常身份角色管理兼容修复

`20260815000200_r1_profile_role_update_guard.sql` 把 `app.allow_profile_role_update=1` 只恢复给受信任 role 变更；即使旁路存在，privacy consent、account status/lock 等其他保护字段仍拒绝。隔离库以真实 `request.jwt.claim.role=authenticated` 验证三条路径：本人直接改 role 被拒绝、role 旁路夹带 account status 被拒绝、管理员 `admin_set_identity` 修改另一账号 role 成功并在同一回滚断言中恢复。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；`BUG-R1-LIVE-001` 仓库、隔离库与生产 schema 修复；migration 部署子步骤 `PASS`，真实授权目标 RPC 验收 `pending`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 前向 migration 1/1；直接 role 更新拒绝、旁路修改非 role 字段拒绝、管理员 RPC role 往返成功；临时空库 182 个输入从零重放并通过断言；R1 Vitest 23 文件 179/179。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `0c98ec5`；本机/仓库/当前生产 head `20260815000200_r1_profile_role_update_guard`；`mathin-isolated-loopback` + 明确命名临时空库 + Xiaomi / production |
| `dataset_manifest` | 本机主隔离库应用后 `schema_migrations=176`；auth user=11；profile 为 admin 1/staff 6/student 2/parent 2；staff-role=8；active protection manifest=0；学生/班级/课次/报名/点名均为 0；断言事务回滚，计数无漂移；临时验证库结束后存在数=0 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；2026-08-15（Asia/Shanghai）；Codex；`swingislee`（“继续 R1-live”） |
| `command_or_runbook` | 本机 Docker `supabase-db` 前向 migration + `r1_account_security_assertions.sql`；临时空库 bootstrap→179 migrations→seed/fixture→同一断言→删除；`pnpm r1:test`、`pnpm lint`、`pnpm typecheck` |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260815000200_r1_profile_role_update_guard.sql`；规范化文本 SHA-256 `45cbdf54ac5bc0ef30ad81d08bc72f1400fb6241ec02869b4800ef2bc215888f` |
| `retention`, `access_roles`, `failure_ticket` | migration/tests 随 Git 永久保留；仓库维护者；`BUG-R1-LIVE-001` 已完成生产部署，真实生产调用只在合法顶层身份变更时取证，不阻塞当前闭环 |

### 两个 R1-Live migration 的生产部署证据

用户明确授权仅向 Xiaomi 依次部署 `20260815000100` 和 `20260815000200`，并把部署后权限限定为只读核查迁移账本、函数定义、对象计数及 `active manifest=0`。写前发现生产 head 已是仓库内的 `20260814000300_p6_six_classroom_cleanup`；部署暂停，直至只读确认其 checksum 与仓库一致、应用时间早于当前 release，并把 175 条账本和匿名计数固定为真实 preflight 基线。

两个 migration 在一个 `REPEATABLE READ` 事务中依序执行。事务内重复断言数据库指纹、前驱 checksum、目标 migration 缺失、manifest 表缺失、管理员/MFA、角色分布和全部匿名计数；DDL 后断言 RLS/API 权限、函数权限、role guard、manifest/entry/active 均为 0，且匿名计数无变化，最后才写入两条 ledger。独立新连接只读 postflight 再将生产 14 个相关函数定义与本机隔离库逐项比较。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | 历史 `R1-Live Gate 1/3`（现归 Gate 1）；生产 schema/函数与 migration ledger；该子步骤 `PASS` |
| `measured_value`, `threshold` | ledger 175→177，head=`20260815000200_r1_profile_role_update_guard`；仓库 migration 缺失=0，生产仅多已知历史短名 `20260726000100`；14/14 个函数定义与隔离库一致；两张表 RLS/权限及两个 trigger 正确；manifest=0、entry=0、active=0。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | migration 源提交 `4b993e4`；生产 head `20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth user=12、profile=12（admin 1/staff 7/student 2/parent 2）、verified active admin MFA=1、staff-role=8、学生=4、班级/课次/报名/点名=0、课程族=2、课程=102、讲次=1315、release=2633、Storage bucket=8/object=123602；无账号或业务数据漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；ledger `applied_at=2026-08-15T04:29:29.801512Z`；Codex；`swingislee`（对话逐字授权两个 migration 与只读 postflight） |
| `command_or_runbook` | Xiaomi `supabase-db`：只读 preflight → 单事务 DDL/ledger + fail-closed 前后断言 → 独立只读 postflight → 与 `mathin-isolated-loopback` 函数摘要比对；未调用角色写 RPC 或 purge |
| `artifact_url_or_path`, `artifact_hash` | `20260815000100` 规范化 SHA-256 `55c279a9eefe677ed65eb55f0ed022501599acb63282475a8ec1dfd284d710b4`；`20260815000200` 规范化 SHA-256 `45cbdf54ac5bc0ef30ad81d08bc72f1400fb6241ec02869b4800ef2bc215888f`；大日志不入 Git |
| `retention`, `access_roles`, `failure_ticket` | 去标识化摘要随 R1-Live 证据永久保留；产品/运维/安全；`BUG-R1-LIVE-001` 已部署，真实生产调用只在合法顶层身份变更时取证；正式 manifest 激活见下一节 |

### 首份 protected-only manifest 激活证据

按 doc 04 当前 Gate 已冻结的保护范围和产品负责人 standing execution direction，只读盘点确认唯一正式 admin 仍为 active 且 verified MFA=1，两个现有课程族均为 `purpose=production/status=enabled`，课堂相关表均为 0。草案只含正式 admin 的 `auth_user`/`profile` 与两个课程族根，共 4 个 `protected`、0 个 `purge_allowed`；其余 11 个账号、4 个学生和 2 条监护关系保持未分类，既不进入正式清单，也不构成删除授权。

精确 artifact 先上传到 Xiaomi 受控目录并校验 hash/mode，再用同一份条目执行完整激活事务并最终 `ROLLBACK`。独立连接确认回滚后 manifest/entry/active 仍为 0，随后重复同一 fail-closed 事务正式提交。新连接 postflight 复核 header、目标指纹、审批引用、条目类型/数量/hash、正式 admin/MFA、课程族实时计数、不可变约束、两个 purge 候选列表和全部匿名计数。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | 历史 `R1-Live Gate 1/3`（现归 Gate 1）；生产正式对象保护；现有对象 manifest 子步骤 `PASS` |
| `measured_value`, `threshold` | manifest=1、entry=4、active=1；`auth_user=1`、`profile=1`、`course_family=2`；`purge_allowed=0`；purgeable classroom/course family 均为 0；回滚演练和正式提交均通过，阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `f72ec3c`；生产 head `20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth/profile=12、staff-role=8、学生=4、监护关系=2、课程族=2、目录版本=3、课程=102、讲次=1315、release=2633、班级/课次/报名/点名=0、Storage bucket=8/object=123602；无账号或业务数据漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；`activated_at=2026-08-15T04:58:53.641463Z`；Codex；`swingislee`（standing execution direction：计划内步骤直接推进，每轮自检，需产品输入/人工测试时再停） |
| `command_or_runbook` | 去标识化只读盘点 → 精确 artifact 受控保存 → 完整激活事务 `ROLLBACK` → 独立零状态核查 → 同一 fail-closed 事务提交 → 新连接 postflight；未调用 purge、未创建/修改账号、未写业务表 |
| `artifact_url_or_path`, `artifact_hash` | Xiaomi `/home/swing/services/mathin/evidence/r1/r1-live-protected-only-manifest-3cd327ac685f81182fad403519bf1bbf7075f1feb434638d8ae71bd1e06e0102.json`，mode `600`，owner/group `swing`；artifact SHA-256 `3cd327ac685f81182fad403519bf1bbf7075f1feb434638d8ae71bd1e06e0102`；条目集 SHA-256 `e62d27094fa63c91d5fa57669e1a06a006b733fb3478cd276266c8553b582514`；manifest ID 只登记 SHA-256 `e691e3c2b557ae6ce262751969d63a758ec535cfca0314624da2170fffe7d832` |
| `retention`, `access_roles`, `failure_ticket` | 精确 artifact 在 Xiaomi 受控目录保留到 manifest retired 后再按运维策略归档；`swing` 运维账号、产品/安全审核角色；`not_applicable` |

### 首名真实教师邀请注册证据

正式管理员通过 `/zh/dashboard/account-support` 生成邮箱绑定的一次性员工邀请，首名真实教师在 `/zh/signup` 自行完成注册。用户报告注册完成后，Agent 只通过 Xiaomi 管理连接执行 `REPEATABLE READ READ ONLY` 事务；查询只输出数量、布尔值、时间和 UUID 的 SHA-256，不读取或保存邮箱、邀请码、密码或会话。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；首名真实教师身份；邀请/注册子步骤 `PASS`；该次快照时岗位尚未分配，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | accepted invitation=1、pending invitation=0、最新 accepted 候选=1；邀请邮箱与 Auth identity 匹配；email confirmed=true；profile=`staff`/active；consent=2；staff-role=0；学生档案=0、监护关系=0。阈值为邀请唯一消费、账号状态正确、无意外业务身份或岗位，全部满足 |
| `commit_sha`, `migration_head`, `environment` | 生产应用 `023f5167…`；head=`20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | auth/profile=13；profile 为 admin 1/staff 8/student 2/parent 2；staff-role=8；active admin=1、verified active admin MFA=1；active manifest=1/entry=4，新教师 active coverage=0；班级/课次/报名/点名=0 |
| `started_at`, `finished_at`, `actor`, `approver` | 邀请生成时间不进入仓库；`accepted_at=2026-08-15T07:08:59.460913Z`；首名真实教师；`swingislee`（正式管理员邀请并在对话确认“新老师已注册”） |
| `command_or_runbook` | 生产 `/signup` 正式注册路径；随后 Xiaomi `supabase-db` 去标识化只读事务核查 fingerprint、ledger、邀请、Auth/profile、岗位、manifest coverage 与业务计数；未修改账号、岗位、manifest 或业务数据 |
| `artifact_url_or_path`, `artifact_hash` | 本节 Git 摘要；教师 UUID SHA-256 `38e6b6e359bdae69e27a142bf7e94f50df0d12391fc3938bb6a787d73f9ba5f1`；不保留含 PII 的原始查询输出 |
| `retention`, `access_roles`, `failure_ticket` | 去标识化摘要随 R1-Live 证据永久保留；产品/运维/安全；`not_applicable` |

### 首名真实教师岗位与 replacement manifest 证据

正式管理员在生产 UI 为首名教师分配岗位后，去标识化只读核查发现岗位集合为 `research` 与 `teacher`。产品负责人明确确认该双岗位为有意设置；两条 active 成员关系均由唯一正式管理员授予，目标 profile 仍为 active `staff`。这一事实不被简化为单一 teacher 岗位，也没有据此推断其他账号为正式或可清理对象。

Agent 按 doc 04 的 standing execution direction 生成包含原 4 个 protected 条目及教师 auth/profile/两条岗位成员关系的 8 条目 replacement artifact。正式写前校验目标指纹、migration head、唯一 admin/MFA、教师身份/岗位、旧 active manifest、完整匿名基线、artifact 规范化 hash、mode/owner 和 `purge_entry_count=0`；同一 SERIALIZABLE 事务先完整执行并 `ROLLBACK`，独立连接确认旧 manifest 仍为唯一 active 且数据零漂移，再重复同一 fail-closed 事务正式提交。提交事务原子插入新 header/条目、将旧 header 转为 `retired` 并激活新版本；新连接 postflight 再次验证 resolver、不可变约束、教师 coverage、全部对象计数和两个空候选列表。未创建或修改账号、岗位或业务数据，未加入准删条目，也未执行清理。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | 历史 `R1-Live Gate 1/3`（现归 Gate 1）；首名真实教师岗位与正式对象保护；该子步骤 `PASS` |
| `measured_value`, `threshold` | 岗位集合精确为 `research`、`teacher`；manifest header=2、active=1、retired=1；active entry=8：`auth_user=2`、`profile=2`、`course_family=2`、`staff_role_member=2`；教师 active coverage=4；`purge_allowed=0`；两个 purge 候选列表为空。回滚演练、独立回滚核查、正式提交和独立 postflight 全部通过 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `30d02d0`；head=`20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth/profile=13、staff-role=10、学生=4、监护关系=2、课程族=2、目录版本=3、课程=102、讲次=1315、release=2633、班级/课次/报名/点名=0、Storage bucket=8/object=123602；profile 为 admin 1/staff 8/student 2/parent 2；无身份、岗位或业务计数漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-17（Asia/Shanghai）；2026-08-17（Asia/Shanghai）；正式管理员完成岗位分配 / Codex 完成 replacement；`swingislee`（确认“双岗位是特意设置的，忽略，继续”及既有 standing execution direction） |
| `command_or_runbook` | 去标识化岗位/preflight → 精确 artifact 受控保存 → replacement 激活事务 `ROLLBACK` → 独立旧状态核查 → 同一 fail-closed 事务提交 → 新连接 postflight；只通过仓库 `textFileSha256` 规则在目标机输出摘要，不导出含 UUID 的 artifact |
| `artifact_url_or_path`, `artifact_hash` | Xiaomi `/home/swing/services/mathin/evidence/r1/r1-live-protected-only-manifest-219e7536c1a7769b40a81f619083f66c0ee8069021a64d697b47415c4c6bfdb3.json`，mode `600`，owner/group `swing`；artifact SHA-256 `219e7536c1a7769b40a81f619083f66c0ee8069021a64d697b47415c4c6bfdb3`；条目集 SHA-256 `d188085fd5c3ff99cd7da5586e8c46e3dbfe542e929883a45c9560f5978ad606`；active manifest ID 只登记 SHA-256 `f0b0e760968ce0dbcabc27efbc920c59410dee1d6bf4eac57b1aeec2cd8c095a` |
| `retention`, `access_roles`, `failure_ticket` | active artifact 在 Xiaomi 受控目录保留；旧 artifact 与 retired header 继续按不可变历史保留；`swing` 运维账号、产品/安全审核角色；`not_applicable` |

## 首个真实闭环选择

选择整班点名，原因如下：

1. 它是教师真实课堂的第一项持久动作，业务价值明确。
2. 写入合同小：每名学生一条 `(session_id, student_id)` 事实，四态枚举，重复保存走 upsert。
3. 权限边界已明确编码：教师需 `attendance.mark` 且本人任教或有全校范围；admin 恒可；其他主体受 RLS 拒绝。
4. 点名保存与开课解耦，教师可按课堂实际在课前、课中或课后登记；未点名只显示提醒。
5. 它不要求先完成整个备课、课程发布、成果、家长、公开内容或 3D 链路。

### 完整运行步骤

1. 正式教师从 `/zh/login` 登录。
2. 从 `/zh/dashboard/classes` 找到分配给自己的 `purpose=production` 班级。
3. 从班级页打开真实课次，进入 `/zh/classroom/{classId}/session/{sessionId}/live`。
4. 打开点名对话框，为全部在册学生选择 `present / absent / late / leave` 并保存。
5. 刷新页面，重新打开点名对话框，核对每条记录仍标记为已登记。
6. 退出并重新登录，再次打开同一课次并核对记录。
7. 正式管理员打开同一课次或对应学生学习记录，核对可见。
8. 退出登录后直接访问，页面/查询必须拒绝；若目标已有未分配 staff、其他班教师、学生或家长，再对该现有主体验证拒绝，不为负向测试临时创建正式账号。

### 手机号/password P0 本机候选证据

本增量把登录与注册表单统一为“手机号或邮箱 + password”，手机号注册只接受主管为该号码创建的一次性员工邀请。应用通过受信 Admin API 创建可使用 password 的手机号账号，但不启用 `SMS_AUTOCONFIRM`，并在独立保障表中明确记录“员工邀请见证、provider 未验证”；通用邀请码继续只允许邮箱注册。隔离验证没有创建或保留手机号测试账号。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 2`；内部教师手机号/password P0；本机候选 `PASS`，生产部署与真实教师验收 `BLOCKED` |
| `measured_value`, `threshold` | migration 回退演练 1/1、正式本机应用 1/1；账户安全 SQL 定向断言通过并回滚；身份合同 Vitest 2 文件 9/9；typecheck、双语 messages、数据库类型和 plan audit 均通过；本机 Auth `phone_enabled=true`、`phone_autoconfirm=false`。阈值为邀请精确绑定、无 OTP/全局手机号注册、无持久测试身份、email rollback 路径保留，全部满足 |
| `commit_sha`, `migration_head`, `environment` | `9e0dafb`；`20260825000600_r1_live_phone_password_auth`；本机 `mathin-isolated-loopback`，非 Xiaomi |
| `dataset_manifest` | 本机应用前后均为 auth user=11、profile=11、staff invitation=0、identifier assurance=0；migration ledger=191；断言事务回滚，无账号或业务数据漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-25（Asia/Shanghai）；2026-08-25（Asia/Shanghai）；Codex；`swingislee`（将手机号/邮箱 password 登录列为 P0） |
| `command_or_runbook` | 本机 Docker PostgreSQL migration 回退演练→正式应用→只读 postflight；`r1_account_security_assertions.sql`；身份合同定向 Vitest；`pnpm typecheck`、`pnpm messages:check`、`pnpm db:types:check`、`pnpm plan:audit`；未运行 Playwright、全量回归或生产写入 |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260825000600_r1_live_phone_password_auth.sql`；规范化文本 SHA-256 `01b89098cb4fddb155a26e98f38fc33072fbe2e9b553b6a491b7fc77ec495133` |
| `retention`, `access_roles`, `failure_ticket` | migration、测试与 Git 随仓库永久保留；仓库维护者；生产仍为 `LIVE-P0-04`，完成精确发布和真实教师验收后关闭 |

### 手机号/password P0 生产部署证据

产品负责人逐字授权只向 Xiaomi 部署 migration `20260825000600`、打开 phone password provider、保持 SMS auto-confirm 关闭、仅重建 Auth，并发布热修 `8ec0ba0`；明确禁止创建账号、邀请或业务数据。执行前再次核对数据库指纹、应用基线、Auth 开关、迁移 head/checksum 与匿名计数；migration 先完整执行并 `ROLLBACK`，独立确认零残留后再以同一 SERIALIZABLE 事务正式提交。Auth 配置原子修改并留存 owner-only `.env.before`，`run.sh recreate auth` 使用 `--no-deps`，数据库容器 ID 前后相同。热修从生产 commit `9bc9ff3` 单独切出，不包含后续课堂开发；本批次只运行一次正式 lint/typecheck/local build 与 Xiaomi production build，再原子切换 release。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 2`；内部教师手机号/password P0；`DEPLOYED / PENDING USER ACCEPTANCE` |
| `measured_value`, `threshold` | migration 回滚演练、独立零状态核查、正式事务和独立 postflight 均通过；ledger `190→191`，checksum=`01b89098…5133`；Auth `phone=false→true`、SMS auto-confirm 始终 false，只重建 Auth 且数据库容器未变化；current/previous=`8ec0ba0…` / `9bc9ff3…`。zh/en 登录、zh 注册、旧 phone route 307、Auth settings、匿名 `validate_registration_access_v2` RPC、loopback/Caddy/公网 health 均通过；`operational_errors` 保持 1949 |
| `commit_sha`, `migration_head`, `environment` | production hotfix `8ec0ba01ef74d503ff89138cd05da395b096228e`（本地主线实现 `9e0dafb`）；`20260825000600_r1_live_phone_password_auth`；Xiaomi / production，数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth user=14、phone user=0、profile=14、staff invitation=1（既有 accepted email 1）、identifier assurance=0；全部班级/课次/报名/点名=`3/16/1/0`，active manifest=1，错误=1949；未创建账号、邀请、业务数据或 Storage 对象 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-25（Asia/Shanghai）；release `builtAt=2026-08-25T04:12:14Z`；Codex；`swingislee`（逐字授权本 migration、Auth-only 重建和 commit `8ec0ba0`，并禁止账号/邀请/业务写入） |
| `command_or_runbook` | 即时只读 preflight → migration hash/mode 核对 → SERIALIZABLE 完整回滚演练 → 独立零状态核查 → 同一正式事务/账本登记 → 独立 schema/计数 postflight → `.env` 原子修改与 Auth-only recreate → production lint/typecheck/local build + Xiaomi build/原子切换 → 双语 HTTP/Auth/RPC/数据库只读 postflight；未运行 Playwright、全量 Vitest 或账号登录造数 |
| `artifact_url_or_path`, `artifact_hash` | Xiaomi `/home/swing/services/mathin/releases/20260825-041101/release.json`；Auth 回退配置 `/home/swing/services/supabase-project/deployment-backups/20260825T040901Z-phone-password-provider/.env.before`；migration 规范化 SHA-256 `01b89098cb4fddb155a26e98f38fc33072fbe2e9b553b6a491b7fc77ec495133` |
| `retention`, `access_roles`, `failure_ticket` | Git、migration、immutable current/previous 与 owner-only Auth 配置备份按既有策略保留；仓库维护者/Xiaomi 运维角色；`LIVE-P0-04` 待真实教师手机号注册/login 后关闭 |

### 统一账号中心第一阶段生产部署证据

产品负责人逐字授权向 Xiaomi 部署 migration `20260825000800_account_center_profile` 与精确应用提交 `72d8127`，允许为既有 profile 增加默认 `preferred_locale=zh`、创建空头像 bucket/RLS 和文件治理规则，禁止创建账号、身份、岗位、业务数据或 Storage 对象。写前 scope diff 发现较早候选 `9b2cf53` 会夹带尚未获准的课堂增量，因此在任何生产写入前停止；最终 release 从生产基线 `8ec0ba0` 只选取账号中心 11 个文件。migration 首次以错误 owner 执行时在替换既有函数前失败并自动回滚，独立核查为零残留；随后以函数 owner `supabase_admin` 完整执行并回滚、再次零残留核查后，才以相同事务正式提交。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `POST-LIVE-AUTH-01` 第一阶段；统一账号中心；`DEPLOYED / PENDING USER ACCEPTANCE` |
| `measured_value`, `threshold` | ledger `191→192`，head/checksum=`20260825000800_account_center_profile` / `564b2909…c37`；14/14 个既有 profile 为默认 `preferred_locale=zh`；头像 bucket=`1`、bucket object=`0`、Storage policy=`3`、文件策略=`1`。current/previous=`20260825-072801` / `72d8127…` 与 `20260825-041101` / `8ec0ba0…`；service active，loopback/Caddy/公网 health 为 production `ok`，zh/en login=200，匿名账号中心精确 307 到登录页；错误仍为 1949 |
| `commit_sha`, `migration_head`, `environment` | `72d812727121c112ceaa3ab3fd935016473e48ad`；`20260825000800_account_center_profile`；Xiaomi / production，数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth user/profile/phone user=`14/14/0`、staff-role/invitation/identifier assurance=`11/1/0`、学生/班级/课次/报名/点名=`5/3/16/1/0`、Storage object/managed file=`123602/5`、active manifest/entry/protected/purge=`1/8/8/0`；仅 bucket 总数按授权 `8→9`，新 bucket 为空 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-25（Asia/Shanghai）；release `builtAt=2026-08-25T07:29:16Z`；Codex；`swingislee`（逐字授权本 migration、空 bucket/RLS/文件治理和 commit `72d8127`） |
| `command_or_runbook` | 只读目标/备份/release/账本/对象计数 preflight → 精确候选 scope diff → migration 失败自动回滚与独立零残留核查 → owner 对齐后的完整回滚演练/独立核查 → 正式事务/账本登记 → 精确 Git archive 的 Xiaomi production build/原子切换 → HTTP、schema、对象计数、错误和 manifest 只读 postflight；未运行 Playwright、全量回归或生产账号旅程 |
| `artifact_url_or_path`, `artifact_hash` | Xiaomi `/home/swing/services/mathin/releases/20260825-072801/release.json`；migration 规范化 SHA-256 `564b290997cee8e2e4599530f2380acda879129783f9e4396323b7e44f25dc37`；部署 archive SHA-256 `2af10cd0390ff3c7cbe6ab4e057e56b98ae7a8bf843707f100e43f6d01a0fc76` |
| `retention`, `access_roles`, `failure_ticket` | migration、Git 与 immutable current/previous 按既有策略保留；仓库维护者/Xiaomi 运维角色；页面布局、固定二级导航和滚动容器待产品人工验收 |

### 代码、数据和权限位置

| 范围 | 位置 | 当前判断 |
| --- | --- | --- |
| 正式员工注册 | `src/features/account/AccountSupportPanel.tsx`、`src/features/account/actions.ts`、`src/app/[locale]/(auth)/actions.ts`、迁移 `20260825000600_r1_live_phone_password_auth.sql` | 生产已支持绑定邮箱或手机号的一次性员工邀请；注册后身份为 `staff`，仍需分配 teacher role。手机号真实注册/login 尚待验收。邮箱/手机号/password、验证码与微信/QQ 的唯一账号合同见 [`r1-live-auth-identities.md`](../../plan/r1-live-auth-identities.md) |
| 教师入口 | `src/app/[locale]/dashboard/classes/**`、`src/app/[locale]/dashboard/sessions/[sessionId]/page.tsx`、课堂 live route | 本机固定教师已完成 live 点名和课后页再读；缺正式目标 E3 |
| 点名 UI/action | `src/features/school/AttendanceDrawer.tsx`、`src/features/school/actions/attendance.ts` | 读取失败显示 action failed；写入使用 zod 和 upsert；本机写态/再读通过，缺真实目标 E3 |
| 点名事实 | `public.session_attendance` | 主键防重复；触发器写 `marked_by/marked_at`；note 最长 500 字符由 action 限制 |
| RLS | 迁移 `20260709000700_school_attendance.sql` | admin、授权本班教师/全校 staff 可读写；可访问学生档案的员工可读；学生/家长只经裁剪 RPC 读本人/孩子 |
| 开课提示 | `src/features/classroom/actions.ts`、课堂 live page、`src/features/classroom/live/LiveShell.tsx` | 点名、资源预载和 release 准备状态保持可见，但不再作为开课服务端门 |
| 当前自动化 | `tests/r1-classroom-continuity.test.ts`、`e2e/school-portals.spec.ts`、`e2e/r1-live-golden-path.spec.ts` | 源码合同和 loopback 固定账号写态均通过；不能替代正式目标真实数据闭环 |

## 真实正式账号与数据路径

1. 先记录目标的前端域名、Supabase project/database 指纹、Storage namespace、部署 commit 和环境责任人。
2. **邮箱路径已完成，手机号路径已部署待验收**：正式管理员已为首名真实教师邮箱生成一次性员工邀请码并通过受控渠道交付；手机号绑定员工邀请与 password 登录现已在 Xiaomi 启用，但尚未创建真实手机号邀请或账号。
3. **注册与岗位已完成**：教师已在 `/signup` 自行注册；正式管理员分配的 `research` 与 `teacher` 双岗位均有效，现有 active manifest 已保护该身份。教师的 production password 登录与授权范围仍在后续人工闭环中核对。邮箱、手机号、微信和 QQ 最终都绑定同一 `auth.users.id`，不得为登录方式复制 profile。
4. **花名册/报名已有首条事实**：生产只读核查确认现有班级已有 1 条 active 报名；学生可识别字段不进入 Git/聊天证据。
5. **建班与学年归属已完成**：管理员已使用 `/dashboard/classes/new` 创建 1 个 `purpose=production` 班级和 15 个课次；学辅可留空。班级、课次和报名现归 `2026–2027` 秋季；教师可使用 immutable release，也可冻结 `releaseId=null` 的空白/本次覆盖快照。
6. 固定开发账号继续只用于开发验证；正式教师只分配 production 班级。任何 reset、seed、rebuild 或 testdata purge 在命中目标指纹或受保护对象 manifest 时必须拒绝。

自由班可以直接启用，但不会自动生成课次。Gate 2 必须有至少 1 个可进入的真实课次，因此最小闭环可以选择一门启用中的 production 课程生成课次，或先建自由班再通过正式 UI 添加课次；不得用一次性 SQL 补造业务事实。

## 当前上线阻塞项

| ID | 等级 | 原因 | 最小修复 | 人工操作 | 验收 |
| --- | --- | --- | --- | --- | --- |
| LIVE-P0-04 | P0 | 生产能力已部署，但真实手机号邀请注册/login 尚未验收 | 无代码或部署动作 | 管理员为真实教师手机号生成一次性邀请；教师完成一次注册/登录 | 同一手机号只能消费其绑定邀请；登录进入唯一 staff profile；不发送验证码、不开放全局邀请码手机号注册 |
| LIVE-P1-03 | 核心 P1 | production 班级、15 个课次和 1 条 active 报名已建立，但还没有生产点名 Golden Path | 正式教师保存点名并刷新或重登再读，管理员与既有无权限主体作对照 | 正式教师执行一次登录与点名 | 每名在册学生恰好一条记录；再读一致；越权查询 0 泄露；P0/核心 P1=0 |

手机号/password P0 已完成生产迁移、Auth 配置、应用发布和机器 postflight；在真实教师完成手机号邀请注册/login 前仍是开放 P0。

## 上线后待办池

- 原 R1-9 的 1305 讲全量来源 inventory、Storage/H5 审计、Terms 内容/关系/SEO。
- Story 完整章节、Games/Minds/Tools/Notebook 全量发布与越权旅程。
- 104 份小王子视觉矩阵、全站 WCAG/CWV/浏览器签收。
- 全量 Playwright 写态、zh/en、跨浏览器、连续无 flaky、文件/并发/竞争矩阵。
- 全量指标、容量、监控、数据库/Storage RPO/RTO 和恢复演练。
- 14 天/5 节真实使用观察；观察从 R1-Live 开放当天开始，不作为开放前等待。
- `POST-LIVE-AUTH-01`：第一阶段统一账号中心已部署，待人工验收传统设置页布局、固定二级导航和单一滚动容器；验证码、邮箱/手机号自助绑定、微信/QQ 与完整多 identity 旅程仍在后续 provider 阶段。本轮不保存含姓名的用户截图。
- Spatial Math / 3D 增强、长期重构、财务/活动深化和更多内容。

## 下一次状态变化

- Gate 1 已在当前 PostgreSQL+Storage 同批次备份完成并独立通过可读性/SHA 复核后改为 `PASS`；当前阶段为 `R1-Live-2`。
- Gate 2 只有在同一目标完成正式教师写态、持久再读、管理员可见和越权拒绝后才能改为 `PASS`。
- 开发端新功能只有在定向机器检查、产品负责人初验、生产 preflight/发布和 postflight 分别留证后，才能把对应结论从开发提升到生产；该晋级不自动改变 Gate 2。
- 完整恢复/受控 rollback 演练、错误 release 标签、独立观察与 14 天/5 节课堂属于 Production 1.0 扩围证据，不再改变 R1-Live Gate 状态。
