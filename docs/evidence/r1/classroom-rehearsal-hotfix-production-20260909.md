# 候课、非排课时间提醒与试讲联动 · 生产发布

状态：**已部署生产，机器 postflight 通过，待真实设备与交互验收**。产品负责人因远程无法测试开发端局域网连接，明确要求部署生产，并随后要求「不需要备份」。本次按指令跳过新备份，保留上一应用版本；R1-Live-2 与既有 Gate 状态保持。

| 发布事实 | 结果 |
| --- | --- |
| `gate_id` / `domain` | `HOTFIX-20260909-CLASSROOM-REHEARSAL` / classroom |
| `result` | `PRODUCTION_DEPLOYED_MACHINE_POSTFLIGHT_PASS_PENDING_DEVICE_ACCEPTANCE` |
| `measured_value` / `threshold` | 候选策略 2、探针 0、业务计数与既有策略保持、发布后错误增量 0 / 精确候选及权限边界一致 |
| `commit_sha` | `28ae40e6c59446ebc6033ce7a28c4e15d1e667fe` |
| 候选来源 | 以原生产 `0f5fbd94` 为基线，独立 cherry-pick `ec940ce3`、`15e0ee45`；对应候选提交 `46e55920`、`28ae40e6`，已推送 `codex/classroom-hotfix-production-20260909` |
| current | `20260909-032243`，构建完成 `2026-09-09T03:24:44Z` |
| previous | `20260908-081359` / `0f5fbd942ed66f7c7678d05e0d9d4d3b9a60bbbd` |
| `started_at` / `finished_at` | 最终数据库基线 `2026-09-09T03:16:28Z` / postflight `2026-09-09T03:25:26Z` |
| `actor` / `approver` | Codex / 产品负责人本次明确授权 |
| `environment` | Xiaomi production；应用 `https://mathin.club`，Supabase `https://supabase.mathin.club` |
| 数据库指纹 | `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c` |
| `migration_head` | ledger `356 → 357`；head `20260909002000_classroom_rehearsal_channels` |
| `failure_ticket` | 远端默认 2 GiB heap 构建失败；同一候选以本次进程 4 GiB heap 重试通过，失败发生在应用切换前 |

## 交付与数据库范围

候课往返、全局翻页、非排课时间正式开课提醒和试讲设备联动同时进入本次 release。试讲按教师账号、课次或活动隔离，设备通过同一教师账号加入；正式课与公开课均有试讲候课和连接入口。具体行为见[候课与翻页开发证据](classroom-preparation-and-paging-hotfix-20260908.md)及[开课提醒与试讲开发证据](classroom-schedule-and-rehearsal-devices-hotfix-20260909.md)。候选只包含这两笔课堂修复，保留原生产其他功能基线。

按[写目标规则](../../runbooks/r1-write-target-policy.md)及[生产部署手册](../../runbooks/r1-production-deployment-preflight.md)核对 Windows 调用主机、开发回环 origin 与监听进程、SSH 目标、生产实际 origin、应用监听、数据库指纹、current/previous、锁与容量。原外置备份挂载不可用；产品负责人随后明确跳过新备份，本次没有创建数据库或 Storage 备份。

只应用 `20260909002000_classroom_rehearsal_channels.sql`，LF 归一化 SHA-256 为 `2d6219acda2331f1330f508b258ba992493618348b7c23b70a5f733a020926c8`。Git archive 原文上传后复核同一摘要，使用带目标、ledger 和锁守卫的 `SERIALIZABLE` 事务完成迁移、ledger、本人收发及越权/匿名/畸形频道/presence 权限断言，再完整回滚。独立连接确认 ledger、原策略和业务计数恢复，候选策略及广播探针均为 0，随后正式提交同一迁移与 ledger。正式事务内的权限探针通过 savepoint 回滚，仅留下预期两条策略；PostgREST schema cache 已刷新。

## 检查与业务不变量

- 隔离候选的 9 个课堂定向测试文件、62 项合同通过，覆盖候课、翻页、排课边界、试讲回放与并发收敛、互动同步、既有课堂连续性及离线协议。
- 本地完整 lint、类型检查和 production build 通过；lint 仅有既有构建工具的两条未使用变量 warning。密钥扫描覆盖 2718 个已跟踪文件，高置信命中为 0。
- 原子发布器首次远端 build 在 TypeScript 阶段达到默认 2 GiB heap 上限；确认线上版本未切换后，以 `NODE_OPTIONS=--max-old-space-size=4096` 仅重试同一候选的远端 install/build/deploy，373 页生成通过。该设置只用于本次构建，没有修改长期服务配置。
- 应用使用仓库 immutable release 发布脚本切换。服务 `active/running`、`NRestarts=0`、`ExecMainStatus=0`；loopback、Caddy 和公开域名 health 正常，Supabase 未带 key 的网关请求为预期 401。
- zh/en login 均为 200；班级、活动、正式课堂 live 和公开课 live 的匿名请求均精确重定向至相应 locale 登录页。生产客户端 bundle 包含非排课时间提醒、试讲频道与回放协议，并使用生产 Supabase origin。
- 发布后 journal error 增量为 0；`operational_errors` 保持 1970，最新时间仍为 `2026-09-09T01:55:17.770Z`。原有 Realtime 策略摘要保持一致，正式提交后候选策略为 2，广播探针为 0。

`dataset_manifest`：以下计数在迁移前、正式提交后及应用发布后完全一致。

| 对象 | 数量 |
| --- | --- |
| Auth 用户 / profiles / 学生 | `40 / 40 / 1466` |
| 班级 / 课次 / 报名 / 考勤 | `34 / 429 / 166 / 0` |
| 课堂事件 / 页面 / 课程 release | `148 / 77282 / 3774` |
| Storage 对象 | `126535` |

本次检查没有创建身份、班级、课次或真实课堂操作。生产 SQL 权限检查、构建与入口检查通过，真实教师登录后的双设备 WebRTC、页面操作、板书、媒体和视觉体验仍由产品负责人验收；开发端实际私有广播验证也不替代生产设备验收。

## 可复核产物与验收入口

`artifact_url_or_path`：`/home/swing/services/mathin/staging/classroom-policies-28ae40e6c594/` 保存迁移原文、权限断言、rehearse/apply SQL 和不含身份明细的 preflight/rehearsal/applied/postflight 摘要。访问角色为生产运维维护者；按 R1 发布证据保留策略留存。应用 current/previous 的 `release.json` 保留精确版本，应用异常可按既有流程原子回切 previous，新增兼容策略保留。

`artifact_hash`：完整候选 Git archive 的原始字节 SHA-256 为 `4e379e18b241f3d507c248e816dbd1167f0010a1f726199bf19bdebe30077b6a`；migration 使用上文 LF 归一化摘要。本轮是定向热修发布，不关闭产品阶段或正式 Gate。

验收入口：[班级／课次](https://mathin.club/zh/dashboard/classes) · [公开课](https://mathin.club/zh/dashboard/activities)。刷新生产页面后进入试讲，选择「连接试讲设备」，各设备使用同一教师账号；在非排课时间点击正式开课，核对提醒与进入试讲的选项。
