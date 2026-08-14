# R1-Live · `mathin.club` 目标只读核查

> **核查结果**：Gate 1 `BLOCKED`；Gate 3 `BLOCKED`
>
> **核查时间**：2026-08-14（目标机 UTC 采样时间从 2026-08-13 20:48 起）
>
> **目标**：应用 `https://mathin.club`；Supabase `https://supabase.mathin.club`
>
> **2026-08-14 Xiaomi 核查授权边界**：只允许健康检查、目标指纹、匿名汇总、备份/回退结构和错误位置查询；后续 §2.2 只修改仓库代码、测试与文档。该次目标核查未创建账号、未触发验证码、未写业务数据、未制造受控错误、未部署、未回退、未恢复或清理。2026-08-15 本机隔离目标及固定开发账号为后续独立授权，见 §2.5。

## 1. E1 目标指纹

应用进程的 `NEXT_PUBLIC_SITE_URL` 与 `NEXT_PUBLIC_SUPABASE_URL` 分别精确指向上述两个域名。公网应用健康接口和 `/zh/login` 返回 HTTP 200；Supabase Auth/REST 网关在缺少 API key 时返回 HTTP 401，符合匿名探测预期。

| 项 | 只读结果 |
| --- | --- |
| 目标机 | `xiaomi`；组件指纹只保存 SHA-256，不保存数据库原始 system identifier |
| 当前应用 release | `20260724-051318`；commit `b833c4d814d5a0ecc6aad69df25d2c6831094f00`；构建时间 `2026-07-24T05:14:33Z` |
| 数据库迁移账本 | 174 条；head `20260814000200_p6_qa_student_cleanup` |
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
- `purge_test_classroom`、`purge_test_course_family` 要求 `testdata.purge` 权限、`purpose='test'`、名称二次确认及引用检查；权限默认不授予。
- R1-Live 正式对象保护 manifest 的产品合同已经写入 doc 00/04/25，但实现尚未覆盖所有写入口。

### 2.2 仓库写入口修复

2026-08-14 在不连接、不部署和不写生产目标的边界内完成公共 target policy：

- `xiaomi`、正式域名、稳定数据库 system identifier 摘要和组合证据摘要均被识别为当前生产目标；私网 DNS 和历史“开发库”用途不再构成开发 attestation。
- `r1:family-fixtures`、`r1:family-journey-fixture`、`r1:manual-dataset`、`p4e:offline-fixture` 和 `ci:db-rebuild` 没有生产放行参数，命中 Xiaomi 或缺少精确非生产 attestation 时在创建客户端或启动写 SQL 前拒绝。
- 当前非生产写目标只登记 loopback；任意 LAN/远程地址和临时填写的任意 SHA-256 均不构成批准目标。
- `cw:import`、`cw:aixuexi:import` 和 `cw:adapt-4x3 --apply` 默认拒绝生产；未来只有精确域名/SSH/稳定指纹、显式 `--allow-production-target` 与当前 Shell 的按操作确认同时成立，才可进入课程内容写阶段。该通道不适用于 fixture、重建或 purge。
- `.env.example` 已改为 loopback 安全默认值；现有 `.env.local` 未改动，线上应用和 Xiaomi 服务也未改动。

定向合同为 4 个文件、48 项通过、1 项条件跳过；`pnpm r1:test` 为 22 个文件、169/169 通过；全量 Vitest 为 91 个文件、609 项通过、1 项条件跳过；`pnpm ci:checks` 的 lint、typecheck、build、规划、secret/history scan 及其余门禁 17/17 通过。操作边界见 [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md)。

### 2.3 2026-08-14 目标侧仍未关闭

- 本机 `.env.local` 仍直接指向 `https://supabase.mathin.club`，因此开发写态必须保持关闭，直到另行登记隔离的 loopback/RC 目标。
- 核查时目标数据库内的 testdata purge RPC 只按权限、`purpose` 和局部引用保护，不读取组合目标指纹或受保护正式对象 manifest。仅凭 `purpose` 不能满足 R1-Live 正式对象保护合同。
- 仓库保险丝不覆盖线上应用的正常业务写入，也不替代 RLS、领域权限、备份门或人工生产变更审批。

### 2.4 2026-08-15 仓库后续实现

在不连接、不部署和不写 Xiaomi 的边界内，migration `20260815000100_r1_live_object_protection_manifest.sql` 已让现有两个 `purge_test_*` 读取当前 PostgreSQL cluster 指纹、active protected/准删清单、条目 hash/计数、显示名和实际影响计数；无 manifest、目标不符、内容漂移或保护闭包命中均在事件和删除前拒绝。迁移不 seed 任何目标 UUID，不激活 manifest，也没有生产放行参数；合同与授权边界见 [`r1-live-object-protection-manifest.md`](../../runbooks/r1-live-object-protection-manifest.md)。

这项仓库实现没有改变 2026-08-14 的目标快照：Xiaomi 尚未部署该 migration，也没有 active 正式清单。目标运行态保护仍未成立，Gate 1/3 保持 `BLOCKED`。

### 2.5 2026-08-15 本机隔离开发目标

用户另行授权后，以 Supabase 官方 self-hosted `v0.8.0`（上游 commit `241bb11c0627f2981746d37033f57dbfa81d29b0`）建立独立 `mathin-isolated` 栈；它不改变本文件 2026-08-14 的 Xiaomi 只读快照。

- 11 个服务全部 healthy，并只加入 `mathin-isolated-loopback`；实际 Docker port binding 逐容器核对后，所有发布端口的 Host IP 均恰为 `127.0.0.1`：API `35421`、数据库 `35422`、Studio `35423`、transaction pool `35429`。
- PostgreSQL 15.8 从零加载 178 个 migration SQL 与必要的 `courses.pre-family.seed.sql`，初始加载明确排除会创建 CI 账号的 `supabase/ci/10_fixtures.sql`；ledger 为 175 条、head 为 `20260815000100_r1_live_object_protection_manifest`。
- 初始状态为 `auth.users=0`、`profiles=0`。经后续明确授权，从 gitignored manifest 独立创建 11 个固定开发身份/profile 与 8 条 staff-role 绑定，11/11 password login 通过；全局自助注册继续关闭，email provider 只允许已有账号登录，phone provider 关闭。
- 本机学生、班级、课次、报名和点名表均为 0。当前匿名内容基线为课程 84、讲次 1045、Storage bucket 8，来自仓库迁移/必要 seed，不含 Xiaomi 副本或真实业务数据；active protection manifest 仍为 0。
- 本地数据库指纹为 `5af56ae69b51ca0a78b9357ec4792533a6e59f0a529a9a918f6ba4c93da68d0f`，与 Xiaomi 数据库摘要 `10e3…1a0c` 和组合目标指纹 `799d…63e39` 均不同；应用 `.env.local` 与非生产写目标 attestation 已切到 loopback 并通过 target policy。
- 本机 Compose override 的规范化文本 SHA-256 为 `28a7db50a165e5f34cd6f9dc46cc0e47931d6597a7143a99003a8dd5a2d46653`。运行文件和 secret 只位于 gitignored `.tmp/`、`.env.local`，未提交凭据。

固定账号初始化前只读核对 Xiaomi：12 个 auth user 中有 11 个 `@mathin.local`，与本机固定清单逐一完全匹配；另 1 个非固定域账号未复制。账号在本机由 Auth Admin API 使用本地 manifest 凭据重新创建，本机 UUID 独立生成，不读取或复制 Xiaomi 密码哈希。仓库 runner 验证 11/11 Auth 密码登录，Playwright 固定学生账号进入私有 Notebook 为 1/1。整个过程没有修改 Xiaomi、没有创建正式账号、没有写入真实业务数据；它关闭 Gate 1 的“本机开发连接与生产隔离/固定账号登录”子项，不代表 Xiaomi 的 manifest、正式身份/数据或 Gate 3 保险丝已通过。

## 3. E1 身份与业务对象匿名基线

| 项 | 只读汇总 | 判断边界 |
| --- | --- | --- |
| auth users | 12；全部为 email/password；phone 0；OAuth identity 0 | 11 个邮箱属于固定开发域，另 1 个不能仅凭邮箱判定为正式身份 |
| profiles | admin 1、staff 6、student 3、parent 2 | 角色计数不替代正式身份 manifest |
| admin MFA | 1 个 admin profile；1 个存在 verified MFA factor | 仍缺正式 UUID manifest、恢复联系人和责任确认 |
| staff role members | teacher 3、research 2、principal 1、registrar 1、sales 1 | 不能据角色名推断哪一个是真实首名教师 |
| staff invitations | 0 | 当前没有待处理、接受、撤销或过期邀请记录 |
| `purpose=production` 业务对象 | 班级 6、未删除课次 61、active enrollment 3（2 名 distinct student）、点名 5 | 这些对象尚未进入正式/测试保护 manifest；`purpose=production` 本身不能证明是真实数据 |
| 学生档案 | 4；其中 2 个绑定 auth user | 未读取姓名或其他 PII |
| production 课次内容引用 | 61 个课次中 58 个有 lecture，9 个已记录 `courseware_frozen_at` | 尚未选定首个真实课次，也未登记其 release/snapshot/object hash |

全局注册码单例处于 active，最近更新时间为 `2026-08-03T05:25:56.694284Z`；核查未读取或输出注册码本身。

## 4. E3 备份、回退和错误定位

### 4.1 最近备份：`BLOCKED`

- 系统级与用户级均未安装/启用 `p4e-backup.service`、`p4e-backup.timer` 或对应 disk timer。
- crontab 只有每 15 分钟磁盘检查，没有数据库/Storage 备份任务。
- 已知备份目录中仅见 2026-07-04 的环境配置备份；没有可核验的 `database.dump`、`storage.tar.gz`、`SHA256SUMS` 或 manifest。
- 已挂载备份磁盘存在，但在 runbook 指定和已知运维目录中没有找到可证明当前数据库/Storage 可恢复的最近备份。
- 因此不存在可登记的最近成功时间、内容 hash 或恢复抽查结果。未执行备份或恢复，因为本轮只读授权不包含生产写入。

### 4.2 应用回退：结构存在，当前不可直接宣称可用

| 指针 | release | commit | 构建时间 |
| --- | --- | --- | --- |
| current | `20260724-051318` | `b833c4d814d5a0ecc6aad69df25d2c6831094f00` | `2026-07-24T05:14:33Z` |
| previous | `20260717-180746` | `unknown` | `2026-07-17T18:08:37Z` |

`mathin.service` active/enabled，current 与 previous 是两个不同 immutable release；loopback 和 Caddy 路径健康检查均通过。但 current release 源码时代只有 101 个迁移文件，head 为 `20260723000300_p6_courseware_replacement_track_list_guard.sql`，当前目标数据库账本为 174 条，领先 73 条。previous commit 也没有登记。回退脚本虽可切换 symlink 和复核健康，当前证据不能证明旧应用兼容现数据库；在隔离副本完成兼容烟测或部署与数据库版本重新对齐前，不得直接执行生产回退。

### 4.3 错误定位：可查询，但 release 关联缺失

- `public.operational_errors` 共 1,946 条：`request.error` 1,945 条、`infra.disk_alert` 1 条；最近一条为 `2026-08-12T18:00:23.405Z`。
- 请求错误可按 `occurred_at`、`route_path`、`digest` 查询；最高频路由为 courseware（1,002 条）和 session detail（388 条）。本轮只读核查没有读取 `message`，避免带出 PII。
- 应用进程具备服务端写入条件，错误能够落入该表；但 `MATHIN_RELEASE`、`MATHIN_ERROR_REPORT_URL` 和 report token 均未配置。1,946 条现存记录的 `release` 全为空，无法按部署版本定位回归。
- 未主动制造错误，因为该动作会新增生产错误记录，超出本轮“无写入”边界。

## 5. Gate 差距结论

| Gate | 状态 | 已关闭 | 仍缺 |
| --- | --- | --- | --- |
| Gate 1 | `BLOCKED` | 目标域名、应用/数据库/Storage/compose 匿名指纹和部署 commit 已登记；仓库 fixture/rebuild/import 写入口及两个现有 purge RPC 合同已 fail-closed；本机已建立只绑定 `127.0.0.1` 且关闭自助注册的隔离 Supabase，11 个固定开发身份/profile、8 条 staff-role 绑定、11/11 Auth 密码登录及 1 条应用登录已验证；现有身份/业务对象完成匿名盘点 | 另行授权部署 manifest migration、分类真实对象并激活 protected-only 清单；正式管理员责任与恢复确认；正式教师、真实班级/课次/花名册；课次 release/snapshot/object 保护；授权范围复核 |
| Gate 3 | `BLOCKED` | 仓库危险写入口已拒绝误指 Xiaomi；两个现有 purge RPC 的目标绑定 manifest 合同已实现；current/previous 结构和回退命令位置已确认；错误表和查询维度已确认 | 另行授权部署并激活 protected-only manifest；立即建立并验证数据库+Storage 备份；恢复抽查；消除 73 条迁移的应用/数据库漂移并验证 rollback；配置 release 标识；在另行授权下制造并定位一次受控错误 |

这份证据证明 2026-08-14 的 Xiaomi 只读观察与 2026-08-15 的本机隔离目标补充事实。它不证明现有 `purpose=production` 对象是真实业务数据，也不证明备份可恢复、旧 release 可回退或正式账号可登录。
