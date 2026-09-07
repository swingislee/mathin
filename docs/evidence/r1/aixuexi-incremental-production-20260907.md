# 爱学习两讲增量生产热更新

> **结论**：`PRODUCTION DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING PRODUCT ACCEPTANCE`。2026-09-07 按产品负责人“将这一变动增量热推送生产”的明确授权，完成两条迁移和 G+ 五、六年级秋季第 7 讲的生产导入。现有应用兼容本次数据，服务连续运行；应用 current/previous 指针和进程均保持原值。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `AIXUEXI-DELTA-20260907`；课程来源增量与名称清理；production deployed / machine postflight passed / pending product acceptance |
| `commit_sha`, `migration_head`, `environment` | 来源增量提交 `78c8a7cc4a9d4228965a3cbd89ef2e3374f06fa5`、`24885f090256d5704f087ac2dd2c559b2fce1fdb`、`1c2bbb54d6921d119b32baff25b12387ace5f722`；生产 head=`20260907000500_aixuexi_incremental_source_snapshots`；Xiaomi / production |
| `measured_value`, `threshold` | 2 讲各 29 页，共 58 页、315 个原生绑定；两个轨道共 630 个绑定、4 个初始 release、116 个页面 head；名称后缀清理 10 个讲次和 2 个课次；冲突/基线漂移均为 0 |
| `dataset_manifest` | 包 `2026-gplus-sujiao-math`；来源讲次 `1128947537`、`1128948185`；构建指纹 `0f4bcf75f55d0f7c431932c6e99caf61ae0e878da7f169f74596012b57ad816b` |
| `started_at`, `finished_at`, `actor`, `approver` | 最终范围 preflight `2026-09-07T06:54:20Z`；独立机器 postflight `2026-09-07T07:03:22Z`；Codex；产品负责人本次明确生产热推送指令 |
| `command_or_runbook` | [写目标保险丝](../../runbooks/r1-write-target-policy.md) → 冻结提交/迁移/产物 → 同主机 PostgreSQL 写前备份 → 两讲分别执行完整 migration + import 的 `SERIALIZABLE` / `ROLLBACK` → 独立零残留核对 → 同文件正式 migration → 两讲 `cw:import --incremental-source --allow-production-target` → 数据/Storage/HTTP/服务 postflight |
| `artifact_url_or_path`, `artifact_hash` | 生产留存 `/home/swing/services/mathin/content-releases/20260907-aixuexi-1c2bbb54/`；`tools.tar` SHA-256=`3c23d951dd3462e6ec4c6f337c94679aaa484b8046dfaa0272d581b3201420eb`，`build.tar.gz`=`6bd0141ffc178c0d19ecf5e40e32aca09cb20f15300a5f899e8384ec91f7a186`，`cas.tar.gz`=`ddcbfd356b7ff0e21cbada2a86027c52c03acc8890e8c30c934b9f9dbf2edbe0`，`promotion-manifest.json`=`6a52c7bf046fc41a3c7132127848a0897cfe4359ebe4035933c9a434eb796812` |
| `retention`, `access_roles` | 按 R1 受控发布证据保留策略，至少保留至 `v1.0.0` 后 365 天；Xiaomi 运维角色；本轮未清理备份、产物或历史数据 |
| `failure_ticket` | 正式写入前的备份目的地调整见下文；生产迁移和导入没有失败项；产品视觉/业务验收仍 pending |

## 精确范围与兼容性

- 生产原账本为 259 行、head=`20260904000100_classroom_import_setup_workspace`。本批只增加两条已提交迁移，最终为 261 行；其他开发分支中的迁移和功能保持各自发布边界。
- `cw-import.mjs` 相对生产应用基线的变化均属于本次单讲增量支持。现有 source-runtime schema、呈现运行时和交付协议保持兼容，因此本批采用数据库及 Storage 热更新。
- 导入工具及直接依赖共 19 个文件，以最终提交的 Git archive 留存生产；构建、CAS 与推广清单分别保存并验证摘要。HAR、账号凭据及其他开发业务数据均未包含在课件包中。
- 同目录 `evidence/` 留存 13 个聚合记录及操作脚本，逐项 SHA-256 复核通过；`EVIDENCE_SHA256SUMS` 的 SHA-256=`405d5e4ede0fe865fff5bd227cea5ba18a839edac6078df01d12b2597b816a5b`。
- 两个生产目标均由 `product_code + 第7讲` 唯一映射；写前 template、page、release 数量均为 0。生产讲次身份由目标库解析，未复用开发库 UUID。

## 写前备份与演练

生产主机、实际 Supabase origin、监听进程与数据库组合核对通过：主机 `xiaomi`，Supabase=`https://supabase.mathin.club`，应用监听 `127.0.0.1:3131`，PostgreSQL 稳定指纹=`10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`。发布窗口未来两小时排课为 0。

原 `/mnt/openlist-disk` 外置盘当前未挂载。自动审批拒绝了“复制生产全库备份到本机并修改目录 ACL”，理由为本次热推送未明确授权跨环境数据导出；该动作没有执行。随后采用生产主机现有 `deployment-backups` 目录，同一生产边界内完成备份和校验，只返回摘要。此备份是当前同主机恢复点，不宣称异机或独立故障域保护。

| 备份字段 | 值 |
| --- | --- |
| 目录 | `/home/swing/services/supabase-project/deployment-backups/mathin-db-prechange-20260907T065556Z-aixuexi-1c2bbb54` |
| PostgreSQL custom dump | 313352464 bytes；SHA-256=`9b20cd3b3b0a63d8e8649c86f38dd5d46a57185bf0181d2501165370cb809873` |
| `database.toc` | 4738 行；SHA-256=`025c2331abbb87a6e391ebd57268fcf31e9eadefdd79399ab2ce80c747d0bea8` |
| `SHA256SUMS` | SHA-256=`a51975df4c4e7f6c0eaee9e276a3a1e87895f5bd062dba092cd8c43772c04d07` |

迁移、账本写入和各讲完整导入先在事务内演练并回滚。独立连接确认账本、候选表、名称、空目标、业务计数、其他课件历史指纹和错误基线与写前完全一致，之后才执行正式提交。最终 postflight 再次验证备份文件摘要通过。

| Migration | LF 归一化 SHA-256 |
| --- | --- |
| `20260907000400_remove_lecture_placeholder_labels` | `d364e43eed61cc3e85956555cc440107bd26098e02dde0342423d8fd6f274198` |
| `20260907000500_aixuexi_incremental_source_snapshots` | `ba6d945794a17e6d927c9817f3fb1410e04642fe5f2922341bc9da52e50ec8a3` |

## 生产 postflight

- 两讲各 29 页，原生/4:3 各生成 release 1；两个回执关联正确的讲次、快照和双轨 release。快照共 5 条：4 条旧包回填加 1 条本次完整 manifest；RLS 和两个不可变触发器启用，API 角色没有新增写权限。
- 新增 25 个资源对象及共享资源（其中 1 个运行时包）；Storage 新增 106 个对象。对相关全部 115 个线上对象逐一读取并校验 24446211 bytes 的长度与 SHA-256，全部通过；9 个既有 Storage 对象的完整元数据保持一致。
- 页面数 `77224→77282`、release `3770→3774`、来源讲次 `172→174`、Storage 对象 `126428→126534`。课程/讲次数 `106/1336`，正式身份、学生、班级、课次、报名、点名数量保持原值；既有来源包、其他来源讲次、其他 release/head、班级、课次业务字段、报名和点名聚合指纹保持一致。
- 相同输入再次 dry-run，两讲均为 `reuse`。本批未重导既有讲次，也未改写冻结课件历史。
- 服务 active/running；进程仍为发布前的 PID `2476403`，启动时间 `2026-09-04T10:40:29Z`，`NRestarts=0`、`ExecMainStatus=0`。current=`20260904-103900` / `c913ea2f…`，previous=`20260904-093837` / `4b227e80…`。
- loopback/Caddy health 均为 ok；zh/en 登录返回 200，两讲匿名路由均按预期 307 到登录。发布窗口 journal error=0；`operational_errors` 保持 1962，最新时间仍为 `2026-09-04T10:14:49.338Z`。

生产待产品验收：[五年级 G+ 秋季第 7 讲](https://mathin.club/zh/dashboard/courseware/lectures/bf5acf75-726d-4016-bbef-379ea8f82e37)、[六年级 G+ 秋季第 7 讲](https://mathin.club/zh/dashboard/courseware/lectures/2f7fc674-7b81-4d2c-bfc5-469395fda6e6)。机器检查证明本次发布合同；人工视觉、课堂使用和业务验收由产品负责人完成。本记录不关闭 R1-Live Gate 2 或其他规划阶段。

回退采用兼容性保留和 forward-fix；生产数据库恢复及不可变课件历史删除须按具体事故重新授权。本批只准备并验证备份，没有执行生产恢复或清理。
