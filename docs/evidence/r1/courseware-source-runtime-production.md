# DEV-CW-SOURCE-1 来源课件运行时与暑期 A+ 生产证据

> **结论**：`DEPLOYED / PENDING_USER_ACCEPTANCE`。2026-08-28 在产品负责人明确授权下完成 Xiaomi 生产全量 PostgreSQL + Storage 写前备份、来源运行时应用发布、两条迁移、爱学习秋季 G+/X+/A+ 既有 170 讲原位升级，以及暑期 A+ 15 讲目录与第 1/8 讲导入。机器 postflight 与生产 Chrome 4:3 实看通过；产品负责人仍需完成最终业务验收。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `DEV-CW-SOURCE-1`；courseware source-runtime/import/catalog；`DEPLOYED / PENDING_USER_ACCEPTANCE` |
| `measured_value`, `threshold` | 两条 migration rollback rehearsal 零残留后正式提交，ledger=`206→208`；四个来源包全部为 `source-runtime-v1/imported`；172 讲、5508 页的两个当前轨道共 `11016` 个 page head，旧文档版本当前 head=`0`；秋季 170 讲升级冲突/基线漂移=`0/0`；暑期 A+ 为 15 讲，其中第 1/8 讲=`34/32` 页、共 550 bindings，其他 13 讲为空占位且无来源内容；最终课程/讲次/release/Storage object=`103/1330/2977/125725` |
| `commit_sha`, `migration_head`, `environment` | 生产候选 `b4ad4a9deb9b31d6b05cac66351045a6a5d4007a`，主线集成 `d5314e4`；head=`20260828000200_courseware_summer_a_plus_catalog`；Xiaomi / production，current=`20260828-044105`，previous=`20260828-040041`，两者均为候选提交 |
| `dataset_manifest` | 秋季来源包 `2026-gplus-sujiao-math`、`2026-xplus-sujiao-math`、`2026-aplus-quanguo-math`；暑期来源包 `2026-summer-aplus-quanguo-math`；暑期课程 `AXX26A-QG-01-SUM` / `f73ae240-d19a-45bf-a04d-92347d011a1b`，内容讲次 UUID=`ac37976b-7483-4872-8f42-af75389385ce`、`fd366065-faa6-409f-b596-17f4485a947a` |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-28T02:25:36Z`；`2026-08-28T05:00:12Z`；Codex；产品负责人明确指令“将上面的改动同步到生产库”，最终产品验收仍 `pending` |
| `command_or_runbook` | [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 只读 preflight → 全量 PostgreSQL + Storage 备份及双重 SHA-256 复验 → `publish-mathin-xiaomi.ps1 -Action Publish` 双 build/原子切换 → 两 migration 完整事务 rollback/零残留/formal → `aixuexi-build-package.mjs` / `aixuexi-import-all.mjs` 逐包 dry-run/formal → 第二次同提交发布固定 rollback 兼容性 → 独立服务/HTTP/数据库/对象保护/错误 postflight → 已登录生产 Chrome 两讲 4:3 实看与互动启动。生产未创建测试账号、班级、课次或点名夹具 |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | release `/home/swing/services/mathin/releases/20260828-044105/release.json`；备份 `/mnt/openlist-disk/Backups/Mathin/mathin-20260828T022536Z-courseware-source-runtime-b4ad4a9/`；主要 SHA-256 见下表；本轮未 prune、未 restore，按受控生产备份策略保留；仓库维护者/Xiaomi 运维角色 |
| `failure_ticket` | `not_applicable`。首次浏览器页签在长导航中失去控制，换同一 Chrome 的新页签后复验通过，不是生产故障。互动页控制台仅见来源脚本对禁用占位 DSN `https://disabled.invalid/0` 的 Sentry 配置错误；课件渲染与互动均正常，生产 journal 与 `operational_errors` 无新增 |

## 写前边界与备份

- preflight 同时核对执行主机、应用 Supabase origin、监听服务和数据库指纹；三处指纹均为 `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`。发布窗口最近 60 分钟课堂事件与未来 2 小时排课均为 0。
- 写前业务基线为 auth/profile/student/family/course/lecture/release/class/session/enrollment/attendance=`14/14/5/3/102/1315/2633/3/16/1/0`，Storage object=`123602`，`operational_errors=1949`；最新错误时间 `2026-08-22 15:53:09.807+00`。
- 完整备份包含 PostgreSQL dump/TOC、Storage 压缩归档、写前写后数据库计数、Storage 文件清单与四份课件回滚 CSV。Storage 文件清单为 `125135` 个文件、`50887768212` bytes；备份前后清单和数据库计数逐项一致。

| 备份文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `database.dump` | 249911947 | `fbab99105cd8fc71aba35fcda4e6fa0931f86d350398eceef745033736dee58a` |
| `storage.tar.gz` | 47869458194 | `b736c5d78384b3c8e31a5ea81534b1ff6dec7ed0e91525222c4f4fd6743aab9c` |
| `database.toc` | 348341 | `3995d4b82151efa7561b0425ee332648d9facb3ea8a4c9ce0deb8f40a25aefd8` |
| `manifest.env` | 234 | `8dd20a1e449e22ddb1add54398172503d67621b9e00ab05ff526f2a2b31e3f52` |
| `courseware-source-packages.before.csv` | rollback CSV | `b58c23dbd46fa37923437426903c6119589e166237a470dc995ac26d7526bcc5` |
| `courseware-lecture-heads.before.csv` | rollback CSV | `82471dd0ba4e4eacbf8000701e8c34d3b8c4fb0b00021fe4fe8484a1624e7877` |
| `courseware-page-heads.before.csv` | rollback CSV | `5c6bfb49b62c97ac1cb5623092b013f3a540d3962c6993859f57e211af431e0d` |
| `courseware-bindings.before.csv` | rollback CSV | `cb8af20ac942f2397ce4a12b5fa230c5739a339711c456703868e3ba1df55f95` |

`pigz -t`、初次 SHA 生成和两轮 `sha256sum -c` 全部通过。备份完成后未删除任何旧备份，也未执行恢复。

## 迁移、导入与发布结果

- migration `20260827000500_courseware_source_runtime_adapter` 的 LF 规范化 checksum=`2d171af242704eddbce01b727f15280c77f4eac6044756a3054094f814983a58`；`20260828000200_courseware_summer_a_plus_catalog` checksum=`e90f8c19f6a0873c2df6edab8397b09d7c511bcc870500ab6d50ec1b924401b5`。完整 `SERIALIZABLE` rehearsal 包含 DDL、账本和最终断言，回滚后独立连接确认零残留，再执行正式提交。
- 秋季三包 dry-run/formal 分别为 G+ `56` 讲/`1641` 页/`11132` bindings、X+ `84`/`2767`/`19729`、A+ `30`/`1034`/`15591`；三包 `sourceRuntimeUpgraded=5442`，冲突和 baseline drift 均为 0。既有讲次两个轨道均推进到 release 2、页面推进到 revision 2。
- 暑期 A+ dry-run/formal 为 `2/2` 讲、`66` 页、`550` bindings；两个轨道产生 4 个 release 1 head 和 132 个 revision 1 page head。第 2～7、9～15 讲保持 `courseware_template=[]`、`current_release_id=null`，且没有 `cw_source_lectures`。
- 应用先发布 `20260828-040041`，完成数据升级后再从相同候选提交发布 `20260828-044105`，使 current/previous 都能读取 `source-runtime-page-v1`。两次本地 lint/typecheck/build、Xiaomi production build 与原子切换通过；最终服务 active/running、`NRestarts=0`、`ExecMainStatus=0`，loopback/Caddy/公网 health 与 zh/en login 均通过，发布窗口 journal error=`0`。

## 生产 postflight 与视觉实看

- 独立只读事务复核 ledger/head/checksum、课程目录、来源包、172 讲/5508 页、344 个 lecture head、11016 个当前 page head、13 个空占位、正式对象保护 manifest 和业务计数；所有断言通过。最终 Storage object=`125725`、bytes=`51428257520`；`operational_errors` 仍为 `1949`，最新时间未变化。
- 生产 Chrome 使用现有已登录会话，不读取 cookie/local storage，不创建账号或夹具。第 1 讲 4:3 首页正常满幅；“妙答连连1”页一比一呈现源版标题、题数和橙色“开始”，点击后进入 1/3 苹果数量题。第 8 讲 4:3 首页正常满幅；“单步训练1”同样显示源版画面与橙色“开始”，点击后进入 1/3 凑十法题。
- 实看证明本次抽查的两讲可加载且互动可启动，不等于产品负责人对全部 66 页、课堂投屏或所有终端完成验收。当前结论保持 `PENDING_USER_ACCEPTANCE`。

## 尚未证明

- 未由产品负责人在生产手工逐页核验两讲全部 66 页，也未覆盖每个来源互动的所有答题分支、音频、视频和嵌套 H5。
- 未把生产截图提交到 Git；仓库只保留去标识化文字摘要，避免把浏览器会话或潜在业务数据写入共享证据。
