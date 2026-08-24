# R1-Live 写入目标保险丝

## 结论

`xiaomi`、`https://mathin.club` 和 `https://supabase.mathin.club` 共同指向当前 R1-Live 生产系统。目标位于私网、曾作开发使用或在本机 `.env.local` 中配置，都不能降低其生产等级。

当前本地开发系统运行在 Windows 主机 `192.168.5.213`：Next 使用 `localhost:3130` / LAN `192.168.5.213:3130`，本机 Docker Supabase 只从 `.env.local` 暴露为 loopback `127.0.0.1:35421`。本机与 Xiaomi 的 Docker 容器名称相同；只有执行主机和 endpoint 能区分环境，不能凭 `supabase-db` / `supabase-rest` 名称判断。

保险丝只约束仓库中的写入命令，不改变线上应用、Supabase 服务、账号或现有数据。运行期正常业务写入继续由应用鉴权、RLS 和领域 RPC 控制。

## 命令分类

| 类别 | 入口 | Xiaomi 行为 |
| --- | --- | --- |
| 测试造数 | `r1:family-fixtures`、`r1:family-journey-fixture`、`r1:manual-dataset`、`p4e:offline-fixture` | 永久拒绝；没有生产放行参数 |
| 全库重建 | `ci:db-rebuild` | 永久拒绝；只接受明确 attestation 的 loopback 一次性数据库 |
| 课程内容写入 | `cw:import`、`cw:aixuexi:import`、`cw:adapt-4x3 --apply` | 默认拒绝；只为这三项保留受控生产通道 |
| 课程 dry-run | `cw:import --dry-run`、`cw:aixuexi:import --dry-run`、`cw:adapt-4x3 --dry-run` | 可执行本地构建和既有只读 preflight；不上传 Storage、不执行写 SQL |

数据库内的 `purge_test_*` RPC 不由 Node.js 保险丝覆盖。它们在正式身份/对象 manifest 落地前仍是 Gate 1 blocker，不得把本保险丝测试通过解释为生产清理已安全。

## 非生产写入

当前登记的非生产写目标只有 loopback。命令必须同时满足：

1. `MATHIN_WRITE_TARGET_ENVIRONMENT` 是批准的非生产枚举；
2. `MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN`、`MATHIN_WRITE_ALLOWED_DATABASE_TARGET` 等与实际参数精确相等；数据库 attestation 同时包含 host、port 和 database name，不包含凭据，连接 URL 的 query/fragment 一律拒绝以避免改写实际连接目标；
3. 目标不是生产域名、Xiaomi SSH alias 或已登记生产指纹；
4. 目标是 loopback。

LAN 或远程地址即使解析为私网、即使临时填写任意 SHA-256，也会以 `UNREGISTERED_REMOTE_TARGET` 拒绝。新增隔离开发/RC 目标时，先在代码评审中登记可复核的稳定指纹和精确入口，再扩展 policy；不得在本机临时绕过。

安全的本机默认值见 [`.env.example`](../../.env.example)。现有 `.env.local` 不会被此实现修改。

任何人工或 Agent 写入前必须输出并核对以下非敏感事实：命令运行主机、`.env.local` 的 Supabase origin、该端口的监听进程，以及是否使用 SSH。开发写入必须同时满足“Windows 本机 + loopback `127.0.0.1:35421` + 未使用 `ssh xiaomi`”；出现 `xiaomi`、`192.168.5.183` 或生产域名时立即转入生产门禁。数据库容器名称不得参与环境判定。

## 受控生产课程写入

生产课程写入不是当前 Gate 的执行授权。只有备份门、只读 preflight 和本次变更范围均经人工确认后，操作人才能在当前 Shell 临时设置下列 attestation：

- `MATHIN_WRITE_TARGET_ENVIRONMENT=production`
- Supabase 与 Storage 都精确使用 `https://supabase.mathin.club`，且 `MATHIN_WRITE_ALLOWED_SSH_TARGET=xiaomi`；生产通道不接受临时 LAN 上传入口
- `MATHIN_WRITE_TARGET_FINGERPRINT` 等于仓库登记的稳定 PostgreSQL system identifier 摘要
- `MATHIN_PRODUCTION_WRITE_CONFIRMATION=<operation>:<目标指纹前 16 位>`

命令还必须显式带 `--allow-production-target`。确认值只从当前进程环境读取，`.env.local` 中的同名值不会被接受。目标、指纹、操作名、CLI 开关或当前 Shell 确认任一缺失/不一致，都会在创建 Storage 客户端或执行写 SQL 前失败。

这条通道只允许 `cw:import` 和 `cw:adapt-4x3`；批量爱学习导入仅透传 `cw:import` 的同一控制。fixture、重建和 purge 没有共用的生产逃生开关。

## 证据边界

实现与合同测试只证明列出的仓库写入口 fail-closed。它不证明数据库内清理已具备正式对象保护，不证明当前有可恢复备份，也不构成任何一次生产写入授权。
