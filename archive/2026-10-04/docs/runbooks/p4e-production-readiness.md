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

备份采用 partial 目录写入、成功后原子改名，并用 `flock` 防并发；任何一步失败都不会留下看似成功的备份目录。磁盘检查同时验证最近成功备份是否超过 26 小时。磁盘 warning/critical 会写入只读 `operational_errors` 看板；配置 webhook 后再同步发到外部接收端。

## 每月恢复演练

在隔离实例创建空库，用 `pg_restore --no-owner --exit-on-error` 恢复最近备份；随后应用 `pnpm migrations:ledger` 生成的账本断言，并以 `DATABASE_URL=... pnpm p4e:db-audit` 执行越权断言。核对学生、订单、支付、事件、视频对象数及抽样哈希。演练记录必须包含耗时、RPO、RTO、失败点和负责人。

Supabase 自托管镜像中的普通 `postgres` 角色不一定是 superuser。完整恢复包含 `realtime` schema 时必须使用集群恢复管理员（当前部署为 `supabase_admin`），否则会在恢复带 `SET log_min_messages` 的函数时失败。恢复只在隔离库执行，核验完成后销毁隔离库和临时 dump。

最近一次实际演练记录见 [`p4e-restore-drill-2026-07-13.md`](./p4e-restore-drill-2026-07-13.md)。该演练证明当前快照可恢复。异机备份由用户于 2026-07-13 明确暂缓，仓库保留脚本与部署接口，不作为当前计划 13 的阻断项。

## 短信登录

手机号界面已接入 Supabase Phone OTP；正式启用前必须在自托管 GoTrue 配置国内短信 provider/hook、签名模板、发送频控和失败告警。未完成 provider 配置时保留邮箱登录，不把手机号入口宣传为可用能力。

2026-07-13 用户决定：短信供应商暂缓选择，只保留 Phone OTP 与 SMS hook 接口；该外部接入不作为当前计划 13 的完成阻断项。

## 错误与课堂降级

`src/instrumentation.ts` 将服务端请求错误输出为结构化 JSON；配置 `MATHIN_ERROR_REPORT_URL` 后还会按 Next.js 官方 `onRequestError` 生命周期同步投递到 HTTPS 接收端，可用 bearer token 鉴权。payload 不含请求头、query 和用户数据，错误消息截断为 2,000 字符。接收端应按 `routePath`、`routeType`、`digest` 聚合并对 `observability.delivery_failed` 告警。

上线验收必须主动触发一次受控 Server Action 错误，在看板确认事件、环境和 release 均正确；仅看到 stdout 不算错误看板验收通过。

课堂仍以本地事件日志和 P2P 为可靠路径，Realtime 只提速；每季度执行一次断网 10 分钟、恢复后补同步演练。

`pnpm p4e:offline-test` 是发布门禁中的自动化下限：验证事件在 UI 回显前进入 IndexedDB outbox、重启后 seq 不回退、离线 flush 不误删，以及无服务器时同设备双窗仍能通过 BroadcastChannel 通信。它不替代有教师账号、真实课件和 10 分钟时长的现场断网演练。

可重复现场演练步骤：

1. 设置仅本机可读的临时文件：`P4E_FIXTURE_FILE=<临时目录>/mathin-p4e-offline-fixture.json`，运行 `pnpm p4e:offline-fixture create`。
2. 使用临时教师账号打开脚本给出的课堂，给 live URL 加 `?mode=offline-drill`。该模式只允许教师进入，停用 Realtime 和服务端 flush，但保留 IndexedDB outbox 与同机同步。
3. 连续操作至少 10 分钟，确认“待回传”持续递增；刷新一次，确认原队列仍显示且序号继续递增。
4. 去掉 `mode=offline-drill`，等待一个 15 秒 flush 周期，确认“待回传”消失；运行 `pnpm p4e:offline-fixture verify`，数据库事件数必须与演练队列数一致。
5. 运行 `pnpm p4e:offline-fixture cleanup` 删除临时账号、课堂和凭据文件。

2026-07-13 首次完整演练：在真实课堂页面受控停用服务端传输 10 分钟，累计 9 条翻页事件，刷新后队列仍在；恢复普通模式后 UI 队列清零，服务端精确计数为 9，随后已清除临时数据。

## 发布门禁

依次运行 `pnpm lint`、`pnpm typecheck`、`pnpm p4d:audit`、`pnpm p4e:audit`、`pnpm p4e:offline-test`、`DATABASE_URL=... pnpm p4e:db-audit`、`pnpm db:types:check`、`pnpm build`。任何 migration 应用后都运行 `DATABASE_URL=... pnpm db:types`，再生成 migration 账本。类型生成使用官方 Supabase CLI 或自托管 pg-meta 的官方生成器；生成文件不得手工编辑。
