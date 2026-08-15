# R1-Live · 真实教师首个可用闭环差距表

## 结论

截至 2026-08-15，`mathin.club` / `supabase.mathin.club` 的应用、数据库、Storage、compose 和部署 commit 已完成目标登记，仓库级写入口保险丝也已把 Xiaomi 固定为当前生产目标；测试造数/重建不能写入它，课程内容写入默认拒绝并使用独立受控通道。本机已建立只绑定 `127.0.0.1` 的隔离 Supabase，完成固定开发账号、登录和数据库合同验证，且没有复制或修改 Xiaomi 数据。当前提交 `023f5167f330935b4951d28a1b33a0cd28cd4fa9` 已作为仅应用发布切换到生产 release `20260814-221135`，旧 current `20260724-051318`（commit `b833c4d…`）成为 previous；服务、loopback/Caddy 健康检查及公网健康/登录/MFA 路由探针均通过。唯一非固定 Gmail 身份已按产品裁决完成 `student→staff→admin` 引导、verified MFA、唯一 admin 原子交接、新会话 MFA challenge 和生产 admin 路由验收；交接未修改 Auth identity、密码、MFA factor、session、staff-role 或业务表。`20260815000100_r1_live_object_protection_manifest.sql` 与 `20260815000200_r1_profile_role_update_guard.sql` 已在一个 fail-closed 事务中依次部署到 Xiaomi；独立 postflight 确认账本、14/14 个函数定义和匿名计数正确。首份 protected-only manifest 随后经过完整激活事务回滚演练并正式生效：manifest=1、entry=4、active=1，保护正式 admin 的 auth/profile 和两个 production 课程族根，`purge_allowed=0`，两个 purge 候选列表均为 0；受控 artifact 与数据库条目 hash 一致，账号和业务匿名计数不变。其余 11 个账号及 4 个学生记录未被推断为正式对象，也没有获得删除授权。Gate 1 仍缺首名正式教师、production role RPC 真实动作、真实班级/课次/花名册和相应替代 manifest；目标机仍没有可核验的数据库/Storage 最近备份，previous 尚未做兼容烟测或受控回退，错误记录仍缺 release 关联。因此 R1-Live 当前状态仍为 Gate 0 `PASS`、Gate 1 `BLOCKED`、Gate 2 `BLOCKED`、Gate 3 `BLOCKED`、Gate 4 `BLOCKED`。

本文件是 E0/E1 差距审阅，不是完整生产验收。2026-08-14～15 的 Xiaomi E1/E3 运行事实，以及本机隔离目标、应用/数据库发布、正式管理员交接和 manifest 激活证据见 [`r1-live-target-audit.md`](r1-live-target-audit.md)；用户提供的 `docs/plan/mathin-R1-Live-讨论稿.md` 为产品裁决输入，现行施工顺序以 doc 04 为准。

## Gate 状态表

| Gate | 当前状态 | 已完成证据 | 缺失项 | 是否阻塞 | 最小修复范围 |
| --- | --- | --- | --- | --- | --- |
| Gate 0 · 上线范围冻结 | `PASS` | doc 04 已冻结“正式教师整班点名”为首个闭环，并将旧 R1-9～18 重新分类 | 无 | 否 | 范围改变只接受产品负责人显式裁决 |
| Gate 1 · 正式身份与真实数据 | `BLOCKED` | 组合目标指纹 `799d…63e39`、部署 commit、Storage 摘要和匿名基线已登记；仓库危险写入口拒绝 Xiaomi；本机隔离 Supabase 与固定账号验证通过；唯一正式 admin 已完成 verified MFA、原子交接、新会话 MFA challenge 和 admin 路由验收；两个 R1-Live migration 已部署；首份 active protected-only manifest 保护正式 admin auth/profile 与 2 个 production 课程族根，4 个 protected、0 个 purge 条目，候选列表为空且数据零漂移；员工邀请、staff role/RLS、production/test purpose、学生/分班/课次 UI/RPC 已实现 | production role RPC 未以真实授权动作验收；无首名正式教师、真实班级/课次/花名册；未登记首个课次 release/snapshot/object；新增事实尚未进入替代 manifest | 是 | 产品负责人提供首名教师登录标识；随后走现有邀请、注册、角色、学生、班级、课次和分班路径，并随新增事实替换 active manifest |
| Gate 2 · 真实工作闭环 | `BLOCKED` | `AttendanceDrawer`、`saveAttendanceAction`、`session_attendance`、`can_mark_attendance`/`can_view_attendance`、开课前 `ATTENDANCE_REQUIRED`；`tests/r1-classroom-continuity.test.ts` 有静态合同 | 无正式目标写态运行；无保存→刷新→重登→再读、管理员可见、无权限拒绝的单条 Golden Path | 是 | 补一条聚焦 Playwright 等价链，并在正式账号/真实数据下人工完整执行一次 |
| Gate 3 · 最小生产保险丝 | `BLOCKED` | current/previous immutable release、原子切换、自动失败回退脚本、commit 元数据、服务健康和 `operational_errors` 查询位置已确认；current 已部署为 `20260814-221135` / `023f5167…`，previous 已知为 `20260724-051318` / `b833c4d…`；loopback、Caddy 与公网探针通过；两个 R1-Live migration 与 active protected-only manifest 已生效，生产 migration 集合无仓库缺失，0 个准删条目且候选列表为空 | 没有 backup timer 或可校验的数据备份；previous 未做兼容烟测或受控回退；全部 1,946 条错误缺 release；未做恢复抽查或受控错误 | 是 | 建立数据库+Storage 备份并抽查恢复，随后验证 previous rollback、注入 release 标识并定位一次受控错误 |
| Gate 4 · 真实教师独立验收 | `BLOCKED` | 无 E4 | 未选择首名教师；未进行无指导观察；P0/P1 未形成关闭记录 | 是 | 选 1 名真实教师独立执行 Gate 2，清零 P0/核心 P1，P2 入池 |

状态只允许 `PASS`、`BLOCKED`、`UNKNOWN`、`NOT REQUIRED`。Gate 3 已完成目标运行核查并得到明确失败事实，因此从 `UNKNOWN` 改为 `BLOCKED`，不能再用仓库脚本或历史演练替代当前备份与回退证据。

### 仓库 manifest 实现证据

- migration `20260815000100_r1_live_object_protection_manifest.sql` 不包含 manifest seed 或 Xiaomi 指纹，只建立表、trigger、内部校验与现有两个 purge RPC 的 fail-closed 合同；仓库 head `20260815000200_r1_profile_role_update_guard.sql` 只恢复受信任 role 更新旁路，其他 profile 保护字段继续拒绝。
- 一次性 PostgreSQL 15 先前从零重放 181 个 bootstrap/migration/seed/fixture 输入并通过 manifest 断言；加入 role guard 后又在明确命名的临时空库重放 182 个输入（179 migrations + bootstrap/seed/fixture）并通过账户安全断言，临时库随后删除。
- 14/14 份 R1 数据库断言既有基线通过；manifest/purge 定向 Vitest 为 2 个文件、17/17；当前 `pnpm r1:test` 为 23 个文件、179/179；全量 Vitest 为 92 个文件、619 项通过、1 项条件跳过；`pnpm lint`、`pnpm typecheck` 通过。
- 仓库实现阶段的数据库验证和类型生成只连接 disposable loopback 容器；之后按独立明确授权向 Xiaomi 部署两个 migration。生产部署边界、断言和只读 postflight 见下文及 [`r1-live-target-audit.md`](r1-live-target-audit.md#35-两个-r1-live-migration-的生产部署)。

### 本机隔离开发目标证据

2026-08-15 在用户明确授权后，以 Supabase 官方 self-hosted `v0.8.0`（上游 commit `241bb11c0627f2981746d37033f57dbfa81d29b0`）建立名为 `mathin-isolated` 的本机开发栈。运行文件和 secret 只保存在 gitignored 的 `.tmp/mathin-supabase-selfhosted/` 与 `.env.local`，未提交凭据；Xiaomi 全程未连接、未复制、未写入。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；开发/生产连接隔离；该子项 `PASS`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 11/11 个服务 healthy；所有已发布端口 Host IP 恰为 `127.0.0.1`；`auth.users=11`、`profiles=11`，11/11 password login 通过；全局自助注册关闭，email provider 只用于已有账号登录，phone provider 关闭。阈值为无非 loopback 发布、固定集合精确、无自助注册、无 Xiaomi/真实业务数据，全部满足 |
| `commit_sha`, `migration_head`, `environment` | `commit_sha=not_applicable`（本机运行态，仓库证据由本文件 Git 历史固定）；当前 head `20260815000200_r1_profile_role_update_guard`；Windows Docker Desktop / `mathin-isolated-loopback` |
| `dataset_manifest` | PostgreSQL 15.8；当前仓库 179 个 migration SQL；本机 ledger 176 条、head `20260815000200`；课程 84、讲次 1045、Storage bucket 8、active protection manifest 0；11 个固定开发身份/profile、8 条 staff-role；学生、班级、课次、报名、点名均为 0 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；2026-08-15（Asia/Shanghai）；Codex；`swingislee`（对话授权“允许创建隔离 Supabase”） |
| `command_or_runbook` | 官方 self-hosted Compose + 本机 override；API `127.0.0.1:35421`、数据库 `127.0.0.1:35422`、Studio `127.0.0.1:35423`、transaction pool `127.0.0.1:35429`；应用 `.env.local` 指向 API，target policy 以 development/loopback/本地数据库指纹通过；`R1_DEV_TEST_FIXTURES=1 pnpm r1:fixed-accounts`；`pnpm e2e e2e/notebook-authenticated.spec.ts --project=credentialed-chromium` |
| `artifact_url_or_path`, `artifact_hash` | `.tmp/mathin-supabase-selfhosted/docker-compose.local.yml`（gitignored 本机 artifact），规范化文本 SHA-256 `28a7db50a165e5f34cd6f9dc46cc0e47931d6597a7143a99003a8dd5a2d46653`；`scripts/ensure-r1-fixed-test-accounts.mjs`，规范化文本 SHA-256 `0e533c5c77ab635fd54405951dcb895b9aa4e66956d5da1a1b8f270fdca3804a`；本地数据库指纹 `5af56ae69b51ca0a78b9357ec4792533a6e59f0a529a9a918f6ba4c93da68d0f` |
| `retention`, `access_roles`, `failure_ticket` | 保留至隔离开发目标被明确替换；本机所有者；`not_applicable` |

仓库 migration 重放到 `20260728000300_r1_platform_runtime.sql` 时，官方 self-hosted Storage 已存在 `storage.buckets.allowed_mime_types text[]`，但该表由 `supabase_storage_admin` 持有，仓库 `postgres` 角色无权重复执行 `ADD COLUMN IF NOT EXISTS`。核实列型后从下一条语句继续，未改变 Storage 表 owner，剩余迁移全部完成；此兼容偏差不涉及 Xiaomi。

固定账号连接前先对 Xiaomi 做只读集合核对：目标共 12 个 auth user，其中 11 个 `@mathin.local` 身份与 `.claude/test-accounts.local.md` 的 11 个唯一邮箱完全一致，另 1 个非固定域账号未读取到仓库、未复制到本机。新 runner 从 manifest 的 12 条角色行合并为 11 个账号，不把邮箱、密码或 UUID 写入日志/源码；本机 profile 分布为 admin 1、staff 6、student 2、parent 2，staff-role 分布为 teacher 3、research 2、sales/principal/registrar 各 1，与 Xiaomi 匿名摘要一致。账号创建后逐一密码登录 11/11，通过仓库 Playwright 固定学生账号进入 `/zh/notebook/me` 为 1/1；该浏览器证据只证明本机应用与 Auth 连接，不证明正式身份或真实业务旅程。

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
| `retention`, `access_roles`, `failure_ticket` | 候选身份永久保留并在 manifest 激活后纳入 protected 清单；产品/运维/安全；`BUG-R1-LIVE-001` 的生产 migration 已部署，待真实授权目标 RPC 验收后关闭 |

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
| `retention`, `access_roles`, `failure_ticket` | 正式管理员身份永久保留并在 manifest 激活后纳入 protected 清单；产品/运维/安全；`BUG-R1-LIVE-001` 的生产 migration 已部署，待真实授权目标 RPC 验收后关闭 |

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
| `retention`, `access_roles`, `failure_ticket` | migration/tests 随 Git 永久保留；仓库维护者；`BUG-R1-LIVE-001` 仅待真实授权目标 RPC 验收后关闭 |

### 两个 R1-Live migration 的生产部署证据

用户明确授权仅向 Xiaomi 依次部署 `20260815000100` 和 `20260815000200`，并把部署后权限限定为只读核查迁移账本、函数定义、对象计数及 `active manifest=0`。写前发现生产 head 已是仓库内的 `20260814000300_p6_six_classroom_cleanup`；部署暂停，直至只读确认其 checksum 与仓库一致、应用时间早于当前 release，并把 175 条账本和匿名计数固定为真实 preflight 基线。

两个 migration 在一个 `REPEATABLE READ` 事务中依序执行。事务内重复断言数据库指纹、前驱 checksum、目标 migration 缺失、manifest 表缺失、管理员/MFA、角色分布和全部匿名计数；DDL 后断言 RLS/API 权限、函数权限、role guard、manifest/entry/active 均为 0，且匿名计数无变化，最后才写入两条 ledger。独立新连接只读 postflight 再将生产 14 个相关函数定义与本机隔离库逐项比较。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1/3`；生产 schema/函数与 migration ledger；该子步骤 `PASS`，Gate 1/3 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | ledger 175→177，head=`20260815000200_r1_profile_role_update_guard`；仓库 migration 缺失=0，生产仅多已知历史短名 `20260726000100`；14/14 个函数定义与隔离库一致；两张表 RLS/权限及两个 trigger 正确；manifest=0、entry=0、active=0。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | migration 源提交 `4b993e4`；生产 head `20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth user=12、profile=12（admin 1/staff 7/student 2/parent 2）、verified active admin MFA=1、staff-role=8、学生=4、班级/课次/报名/点名=0、课程族=2、课程=102、讲次=1315、release=2633、Storage bucket=8/object=123602；无账号或业务数据漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；ledger `applied_at=2026-08-15T04:29:29.801512Z`；Codex；`swingislee`（对话逐字授权两个 migration 与只读 postflight） |
| `command_or_runbook` | Xiaomi `supabase-db`：只读 preflight → 单事务 DDL/ledger + fail-closed 前后断言 → 独立只读 postflight → 与 `mathin-isolated-loopback` 函数摘要比对；未调用角色写 RPC 或 purge |
| `artifact_url_or_path`, `artifact_hash` | `20260815000100` 规范化 SHA-256 `55c279a9eefe677ed65eb55f0ed022501599acb63282475a8ec1dfd284d710b4`；`20260815000200` 规范化 SHA-256 `45cbdf54ac5bc0ef30ad81d08bc72f1400fb6241ec02869b4800ef2bc215888f`；大日志不入 Git |
| `retention`, `access_roles`, `failure_ticket` | 去标识化摘要随 R1-Live 证据永久保留；产品/运维/安全；`BUG-R1-LIVE-001` 待真实授权目标 RPC 验收；正式 manifest 激活见下一节 |

### 首份 protected-only manifest 激活证据

按 doc 04 当前 Gate 已冻结的保护范围和产品负责人 standing execution direction，只读盘点确认唯一正式 admin 仍为 active 且 verified MFA=1，两个现有课程族均为 `purpose=production/status=enabled`，课堂相关表均为 0。草案只含正式 admin 的 `auth_user`/`profile` 与两个课程族根，共 4 个 `protected`、0 个 `purge_allowed`；其余 11 个账号、4 个学生和 2 条监护关系保持未分类，既不进入正式清单，也不构成删除授权。

精确 artifact 先上传到 Xiaomi 受控目录并校验 hash/mode，再用同一份条目执行完整激活事务并最终 `ROLLBACK`。独立连接确认回滚后 manifest/entry/active 仍为 0，随后重复同一 fail-closed 事务正式提交。新连接 postflight 复核 header、目标指纹、审批引用、条目类型/数量/hash、正式 admin/MFA、课程族实时计数、不可变约束、两个 purge 候选列表和全部匿名计数。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1/3`；生产正式对象保护；现有对象 manifest 子步骤 `PASS`，Gate 1/3 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | manifest=1、entry=4、active=1；`auth_user=1`、`profile=1`、`course_family=2`；`purge_allowed=0`；purgeable classroom/course family 均为 0；回滚演练和正式提交均通过，阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `f72ec3c`；生产 head `20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth/profile=12、staff-role=8、学生=4、监护关系=2、课程族=2、目录版本=3、课程=102、讲次=1315、release=2633、班级/课次/报名/点名=0、Storage bucket=8/object=123602；无账号或业务数据漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；`activated_at=2026-08-15T04:58:53.641463Z`；Codex；`swingislee`（standing execution direction：计划内步骤直接推进，每轮自检，需产品输入/人工测试时再停） |
| `command_or_runbook` | 去标识化只读盘点 → 精确 artifact 受控保存 → 完整激活事务 `ROLLBACK` → 独立零状态核查 → 同一 fail-closed 事务提交 → 新连接 postflight；未调用 purge、未创建/修改账号、未写业务表 |
| `artifact_url_or_path`, `artifact_hash` | Xiaomi `/home/swing/services/mathin/evidence/r1/r1-live-protected-only-manifest-3cd327ac685f81182fad403519bf1bbf7075f1feb434638d8ae71bd1e06e0102.json`，mode `600`，owner/group `swing`；artifact SHA-256 `3cd327ac685f81182fad403519bf1bbf7075f1feb434638d8ae71bd1e06e0102`；条目集 SHA-256 `e62d27094fa63c91d5fa57669e1a06a006b733fb3478cd276266c8553b582514`；manifest ID 只登记 SHA-256 `e691e3c2b557ae6ce262751969d63a758ec535cfca0314624da2170fffe7d832` |
| `retention`, `access_roles`, `failure_ticket` | 精确 artifact 在 Xiaomi 受控目录保留到 manifest retired 后再按运维策略归档；`swing` 运维账号、产品/安全审核角色；`not_applicable` |

## 首个真实闭环选择

选择整班点名，原因如下：

1. 它是教师真实课堂的第一项持久动作，业务价值明确。
2. 写入合同小：每名学生一条 `(session_id, student_id)` 事实，四态枚举，重复保存走 upsert。
3. 权限边界已明确编码：教师需 `attendance.mark` 且本人任教或有全校范围；admin 恒可；其他主体受 RLS 拒绝。
4. 开课逻辑已经把完整点名作为服务端门，不依赖前端按钮隐藏。
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

### 代码、数据和权限位置

| 范围 | 位置 | 当前判断 |
| --- | --- | --- |
| 正式员工注册 | `src/features/account/AccountSupportPanel.tsx`、`src/features/account/actions.ts`、`src/app/[locale]/(auth)/actions.ts`、迁移 `20260728000400_r1_account_security.sql` | 当前一次性代码只绑定邮箱；注册后身份为 `staff`，仍需分配 teacher role。邮箱/手机号/password、验证码与微信/QQ 的唯一账号合同见 [`r1-live-auth-identities.md`](../../plan/r1-live-auth-identities.md) |
| 教师入口 | `src/app/[locale]/dashboard/classes/**`、`src/app/[locale]/dashboard/sessions/[sessionId]/page.tsx`、课堂 live route | 路由存在；现有 Playwright 只证明固定 teacher 能打开班级门户，没有点名写态 |
| 点名 UI/action | `src/features/school/AttendanceDrawer.tsx`、`src/features/school/actions/attendance.ts` | 读取失败显示 action failed；写入使用 zod 和 upsert；缺真实目标 E3 |
| 点名事实 | `public.session_attendance` | 主键防重复；触发器写 `marked_by/marked_at`；note 最长 500 字符由 action 限制 |
| RLS | 迁移 `20260709000700_school_attendance.sql` | admin、授权本班教师/全校 staff 可读写；可访问学生档案的员工可读；学生/家长只经裁剪 RPC 读本人/孩子 |
| 开课门 | `src/features/classroom/actions.ts`、课堂 live page、`src/features/classroom/live/LiveShell.tsx` | 在册人数大于点名记录数时服务端抛 `ATTENDANCE_REQUIRED` |
| 当前自动化 | `tests/r1-classroom-continuity.test.ts`、`e2e/school-portals.spec.ts` | 前者是源码合同，后者只到班级门户；均不能证明目标环境写态闭环 |

## 真实正式账号与数据路径

1. 先记录目标的前端域名、Supabase project/database 指纹、Storage namespace、部署 commit 和环境责任人。
2. 正式管理员从 `/dashboard/account-support` 为首名真实教师邮箱生成一次性员工邀请码，通过受控渠道交付；手机号邀请需等待兼容迁移和非生产验证。
3. 教师在 `/signup` 自行注册并完成 password 登录/恢复核对；管理员在 `/dashboard/staff` 分配内置 teacher staff role。邮箱、手机号、微信和 QQ 最终都绑定同一 `auth.users.id`，不得为登录方式复制 profile。
4. 管理员使用 `/dashboard/students` 创建/导入真实花名册；原始 CSV 和可识别信息不进入 Git/聊天证据。
5. 管理员使用 `/dashboard/classes/new` 创建 `purpose=production` 班级，选择一门当前 release 可读的课程、正式教师、学期和课次；再从班级花名册完成分班。记录该课次冻结/引用的 release ID、snapshot hash 和依赖对象 hash，并纳入正式保护 manifest。
6. 固定开发账号继续只用于开发验证；正式教师只分配 production 班级。任何 reset、seed、rebuild 或 testdata purge 在命中目标指纹或受保护对象 manifest 时必须拒绝。

当前代码允许 free 班级不带课程，但 class builder 不会为 free 班级自动创建课次。因此最小正式路径应选择一门当前已完整发布的课程并生成至少 1 个课次；不得用一次性 SQL 补造课次。

## 当前上线阻塞项

| ID | 等级 | 原因 | 最小修复 | 人工操作 | 验收 |
| --- | --- | --- | --- | --- | --- |
| LIVE-P1-02 | 核心 P1 | 正式管理员、两个 R1-Live migration 和首份 active protected-only manifest 已完成。当前班级/课次/报名/点名均为 0，仍没有首名正式教师和最小真实业务数据；production role RPC 尚未通过真实角色分配验收 | 产品负责人提供首名教师登录标识；随后走员工邀请、注册、角色分配、学生、production 班级、课次和分班正式 UI/RPC，并随新增对象生成替代 manifest | 产品负责人只需提供/使用首名教师真实邮箱并在后续执行教师登录；其余既定步骤由 Agent 直接推进；双人恢复联系人和演练不进入 R1-Live 当前执行链 | admin 恰好 1 且 MFA=100%；日常角色管理可用；教师只见自己的真实班级；新增正式对象及时受保护 |
| LIVE-P1-03 | 核心 P1 | 点名只在开发合同层有证据，没有目标环境 Golden Path | 增加单条聚焦 Smoke；正式教师人工执行保存/刷新/重登/再读，管理员与无权限角色作对照 | 教师和管理员各执行对应步骤 | 写入恰好一行/学生；重新读取一致；越权查询 0 泄露 |
| LIVE-P1-04 | 核心 P1 | current 已更新到 `023f5167…` 且 previous commit 已知；两个 R1-Live migration 与 active protected-only manifest 已生效；当前仍没有数据库/Storage 数据备份，previous 未经兼容回退验证，错误可查但 release 全空 | 安装并执行备份、校验和隔离恢复抽查；验证 previous；配置 `MATHIN_RELEASE`；定位一次受控错误 | 既定自动步骤按 standing execution direction 推进；需要人工切换/观察时再停下 | 有最近可恢复备份；回退兼容；错误可按 time/route/release/digest 定位；证据不含 secret/PII |
| LIVE-P1-05 | 核心 P1 | 没有真实教师独立验收 | 选 1 名教师无逐步指导完成闭环 | 产品负责人选择并观察 | P0=0、影响闭环的 P1=0；P2 已登记 |

仓库审阅没有发现一个已证实的开放 P0；这不等于生产 P0=0，因为 Gate 1～3 尚未在目标环境完整执行。

## 上线后待办池

- 原 R1-9 的 1305 讲全量来源 inventory、Storage/H5 审计、Terms 内容/关系/SEO。
- Story 完整章节、Games/Minds/Tools/Notebook 全量发布与越权旅程。
- 104 份小王子视觉矩阵、全站 WCAG/CWV/浏览器签收。
- 全量 Playwright 写态、zh/en、跨浏览器、连续无 flaky、文件/并发/竞争矩阵。
- 全量指标、容量、监控、数据库/Storage RPO/RTO 和恢复演练。
- 14 天/5 节真实使用观察；观察从 R1-Live 开放当天开始，不作为开放前等待。
- `POST-LIVE-AUTH-01`：补齐 student/parent/staff/admin 在桌面、移动和各可用环境中的统一账号中心入口，并完善资料、密码、MFA、会话、恢复和多 identity 绑定；2026-08-15 已确认学生 Dashboard 无可发现入口，本轮不保存含姓名的用户截图。
- Spatial Math / 3D 增强、长期重构、财务/活动深化和更多内容。

## 下一次状态变化

- Gate 1 只有在正式目标、身份、production 班级/课次/花名册、课次内容依赖保护和防误清证据全部成立后才能改为 `PASS`。
- Gate 2 只有在同一目标完成正式教师写态、持久再读、管理员可见和越权拒绝后才能改为 `PASS`。
- Gate 3 已由 `UNKNOWN` 变为 `BLOCKED`；只有最近可恢复备份、兼容回退、release 关联错误定位和危险入口指纹拒绝全部成立后才能改为 `PASS`。
- Gate 4 需要真实教师 E4，Agent、固定测试账号和产品负责人代操作都不能替代。
