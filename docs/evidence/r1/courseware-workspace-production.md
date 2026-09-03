# DEV-CW-1 统一课件工作区生产发布证据

> **结论**：`PRODUCTION DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCT ACCEPTANCE`。2026-09-03 在产品负责人明确授权“授权生产发布”后，以窄范围候选 `8c50b48a8c4d69c6bad3fb3858bfd008dfa5b800` 完成生产只读 preflight、新鲜 PostgreSQL 写前备份、6 条 migration 的完整回滚／零残留演练与正式提交、应用原子发布和独立机器 postflight。本批没有全量备份、全量测试、Storage 写入、存量页面回填、release 推进或冻结会话改写。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `DEV-CW-1 / Step 8E`；预览／正式课／微课共享工作台、16:9/4:3 双轨草稿、PageDoc/source-runtime 编辑与插入、审核语义及旧发布链退休；`PRODUCTION DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCT ACCEPTANCE` |
| `measured_value`, `threshold` | ledger=`236→242`，head=`20260903000700_courseware_page_insertions`；6/6 migration checksum 与发布清单一致；20 个受影响 Vitest 文件 118/118、TypeScript、数据库类型摘要、受影响 ESLint、候选 production build 通过，发布器再次完成全量 ESLint、TypeScript、本地与远端 production build；服务 active/running、`NRestarts=0`、`ExecMainStatus=0`、发布后 journal error=`0`，loopback/Caddy health、zh/en login 与匿名保护路由通过 |
| `commit_sha`, `migration_head`, `environment` | `8c50b48a8c4d69c6bad3fb3858bfd008dfa5b800`；`20260903000700_courseware_page_insertions`；Xiaomi / production，current=`20260903-115645` / `8c50b48…`，previous=`20260903-100016` / `750bd607…` |
| `dataset_manifest` | pageDocs/pageRevisions/trackHeads/assetBindings/assetObjects/sharedAssets/assetRevisions/assetVariantHeads/releases/frozenSessions/Storage objects=`77224/121734/154284/559865/65554/65764/66506/73410/3770/4/126428`；迁移前后全部不变。`operational_errors=1959`，最新时间 `2026-09-02T08:25:03.669Z`，发布后无增量 |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-09-03T11:40:27Z`；`2026-09-03T12:01:19Z`；Codex；产品负责人明确指令“授权生产发布”，生产产品验收仍 `pending` |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 精确目标／范围／锁／容量 preflight → PostgreSQL custom dump → 真正 schema owner `supabase_admin` 下 `SERIALIZABLE` migration rollback/零残留/formal → `publish-mathin-xiaomi.ps1 -Action Publish` → release、HTTP、route manifest、数据库结构、函数、业务计数、错误与备份 postflight；未运行全量业务 E2E、生产写态 Playwright或 Storage 归档 |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | current `/home/swing/services/mathin/releases/20260903-115645/release.json`；previous `/home/swing/services/mathin/releases/20260903-100016/release.json`；数据库备份 `/mnt/openlist-disk/Backups/Mathin/mathin-db-prechange-20260903T114653Z-courseware-workspace-8c50b48a8c4d/`，dump bytes=`313059264`、SHA-256=`d364367d1a340998f2f2d91fb7b96e83789529a05da6bade013bf061bfd54bd0`、TOC=`4561`，`SHA256SUMS` SHA-256=`033491650d32163cc79219e438d2da7f92d1194dea7ff6b0dfc89ab318b5cca7`；生产结构快照 `C:\Users\admin\AppData\Local\Temp\mathin-courseware-rc-20260903-v4\production-courseware-schema-snapshot.json`，SHA-256=`07ffeb6ccf922fd83ecd50d1e3bb493d29bcdcfe41d63cfce534220e3fe99799`；仓库维护者/Xiaomi 运维角色 |
| `failure_ticket` | 正式写入前有两类 fail-closed 诊断，均未留下生产写入：最初两次备份尝试分别因主机缺少 `pg_restore`、容器内 `pg_restore` 把 `-` 识别为文件名而在 TOC 校验阶段停止，临时目录由 trap 清理；首轮 migration 演练因 `postgres` 不能 `SET ROLE supabase_admin` 在执行 migration 前中止并回滚。随后改为容器 stdin 校验和以真实 owner 直连，重新完成最终备份、完整回滚演练、独立零残留核对及正式事务 |

## 候选与发布边界

- 开发验收提交 `71b008dd` 与部署前生产基线不在直接祖先链。最终候选从实际生产基线 `750bd607918cefbb744e92a94a0485a39facc628` 建立独立分支 `codex/courseware-workspace-production-rc-20260903`，只投影统一课件工作区及直接依赖；最终候选 `8c50b48…` 恢复了已验收的共享 `CoursewareWorkbench` 课堂接入，没有回退到旧独立预览壳。
- 6 条 migration 依次为页面重命名、4:3 草稿启动、管理员对象能力、旧发布链退休、source-runtime 草稿和页面插入。正式事务后 ledger 从 236 增至 242，三个新函数 `rename_cw_page`、`save_cw_source_runtime_page_draft`、`register_cw_page_inserted_asset` 可用；旧直发 RPC `publish_cw_adapt_releases`、`publish_cw_track_release` 已退出。
- migration 前后 11 项课件／资源／release／冻结／Storage 计数完全一致。没有批量改写 77,224 个页面，没有预登记资源、推进 release 或更改冻结会话。

## 备份、演练与 postflight

- 按本次“非全量部署”授权只建立 PostgreSQL 写前备份；迁移不写 Storage，既有全量 Storage 恢复点保持不动。最终 dump、TOC、manifest、候选 commit、6 个 migration hash 与 `SHA256SUMS` 在发布后再次校验通过。
- 同一组 migration 先在 `SERIALIZABLE` 事务执行并回滚；新连接确认候选 ledger 行为 0、head 未变、旧 RPC 仍在、新函数未出现且 11 项计数不变。随后以同一 SQL 和 hash 正式提交。
- 发布器把 immutable release 原子切换到 `20260903-115645`。production route manifest 包含讲次工作区、教师微课审核与统一审核 canonical 路由，不包含旧 `/studio/courseware/**`；匿名访问 zh/en 保护路由按预期 307 到登录。

## 回退与人工验收边界

- 应用问题可立即切回 previous `20260903-100016` / `750bd607…`。数据库默认 forward-fix；只有确认数据破坏并取得事故授权后，才使用本轮精确 PostgreSQL dump 进入独立恢复流程。
- 当前机器 postflight 已通过，但不代表真实用户工作流已经验收。产品负责人仍需在生产登录后检查正式课、微课和爱学习的页面切换、框内文字编辑、插入、自动保存／刷新、撤销／重做以及 4:3 对照粗调到单轨微调流程。
