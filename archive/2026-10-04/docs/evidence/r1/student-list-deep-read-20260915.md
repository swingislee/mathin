# 学生与学服读取深度修复 · 2026-09-15

状态：**本批已获单独授权并部署生产，发布后机器检查通过，待人工体验验收。** 2026-09-15 10:06（Asia/Shanghai）完成应用切换；当前阶段保持 R1-Live-2，正式 Gate 状态保持。

## 修复范围

- 学生工作／全部记录：把协作范围与人员标签改为批量读取，修复因迁移顺序造成的生产内部协作读取差异。未分配的负责人条件在底表阶段筛选，避免待测评查询的错误行数估计与嵌套扫描。
- 再联系：数据库完成字段筛选、自然排序、候选项统计和分页；只返回当前页，昂贵的完整详情读取次数不超过该页行数。去掉重复物化及宽 JSON 的临时落盘，仅新分页 RPC 关闭 JIT。
- 同组再联系：补齐旧函数漏掉的 group 参数。组内读取不授予写入，移除组成员后访问撤销；实际组授权及回退已有本机验证。
- 报名／续报工作台：使用名单投影，保留全部业务行、备注、身份标签及未归属记录的姓名／电话／年级解析，省去列表未使用的来源单元格和关联沟通。档案、360、历史首联继续使用原有完整默认投影。
- 学生页面的数据请求与人员／协作设置并行开始。界面布局、筛选含义、草稿、快捷键和写入动作保持现有合同。

## 独立版本

| 增量 | 主工作区提交 | 内容 |
| --- | --- | --- |
| A | `8aefdfe7` | 批量读取、生产协作差异修复及同组参数 |
| B | `dc1a6904` | 再联系数据库分页及页面适配 |
| C | `4aac77e6` | 报名／续报名单传输精简 |

独立发布候选：`58ebc8b486aa02fe060a6ca646fbeef957cdd62c`，以生产应用 `3d9892bb87c2361e6662e685b606ac77a3e82e29` 为基底，共 18 个文件。包含此前已部署的三条迁移源码、本批两条新迁移、六个应用读取文件及对应校验；不包含主分支同期教学和空间工具改动。候选源码与主任务文件逐项规范化摘要一致。Windows 生产模式构建只使用 loopback 开发配置，发布时需在生产主机使用其受控配置重新构建。

| 新迁移 | 规范化 SHA-256 |
| --- | --- |
| `20260915001000_student_list_batch_reads` | `8f8f0a1af1681e5a943dd784c1fa1362bcf63e7569f337e2a1677d417a68f705` |
| `20260915002000_student_recontact_pages` | `8c8ade3befcb64a654c83605c6580fe5e9a8f0ec3a5c372176b56da5508a1a3d` |

两条迁移已应用到核对过的 Windows 开发库，应用前后业务摘要一致。迁移通过精确函数体摘要拒绝未知漂移；已知生产旧版 base 修复为标准协作版本的变换，另有生产只读摘要证明。

## 测量结果

以下均为本机既有开发数据的数据库或完整 HTTP 响应，不是生产体验，也不包含浏览器绘制和用户网络。RPC JSON 字节数与 HTTP 字节数分别列示，均为未压缩大小。

| 数据库读取 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 管理员当前工作四阶段 | 554–623 ms | 126–168 ms |
| 管理员全部记录四阶段 | 983–2,310 ms | 225–1,134 ms |
| 管理员我的未接通摘要 | 3,224 ms | 295 ms |
| 未分配／全部记录／待测评 | 默认计划超过 60 秒 | 页面完整响应 1.86–1.88 秒 |

未分配旧查询为完成等价对照，参考执行单独关闭了嵌套循环与 JIT；该参考耗时不能作为默认计划的速度基线。

再联系新 RPC 首批 20 行：未接通 500 ms、已测评 635 ms、往期 578 ms、沉默 870 ms。沉默此前返回 2,438 行、约 2.54 MB；新页约 27.7 KB。对应完整页面约 0.80–1.19 秒，第二页约 1.21 秒。

工作台历史投影逐条对照 503 条报名及 355 条续报，业务行和所需身份标签完全相同。报名历史数据 2,531,716 → 417,712 字节；续报 3,526,207 → 262,500 字节。完整中文 HTTP 响应：报名 4,535,820 → 2,105,712 字节；续报 4,623,590 → 913,289 字节。最终新进程的首个报名请求含冷启动为 2.04 秒，随后英文为 680 ms；续报为 340–457 ms。

## 验证与边界

- A：36 项读取对照与 5,445 个主体的范围／协作投影核查；包括临时组只读访问、成员撤销、匿名及家长／学生拒绝。表、RLS、既有函数元数据及业务摘要受控；事务回滚零残留。
- B：22 个真实分页结果与旧完整名单切片对照，10 个常规事实队列对照；首末页、计数、去重和完整详情读取上限通过。232 个数据库字段案例覆盖中英自然排序、空值、日期、文本、范围、自排除候选与分页钳制，普通学生页与再联系均核对。
- 应用：26 个学生表格／分页适配测试、4 个工作台投影测试、858 行真实工作台数据对照通过。受影响文件 ESLint、隔离 TypeScript、最终生产模式构建及候选凭据扫描通过（零命中）。主工作树其他任务曾有类型错误，本批以独立候选结果为准。
- HTTP：先检查 34 个路由／查询状态的双语完整响应，再对最终报名／续报当前与历史状态检查 8 次；解析流式 RSC 错误，单独识别两个仅开发可用预览页的 404 及旧线索地址跳转。开发服务另复测 6 个修复状态，全部业务返回正常；开发首个全部记录请求含编译为 4.02 秒。
- 本机生产模式测试完成真实固定开发管理员 MFA；临时认证因子已撤销，前后均无其他因子。首次只有 MFA 保护的响应留作独立记录，不计入业务耗时。没有生产浏览器登录、业务测试造数或生产 MFA 变更。
- [此前完整 Dashboard 核查](dashboard-route-audit-20260915.md)覆盖 82 页面、2 个读取接口及动态样本。本批复用其未受影响结果；旧记录中的同组失败由本批修复。缺少真实动态样本的页面仍仅证明保护／回退，不补写为真实业务成功。
- 本批针对用户反馈的管理员入口。固定教师的部分全范围再联系读取仍约 4–7 秒，权限路径未在本批全面改造；不能将管理员改善外推到全部角色。

## 最终路由结果

学生与其他学服入口使用 B 后记录；报名／续报使用最终 C 记录。所有时间均为完整响应，包含服务器流式数据结束。预览保护及旧入口跳转按设计记录。

| 路由（省略语言前缀） | 结果 | 中文 ms | 英文 ms |
| --- | --- | ---: | ---: |
| `/dashboard?view=overview` | 业务响应 200 | 1458 | 1125 |
| `/dashboard/students?population=work&stage=awaiting_first_contact&scope=all` | 业务响应 200 | 720 | 567 |
| `/dashboard/students?population=work&stage=awaiting_assessment&scope=all` | 业务响应 200 | 870 | 787 |
| `/dashboard/students?population=work&stage=awaiting_enrollment&scope=all` | 业务响应 200 | 408 | 484 |
| `/dashboard/students?population=work&stage=awaiting_renewal&scope=all` | 业务响应 200 | 555 | 485 |
| `/dashboard/students?population=work&stage=former_student&scope=all` | 业务响应 200 | 364 | 413 |
| `/dashboard/students?population=records&stage=awaiting_first_contact&scope=all` | 业务响应 200 | 1508 | 1562 |
| `/dashboard/students?population=records&stage=awaiting_assessment&scope=all` | 业务响应 200 | 1762 | 1777 |
| `/dashboard/students?population=records&stage=awaiting_enrollment&scope=all` | 业务响应 200 | 650 | 640 |
| `/dashboard/students?population=records&stage=awaiting_renewal&scope=all` | 业务响应 200 | 544 | 514 |
| `/dashboard/students?population=records&stage=former_student&scope=all` | 业务响应 200 | 631 | 572 |
| `/dashboard/students?population=recontact&reason=unreachable&scope=all` | 业务响应 200 | 799 | 847 |
| `/dashboard/students?population=recontact&reason=assessed&scope=all` | 业务响应 200 | 1113 | 1187 |
| `/dashboard/students?population=recontact&reason=former&scope=all` | 业务响应 200 | 1028 | 1034 |
| `/dashboard/students?population=recontact&reason=dormant&scope=all` | 业务响应 200 | 1165 | 1177 |
| `/dashboard/students?population=recontact&reason=unreachable&scope=group` | 业务响应 200 | 327 | 271 |
| `/dashboard/followups/communication?view=records` | 业务响应 200 | 470 | 762 |
| `/dashboard/followups/communication?queue=post_activity` | 业务响应 200 | 935 | 846 |
| `/dashboard/followups/assessments/learning-matrix-preview` | 预览页 404 保护 | 271 | 220 |
| `/dashboard/followups/assessments` | 业务响应 200 | 1023 | 743 |
| `/dashboard/followups/assessments/support-preview` | 预览页 404 保护 | 246 | 291 |
| `/dashboard/followups/communication` | 业务响应 200 | 919 | 764 |
| `/dashboard/followups/leads` | 业务响应 200 | 596 | 531 |
| `/dashboard/followups` | 业务响应 200 | 298 | 265 |
| `/dashboard/followups/renewals/growth` | 业务响应 200 | 646 | 547 |
| `/dashboard/followups/renewals/signals` | 业务响应 200 | 350 | 249 |
| `/dashboard/leads` | 旧入口跳转 | 261 | 258 |
| `/dashboard/students/groups` | 业务响应 200 | 310 | 251 |
| `/dashboard/students?population=records&stage=awaiting_assessment&scope=unassigned` | 业务响应 200 | 1864 | 1884 |
| `/dashboard/students?population=recontact&reason=unreachable&scope=mine` | 业务响应 200 | 638 | 613 |
| `/dashboard/students?population=recontact&reason=unreachable&scope=unassigned` | 业务响应 200 | 845 | 762 |
| `/dashboard/students?population=recontact&reason=dormant&scope=all&page=2` | 业务响应 200 | 1218 | 1208 |
| `/dashboard/followups/enrollments` | 业务响应 200 | 2040 | 680 |
| `/dashboard/followups/enrollments?state=historical` | 业务响应 200 | 581 | 550 |
| `/dashboard/followups/renewals` | 业务响应 200 | 457 | 340 |
| `/dashboard/followups/renewals?state=historical` | 业务响应 200 | 349 | 349 |

## 生产发布结果

用户对独立候选 `58ebc8b4`、两条新迁移、写前备份／回滚演练及应用短暂重启明确回复“现在单独发布”。此前三条迁移仅复核摘要，本批新增两条迁移，生产账本 **385 → 387**，head 为 `20260915002000_student_recontact_pages`。

- current：`20260915-015636` / `58ebc8b486aa02fe060a6ca646fbeef957cdd62c`；previous：`20260913-155934` / `3d9892bb87c2361e6662e685b606ac77a3e82e29`。
- 应用 PID 1432122；现有 Worker 通过 `PartOf=mathin.service` 随应用切换，PID 1432123。应用与 Worker 均指向新不可变 release；数据库和 Supabase 服务保持运行。loopback 与 Caddy 健康检查通过。
- 备份：`/home/swing/services/mathin/backups/mathin-db-prechange-20260915T015534Z-student-read-58ebc8b486aa`，350670280 字节，TOC 6503 行；SHA-256 `e877cf4f125b16cf6e50b336662af8e57a1f943d0c64ecd5ddd9b76bbe91d28f`。原读取函数定义仅保存在生产备份目录，摘要为 `ec7c3ff8b416ac2cfb7c2a2093450c03609ee3695549db16125258d59da40e46`。
- 生产演练与正式迁移均核对 17 组既有读取、20 个新分页结果。再联系完整行与旧名单切片一致；常规学生对照保留业务事实和计数，既有缺失的协作标签／办理标志按本次修复合同单独处理。匿名、家长／学生拒绝、私有 helper ACL、表与 RLS 元数据检查通过。
- 演练实际恢复了原函数、移除新增函数并还原账本，再确认事务回滚后业务／目录／账本零残留。正式提交后独立快照与应用启动后复核均通过，业务摘要保持，操作错误增量 0。
- 发布后 43 项健康、双语登录及受影响路由匿名保护检查通过；journal error 增量 0。另使用固定只读 SQL 验证下方 16 个业务读取入口，跨主机仅返回固定标签及四个数字，明细保留在 PostgreSQL 内。

下表是**已发布生产库的读取耗时**，不是完整页面或浏览器渲染时间。沉默旧完整读取约 4,787.5 ms，新分页 2,246.1 ms；我的未接通约 3,649 ms 降至 401.7 ms（所选管理员此范围为空）。常规全部记录仍需约 0.46–1.47 秒，较迁移前对照未显示普遍数据库提速；本批同时修复协作事实与未分配超时，不把本机改善外推为全部生产查询均更快。

| 生产读取 | ms | 当前页行数 | 总数 | RPC JSON 字节 |
| --- | ---: | ---: | ---: | ---: |
| `work:awaiting_first_contact` | 371.6 | 20 | 95 | 22878 |
| `work:awaiting_assessment` | 323.9 | 20 | 111 | 24671 |
| `work:awaiting_enrollment` | 308.8 | 20 | 25 | 28372 |
| `work:awaiting_renewal` | 374.5 | 20 | 170 | 32566 |
| `records:awaiting_first_contact` | 1196.1 | 20 | 2262 | 24634 |
| `records:awaiting_assessment` | 1472.4 | 20 | 2393 | 26617 |
| `records:awaiting_enrollment` | 611.1 | 20 | 339 | 31162 |
| `records:awaiting_renewal` | 459.8 | 20 | 171 | 33130 |
| `recontact:unreachable` | 1241.3 | 20 | 412 | 22724 |
| `recontact:assessed` | 1360.3 | 20 | 123 | 36479 |
| `recontact:former` | 1363.2 | 20 | 25 | 28282 |
| `recontact:dormant` | 2246.1 | 20 | 2441 | 28633 |
| `recontact:mine` | 401.7 | 0 | 0 | 492 |
| `recontact:group` | 55.5 | 0 | 0 | 463 |
| `recontact:unassigned` | 949.1 | 20 | 411 | 22679 |
| `records:unassigned:assessment` | 1405.8 | 20 | 2307 | 26744 |

原应用与本批写前备份均保留。应用回退采用受校验的原子指针切回原 release；读取函数回退采用备份定义及经过演练的新增函数／账本反向操作，不以全库恢复覆盖现行业务。用户实际页面验收保持 pending。

生产证据归档：`/home/swing/services/mathin/staging/student-read-58ebc8b486aa-20260915/evidence.tar`，220160 字节／17 文件，SHA-256 `ff574de17a3c23dae0f9cd2512c11c23d88d14d7effd2a318f007b3a028b404d`，权限 0600；由生产维护者访问，保留至用户验收后至少 30 天。内容为聚合验证、发布元数据及回退步骤，不包含学生明细或生产凭据。

## 证据摘要

下列文件保留在本机忽略的临时目录，访问角色为本任务维护者，建议保留 30 天至验收完成；共享仓库只保存本摘要。摘要使用仓库无 BOM／LF 规范化算法，包含既有目标核对和无业务行的结果记录。

| 证据 | SHA-256 |
| --- | --- |
| 批量读取对照 | `a80be1563f1b62b43fc58352f11288ad4b0303518463be703911c5ae87907459` |
| 分页真实数据对照 | `99314827be17e3e324e23f0d81569dd3ed87e44abc9e1ec8e5478645afa35358` |
| 字段算法对照 | `5d617019643a83204f13fd600e366d5406d46bbbb449902cd54bca9590f40600` |
| 学生与学服 HTTP | `cb230fd96207d040bea9217fe7cecce6ded810a2a15c6d9120ebce72d0fa240c` |
| 最终工作台 HTTP | `c1c326e5f10a5272838124462c090de284a6b0ab269f3b3a6a8a1346012d8884` |
| 工作台事实与身份对照 | `1e8ae12d9102ee43167ae756946103d2edee7e37c0aa97dc28b87b6681588311` |
| 构建日志 | `f60422813444454ba9aa3cd27542f84aa1b7156a747ca7a82c944fda71d8d7f5` |
