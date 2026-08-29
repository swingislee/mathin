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

## 7. 函数/RPC 热修执行补充

本节固化 2026-08-29 管理员自授岗热修的可复用教训，适用于已取得明确生产授权、只替换少量函数并发布兼容应用的变更。它不授权生产写入，也不替代 §1～6、写目标保险丝、备份或人工批准；事件经过见 [`admin-self-role-hotfix-production.md`](../evidence/r1/admin-self-role-hotfix-production.md)。

### 7.1 先冻结最终候选，再创建最终备份

1. 在开发目标完成业务正向、越权负向、函数 owner/ACL 和应用定向合同；确认工作树只含本批次文件。
2. 使用 `scripts/lib/text-hash.mjs` 的 `textFileSha256` 计算 migration 归一化摘要，提交并推送不可变候选。
3. 只有候选 commit 与 migration hash 都冻结后，才创建记入最终证据的写前备份；manifest 同时绑定两者。
4. rollback rehearsal 若暴露候选缺陷，先用独立连接证明 ledger、函数定义、ACL 和业务计数零残留，再修代码、形成新 commit/hash 并创建新的最终候选备份。旧备份可以保留为额外恢复点，但不得冒充最终候选绑定的备份。

### 7.2 只读查询不得复制旧证据中的 schema 名

- 生产统计 SQL 使用当前 migration/schema 或已审阅的版本化 SQL；不要从历史证据手抄表名、列名。字段不确定时先在只读事务查询 `information_schema`、`pg_catalog` 或 `to_regclass(...)`，再运行计数。
- preflight/postflight 使用 `REPEATABLE READ READ ONLY`，只输出聚合计数、布尔断言和时间，不输出账号、UUID、Cookie 或 secret。任一语句报错时整组检查不算通过；此前已经打印的部分结果也不能当作完整基线。
- 业务在发布窗口外仍可能正常增长。先把最新合法汇总冻结为本轮基线，再要求 migration 前后不变；不得用上一次发布的旧计数覆盖真实新增对象。

### 7.3 `CREATE OR REPLACE FUNCTION` 不会替你清理旧 ACL

- rehearsal 前查询函数的 `proowner`、`prosecdef`、`proconfig` 和 `proacl`。DDL 使用真实 owner；普通 `postgres`、`supabase_admin` 或其他同名运维角色不能互相替代。
- `CREATE OR REPLACE FUNCTION` 会保留已有 ACL。`REVOKE ... FROM PUBLIC` 只撤销伪角色 `PUBLIC`，不会撤销对 `anon`、`authenticated` 或 `service_role` 的显式授权。authenticated-only RPC 应显式先撤销实际 API 角色，再按目标重新授予，例如：

```sql
revoke all on function public.example_rpc(uuid) from public, anon, authenticated;
grant execute on function public.example_rpc(uuid) to authenticated;
```

- 不要只用 `has_function_privilege` 猜授权来源；用 `aclexplode(coalesce(proacl, acldefault('f', proowner)))` 展开实际 grantee。migration 后同时断言 authenticated/anon/service_role 的预期结果、owner、`SECURITY DEFINER` 和固定 `search_path`。

### 7.4 rehearsal、formal 与真实业务写分开

1. 从 Git archive 上传 LF 原文，远端摘要必须与仓库归一化摘要一致；rollback 与 formal 使用同一文件。
2. 在 `SERIALIZABLE` 事务中锁定目标指纹、旧 ledger/head、函数定义/ACL 和受影响业务计数；执行完整 migration、ledger insert 与最终断言后 `ROLLBACK`。
3. 使用新连接核对 candidate ledger row=0、旧函数/ACL 恢复、业务计数不变。只有该独立零残留检查通过，才允许运行同文件、同断言的 formal transaction。
4. formal 提交后刷新 PostgREST schema cache，再用独立只读连接核对 checksum、定义、ACL、业务/Storage 不变量和错误基线。
5. “部署授岗能力”不等于获准修改真实岗位。除非授权明确包含具体业务写入，生产 postflight 不调用自授岗 RPC；正负行为在隔离开发目标验证，真实管理员操作保持产品验收。

### 7.5 Windows 与多层 Shell 的已知误区

- 本仓库需要只跑一个 Vitest 文件时，优先直接调用 `& '.\node_modules\.bin\vitest.cmd' run 'tests/<file>.test.ts'`。`pnpm test -- <file>` 会把额外的 `--` 传给已有 `vitest run` script，可能退化为全量套件；看到实际展开命令后必须确认目标文件确实被过滤。
- PowerShell → SSH → Bash 的多层脚本不要在命令字符串中继续拼接可执行文本。优先使用仓库脚本或 UTF-8 base64 payload；Agent 编排层还必须避开 JavaScript template 的 `${...}` 插值和 Windows `D:\...` 反斜杠转义。
- 不要为了安心重复运行发布器已经包含的完整 lint/typecheck/build。候选冻结前运行本次风险所需的窄检查；原子发布器负责一次完整本地检查和一次远端 build。若 schema 与旧应用不兼容，改用 expand/contract 或拆分后的正式发布工具，不能靠临时命令调整顺序。
- staging 只使用本轮唯一、可验证的子目录。结束后解析绝对路径并确认仍位于 `service_root/staging/`，再精确删除；备份目录不随 staging 清理，也不得顺手 prune。

## 8. 证据与结论

下列九项全部 `passed` 才允许输出 `readyForAuthorizedExecution=true`：R1-14、R1-15、环境隔离、仓库 secret scan、监控探针、数据库恢复演练、Storage 恢复演练、应用回滚演练、非执行者复核。每项 `passed` 必须引用仓库内无 secret/PII 的小摘要与归一化 SHA-256。

preflight 通过不等于 R1-16 关闭，也不等于允许生产变更。实际部署仍需人员批准、维护窗、目标二次确认和部署后证据；R1-16 关闭还必须满足 doc 25 的 REC-01～04 与 SEC-04。
