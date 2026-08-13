# Mathin 整体规划 · 04 R1 路线图

> **规划状态**：`active`
>
> **当前施工阶段**：`R1-9 · P6-9 与跨阶段非五模块生产准备`
>
> **SML 暂停位置**：`SML-0 · 合同与金标冻结`；学生重连、成对回退、20 道代表题教研签名与跨端 hash 向量保持 pending。
>
> **当前未结项**：P6-AIX-2 已于 2026-08-13 关闭：G+/X+/A+ 三个 projection v31 离线包已重导入开发库，共 170 讲、5442 页；源 CSS/player/动画/H5/两类原生游戏和结构化 4:3 均有自动化与浏览器证据。范围裁决把 170 讲纳入 1.0，正式总基线为 1305 讲/2610 条 release-1。当前继续 P6-9：导出并复核真实 1305 行只读 inventory、`cw-objects`/`cw-h5` 对象和 snapshot hash；R1-9 未关闭，本阶段不授权 R1-15/R1-18 的生产清理。
>
> **核对日期**：2026-08-13；依据代码、迁移、内容目录、CI、Git、R1-6 教学成果链路、R1-7 导出链路、R1-8 财务安全关闭复验证据、R1-9 两套课程来源 manifest、Notebook 生命周期、非五模块 Playwright、仓库 secret scan 与 doc 00～28。

## 1. 基线与施工规则

| 事实 | 对 R1 的约束 |
| --- | --- |
| P0～P4E、P4H、P4I、UI-L1～L4 已关闭 | 不按历史正文重做；只处理 doc 25 登记的发布缺口 |
| P4F、P4G、P6 为 partial | R1 接管仍影响 1.0 的项目；`cacheComponents` 等非发布项延后 |
| Terms 现有 71 篇中文 MDX；Games 3 个；Tools 3 个（2 个既有工具 + `spatial-lab` 验收样机）；Minds 2 篇；Story 无完整章节内容目录 | Story 是内容阻断项；其他模块需要关系、权限、性能和浏览器证据 |
| E 系列开发数据有 1135 讲双轨资源；爱学习开发库有 G+/X+/A+ 12 门、170 讲、5442 页双轨资源 | P6-AIX-2 已关闭；1.0 固定 1305 讲/2610 条 release-1。P6-9 的只读 manifest 合同已同步新数量，真实 inventory、对象审计与非执行者复核仍 pending |
| 课程目录版本层已落库（2026-08-03，迁移 `20260803000300`/`20260803000400`）；2026 秋季 270 讲已于 2026-08-04 导入：E 系列 2026新版 36 门（暑期 18 + 秋季 18）、2025旧版 54 门，讲次 1135 | 旧秋季 18 门保留 `enabled` 并已写 `superseded_by_course_id`；本批 4:3 背景按运营指示未经人工逐张核验直接发布，见 doc 16 §11.3 |
| 当前全量 Vitest 共 88 个测试文件、571 项；其中非 spatial 基线为 51 个文件、292/292，空间数学/SML-0 专项为 37 个文件、279/279，`pnpm r1:test` 既有基线为 18 个文件、121/121 | SML-0 与 R1-14 均保持全量 100% 通过；正式 Playwright 框架已有本地基线，仍须补发布目标、写态、zh/en、跨浏览器、连续无 flaky、并发、文件和竞争矩阵 |
| 小王子是全站视觉基础 | R1-12 验证三种强度：公开场景、内容/Notebook、运营工作区 |

阶段按编号关闭。实现可在依赖满足后并行准备；04 顶部只记录一个正在关闭的阶段。后续 Agent 不能用“代码已存在”跳过该阶段的退出证据。

### 1.1 2026-08-13 P6-AIX-2 关闭结果

- **来源合同**：三个固定 package 的 56/84/30 讲与 1641/2767/1034 页均为 projection v31；逐讲离线验证的远程请求、本地缺失和 fatal console error 为 0。
- **4:3 分类**：5020 个普通 1200×900 页使用 `source-master`；422 个动画、embedded H5 或 1920×1080 原生游戏页使用 `source-player-compat`。分类只读结构能力，没有 package/年级/页面白名单。
- **运行时边界**：Mathin 消费源 `slide-runtime.css`、captured player 图片模块、完整 transform/动画合同、embedded H5、TrueOrFalse 与 TopicClassification；旧手工小图放大和近似布局已退出。
- **占位边界**：G+ 4 个、X+ 6 个、A+ 4 个显式第 7/15 讲占位进入基线；来源没提供的相同讲号保持缺失。
- **数据结果**：开发库 170 讲/5442 页，两轨各 170 个 release/head、5442 个页面 head、27541 个 binding；三包导入 conflict/drift=0，单讲幂等重跑零新增。
- **浏览器结果**：覆盖 G+ 直接 4:3、A+ 动画、X+ H5、两类原生游戏、显式占位及 zh/en Studio，详见 [P6-AIX-2 证据](../evidence/r1/r1-9-aixuexi-courseware.md)。
- **后续边界**：生产 planner 已改为 102 门/1305 讲/2610 条 release-1，但本轮只写开发库；真实生产 inventory、对象审计、隔离演练和正式初始化仍分别由 R1-9/15/18 放行。

## 2. 历史阶段的有效范围

| 阶段 | 状态 | R1 继续使用的结果 |
| --- | --- | --- |
| P0～P3 | complete | 设计 token、公开模块路由/骨架、鉴权与早期内容 |
| P4A～P4D | complete | 学生、家庭、员工、课程、班级、排课、考勤、作业和财务数据地基 |
| P4E | complete | 安全、审计、通知、离线补发和数据库验证地基 |
| P4F | partial | 已完成导航/反馈改造；剩余发布一致性进入 R1 |
| P4G | partial | 已完成多项 SEO/CI/性能治理；P4G-6b 延后，发布债务进入 R1 |
| P4H | complete | Dashboard 信息架构和教学运营入口 |
| P4I | complete | 今日工作、对象工作区、课程研发和员工工作流 |
| P6 | partial | E 系列导入、4:3 适配、双轨 release 与课堂消费主体；P6-9 未关闭 |
| UI-L1～L4 | complete | 坐标系、命令面板、路由 IA、对象页、响应式和自动防回退审计 |

专题文档状态与剩余项只在 doc 00 索引和各文件状态头维护。

## 3. R1-0～R1-4：治理与平台内核

| 阶段 | 依赖 | 动作与产物 | 退出证据 |
| --- | --- | --- | --- |
| **R1-0 规划真相源与发布边界冻结（已关闭 2026-07-28）** | 无 | 更新 00/04/25、AGENTS、README 和 26 个状态头；记录范围、视觉、双语、work-items、财务默认关闭、生产清理、风险和责任角色 | `pnpm plan:audit` 通过；实际 owner 已登记；证据目录位置已确定；仓库只有一个当前阶段；见 [`docs/evidence/r1/r1-0.md`](../evidence/r1/r1-0.md) |
| **R1-1 机构配置、规则与 Feature Flag（已关闭 2026-07-28）** | R1-0 | 建立机构/校区、时区、学期/教学周、节假日、教室、课时、排课、通知、财务和公开发布配置；保存版本、生效时间、修改人和旧值；未启用能力 fail-closed | schema、RLS、审计、默认值和 zh/en UI 通过；空库重放无测试 UUID/隐含 seed 依赖；见 [`docs/evidence/r1/r1-1.md`](../evidence/r1/r1-1.md) |
| **R1-2 Jobs、通知、文件与外部集成（已关闭 2026-07-28）** | R1-1 的环境/开关合同 | 实现 durable job、租约、超时、退避、dead-letter、人工重放；站内通知和已选外部渠道；上传配额、类型、校验、签名、保留/孤儿清理；webhook 防重放和降级 | job/通知指标可采集；重复投递不重复产生领域副作用；失败记录可追踪和重放；未选供应商的渠道关闭；见 [`docs/evidence/r1/r1-2.md`](../evidence/r1/r1-2.md) |
| **R1-3 账户、安全、同意与管理员支持（已关闭 2026-07-28）** | R1-1 | 完成员工邀请/交接/停用、学生/家长认领、密码/MFA、会话撤销、封禁/恢复、同意版本、用户权利请求和支持审计 | Auth/RLS/Storage 负向断言、管理员 fail-closed MFA 门、唯一生产管理员 manifest schema/校验器与双人恢复 runbook 已通过；正式账号清单仍由 R1-18 受控生成；见 [`docs/evidence/r1/r1-3.md`](../evidence/r1/r1-3.md) |
| **R1-4 Work-items 混合模型与轻审批（已关闭 2026-07-28）** | R1-1～3 | 保留 11 类领域投影和 `work_item_user_state`；为人工、跨域异常和独立 SLA 增加持久 `work_items`；审批使用独立请求/决定；`overdue` 由 `due_at` 计算 | 统一列表、领域 RPC 边界、权限、幂等、通知及开发/一次性库 PERF-04 已通过；见 [`docs/evidence/r1/r1-4.md`](../evidence/r1/r1-4.md) |

## 4. R1-5～R1-8：学校运营闭环

| 阶段 | 依赖 | 动作与产物 | 退出证据 |
| --- | --- | --- | --- |
| **R1-5 学生与家庭门户（已关闭 2026-07-31）** | R1-1～4 | 学生从独立班级主页进入课次，分别接收知识总结、正式作业和视频任务，并查看课表、考勤、请假/补课、提交、成果和通知；家长查看已绑定子女并切换多子女；隐藏草稿、内部备注和其他家庭数据 | 学生/家长旅程、跨家庭/跨学生负向查询、zh/en 特殊状态、集成 CI 与空库数据库总门通过；见 [`docs/evidence/r1/r1-5.md`](../evidence/r1/r1-5.md) |
| **R1-6 教学成果与阶段报告（已关闭 2026-08-01）** | R1-5 | 将知识总结、逐生课评、视频复盘和阶段报告建立为互不阻塞的 draft→review（适用时）→published→withdrawn/revised 生命周期；知识总结使用 BlockNote、模板/复制和自动保存；阶段报告以可选日期范围的课评、作业与视频证据作为双栏写作依据，并固定指标版本、数据截止时间和时区 | 三类草稿自动保存；教师审核及发布→学生/家长读取→撤回→修订旅程可重放；每条通知有具体标题和有效 deep link；历史版本和审计不变；通知失败进入 job；见 [`docs/evidence/r1/r1-6.md`](../evidence/r1/r1-6.md) |
| **R1-7 初始化、导入、质量、修复与导出（已关闭 2026-08-01）** | R1-1～6 | 版本化初始化 manifest；CSV dry-run、逐行错误、去重和幂等重跑；检测孤儿、重复主体、非法状态、金额不平、缺失内容对象；区分运营导出和用户权利导出 | 空库重放、错误批次原子性、修复恢复点、角色字段裁剪、过期/清理、下载审计与真实浏览器链路通过；见 [`docs/evidence/r1/r1-7.md`](../evidence/r1/r1-7.md) |
| **R1-8 财务正式闭环或安全关闭（已关闭 2026-08-01）** | R1-1～4、R1-7 | 采用安全关闭：保留历史财务事实，发布门固定关闭；路由/导航、数据、work item/审批、通知、指标和 job 同时 fail-closed | 156 迁移空库重放、12 项数据库断言、开发库拒绝/隐藏合同、角色导航和 14/14 CI 通过；见 [`docs/evidence/r1/r1-8.md`](../evidence/r1/r1-8.md) |

## 5. R1-9～R1-12：Terms、内容发布与全站体验

| 阶段 | 依赖 | 动作与产物 | 退出证据 |
| --- | --- | --- | --- |
| **R1-9 Terms 与内容发布链/P6-9** | R1-1～3、R1-7 | 当前推进 P6-9：验证 E 系列 1135 讲和爱学习 G+/X+/A+ 秋季 170 讲的两轨文档、binding、对象和不可变 release；v2 只读来源 manifest 已同步 90+12 门 roster、1305 讲/2610 条 release-1、现役 snapshot 字段、本地对象清单 hash、E adapted 4:3 审批和路径隔离合同。Notebook 所需共享发布合同可继续；71 篇中文 Terms 的 slug、公式、依赖、引用、搜索、SEO 巡检暂缓 | P6-AIX-2 见[多难度证据](../evidence/r1/r1-9-aixuexi-courseware.md)，来源 manifest 见[合同证据](../evidence/r1/r1-9-courseware-source-manifest.md)。真实批准副本的 1305 行 inventory、`cw-objects`/`cw-h5` 审计与非执行者复核仍 pending；Terms 坏链/悬空关系、英文回退和全量资源门未全部通过，R1-9 不关闭 |
| **R1-10 Story 完整章节（巡检暂缓）** | R1-9 | 恢复后制作并巡检至少 1 个从入口到结尾的数学故事/漫画章节，阅读/交互 10～20 分钟或达到产品签收的完整最小章节；关联 Terms；补发布、回退、移动端和无障碍 | 无“即将推出”占位；章节入口、进度、结尾、回退和 Terms 链接 E2E 通过 |
| **R1-11 Games、Minds、Tools、Notebook** | R1-9，可与 R1-10 并行 | 当前继续 Notebook；commit `11885f7` 已关闭发布归属、归档 fail-closed、点赞身份隐私与不可见内容互动边界，见[隐私子门](../evidence/r1/r1-11-notebook-readiness.md)。commits `8c9cb8c`、`ffe3ec6` 已建立 draft→review→published→withdrawn/revised、revision 内容字段不可变、平台下架锁、逐行归档删除守卫和新提交源笔记版本/hash 绑定，见[生命周期子门](../evidence/r1/r1-11-notebook-lifecycle.md)。3 个游戏、3 个工具（含无持久化的 `spatial-lab` 验收样机）、2 篇 Minds 的模块巡检暂缓 | Notebook 生命周期与数据库负向子门已通过；完整私有写作→提交→管理员审核→公开读取/互动→撤回的写态 Playwright、跨用户/角色越权、旅途笔记视觉签字和普通 Note CRUD 结构化结果仍 pending。Games/Minds/Tools 的关键旅程、越权、失败态、英文回退和公开资源门通过前 R1-11 不关闭 |
| **R1-12 跨模块、全站小王子视觉与公共质量** | R1-10～11 | 当前可准备工作区级视觉、通用错误/空状态和不依赖五条线的质量子门；首页/导航/搜索/Terms 贯通、sitemap、canonical、分享元数据、公共视觉、浏览器、CWV、WCAG 和人工签收在五条线恢复后完成 | 六模块无占位；zh/en×light/dark×desktop/mobile 视觉矩阵通过；工作区装饰不侵入控件；UX/PERF 门达到 doc 25 阈值 |

## 6. R1-13～R1-18：测量、生产与发布

| 阶段 | 依赖 | 动作与产物 | 退出证据 |
| --- | --- | --- | --- |
| **R1-13 指标、报表与产品遥测** | R1-5～12 | 为招生、在读/流失、排课/到课/补课、作业/成果、内容消费、运营 SLA 和启用时的财务定义分子/分母、去重键、时区、延迟、权限和版本；采集错误、性能、job、通知、发布事件 | Dashboard/导出/报告使用同一指标版本；doc 25 的运行门可查询、告警且不采集非必要未成年人 PII |
| **R1-14 幂等、并发、事务、文件与 E2E** | R1-2～13 | commit `cbb2a0f` 已清零本轮修复前 19 项 Vitest 失败；commits `0d55044`、`8e5c076` 已建立正式 Playwright 配置、匿名/固定角色隔离、loopback/LAN 目标策略和 fail-closed release runner，9 条非五模块本地 Chromium 旅程分别取得绿色证据，见[基线子门](../evidence/r1/r1-14-playwright-baseline.md)。继续修复关键写操作双击/重试/竞争，保证领域事实与审计同事务，外部调用走 job/outbox | 当前 Vitest 571/571；仍须在明确非生产发布目标完整重跑 9/9 零 skip，并补写态、zh/en、跨浏览器、连续 3 次无 flaky、大文件和竞争矩阵；这些门及 R1-13 依赖未齐前 R1-14 不关闭 |
| **R1-15 生产清理与 release-1 隔离演练** | R1-14 | `pnpm r1:baseline-plan` 已提供只读、确定性的隔离目标 preflight；后续只在生产快照副本执行审核 manifest、dry-run、备份、账号/运营数据清理，并为 E 系列 1135×2 与爱学习 170×2 重建共 2610 条 release-1；第二次运行必须 no-op | 当前 planner 仅证明输入、计数、hash 与环境拒绝合同；仍需 1 次全量演练成功、计数满足 doc 25 不变量、备份可恢复，且本阶段未修改真实生产 |
| **R1-16 独立生产、监控、备份与恢复** | R1-14～15 | commit `35b9f60` 已提供 `pnpm r1:deployment-plan` 只读 fail-closed preflight，固定 current/target/recovery 指纹隔离、受控 secret/config 引用、监控、RPO/RTO、隔离恢复和应用回滚合同，见[部署 Preflight](../evidence/r1/r1-16-deployment-preflight.md)。commits `3077fee`、`82c0920`、`8e5c076` 已让当前树、binary ASCII、高风险容器及完整可达 Git 历史的高置信 secret scan 均为 0，见[仓库扫描子门](../evidence/r1/r1-16-repository-secret-scan.md) | 仓库扫描不证明开发/预生产/生产环境、数据、secret、Storage 和域名隔离。R1-14、R1-15、环境隔离、监控探针、数据库恢复、Storage 恢复、应用回滚和非执行者复核未通过前保持 blocker；数据库 RPO≤15min/RTO≤4h，Storage RPO≤24h/RTO≤8h，应用回滚≤30min |
| **R1-17 14 天真实班级 RC** | R1-16 | 在生产候选环境运行连续 14 天、至少 5 节真实课堂；覆盖请假/补课、作业、成果/视频、家长查看和启用时的财务 | 可用性≥99.5%；关键 action 系统错误率<0.5%；jobs/通知最终成功≥99%；发布时未处置 dead-letter=0 |
| **R1-18 正式初始化与 v1.0.0** | R1-17 | 人工批准后备份真实生产；删除测试/RC 身份、班级、订单和依赖运营数据；保留唯一管理员；为 E 系列 1135 讲和爱学习 170 讲的两条轨道重建 2610 条 release-1；只读/可回滚烟测；部署并标记 `v1.0.0` | doc 25 全部硬门通过；Sev0/Sev1/未接受 Sev2=0；证据包记录 commit、migration、环境、manifest、时间、执行人和审批人 |

## 7. 当前专题与后续处理

- 2026-08-13 已按用户决定从 SML-0 切回 R1-9；SML-0 的阶段、产物和暂停点仍以 doc 28 §14～15 为准。
- P6-AIX-2 关闭后继续 R1-9/P6-9；不得自动恢复 SML-0 或跳入 R1-10。

- 补齐英文课程、Minds 和 Story 长内容；1.0 已包含 zh/en UI 和缺失内容回退。
- 启动 `cacheComponents` + `use cache` 专项；继续禁止 `unstable_cache`。
- 评估原生 App、更多游戏/章节、复杂营销和高级 BI。
- 只有查询 p95 超过门且索引/查询改写无效时，才评估物化 work-item 投影。

## 8. 阶段关闭记录

| 阶段 | 关闭日期 | 结果 | 证据索引 |
| --- | --- | --- | --- |
| R1-0 | 2026-07-28 | 范围、责任归属、证据位置和阶段唯一性已冻结；治理审计通过 | [`docs/evidence/r1/r1-0.md`](../evidence/r1/r1-0.md) |
| R1-1 | 2026-07-28 | 机构/校区、版本化规则、Feature Flag、fail-closed 与 zh/en 管理 UI 已通过空库重放、RLS/负向断言和浏览器验证 | [`docs/evidence/r1/r1-1.md`](../evidence/r1/r1-1.md) |
| R1-2 | 2026-07-28 | Job/通知/文件/集成合同已通过空库重放、负向断言、Worker 单次运行与 zh/en 浏览器验证 | [`docs/evidence/r1/r1-2.md`](../evidence/r1/r1-2.md) |
| R1-3 | 2026-07-28 | 账户门控、MFA、会话、同意版本、用户权利、员工邀请、支持审计与恢复清单已通过空库重放、负向断言和 zh/en 浏览器验证 | [`docs/evidence/r1/r1-3.md`](../evidence/r1/r1-3.md) |
| R1-4 | 2026-07-28 | 11 类领域投影与个人状态保留；持久协同项、独立审批、动态逾期、RPC 边界和去重通知通过；30,000 项性能采样远低于 PERF-04 | [`docs/evidence/r1/r1-4.md`](../evidence/r1/r1-4.md) |
| R1-5 | 2026-07-31 | 学生/家长关键旅程、课堂连续性、跨家庭/跨学生拒绝、zh/en 特殊状态、14/14 CI 与 144 文件空库重放/13 项数据库审计通过 | [`docs/evidence/r1/r1-5.md`](../evidence/r1/r1-5.md) |
| R1-6 | 2026-08-01 | 教学成果、阶段报告、自动保存、具体通知与学生/家庭读取闭环通过 | [`docs/evidence/r1/r1-6.md`](../evidence/r1/r1-6.md) |
| R1-7 | 2026-08-01 | 初始化/导入/质量/修复/导出五个子阶段关闭；14/14 CI、155 迁移空库重放、11 项数据库断言和两条真实导出链路通过 | [docs/evidence/r1/r1-7.md](../evidence/r1/r1-7.md) |
| R1-8 | 2026-08-01 | 1.0 财务发布门安全关闭；路由/导航、数据、work item/审批、通知、指标和 job 同时 fail-closed | [`docs/evidence/r1/r1-8.md`](../evidence/r1/r1-8.md) |

关闭阶段的同一变更包含：

1. 代码、迁移、内容或 runbook；
2. E1～E4 证据索引及失败记录；
3. doc 25 成熟度、风险和例外到期日；
4. 相关专题文档状态头；
5. 本文件顶部下一阶段与 README 当前阶段；
6. `pnpm plan:audit`、相关测试、typecheck 和 production build 结果。
