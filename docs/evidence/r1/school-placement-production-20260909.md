# 学服补入、档案与分班调整 · 生产发布

状态：**开发端分班交互已获用户验收，已部署生产，机器 postflight 通过；生产实际交互待验收**。产品负责人先要求“验收通过，推送生产”，在生产事务回滚演练的授权说明后再次要求“推送生产”。当前仍为 R1-Live-2，本批发布不关闭阶段或正式 Gate。

| 发布事实 | 结果 |
| --- | --- |
| `gate_id` / `domain` | `RELEASE-20260909-SCHOOL-PLACEMENT` / school support |
| `result` | `PRODUCTION_DEPLOYED_MACHINE_POSTFLIGHT_PASS` |
| `measured_value` / `threshold` | 8 项迁移摘要一致、回滚零残留、业务数据保持、错误增量 0 / 精确候选及权限边界一致 |
| `commit_sha` | `c63a47b5b0d5031ea3c34cd934fbf6307abd37b0` |
| 候选来源 | 以原生产 `28ae40e6` 为基线，独立挑入本任务 19 笔已完成增量；已推送 `codex/school-placement-production-20260909`，保留此前课堂热修 |
| current | `20260909-042441`，构建完成 `2026-09-09T04:26:42Z` |
| previous | `20260909-032243` / `28ae40e6c59446ebc6033ce7a28c4e15d1e667fe` |
| `started_at` / `finished_at` | 数据基线 `2026-09-09T04:20:31Z` / 最终运行检查 `2026-09-09T04:47:27Z` |
| 迁移提交 / 应用切换 | `2026-09-09T04:39:35Z` / `2026-09-09T04:42:22Z` |
| `actor` / `approver` | Codex / 产品负责人本次明确授权 |
| `environment` | Xiaomi production；应用 `https://mathin.club`，Supabase `https://supabase.mathin.club` |
| 数据库指纹 | `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c` |
| `migration_head` | ledger `357 → 365`；head `20260909002100_enrollment_confirmed_class_mismatch` |

## 发布范围

本批包含学服工作表行旁补入、空位录入、资料修订与家庭关联、学生档案合并，以及分班表退课、完全调班、按讲次临时调班和预约座位容量校验。姓名区域可直接拖动，落入班级后顺排空位，悬浮仅高亮对应单元格。课程、年级或学期不匹配时先显示明确弹窗；老师填写原因并确认插班后，服务端仍检查操作权限、班级范围、容量、座位和课次锁定。

业务操作继续保留原报名、历史名单与审计；退课不自动处理资金流水。生产发布只提交结构、函数、权限及迁移账本，没有新建身份、班级、学生或演练业务记录，也没有实际退课、调班、档案合并或 Storage 写入。

## 备份、演练与迁移

按[写目标策略](../../runbooks/r1-write-target-policy.md)和[生产部署手册 §7](../../runbooks/r1-production-deployment-preflight.md#7-函数rpc-热修执行补充)核对主机、实际 origin、监听进程、数据库指纹、current/previous 和迁移账本。候选冻结后完成生产 PostgreSQL custom dump，核验 TOC 与摘要：

- 备份目录：`/home/swing/services/mathin/backups/mathin-db-prechange-20260909T042100Z-placement-c63a47b5b0d5`。
- 数据库备份大小 `337162994` bytes，TOC `6173` 行；数据库 SHA-256 为 `721fda5739772144ef37c04dc522cc5d1993811d14bf9b12cb2f61e36613d054`。
- manifest 绑定最终候选、8 项迁移摘要和业务基线；目录以 owner-only 权限创建，原备份保留。
- 备份保存在生产主机，未复制到开发机；外置备份挂载不可用，本条不作为异机恢复或 PITR 通过证据。

Git archive 上传的 LF 迁移原文与下表一致。在带目标指纹、旧账本、发布锁及超时守卫的 `SERIALIZABLE` 事务内执行全部迁移、账本写入、业务摘要与权限断言，然后 `ROLLBACK`。独立连接确认旧账本、函数定义及 ACL、策略、约束和业务摘要恢复，候选新表数为 0。正式事务使用同一迁移和断言，通过后提交并刷新 PostgREST schema cache；6 张新业务表在正式提交时均为空。

| 迁移 | LF SHA-256 |
| --- | --- |
| `20260908160000_school_support_manual_entry` | `ce4079d75c3e86272e0a8be5a8f59713e63cfb98571f9c92f7403796bdaa97f9` |
| `20260909000100_school_support_inline_intake` | `89e060f67774a26cebd5d7e5983acc0406ceb26a4b88ae347aa2a84c8332d4bf` |
| `20260909000200_student_profile_merge_review` | `4f075cf08fda93d637ed61b4772d13c8f4dcd03196626b8a088f9338c5c9bee9` |
| `20260909000300_school_support_profile_intake` | `007b7591ff8cdfb6959c2007eb356b9b88e9c41741206c41f12d70a28ed07420` |
| `20260909000400_school_support_profile_family` | `950b764a904f35d0475f9757f42fde51386e3cebabb0786264e8c59026f219af` |
| `20260909000500_enrollment_session_transfers` | `33fc4108f10b0e75eae0eff3a674d2b3cfaf860f29a68fa82df457e55e5f38d9` |
| `20260909000600_enrollment_reserved_seat_capacity` | `881e4d51929d7dcfaf984e37ef07aea905270a1e53b9fe247f199df3f04d0266` |
| `20260909002100_enrollment_confirmed_class_mismatch` | `ed678972fa644eb933a3d00796d0521419fc80e5888ca31051625550720baf99` |

## 检查与业务不变量

- 复用开发端已通过的相关交互和 SQL 合同，覆盖拖动确认、显式插班、讲次映射、冻结保护、预约容量、幂等、取消与回滚、匿名及越权边界。本地独立候选完整 lint、类型检查和 production build 通过；lint 保留构建工具两条既有 warning。
- 远端完成独立 install/build，373 页生成通过。先构建 immutable release，再执行迁移和受守卫的原子切换；健康失败时恢复 previous。切换时核对新进程实际目录，生产环境文件未进入 release。
- 生产构建后仓库密钥扫描覆盖 2766 个已跟踪文件，高置信命中 0。
- 生产只读事务内，以既有管理员的 authenticated 上下文验证分班表、临时安排列表、六个学服工作表读取、原三参数及新四参数讲次预览；普通不匹配预览被拒绝，明确允许不匹配的预览成功。检查只调用读取 RPC。
- loopback、Caddy 与公开域名 health 正常；Supabase 未带 key 网关返回预期 401。zh/en login 均为 200；分班、线索及学生入口匿名访问均为 307，精确返回对应 locale 登录页并保留 `next`。
- 服务为 `active/running`、`NRestarts=0`、`ExecMainStatus=0`；切换后的服务错误日志增量为 0。`operational_errors` 保持 1970，最新时间仍为 `2026-09-09T01:55:17.770Z`。

`dataset_manifest`：22 张既有业务表按内容摘要核对；Auth、课件页面、课程 release 和 Storage 按计数核对。迁移前、提交后和上线后结果一致；Lead 摘要排除本批新增的三个默认字段。

| 对象 | 数量 |
| --- | --- |
| Auth 用户 / profiles / 学生 / 线索 | `40 / 40 / 1466 / 3915` |
| 班级 / 课次 / 班级报名 / 考勤 | `34 / 429 / 166 / 0` |
| 课程报名 / 分班历史 / 报名事件 | `1353 / 1506 / 153` |
| 冻结名单条目 / 名单版本 | `34 / 6` |
| 课件页面 / 课程 release / Storage 对象 | `77282 / 3774 / 126535` |

`failure_ticket`：自动审批先拒绝备份跨主机复制，本批改为生产原位保留并复核；随后拒绝未经明确说明的生产回滚演练，产品负责人在说明风险后再次授权，演练才执行。只读 postflight 脚本的选取上下文方式及登录返回地址断言曾修正：选取现有上下文后以 authenticated 调用 RPC，核对带 `next` 的登录地址；最终整组检查通过，生产权限未扩张。

## 产物与回退

`artifact_url_or_path`：`/home/swing/services/mathin/staging/school-placement-c63a47b5b0d5/evidence.tar`，包含候选 manifest、备份元数据、基线、回滚与提交结果、只读 SQL、运行结果及构建日志，不含备份数据、账号明细或密钥。

`artifact_hash`：archive 原始 SHA-256 为 `c19a5a6734cffbbaab8e1661fd65cc2386cf3300b4f89c745aebf58fdca1e917`；`summary.json` 的 UTF-8 SHA-256 为 `362af1a6d89590b1b985d35d4be31cbae638c411015d152e64c0e7493c49dadc`。归档上传后逐文件复核摘要。访问角色为生产运维维护者；按 R1 发布证据策略至少保留至 `v1.0.0` 后 365 天。

应用异常可按精确 current/previous 元数据原子回切上一版本；新增兼容结构与业务审计保留。数据库恢复遵循独立事故授权流程。真实业务发生退课、调班或档案合并后，按业务更正流程处理具体记录。

生产入口：[分班表](https://mathin.club/zh/dashboard/followups/enrollments)。开发端验收和机器 postflight 各自记录，生产实际视觉、拖拽及业务操作继续由产品负责人验收。
