# R1-Live · `mathin.club` 目标核查、应用/数据库发布、身份与保护清单

> **当前两 Gate 口径**：Gate 1 `PASS`；Gate 2 `BLOCKED`。下文保留 2026-08-14～17 操作当时的旧 Gate 编号作为历史证据；旧 Gate 3 的当前备份底线已并入并关闭 Gate 1，其余恢复/rollback/release 标签进入 Production 1.0。
>
> **核查时间**：2026-08-14 初次只读核查；2026-08-15 应用发布、正式管理员身份引导、MFA 核验、原子交接、数据库 migration 部署、首份 protected-only manifest 激活、首名真实教师注册与独立 postflight；2026-08-17 教师双岗位核查与 replacement manifest 原子替换/postflight；2026-08-22 运行时门禁 migration 与对应应用同步发布/postflight、当前 PostgreSQL+Storage 同批次备份及独立复核、报名状态窄修复 migration 回滚演练/正式部署/独立 postflight；2026-08-23 建班字段校验修复应用发布/postflight
>
> **目标**：应用 `https://mathin.club`；Supabase `https://supabase.mathin.club`
>
> **授权边界**：2026-08-14 Xiaomi 核查只允许健康检查、目标指纹、匿名汇总、备份/回退结构和错误位置查询；后续 §2.2 只修改仓库代码、测试与文档。2026-08-15 本机隔离目标、应用发布、正式管理员引导/MFA/原子交接，以及两个 R1-Live migration 部署分别由后续明确指令授权，边界见对应小节。产品负责人随后给出 standing execution direction：当前 R1-Live 规划内且不扩张范围的步骤由 Agent 每轮自检目标、写态、可逆性和漂移后直接推进，不再重复询问；需要真实信息、人工操作/验收、发现计划外差异或进入清理/不可逆动作时停下。§3.6 只写入首份目标绑定 protected-only manifest；§3.7 在教师本人完成注册后只读核查邀请、身份、岗位、manifest coverage 与匿名业务计数。§3.8 在产品确认 `research`/`teacher` 双岗位均属有意设置后，以同一边界创建 protected-only replacement，原子 retire 旧版本并激活新版本；不读取或保存邮箱/邀请码，不创建或修改账号/岗位/业务数据，不加入准删条目，不执行清理。2026-08-22 首次发布只允许依次部署两个已验证 migration 与对应提交，再做账本、函数、权限、匿名计数、release 和 HTTP postflight；报名状态窄修复按 standing direction 只部署 `20260822000300`、登记 checksum 并完成回滚演练/独立 postflight，不创建或修改账号、岗位、manifest、备份或业务数据，不执行清理。2026-08-23 只读定位产品负责人已执行的正式建班结果与错误记录；Agent 只修改应用、测试和证据并发布应用，不新增或修改数据库 schema、账号、岗位、manifest 或业务数据。
>
> **2026-08-22 备份边界**：用户对已规划的当前 PostgreSQL+Storage 同批次备份项回复“继续”。该轮只允许创建和核验一份新备份；不恢复、不切换服务、不修改账号/岗位/manifest/业务数据、不执行历史备份清理。现有 runner 含自动 retention prune，因此改用不删除任何目录的一次性 fail-closed runner。

## 1. E1 目标指纹

应用进程的 `NEXT_PUBLIC_SITE_URL` 与 `NEXT_PUBLIC_SUPABASE_URL` 分别精确指向上述两个域名。公网应用健康接口和 `/zh/login` 返回 HTTP 200；Supabase Auth/REST 网关在缺少 API key 时返回 HTTP 401，符合匿名探测预期。

| 项 | 只读结果 |
| --- | --- |
| 目标机 | `xiaomi`；组件指纹只保存 SHA-256，不保存数据库原始 system identifier |
| 当前应用 release | `20260822-162416`；commit `6dfb3af96cc81ca09be9b662d7cb047025546019`；构建时间 `2026-08-22T16:25:29Z` |
| previous 应用 release | `20260822-072101`；commit `ef1eb77cfbb1b5714191c0455dbf5fdc7313f208`；构建时间 `2026-08-22T07:22:16Z` |
| 数据库迁移账本 | 180 条；head `20260822000300_r1_live_enrollment_status_transition`。仓库 179 个非 snapshot migration 全部存在；生产另保留 1 个已知历史短名 `20260726000100`，无仓库 migration 缺失 |
| Storage namespace | 8 个 bucket；123,602 个 object；仅保存按 bucket 排序的匿名汇总摘要 |
| `mathin.club` 证书 | SHA-256 `B7:C2:7A:61:6F:C6:FF:A8:6D:FE:A5:73:37:8E:BF:36:24:B6:E9:58:69:77:C7:87:F4:C5:CD:29:CF:98:BB:F1`；到期日 2026-10-15 |
| `supabase.mathin.club` 证书 | SHA-256 `00:36:EB:6A:58:6A:0D:F6:B6:E8:8A:4D:BE:2F:39:48:28:E0:2F:61:75:2C:0D:34:12:A5:07:85:97:63:DA:F2`；到期日 2026-10-15 |

### 1.1 可复核的匿名组件摘要

| 组件 | SHA-256 |
| --- | --- |
| hostname | `c608c4787821de1b383d87ca8b2711d3d171b5a6c017c45a8523e9ae904d495e` |
| PostgreSQL system identifier | `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c` |
| compose 文本（按 `normalizeNewlines` 等价规则规范为 LF） | `734a92a5fe279277573bcc27a0fafe2dd727d677364e08fc23dd5dd872f00067` |
| Storage bucket/object 匿名汇总 | `ba45e1ee6f2cd6fe14c4acb16c2d0c3c3dd16693acafa2c1fcfd04e1002ba688` |
| 组合目标指纹 | `799d6a9c5d2a6fd5ec8d5ff3bef7f36a251d3488a7b387ce01d057b096463e39` |

组合指纹材料固定为四行 `host=<hash>`、`database=<hash>`、`compose=<hash>`、`storage=<hash>`，每行 LF 结尾后取 SHA-256。Storage 摘要材料固定为 bucket 数、object 总数及按 bucket ID 排序的 `bucket_id:count`；仓库只登记摘要与总数，不登记 bucket 名称。

目标 attestation 已完成，但它还没有被所有危险入口强制校验，因此不能单独使 Gate 1 通过。

## 2. E1 防误清核查

### 2.1 已有保护

- `r1:baseline-plan` 与生产部署 planner 均为 plan-only，拒绝生产写入。
- release E2E 目标策略明确拒绝 `mathin.club`/`supabase.mathin.club` 生产主机。
- `purge_test_classroom`、`purge_test_course_family` 已同时要求 `testdata.purge` 权限、active 目标绑定 manifest、明确准删根、保护闭包、精确影响计数、`purpose='test'`、名称二次确认及引用检查。当前 replacement manifest 有 8 个 protected 条目、0 个 `purge_allowed`，两个候选列表均为空，永久清理继续 fail-closed。
- R1-Live 正式对象保护 manifest 的 schema/函数和 replacement active header 已生效；正式 admin auth/profile、两个 production 课程族根及首名教师 auth/profile/两条岗位成员关系已保护，首份 header 已按不可变合同转为 `retired`。旧全库 planner 仍未接入该合同，继续保持 plan-only。

### 2.2 仓库写入口修复

2026-08-14 在不连接、不部署和不写生产目标的边界内完成公共 target policy：

- `xiaomi`、正式域名、稳定数据库 system identifier 摘要和组合证据摘要均被识别为当前生产目标；私网 DNS 和历史“开发库”用途不再构成开发 attestation。
- `r1:family-fixtures`、`r1:family-journey-fixture`、`r1:manual-dataset`、`p4e:offline-fixture` 和 `ci:db-rebuild` 没有生产放行参数，命中 Xiaomi 或缺少精确非生产 attestation 时在创建客户端或启动写 SQL 前拒绝。
- 当前非生产写目标只登记 loopback；任意 LAN/远程地址和临时填写的任意 SHA-256 均不构成批准目标。
- `cw:import`、`cw:aixuexi:import` 和 `cw:adapt-4x3 --apply` 默认拒绝生产；未来只有精确域名/SSH/稳定指纹、显式 `--allow-production-target` 与当前 Shell 的按操作确认同时成立，才可进入课程内容写阶段。该通道不适用于 fixture、重建或 purge。
- `.env.example` 已改为 loopback 安全默认值；现有 `.env.local` 未改动，线上应用和 Xiaomi 服务也未改动。

定向合同为 4 个文件、48 项通过、1 项条件跳过；`pnpm r1:test` 为 22 个文件、169/169 通过；全量 Vitest 为 91 个文件、609 项通过、1 项条件跳过；`pnpm ci:checks` 的 lint、typecheck、build、规划、secret/history scan 及其余门禁 17/17 通过。操作边界见 [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md)。

### 2.3 2026-08-14 初次核查时目标侧未关闭

- 本机 `.env.local` 仍直接指向 `https://supabase.mathin.club`，因此开发写态必须保持关闭，直到另行登记隔离的 loopback/RC 目标。
- 初次核查时目标数据库内的 testdata purge RPC 只按权限、`purpose` 和局部引用保护，不读取组合目标指纹或受保护正式对象 manifest；该历史缺口已由后续 §3.5 的生产 migration 部署关闭。
- 仓库保险丝不覆盖线上应用的正常业务写入，也不替代 RLS、领域权限、备份门或人工生产变更审批。

### 2.4 2026-08-15 仓库后续实现

在不连接、不部署和不写 Xiaomi 的边界内，migration `20260815000100_r1_live_object_protection_manifest.sql` 已让现有两个 `purge_test_*` 读取当前 PostgreSQL cluster 指纹、active protected/准删清单、条目 hash/计数、显示名和实际影响计数；无 manifest、目标不符、内容漂移或保护闭包命中均在事件和删除前拒绝。迁移不 seed 任何目标 UUID，不激活 manifest，也没有生产放行参数；合同与授权边界见 [`r1-live-object-protection-manifest.md`](../../runbooks/r1-live-object-protection-manifest.md)。

这项仓库实现当时没有改变 2026-08-14 的目标快照；后续生产部署见 §3.5。正式 active 清单当时仍未建立，所以按当时口径 Gate 1/3 保持 `BLOCKED`。

### 2.5 2026-08-15 本机隔离开发目标

用户另行授权后，以 Supabase 官方 self-hosted `v0.8.0`（上游 commit `241bb11c0627f2981746d37033f57dbfa81d29b0`）建立独立 `mathin-isolated` 栈；它不改变本文件 2026-08-14 的 Xiaomi 只读快照。

- 11 个服务全部 healthy，并只加入 `mathin-isolated-loopback`；实际 Docker port binding 逐容器核对后，所有发布端口的 Host IP 均恰为 `127.0.0.1`：API `35421`、数据库 `35422`、Studio `35423`、transaction pool `35429`。
- PostgreSQL 15.8 从零加载 178 个 migration SQL 与必要的 `courses.pre-family.seed.sql`，初始加载明确排除会创建 CI 账号的 `supabase/ci/10_fixtures.sql`；ledger 为 175 条、head 为 `20260815000100_r1_live_object_protection_manifest`。
- 初始状态为 `auth.users=0`、`profiles=0`。经后续明确授权，从 gitignored manifest 独立创建 11 个固定开发身份/profile 与 8 条 staff-role 绑定，11/11 password login 通过；全局自助注册继续关闭，email provider 只允许已有账号登录，phone provider 关闭。
- 本机学生、班级、课次、报名和点名表均为 0。当前匿名内容基线为课程 84、讲次 1045、Storage bucket 8，来自仓库迁移/必要 seed，不含 Xiaomi 副本或真实业务数据；active protection manifest 仍为 0。
- 本地数据库指纹为 `5af56ae69b51ca0a78b9357ec4792533a6e59f0a529a9a918f6ba4c93da68d0f`，与 Xiaomi 数据库摘要 `10e3…1a0c` 和组合目标指纹 `799d…63e39` 均不同；应用 `.env.local` 与非生产写目标 attestation 已切到 loopback 并通过 target policy。
- 本机 Compose override 的规范化文本 SHA-256 为 `28a7db50a165e5f34cd6f9dc46cc0e47931d6597a7143a99003a8dd5a2d46653`。运行文件和 secret 只位于 gitignored `.tmp/`、`.env.local`，未提交凭据。

固定账号初始化前只读核对 Xiaomi：12 个 auth user 中有 11 个 `@mathin.local`，与本机固定清单逐一完全匹配；另 1 个非固定域账号未复制。账号在本机由 Auth Admin API 使用本地 manifest 凭据重新创建，本机 UUID 独立生成，不读取或复制 Xiaomi 密码哈希。仓库 runner 验证 11/11 Auth 密码登录，Playwright 固定学生账号进入私有 Notebook 为 1/1。整个过程没有修改 Xiaomi、没有创建正式账号、没有写入真实业务数据；它关闭当时 Gate 1 的“本机开发连接与生产隔离/固定账号登录”子项，不代表 Xiaomi 的正式身份或生产保险丝已通过。

## 3. E1 身份与业务对象状态

| 项 | 只读汇总 | 判断边界 |
| --- | --- | --- |
| auth users | 12；全部为 email/password；phone 0；OAuth identity 0 | 11 个邮箱属于固定开发域；另 1 个已由产品负责人明确指定并交接为正式管理员 |
| profiles | admin 1、staff 7、student 2、parent 2 | 2026-08-14 初始快照为 admin 1/staff 6/student 3/parent 2；先执行正式账号 `student→staff`，再与原固定开发 admin 对调 `staff/admin`，第二步不改变聚合计数；角色计数仍不替代正式身份 manifest |
| admin MFA | 1 个 active admin profile；该账号存在 1 个 verified MFA factor；本人已退出/重登、完成 MFA challenge 并进入 admin 路由 | R1-Live 的正式管理员数据库角色、MFA 和新会话 AAL2/admin 路由均已验收；正式 UUID 仍待进入对象保护 manifest，双人恢复联系人和恢复演练保留在既有 Production 1.0/R1-18 门 |
| staff role members | teacher 3、research 2、principal 1、registrar 1、sales 1 | 不能据角色名推断哪一个是真实首名教师 |
| staff invitations | 0 | 当前没有待处理、接受、撤销或过期邀请记录 |
| 当前课堂业务对象 | 班级 0、课次 0、enrollment 0、点名 0 | 2026-08-14 初次快照的 6 个验收班级、61 个课次、3 条 active enrollment 和 5 条点名已由仓库精确 migration `20260814000300_p6_six_classroom_cleanup` 于当日 19:59（Asia/Shanghai）清除；checksum 与仓库一致，早于当前应用 release |
| 学生档案 | 4；其中 2 个绑定 auth user | 未读取姓名或其他 PII |
| 当前课次内容引用 | 0 个课次 | 尚未建立首个真实课次，也未登记其 release/snapshot/object hash |

全局注册码单例处于 active，最近更新时间为 `2026-08-03T05:25:56.694284Z`；核查未读取或输出注册码本身。

### 3.1 正式管理员候选 staff 引导

候选账号以 UUID SHA-256 `aa21999cfdc116f1846b205e6d83e2e679e91b88014ded573d60dd7366241f8e`、email SHA-256 `cbe8df0d0869c63c8a27be2ecfa35e36255a22c4292bff89bfe5e06a7fddad4a` 匿名登记。写前 target=1、role=student、active/account_status=active，学生档案、监护关系、staff-role、verified MFA 均为 0；写后 role=staff，其余值不变。现有 active admin=1、verified admin MFA=1，前后未变化。

现有 `admin_set_identity` RPC 会设置旧版 `app.allow_profile_role_update` GUC，但 migration `20260728000400_r1_account_security.sql` 已把触发器改为对任何 authenticated 受保护字段变更一律拒绝，导致 RPC 调用失败；失败事务已回滚，无部分写入。随后在用户明确批准下，由受信任 PostgreSQL 管理连接直接更新同一 profile 行，并在一个事务中执行唯一性、旧值、零关联、admin/MFA 前置断言和新值/零岗位后置断言。本次一次性管理员交接同样使用显式批准的受信任管理事务；`BUG-R1-LIVE-001` 后续已由 migration `20260815000200` 修复并部署生产。首名教师通过邀请直接成为 `staff`，其岗位分配调用另一条 `grant_staff_role` RPC；不得为取证人为改变正式顶层身份，`admin_set_identity` 的生产调用证据延后到真实顶层身份变更，不阻塞当前点名闭环。

### 3.2 MFA 核验与正式管理员原子交接

目标账号本人完成 MFA 后，只读 preflight 以既有脱敏 hash 精确定位该身份，确认 role=staff、active/account_status=active、verified MFA factor=1、staff-role=0；同时确认现有 active admin=1、verified MFA=1、staff-role=0。随后在用户此前“将这个账号设置为生产库正式管理员账号”的明确授权下，以一个事务锁定两个 profile 并用同一条受保护更新完成 `target: staff→admin`、`former fixed admin: admin→staff`；事务内断言更新行数=2、目标为唯一 active admin、双方均无 staff-role，任一条件不符则整体回滚。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；正式管理员 MFA 与原子交接；数据库子步骤 `PASS`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 目标 verified MFA=1；恰好 2 个 profile 角色行参与对调；提交后目标=active admin、原固定开发 admin=active staff；admin=1、active admin=1；双方 staff-role=0。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `e6ed987c849bcdfda6ebbf89a8e7850a51b87c95`；操作时生产 head `20260814000300_p6_six_classroom_cleanup`；Xiaomi / production |
| `dataset_manifest` | auth user=12；profile 分布仍为 admin 1/staff 7/student 2/parent 2；staff-role 绑定总数=8。正式管理员 UUID SHA-256 `aa21999cfdc116f1846b205e6d83e2e679e91b88014ded573d60dd7366241f8e`、email SHA-256 `cbe8df0d0869c63c8a27be2ecfa35e36255a22c4292bff89bfe5e06a7fddad4a`；原固定开发管理员 UUID SHA-256 `fb8e182eb5dd55fb0dff11299dbc9e28cb375131d53f8f355ef99a52d1b45e48`、email SHA-256 `157d40c2b2389d34af03c8e44e9106b28c127e94acf493e776d063d35a80cc54`；仓库不记录原值 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；两个 profile `updated_at=2026-08-15T03:31:45.510Z`；Codex；`swingislee`（此前明确授权正式管理员提权，本轮确认“已启用 MFA”） |
| `command_or_runbook` | Xiaomi `supabase-db` 容器内 PostgreSQL；脱敏只读 preflight → fail-closed 两行原子 role swap → 脱敏 postflight；未触碰 Auth identity、密码、MFA factor、session、staff-role 或业务表 |
| `artifact_url_or_path`, `artifact_hash` | 本节 Git 证据；`not_applicable`（不保存含 PII 的原始 SQL 输出） |
| `retention`, `access_roles`, `failure_ticket` | 正式管理员身份永久保留并在 manifest 激活后纳入 protected 清单；产品/运维/安全；`BUG-R1-LIVE-001` 已部署生产，等待真实授权 RPC 验收 |

### 3.3 应用层管理员登录验收

数据库交接完成后，正式管理员本人按验收步骤退出旧会话、重新登录、完成 MFA challenge，并确认可打开生产 `/zh/dashboard/system-health`。本节只登记本人回报的去标识化结果，不保存浏览器截图、邮箱、验证码、TOTP secret、cookie 或 token。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；正式管理员新会话与应用授权；该子步骤 `PASS`，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 退出旧会话→重新登录→MFA challenge→生产 admin 路由成功；阈值为新会话达到 AAL2 且 admin 页面可达，满足 |
| `commit_sha`, `migration_head`, `environment` | 应用 `023f5167f330935b4951d28a1b33a0cd28cd4fa9`；验收时生产 head `20260814000300_p6_six_classroom_cleanup`；Xiaomi / production |
| `dataset_manifest` | `not_applicable`；人工登录与只读页面验收，不创建账号、不修改角色或业务数据 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；2026-08-15（Asia/Shanghai）；`swingislee`；`swingislee`（对话回报“已成功设置”） |
| `command_or_runbook` | `/zh/login` → MFA challenge → `/zh/dashboard/system-health`；人工生产验收 |
| `artifact_url_or_path`, `artifact_hash` | 本节 Git 证据；`not_applicable`（未保存含账号信息的截图或会话材料） |
| `retention`, `access_roles`, `failure_ticket` | 去标识化结论随 R1-Live 证据永久保留；产品/运维/安全；`not_applicable` |

### 3.4 日常身份角色管理兼容修复

用户要求继续 R1-Live 后，只在仓库与本机隔离 Supabase 实现 migration `20260815000200_r1_profile_role_update_guard.sql`。它恢复 `admin_set_identity` 使用的 role-only 受信任旁路，同时继续拒绝直接角色更新以及借该旁路修改 privacy consent、account status/lock 等其他保护字段；未连接或修改 Xiaomi。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；`BUG-R1-LIVE-001` 修复；仓库/隔离库子步骤 `PASS`，生产部署见 §3.5，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | 本机前向 migration 1/1；真实 authenticated JWT 下直接 role 更新拒绝、role 旁路夹带 account status 拒绝、管理员 RPC role 往返成功；明确命名临时空库从零重放 182 个输入并通过同一账户安全断言；临时库删除后存在数=0；R1 Vitest 23 文件 179/179。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `0c98ec5`；仓库/本机 head `20260815000200_r1_profile_role_update_guard`；该阶段生产为 `20260814000300_p6_six_classroom_cleanup`；`mathin-isolated-loopback` + 临时空库 |
| `dataset_manifest` | 本机主隔离库 ledger=176；auth user=11；profile admin 1/staff 6/student 2/parent 2；staff-role=8；active protection manifest=0；学生/班级/课次/报名/点名均为 0；断言事务回滚，数据无漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；2026-08-15（Asia/Shanghai）；Codex；`swingislee`（“继续 R1-live”） |
| `command_or_runbook` | 本机 Docker 前向 migration + `r1_account_security_assertions.sql`；临时空库 bootstrap→179 migrations→seed/fixture→断言→删除；`pnpm r1:test`、`pnpm lint`、`pnpm typecheck` |
| `artifact_url_or_path`, `artifact_hash` | `supabase/migrations/20260815000200_r1_profile_role_update_guard.sql`；规范化文本 SHA-256 `45cbdf54ac5bc0ef30ad81d08bc72f1400fb6241ec02869b4800ef2bc215888f` |
| `retention`, `access_roles`, `failure_ticket` | migration/tests 随 Git 永久保留；仓库维护者；生产部署已完成，`BUG-R1-LIVE-001` 的真实生产调用证据在出现合法顶层身份变更时补录，不为取证修改正式账号 |

### 3.5 两个 R1-Live migration 的生产部署

用户明确授权仅向 Xiaomi 部署 `20260815000100`/`20260815000200`，部署后只读核查账本、函数定义、对象计数和 `active manifest=0`，并明确禁止创建/修改账号、写业务数据、激活 manifest 或清理。写前发现生产 head 已是 `20260814000300_p6_six_classroom_cleanup`，与旧证据快照不同；部署立即停止并只读定位。该行 checksum `fa7e5b…8f3` 与仓库完全一致，ledger `applied_at=2026-08-14T12:00:39.547319Z`，6 条去标识化清理事件发生于 `2026-08-14T11:59:36.546345Z`，均早于当前应用 release，因此将它固定为本次真实 preflight 基线后继续原授权。

两个 migration 在一个 `REPEATABLE READ` 事务中顺序执行；事务内再次断言目标数据库指纹、175 条旧账本、前驱 checksum、目标 migration 不存在、manifest 表不存在、管理员/MFA、角色分布和全部匿名计数。DDL 后断言两表 RLS/API 权限、内部/外部函数权限、role guard 关键保护字段、manifest/entry/active 均为 0、匿名计数无变化，再写入两条 ledger；任一条件不符会整体回滚。提交后使用独立新连接只读复核，并将生产 14 个相关函数的 `pg_get_functiondef` SHA-256 与本机隔离库逐项比较。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | 历史 `R1-Live Gate 1/3`（现归 Gate 1）；生产 schema/函数与 migration ledger；该子步骤 `PASS` |
| `measured_value`, `threshold` | ledger 175→177，head=`20260815000200_r1_profile_role_update_guard`；仓库 migration 缺失=0，生产仅多已知历史短名 `20260726000100`；14/14 个函数定义与隔离库一致；两张表 RLS/权限及两个 trigger 正确；manifest=0、entry=0、active=0、空 manifest resolver 返回 null。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | migration 源提交 `4b993e4`；生产 head `20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth user=12、profile=12（admin 1/staff 7/student 2/parent 2）、verified active admin MFA=1、staff-role=8、学生=4、班级/课次/报名/点名=0、课程族=2、课程=102、讲次=1315、release=2633、Storage bucket=8/object=123602；无账号或业务数据漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；ledger `applied_at=2026-08-15T04:29:29.801512Z`；Codex；`swingislee`（对话逐字授权两个 migration 与只读 postflight） |
| `command_or_runbook` | Xiaomi `supabase-db`：只读 preflight → 单事务 DDL/ledger + fail-closed 前后断言 → 独立只读 postflight → 与 `mathin-isolated-loopback` 函数摘要比对；未调用角色写 RPC 或 purge |
| `artifact_url_or_path`, `artifact_hash` | `20260815000100` 规范化 SHA-256 `55c279a9eefe677ed65eb55f0ed022501599acb63282475a8ec1dfd284d710b4`；`20260815000200` 规范化 SHA-256 `45cbdf54ac5bc0ef30ad81d08bc72f1400fb6241ec02869b4800ef2bc215888f`；大日志不入 Git |
| `retention`, `access_roles`, `failure_ticket` | 去标识化摘要随 R1-Live 证据永久保留；产品/运维/安全；`BUG-R1-LIVE-001` 待真实授权 RPC 验收；正式 manifest 激活见 §3.6 |

### 3.6 首份 protected-only manifest 激活

standing execution direction 生效后，Agent 先做去标识化只读盘点：唯一 active admin 的 verified MFA 仍为 1；两个现有课程族均为 production/enabled，合计 102 门、1315 讲、2633 条 release；班级、课次、报名和点名均为 0。既有 11 个非 admin 账号、4 个学生和 2 条监护关系没有产品裁决证明其为正式 R1-Live 对象，因此不纳入正式清单，也不加入准删清单。首份 artifact 只保护 admin `auth_user`/`profile` 与两个课程族根，共 4 个 protected、0 个 purge 条目。

精确 artifact 先以 mode `600` 上传 Xiaomi 受控证据目录并校验 SHA-256。相同条目随后进入完整 `SERIALIZABLE` 激活事务：指纹、账本、管理员/MFA、课程族、匿名计数和空 manifest 前置断言全部通过，插入 draft/entries、复算条目 hash、激活、检查不可变触发器和两个 purge 候选列表后最终 `ROLLBACK`。新连接确认回滚后 manifest/entry/active 仍为 0，再重复同一事务正式提交；独立 postflight 复核 header、resolver、hash、实时课程族计数、候选列表和数据零漂移。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | 历史 `R1-Live Gate 1/3`（现归 Gate 1）；生产正式对象保护；现有对象 manifest 子步骤 `PASS` |
| `measured_value`, `threshold` | manifest=1、entry=4、active=1；`auth_user=1`、`profile=1`、`course_family=2`；`purge_allowed=0`；purgeable classroom/course family 均为 0；回滚演练、独立零状态核查、正式提交和新连接 postflight 全部通过 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `f72ec3c`；生产 head `20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth/profile=12、staff-role=8、学生=4、监护关系=2、课程族=2、目录版本=3、课程=102、讲次=1315、release=2633、班级/课次/报名/点名=0、Storage bucket=8/object=123602；无账号或业务数据漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-15（Asia/Shanghai）；`activated_at=2026-08-15T04:58:53.641463Z`；Codex；`swingislee`（standing execution direction） |
| `command_or_runbook` | 去标识化只读盘点 → artifact 受控保存 → 完整激活事务 `ROLLBACK` → 独立零状态核查 → 同一 fail-closed 事务提交 → 新连接 postflight；未调用 purge、未创建/修改账号、未写业务表 |
| `artifact_url_or_path`, `artifact_hash` | Xiaomi `/home/swing/services/mathin/evidence/r1/r1-live-protected-only-manifest-3cd327ac685f81182fad403519bf1bbf7075f1feb434638d8ae71bd1e06e0102.json`，mode `600`，owner/group `swing`；artifact SHA-256 `3cd327ac685f81182fad403519bf1bbf7075f1feb434638d8ae71bd1e06e0102`；entries SHA-256 `e62d27094fa63c91d5fa57669e1a06a006b733fb3478cd276266c8553b582514`；manifest ID 只登记 SHA-256 `e691e3c2b557ae6ce262751969d63a758ec535cfca0314624da2170fffe7d832` |
| `retention`, `access_roles`, `failure_ticket` | 该版本已于 2026-08-17 转为 `retired`；artifact 与 retired header 继续作为不可变历史保留并按运维策略归档；`swing` 运维账号、产品/安全审核角色；`not_applicable` |

### 3.7 首名真实教师注册只读核查

正式管理员完成员工邀请、教师本人报告注册成功后，新建生产只读事务首先断言数据库指纹与 migration head，再从唯一 accepted 邀请向 Auth/profile、岗位和 manifest coverage 做关联核查。查询只输出匿名计数、布尔值、accepted 时间和 UUID 的 SHA-256；没有输出邮箱、邀请码、密码、token 或原始 UUID。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；首名真实教师邀请/注册；该子步骤 `PASS`；该次快照时岗位尚未分配，Gate 1 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | accepted=1、pending=0、最新 accepted 候选=1；邀请邮箱与 Auth 匹配；email confirmed=true；profile=`staff`/active；consent=2；staff-role=0；学生档案/监护关系=0。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | current 应用 `023f5167…`；head=`20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | auth/profile=13；profile 为 admin 1/staff 8/student 2/parent 2；staff-role=8；active admin=1、verified active admin MFA=1；active manifest=1/entry=4，新教师 coverage=0；班级/课次/报名/点名=0 |
| `started_at`, `finished_at`, `actor`, `approver` | `accepted_at=2026-08-15T07:08:59.460913Z`；同日只读核查完成；首名真实教师 / Codex；`swingislee`（正式邀请与对话确认） |
| `command_or_runbook` | `/zh/signup` 正式注册路径；Xiaomi `supabase-db` `REPEATABLE READ READ ONLY` 去标识化查询；事务回滚结束，未修改账号、岗位、manifest 或业务数据 |
| `artifact_url_or_path`, `artifact_hash` | 仓库内本节摘要；教师 UUID SHA-256 `38e6b6e359bdae69e27a142bf7e94f50df0d12391fc3938bb6a787d73f9ba5f1`；不保存原始输出 |
| `retention`, `access_roles`, `failure_ticket` | 去标识化摘要永久保留；产品/运维/安全；`not_applicable` |

### 3.8 首名真实教师双岗位与 replacement manifest

用户报告教师岗位已分配后，生产去标识化只读核查确认目标仍为 active `staff`，active 岗位集合精确为 `research` 与 `teacher`，两条成员关系均由唯一正式管理员授予。产品负责人随后明确确认双岗位为有意设置。核查同时确认 auth/profile=13、staff-role=10、班级/课次/报名/点名仍为 0，首份 active manifest 对教师 coverage=0；未读取邮箱或原始 UUID。

replacement artifact 只复制首份 manifest 的 4 个 protected 条目，并加入教师 auth/profile/两条 `staff_role_member`，共 8 个 protected、0 个 purge。写前以仓库 `textFileSha256` 规则在 Xiaomi 本机复核 artifact 规范化摘要、mode `600` 和 owner/group `swing`。同一 SERIALIZABLE 事务锁定旧 active header，重新断言目标指纹、migration head、正式 admin/MFA、教师双岗位、全部匿名基线和条目 hash，再插入新版本、retire 旧版本并激活 replacement；首次完整运行最终 `ROLLBACK`，独立连接确认旧状态未变，第二次正式提交。独立 postflight 验证 resolver、新旧 header、不可变约束、教师 coverage、完整对象计数和两个空候选列表。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | 历史 `R1-Live Gate 1/3`（现归 Gate 1）；首名真实教师岗位与正式对象保护；该子步骤 `PASS` |
| `measured_value`, `threshold` | 岗位集合=`research`,`teacher`；header=2、active=1、retired=1；active entry=8：`auth_user=2`、`profile=2`、`course_family=2`、`staff_role_member=2`；教师 coverage=4；`purge_allowed=0`，两个候选列表为空；回滚演练、独立回滚核查、正式提交和独立 postflight 全通过 |
| `commit_sha`, `migration_head`, `environment` | 操作基线 `30d02d0`；head=`20260815000200_r1_profile_role_update_guard`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth/profile=13、staff-role=10、学生=4、监护关系=2、课程族=2、目录版本=3、课程=102、讲次=1315、release=2633、班级/课次/报名/点名=0、Storage bucket=8/object=123602；profile 为 admin 1/staff 8/student 2/parent 2；无身份、岗位或业务计数漂移 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-17（Asia/Shanghai）；2026-08-17（Asia/Shanghai）；正式管理员 / Codex；`swingislee`（双岗位产品确认及 standing execution direction） |
| `command_or_runbook` | 岗位只读核查 → artifact 受控保存与目标机摘要复核 → 完整 replacement 事务 `ROLLBACK` → 独立旧状态核查 → 同一事务提交 → 新连接 postflight；未创建/修改账号、岗位或业务数据，未执行 purge |
| `artifact_url_or_path`, `artifact_hash` | Xiaomi `/home/swing/services/mathin/evidence/r1/r1-live-protected-only-manifest-219e7536c1a7769b40a81f619083f66c0ee8069021a64d697b47415c4c6bfdb3.json`，mode `600`，owner/group `swing`；artifact SHA-256 `219e7536c1a7769b40a81f619083f66c0ee8069021a64d697b47415c4c6bfdb3`；entries SHA-256 `d188085fd5c3ff99cd7da5586e8c46e3dbfe542e929883a45c9560f5978ad606`；active manifest ID SHA-256 `f0b0e760968ce0dbcabc27efbc920c59410dee1d6bf4eac57b1aeec2cd8c095a` |
| `retention`, `access_roles`, `failure_ticket` | active artifact 在 Xiaomi 受控目录保留；首份 artifact/header 作为 retired 历史保留；`swing` 运维账号、产品/安全审核角色；`not_applicable` |

## 4. E3 备份、回退和错误定位

### 4.1 当前备份：`PASS`

2026-08-14 的首次只读核查确实没有找到当前数据库/Storage 备份。2026-08-22 在 standing execution direction 下执行已规划的下一项后，`/mnt/openlist-disk/Backups/Mathin/mathin-20260822T093529Z` 已成为当前同批次备份：先写入 `.partial`，源前后匿名数据库计数及 Storage 路径/大小/mtime 清单完全一致、两类工件可读且 SHA 生成成功后才原子转正。独立 postflight 再次运行 `sha256sum -c`，9/9 工件均为 `OK`；没有残留 `.partial`，生产数据库指纹、179 条账本、应用 release、匿名业务/Storage/manifest 计数与备份前一致，10 个 Supabase 容器均健康。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；当前 PostgreSQL+Storage 同批次备份；`PASS`，Gate 1 整体 `PASS` |
| `measured_value`, `threshold` | `database.dump=249508019 bytes`、TOC=3661；Storage 源=`50887768212 bytes/125135 files`，归档=`47869458194 bytes/125135 files`；数据库计数前后相同、Storage 清单前后相同；独立 checksum=9/9 `OK`；正式目录 1、`.partial=0`。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | `ef1eb77cfbb1b5714191c0455dbf5fdc7313f208`；`20260822000200_r1_live_operational_gate_simplification`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | auth/profile=13、staff-role=10、学生=4、监护关系=2、课程族/课程/讲次/release=`2/102/1315/2633`、班级/课次/报名/点名=`0/0/0/0`、Storage bucket/object=`8/123602`、active manifest/entry/purge=`1/8/0`；工件含正式数据，只在 Git 登记无 PII 摘要 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-22T09:35:29Z`；落盘 `2026-08-22T10:32:18Z`，独立 SHA 复核不晚于 `2026-08-22T10:51:55Z`；Codex；`swingislee`（回复“继续”） |
| `command_or_runbook` | mount/容量/指纹/账本 preflight；不含 retention prune 的单次 `.partial` runner；容器内 custom `pg_dump`/`pg_restore -l`；低优先级 `tar`/`pigz`；源前后 `cmp`；完整 Storage tar 读取/计数；SHA-256、原子转正、`sync`；独立 `sha256sum -c` 与生产 postflight。`restore_executed=false`、`retention_prune_executed=false`。仓库侧 plan audit、R1-Live 48/48、secret scan、typecheck 和 production build 均通过 |
| `artifact_url_or_path`, `artifact_hash` | Xiaomi `/mnt/openlist-disk/Backups/Mathin/mathin-20260822T093529Z/`；DB `dc26579cf02c3d50de9961e831636c48562fb8a6b6584e8670642038276cf5bb`；Storage `b736c5d78384b3c8e31a5ea81534b1ff6dec7ed0e91525222c4f4fd6743aab9c`；源清单 `cebbbe252fc636dcaf89237bccc32252b92516edecff89afbf2d1f400075b90f`；manifest `fa624ef33f66bc0ddb2830c887d67d31df61a3d9a2b296e3153624f027042196`；SHA 清单 `3c18aa352971493ce7d6f1d1952de1f9e462b559df74a026ba2e112d112d119b` |
| `retention`, `access_roles`, `failure_ticket` | 当前无自动 prune，核验 replacement 前不得删除；外置 `/dev/sdb1` 与系统盘分离但仍同机。exFAT 挂载使工件有效 mode=`755`、owner=`swing:swing`；交互 shell 仅 root/swing，OpenList 未挂载 Backups，但工件未静态加密。恢复、异机/静态加密备份及 RPO/RTO 属于 Production 1.0；R1-Live ticket=`not_applicable` |

### 4.2 应用发布与回退：发布通过，受控回退仍待验证

| 指针 | release | commit | 构建时间 |
| --- | --- | --- | --- |
| current | `20260822-162416` | `6dfb3af96cc81ca09be9b662d7cb047025546019` | `2026-08-22T16:25:29Z` |
| previous | `20260822-072101` | `ef1eb77cfbb1b5714191c0455dbf5fdc7313f208` | `2026-08-22T07:22:16Z` |

#### 4.2.0 2026-08-14 身份页前端发布

用户授权后，`scripts/ops/publish-mathin-xiaomi.ps1 -Action Publish` 对提交 `023f5167…` 先后完成本地 lint/typecheck/build、Git archive 传输、远端 lockfile 安装与 production build，再创建 immutable release、原子切换 `current`、重启服务并执行失败自动回退健康门。发布成功后再次独立运行 status：`mathin.service` active，loopback 与 Caddy `/api/health` 均返回 production `ok`；公网 `/api/health` 和 `/zh/login` 返回 HTTP 200，匿名访问 `/zh/dashboard/account-security` 返回 HTTP 307，并精确跳转到 `/zh/login?next=%2Fzh%2Fdashboard%2Faccount-security`。这证明包含 MFA 设置入口的当前应用已上线且匿名鉴权边界存在，不替代正式账号登录后的 MFA 人工验收。

应用发布当时没有执行 migration。部署 commit 的 migration 集合与生产均为 175 个名称，但生产缺 manifest migration 且多一个历史短名条目；运行时页面没有读取当时尚未部署的 manifest 表，发布健康检查通过。role guard 随后加入仓库，两个早期 R1-Live migration 已按 §3.5 独立部署。2026-08-22 的同步发布又把数据库推进到 179 条账本和运行时 head，并把新应用设为 current；当前应用提交包含仓库全部非 snapshot migration，生产只多一个已知历史短名。尚未实际切回 previous 或在隔离副本证明 `023f5167…` 与当前数据库兼容；这一事实保留为 Production 1.0 rollback 演练缺口，不再阻止首名内部教师开始使用。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | 历史 `R1-Live Gate 3`（最低项现归 Gate 1）；生产应用发布与健康；该子项 `PASS` |
| `measured_value`, `threshold` | current=`20260814-221135` / `023f5167…`，previous=`20260724-051318` / `b833c4d…`；service active；loopback、Caddy、公网 health 与 login 全部成功；MFA 路由匿名跳转正确。阈值为提交态不可变发布、原子指针、健康门与旧 current 可识别，全部满足 |
| `commit_sha`, `migration_head`, `environment` | `023f5167f330935b4951d28a1b33a0cd28cd4fa9`；应用发布时生产 head `20260814000300_p6_six_classroom_cleanup`，当前数据库 head 见 §3.5；Xiaomi / production |
| `dataset_manifest` | `not_applicable`；应用-only 发布，没有数据库、Storage、账号或业务对象写入 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-14T22:11:35Z`；`2026-08-14T22:13:02Z` 后完成健康复核；Codex；`swingislee`（对话明确要求部署当前开发前端） |
| `command_or_runbook` | `scripts/ops/publish-mathin-xiaomi.ps1 -Action Publish`；随后 `-Action Status` 和三个公网只读 HTTP 探针 |
| `artifact_url_or_path`, `artifact_hash` | `/home/swing/services/mathin/releases/20260814-221135/release.json`；`not_applicable`（远端 immutable release metadata，由 status 原样复核，仓库不复制远端 artifact） |
| `retention`, `access_roles`, `failure_ticket` | immutable release 目录由发布脚本保留；下次成功发布时 current 指针转为 previous，脚本不删除历史 release；Xiaomi 运维 SSH 角色；`not_applicable` |

#### 4.2.1 2026-08-22 运行时门禁与应用同步发布

写前独立查询确认数据库指纹、旧账本/head/checksum、三项旧函数 hash、active manifest 和所有匿名对象计数均与已登记基线完全一致。`20260822000100_r1_live_incomplete_course_activation.sql` 与 `20260822000200_r1_live_operational_gate_simplification.sql` 随后在同一个 serializable 事务中依次执行并登记账本；事务内后置断言和提交后的新连接只读核查均通过。应用发布脚本对 `ef1eb77…` 完成本地与 Xiaomi 两次 production build、不可变 release、原子切换、服务重启和健康门，旧 current 自动成为 previous。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 1`；生产运行时 schema + application；该子步骤完成时 `PASS`，后续当前备份关闭 Gate 1 |
| `measured_value`, `threshold` | ledger `177→179`，head=`20260822000200_r1_live_operational_gate_simplification`；两条 checksum 分别为 `8b49dc3e…abd3`、`145acada…55a0`。三项目标函数定义 hash 与隔离库完全一致，anon execute=false、authenticated execute=true。current=`20260822-072101` / `ef1eb77…`、previous=`20260814-221135` / `023f5167…`；service active，loopback/Caddy/公网 health=production ok，zh/en login=200，zh/en 匿名建班页=307 并回到对应 login。阈值全部满足 |
| `commit_sha`, `migration_head`, `environment` | `ef1eb77cfbb1b5714191c0455dbf5fdc7313f208`；`20260822000200_r1_live_operational_gate_simplification`；Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | pre/post 均为 auth/profile=13、profile admin/staff/student/parent=`1/8/2/2`、verified admin MFA=1、staff-role=10、学生=4、监护关系=2、课程族=2、课程=102、讲次=1315、release=2633、班级/课次/报名/点名=`0/0/0/0`、Storage bucket/object=`8/123602`；active manifest/entry/protected/purge=`1/8/8/0`，条目 hash 与目标指纹一致 |
| `started_at`, `finished_at`, `actor`, `approver` | 2026-08-22（Asia/Shanghai）；2026-08-22 15:24（Asia/Shanghai）完成最后 postflight；Codex；`swingislee`（在既定单一部署项后回复“继续”） |
| `command_or_runbook` | 单事务 SSH/psql migration runner；独立无锁只读数据库 postflight；`scripts/ops/publish-mathin-xiaomi.ps1 -Action Publish` / `-Action Status`；公网 curl 健康、双语登录和匿名重定向探针；未创建或修改账号、岗位、manifest、备份或业务数据，未执行清理 |
| `artifact_url_or_path`, `artifact_hash` | 两个 migration 规范化 SHA-256 为 `8b49dc3ebf94b00131405dcc74a073e449f630991d949565064b2d6d121dabd3`、`145acada7418b268c342ced431eddfbbb0b9e0e298b4bf52a6f92d2b320555a0`；`/home/swing/services/mathin/releases/20260822-072101/release.json` 为远端 immutable metadata，仓库不复制 |
| `retention`, `access_roles`, `failure_ticket` | migration、Git 证据与 immutable release 按现有策略保留；仓库维护者/Xiaomi 运维角色；`not_applicable` |

#### 4.2.2 2026-08-23 建班字段校验修复发布

产品负责人在正式建班向导先选某职员为学辅、再选同一人为主讲后，学辅选项因主讲过滤而从界面消失，但客户端状态仍保留原 UUID；服务端只在最终提交时拒绝主讲与学辅相同，因此界面显示学辅为空却返回 `VALIDATION`。生产错误表记录同一路由、同一 digest 的两次失败；产品负责人显式改选“暂不指定学辅”后成功创建 1 个 production 班级和 15 个课次。修复后，改选主讲会同步清除冲突学辅并就地提示，建班向导的必填项和格式错误也在字段所在步骤显示，不再等到最终提交；学辅继续保持可选。

| 证据字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `R1-Live Gate 2`；正式建班表单校验与生产应用；该缺陷 `PASS`，Gate 2 整体仍 `BLOCKED` |
| `measured_value`, `threshold` | `operational_errors` 在 `2026-08-22T15:53:01.279Z` 与 `15:53:09.807Z` 记录 route=`/[locale]/dashboard/classes/new`、digest=`1508028600`；成功班级创建于 `2026-08-22T15:59:26.477406Z`。生产 postflight 为班级/课次/报名/点名=`1/15/0/0`、staff assignment=`1`（主讲=`1`、学辅=`0`），active manifest/entry/purge=`1/8/0`。本机固定账号 Golden Path 复现“先学辅、后同人主讲”并 1/1 通过；R1-Live 48/48、全量 Vitest 621 通过+1 条件跳过、CI 16/16。阈值为学辅可空、冲突立即清除、当前步骤就地报错、合法建班不回归，全部满足 |
| `commit_sha`, `migration_head`, `environment` | `6dfb3af96cc81ca09be9b662d7cb047025546019`；`20260822000300_r1_live_enrollment_status_transition`（未新增 migration）；本机隔离 Supabase + Xiaomi / production；数据库指纹 `10e3…1a0c` |
| `dataset_manifest` | 产品负责人通过正式 UI 创建班级和 15 个课次；Agent 只读核查该结果。应用发布前后数据库保持班级/课次/报名/点名=`1/15/0/0`、主讲/学辅=`1/0`，未创建或修改账号、岗位、manifest、报名、点名或其他业务数据 |
| `started_at`, `finished_at`, `actor`, `approver` | 首次失败 `2026-08-22T15:53:01.279Z`；修复 release 构建完成 `2026-08-22T16:25:29Z`；产品负责人执行正式建班，Codex 完成只读定位、实现、验证和发布；`swingislee`（报告创建失败并确认学辅留空触发路径） |
| `command_or_runbook` | 生产 `operational_errors` 与业务计数只读查询、已登录页面只读检查；`pnpm r1:live:test`、`pnpm e2e:r1-live:golden`、`pnpm typecheck`、`pnpm messages:check`、`pnpm lint`、`pnpm build`、`pnpm ci:checks`；`scripts/ops/publish-mathin-xiaomi.ps1 -Action Publish` / `-Action Status`；公网 health、双语 login 与匿名建班重定向探针 |
| `artifact_url_or_path`, `artifact_hash` | Git commit `6dfb3af96cc81ca09be9b662d7cb047025546019`；Xiaomi `/home/swing/services/mathin/releases/20260822-162416/release.json`；远端 immutable metadata 不复制到仓库，`artifact_hash=not_applicable` |
| `retention`, `access_roles`, `failure_ticket` | 应用、测试与去标识化摘要随 Git 保留；immutable release 按现有发布策略保留；仓库维护者/Xiaomi 运维角色；`BUG-R1-LIVE-004` 已关闭 |

### 4.3 错误定位：可查询，但 release 关联缺失

- `public.operational_errors` 共 1,949 条：`request.error` 1,948 条、`infra.disk_alert` 1 条；最近一条为本轮建班校验错误 `2026-08-22T15:53:09.807Z`。
- 请求错误可按 `occurred_at`、`route_path`、`digest` 查询；最高频路由为 courseware（1,002 条）和 session detail（388 条）。本轮只读核查没有读取 `message`，避免带出 PII。
- 应用进程具备服务端写入条件，错误能够落入该表；但 `MATHIN_RELEASE`、`MATHIN_ERROR_REPORT_URL` 和 report token 均未配置。1,949 条现存记录的 `release` 全为空，无法按部署版本定位回归。
- 未主动制造错误，因为该动作会新增生产错误记录，超出本轮“无写入”边界。

## 5. Gate 差距结论

| Gate | 状态 | 已关闭 | 仍缺 |
| --- | --- | --- | --- |
| Gate 1 · 可安全开始 | `PASS` | 目标域名、应用/数据库/Storage/compose 匿名指纹和部署 commit 已登记；正式 admin/MFA 与首名教师岗位已建立；危险写入口和 purge RPC fail-closed，准删候选为 0；运行时 migration/应用已同步发布；current/previous、原子切换/失败回退命令、服务健康和错误查询位置已确认；当前 PostgreSQL+Storage 同批次备份已通过 TOC、完整文件计数、源前后清单和独立 SHA 复核 | 无；恢复、异机/静态加密备份和受控 rollback 属于 Production 1.0 |
| Gate 2 · 首个真实教师闭环 | `BLOCKED` | 身份与岗位存在；报名状态窄修复已部署；产品负责人已建立 1 个真实 production 班级和 15 个课次；建班字段现在在所在步骤校验，隐藏学辅冲突已修复并发布 | 为现有班级建立真实花名册/报名；正式教师完成点名保存与再读；管理员可见且既有无权限主体不可见 |

这份证据证明 2026-08-14 的 Xiaomi 初次只读观察，2026-08-15 的本机隔离目标、应用-only 生产发布、发布后健康、正式管理员身份引导/MFA/原子交接、新会话 AAL2/admin 路由验收、两个早期 R1-Live migration、首份 protected-only manifest 和首名真实教师邀请注册，2026-08-17 的 `research`/`teacher` 双岗位核查与 replacement manifest 原子替换，2026-08-22 两条运行时 migration/对应应用的同步生产发布、当前 PostgreSQL+Storage 同批次备份的独立可读性/SHA 复核和 `20260822000300` 报名状态窄修复，以及 2026-08-23 首个正式班级/15 个课次与建班字段校验修复的生产应用发布。Gate 1 已通过；Gate 2 已关闭建班子路径，但仍不证明真实花名册/报名及点名权限闭环已经完成。previous 兼容回退、恢复演练、异机/静态加密备份和 release 错误标签另属 Production 1.0 证据。
