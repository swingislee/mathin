# Mathin 生产 1.0 产品完整性与发布规划

> **规划状态**：`active`
>
> **用途**：记录 Production 1.0 的仓库事实、M0～M4 成熟度、业务合同、量化发布门和生产初始化步骤；R1-Live 的当前 Gate 与施工顺序由 doc 04 管理。
>
> **基线日期**：2026-08-31；每次验收另记 commit、migration head、环境和数据 manifest。2026-08-31 只登记 `DEV-CW-1` 规划与人工确认门，生产运行基线仍来自 2026-08-30 的已核对证据。
>
> **删除限制**：R1-15 只操作生产快照副本；R1-18 经人工批准后也只能处理 manifest 明确标记的测试对象。R1-Live 产生的正式身份、班级、课次、学生、业务记录及课次引用的 immutable release/snapshot/object 永久排除在测试清理之外。

## 1. 范围与当前事实

### 1.1 1.0 交付对象

| 范围 | 当前输入 | 1.0 结果 |
| --- | --- | --- |
| Terms | `content/zh/terms` 71 篇 MDX；概念、星系和学习线路由已存在 | 71 篇可发布；slug、公式、依赖、引用、搜索、SEO、站内链接错误为 0 |
| Story | `/story` 路由和场景壳存在；未发现完整独立章节内容目录 | 至少 1 个从入口到结尾的章节；阅读/交互 10～20 分钟或达到产品签收的完整最小章节 |
| Games | registry 3 个游戏 | 3/3 可玩；需要排名的客户端成绩经服务端验证后入榜 |
| Minds | `content/zh/minds` 2 篇 MDX | 2/2 发布，并关联稳定 Terms ID |
| Tools | registry 3 个工具，其中 `spatial-lab` 是无持久化的空间数学验收样机；存在 `/embed/[tool]` | 3/3 独立使用；既定嵌入场景通过；样机不误示保存、发布或课堂同步已经可用 |
| Notebook | 私有列表、编辑、公开详情路由存在；commit `11885f7` 已关闭发布归属与互动隐私边界，commits `8c9cb8c`、`ffe3ec6` 已在开发库建立可追溯审核发布生命周期、平台锁、归档删除守卫和源笔记快照绑定 | 私人写作、完整审核状态机、发布/撤回/修订、公开阅读和互动完成权限/E2E 验收 |
| 学校运营 | 学生、监护关系、员工权限、课程、班级、排课、考勤、作业、订单/支付/退款等迁移和 UI 已存在 | 管理员、教务、教师、学辅、教研/内容、学生、家长及启用时的财务旅程闭环 |
| 内容发布 | Terms/Minds 文件内容、Notebook、课程研发和 release 机制分别存在 | Terms/Story/Minds/Notebook 共用草稿/审核/发布/撤回/版本合同；课堂只读取不可变课件 release |
| E 系列 | 开发数据有 1135 讲、16:9/4:3 双轨资源和 release 机制；课程目录版本层已就位（2025旧版 54 门 / 2026新版 36 门） | 保留 1135×2 源资源；正式基线包含 2270 条 `release_no=1`，见 §5.1.1 |
| 爱学习 G+/X+/A+ 秋季 | G+ 苏教版 56 讲、X+ 苏教版 84 讲、A+ 全国版 30 讲；16:9/4:3 双轨资源和 release 机制 | 保留 170×2 源资源；正式基线包含 340 条 `release_no=1`；另有 10 条教学计划第 7/15 讲补充占位（G+ 五/六年级、X+ 二/五/六年级），占位无 release 且准备状态为“未发布” |
| 语言 | `messages/zh.json` 与 `messages/en.json` 各 4069 个 key；`content/en` 仅 README | UI 永久 zh/en；英文课程/文章可延期，缺失内容显示明确回退或“尚未发布”状态 |
| 视觉 | `public/Main.png`、五星球 token/场景、`dashboard-observatory.webp` 和公开场景插画已在仓库使用 | 小王子作为全站视觉基础；公开场景、内容/Notebook、运营工作区按三档强度验收 |

Terms 使用稳定 ID 接收 Story、Minds、Games、Tools、Notebook 和课程的关联。修改 slug 或删除内容前检查反向引用、重定向、canonical 和 sitemap。

### 1.1.1 2026-08-23 施工顺序

当前唯一施工阶段为 `R1-Live-2 · 生产单老师试用`。R1-Live 只保留两个结果 Gate：Gate 1 合并正式目标/身份、当前备份、防误清、可识别的 current/previous 与错误查询位置；Gate 2 合并真实点名闭环和首次真实教师验收。原范围冻结成为永久规则，完整恢复/rollback、错误 release 标签、独立观察和 14 天 RC 回到 Production 1.0。

- Gate 1 当前 `PASS`：Xiaomi 目标指纹、危险写拒绝、唯一正式 admin MFA、首名真实教师及双岗位、active 8 条 protected/0 条 purge manifest、current/previous、健康探针和错误查询位置均已确认。2026-08-30 讲次课件预览 hotfix postflight 后，生产数据库 ledger/head=`236 / 20260830000700_teacher_microcourse_editor_unification`；应用 current/previous=`20260830-080555` / `a165004…` 与 `20260830-045421` / `76f0f9a…`。产品负责人已确认 Stage B1/B2；Stage B3 共同 bridge、权威档案表与单一 Smart 开关已部署，H5 仍按既有 provider 合同 fail closed。最近 PostgreSQL 写前备份 `mathin-db-prechange-20260830T042220Z-tmc-unification-8b9b195` 与 PostgreSQL+Storage 同批次全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497` 已在 preflight 中核对；本轮 app-only 发布没有 schema、业务、课程 release、审核快照或 Storage 写入，未执行 restore 或 prune。
- Gate 2 当前仍为 `BLOCKED`，但生产单老师试用已经启动：本机隔离固定账号 Golden Path 已完成未完整课程建班、自动课次、`lead` 报名、教师点名保存和换页再读。生产现有 1 个长期正式班/15 个课次/1 条 active 报名和 1 个短期专题班/3 个课次/0 报名；另有 2 个 test 长期班合计 1 个课次，当前总数为班级/课次=`4/19`。学年迁移把春季边界修正为 `2026-06-29`，并只把原长期正式班/课次/报名改挂到 `2026–2027` 秋季，2026 学年仍为 planning，学生仍为五年级。正式点名仍为 0；退出前仍由该教师完成点名保存、刷新/重登再读，再做管理员读取和无权限拒绝。
- 生产轨保持 1 名正式教师小范围使用，真实反馈按 P0/核心 P1 优先；“试用已启动”只表示执行阶段变化，不代表 Gate 2、某项功能或 Production 1.0 已验收通过。
- 开发轨允许产品负责人并行尝试新功能。每项功能须先在隔离开发目标完成相关机器检查和产品负责人初步验收，再以独立可回退提交登记精确 commit/migration，经过生产目标、备份/current/previous、数据影响与回退 preflight 后小增量发布；postflight 须核对健康、错误增量、核心 Smoke 和受影响业务不变量。开发通过、已部署待验收与生产通过分别记账。
- `DEV-CW-1` 当前为 `STEP 3 IN PROGRESS`：产品负责人于 2026-08-31 确认 Step 2A 通过；一个 `CoursewareEditorWorkbench` 和 `CoursewareInsertionToolbar` 承担两条编辑链，微课为共同能力基线，正式课只增加 `adapt4x3`。统一组件的双端最终表现推迟到 Step 7 完成整体工作区重构后、Step 8 扩量前再审。当前只允许本机 E 系列“进位制初步”一个 PageDoc 页面草稿保存/重载；爱学习、整讲、跨页替换、批量回填、生产数据库/Storage/release 均不在授权范围。
- 普通教师微课开发轨 `DEV-TMC-1` 的课次编辑、草稿试讲、审核/release、来源导入、H5 和游戏页能力已部署，但 2026-08-29 确认目录聚合与浏览模型均错误：教师微课应以自由班为根，同班多个课节的已选课件共同组成一门多讲 `microcourse`；一个来源课节只产生一个稳定讲次，同课节的并行方案发布为该讲次的不同 immutable release。来源班级的年级、班型和运营学期用于追溯与可选筛选，不唯一决定微课，课程还可按单次/短系列/系列场次、完成度、标题、讲次、主题和关键词发现。教师微课课程族页使用同页目录—详情工作区，选择另一门微课不要求退回版本矩阵。旧实现把每个课次方案各投影成一门单讲课程，并套用教材课程的三维唯一寻址页面。生产当前正有 1 个自由班/3 个课节/3 个已选方案被拆成 3 门草稿，尚未发布 release。课次内容与课堂冻结链保留；班级级归并、专用共享目录和多讲建班必须重新完成隔离迁移、产品验收并另行取得生产授权。
- `DEV-TMC-2` 已获明确授权并部署生产：自由课次允许任课教师与教研直接建立并行课件方案，编辑他人方案时派生新 head，主讲在开课前选择本节使用方案；课次使用不经过审核。该课次级协作与课堂选用合同继续有效，但校内共享改为由班级保存动作读取各课节的“本节使用”方案，一班一课、多课节多讲；同课节并行方案不得各自隐式成为课程或讲次，审核发布后只增加该稳定讲次的 release 版本。既有 SQL、定向测试、固定账号旅程和生产 postflight 只证明课次级能力，不证明班级级教师微课已经实现或验收。
- `DEV-TMC-4` 当前为 `PRODUCTION APP/SCHEMA DETECTED / PREVIOUS DEPLOYMENT EVIDENCE RECONCILIATION PENDING / PRODUCT ACCEPTANCE PENDING`。2026-08-30 本 hotfix 写前 preflight 已检出生产应用 `76f0f9a…` 与数据库 ledger/head=`236 / 20260830000700_teacher_microcourse_editor_unification`，说明 doc 29 的使用场景、学术维度、适用范围、课程浏览/维护与 composition 统一 schema/app 已在本轮前进入生产。本轮没有执行这些 migration、归并、开关或写态验收，也不把此前部署记为产品通过；课程切换卡顿仍按 `POST-LIVE-PERF-01` 收集。现有课次方案、review/release 和课堂冻结继续作为权威。
- `HOTFIX-20260829` 已获明确授权并完成应用-only 发布：`557fc51` 修复来源 H5 透明层，`7601c86` 让自由班复用每周几、教学日历自动排期、逐讲时间覆盖和冲突检查。生产 current=`20260828-190055` / `7601c86…`，previous=`20260828-174731` / `34f07e8…`；双 production build、HTTP/鉴权、systemd/journal 和业务不变量 postflight 通过。两讲暑期 A+ 不重导，数据库、课程 release 与 Storage 零写入；localhost-only 来源工具 `26adab7` 没有独立生产运行面。产品负责人仍需自行完成生产页面验收。
- `HOTFIX-20260829-ADMIN-SELF-ROLE` 已获明确授权并完成 schema/app 发布：顶层 admin 可以管理自己的员工岗位，普通 staff 仍不能自授岗，管理员自身停用仍不开放。首个 rollback rehearsal 发现现网显式 anon execute 并 fail closed，独立零残留后由 `ba98a8e` 收紧 ACL；最终 migration `20260829000200_admin_self_staff_roles` 经新鲜 PostgreSQL-only 备份、rollback/零残留/formal 把 ledger 推到 `220`，应用 current/previous=`20260828-195733` / `ba98a8e…` 与 `20260828-190055` / `7601c86…`。HTTP/systemd/journal、数据库、业务、Storage 与备份 postflight 通过；管理员岗位成员仍为 0，等待产品负责人实际自授岗验收。
- `HOTFIX-20260829-TMC-RESEARCH-ENTRY` 已完成 app-only 发布：DEV-TMC-2 的 schema、feature flag 与 research 权限原已在生产生效，问题来自普通课次页仍要求任课教师 `canPrepare` 才显示“编辑课件”。`bf81aa4` 允许具备 `courseware.review + courseware.microcourse.author` 的教研直接打开其他老师自由课次的方案工作区，并继续隐藏试讲、完成备课、点名、课堂控制和“本节使用”。本机定向 Vitest 9/9、固定账号 Playwright 1/1、双 production build、原子切换和无登录 postflight 通过；current/previous=`20260829-031327` / `bf81aa4…` 与 `20260828-195733` / `ba98a8e…`，生产人工页面验收仍 pending。
- `HOTFIX-20260829-TMC-SOURCE-PREVIEW` 已完成 app-only 发布：空 kind 的来源绑定此前跳过 pinned H5 对象 kind/hash，误走普通资源签名；通用讲次审核入口又只看已发布 release。`6185352` 以钉死对象为权威解析来源 package，并将 active 教师微课审核转到不可变提交快照。生产既有待审作品保持 32 页、283/283 个绑定；定向 Vitest 17/17、固定账号 Playwright 2/2、双 production build、原子切换和独立 postflight 通过。current/previous=`20260829-045135` / `6185352…` 与 `20260829-033955` / `59cc342…`，数据库、审核快照和 Storage 零写入，生产人工页面验收仍 pending。
- `HOTFIX-20260830-COURSEWARE-PREVIEW-PAGING` 已完成 app-only 发布：来源提交 `50a1648…` 以生产 `76f0f9a…` 适配为候选 `a165004…`，让讲次只读预览按页读取、生命周期缓存、相邻预取并只同步 History API 页码，来源 runtime 按 package/entry 复用 iframe，教师微课同讲资源签名批量解析。定向 Vitest 10/10、messages 5205×2、全库 ESLint/TypeScript、双 production build、原子切换及健康/鉴权/bundle/数据不变量 postflight 通过；current/previous=`20260830-080555` / `a165004…` 与 `20260830-045421` / `76f0f9a…`，数据库和 Storage 零写入。真实课程冷／热翻页待产品验收；教师微课课程切换是另一条 quick-preview 路径，继续 pending。
- `HOTFIX-20260829-CLASSROOM-INTERACTION-SYNC` 当前为 `DEPLOYED / MACHINE POSTFLIGHT PASSED / PENDING REAL IPAD ACCEPTANCE`：新式 `game-page-v1` 数独适配链补齐 `GameMirrorState` 的采集、100ms 合并广播与 viewer replay；统一 `ClassroomInteractionSyncProvider` 对每个 Mathin 自研 docVersion、微课 mode 和游戏 registry 项做穷尽审计。定向 Vitest 72/72、独立审计 4/4、本地 Chromium 正式课次控制页→展示页同步用例及生产 app-only postflight 通过，代码继续包含在 current `a165004…`；自研 H5 与空间页在版本化状态/语义命令协议接入前保持课堂只读。本项不含 schema、数据库或 Storage 写入；真实 iPad Safari、跨设备局域网和产品验收仍 pending。
- 课堂可扩展互动在开发轨使用版本化 capability provider 和统一 conformance；普通 renderer 复用既有输入原语时不逐个重复人工 Gate。新增原语、输入路由/所有权算法、跨 iframe 协议和真实设备回归仍单独人工验收；未声明或不匹配 provider 的 renderer 继续 fail closed。M0–M4 开发端已整体关闭，M5 Stage B1/B2 已由产品负责人确认。Stage B3 的共同 bridge、按不可变 package SHA-256 登记的 `cw_h5_input_profiles`、单一 Smart 开关与工具派生回退锁已通过隔离提交 `964ca5e` 和 migration `20260826000100_classroom_h5_input_profiles` 部署；入口为外层透明无边框、强调色 SVG + 滑轨的 `112×44px` 二态开关。生产表为空，H5 继续 version 3 / false，未声明或不匹配 package 仍 fail closed；该状态为 `DEPLOYED / PENDING USER ACCEPTANCE`，不能记为 H5 pointer、M5 或 Gate 2 生产通过。
- 班级启用是运营决定。正式自由班、未完整课程、教师冲突、备课产物/审核/检查项、点名前置、资源预载和无 release 都只提示；创建时的权限、主讲/学期、course/family/lecture 引用、状态和不可变历史继续硬阻断。无 release 课次可冻结 `releaseId=null` 的空白/本次覆盖快照。
- 现有 purge 只接受 active manifest 明确的 `purge_allowed` test 根，当前准删数为 0。日常新增正式学生、班级、课次和考勤不要求逐行替换 manifest；只有未来授权具体清理根时才按当时删除闭包生成 replacement。
- 原 R1 暂停在 R1-9。P6-AIX-2、G+/X+/A+ 170 讲和 102 门/1305 讲/2610 条目标 release-1 合同保留；真实全量 inventory、Storage/H5 审计、Terms/Story/其他公开模块、完整视觉/E2E/恢复门转入 R1-Live 后继续。
- SML-0 为独立并行轨道；普通教师默认不可见未完成能力，只有破坏共享认证、授权、数据或点名黄金路径时才阻塞 R1-Live。
- R1-Live 的正式业务事实及课次引用的 immutable release/snapshot/object 不得在后续 R1-15/R1-18 中删除或改写。现有两个数据库 purge RPC 已接入正式对象保护合同；旧全库 planner 尚未接入同一合同，在完成 schema 修订并于隔离副本重新验收前保持 plan-only、不可执行。

### 1.1.2 R1-Live 与本文件硬门的关系

| 范围 | R1-Live 前必须 | R1-Live 后、`v1.0.0` 前完成 |
| --- | --- | --- |
| 产品 | 正式教师点名闭环涉及的登录、班级、课次和错误状态 | §1.1 的全部公开模块、内容发布和角色旅程 |
| 身份/数据 | 正式管理员、正式教师、最小真实数据、RLS 负向、production/test 防误清 | 完整角色旅程、清理时删除闭包 manifest 与数据治理 |
| 测试 | 点名 Golden Path、管理员读取、越权拒绝 | PROD-01、完整 R1-14 矩阵、容量/文件/竞争 |
| 运维 | 当前备份存在；current/previous 和回退命令可识别；错误查询位置已知；危险开发动作拒绝目标 | §5.4 的 RPO/RTO、全量恢复、受控 rollback、release 错误标签、监控与发布审批 |
| 观察 | 1 名真实教师完成首个闭环 | 独立观察、R1-Live 后连续 14 天/至少 5 节真实课堂，作为扩大范围和 `v1.0.0` 证据 |

### 1.2 工程与验证基线

| 对象 | 最近可核对事实（截至 2026-08-13） | 尚不能支持的结论 |
| --- | --- | --- |
| 应用 | Next.js 16.2.11、React 19、Tailwind 4、next-intl、Supabase SSR | production build 通过不证明角色旅程、容量或恢复达标 |
| 权限 | 顶层角色为 `student`、`parent`、`staff`、`admin`；受保护页使用 `requireUser`；数据库使用 RLS | Proxy 跳转和前端隐藏不能证明授权 |
| Dashboard | P4I 已将首页和对象页改为工作流入口 | 页面存在不证明跨域工作项、人工协同或 p95 达标 |
| CI | lint、typecheck、build、消息、数据库重建/RLS、安全、当前树与 Git 历史 secret scan、doc21～24 与规划审计已配置；正式 Playwright 配置和 release runner 已落地 | 固定凭据旅程不接通用 CI；仍须在明确非生产发布目标执行零 skip 套件，并补写态、zh/en、跨浏览器与连续无 flaky 证据 |
| Vitest | 全量回归基线为 93 个测试文件、625 项通过、1 项因未提供爱学习生成包根而条件跳过；非 spatial 基线为 56 个文件、346 项通过、1 项条件跳过，空间数学/SML-0 专项 37 个文件、279/279。当前 `pnpm r1:live:test` 为 6 个文件、52/52；历史 `pnpm r1:regression` 为 23 个文件、179/179 | 52 项只证明当前两 Gate 的源码合同；179 项是 R1-1～16 累积回归；全量与历史数量均不能替代隔离数据库、Playwright、生产只读核查或真实教师证据 |
| 部署 | doc 17 已将目标生产主机改为小米 Linux；commit `35b9f60` 已固定独立环境、监控、恢复和回滚的只读 preflight；当前树与完整可达 Git 历史的高置信 secret scan 为 0 | 仓库扫描不证明环境隔离；尚无独立生产、RPO/RTO 实操、回滚演练和 14 天 RC 证据 |

### 1.3 已裁决的历史冲突

| 主题 | 当前合同 | 被替代描述 |
| --- | --- | --- |
| 身份 | `student`、`parent`、`staff`、`admin`；教师等属于 staff 权限 | `profiles.role=teacher` |
| 路由 | Story/Games/Minds/Terms/Tools/Notebook 使用现行显式路由 | 全部板块由单一 `[section]` 页面承载 |
| Dashboard | P4H/P4I 工作流导航和对象工作区 | P4C 角色磁贴工作台 |
| 正式班启用 | 启用由运营人员决定；自由班、课程/讲次未完整、教师冲突、备课质量项、点名、预载和无 release 只告警。创建时仍校验权限、主讲/学期和有效 course/family/lecture 引用；无 release 可冻结空白/覆盖层快照 | 正式课程未全部发布时只能创建为筹备中；点名/审核/预载必须完成后才能开课 |
| P6 | P6-1～6 主体已落地；R1 处理 P6-9 和正式基线 | 从 P6-1 重新施工 |
| UI | UI-L1～L4 工程阶段已关闭；R1 做三档小王子视觉、浏览器、无障碍和人工签收 | 重开整轮 Dashboard 视觉改造 |
| 生产 | 独立小米 Linux 环境 | Windows 生产拓扑 |

## 2. 成熟度与证据规范

### 2.1 成熟度

| 等级 | 必须具备 | 允许缺少 |
| --- | --- | --- |
| M0 未实现 | 无可用实现，或只有计划/设计 | 全部运行证据 |
| M1 骨架 | 路由、schema、迁移、原型或内容文件至少一项 | 完整旅程、失败处理、环境证据 |
| M2 功能可用 | happy path、基本权限和至少一项自动验证 | 重试/并发/恢复、正式内容、生产指标 |
| M3 预生产就绪 | 成功、失败、越权、重复提交测试；审计/观测；一次预生产 E2E | 14 天 RC 与正式发布审批 |
| M4 生产验收 | 本文硬门全部通过；恢复演练；要求真实运营的领域有 RC 记录 | 仅有批准的 Conditional Go 例外 |

可选能力若关闭，必须同时关闭路由入口、导航、work item、通知、指标和 job；关闭状态以 M4 的安全关闭证据验收。

### 2.2 证据等级

| 等级 | 载体 | 可支持的判断 |
| --- | --- | --- |
| E0 计划 | 规划、设计稿、会议决定 | 范围和预期；不支持“已落地” |
| E1 静态实现 | 代码、迁移、schema、配置、内容文件 | 对象存在，字段和接口可检查 |
| E2 自动验证 | 单元/集成/RLS、审计脚本、lint、typecheck、build、消息检查 | 已编码合同在测试数据上成立 |
| E3 环境验证 | 固定 commit/环境的 E2E、性能、浏览器、截图、恢复日志 | 组件集成、运行质量和视觉结果 |
| E4 运营验证 | 真实角色、课堂 RC、告警/支持记录、Go/No-Go 审批 | 正式运营场景在观察窗内成立 |

| 成熟度 | 最低证据组合 |
| --- | --- |
| M1 | E1 |
| M2 | E1 + happy-path E2 + 已知缺口 |
| M3 | E1 + 成功/失败/越权/重试 E2 + 至少一次 E3 |
| M4 | M3 + 所有适用硬门 E3 + 适用 E4 |

每条证据记录以下字段：

```text
gate_id, domain, result, measured_value, threshold
commit_sha, migration_head, environment, dataset_manifest
started_at, finished_at, actor, approver
command_or_runbook, artifact_url_or_path, artifact_hash, failure_ticket
```

截图只证明呈现结果；权限使用 RLS/Auth 负向测试，性能使用采样报告，恢复使用备份 ID、时间戳和恢复后烟测。

### 2.3 Work item 关闭条件

1. 记录对象、允许角色、动作、输入、结果、失败码和回滚边界。
2. 同步实现、迁移、RLS、zh/en UI、审计/指标和 runbook。
3. 测试 happy path、越权、重复提交和至少一个关键失败场景。
4. 保存该阶段要求的 E1～E4 证据。
5. 更新专题文档状态头、doc 04 和本文件矩阵。

## 3. 成熟度矩阵

当前等级截至 2026-08-15，并按已登记的阶段或子门证据更新；本矩阵衡量 Production 1.0，不是 R1-Live 的前置清单。R1-Live 只提升实际覆盖的身份、点名和最小运维证据，不能据此把整个领域提升至 M4。

| 领域 | 当前 | 1.0 | 已知缺口 | R1 |
| --- | --- | --- | --- | --- |
| 规划/变更治理 | M3 | M4 | R1-0 已冻结实际 owner 与证据位置；2026-08-14 增加 R1-Live Gate，后续持续维护索引并在 Production 1.0 汇总审批 | 0/Live/18 |
| 机构配置/场地/Feature Flag | M3 | M4 | R1-1 已完成旧设置中心与版本化开关；`DEV-ORG-1`、`DEV-DASH-1` 与 `DEV-DASH-2` 已把机构资料、校区/教室、机构级学年/日历/排课默认、能力发布、职能导航、个人优先/全部表格班级视图、10 条课件资源分页及统一表格/分隔语义部署到生产。兼容双写、固定账号 Playwright、完整 migration 回滚/零残留演练及机器 postflight 通过。M4 仍需生产页面人工验收、正式角色旅程、兼容合同退休和完整发布门 | 1/DEV-ORG-1/DEV-DASH-1/DEV-DASH-2/15/18 |
| Jobs/通知/文件/集成 | M3 | M4 | R1-2 已完成 durable job/dead-letter/重放、第一方通知、TUS/文件策略、webhook 防重放与开发环境验证；M4 仍需生产 Worker、选中供应商（如有）、大文件并发/容量、告警恢复和 14 天 RC | 2/14/16/17 |
| 账户/Auth/同意/支持 | M3 | M4 | R1-3 已完成版本化同意、MFA/会话、权利请求、员工邀请、封禁/恢复和审计支持；R1-Live 先建立正式管理员/教师并验证恢复。`POST-LIVE-AUTH-01` 第一阶段已部署传统设置页式统一账号中心，提供头像/显示名称/语言、只读登录 identity、密码、MFA、会话与恢复；真实姓名、岗位、学生及家庭信息继续由业务档案维护，provider 绑定留待后续 | 3/Live/12/14/16/17/18 |
| Work-items/审批 | M3 | M4 | R1-4 已完成混合投影、持久协同、独立审批、动态逾期、幂等/通知与开发规模 PERF-04；M4 仍需正式 E2E、生产候选负载和 RC 指标 | 4/14/17 |
| 学生门户 | M3 | M4 | R1-5 已完成本人课务/考勤/请假补课/作业/视频/成果/逐题学情/通知、草稿隔离、跨学生拒绝与 zh/en 开发环境旅程；M4 仍需 R1-14 正式 Playwright、R1-16 独立生产、R1-17 RC 与 R1-18 发布证据 | 5/14/16/17/18 |
| 家庭门户 | M3 | M4 | R1-5 已完成稳定学生 ID 多子女切换、未绑定/待审核/撤回/财务关闭、关系撤销、请假补课、成果通知、跨家庭拒绝与 zh/en 开发环境旅程；M4 仍需 R1-14 正式 Playwright、R1-16 独立生产、R1-17 RC 与 R1-18 发布证据 | 5/14/16/17/18 |
| 教学成果/报告 | M3 | M4 | R1-6 已完成独立成果生命周期、三类草稿自动保存、阶段报告证据工作台、审核通知和学生/家庭读取；M4 仍需 R1-14/16/17/18 环境与运营证据 | 6/14/16/17/18 |
| 初始化/导入/质量/导出 | M3 | M4 | R1-7 已完成 dry-run/幂等导入、可复现初始化、版本化质量扫描、带恢复点的领域修复、字段白名单导出/过期/审计及开发环境旅程；M4 仍需 R1-14/15/16/18 的正式 E2E、隔离演练和生产证据 | 7/14/15/16/18 |
| 财务 | M3（安全关闭） | M4 安全关闭 | R1-8 已锁定发布门并关闭路由/导航、数据、work item/审批、通知、指标和 job；R1-15/18 在隔离副本和正式环境复核关闭不变量 | 8/15/18 |
| Terms | M2 | M4 | 图谱、内容、搜索、SEO、跨链全验 | 9 |
| 公共内容发布 | M1～M2 | M4 | 统一状态机、资源、稳定关系、本地化状态 | 9～11 |
| 课程研发/双轨 release | M3 | M4 | P6-AIX-2 已固定 G+/X+/A+ 秋季 170 讲/5442 页；2026-08-27 开发库另导入一年级 A+ 暑期 2 讲/66 页并保留 13 个空占位，开发库爱学习现为 13 门课程、195 个教学计划讲次（172 个 source-backed）/5508 页。开发库已在保留 revision/release 1 的前提下把 5508 页两轨 current head 升级到 `source-runtime-page-v1` revision 2 / release 2；该适配器和暑期增量均未进入 Production 1.0 基线。[来源 manifest 子门](../evidence/r1/r1-9-courseware-source-manifest.md)已同步 102 门/1305 讲/2610 条 release-1 的 v4 确定性合同、只读导出/对象校验核心与受控 runner；批准副本真实 inventory、Storage/H5 审计、隔离演练和正式 release-1 仍缺 | 9/15/18 |
| 课程产品统一课件工作区 | M1（Step 0～2A 已确认；Step 3 施工中） | M4 | doc 16 §14 已记录人工确认门；正式课件与教师微课共用完整 `CoursewareEditorWorkbench` 和 `CoursewareInsertionToolbar`，正式 adapter 只额外开启 4:3。Step 3 只做本机 E 系列一个 PageDoc 页面的草稿纵切；PageDoc/source-runtime/composition 仍分别承载来源限制、12×9 网格和写态。整体重构完成后、扩量前再双端定稿组件表现 | DEV-CW-1/9 |
| Story | M1 | M4 | 完整章节和内容生产记录 | 10 |
| Games | M2～M3 | M4 | 排名可信、浏览器、容量 | 11/12 |
| Minds | M2 | M4 | Terms 关系、内容回退 | 11/12 |
| Tools | M2～M3 | M4 | 嵌入、浏览器、性能 | 11/12 |
| Notebook | M2（开发生命周期与数据库边界子门已通过） | M4 | commit `11885f7` 与[隐私子门](../evidence/r1/r1-11-notebook-readiness.md)已关闭跨用户/归档发布、点赞身份泄露和不可见内容互动；commits `8c9cb8c`、`ffe3ec6` 与[生命周期子门](../evidence/r1/r1-11-notebook-lifecycle.md)已覆盖审核、撤回/修订、平台锁、revision 内容字段不可变、归档级联和新提交源快照一致性。尚无预生产完整写态 release E2E，不能提升至 M3；旅途笔记视觉与普通 Note CRUD 结构化结果也仍缺 | 11/12 |
| 全站视觉/SEO/a11y/体验性能 | M2 | M4 | 三档小王子语言、104 份代表页视觉证据、WCAG；讲次只读课件预览的页级读取/缓存/相邻预取/runtime 复用已以 `a165004…` 上线并通过机器 postflight，真实冷／热翻页仍待验收。`POST-LIVE-PERF-01` 的首个教师微课课程切换样本人工手感未通过且未被该 hotfix 覆盖；它不构成功能缺失或 Gate 2 blocker，集中优化与新门槛待采样后裁决 | 12/Live |
| 指标/报表/遥测 | M1～M2 | M4 | 口径、版本、查询、告警 | 13 |
| 幂等/并发/事务/E2E | M2～M3（正式基线/开发目标） | M4 | 本轮修复前 19 项 Vitest 失败已在 commit `cbb2a0f` 清零；commits `0d55044`、`8e5c076` 与[Playwright 子门](../evidence/r1/r1-14-playwright-baseline.md)已让 9 条本地非五模块 Chromium 旅程分别取绿并固定 release fail-closed 合同；仍缺发布目标完整重跑、写态、zh/en、跨浏览器、连续无 flaky、大文件和竞争矩阵 | 14 |
| 生产清理/release-1 | M1（旧 planner） | M4 | 旧 planner 假定只保留管理员且无正式历史 release，与 R1-Live 后正式教师/业务数据/课次内容引用冲突；须增加正式对象保护 manifest 后再做快照副本演练、测试数据清理、可逆脚本和正式计数 | Live/15/18 |
| 部署/备份/恢复 | M2（生产发布/当前备份） | M4 | commit `35b9f60` 与[部署子门](../evidence/r1/r1-16-deployment-preflight.md)已固定 fail-closed 合同；仓库/历史 secret scan 已关闭。2026-08-30 讲次预览 app-only hotfix 后 current/previous=`20260830-080555` / `a165004…` 与 `20260830-045421` / `76f0f9a…`，原子切换及健康门通过；数据库 ledger/head=`236 / 20260830000700_teacher_microcourse_editor_unification`。最近 PostgreSQL 写前备份为 `mathin-db-prechange-20260830T042220Z-tmc-unification-8b9b195`，既有 PostgreSQL+Storage 同批次全量备份继续作为 Storage 回退基线；本轮没有 schema、业务、课程 release、审核快照或 Storage 写入，previous 是应用回退点。恢复演练、异机/静态加密备份和错误 release 标签属于 M4 | Live/16 |
| 真实运营 RC | M0 | M4 | R1-Live Gate 2 先取得 1 名真实教师闭环；独立观察及开放后连续 14 天/至少 5 节真实课堂形成扩围和 Production 1.0 证据 | Live/17 |

## 4. 业务合同

### 4.1 Work-items：现状、缺口与决定

`20260720001700_p4i6_work_item_projection.sql` 中的 `list_my_work_items` 使用 11 个 `union all` 来源：`review.fix`、`review.approve`、`review.publish`、`session.prepare`、`session.task`、`support.task`、`leave_request.decide`、`student.followup`、`refund.approve`、`classroom.no_primary_teacher`、`session.overdue_not_started`。

| 当前对象 | 已有行为 | 限制 |
| --- | --- | --- |
| 领域表/RPC | 保存考勤、订单、审核、作业等状态并执行副作用 | 继续作为业务真相 |
| `list_my_domain_work_items` | 保留 11 类领域行动投影并统一计算紧急程度 | 只读投影；业务完成仍走领域 RPC |
| `list_my_work_items` | 统一返回 11 类领域投影、持久协同项和审批请求/决定 | 已有开发规模 p95/p99；尚缺生产候选/RC 负载证据 |
| `work_item_user_state` | 保存 seen/snooze/pin/acknowledge/watch | 只保存个人状态；不写业务完成态 |
| `domain_events` + ChangeBell | 将领域事件和工作入口展示给用户 | 事件和工作项没有自动等价关系 |

1.0 使用三层模型：

1. 领域表/RPC 保存业务状态；领域工作项只能通过领域动作完成。
2. `list_my_work_items` 输出领域投影；通用列表不提供绕过领域 RPC 的“完成”操作。
3. 持久 `work_items` 只保存人工协调、跨域异常、委派和独立 SLA；字段至少包含 `id/source_kind/source_id/idempotency_key/assignee_id/due_at/status/created_reason/closed_reason/created_at/closed_at`。

审批保存独立 `approval_request` 与 decision/audit，再投影到列表。`overdue` 每次由 `due_at < now()` 计算。统一读取结果包含 `source_kind/source_id/action_kind/action_href/assignee/due_at/priority/read_state/can_act`。只有 p95 超过 500ms 且索引、谓词下推和查询改写仍不达标时，才设计物化投影。

R1-4 以 `20260728000500_r1_work_items_approvals.sql` 落地上述三层模型、追加式分派审计、独立审批请求/不可变决定、授权 RPC 和通知去重。116 文件空库重放、开发库/一次性库权限与幂等断言、30,000 条持久项 PERF-04 采样及 zh/en 请求人/审批人浏览器旅程已通过，见 [`docs/evidence/r1/r1-4.md`](../evidence/r1/r1-4.md)。本证据为 M3，不证明真实生产或 14 天 RC 负载。

### 4.2 身份、门户与员工交接

| 对象 | 动作 | 必须产生的记录/结果 |
| --- | --- | --- |
| 管理员 | 邀请/认领员工，分配 staff 权限，停用/恢复，撤销会话 | 操作者、原因、旧/新权限、时间和审计事件 |
| 学生账号 | 受控认领、登录、查看自己的课表/课堂/考勤/请假/作业/成果/通知 | 查询限定本人；草稿和内部备注不返回 |
| 家长账号 | 受控绑定、切换子女、查看已发布信息 | 查询限定有效监护关系；关系撤销后立即失去访问 |
| 离职员工 | 转移班级、学生、工作项、审核和待办后停用 | 历史业务保留原负责人；新责任人和交接审计可查 |
| 管理员支持 | 撤销会话、发起恢复、查看必要诊断 | 不显示密码/token；所有动作受权限和审计约束 |

登录、登出、找回、改密、MFA、邮箱确认、封禁和速率限制提供 zh/en 结果。未绑定、待审核、多子女、内容撤回和财务关闭均有独立状态，不能显示为空列表。

R1-3 以 `20260728000400_r1_account_security.sql` 落地账户锁、版本化且追加式同意、用户权利请求、邮箱绑定的一次性员工邀请和支持审计；共享 `requireUser` 对锁定、必要同意与管理员 AAL2 fail-closed。zh/en 账户安全/支持 UI、唯一生产管理员 manifest schema/校验器和双人恢复手册已通过 115 文件空库重放、开发库/一次性库 Auth-RLS-Storage 负向断言、14 项 R1 合同和开发浏览器验证，见 [`docs/evidence/r1/r1-3.md`](../evidence/r1/r1-3.md)。本证据不证明生产管理员已初始化或生产 MFA 达到 SEC-02。

R1-Live 冻结“单账号、多登录身份”：`auth.users.id` 是唯一业务主体，邮箱、手机号、微信和 QQ 只能绑定为同一 UUID 的 identity；密码属于账号，验证码登录不得隐式创建用户，OAuth 新身份只允许在已有会话或完成账号恢复后绑定。初期无验证码 provider 时隐藏验证码入口并继续使用邀请门；正式手机号/password 启用前先把员工邀请从 email-only 泛化为 email/phone，并在非生产目标证明两种登录返回同一 UUID。首名真实教师继续可走现有邮箱/password 邀请，不让手机号、验证码或 OAuth 延迟首次点名。完整接口与冲突合同见 [`r1-live-auth-identities.md`](r1-live-auth-identities.md)。

2026-08-25 产品负责人将手机号/password 提升为内部使用 P0。通用 identifier、重复密码、email/phone 员工邀请、手机号仅绑定邀请注册及 `provider_unverified` 保障记录已随 migration `20260825000600` 和热修 `8ec0ba0` 部署生产；GoTrue phone provider 已开启且 `SMS_AUTOCONFIRM=false`。发布后仍为 14 个账号、0 个手机号账号、14 个 profile、1 条既有已消费邮箱邀请和 0 条保障记录，没有创建账号、邀请或业务数据。当前结论为 `DEPLOYED / PENDING USER ACCEPTANCE`；真实受邀教师完成一次手机号注册和 password 登录后再关闭该 P0。

R1-5 已关闭学生与家庭门户及其课堂连续性依赖：固定角色浏览器子门覆盖学生/家长 zh/en、多子女与特殊状态、请假补课、任务驱动视频、已结束课次逐题学情和监护关系；跨家庭/跨学生真实身份负向查询 100% 拒绝。集成基线通过 14/14 静态 CI、62/62 R1 合同、144 文件空库重放、迁移账本和 13/13 数据库审计，见 [`docs/evidence/r1/r1-5.md`](../evidence/r1/r1-5.md)。学生与家庭门户据此达到 M3；本证据不替代 R1-14 正式 Playwright、R1-16 独立生产、R1-17 RC 或 R1-18 发布审批。

### 4.3 机构、学生服务与教学运营

机构后台按职能组织为总览、学科运营、教学、教研、组织管理和系统管理，不再保留“大而全”的设置中心。`/dashboard/organization` 只保存机构名称与统一 IANA 时区；中文是产品固定默认语言，不形成无效设置项。`/dashboard/campuses` 维护校区目录及其教室，校区字段只有名称、可空地址和状态，教室字段只有名称、可空容量和状态。内部代码由数据库生成，页面、表单和公开 DTO 均不可见。校区只作为教室的上一级目录，不承担班级、员工、权限、学年、规则或 Feature Flag 作用域；所有员工继续按既有岗位或本人班级权限访问全部场地，不建立全局校区切换。

班级保存可空默认教室，课次在创建时复制当时的教室 ID 并记录 `class_default | session_override` 来源。修改班级默认值只影响新课次；显式“应用到未开课课次”先预览数量，再只更新仍来自班级默认值的未开课课次，显式覆盖和待定保持不变。停用教室或归档校区先展示影响数，再清空受影响班级默认值和未开课课次地点；已开始、已结束及已取消课次保留历史引用，重新启用不恢复。排课冲突按教室 ID 判断，同名不同 ID 不冲突；教师重叠仍跨全部校区检查。

学年与运营周期采用机构级唯一的两层合同。`school_years` 是学生年级的年度归属，创建时只登记起始年并建立四个周期，不要求预先知道放假或开学日期，也不改学生年级；`school_terms` 固定为 `暑期 → 秋季 → 寒假 → 春季`，日期成对可空，临近后补，周期重叠只形成运营提示。暑期属于新学年，因此“二升三”的暑假按三年级归属。启用下一学年必须先显示一至十一年级晋级数和十二年级保留数，再填写该起始自然年内的生效日并显式确认；切换当前运营周期不触发晋级。学年、四个周期、当前周期和升年级均不保存或查询校区作用域，保证一次升年级只执行一次。产品负责人确认 `2025–2026` 学年春季结束日为 `2026-06-29`；此前挂在旧春季、且全部课次晚于该日的 production 班级只迁移到 `2026–2027` 秋季归属，不改班级状态、教师、课次时间或学生年级。

教学日历支持全机构记录和“某校区全部教室”的局部例外。停课支持日期范围；教学日与补课日是单日，可按指定周几映射排课，也可仅手动开放。自动排课跳过停课范围，并按日期顺序加入映射日；校区记录覆盖全机构记录，同一作用范围内禁止重叠。课次地点待定时只应用全机构日历并提示不能判断校区例外；人工安排到有效停课日时必须确认并填写原因，追加领域事件。`/dashboard/academic-years` 统一承载学年、教学日历和内联排课默认；排课默认首版只保存新班级默认时长，初始为 90 分钟，冲突策略固定为警告，因此不形成独立侧栏入口。`/dashboard/organization-settings`、`/dashboard/schedule/calendar` 与 `/dashboard/schedule/defaults` 已直接退役且不重定向。原始 JSON 业务规则停止新写入并只保留历史，Feature Flag 进入“运行与错误 → 能力发布”，修改要求 `system.operations.manage`，`audit.view` 只读历史，财务发布门继续固定关闭。

R1-1 的 `20260728000100_r1_organization_settings.sql` 与 `20260728000200_r1_public_publish_guard.sql` 是旧合同和回退基线。`DEV-ORG-1` 已新增 `organization.profile.manage`、`location.manage`、不含代码字段的 V2 DTO/RPC、结构化场地引用和兼容双写；旧设置 RPC、`classrooms.room`、默认校区与学年校区列至少保留一个生产回退窗口。生产 preflight 输出了自由文本教室候选、学年/周期重复差异、有效校区级规则或开关覆盖和正式业务影响；唯一旧文本 `3305` 在唯一活跃校区中生成同名结构化教室，回填 1 个班级与 15 个课次。7 个 migration 已通过新鲜 PostgreSQL 备份、完整事务回滚/零残留演练与正式事务，ledger 推进到 219；应用 `34f07e8…` 已发布且机器 postflight 通过。明确退休 previous 后，才以独立授权增量删除旧合同；生产页面人工验收仍为 `UNKNOWN`。

`DEV-DASH-1` 规定班级默认 scope 为“本人任教 → 本人负责 → 两者为空时全部”，个人 scope 使用信息卡，全部与测试 scope 使用同一套 shadcn `Table` 圆角完整描边表格壳；普通列表每页 20 条。课件资源库每页只读取 11 条用于判断下一页，最多展示并签名 10 条预览。机构资料、校区目录和教学日历采用线性设置区或表格。migration `20260829000100_classroom_personal_scope_default`、定向合同 22/22 与固定账号 Playwright 2/2 已通过并随 `34f07e8…` 上线；production route manifest 已确认新路径存在、旧设置路径不存在。生产登录态侧栏、班级 scope 与资源分页仍待人工验收。

`DEV-DASH-2` 已以提交 `e1e8c87` 统一 Dashboard 的表格与分隔语义，当前为 `DEPLOYED / PENDING USER ACCEPTANCE`。顶层数据表使用共享的 shadcn `Table` 圆角完整描边外壳，表头和数据行保留内部边界；页面标题后只有一条结构分割线，横向状态导航、筛选、操作与正文处在该线下的同一工作区，不再额外分割。普通设置字段依靠间距、标签层级和局部底色成组，禁止逐项 `border-y`/`divide-y`；独立的大内容板块可以在起点保留一条分割线。定向合同 14/14、TypeScript、全量 ESLint、Dashboard 设计审计、固定管理员 zh/en/390px Playwright 1/1 与 production build 已通过并随 `34f07e8…` 上线；生产视觉人工验收仍为 `UNKNOWN`。

- 学生主链覆盖活动/线索、学生档案、监护关系、报名/分班、课表、考勤、请假/补课、作业、评价、续费/流失跟进。改班、换老师、撤课、合班和补录产生历史记录，不覆盖旧事实。
- 班级使用两个互不替代的属性：`purpose=production|test` 表达数据治理用途，`offering_type=long_term_formal|short_term_topic` 表达长期正式课或短期专题课。既有班级默认归为长期正式课，不按课次数量猜测历史类型。短期专题课仍有固定花名册、连续课次、点名和课后记录；活动只表达一个 `scheduled_at` 的单次体验课、公开课、测评、三板斧、讲座或竞赛及其报名/到场结果，固定名单连续上 3–4 次或更多课的项目不得建成多个孤立活动。
- 教师课堂旅程包括进入课次、点名、读取已发布课件、课堂记录、布置作业和课后动作；教务/学辅从异常 work item 进入对应领域页处理。

2026-08-23 的生产试用反馈已形成一组不改变 Gate 的日常运营收敛：班级详情的标签、教室入口和设置动作进入同一水平命令区；共享 Select 增加纸色/星夜悬浮反馈，全部业务日期/时间输入改用 shadcn `Calendar` + `Popover` 的共享控件；未知通知显示事件类型和首个可读 payload 细节；共享绘图工具栏可向下收起，备课工具栏进入翻页工作区。migration `20260823000200_r1_live_preparation_attention_window` 把备课工作项改为开课前 14 天出现、前 7 天到期并在逾期后向主管投影，课后提交显示“补交”；生产当前教师投影由 15 条缩为 1 条，班级/课次/报名/点名仍为 `1/15/1/0`。实现随应用 `20260822-193605` / `5041fe1…` 上线，发布后错误增量为 0；产品验收按单项进行，不增加自动化门禁。

#### 4.3.1 备课—行课—课后统一对象合同

`classroom` 保存一个固定成员可连续行课的开班实例、业务开班类型、教师责任和排课规则，覆盖长期正式课与短期专题课；`class_session` 保存一次实际课次及其备课、点名、行课、报告和作业事实；Courseware Studio 保存可复用讲次源文档与不可变 release。班级页按课次进入统一工作区，Dashboard 通知和待办直接定位到该课次的阶段卡片；不得再建立与课次并行、状态互不相认的“备课教室”。

| 阶段 | 教师动作 | 完成门与持久结果 |
| --- | --- | --- |
| 1. 研读与试做 | 预览本课课件、逐题试做，上传纸面或电子做题解析 | 上传即自动保存并提交审核；支持照片/PDF，照片在客户端压缩；审核人实时收到通知 |
| 2. 教研与成案 | 查看教研讨论，进行课件可视化编辑，上传标准教案文档或照片 | 上传即自动保存并提交审核；保存教案版本、课件 revision 和讨论引用 |
| 3. 磨课与定稿 | 在本课次试讲，调整课件；Courseware Studio 在准确动画页设置“需逐生检查”；教师可在备课页栏直接切换本课采用的页面，需要额外检查项时先添加空白课件页再标记，并提交磨课视频链接 | 页面标记点击后自动保存；解析记录、标准教案和磨课视频分别审核通过，且至少一个检查项齐备后才进入 `prepared`；定稿固定课堂 release、稳定页 ID 与本课检查清单，本课调整不回写正式课件标记 |
| 4. 开课与点名 | 开课第一步完成点名；未完成点名时课堂控制保持受限 | 出勤事实追加保存，补录保留操作者、原因和时间 |
| 5. 行课与学情 | 教师控制课件、板书和媒体同步；随时打开全屏学情面板，按学生与检查项快速登记 | 状态固定为 `explained / independent / prompted / imitated / incomplete / unchecked`；默认 `unchecked`，触摸操作一步可达；已标记课件页跨设备自动切换对应检查项，未标记页保持当前检查项 |
| 6. 下课与跟进 | 直接进入课后工作区；先分别发布知识总结、正式作业和视频任务，再按学生卡补充课堂课评与跟进；从阶段导航同行区域补登记出勤并完成本次课 | 三类发布对象、入口和通知彼此独立；课评是逐生卡片内直接输入项；作业提交/照片/PDF 批改与视频审阅各有独立面板；提交、批改、审阅和撤回保留版本/时间/操作者 |

课前工作区不显示“开始备课”或重复课次决策栏：进入课前即开始备课；左栏只承载三步实际生产流程，右侧以页面目录配合 4:3 预览。复制备课紧贴左侧阶段导航，右侧按“试讲 → 完成备课”排列；常驻预览建立后，试讲按钮不再重复承担预览语义。解析记录、标准教案和磨课链接发生有效变化时进入 `pending` 审核状态，审核决定保留 revision、审核人、时间和意见；退回修改后再次保存生成下一 revision。

课前主工作区固定在阶段导航下方的剩余视口，不允许整个“本节课件”区域滚动；三步流程与长页面目录分别内部滚动，预览按容器实际宽高等比缩放。页面目录与预览使用共享组件：备课使用较宽目录保证长标题可辨，course 讲次预览弹窗使用标准窄目录并保留页面列表，但不提供逐生检查按钮。共享组件内的上一页/下一页按钮与方向键、PageUp/PageDown、空格共用翻页动作；调用方不得在组件外另建会被卷出视口的翻页栏。16:9 页面按 4:3 定格产生的底部书写区必须跟随明暗模式使用与副板书一致的白色/深色表面。H5 预览必须从包 manifest 构造垫片入口并保留 launch query，不得把 H5 binding 当作普通签名对象过滤。

课件完成定稿、冻结、开课或下课后，课前阶段继续显示三项备课产物、审核状态、逐生检查清单和本课冻结课件；不得用空面板或单行提示替换原工作区。管理员可通过默认关闭的组织级开关，临时允许任课教师补改当前课次快照与档案：重排页面，增删白板、视频和图片，补勾逐生检查页，补写板书并重新生成/导出解析，修订包含课后反思的结构化教案，以及替换或删除磨课百度网盘链接。保存后的课次快照在重新进入教室时生效，并写入追加式领域事件；正式 release、正式页面文档和课次审校人不被改写，关闭开关后立即恢复只读。开课后如需修订正式课件内容，教师仍须进入 Courseware Studio 发布新的不可变 release；新 release 不回写当前或历史课次，只能由尚未开课的课次显式采纳。

教师生产链按 doc 26 在左侧三步备课流程内切换生产表单，右侧课件目录与预览全程常驻：教师可边看课件边试做、编辑标准教案和磨课。课件页板书保存 Vector Stroke，并可生成 `solution_records(solution_source='board')`；教师可查看课件 `PageDoc` 与板书对象的 4:3 合成解析形态、审核 revision/意见并导出同一合成为 1920×1440 WebP，上传解析映射为 `solution_source='upload'` 且可下载原件。`session_preparation_reviews` 继续承载通知、退回/通过与完成门，审核队列在课件侧栏显式可达；审核人将产物与同课次真实课件并排审阅，产物可返回对应备课步骤，所选课件页可按稳定 `page_doc_id` 直达编辑位置，原提交教师可在教案待审核时显式撤回并恢复草稿。第一阶段审校人由教师按课次选择且允许本人，后续方向为主管指定并锁定。标准教案使用固定 `mathin-teaching-plan-v1` BlockNote 模板和显式提交；三步状态用图标表达，审校人与流程切换同处一行，教案附件和编辑器头部采用紧凑单行布局，课件目录自动保存改用状态图标；正式模板页标题不可改写，只有教师新增页可重命名；页面教学备注暂缓并退出当前工作流。独立教案管理入口和服务端打印 PDF 仍是 doc 26 的 `partial` 剩余项。

逐题检查的课件默认值只来自当前轨道正式 release：`cw_page_learning_check_flags` 在 Studio 保存页级草稿标记，发布时以 `learningCheckEnabled` 写入 release snapshot；`session_learning_checks.source_page_doc_id` 保存本课采用的稳定页身份。备课页直接点击页面图标增删并自动保存，不提供脱离课件页的自定义检查项；额外项目通过新增空白课件页实现。“恢复正式课件默认”先保留本课恢复前清单并提供一次撤销，避免正式默认为空时误清。`class_sessions.learning_checks_configured_at` 区分尚未继承默认值与教师明确保存的空清单，避免刷新后恢复已取消页面；标题仅用于展示，不作为匹配键，本课调整不回写正式标记，通用标题模板不得作为默认来源。

正式课堂逐生检查面板在全屏模式把题目、进度和座次开关收进首行，第二行只保留横向滚动的检查项；右侧常驻 112px“补齐未登记”工作条，只作用于当前题仍未登记且未明确缺席/请假的学生，并提供一次撤销。正文固定为至少 20 个有位置语义的座位，横屏按 4 列 × 5 行在剩余视口内等分伸展，使 20 人班铺满可用区域且不产生内部滚动；21–30 人才按稳定座次内部纵向滚动，状态触控区保持至少 44px 高。人数不足时显示轻量空座，学生卡不随人数任意放大；教师开启座次开关后可把学生拖到空座，拖动实时投影到课堂简卡，稀疏座位图跨课次保留。学生卡顶部只保留一条细状态线，六个登记按钮只显示统一 SVG 与颜色；登记后在姓名后显示完整状态名，无障碍名称始终使用完整文案。姓名前的 LED 同时显示并允许补登记出勤。座位图写入班级级 `classroom_student_seat_order` 的显式 position；新入班学生读取时进入首个空座，保存时名单变化则整体拒绝并要求重新打开面板。

课堂报告区分数据来源：点名、星数和教师检查项是正式课堂事实；举手、电子作答仅在对应数字事件实际产生时统计。线下教学不得把“未采集”显示为 0。课后页先显示三类独立发布，再以多列学生卡汇总出勤、星数、检查项、逐生课评和跟进；最后分别承载作业发布/提交/照片或 PDF 批改和视频审阅。通用完成任务只保留紧凑状态，不重复生成整页操作面板。

教师端保留课件页面列表。横屏大屏先给副板书和学生列有界宽度，再把剩余空间用于 4:3 课件；两个面板折叠后都停靠右侧，不占据主课件中部。小屏横/竖屏均以课件为主，学生端剩余空间显示不压缩的副板书视口，允许暂停跟随后平移/缩放，并可恢复到教师最后落笔行；小屏默认仅显示本人学情，其他学生按需展开。教师控制的视频/H5 对学生隐藏原生控制并防误触；手机导航不得让固定操作区占用三行，退出登录收进账户/导航菜单。

协同、审批、作业发布/提交/批改、请假提交/决定、课堂总结和视频审阅在领域事务提交后写入角色定向通知。教师、学生和有效监护人通过同一 Realtime 通道即时收到；点击单条通知立即标记已读，并导航、滚动和聚焦到对应课次/作业/记录。
- 批量操作先显示目标数量和影响范围；每行校验，报告部分失败，使用幂等键。归档/撤销处理常规删除；物理删除使用专用权限和 runbook。

### 4.4 教学成果、公共内容与课程 release

| 对象 | 状态/动作 | 读取规则 |
| --- | --- | --- |
| 课堂记录、评价、视频/复盘、阶段报告 | draft → review（适用时）→ published → withdrawn/revised | 学生/家庭只读 published；撤回立即失效；修订保留旧版本 |
| Terms/Story/Minds/Notebook | draft → review → published → withdrawn/revised；记录作者、审核人、语言状态和稳定关系 | 公开页只读 published；预览要求内容权限；改 slug 生成重定向或阻断 |
| 课程页面文档 | revision/binding、native 16:9、adapted 4:3、review 分层 | 研发读取可编辑状态；课堂不读取草稿 |
| 课程 release | 发布前检查对象可读、binding、snapshot 和并发版本；发布后不可变 | track head 指向当前 release；legacy 字段指向 native release |

爱学习课程与 E 系列共享课程族/课程/讲次、CAS、revision/release、双轨 head 和课次冻结，不共享页面文档接口。1.0 范围固定为 2026 秋季数学：G+ 苏教版三至六年级 56 条源站讲次、X+ 苏教版一至六年级 84 条源站讲次、A+ 全国版一至二年级 30 条源站讲次；当前批准的生产 release-1 页面仍使用 projection v31 的 `aixuexi-page-doc-v1`。2026-08-27 开发导入器已改为 `source-runtime-page-v1`，复用来源 Viewer 而不在 Mathin 重造 DOM/CSS；生产切换仍需 R1-9/15/18 的批准 manifest、隔离演练和正式授权。G+ 五/六年级与 X+ 二/五/六年级缺少第 7/15 讲源站课件，教学计划补充 10 条占位，不创建 release，课件准备状态为“未发布”；其他缺失讲次、年级、季节和难度不生成空课程或伪页面。

课程产品的编辑主路径按 doc 16 §14 收敛为“课程/版本 → 讲次 → 指定页面 → 统一课件工作区”。共享内容修订与 16:9/4:3 分轨版式分别保存；A～F 是可替换的 4:3 起始策略，并保留自定义 layout recipe；图片/背景替换从当前页面发起，执行前显式选择页、讲、课程版本、课程族或全部引用范围并展示影响，已发布 release 和课次冻结不回写。正式 PageDoc、来源 runtime 和教师 composition 通过能力 adapter 共用工作区动作，不强行共用页面 schema。该合同仍处于规划人工审计期：先确认路径、布局和功能样机，再允许单页/样本讲次持久化，最后才讨论全量回填和生产候选。

报告保存指标版本、数据截止时间、机构时区和生成数据集。教师在学生学情页选择日期范围，右栏查看范围内的已上课课评、作业记录和视频讲解，左栏新建或打开报告；未选择报告时不常驻空编辑器。稳定指标 ID 在界面显示本地化名称。发布/撤回/修订提交领域事务后创建幂等通知 job；通知失败不回滚已发布事实。

R1-6 以现有业务表作为编辑来源，以统一发布头和不可变 revision 作为学生/家庭读取边界：

| 成果类型 | 编辑来源 | 发布单元 |
| --- | --- | --- |
| 知识总结 | `session_family_briefs` 的 BlockNote JSON 文档 | 每个课次、学生一份 `knowledge_summary` 投递；可从版本化模板新建或复制历史总结，保存不依赖逐生课评 |
| 逐生课评 | `session_reviews` | 每个课次、学生一份 `session_review`；保存和发布不依赖知识总结 |
| 视频复盘 | `session_videos` 的审阅字段 | 每个已审视频一份 `video_review`，未审视频不能发布 |
| 阶段报告 | R1-6 新增的报告草稿 | 每个学生、学期和报告周期一份 `stage_report` |

`learning_result_heads` 保存成果类型、学生、来源对象、当前状态、当前 revision、已发布 revision 和各状态操作者/时间；`learning_result_revisions` 按 `(head_id, revision_no)` 追加内容快照，已创建行不得更新或删除。编辑已发布来源后，头进入 `revised` 并立即退出学生/家庭 published 投影；原 revision 继续保留，重新发布创建下一 revision。人工撤回进入 `withdrawn`，保存撤回原因并立即退出投影。

`draft` 可自动保存但不可对外读取；知识总结、逐生课评和阶段报告编辑器以修订号处理并发，提交/发布前必须冲刷待保存内容。需要复核的成果经 `review` 后发布，退回恢复 `draft`；无需复核的成果可由具备发布权限的教师直接从 `draft` 或 `revised` 发布。每次状态变化追加领域事件，事件 payload 固定 head、revision、成果类型、学生和可读标题。提交审核通知可处理该成果的员工，退回通知作者；面向学生及有效监护人的发布、撤回和修订事件使用稳定幂等键进入既有通知与 job 管线。每条站内通知提供能打开对应教师工作区或学生/家庭成果区的 deep link。

阶段报告 revision 必须保存 `metric_version`、`data_cutoff_at`、`timezone`、周期起止和生成数据集快照。时区统一取机构 IANA 时区，不再读取校区覆盖、浏览器本地时间或硬编码东八区；发布后不得按最新源数据重新计算历史 revision。学生和家庭成果区分别展示已发布的知识总结、逐生课评、视频复盘和阶段报告；草稿、撤回或已被源数据修订的成果不可见。学生班级入口使用当前 Dashboard 学习工作区，旧班级展示路由仅保留兼容跳转。

**实施状态（2026-08-01）**：R1-6 已按上述合同关闭；应用、数据库、浏览器与 CI 证据见 [`docs/evidence/r1/r1-6.md`](../evidence/r1/r1-6.md)。

资源记录来源/许可、hash、MIME、尺寸、轨道和生命周期。公开页面不引用临时或私有 URL。英文内容与中文共用实体 ID，分别保存翻译状态。

### 4.5 财务、平台服务与数据治理

| 范围 | 1.0 合同 |
| --- | --- |
| 财务 | 默认关闭。启用时闭环订单、收款、退款/冲正、学生账户、台账、对账、异常、权限和导出；金额使用精确数值，写操作有幂等键，退款/冲正追加记录 |
| 通知 | 保存事件来源、接收人、幂等键、渠道、发送/回执/失败、已读状态和 deep link |
| Jobs | durable queue、租约/超时、指数退避、最大重试、dead-letter、人工重放；副作用按幂等键去重 |
| 搜索 | 按 RLS 返回学生、班级、课程、内容和行动入口；记录索引延迟与删除传播时间 |
| 文件 | TUS 会话、大小/MIME/配额、hash、恶意内容策略、签名访问、孤儿清理、保留和删除 |
| 外部集成 | 开发/预生产/生产密钥隔离；超时、重试、webhook 签名/防重放、供应商降级和退出；未选渠道保持关闭 |
| 初始化 | 版本化 manifest 创建 reference/config data；不复制开发库或测试 UUID |
| 导入 | 模板版本、dry-run、逐行校验、重复识别、批次审计、错误下载和幂等重跑 |
| 数据质量 | 检测孤儿、重复主体、无负责人/截止时间、非法状态、金额不平、缺失内容对象；修复先预览计数并建立恢复点 |
| 导出/归档 | 按角色最小化字段、记录审计并自动过期；用户权利导出与运营报表分开 |
| 指标/遥测 | 每项指标记录分子/分母、去重键、时间窗、时区、数据源、延迟、权限和版本；不采集非必要未成年人 PII |

R1-8 采用 1.0 安全关闭路径。`finance_release_gate_open()` 固定返回 false，版本化 Feature Flag 不能单独启用财务；九张财务表的读取、既有订单/学生 scope helper、统一 work item/summary、审批、通知 staging/读取与 job 写入/领取均受关闭门约束。156 个迁移在标准 PostgreSQL 15 空库完整重放，12 项 R1 SQL 断言和开发库动态账号断言通过；教师和管理员导航均无财务入口。该证据达到 M3 安全关闭实现，R1-15/18 仍须在隔离副本和正式环境复核关闭不变量。详见 [`docs/evidence/r1/r1-8.md`](../evidence/r1/r1-8.md)。

R1-7 不建立可任意写表的通用维护入口；初始化、导入、质量、修复和导出共享批次、审计、hash、保留期与恢复点合同，但每个写动作仍由领域 RPC 执行。施工顺序和现状如下：

| 子阶段 | 现有输入 | R1-7 产物 | 退出条件 |
| --- | --- | --- | --- |
| R1-7A 学生 CSV 导入（已完成） | `/dashboard/students/import`、`import_students(jsonb)` | `mathin-students-v1` 模板；服务端 dry-run；逐行错误/重复；批次账本；错误 CSV；幂等应用 | dry-run 与 apply 共用校验；存在错误时写入 0；同 key 同 payload 返回同批次，不同 payload 冲突；重复执行新增 0 |
| R1-7B 初始化 manifest（已完成） | migration/CI bootstrap、课程 seed、生产管理员 manifest | 版本化 reference/config manifest schema、校验器和只读计划 | 干净库计划可重放；不复制开发 UUID；实际 ID 和数量差异使流程停止 |
| R1-7C 数据质量（已完成） | CI SQL 断言、零引用课件报告 | 持久 run/finding；孤儿、重复主体、非法状态、金额不平和缺失内容对象规则 | 同一快照重复扫描结果稳定；规则带版本、严重度、对象和证据；查询服从权限边界 |
| R1-7D 修复（已完成） | 学生合并、课件 replacement rollback、测试数据清理 | 领域修复计划、影响计数、恢复点、执行/回滚审计 | 先预览后执行；目标集合 hash 不变才允许写；失败不留半成品；可恢复动作实际回滚 |
| R1-7E 导出（已完成） | 用户权利请求流程、教案/解析导出 | 用户权利 artifact 与运营导出分流；字段裁剪、hash、下载审计和自动过期 | 跨角色/跨学生负向查询拒绝；过期 artifact 不可下载；导出不暴露内部备注和非必要未成年人资料 |

R1-7A 的 dry-run 也写批次审计，但原始行最多保留 30 天；错误 CSV 在浏览器按当前批次生成，不进入公开 Storage。批次只保存规范化输入、行状态、目标 ID 和标准错误码，不保存账号凭据、token 或文件二进制。正式初始化和破坏性清理仍分别受 R1-15/R1-18 环境与人工批准限制。
R1-7B 的期望状态入口是 `docs/manifests/r1-initialization.example.json`，结构由 `schemas/r1-initialization-manifest.schema.json` 固定，`pnpm r1:init-plan` 只输出可复现计划，不连接数据库、不写表。manifest 只允许课程 `catalogVersion+productCode`、配置 `domain/flagKey` 等自然键，UUID 必须由目标数据库生成（`productCode` 自迁移 `20260803000300` 起只在课程目录版本内唯一，单独用它无法定位一门课程版本）；课程源文件、配置源迁移、CI 平台垫片和独立管理员 manifest 均固定 LF 归一化 SHA-256。R1-7 关闭时的历史可选 inventory 在 preflight 必须为 0 行，在 post-apply 与当时的 72 个课程、865 讲、6 个规则域和 5 个 fail-closed flag 对账；当前正式基线改用 §5.1.1 的数量。再次执行时任一自然键对应 ID 或数量变化都停止。CI 平台垫片只用于空库重建验证，禁止作为生产平台初始化脚本。

R1-7C 的规则集入口是 `mathin-data-quality-v1`。`data_quality_rule_versions` 按规则集、规则键和版本保持不可变且规则集内唯一；`data_quality_runs`/`data_quality_findings` 保存快照时间、严重度、对象、最小证据、规则/结果 SHA-256，直接写权限关闭。`run_data_quality_scan()` 在同一语句快照内检测在读报名关联已删除学生、学生手机号重复、非法课次状态、订单金额/状态不平和课件对象缺少 Storage 文件；手机号证据只保存对象 ID 与规范化键 hash。`/dashboard/data-maintenance` 对 `audit.view` 开放历史扫描与最多 200 条发现，触发新扫描另需 `system.operations.manage`；零引用报告和永久清理继续按 `courseware.asset.manage`/`testdata.purge` 裁剪。数据库断言覆盖重复扫描稳定、五类命中、规则不可变、无通知噪音和学生负向边界；扫描不自动修复，发现项由 R1-7D 的显式领域计划接收。

R1-7D 以 `data_repair_capability_versions` 登记订单状态重算、学生合并、课件 replacement 回滚和测试数据清理四类能力，并明确 `automatic_rollback`、`domain_rollback` 或 `backup_required` 恢复边界；仅订单派生状态重算进入计划调度，未建立任意表写入口。`data_repair_plans` 在预览时保存影响计数、24 小时执行期限、执行前/预期执行后 SHA-256 与恢复快照；执行和回滚重新锁定订单、复算目标 hash、校验后置条件，并分别写入不可变 `data_repair_events` 与非通知型领域事件。金额字段不匹配时计划拒绝生成，学生合并和永久清理继续要求外部备份，课件替换继续使用既有领域账本。`/dashboard/data-maintenance` 对 `audit.view` 开放能力与计划历史，预览/执行/回滚另需 `system.operations.manage`。开发库固定 principal 浏览器旅程已实际执行、回滚并再次执行同一订单状态修复；最终质量复扫为 0 条异常，中英文界面和学生负向边界通过。

R1-7E 以 `user_rights_export_artifacts` 保存与请求绑定的精确 JSON 字节、SHA-256、字段 manifest 和 7 天到期时间；支持人员只能查看元数据，正文仅由主体通过审计 RPC 下载，过期后拒绝并由受控清理 RPC 擦除。学生可导出本人账号、同意、权利请求及所选范围内的本人报名、考勤、提交和已发布学习成果；家长只导出家庭关系，不携带孩子联系方式、生日或学习明细；staff/admin 只导出本人岗位。板书解析 WebP 属于即时运营导出，在浏览器触发下载前记录同一 Blob 的 hash、字节数、资源和操作者，不创建用户权利 artifact。开发库固定 student→principal→student 与 teacher 浏览器旅程、跨主体/过期/家长字段/未授权运营导出负向断言、155 个迁移空库重放和 14/14 CI 已通过。R1-7 整体关闭；这些开发证据不替代 R1-15/16/18 的隔离与生产验收。

### 4.6 合规、帮助与安全事件

- 隐私、条款和监护同意保存版本、主体、时间、来源与撤回。需要同意的功能在记录缺失时 fail-closed。
- 用户权利请求保存身份核验、请求类型、数据范围、审批、截止时间、执行结果和证据 hash。
- SOP 覆盖机构初始化、员工邀请/交接、教师开课、教务异常、家庭绑定、内容发布、财务（启用时）、备份恢复和安全事件升级。
- 安全事件记录分级、隔离、凭据轮换、证据保全、通知判断、恢复和复盘。R1-16 至少执行一次桌面演练。
- 未成年人资料、家庭关系和课堂视频由 RLS/Storage 策略、受控保留和审计下载共同限制。

### 4.7 角色旅程

| 角色 | 1.0 E2E |
| --- | --- |
| 访客 | 首页 → 六模块入口 → Terms 关系 → 公开内容；英文缺失时看到明确回退 |
| 学生 | 认领/登录 → 课表/课堂 → 作业 → 已发布成果/通知 → Notebook |
| 家长 | 安全绑定/切换子女 → 课表/考勤/成果/通知 → 允许的服务事项 |
| 教师 | 今日工作 → 课次 → 点名/课件/课堂记录 → 作业/评价 → 发布成果 |
| 教务 | 课程/班级/课表 → 分班/调课 → 请假补课/异常 → 历史记录 |
| 学辅 | 学生/家庭上下文 → 跟进/续费 → 跨角色协同 → 领域动作关闭 |
| 教研/内容 | 编辑 → 审核 → 公共内容或双轨课件发布 → 撤回/修订 |
| 财务（启用时） | 订单 → 收款 → 对账 → 退款/冲正 → 导出；台账平衡 |
| 管理员 | 初始化 → 邀请/权限 → 配置/审计/告警 → 交接/停用 → 恢复演练 |

### 4.8 横切正确性

- 创建订单、收款/退款、内容发布、通知、job、导入和离线补发必须支持同一幂等键重试。
- 关键写操作使用唯一约束、锁或版本字段处理竞争；冲突返回可重试的 zh/en 错误。
- 领域事实与必要审计在同一事务；邮件、SMS、webhook 和长任务在提交后由 job/outbox 执行。
- 每个新查询定义本人、家庭、班级、校区、机构和管理员边界，并增加 RLS 负向测试。
- loading、empty、error、forbidden、withdrawn、closed 和 partial success 使用不同 UI 状态。
- 数据库存储可比较时间；业务展示和截止计算使用机构时区；`overdue` 由 `due_at` 派生。

## 5. Production 1.0 量化发布门

本节约束 `v1.0.0` 和扩大到完整产品范围，不作为 R1-Live 开放前的整包清单。R1-Live 只采用 doc 04 明确列出的身份、点名、越权、备份、回退、错误可见和防误清子门。所有比率排除 schema 已识别的用户输入校验失败；系统错误、超时、越权、重复写入和数据不一致不得排除。

### 5.1 产品、内容与语言

| ID | 对象 | 门槛 |
| --- | --- | --- |
| PROD-01 | 角色旅程 | §4.7 全部旅程通过；预生产关键 E2E 连续 3 次无 flaky failure |
| PROD-02 | 缺陷 | Sev0=0、Sev1=0、未接受 Sev2=0；接受 Sev2 记录 owner、截止日、影响和缓解措施 |
| PROD-03 | UI 国际化 | zh/en message key 100% 相等；关键 UI 硬编码单语文案=0 |
| PROD-04 | 英文内容缺失 | 100% 缺英文正文的 `/en` 页面显示语言标记/未发布状态和 `/zh` 链接；空白、错误 canonical、意外 404=0 |
| PROD-05 | Terms | 71/71 中文概念可发布；slug、公式、依赖、引用、站内链接错误=0 |
| PROD-06 | Story | ≥1 个完整章节；入口、进度、结尾、Terms 关系和移动端阅读通过；无“即将推出”占位 |
| PROD-07 | Games | 3/3 可玩；需要排名的伪造客户端成绩入榜数=0 |
| PROD-08 | Tools | 3/3 独立页和既定 embed 场景通过；`spatial-lab` 明示验收样机与无持久化边界 |
| PROD-09 | Minds | 2/2 中文文章发布；无效 Terms 关系=0 |
| PROD-10 | Notebook | 私有写作、审核、发布/撤回、公开阅读、互动和越权 E2E 通过 |
| PROD-11 | E 系列 | 1135 讲×2 轨源资源完整；正式 baseline 恰有 2270 条 `release_no=1`；缺失/悬空=0；正式课次引用的额外历史 release 按保护 manifest 保留 |
| PROD-12 | 爱学习 G+/X+/A+ 秋季 | 12 门/170 讲×2 轨源资源完整；正式 baseline 恰有 340 条 `release_no=1`；另有 10 条教学计划第 7/15 讲补充占位且无 release；缺失对象/悬空 binding=0；正式课次引用的额外历史 release 按保护 manifest 保留 |

#### 5.1.1 教材年度换代后的基线重新固定

课程目录版本层（迁移 `20260803000300`/`20260803000400`，2026-08-03 落库）把「教材年度版本」建成 `course_catalog_versions` 一层，`courses` 的唯一性从 `(family_id, grade, term, class_type)` 收敛为 `(family_id, catalog_version_id, grade, term, class_type)`，`product_code` 的唯一性从全局收敛为版本内。导入前历史基线为 E 系列 865 讲、865×2=1730 条双轨 release；当时 E 系列归类为 2026新版 18 门（暑期）、2025旧版 54 门（秋季/寒假/春季）。

来源包 `mofaxiao-e-math-2026-autumn-2026-08-03`（270 讲、16,451 页、审计全绿）已于 2026-08-04 导入开发库，下列数字为正式基线目标：

| 对象 | 导入前 | 导入后 |
| --- | --- | --- |
| E 系列课程版本 | 72 | 90 |
| E 系列讲次 | 865 | 1,135 |
| E 系列正式 release（双轨 `release_no=1`） | 1,730 | 2,270 |
| 当时含旧爱学习 G+ 52 讲的讲次合计 | 917 | 1,187 |
| 当时含旧爱学习 G+ 52 讲的正式 release 合计 | 1,834 | 2,374 |

导入已同步的连带修改点：`supabase/seed/teaching-plans.json` 追加 18 门课程（`catalogVersion` 为 `2026`，讲次 72→90、865→1135）、`docs/manifests/r1-initialization.example.json` 的 `expectedCourseCount`/`expectedLectureCount`/`naturalKeysSha256`/`sourceSha256`、doc 00 的正式数据基线行、doc 04 §1、本节表格与 PROD-11。旧秋季 18 门保留 `enabled` 并已写入 `superseded_by_course_id`；已有班级继续固定旧 `course_id`，不迁移。

开发库实测 E 系列 `release_no=1` 为 2269 条而非 2270：样本讲 `MFHK02039` 第 3 讲《迷宫连线》的 `adapted-4x3` 轨在 P6-3/P6-6 样本期清除重导中用掉了 1 号，现存 10 条 release 起始号为 2。上表是正式基线目标——R1-18 按本节建立并核验每讲两轨的 `release_no=1` baseline；R1-Live 正式课次已经引用的 immutable release 作为额外历史记录保留，不需要在开发库返工。

2026-08-13 的 P6-AIX-2 把爱学习从旧 G+ 52 讲升级为 G+/X+/A+ 170 讲，因此现行正式基线为 E 系列 1135 讲 + 爱学习 170 讲 = 1305 讲，双轨 release-1 为 2270 + 340 = 2610 条。旧表只保留 E 系列年度换代的历史对账语义，不再代表当前总量。

### 5.2 小王子视觉与交互

视觉代表页为：`/`、`/story`、`/story/[chapter]`、`/games/[game]`、`/minds/[slug]`、`/terms`、`/terms/concepts/[slug]`、`/tools/[tool]`、`/notebook/[postId]`、`/dashboard`、`/classroom/[classId]/session/[sessionId]/live`、`/whiteboard/[boardId]`、`/studio/courseware/[lectureId]`。

| ID | 对象 | 门槛 |
| --- | --- | --- |
| VIS-01 | 代表页矩阵 | 13 页×zh/en×light/dark×390/1440px=104 份截图全部签收；场景日景在 dark 下另核对边缘控件对比度 |
| VIS-02 | 场景级 | 首页和五个公开场景具有 B-612/对应星球、低饱和插画、空间入口和单一首屏焦点；标题/入口遮挡=0 |
| VIS-03 | 内容级 | 概念、文章、游戏、工具、Notebook、身份/错误页使用纸张/墨线/书卷字体及至少一项模块母题；每屏装饰星≤5、专属动效≤1 |
| VIS-04 | 工作区级 | Dashboard/Classroom/Whiteboard/Studio 保留基础 token、星夜、字体、线宽和品牌锚点；表格、表单、实时控制和画布内叙事装饰=0 |
| VIS-05 | 资产 | 新插画有来源/作者/许可、文件 hash 和用户签收；图中文字未进入不可翻译位图 |
| VIS-06 | 运动 | 100% 动画遵守 `prefers-reduced-motion`；无未登记页面级动画 |
| UX-01 | 浏览器 | 公开站：Chrome/Edge/Firefox 最新 2 个主版本、Safari 当前/上一；员工/课堂：Chrome/Edge 最新 2、iPad Safari 当前/上一、Android Chrome 当前 |
| UX-02 | 断点 | 390、768、1024、1280、1440、1920px 关键页无阻断溢出、遮挡或不可达操作 |
| UX-03 | 无障碍 | 关键路由 WCAG 2.2 AA；axe serious/critical=0；键盘与读屏关键旅程 100% 通过 |

### 5.3 性能与容量

| ID | 测量场景 | 门槛 |
| --- | --- | --- |
| PERF-01 | 公共站真实样本 | 单一路由族有效样本≥200 时，p75 LCP≤2.5s、INP≤200ms、CLS≤0.1 |
| PERF-02 | 样本不足替代 | 同一 production build，移动/桌面各 3 次冷启动中位数：LCP≤2.5s、CLS≤0.1、TBT≤200ms |
| PERF-03 | 内部关键页 | 接近生产数据、同地域网络：服务端响应 p95≤1.5s；关键写 action p95≤2.0s，不含异步 job |
| PERF-04 | `list_my_work_items` | 数据库 p95≤500ms、p99≤1s；执行计划无随数据量产生数量级退化的全表扫描 |
| PERF-05 | Job 领取 | 到期 job 的 95% 在 60s 内取得租约；重复副作用=0 |
| CAP-01 | 单课堂 | 1 教师+30 学生同时在线；核心事件丢失/串户=0；系统错误率<0.5% |
| CAP-02 | 常规并发 | 50 个认证用户+10 个员工并发写入持续 30min；系统错误率<0.5% |
| CAP-03 | 文件 | 3 路并发最大允许尺寸 TUS 上传可暂停/恢复；损坏、越权、进程 OOM=0 |

`POST-LIVE-PERF-01` 当前是体验证据收集项，不在没有时延样本时扩张为新的发布硬门。现有 `PERF-03` 只覆盖内部关键页服务端响应与写 action，不能证明已经加载页面内的对象切换、预览初始化或缓存未命中手感。R1 期间按 doc 15 §6.5 分开记录点击反馈、RSC、API、DB、renderer 和缓存状态；形成代表性样本后再决定是否新增跨路由门槛，并在本表统一裁决，禁止每个页面各写一套互相冲突的数字。

### 5.4 可靠性、恢复与安全

| ID | 对象 | 门槛 |
| --- | --- | --- |
| REL-01 | 14 天 RC | 关键入口可用性≥99.5%；计划维护提前记录并单列 |
| REL-02 | 业务写入 | 关键 action 系统错误率<0.5%；数据丢失、重复入账=0 |
| REL-03 | Jobs/通知 | 成功或在 SLA 内最终成功≥99%；发布时未处置 dead-letter=0 |
| REL-04 | 真实课堂 | ≥5 节；覆盖请假/补课、作业、成果/视频、家长查看和启用时的财务 |
| REC-01 | 数据库 | 实测 RPO≤15min、RTO≤4h |
| REC-02 | Storage | 实测 RPO≤24h、RTO≤8h；E 系列对象 manifest hash 一致 |
| REC-03 | 应用 | 前一稳定 build 恢复≤30min；schema 兼容/forward-fix runbook 可执行 |
| REC-04 | 演练 | 隔离环境全量恢复≥1 次；恢复后应用烟测通过；非执行者复核证据 |
| SEC-01 | Auth/RLS/Storage | 跨角色、校区、家庭和学生负向用例 100% 通过 |
| SEC-02 | 正式身份 | admin 角色账号恰为 1 且 MFA=100%；全部正式 auth 用户与已批准身份 manifest 一致；教师/staff 不得被误算为测试账号；恢复凭据离线保管 |
| SEC-03 | 依赖 | production dependency critical=0、high=0；medium 逐项记录接受/缓解和截止日 |
| SEC-04 | 环境/密钥 | 开发、预生产、生产数据和 secret 完全隔离；仓库 secret 扫描命中=0 |
| SEC-05 | 清理 | cleanup manifest 明确标记的测试身份、测试 PII、测试班级、测试订单及依赖运营数据残留=0；未列对象和受保护正式对象变更=0 |

截至 2026-08-12，[仓库扫描子门](../evidence/r1/r1-16-repository-secret-scan.md)已对当前 tracked tree、binary ASCII、高风险容器和完整可达 Git 历史给出 high-confidence 0 命中；该结果只满足 SEC-04 的仓库半门，不证明开发、预生产、生产的运行时 secret、数据、Storage 与域名已隔离。

### 5.5 Go/No-Go

- **R1-Live Go**：仅按 doc 04 的 Gate 1～2；两项均 `PASS` 后立即开放第一批内部教师，不等待本节其他硬门。
- **Production 1.0 Go**：本节全部硬门通过；财务若关闭，页面、导航、work item、通知、指标和 job 同时关闭；发布审批签字。
- **Conditional Go**：只接受不影响安全、数据正确性、核心旅程、视觉可用性和恢复能力的 Sev2/medium 风险；记录 owner、到期日和缓解措施。
- **Production 1.0 No-Go**：存在 Sev0/Sev1、越权、数据丢失、恢复失败、正式身份/MFA 不符、公开模块占位、104 份视觉矩阵未签收或 release 计数/对象 hash 不符。R1-Live No-Go 仅由 doc 04 的 P0/核心 P1 触发。

## 6. 正式生产数据保护与双轨 release-1

### 6.1 执行窗口与保护条件

| 阶段 | 环境 | 允许动作 |
| --- | --- | --- |
| R1-Live Gate 1 | 明确登记的内部生产目标 | 目标/部署指纹、正式身份、当前备份、防误清、current/previous 与回退命令、错误查询位置；禁止批量清理和 release 重建 |
| R1-15 | 生产快照的隔离副本 | 在正式对象保护 manifest 生效后运行 dry-run、备份恢复、显式测试数据清理和 release 重建；不得连接正式写端点 |
| R1-18 | 正式生产 | 人工批准、维护窗、备份验证、正式对象保护和目标二次确认后，执行与隔离演练相同版本的受限动作 |

所有可能删除或覆盖对象的脚本同时读取三类明确 ID：生产项目/数据库/Storage 指纹、受保护正式身份与业务对象、允许处理的测试对象。邮箱后缀、名称、glob、`purpose` 单字段和未解析环境变量都不能单独决定删除目标。任一正式对象进入删除集合、预期/实际数量不一致或 manifest hash 漂移时停止。

现有 R1-15 只读 preflight 位于 `docs/manifests/r1-production-baseline.example.json`、`schemas/r1-production-baseline-manifest.schema.json` 和 `pnpm r1:baseline-plan`。它保持 plan-only、无网络、无写入，但仍使用“唯一管理员且运营数据为零”的 R1-Live 前旧假设。R1-Live 产生真实身份/业务数据后，在 schema 增加 protected-live manifest、修改最终不变量并在隔离副本重新验收前，该 planner 只能作为历史合同检查，不能授权 R1-15/R1-18 执行。

P6-9 的来源 preflight 入口是 `docs/manifests/r1-courseware-source.example.json`，它引用两份 inventory 并由 `schemas/r1-courseware-source-manifest.schema.json`、`docs/runbooks/r1-courseware-source-manifest.md` 和 `pnpm r1:courseware-source:export` 固定 E 系列 90 门/1135 讲、爱学习 12 门/170 讲、双轨 2610 条 release-1 目标。仓库 example 与合成 1305 行 fixture 只证明合同；批准副本配置、E 系列 provenance、真实 inventory、`cw-objects`/`cw-h5` 审计和非执行者复核继续作为 Production 1.0 blocker，不阻塞 R1-Live 首个课次。

R1-16 的只读 preflight 位于 `docs/manifests/r1-production-deployment.example.json`、`schemas/r1-production-deployment-manifest.schema.json` 和 `docs/runbooks/r1-production-deployment-preflight.md`。`pnpm r1:deployment-plan` 继续保持 plan-only、无网络、无 secret 读取和无执行能力。其完整 9 项证据用于 Production 1.0；R1-Live Gate 1 只抽取当前备份、防误清、可识别的 current/previous 与回退命令、错误查询位置。实际 restore/rollback 和错误 release 关联不再阻塞首次内部使用。

### 6.2 正式身份与运营数据

正式身份 manifest 包含恰好 1 个 admin 角色账号，以及所有已批准教师/staff/学生/家长的 auth/profile UUID、角色、状态和必要恢复责任。正式对象保护 manifest 以明确 UUID 列出 R1-Live 及后续真实使用产生的班级、成员、课次、学生、考勤和关联业务根，并记录正式课次冻结/引用的 immutable release、snapshot 与对象 hash；不得把真实对象按创建日期、邮箱后缀或环境名称推断为测试数据。

| 处理 | 对象 |
| --- | --- |
| 删除 | 只允许 manifest 明确标记为测试且不被任何正式对象引用的 auth identity、profile、个人设置和角色绑定 |
| 删除 | 只允许显式测试班级、成员、排课、session、考勤、请假/补课、作业、成果、订单、work item、通知和派生数据 |
| 保留 | R1-Live 与后续真实使用的全部正式身份、班级、课次、学生、考勤、作业、成果、通知、审计和支持记录 |
| 保留 | 正式课次冻结/引用的 immutable release、snapshot、binding 和依赖 CAS/Storage/H5 对象；即使它们不是 Production 1.0 baseline release-1 也不得删除或改写 |
| 保留 | migration、角色/权限定义、必要 reference/config schema |
| 保留 | E 系列 90 门/1135 讲、爱学习 G+/X+/A+ 12 门/170 讲的稳定 ID、来源/许可、双轨文档、revision/binding、CAS/Storage/H5 对象与可复现记录 |

审计/日志按合规和外键策略处理。测试证据需要保留时先匿名化，并验证无法回指；数据库内置角色、service role 和 migration owner 不属于业务 auth 用户。

### 6.3 release 清除与重建

1. 冻结课程内容发布，不冻结教师对既有正式班级的只读访问；为维护窗提供明确降级提示。
2. 分别导出 E 系列 1135×2 和爱学习 170×2 manifest：课程体系、lecture ID、track、source revision/binding、对象 hash、预期 snapshot hash。
3. 读取全部 16:9/4:3 源对象并比对 hash；缺失对象、悬空 binding 或未批准 4:3 资源使流程停止。
4. 创建并验证备份；建立 `cw_lecture_releases`、track heads、legacy current release、审核流程和正式课次冻结引用的完整反向引用图。正式课次引用的 release ID、release_no、snapshot、binding 和对象均不可删除、重编号、改写或重指向；任何冲突使流程停止。
5. 每讲每轨确保存在且仅存在一条匹配批准 source/snapshot hash 的 `release_no=1` baseline；缺失时创建，已存在但 hash 不符时停止，禁止覆盖。release note=`production-v1.0-baseline`；各 track head 指向本轨 baseline，legacy 指向 native；历史正式课次继续引用其原 immutable release。
6. 只删除 manifest 显式标记且不在正式反向引用图中的测试 release/对象。使用同一 manifest 重跑；第二次写入数=0，所有 baseline、正式历史 release 和受保护业务对象 hash 不变。

### 6.4 最终不变量

| 检查 | 预期 |
| --- | --- |
| admin 角色账号 | 1；UUID 与正式身份 manifest 相同；MFA 已启用 |
| 其他正式 auth/profile/角色绑定 | 与已批准正式身份 manifest 完全一致；教师和真实用户保留 |
| 受保护 R1-Live/真实运营数据 | 身份、班级、成员、课次、学生、考勤及关联事实的 ID、计数和内容 hash 与维护前一致；正式课次引用的 release/snapshot/object 不变 |
| 显式测试数据 | 清理 manifest 列出的对象残留=0；未列对象不处理 |
| E 系列 lecture | 1135；ID 和顺序与维护前 manifest 相同 |
| 爱学习 G+/X+/A+ 秋季 lecture | 170 条源站讲次；G+/X+/A+ 分别 56/84/30；另有 10 条教学计划补充第 7/15 讲占位，无 release、准备状态为“未发布” |
| native heads | 1305；全部指向 native `release_no=1` |
| adapted heads | 1305；全部指向 adapted `release_no=1` |
| baseline `cw_lecture_releases` | `release_no=1` 共 2610 条；每讲每轨恰好 1 条，snapshot hash 与批准 manifest 相同 |
| 正式历史 `cw_lecture_releases` | R1-Live/真实课次引用的额外 immutable release ID、release_no、snapshot 和对象 hash 与保护 manifest 相同；未受保护的测试 extra 残留=0 |
| legacy current release | 1305 个指向对应 native release-1 |
| 缺失/悬空文档、binding、CAS/Storage 对象、H5 | 0 |
| 第二次运行差异 | 插入、更新、删除均为 0；课程与受保护业务 hash 差异=0 |

生产烟测使用正式管理员和一名正式教师执行登录、公开内容读取、Dashboard/班级只读、点名历史读取和 release 读取。烟测不创建一次性测试身份或虚假运营数据。

## 7. 决策、风险与延期

### 7.1 已定事项、实际责任人与待填 manifest

当前是单人负责的仓库。所有责任角色映射到可审计的仓库所有者账号；自动化工具和 Agent 可以执行获授权的实现与验证，但不能成为 owner、审批人或生产高风险动作的替代确认。

| 实际人员/账号 | 身份依据 | 映射的责任角色 | 边界 |
| --- | --- | --- | --- |
| `swingislee` | GitHub 仓库 `swingislee/mathin` 的所有者；当前 Git 提交身份 | 产品、设计、内容、学校产品、平台、技术、前端、数据库、课程研发、QA/发布、运维、安全、隐私、财务、教学运营负责人 | R1-15/R1-18 数据动作仍需该人员按阶段显式批准；要求非执行者复核的恢复/发布证据必须在对应阶段另登记实际复核人，未登记时 gate 不通过 |

以下“责任角色”均通过上表解析到实际人员；角色名继续保留，用于描述专业职责和未来多人协作时的交接边界。

| 事项 | 1.0 决定 | 责任角色 | 最迟完成 | 状态 |
| --- | --- | --- | --- | --- |
| 产品 | 六个对外模块与学校运营/内容发布同步上线；Terms 为关系中心 | 产品负责人 | 已定 | decided |
| R1-Live 单老师试用 | Gate 1“可安全开始”已通过；当前由 1 名正式教师在 production 班级/课次/花名册上试用。Gate 2 仍要求整班点名、保存/刷新/重登再读、管理员可见和无权限拒绝；两 Gate 全 `PASS` 后再向第一批内部教师扩大开放 | 产品+教学运营+QA/发布负责人 | 当前 | active production trial |
| 开发端新功能晋级 | 产品负责人可在单老师生产试用期间并行选择新功能；开发端定向机器检查和人工初验通过后，按独立提交、生产 preflight、可回退小增量发布和 postflight 晋级。未部署不得记为生产可用，已部署但未完成 postflight/人工复核只记“待验收” | 产品+技术+QA/发布负责人 | 单老师试用期间持续 | active development lane |
| Production 1.0 施工顺序 | 原 R1 暂停在 R1-9；P6-AIX-2 和来源 manifest 结果保留。R1-Live 开放后按真实问题恢复 R1-9～18；`v1.0.0` 前仍须通过本文件全部适用硬门 | 产品+QA/发布负责人 | R1-Live 14 天观察后复核 | queued after live |
| 视觉 | 小王子为全站基础；场景/内容/工作区三级强度；Notebook=旅途笔记 | 产品+设计负责人 | 已定 | decided |
| 语言 | UI 永久 zh/en；缺英文长内容时显式回退 | 产品+内容负责人 | 已定 | decided |
| 财务 | 1.0 安全关闭；未来启用必须以新迁移打开发布门并重新通过完整账务门 | 产品+财务负责人 | R1-8 | closed for 1.0 |
| 通知 | 站内通知为硬门；未选定/未验收的邮件、SMS、微信和 Webhook 渠道关闭 | 平台+运维负责人 | R1-2 | decided default |
| 遥测 | 第一方最小事件；不采集非必要未成年人 PII；第三方 SDK 默认不接入 | 产品+隐私负责人 | R1-13 | decided default |
| Work-items | 领域真相+领域投影+有限持久协同项；审批独立 | 学校产品+数据库负责人 | 已定 | decided |
| E2E | Playwright；临时浏览脚本不进入发布证据 | QA/发布负责人 | R1-14 | decided |
| 生产 | 独立小米 Linux；环境数据、secret、Storage 和域名隔离 | 运维负责人 | R1-16 | decided |
| 正式身份 | admin 角色账号恰为 1；R1-Live 增加真实教师和业务用户；`auth.users.id` 是唯一账号，邮箱/手机号/微信/QQ 只作为其 identity。production 数据按角色/用途/引用守卫保护；只有准备批准具体清理根时才重建删除闭包 manifest；管理员 MFA/恢复材料另行验证 | 产品所有者+安全负责人 | R1-Live Gate 1；完整恢复为 Production 1.0/R1-18 | 正式 admin、verified MFA、唯一 admin 原子交接、新会话 AAL2/admin 路由、首名教师 active `staff` 身份和 `research`/`teacher` 双岗位均已完成；当前 protected-only manifest 为 8 条 protected、0 条 purge。`admin_set_identity` 的真实授权 RPC 验收只在以后发生合法顶层身份变更时取证；双人恢复沿既有后续门执行 |
| 数据清理 | 只删除 manifest 显式标记的测试身份/运营数据；R1-Live 和后续真实业务事实及课次引用内容永久保护；保留 E 系列 1135 讲与爱学习 G+/X+/A+ 170 讲两轨源资源 | 数据库+课程研发负责人 | R1-15 schema 修订时 | 两个现有 purge RPC 合同已实现；全库 planner/隔离演练 pending |
| release | E 系列 1135×2 与爱学习 170×2，共 2610 条 baseline `release_no=1`；1305 个 legacy current release 均指向对应 native；正式课次引用的额外 immutable release 原样保留 | 课程研发+数据库负责人 | 已定 | decided |
| 证据位置 | 小摘要/索引固定在 `docs/evidence/r1/`；大日志/截图保存 CI artifact 或受控对象存储并记录 SHA-256、保留期和访问角色 | QA/发布负责人 | R1-0 | decided |

R1-0 已完成责任角色到 `swingislee` 的映射。增加人员或发生交接时先更新本节，并在证据索引记录生效日期；改变 decided 项时，同一变更更新 doc 00、04、25、README 和受影响发布门。R1-Live Gate 2 的真实教师、恢复复核人和 Production 1.0 非执行者复核人必须登记为实际人员，Agent 不能代替。

### 7.2 发布风险

| 风险 | 当前证据 | 影响 | Owner | 关闭阶段 |
| --- | --- | --- | --- | --- |
| R1-Live 正式目标 Golden Path 未完成 | 本机隔离 Golden Path 1/1 已通过并关闭 `lead → enrolled` 合同冲突；生产已有 1 个长期正式班/15 个课次/1 条 active 报名和 1 个短期专题班/3 个课次/0 报名，学年/秋季归属修复已上线；仍缺正式教师点名保存与刷新或重登再读、管理员对照和越权对照 | 班级、课次和报名存在只能证明闭环前半段；尚不能证明正式教师能完成持久点名及权限闭环 | 教学运营+QA/发布 | R1-Live Gate 2 |
| Production 1.0 运维成熟度未完成 | current/previous、原子切换、健康门、错误查询位置和当前同批次备份已知；备份仍是同机外置 exFAT 明文工件，尚无恢复抽查/异机副本，previous 未做受控切回，1,950 条历史错误的 release 为空 | 不阻止第一名内部教师开始使用，但会阻止扩大范围和 `v1.0.0` | 运维+安全+QA | R1-16～18 |
| Story 无完整章节 | 路由存在；无完整独立章节内容目录 | 对外 1.0 缺一模块 | 内容+产品 | R1-10 |
| R1-9 来源实物证据未完成 | P6-AIX-2 开发库证据与 v4 只读导出/对象校验核心、受控 runner 已通过；批准副本配置、外部 provenance、真实 1305 行 inventory、Storage/H5 审计与非执行者复核仍 pending | Production 1.0 release 清单可能缺对象或 snapshot 漂移；不影响 R1-Live 所选课次已读验证 | 产品+课程研发+QA/发布 | R1-Live 后恢复 R1-9，并在 R1-18 前重跑最终证据 |
| 英文正文缺失 | `content/en` 仅 README | `/en` 可能空白或混排 | 内容+前端 | R1-9～12 |
| 平台运行内核尚无生产验收 | R1-2 已完成 Job/通知/文件/集成的开发库断言、空库重放、Worker 单次运行和 zh/en 浏览器验证（M3） | 开发合同不证明生产 Worker、选中供应商、大文件容量、告警恢复和最终成功率 | 平台+运维+QA | R1-14/16/17 |
| 全站视觉强度合同刚固定 | doc 05 曾把工作区排除在星球主题外 | 公开站与后台品牌断裂或装饰侵入控件 | 设计+前端 | R1-12 |
| 机构配置尚无生产验收 | R1-1 已完成显式默认、版本/RLS/回滚和开发环境验证（M3） | 开发合同不等于生产配置、正式角色旅程和发布初始化正确 | 产品+数据库+发布 | R1-15～18 |
| 账户安全尚无生产验收 | R1-3 已完成账户/同意/支持的空库重放、负向断言与开发浏览器验证（M3） | 开发门控不证明正式唯一管理员、生产 MFA=100%、速率限制与恢复演练 | 安全+发布+QA | R1-14/16/17/18 |
| Work-items 尚无生产候选/RC 负载证据 | R1-4 已在开发/一次性库完成 30,000 条持久项、300 名员工、40 次采样，p95≤18.87ms、p99≤20.71ms（M3） | 开发合成负载不能证明生产长尾、并发与 14 天稳定性 | 学校产品+数据库+QA | R1-14/17 |
| 财务安全关闭尚无生产复核 | R1-8 已完成发布门、数据、任务/审批、通知、指标和 job 的开发/一次性库关闭证据（M3） | 开发环境关闭不变量不能证明生产初始化或正式清理后仍保持关闭 | 产品+财务+数据库+发布 | R1-15/18 |
| Vitest 基线需在最终 build 复验 | 全量既有基线为 93 个测试文件、625 项通过、1 项条件跳过；当前两 Gate 源码合同 52/52；历史 R1 回归 179/179；空间数学/SML-0 专项 279/279 | 后续实现可能重新引入合同回归；这些计数都不是生产运行证据 | 技术+QA | 已执行套件保持通过；发布前补齐条件跳过对应的真实包证据 |
| 正式 Playwright 发布门尚未完成 | 正式配置、target policy 和 fail-closed release runner 已落地；9 条非五模块本地 Chromium 旅程分别取绿 | 尚无明确非生产 release target 的单次 9/9 零 skip、写态、zh/en、跨浏览器和连续 3 次无 flaky 证据 | QA/发布 | R1-14 |
| 清理/release 未演练且旧 planner 会误删正式 Live 数据 | 两个现有 purge RPC 已接入目标绑定 manifest；旧“唯一管理员/运营数据为零”全库 planner 仍未修订 | 若绕过现有 RPC 或直接使用旧 planner，仍可能删除真实教师、班级、考勤及课次引用 release，也可能损失 4:3 资源 | 数据库+课程研发 | R1-Live 后修订全库合同，再在 R1-15 隔离演练 |
| 生产恢复未实操 | Linux 目标与 fail-closed preflight 已定；当前树与 Git 历史 secret scan 为 0，当前 PostgreSQL+Storage 同批次备份及独立 SHA/可读性复核已完成，但恢复 E3 仍为 pending | 尚无独立环境、运行时 secret 复核、告警链路、RPO/RTO、异机/静态加密副本、数据库/Storage 恢复或应用回滚的实操证据 | 运维+安全 | R1-16 |
| 无连续真实运行观察 | 生产单老师试用阶段已启动，但尚无正式点名持久再读与权限对照，Gate 2 仍未通过；独立观察、14 天/5 节课堂和支持指标均无 E4 | 不阻止当前单老师试用或开发端新功能预演，但会阻止扩大用户范围和 `v1.0.0` | 教学运营+发布 | Gate 2 后启动正式观察，R1-17 汇总 |

### 7.3 当前专题与 1.0 后处理

- `POST-LIVE-AUTH-01` 已由产品负责人在 R1-Live 期间提前选入独立热修轨：student/parent/staff/admin 及 learning/family/staff 环境沿用同一入口，以传统设置页组织个人资料、登录方式、安全与恢复、隐私与数据。第一阶段 migration `20260825000800` 与应用 `72d8127` 已部署 Xiaomi，机器 postflight 通过，待人工验收；账号级只编辑头像、全站显示名称和语言，业务档案只读关联。验证码、邮箱/手机号自助绑定与微信/QQ 尚未启用；该项不追加为 R1-Live blocker。
- 空间数学实验室保留 SML-0 暂停点，可按独立路由、权限或 Feature Flag 并行；不因已有增量自动关闭 SML-0～8，不进入 R1-Live Gate，也不扩写 PROD-08。
- 补齐英文课程、Minds 和 Story 正文；UI、路由和回退已在 1.0 完成。
- 执行 `cacheComponents` + `use cache` 专项；继续禁止 `unstable_cache`。
- 评估原生 App、更多游戏/章节、复杂营销和高级 BI。
- 查询优化无法使 work-items 达到 PERF-04 时，再评估物化投影。

## 8. 证据与文档维护

R1-Live 与 Production 1.0 共用固定的版本化证据索引 [`docs/evidence/r1/README.md`](../evidence/r1/README.md)。R1-Live 的当前差距和 Gate 证据登记在 [`r1-live.md`](../evidence/r1/r1-live.md)。仓库保存无 secret/PII 的小摘要、结构化结果和外部 artifact 索引；大日志、视频和截图存 CI artifact 或受控对象存储，索引保存 artifact URL/path、SHA-256、保留期和访问角色。

每次阶段关闭提交：

1. 代码、迁移、内容或 runbook；
2. 适用 gate 的 E1～E4 证据和失败 ticket；
3. 本文件成熟度、风险、Conditional Go 例外和到期日；
4. 专题文档状态头、doc 04 当前阶段和 README；
5. `pnpm plan:audit`、相关测试、typecheck 和 production build 结果。

R1-Live 证据包只包含目标/commit 与正式身份、当前 PostgreSQL+Storage 备份、防误清、可识别的 current/previous 与回退命令、错误查询位置，以及点名 Golden Path 和权限对照。现有 manifest 证明 purge 默认拒绝即可；日常正式业务写入不要求逐条登记。Production 1.0 证据包另包含依赖锁与 SBOM、104 份视觉签收索引、完整 E2E/性能/无障碍/安全报告、恢复与受控 rollback 演练、错误 release 标签、上线后 14 天观察、受保护清理/release-1 报告、Go/No-Go 审批和 `v1.0.0` tag。
