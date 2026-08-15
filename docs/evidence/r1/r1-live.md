# R1-Live · 真实教师首个可用闭环差距表

## 结论

截至 2026-08-15，`mathin.club` / `supabase.mathin.club` 的应用、数据库、Storage、compose 和部署 commit 已完成目标登记，仓库级写入口保险丝也已把 Xiaomi 固定为当前生产目标；测试造数/重建不能写入它，课程内容写入默认拒绝并使用独立受控通道。本机已建立只绑定 `127.0.0.1` 的隔离 Supabase，应用本地环境和非生产写目标 attestation 已切换，自助注册关闭；Xiaomi 上的 11 个固定开发邮箱与 gitignored manifest 完全一致，本机据此独立创建 11 个开发身份/profile 和 8 条 staff-role 绑定，11/11 密码登录及 1 条应用登录通过，学生、班级、课次、报名和点名表仍为 0；该本机初始化没有复制或修改 Xiaomi 数据。仓库 migration 已为 purge 增加数据库指纹、protected/准删条目、hash/计数漂移和删除闭包 fail-closed 合同，并在一次性 PostgreSQL 15 通过从零重放与回滚式断言；该 migration 尚未部署到 Xiaomi，除正式管理员的产品裁决外，其余身份和业务对象尚未分类，所有对象也均未写入 active manifest。经用户明确授权，当前提交 `023f5167f330935b4951d28a1b33a0cd28cd4fa9` 已作为仅应用发布切换到生产 release `20260814-221135`，旧 current `20260724-051318`（commit `b833c4d…`）成为 previous；服务、loopback/Caddy 健康检查及公网健康/登录/MFA 路由探针均通过，该应用发布未执行数据库 migration、账号写入或业务数据写入。随后用户明确指定唯一非固定 Gmail 身份为正式管理员：生产库先在 fail-closed 单事务内把其 profile 从 `student` 引导为无岗位 active `staff`；本人完成 MFA 后，只读核查确认 verified factor=1，再以一个 fail-closed PostgreSQL 事务同时把该账号从 `staff` 提升为 `admin`、把原固定开发 `admin` 降为无岗位 active `staff`。提交后目标账号是唯一 active admin 且 MFA=1，admin 总数/active admin 总数均恰好为 1；交接未修改 Auth identity、密码、MFA factor、session、staff-role 或业务表。本人随后退出旧会话、重新登录、完成 MFA challenge 并成功进入生产 admin 路由，应用层 AAL2/admin 授权子项通过。目标机仍没有可核验的数据库/Storage 最近备份，previous 尚未做兼容烟测或受控回退，错误记录仍缺 release 关联，因此 R1-Live 当前状态仍为 Gate 0 `PASS`、Gate 1 `BLOCKED`、Gate 2 `BLOCKED`、Gate 3 `BLOCKED`、Gate 4 `BLOCKED`。

本文件是 E0/E1 差距审阅，不是完整生产验收。2026-08-14 的 Xiaomi E1/E3 运行事实，以及 2026-08-15 的本机隔离目标、应用发布、正式管理员身份引导和原子交接证据见 [`r1-live-target-audit.md`](r1-live-target-audit.md)；用户提供的 `docs/plan/mathin-R1-Live-讨论稿.md` 为产品裁决输入，现行施工顺序以 doc 04 为准。

## Gate 状态表

| Gate | 当前状态 | 已完成证据 | 缺失项 | 是否阻塞 | 最小修复范围 |
| --- | --- | --- | --- | --- | --- |
| Gate 0 · 上线范围冻结 | `PASS` | doc 04 已冻结“正式教师整班点名”为首个闭环，并将旧 R1-9～18 重新分类 | 无 | 否 | 范围改变只接受产品负责人显式裁决 |
| Gate 1 · 正式身份与真实数据 | `BLOCKED` | 组合目标指纹 `799d…63e39`、部署 commit、Storage 摘要、身份/业务对象匿名基线已登记；仓库 fixture/rebuild/import 已接入公共 target policy；本机已建立只绑定 `127.0.0.1` 的隔离 Supabase 并完成固定账号验证；唯一非固定 Gmail 已完成 verified MFA、正式 admin 原子交接、新会话 MFA challenge 和 admin 路由验收，提交后唯一 active admin 恰好 1 个且未附带 staff 岗位或业务关联；migration `20260815000100` 已建立目标绑定的 protected/准删 manifest 和 purge fail-closed 合同；员工邀请、staff role/RLS、production/test purpose、学生/分班/课次 UI/RPC 已实现 | `admin_set_identity` 与新 profile 保护触发器仍不兼容；migration 未部署到 Xiaomi；其余身份和 `purpose=production` 对象未分正式/测试且无 active manifest；无正式教师/真实闭环对象 manifest；未登记首个课次 release/snapshot/object | 是 | 先修复/验证日常身份变更合同；随后部署 migration、分类对象并激活 protected-only manifest，再建立最小真实身份和数据 |
| Gate 2 · 真实工作闭环 | `BLOCKED` | `AttendanceDrawer`、`saveAttendanceAction`、`session_attendance`、`can_mark_attendance`/`can_view_attendance`、开课前 `ATTENDANCE_REQUIRED`；`tests/r1-classroom-continuity.test.ts` 有静态合同 | 无正式目标写态运行；无保存→刷新→重登→再读、管理员可见、无权限拒绝的单条 Golden Path | 是 | 补一条聚焦 Playwright 等价链，并在正式账号/真实数据下人工完整执行一次 |
| Gate 3 · 最小生产保险丝 | `BLOCKED` | current/previous immutable release、原子切换、自动失败回退脚本、commit 元数据、服务健康和 `operational_errors` 查询位置已确认；current 已部署为 `20260814-221135` / `023f5167…`，previous 已知为 `20260724-051318` / `b833c4d…`；loopback、Caddy 与公网探针通过 | 没有 backup timer 或可校验的数据备份；生产 migration 账本仍缺 `20260815000100` 且多一个历史短名条目；previous 未做兼容烟测或受控回退；全部 1,946 条错误缺 release；未做恢复抽查或受控错误 | 是 | 先建立数据库+Storage 备份并抽查恢复，再部署/核对 manifest migration、验证 previous rollback、注入 release 标识并在另行授权下定位一次受控错误 |
| Gate 4 · 真实教师独立验收 | `BLOCKED` | 无 E4 | 未选择首名教师；未进行无指导观察；P0/P1 未形成关闭记录 | 是 | 选 1 名真实教师独立执行 Gate 2，清零 P0/核心 P1，P2 入池 |

状态只允许 `PASS`、`BLOCKED`、`UNKNOWN`、`NOT REQUIRED`。Gate 3 已完成目标运行核查并得到明确失败事实，因此从 `UNKNOWN` 改为 `BLOCKED`，不能再用仓库脚本或历史演练替代当前备份与回退证据。

### 仓库 manifest 实现证据

- migration head `20260815000100_r1_live_object_protection_manifest.sql` 不包含 manifest seed 或 Xiaomi 指纹，只建立表、trigger、内部校验与现有两个 purge RPC 的 fail-closed 合同。
- 一次性 PostgreSQL 15 从零重放 181 个 bootstrap/migration/seed/fixture 输入成功；`r1_live_object_protection_assertions.sql` 在事务回滚中覆盖无 manifest、错误目标/hash、重复管理员、计数漂移、active 不可变、protected 子对象和精确准删根。
- 14/14 份 R1 数据库断言通过；manifest/purge 定向 Vitest 为 2 个文件、17/17；`pnpm r1:test` 为 23 个文件、178/178；全量 Vitest 为 92 个文件、618 项通过、1 项条件跳过；`pnpm ci:checks` 17/17 通过。
- 本轮数据库验证和类型生成只连接 disposable loopback 容器；没有连接、部署或写入 Xiaomi。目标运行状态仍只采用 2026-08-14 的只读证据。

### 本机隔离开发目标证据

2026-08-15 在用户明确授权后，以 Supabase 官方 self-hosted `v0.8.0`（上游 commit `241bb11c0627f2981746d37033f57dbfa81d29b0`）建立名为 `mathin-isolated` 的本机开发栈。运行文件和 secret 只保存在 gitignored 的 `.tmp/mathin-supabase-selfhosted/` 与 `.env.local`，未提交凭据；Xiaomi 全程未连接、未复制、未写入。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；开发/生产连接隔离；该子项 `PASS`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 11/11 个服务 healthy；所有已发布端口 Host IP 恰为 `127.0.0.1`；`auth.users=11`、`profiles=11`，11/11 password login 通过；全局自助注册关闭，email provider 只用于已有账号登录，phone provider 关闭。阈值为无非 loopback 发布、固定集合精确、无自助注册、无 Xiaomi/真实业务数据，全部满足 |
| `commit_sha`, `migration_head`, `environment` | `commit_sha=not_applicable`（本机运行态，仓库证据由本文件 Git 历史固定）；head `20260815000100_r1_live_object_protection_manifest`；Windows Docker Desktop / `mathin-isolated-loopback` |
| `dataset_manifest` | PostgreSQL 15.8；178 个 migration SQL + `courses.pre-family.seed.sql`；初始加载明确排除 `supabase/ci/10_fixtures.sql`；ledger 175 条（3 个 snapshot SQL 按现有账本规则排除），课程 84、讲次 1045、Storage bucket 8、active protection manifest 0；随后仅初始化 manifest 的 11 个固定开发身份/profile 与 staff-role，学生、班级、课次、报名、点名均为 0 |
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
| `commit_sha`, `migration_head`, `environment` | 操作基线 `ebdb044603d69ad9052420707611cfcf23711d79`；生产 head `20260814000200_p6_qa_student_cleanup`；Xiaomi / production |
| `dataset_manifest` | auth user 总数仍为 12；profile 分布由 admin 1/staff 6/student 3/parent 2 变为 admin 1/staff 7/student 2/parent 2；目标 UUID SHA-256 `aa21999cfdc116f1846b205e6d83e2e679e91b88014ded573d60dd7366241f8e`，email SHA-256 `cbe8df0d0869c63c8a27be2ecfa35e36255a22c4292bff89bfe5e06a7fddad4a`；仓库不记录原值 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；profile `updated_at=2026-08-14T22:24:21.158Z`；Codex；`swingislee`（对话明确要求“先将该账号标记为职员”） |
| `command_or_runbook` | Xiaomi `supabase-db` 容器内 PostgreSQL；脱敏只读 preflight → fail-closed 单事务 role update → 脱敏 postflight；未触碰 auth identity、密码、session、staff-role 或业务表 |
| `artifact_url_or_path`, `artifact_hash` | 本节 Git 证据；`not_applicable`（不保存含 PII 的原始 SQL 输出） |
| `retention`, `access_roles`, `failure_ticket` | 候选身份永久保留并在 manifest 部署后纳入 protected 清单；产品/运维/安全；`BUG-R1-LIVE-001`：`admin_set_identity` 被后续 profile 保护触发器拒绝，需 migration 修复和非生产回归 |

本人完成 MFA 后，先以只读查询确认目标 verified factor 恰好为 1、仍为 active staff、现有 active admin 恰好为 1，再按此前“提权为生产库 admin”的明确授权执行一次性原子交接。单个受信任 PostgreSQL 事务锁定两个 profile，以同一条受保护更新把目标提升为 admin、把原固定开发 admin 降为 staff，并在提交前断言角色、MFA、岗位和 admin 总数；任一断言失败都会整体回滚。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；正式管理员 MFA 与原子交接；数据库子步骤 `PASS`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 目标 verified MFA=1；恰好 2 个 profile 角色行参与 `staff/admin` 对调；提交后目标为 active admin，原固定开发 admin 为 active staff；admin=1、active admin=1；双方 staff-role 均为 0。阈值为目标 MFA verified、只交换两个顶层角色、任一提交态唯一 admin、零附带岗位，全部满足 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `e6ed987c849bcdfda6ebbf89a8e7850a51b87c95`；生产 head `20260814000200_p6_qa_student_cleanup`；Xiaomi / production |
| `dataset_manifest` | auth user 总数仍为 12；profile 分布保持 admin 1/staff 7/student 2/parent 2；staff-role 绑定总数仍为 8。正式管理员 UUID SHA-256 `aa21999cfdc116f1846b205e6d83e2e679e91b88014ded573d60dd7366241f8e`、email SHA-256 `cbe8df0d0869c63c8a27be2ecfa35e36255a22c4292bff89bfe5e06a7fddad4a`；原固定开发管理员 UUID SHA-256 `fb8e182eb5dd55fb0dff11299dbc9e28cb375131d53f8f355ef99a52d1b45e48`、email SHA-256 `157d40c2b2389d34af03c8e44e9106b28c127e94acf493e776d063d35a80cc54`；仓库不记录原值 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；两个 profile `updated_at=2026-08-15T03:31:45.510Z`；Codex；`swingislee`（此前明确要求“将这个账号设置为生产库正式管理员账号”，本轮确认“已启用 MFA”） |
| `command_or_runbook` | Xiaomi `supabase-db` 容器内 PostgreSQL；脱敏只读 MFA/角色 preflight → fail-closed 两行原子 role swap → 脱敏 postflight；未触碰 Auth identity、密码、MFA factor、session、staff-role 或业务表 |
| `artifact_url_or_path`, `artifact_hash` | 本节 Git 证据；`not_applicable`（不保存含 PII 的原始 SQL 输出） |
| `retention`, `access_roles`, `failure_ticket` | 正式管理员身份永久保留并在 manifest 部署后纳入 protected 清单；产品/运维/安全；`BUG-R1-LIVE-001` 继续开放，用于修复日常管理 UI/RPC 的 profile 角色变更合同，不否定本次受控原子交接证据 |

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
| LIVE-P1-01 | 核心 P1 | 仓库级 target policy 已阻断私网 DNS 误判，fixture/rebuild 拒绝 Xiaomi，课程导入默认拒绝并要求精确生产指纹与双重人工确认；本机隔离开发写目标已登记并通过；purge manifest/fail-closed migration 已实现但未部署，Xiaomi 无 active 保护清单 | 另行授权部署 migration，按真实 UUID 建立正式身份、业务对象及课次内容 protected-only manifest | 迁移部署、读取真实 UUID 和激活 manifest 均需另行授权；R1-Live 不加入准删对象、不执行清理 | 无 manifest/错误目标/hash 或计数漂移/保护对象命中均拒绝；正式数据不出现在候选列表；fixture/reset/seed/rebuild 在 Xiaomi 拒绝 |
| LIVE-P1-02 | 核心 P1 | 正式管理员已完成 verified MFA、唯一 admin 原子交接、新会话 MFA challenge 和 admin 路由验收；`admin_set_identity` 与新 profile 保护触发器仍不兼容。目标其余身份、6 个 production 班级等对象尚未分正式/测试，也没有经 manifest 确认的正式教师和最小真实业务数据 | 增加 migration 修复日常身份变更合同并在隔离库回归；随后分类保护现有对象并走员工邀请、角色分配、学生、production 班级、课次和分班正式 UI/RPC | migration、真实教师/班级/课次/花名册均需逐项授权；双人恢复联系人和演练不进入 R1-Live 当前执行链 | admin 恰好 1 且 MFA=100%；新会话达到 AAL2 并可进入 admin 路由；教师只见自己的真实班级；现有对象无误认/误清 |
| LIVE-P1-03 | 核心 P1 | 点名只在开发合同层有证据，没有目标环境 Golden Path | 增加单条聚焦 Smoke；正式教师人工执行保存/刷新/重登/再读，管理员与无权限角色作对照 | 教师和管理员各执行对应步骤 | 写入恰好一行/学生；重新读取一致；越权查询 0 泄露 |
| LIVE-P1-04 | 核心 P1 | current 已更新到 `023f5167…` 且 previous commit 已知，原有 73 条应用时代差已消除；当前仍没有数据库/Storage 数据备份，生产账本未部署 `20260815000100`，previous 未经兼容回退验证，错误可查但 release 全空 | 安装并执行备份、校验和隔离恢复抽查；部署并核对 manifest migration；验证 previous；配置 `MATHIN_RELEASE`；经授权定位一次受控错误 | 备份/恢复、migration 部署、回退和制造错误均需另行授权 | 有最近可恢复备份；回退兼容；错误可按 time/route/release/digest 定位；证据不含 secret/PII |
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
