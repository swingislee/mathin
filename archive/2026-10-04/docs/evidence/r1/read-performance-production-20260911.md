# 首页与列表读取优化 · 2026-09-11 生产发布

状态：**已部署生产，机器检查通过，待人工使用验收**。产品负责人本轮明确授权“将本轮所有优化推送生产”。R1-Live-2 和现有 Gate 状态保持。

## 发布范围

- 首页两轮优化：合并分页请求、复用时区格式化器、移除统计未使用的入班关联读取，减少 SELECT 策略中的重复账号计算。
- 当前学生与线索：补充范围索引、提前缩小工作候选范围；全量档案减少筛选排序传递的资料，并在分页后计算操作标记。
- 课件素材库：批量汇总引用次数，确定当前页后读取课程、课次与文件明细，根据本次筛选选择执行计划。
- 固定候选 `59553b78337eef55c66cf9525b46df16350849a1`，由原生产 `92334d4a0cc20dbdebe9dbc7cf57af2e01fc701b` 叠加本任务五笔性能提交 `a220e02b`、`986c1510`、`ba2db11d`、`e8eb9263`、`a9db3bb7` 形成。候选通过完整源码 archive 与 Git bundle 上传到受控生产目标，远端逐项核验摘要；本次没有推送公开 Git 远端。
- 应用 current：`20260911-011826 / 59553b78337eef55c66cf9525b46df16350849a1`；previous：`20260910-102012 / 92334d4a0cc20dbdebe9dbc7cf57af2e01fc701b`。应用切换时间 `2026-09-11T01:34:00.242598+00:00`，版本维持 0.1.2。

## 目标与迁移

按[写目标策略](../../runbooks/r1-write-target-policy.md)和[生产发布手册 §7](../../runbooks/r1-production-deployment-preflight.md#7-函数rpc-热修执行补充)完成只读 preflight：SSH 主机为 xiaomi，配置与运行进程均使用 `https://supabase.mathin.club`，应用监听 loopback 3131，进程目录与 current 一致。数据库指纹 `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`。

迁移账本由 367 增至 371，head 为 `20260910008000_courseware_asset_list_usage`。四条迁移 LF SHA-256 如下：

| 迁移 | SHA-256 |
| --- | --- |
| `20260910003000_dashboard_read_paths` | `ad1cff3fb996ad52df1a2db07868bd732b8140aef999778a2e8d7800a7b0db88` |
| `20260910005000_business_subject_read_paths` | `ea42cbf501552fd36936f2a37e69e02052535a9d08e68334978fef1abd664b53` |
| `20260910007000_student_list_page_work` | `671173876d36837eb2197f52b7baae8f151e6a5c06f9c73ffd2f23aebe78febc` |
| `20260910008000_courseware_asset_list_usage` | `e92bb3f9a751dd7450eca40076a966da9803be105e760df9b4bea1ff7b68979c` |

生产保留原有权限函数和生产分支。候选仅包含上述性能改动，其他并行开发功能继续保留在开发端。

## 备份与执行检查

冻结候选并上传核验后创建生产原位 PostgreSQL custom dump，manifest 绑定候选、迁移摘要与本轮业务基线。备份目录为 `/home/swing/services/mathin/backups/mathin-db-prechange-20260911T012103Z-read-performance-59553b78337e`；dump 为 337,378,625 bytes，TOC 6,339 行，TOC 可读且逐文件摘要核验通过。数据库 dump SHA-256 为 `ac51b236b99f7df4f2676c520c312b8b2b7746f43b816302daa43cf01da37ddc`。本条登记写前备份，独立异机恢复与 PITR 继续以对应证据为准。

候选的受影响测试、完整 lint、类型检查与仓库密钥扫描通过。Linux 生产构建及 Worker 依赖打包通过；2,811 个源码文件与 4,813 个运行时文件的密钥检查通过，release 和构建源目录的环境文件隔离通过。复用开发阶段的完整目录、筛选分页、权限及回滚对照结果。

在带指纹、账本、全量函数/策略基线、锁与超时守卫的 SERIALIZABLE 事务中执行四条原文迁移、账本登记、读取与安全断言后回滚。独立连接确认账本、函数定义及元数据、RLS 策略、索引与业务摘要零残留。正式事务使用同一文件和断言提交，刷新 PostgREST schema cache，再以新连接核验。

- 12 类现有角色/账号状态/权限组合逐项比较线索、学生、报名及分班历史的完整可见身份摘要，结果保持一致。
- 管理员与教师的工作列表、全量档案、完整底层事实，以及两种比例素材首屏内容一致；非员工和匿名执行保持预期拒绝。本轮全部 27 项读取对照一致。
- 新增两个私有函数与原事实函数保持同 owner、固定 search_path、SECURITY DEFINER 和稳定函数属性；PUBLIC、anon、authenticated、service_role 无直接执行权限。其余函数与表权限、写策略保持。
- 39 张业务表内容摘要与 4 类身份/版本/Storage 计数保持。学生 1,467、线索 3,915、班级 34、课次 429、考勤 1、课程报名 1,353、课件素材 65,789、Storage 对象 126,535。

## 生产只读计时

以下来自正式事务内同一时间基线、相同现有管理员/教师上下文的 SQL 前后对照，单位为数据库执行时间；学生首屏含总数与筛选选项。单次计时受缓存和并发影响，完整页面与实际交互由产品负责人继续验收。

| 读取 | 迁移前 | 迁移后 |
| --- | --- | --- |
| 素材库 16:9 首屏 | 3.75 秒 | 0.58 秒 |
| 素材库 4:3 首屏 | 3.56 秒 | 0.57 秒 |
| 教师工作列表 · 待首联 | 2.42 秒 | 0.47 秒 |
| 教师工作列表 · 待测评 | 2.39 秒 | 0.46 秒 |
| 管理员全量档案 · 待测评 | 0.87 秒 | 0.83 秒 |
| 教师全量档案 · 待测评 | 3.04 秒 | 2.91 秒 |

素材库和教师工作列表改善明确；全量档案在本次生产样本中的改善较小。保留兼容合同的私有完整事实读取耗时有所增加：管理员 0.61 → 1.03 秒、教师 2.70 → 3.16 秒，完整内容摘要仍一致；分页 RPC 使用拆分后的查询路径。开发 HTTP 测量保留在各原始优化证据中，本表不替代生产完整登录页面计时。

## 上线后核对与保留

应用原子切换后，loopback、Caddy 与公开域名 health 均为 200，Supabase 无 key 网关为预期 401。中英文登录返回 200，首页、学生列表与素材库的匿名访问均为 307，返回对应语言登录页并保留来源地址。通知 Service Worker 为 200。

应用与 Jobs 进程均为 active/running、NRestarts=0、ExecMainStatus=0，工作目录一致指向新 release；推送监控 timer 为 active。最终运行检查时间 `2026-09-11T01:34:16.132004+00:00`。切换后服务错误日志增量为 0，operational_errors 保持 2,017。上线后独立数据库核对仍与正式提交基线一致。

- 受控证据：`/home/swing/services/mathin/staging/read-performance-59553b78337e-20260911/evidence.tar`，包含候选、备份元数据、构建、回滚/提交、只读与运行摘要及执行脚本，逐文件摘要核验通过。
- evidence archive SHA-256：`e132351ef24b4b8141538174607121487f2c6674b36cb1d65737618fdde75e57`；summary.json SHA-256：`52aa5f52ce3737a45125c108ea840f01500f8e67af43449937c825396d7e1813`。
- 访问角色为生产运维维护者，至少保留至 v1.0.0 后 365 天；写前备份和上一 immutable release 均保留。应用健康检查失败时切换器会恢复旧版本，本次实际切换成功。数据库进一步变更按对应授权和流程执行。
- 本批仅更新读取实现、索引、SELECT 策略与迁移账本；真实业务及 Storage 内容保持。

生产验收入口：[首页大屏](https://mathin.club/zh/dashboard?view=overview)、[学生列表](https://mathin.club/zh/dashboard/students)、[课件素材库](https://mathin.club/zh/dashboard/courseware-assets)。
