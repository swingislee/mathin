# 教师调班权限 · 2026-09-10 生产发布

状态：**已部署生产，机器检查通过，待实际教师操作验收**。产品负责人授权“发布生产”，并在公开仓库推送确认中回复“授权推送并继续发布”。本批保持 R1-Live-2 和现有 Gate 状态。

## 发布结果

- 原班或目标班的任课老师，满足任意一边即可完全调班、临时调班及取消临时安排；待分班学生可以加入本人任课班级，本班学生可以退回待分班。
- 管理岗使用原有管理范围。商业报名确认、退课、首次改密、停用账号和学生资料读取继续使用对应权限与校验。
- 应用提交：`92334d4a0cc20dbdebe9dbc7cf57af2e01fc701b`；固定候选已推送 `codex/teacher-enrollment-placement-production-20260910`。候选基于原生产版本，仅增加本次权限实现及已有发布文档，不包含并行课堂显示设置或学服协作开发。
- current：`20260910-102012 / 92334d4a0cc20dbdebe9dbc7cf57af2e01fc701b`，构建完成于 `2026-09-10T10:22:23Z`；应用切换于 `2026-09-10T10:25:46Z`，北京时间 18:25:46。
- previous：`20260909-122848 / 5540c1cb609678acaad54fc25c9acd8c8bcdb64f`。应用版本保持 `0.1.2`。
- 迁移账本：`366 → 367`；head 为 `20260910000100_teacher_enrollment_placement`，LF SHA-256 为 `d68fe4f3a2b7b988f03e6f6b0e3802be414654147b88c9b1611ff09ef31324aa`。

## 目标与备份

按[写入目标策略](../../runbooks/r1-write-target-policy.md)和[生产发布手册 §7](../../runbooks/r1-production-deployment-preflight.md#7-函数rpc-热修执行补充)完成只读 preflight。执行主机为 SSH `xiaomi`；配置和运行进程的 Supabase origin 均为 `https://supabase.mathin.club`，应用在 loopback `3131` 监听，进程工作目录与 current 一致。数据库指纹为 `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`，旧账本及函数基线与候选预期一致。

最终候选推送后创建生产原位 PostgreSQL custom dump，备份 manifest 绑定候选、迁移摘要和本轮业务基线：

- 目录：`/home/swing/services/mathin/backups/mathin-db-prechange-20260910T101928Z-teacher-placement-92334d4a0cc2`。
- 数据库备份 `337359515` bytes，TOC `6321` 行；TOC 可读取，全部文件摘要核验通过。
- 数据库 SHA-256：`b3561cf6c9a1d9cdfbfc24e959410f0a91ad16bdd9521ea31540bb5f4a7cd374`。
- 备份留在生产主机受控目录；本条只登记本次写前备份，不作为异机恢复或 PITR 证据。

## 迁移与检查

从固定 Git archive 构建独立候选，源码 archive SHA-256 为 `a23faff591c3398c9e97c62865bf875e6ef060be2d3c4f34ee19f85e1413a52d`。本地 1280 个源码文件 lint、项目类型检查和生产构建通过；复用本任务已通过的权限矩阵、越权、冻结及容量保护、幂等与回滚开发检查。Windows 和 Linux 均生成 373 页，Linux release 完成 Worker 依赖打包。

生产构建后，2806 个候选文件通过仓库密钥扫描；4813 个 release 文件通过运行时 server secret 值检查，release 与清理后的构建源目录均未携带环境文件。源码上传摘要与候选一致。

在带数据库指纹、旧账本、函数基线、锁与超时守卫的 `SERIALIZABLE` 事务中执行同一迁移、账本登记、业务摘要和函数安全断言，然后回滚。独立连接确认旧账本、函数定义/owner/ACL/config、RLS 策略和业务摘要恢复，5 个候选新函数均无残留。正式事务使用同一文件和断言提交，再刷新 PostgREST schema cache。既有函数安全属性保持，新内部函数不对 authenticated/anon 开放。

应用使用独立 release 原子切换，切换器核对精确新旧提交与数据库账本；健康失败时可自动恢复原 release。原位备份与 previous 均保留，本次源码 staging 已精确清理。

生产只读权限检查通过：

- 4 个可用教师上下文均通过原班任课、目标班任课、待分班进出及分班表读取；无关两班的授权被拒绝，学生资料字段按读取范围保留脱敏。
- 3 个待首次改密的任课账号继续被账号恢复门拒绝；3 个非员工上下文被拒绝。管理员入口及读取保持正常。
- 首轮断言把待改密账号纳入了可用教师组，触发预期拒绝；依据现有 `is_staff` 合同区分两组后整组通过，生产权限代码与业务数据没有因此修改。

## 上线后核对

最终运行检查时间为 `2026-09-10T10:28:31Z`。loopback、Caddy 和公开域名 health 为 200；Supabase 无 key 网关为预期 401。中英文登录为 200，匿名访问分班与班级页为 307，返回对应语言登录页并保留来源地址。

应用和推送 Worker 分别为 PID `2716075`、`2716076`，工作目录均指向新 release，状态 `active/running`，`NRestarts=0`、`ExecMainStatus=0`。推送监控 timer 为 active，切换后错误日志增量为 0。

28 张业务表按内容摘要、5 类身份/课程/Storage 对象按计数核对，迁移与上线前后保持。关键数量：用户/档案 `41/41`、学生 `1467`、班级 `34`、课次 `429`、考勤 `1`、班级报名 `166`、课程报名 `1353`、分班历史 `1506`、课件页面 `77282`、页面版本 `121792`、课程 release `3774`、Storage 对象 `126535`。`operational_errors` 保持 `2017`，最新时间仍为 `2026-09-09T09:10:56.133Z`。

本批只提交函数和迁移登记，没有生产测试造数、实际调班、课程内容或 Storage 写入。真实教师的拖拽与业务体验继续由产品负责人验收。

## 证据与回退

- 证据：`/home/swing/services/mathin/staging/teacher-placement-92334d4a0cc2-20260910/evidence.tar`，包含备份元数据、候选、基线、回滚/提交结果、只读 SQL、构建和运行摘要，不含备份数据、身份明细或密钥。
- archive SHA-256：`586fd12f6d4c9d6333865d1de6709738e0e77ebaad036672c56e72bfbe8ff500`。
- `summary.json` SHA-256：`d88e846b40554f7eaf104f90b1796d0961f65a77cf8ab5c07264510c27784334`。
- 上传后逐文件摘要核验通过；访问角色为生产运维维护者，至少保留至 `v1.0.0` 后 365 天。
- 应用异常时可根据精确 current/previous 元数据回切上一版本；兼容权限函数保留。数据库恢复或进一步收紧规则按对应授权与流程处理。

生产入口：[分班表](https://mathin.club/zh/dashboard/followups/enrollments)。权限规则见[分班与调班权限](../../runbooks/enrollment-placement-permissions.md)。
