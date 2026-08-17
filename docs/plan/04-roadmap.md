# Mathin 整体规划 · 04 R1 路线图

> **规划状态**：`active`
>
> **当前施工阶段**：`R1-Live-1 · 正式身份与真实数据`
>
> **R1 暂停位置**：`R1-9 · P6-9 与 Production 1.0 完整性`；已完成的来源 manifest、导出器和爱学习课程结果保留，真实 1305 行 inventory、全量对象审计及 R1-10～18 不再阻塞首次内部生产使用。
>
> **SML 暂停位置**：`SML-0 · 合同与金标冻结`；空间数学可按独立权限或 Feature Flag 并行，不进入 R1-Live Gate。
>
> **当前阻塞**：`mathin.club` / `supabase.mathin.club` 的运行指纹已完成登记；仓库级 target policy 已把 Xiaomi 固定为当前生产目标，并覆盖 fixture、离线夹具、CI 重建和课程导入/适配入口。迁移 `20260815000100_r1_live_object_protection_manifest.sql` 与 `20260815000200_r1_profile_role_update_guard.sql` 已在 Xiaomi 单事务部署；生产账本 177 条、head=`20260815000200`、仓库 migration 无缺失，14 个相关函数定义与隔离库一致。本机隔离开发目标已建立并完成固定账号验证。生产 current 为 `20260814-221135` / `023f5167…`，previous 为 `20260724-051318` / `b833c4d…`，服务、内外健康和 MFA 路由匿名鉴权探针通过。唯一正式管理员已完成 verified MFA、唯一 admin 原子交接、重新登录、MFA challenge 和生产 admin 路由验收。首名真实教师已通过一次性员工邀请注册为 active `staff`，正式管理员按产品安排分配的 `research` 与 `teacher` 双岗位已由只读核查确认。protected-only replacement manifest 经回滚演练、正式提交和独立 postflight 后生效：header=2（active 1/retired 1）、active entry=8，保护正式管理员 auth/profile、2 个 production 课程族根，以及教师 auth/profile/2 条岗位成员关系；`purge_allowed=0`，两个 purge 候选列表均为 0。生产现为 auth/profile=13、staff-role=10、admin 1/staff 8/student 2/parent 2，班级/课次/报名/点名仍为 0。Gate 1 现在只剩真实班级/课次/花名册、课次引用内容保护和授权边界核查，因此仍为 `BLOCKED`。目标机没有可核验的数据库/Storage 最近备份，previous 尚未验证兼容回退，Gate 3 保持 `BLOCKED`。
>
> **核对日期**：2026-08-15；目标运行事实采样于 2026-08-14～15，本机隔离目标采样于 2026-08-15，仓库实现依据代码、迁移、一次性数据库断言、现有 R1 证据及 `mathin-R1-Live-讨论稿.md`。

## 1. R1 的两个交付事件

| 事件 | 完成结果 | 不作为前置条件 |
| --- | --- | --- |
| **R1-Live · 内部生产试运行** | 1 名公司教师用正式账号、正式组织和真实数据，独立完成一次整班点名；数据可再次读取，管理员可见，无权限主体不可见；团队能回答备份、回退、报错定位和防误清四个问题 | 六个公开模块内容完整、1305 讲全量来源审计、全量视觉/E2E/容量/恢复演练、14 天观察、完整 Production 1.0 证据 |
| **Production 1.0 · `v1.0.0`** | doc 00 的完整产品合同、doc 25 的量化硬门、正式课程基线、恢复演练和发布审批全部成立 | 仅有明确接受且不影响安全、数据正确性和核心旅程的例外 |

R1-Live 完成即代表 Mathin 进入公司内部生产使用。Production 1.0 继续推进，但不能作为第一名教师开始工作的额外等待阶段。R1-Live 产生的正式身份、班级、课次、学生和考勤是正式业务事实，后续初始化、演练或发布不得按测试/RC 数据删除。

### 1.1 施工规则

1. 每次只关闭一个 Gate；只实施使当前 Gate 从 `BLOCKED/UNKNOWN` 变为 `PASS` 的最小事项。
2. 状态只允许 `PASS`、`BLOCKED`、`UNKNOWN`、`NOT REQUIRED`。代码存在但未在目标环境运行，只能作为实现证据，不能记为 `PASS`。
3. 只有数据丢失/泄露、登录不可用、首个闭环无法完成、核心入口不可达、必须手工改库才能继续等 P0/核心 P1 阻塞 R1-Live。P2 进入上线后池。
4. 不在当前 Gate 清单中的内容、视觉、全量测试、重构、导入器、报表和 Spatial Math 工作不得自动升级为阻塞项。
5. 正式数据写入、身份创建、部署、备份恢复和清理仍遵守人工授权、明确目标、只读预检和证据登记要求。
6. 当前 Gate 已明确规划且不扩张范围的步骤，由产品负责人本轮 standing execution direction 授权 Agent 直接推进；Agent 每轮执行前自检目标、写态、可逆性、漂移和证据边界，不把既定步骤拆成重复“允许”确认。只有需要真实身份/班级等产品输入、人工操作或验收，发现计划外漂移，或将进入清理、不可逆动作和范围扩张时才停下。

## 2. R1-Live Gate 状态

| Gate | 状态 | 已完成证据 | 缺失项与最小退出条件 |
| --- | --- | --- | --- |
| **Gate 0 · 上线范围冻结** | **PASS** | 本文件冻结首个闭环为“正式教师整班点名”；旧 R1 工作已分入本次必需、上线后、独立并行三类 | 范围改变只能由产品负责人显式裁决，并在同一变更同步 doc 00/04/25 和证据索引 |
| **Gate 1 · 正式身份与真实数据** | **BLOCKED** | 目标组合指纹 `799d…63e39`、仓库写入口 target policy、部署 commit、Storage 匿名摘要和现有身份/业务对象计数已登记；测试造数/重建拒绝 Xiaomi；本机隔离 Supabase 和固定账号登录已通过；唯一正式 admin 已完成 verified MFA、原子交接、新会话 MFA challenge 和 admin 路由验收；`20260815000100`/`20260815000200` 已在生产部署。首名真实教师邀请已唯一消费并注册为 active `staff`；正式管理员分配的 `research` 与 `teacher` 双岗位已确认。replacement manifest 已激活：header=2（active 1/retired 1）、active entry=8，保护 admin auth/profile、2 个 production 课程族根及教师 auth/profile/2 条岗位成员关系，0 个 purge 条目、候选列表为空且数据零漂移；员工邀请、staff 角色/RLS、production/test purpose、学生/分班/课次 UI/RPC 已实现 | 建立 1 个真实 production 班级、至少 1 个真实课次和真实花名册；把新增业务事实及课次 release/snapshot/object hash 纳入后续 replacement manifest；教师只见授权范围 |
| **Gate 2 · 真实点名闭环** | **BLOCKED** | `AttendanceDrawer`、`saveAttendanceAction`、`session_attendance` upsert、`can_mark_attendance`/`can_view_attendance` RLS 和开课前点名门已落地；开发合同测试覆盖存在性 | 用正式教师在目标环境完成登录→班级→课次→整班点名→保存→刷新→退出/重登→再次读取；正式管理员可见；无权限主体不可见；增加一条等价的最小 Smoke/Golden Path，P0/核心 P1=0 |
| **Gate 3 · 最小生产保险丝** | **BLOCKED** | 仓库级危险写入口已统一拒绝误指 Xiaomi；生产账本已包含仓库全部非 snapshot migration；数据库 purge 的 fail-closed 合同与 protected-only active manifest 已生效，0 个准删条目且候选列表为空；current 已发布为 `20260814-221135` / `023f5167…`，previous 已知为 `20260724-051318` / `b833c4d…`；原子切换、自动失败回退、服务及内外健康探针通过；`operational_errors` 可按时间/route/digest 查询；运行核查见 [`r1-live-target-audit.md`](../evidence/r1/r1-live-target-audit.md) | 目标机没有数据库/Storage 备份 timer 或可校验的数据备份；previous 未做兼容烟测或受控回退；1,946 条错误均缺 release；仍需备份+恢复抽查、previous rollback、release 标识和受控错误定位 |
| **Gate 4 · 真实教师独立验收** | **BLOCKED** | 尚无 E4 真实教师记录 | 产品负责人选择 1 名真实教师；教师在不接受逐步指导的情况下完成 Gate 2；P0=0、影响闭环的 P1=0，P2 记录后立即向第一批公司教师开放 |

`R1-Live-N` 表示当前只关闭 Gate N。Gate 0～3 取得退出证据后，在同一提交把当前阶段推进到下一 Gate；Gate 4 通过后标记 R1-Live 开放，并由产品负责人按真实问题选择下一个 Production 1.0 阶段。后续 Gate 可以并行准备，但不能越级记为 `PASS`。

详细代码核对、运行未知项和人工动作见 [`docs/evidence/r1/r1-live.md`](../evidence/r1/r1-live.md)。

## 3. 首个真实教师闭环

```text
正式教师登录
→ 进入 /[locale]/dashboard/classes
→ 打开分配给自己的 production 班级
→ 打开真实课次并进入课堂
→ 为花名册逐人登记 present / absent / late / leave
→ 保存
→ 刷新、退出并重新登录
→ 再次打开同一课次，确认记录仍存在
→ 正式管理员在授权范围内读取同一记录
→ 匿名请求和未获授权的现有主体不能读取该班记录
```

| 层 | 当前实现 | R1-Live 验收 |
| --- | --- | --- |
| 身份 | `/signup` + `issue_staff_invitation` + `handle_new_user`；当前生产仅启用邮箱/password；管理员再分配内置 teacher staff role | 首名教师可先使用真实邮箱和一次性邀请；账号唯一锚点为 `auth.users.id`。手机号/password、验证码和微信/QQ 按[单账号多登录身份合同](r1-live-auth-identities.md)分阶段启用，不延迟首次真实点名 |
| 入口 | `/dashboard/classes`、`/dashboard/classes/[classId]`、`/dashboard/sessions/[sessionId]`、`/classroom/[classId]/session/[sessionId]/live` | 教师不依赖手写 URL 或管理员现场指导找到目标课次 |
| 写入 | `saveAttendanceAction` 校验最多 200 条记录并 upsert `session_attendance` | 保存成功后每名在册学生恰有一条 `(session_id, student_id)` 事实；刷新/重登不丢失、不重复 |
| 授权 | `attendance.mark` + `can_mark_attendance` + `can_view_attendance` + RLS | 本班教师与管理员可读；匿名请求必须拒绝；若目标已有未分配 staff、其他班教师、学生或家长，再对该现有主体做负向验证，不为测试临时创建正式账号 |
| 错误 | action 返回显式失败，服务端请求错误由 `src/instrumentation.ts` 结构化输出 | 受控失败能用时间、route/release/digest 定位；核心读取/保存失败不得显示为“空花名册/无数据” |

课程内容只要求首个真实课次采用的那一讲可读，并把该课次冻结/引用的 immutable release、snapshot 和对象 hash 纳入正式保护 manifest；P6-9 的 1305 讲全量来源 inventory 不进入 Gate 2。首个闭环不要求开课、发布成果、家长查看、财务、Notebook、Terms 或 Spatial Math 同时通过。

## 4. 当前阶段：R1-Live-1

按以下顺序关闭 Gate 1：

1. **目标确认（只读已完成）**：应用 `mathin.club`、Supabase `supabase.mathin.club`、目标组合指纹 `799d6a9c5d2a6fd5ec8d5ff3bef7f36a251d3488a7b387ce01d057b096463e39`、Storage 匿名摘要、部署 commit 和数据库 migration head 已登记在 [`r1-live-target-audit.md`](../evidence/r1/r1-live-target-audit.md)。
2. **防误清（目标 schema 与 protected-only replacement manifest 已生效）**：公共 target policy 已把 `xiaomi` / 正式域名 / 稳定数据库指纹视为同一生产目标；fixture、离线夹具和 CI 重建没有生产放行，课程导入/适配只有精确指纹、显式 CLI 开关和当前 Shell 确认同时成立才可进入生产写阶段。migration `20260815000100` 已部署；当前 active manifest 共 8 个 protected、0 个 `purge_allowed` 条目，保护正式管理员、两个 production 课程族根和首名真实教师的 auth/profile/两条岗位成员关系；首份 4 条目 manifest 已按不可变合同转为 `retired`。独立 postflight 确认两个 purge 候选列表均为 0，artifact 受控保存且 hash 一致，账号/业务计数无漂移。本机 Supabase 已只发布到 `127.0.0.1`，应用 `.env.local` 与非生产写目标 attestation 均指向该目标；11 个固定开发身份仅用于隔离开发，不进入正式身份清单。仓库说明见 [`r1-write-target-policy.md`](../runbooks/r1-write-target-policy.md)与 [`r1-live-object-protection-manifest.md`](../runbooks/r1-live-object-protection-manifest.md)。新增真实业务事实后继续以 immutable replacement manifest 纳入保护。
3. **正式管理员（身份/登录和生产修复部署完成）**：唯一非固定 Gmail 已完成 verified MFA；一次性受控事务已把该账号 `staff→admin`、把原固定开发 admin `admin→staff`，提交后唯一 active admin 恰好为 1。本人已退出并重新登录，完成 MFA challenge 后成功打开 admin 路由，新会话 AAL2 和应用授权通过。`BUG-R1-LIVE-001` 已由 `20260815000200` 完成隔离库回归与生产部署，生产函数定义和保护字段合同 postflight 通过。首名教师由员工邀请直接建立 `staff` 身份，其岗位分配调用 `grant_staff_role`，不会为了验收另一条 `admin_set_identity` 路径人为改动正式账号；该 RPC 只在以后出现真实顶层身份变更时取证，不阻塞当前闭环。双人恢复联系人和恢复演练沿用既有 Production 1.0/R1-18 要求，不加入 R1-Live 当前执行链。
4. **正式教师（注册、岗位与保护已完成）**：首名教师已按现有邮箱绑定一次性邀请注册；去标识化只读核查确认邀请唯一消费、邮箱匹配、账号为 active `staff`。正式管理员按产品安排分配的 `research` 与 `teacher` 双岗位均有效，并已与教师 auth/profile 一同进入当前 active replacement manifest。邮箱/手机号通用 password 接口、重复密码、login-only OTP 与微信/QQ 绑定边界已冻结在 [`r1-live-auth-identities.md`](r1-live-auth-identities.md)；手机号生产启用需先完成邀请迁移、非生产验证和 Gate 1/3 保险丝，不作为首名教师开始点名的前置条件。
5. **最小真实数据**：产品负责人提供真实教师、班级、课次和花名册；管理员使用现有 UI/RPC 创建或导入学生、选择一个已可读课程/讲次、创建 `purpose=production` 班级与课次并分班；把课次冻结/引用的 release ID、snapshot hash 和依赖对象纳入保护清单。不得用一次性 SQL 或复制开发 UUID 代替正式路径。
6. **边界复核**：正式教师只看到自己的班级/课次；开发固定账号和未分配员工不看到正式班级；正式数据不出现在测试清理预览中。

正式管理员的 `student→staff` 引导、本人 MFA、`staff/admin` 原子交接、新会话登录验收、两个 R1-Live migration 的生产部署，以及首名真实教师的邀请注册、`research`/`teacher` 双岗位和 replacement manifest 保护均已完成。下一步需要产品负责人提供首个真实花名册输入；随后按 §1.1 的 standing execution direction 继续通过正式 UI/RPC 建立 production 班级和课次，并随新增事实替换 active manifest，直到需要人工登录验收或出现计划外差异。

2026-08-14 初次目标匿名快照有 12 个 email/password auth user、6 个 `purpose=production` 班级、61 个未删除课次、3 条 active enrollment 和 5 条点名记录；同日 19:59（Asia/Shanghai），仓库精确 migration `20260814000300_p6_six_classroom_cleanup` 已清除这 6 个验收班级及其课堂数据。2026-08-15 migration/首份 manifest 基线为 auth/profile=12、staff-role=8、学生=4、班级/课次/报名/点名=0；首名真实教师注册及双岗位分配后为 auth/profile=13、staff-role=10、学生仍为 4、班级/课次/报名/点名仍为 0。正式管理员和产品负责人明确选择的首名教师以外，其他对象仍不能仅按角色、邮箱后缀或历史 `purpose` 推断为正式或可清理对象。

## 5. Gate 2～4 的最小施工

### 5.1 Gate 2

- 为点名黄金路径增加一条聚焦的 Playwright 写态用例；自动化使用隔离副本或固定非生产账号，正式凭据不进入测试配置。
- 在目标环境人工执行同一步骤并登记去标识化结果。正式学生姓名、邮箱、截图和视频只进入受控证据位置。
- 只修复该路径上的 P0/核心 P1。Dashboard 其他模块错误、非核心页面视觉和未使用功能进入上线后池。

### 5.2 Gate 3

Gate 3 只回答四个问题：正式数据在哪里、最近可用备份在哪里、应用坏了如何回退、老师报错后去哪里定位。最低证据为：

- 一份当前数据库与 Storage 备份的时间、hash/清单和恢复抽查结果；
- 当前/previous immutable release 与一次受控回退或等价的可执行确认；
- `mathin.service`/结构化错误接收端的查询方式，以及一次受控保存失败的定位记录；
- 生产指纹对 reset、seed、rebuild、testdata purge 的拒绝结果。

2026-08-14 只读核查已确认“目标在哪里”和“错误去哪里查”。2026-08-15 已把当前提交以 immutable release 原子发布，旧 current 成为 commit 已知的 previous，服务和内外健康探针通过；两个 R1-Live migration 与首份 active protected-only manifest 随后完成部署。2026-08-17 教师双岗位 replacement manifest 又完成回滚式演练、原子替换和独立 postflight。Gate 3 仍不能通过，因为没有最近数据备份、previous 与当前数据库兼容性未经回退验证，且错误缺少 release 关联。修复与复验清单见 [`r1-live-target-audit.md`](../evidence/r1/r1-live-target-audit.md)。

完整异机灾备、RPO/RTO、全量监控、全量恢复演练继续属于 Production 1.0。

### 5.3 Gate 4

真实教师独立执行 Gate 2。问题只分三类：P0 阻塞；使闭环无法完成的 P1 阻塞；P2 记录到上线后池。Gate 4 `PASS` 后立即开放第一批内部教师，不再追加新的前置阶段。

## 6. 原 R1 工作重新定位

| 原阶段 | 已有结果 | R1-Live 处理 | Production 1.0 处理 |
| --- | --- | --- | --- |
| **R1-0～R1-4** | 治理、机构配置、运行内核、账户安全、work-items 已关闭 | 复用 Gate 1/3 所需子集，不重做 | 保留原 M4/正式环境证据要求 |
| **R1-5～R1-8** | 学生/家庭、成果、数据维护、财务安全关闭已关闭 | 复用学生、班级、点名、权限和防误清合同；财务继续关闭 | 完成全角色/正式环境验收 |
| **R1-9** | P6-AIX-2、1305 讲来源 manifest/只读导出核心已落地，真实全量证据未完成 | 只要求首个课次所用讲次可读；其余暂停 | 恢复 Terms、全量课件 inventory、Storage/H5 审计和 release 基线 |
| **R1-10** | Story 完整章节仍有缺口 | 不阻塞；只有共享入口或点名核心路径受影响时才修 | 完成一个可从入口读到结尾的完整章节、Terms 关联、双语回退和无障碍 |
| **R1-11** | Games/Minds/Tools 的完整旅程仍有缺口；Notebook 数据库子门已完成 | 不阻塞；保留已完成增量，普通教师看不到未完成能力 | 完成四模块关键旅程、Notebook 完整写态、越权和视觉验收 |
| **R1-12** | 跨模块、公共质量和全站视觉仍有缺口 | 不阻塞；点名入口若有可用性缺陷才修 | 完成六模块贯通、zh/en 回退、全站小王子视觉、SEO/a11y/浏览器门 |
| **R1-13** | 全量指标/遥测未完成 | Gate 3 只做错误可见与最小支持记录 | 完成统一指标、报表、隐私与告警 |
| **R1-14** | 正式 Playwright 框架与 9 条非五模块本地基线已落地 | 只补点名 Golden Path 及适用越权用例 | 完成写态、zh/en、跨浏览器、连续无 flaky、并发和文件矩阵 |
| **R1-15** | 只读生产基线 planner 已落地 | 不执行清理；其“只保留管理员”旧假设不得作用于 R1-Live 正式数据 | 修改为保护正式身份、业务事实和课次引用 release 的 manifest 后，在隔离副本演练显式测试数据清理和 2610 条 baseline release-1 |
| **R1-16** | 部署 preflight、secret scan、历史公网部署/回滚手册存在 | Gate 3 只核实当前备份、回退、日志和防误清 | 完成独立环境、监控、数据库/Storage 恢复和 RPO/RTO |
| **R1-17** | 尚无真实 RC | 移到 Gate 4 之后；真实使用即观察起点 | 上线后连续 14 天、至少 5 节课堂形成扩容/1.0 证据 |
| **R1-18** | 尚未执行 | 不阻塞 R1-Live，不得删除真实试运行数据 | 人工批准后只清理 manifest 明确标记的测试数据，保护真实身份、班级、记录及课次引用 release，完成 `v1.0.0` |

## 7. 独立并行与上线后池

- Spatial Math / 3D 继续独立路由、权限或 Feature Flag；默认普通教师不可见未完成能力。修改共享认证、导航、数据库或课堂链路时回归 R1-Live Smoke。
- Terms/Minds/Story 长内容、1305 讲全量审计、Notebook 完整写态、完整视觉矩阵、全量 E2E、容量、指标、复杂恢复、财务/活动深化和长期重构进入上线后池。
- `POST-LIVE-AUTH-01`：为 student/parent/staff/admin 及各 Dashboard 环境建立一致、可发现的账号中心入口，完善资料、密码、MFA、会话、恢复方式和多 identity 绑定管理；当前学生端无入口的观察不阻塞 R1-Live，完整合同见 [`r1-live-auth-identities.md`](r1-live-auth-identities.md) §6E。
- R1-Live 开放后的真实问题按 P0/P1/P2 排序；14 天观察用于决定扩大用户范围和恢复 Production 1.0 施工顺序。
- `cacheComponents`、原生 App、更多游戏/章节和高级 BI 继续延期。

## 8. 已关闭基础阶段

| 阶段 | 关闭日期 | 结果 | 证据 |
| --- | --- | --- | --- |
| R1-0 | 2026-07-28 | 范围、责任、证据和阶段唯一性冻结 | [`r1-0.md`](../evidence/r1/r1-0.md) |
| R1-1 | 2026-07-28 | 机构/校区、规则、Feature Flag 与 fail-closed | [`r1-1.md`](../evidence/r1/r1-1.md) |
| R1-2 | 2026-07-28 | Jobs、通知、文件与集成运行内核 | [`r1-2.md`](../evidence/r1/r1-2.md) |
| R1-3 | 2026-07-28 | 账户、安全、同意、员工邀请和支持 | [`r1-3.md`](../evidence/r1/r1-3.md) |
| R1-4 | 2026-07-28 | Work-items 与轻审批 | [`r1-4.md`](../evidence/r1/r1-4.md) |
| R1-5 | 2026-07-31 | 学生/家庭门户与课堂连续性 | [`r1-5.md`](../evidence/r1/r1-5.md) |
| R1-6 | 2026-08-01 | 教学成果、阶段报告与通知 | [`r1-6.md`](../evidence/r1/r1-6.md) |
| R1-7 | 2026-08-01 | 初始化、导入、质量、修复与导出 | [`r1-7.md`](../evidence/r1/r1-7.md) |
| R1-8 | 2026-08-01 | 财务安全关闭 | [`r1-8.md`](../evidence/r1/r1-8.md) |

Gate 关闭的同一变更更新实现/运行证据、[`docs/evidence/r1/README.md`](../evidence/r1/README.md)、doc 00/04/25、受影响专题状态头，并运行 `pnpm plan:audit`。R1-Live Gate 关闭不自动宣称对应领域达到 doc 25 的 Production 1.0 M4。
