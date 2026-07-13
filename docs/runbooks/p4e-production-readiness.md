# P4E 生产存续运行手册

本文件记录必须在真实基础设施上执行、不能靠仓库代码伪造完成的步骤。所有文本按 UTF-8 处理。

## 每日备份

1. 使用只读备份账号执行 `pg_dump --format=custom --no-owner --file <异机目录>/mathin-YYYYMMDD.dump "$DATABASE_URL"`。
2. 将 `session-videos`、`courseware`、`note-assets` 对象同步到不同物理设备或对象存储；备份端启用版本保留和静态加密。
3. 备份完成后计算 SHA-256，记录数据库行数摘要与 Storage 对象数/总字节数。
4. 监控数据库卷、Storage 卷和备份目标；任一磁盘使用率达到 75% 告警、85% 升级。

仓库已提供可部署的 systemd 单元与脚本：`scripts/infra/p4e-backup.sh`、`scripts/infra/p4e-disk-check.sh` 和 `deploy/p4e-ops/`。部署时：

1. 将仓库固定部署到 `/opt/mathin`，把 `p4e-ops.env.example` 复制到 `/etc/mathin/p4e-ops.env` 并设为 `0600`。
2. `BACKUP_ROOT` 必须是 NAS/异机文件系统挂载点；脚本默认拒绝把生产备份写到系统根分区。仅临时恢复演练可显式设 `ALLOW_LOCAL_BACKUP=1`。
3. 将四个 service/timer 文件安装到 `/etc/systemd/system/`，执行 `systemctl daemon-reload`，再启用两个 timer。
4. 先手工运行一次 backup service，核对 `SHA256SUMS`、`database-counts.json`、`storage-files.tsv`，再检查 timer 的下次执行时间。

备份采用 partial 目录写入、成功后原子改名，并用 `flock` 防并发；任何一步失败都不会留下看似成功的备份目录。磁盘检查同时验证最近成功备份是否超过 26 小时。

## 每月恢复演练

在隔离实例创建空库，用 `pg_restore --no-owner --exit-on-error` 恢复最近备份；随后应用 `pnpm migrations:ledger` 生成的账本断言，并以 `DATABASE_URL=... pnpm p4e:db-audit` 执行越权断言。核对学生、订单、支付、事件、视频对象数及抽样哈希。演练记录必须包含耗时、RPO、RTO、失败点和负责人。

Supabase 自托管镜像中的普通 `postgres` 角色不一定是 superuser。完整恢复包含 `realtime` schema 时必须使用集群恢复管理员（当前部署为 `supabase_admin`），否则会在恢复带 `SET log_min_messages` 的函数时失败。恢复只在隔离库执行，核验完成后销毁隔离库和临时 dump。

最近一次实际演练记录见 [`p4e-restore-drill-2026-07-13.md`](./p4e-restore-drill-2026-07-13.md)。该演练证明当前快照可恢复，不替代每日异机备份任务。

## 短信登录

手机号界面已接入 Supabase Phone OTP；上线前必须在自托管 GoTrue 配置国内短信 provider/hook、签名模板、发送频控和失败告警。未完成 provider 配置时保留邮箱登录，不把手机号入口宣传为可用能力。

2026-07-13 审计：当前 GoTrue 仅存在 phone enable/autoconfirm 基础项，未发现 SMS provider/hook 配置。此项仍是上线阻断项。

## 错误与课堂降级

`src/instrumentation.ts` 将服务端请求错误输出为结构化 JSON。生产日志采集器应把 `event=request.error` 推送到错误看板并按 route/digest 聚合。课堂仍以本地事件日志和 P2P 为可靠路径，Realtime 只提速；每季度执行一次断网 10 分钟、恢复后补同步演练。

## 发布门禁

依次运行 `pnpm lint`、`pnpm typecheck`、`pnpm p4d:audit`、`pnpm p4e:audit`、`DATABASE_URL=... pnpm p4e:db-audit`、`pnpm db:types:check`、`pnpm build`。任何 migration 应用后都运行 `DATABASE_URL=... pnpm db:types`，再生成 migration 账本。类型生成使用官方 Supabase CLI；生成文件不得手工编辑。
