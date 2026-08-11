# R1-16 独立生产部署只读 Preflight

本手册固定 R1-16 在任何生产切换前必须满足的环境、密钥、监控、备份、恢复与回滚合同。仓库内的 planner 只读取 manifest 与已登记的小型证据摘要；它不联网、不读取部署环境变量、不执行 SSH、部署、备份、恢复、DNS 或数据库操作。

## 1. 适用边界

- 2026-07 的 Xiaomi Linux standalone、Caddy、Supabase 和原子 release 能证明部署机制存在，不能证明 R1-16 的“开发、预生产、生产完全隔离”。
- R1-16 依赖 R1-14、R1-15。两阶段的退出证据未登记为 `passed` 时，preflight 必须输出 blocker。
- manifest 只允许 `mode=plan-only`、`writesAllowed=false`、`networkAllowed=false`。任何生产写入、备份生成、恢复或回滚都必须在后续获批窗口由人单独执行。
- Story、Games、Minds、Terms、Tools 暂缓不放宽 SEC-04、REC-01～04；最终 build、完整烟测与恢复证据仍须在五条线恢复后重跑。

## 2. 使用方式

1. 复制 `docs/manifests/r1-production-deployment.example.json` 到 Git 外受控位置。
2. 用归一化 SHA-256 指纹描述当前共享基线、独立生产候选和隔离恢复目标。指纹不得是主机名、IP、项目 ref、数据库 DSN、Storage key 或 secret 的明文。
3. 只登记受控引用名，例如 `secrets/production/mathin/supabase-secret-key` 或 `config/production/backup/off-host-root`；不得登记其值。
4. 将每个已完成验证写成无 secret/PII 的小摘要，计算归一化 SHA-256，再把本地摘要路径与 hash 写入 `evidence`。
5. 运行 `pnpm r1:deployment-plan <manifest>`。输出相同输入必须得到相同 `planHash`。

example manifest 只展示结构，所有环境证据保持 `pending`，不能作为 R1-16 通过证据。即使实际 manifest 全部通过，planner 也只输出 `readyForAuthorizedExecution`，不会执行动作。

## 3. 环境与密钥

当前共享基线、生产候选、恢复目标的 host、Supabase project、database cluster、Storage namespace 指纹必须逐项不同。开发与生产的应用域名、Supabase 域名也必须不同；生产应用域名与生产 Supabase 域名不得相同。

应用与基础设施配置至少绑定：

- `NEXT_PUBLIC_SITE_URL`、`NEXT_PUBLIC_SUPABASE_URL`：从目标域名生成；
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`：public exposure，但仍只登记受控引用；
- `SUPABASE_SECRET_KEY`、`MATHIN_ERROR_REPORT_TOKEN`、`ALERT_WEBHOOK_URL`：server-only secret 引用；
- `MATHIN_RELEASE`、`R1_JOB_WORKER_ID`：分别由 release metadata 与实例身份注入；
- `MATHIN_ERROR_REPORT_URL`、`BACKUP_ROOT`：server-only config 引用。

生产环境文件只存在于生产主机的 owner-only 配置目录，不进入 release、Git、日志或证据。生产构建后必须执行仓库 secret scan，并登记无命中摘要。

## 4. 监控门

| 对象 | 合同 |
| --- | --- |
| Mathin liveness | `GET /api/health`；≤5 分钟发现，连续 2 次失败触发告警 |
| Supabase gateway | `/auth/v1/`；无 key 的预期 `401` 视为网关可达 |
| 数据库保护 | 最近可恢复点年龄≤15 分钟；告警必须进入独立接收端 |
| Storage 保护 | 最近可恢复副本年龄≤24 小时；对象 manifest hash 可核对 |
| 磁盘 | 75% warning、85% critical |
| TLS | 剩余有效期不足 14 天告警 |
| Jobs | dead-letter、租约停滞和最终失败可查询并告警 |

监控验证必须包含一次受控失败与恢复；只看到正常 health 响应不能证明告警链路。

## 5. 备份与恢复门

- 数据库：RPO≤15 分钟、RTO≤4 小时，需要连续归档/PITR 或等价机制；`p4e-backup.sh` 的日常逻辑 dump 可作为补充副本，不能单独证明 REC-01。
- Storage：RPO≤24 小时、RTO≤8 小时；异机、加密、版本化/不可变保留，并保存对象 manifest hash。
- 数据库与 Storage 的恢复点必须位于独立故障域，保留期至少 30 天，并周期校验摘要。
- 恢复只在 `isolated-restore-drill` 目标执行；恢复目标的 host、Supabase project、database cluster、Storage namespace 四个指纹必须与当前共享基线和生产候选均不同。
- 全量恢复后运行登录、公开只读、Dashboard 只读、release 读取和对象 hash 烟测；需要写入班级/订单的旅程只在预生产执行。
- 演练记录开始/结束时间、恢复点时间、RPO、RTO、commit、migration head、数据 manifest、执行人和非执行者复核人。

## 6. 应用与数据库回滚

- 应用保留上一已知稳定的 immutable release，以原子指针切换并在 30 分钟内恢复 `/api/health` 和 Caddy 路径。
- 回滚前核对目标 release commit、运行环境指纹、数据库兼容性和维护窗批准；不得只凭目录名选择目标。
- 数据库迁移默认使用向后兼容部署与 forward-fix。planner 永不授权自动恢复生产数据库。
- 只有经事故负责人确认数据破坏、选定明确恢复点并再次批准，才可进入独立的数据库恢复流程。

## 7. 证据与结论

下列九项全部 `passed` 才允许输出 `readyForAuthorizedExecution=true`：R1-14、R1-15、环境隔离、仓库 secret scan、监控探针、数据库恢复演练、Storage 恢复演练、应用回滚演练、非执行者复核。每项 `passed` 必须引用仓库内无 secret/PII 的小摘要与归一化 SHA-256。

preflight 通过不等于 R1-16 关闭，也不等于允许生产变更。实际部署仍需人员批准、维护窗、目标二次确认和部署后证据；R1-16 关闭还必须满足 doc 25 的 REC-01～04 与 SEC-04。
