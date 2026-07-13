# Mathin 整体规划 · 13 横切地基与系统加固（安全 / 业务正确性 / 可验证性 / 合规 / 组织时间维度）

> 本文是一条**横切（cross-cutting）加固线**，不是新功能板块。它来自三轮"结构性缺席"审计的结论：Mathin 的核心鉴权/RLS/并发架构是有纪律、经得起推敲的（白板 Realtime 授权、财务行锁、students 纵深防御都验证为正确），但**质量呈斑块状**——同一周、同一作者的代码，白板 send 策略是 A+，紧挨的教室 send 却漏了师生之分；财务 numeric+行锁很严谨，紧挨的绑码认领却能被枚举。
>
> 斑块的根因不是能力，是**缺少横切的验证网与共享地基**：审计、领域事件、学期时间轴、内容稳定 ID、RLS 断言测试、类型生成——这些不是"功能"，但它们决定了已经写对的东西三个月后还对不对。
>
> **定位**：本文与 `12-p4d-student-lifecycle.md` **交错执行**，不是排在它之后。理由见 §9——其中"每晚一期回填成本翻倍"的三项（领域事件表、学期轴、内容 uid）必须趁 P4D 还没堆更多表时就埋钩子。前置阅读：`10-school-backend.md`（数据模型/RBAC 底座）、`03-data-and-tech.md`（RLS 与目录约定）。执行纪律同前：本文没写的决策停下来问用户；每条任务一次提交；提交前 `pnpm lint && pnpm typecheck && pnpm build`（先停 dev server）；migration 走 SSH（`CLAUDE.md` 约定），破坏性 SQL 先确认。

---

## 1. 范围与非目标

**范围**：三轮审计得出的 21 个横切隐患，按"晚补有多痛"归为五层。每项给现状证据（已核实到具体 migration 行/代码行）、表结构或代码钩子、验收标准。

**非目标（本文明确不做）**：
- 不重写任何已验证正确的模块（白板授权、财务 RPC 骨架、students 纵深防御保持不动，只做加法）。
- 不引入多租户 / 多机构（`04-roadmap` 长期暂缓项不变；但 §3.2 学期轴与 §7 组织维度会为"单机构多校区"留门，不写死单校假设）。
- 不做工资支出、评论/私信（暂缓项不变）；但**通知/事件层回到范围内**——它此前被误伤进"消息通知"暂缓清单（见 §3.1 论证）。

**分期代号**：本文任务用 `P4E-*` 前缀，S=安全立即项、F=地基项、V=可验证性、C=合规身份、O=组织维度。排期与 P4D 交错，见 §9。

> **完成记录（2026-07-13）**：计划 13 已按 §9 逐项实现并通过发布门禁；逐项证据见 `docs/runbooks/p4e-completion-audit-2026-07-13.md`。异机备份、短信供应商接入以及 ICP/公安备案主体信息与办理结果，均由用户明确暂缓，仓库保留接口与运行手册，不计入本轮阻断项。

---

## 2. P4E-S 立即安全项（不进正常排期，就近插入当前分支修）

这三项是可被直接写脚本利用、或课堂现场可被学生接管的洞。修复量都不大（migration + 少量前端），但不应等排期。

### 2.1 绑码认领可暴力枚举 + 认领即取全档（`school_students.sql`）

**现状证据**：
- `claim_student_account(p_code)`（`20260709000400_school_students.sql:177`）对任意 `authenticated` 开放，**无任何尝试次数限制**。
- 绑码是 `substr(md5(gen_random_uuid()...), 1, 8)`（第 73 行），仅 8 位 hex ≈ 32 bit 熵。
- `bind_guardian(p_code, p_relation)`（第 201 行）与学生认领**共用同一个码**；认领成功后码不失效、不换发。
- 注册零门槛，任意注册用户即可高频调用。认领成功一次 = 拿到一名真实小学生的姓名/电话/家庭住址/成绩/销售跟进记录。

**修法（新 migration）**：
1. **认领节流**：新增 `bind_claim_attempts(user_id, ip_hint text, attempted_at, ok boolean)`，`claim_student_account`/`bind_guardian` 进入即写一条，并在函数体开头统计"该 uid 近 N 分钟失败次数 ≥ K 则 `raise exception 'RATE_LIMITED'`"。此表天然是 §3.1 领域事件表的第一个消费场景——可直接落到事件表而非单开表。
2. **码认领后作废**：认领成功后将 `bind_code` 置为一次性失效（加 `bind_code_used_at timestamptz`，或认领后重置为新码由教师再分发）。防止同一码被二次认领/家长与陌生人竞争。
3. **学生码与家长码分离**：家长绑定不应与学生本人认领共用码。家长绑定改为"教师/学辅在后台对该学生签发一次性家长邀请码 + 关系"，或家长自助申请后**教师点确认**才生效（见 §7.3 多监护人差异权限，两者合并设计）。
4. **提高熵**：新签发的码用可读但更长的编码（如 base32 去混淆字符 10–12 位），旧码平滑过期。

**验收**：脚本对 `claim_student_account` 连续猜码，K 次失败后被 `RATE_LIMITED` 拒；认领成功的码再次认领报错；家长绑定必须经教师确认或一次性邀请码，无法用学生自认领码绑定。

### 2.2 教室里学生可伪造教师权威广播（`class_sessions.sql`）

**现状证据**：白板 send 策略要求 editor——`is_whiteboard_member(..., true)`（`20260708000100_whiteboards.sql:38` 第三参 `require_edit`）；而教室 send 策略 `session_broadcast_send_member`（`20260708000400_class_sessions.sql:132`）**只校验 `is_session_member`，不区分师生**。后果：任一 session 成员（学生）可 broadcast 翻页/发题/评分等教师权威事件，接管课堂节奏。

**设计约束（关键，决定修法形态）**：`realtime.messages` 的 RLS **看不到 broadcast 的 event 名**（event 在 payload，不是列），因此**无法在单一 topic 上按事件类型分权**。`is_session_teacher(sid, uid)` 函数已存在（`class_sessions.sql:62`），但不能简单把 send 策略从 member 换成 teacher——学生仍需发送自己的作答/光标/presence。

**修法（二选一，推荐 A）**：
- **A. 双 topic 分权（推荐）**：拆成 `session:{id}:authoritative`（教师→全体：翻页/发题/评分/课堂状态，send 策略 = `is_session_teacher`）与 `session:{id}:client`（学生→教师+全体：作答/光标/presence，send 策略 = `is_session_member`）。前端 `src/features/classroom/sync/transports.ts` 订两个频道。权威事件学生根本无权发。
- **B. 服务端对账兜底**：保留单频道，但权威状态（当前页、评分结果）**不信任广播**，改由教师端调 security-definer RPC 落库（见 §4.4），广播只做实时提速、库为最终事实。B 与 §4.4 天然合并。

推荐 **A + B 都做**：A 挡住伪造，B 保证课堂报告可信且可追溯。

**验收**：学生端构造翻页/评分 broadcast 到 authoritative 频道被 RLS 拒；断线重连后当前页/评分以服务端 RPC 落点为准，与任意残留广播不一致时以库为准。

### 2.3 白板快照客户端直写、无界、整表覆盖（`whiteboards.sql`）

**现状证据**：`whiteboards.snapshot jsonb`，`grant update (title, snapshot) on public.whiteboards to authenticated`（`20260708000100_whiteboards.sql:118`）——客户端可写任意 jsonb，RLS 只管哪行能写不管写了什么。注释明确"无 op 流水表，防抖整体落盘"。三重叠加：无 shape 校验（可写垃圾/超大 payload）、无大小上界（长课单行膨胀 + 每次整行重写的写放大）、last-write-wins（两 editor 并发保存后写覆盖先写，丢笔迹且无留痕）。

**修法（新 migration + 前端落盘改造）**：
1. 收回 `grant update (snapshot)` 的裸列写权，改为 security-definer RPC `save_whiteboard_snapshot(wb_id, snapshot, base_version)`：内部校验 `is_whiteboard_member(wb_id, uid, true)`、校验 snapshot 是数组且长度/字节数 ≤ 上限、乐观锁 `base_version` 冲突则拒（复用 P3 笔记已验证的乐观锁范式）。
2. 大小上限触发时前端提示"画布过大，请新建页"，长期（非本期）再考虑"快照 + 增量段"分离让单次写入有界。

**验收**：非 editor 无法写 snapshot；写入非数组/超限 payload 被拒；并发保存冲突走乐观锁提示而非静默覆盖。

---

## 3. P4E-F 横切地基层（每张新表都会继承的假设，趁表少埋钩子）

本层三项（3.1 事件表、3.2 学期轴、3.3 内容 uid）具有"每晚一期、回填成本翻倍"性质，**必须在 P4D 继续加表之前落地**。

### 3.1 领域事件 + 审计层（一张表撑三个未来系统）

**论证——为什么通知被误伤进暂缓清单**：`04-roadmap` 长期暂缓"消息通知系统"，但那指的是社交向的评论/私信。学校运营的每个瞬间都是"某人需要被告知"：课次改时间（家长）、作业批改完（学生）、缴费到期（学辅）、跟进超时（主管）、试听到场（销售）。现状 `grep notif` 零结果，全靠人肉刷后台。更致命的是架构后果：等要补通知/微信推送时，需翻改**所有**已写的 action 去插桩。

**现状证据**：全库 30 个 migration 无任何审计表；`orders`/`payments`/`refunds`/`account_ledger`、课堂评分、`role_permissions` 全部可改而无 who-changed-what-when 记录。RBAC 只建了授权、没建问责。财务数据在中国有法定保存年限要求。

**修法（新 migration，本层第一优先）**：建**一张** `domain_events` 承载三种用途——
```
domain_events(
  id uuid pk default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,                 -- auth.uid()，可空（系统事件）
  actor_role text,               -- 快照当时角色，防事后改角色丢失语境
  event_type text not null,      -- 'payment.recorded' / 'student.status_changed' / 'perm.granted' ...
  entity_type text not null,     -- 'order' / 'student' / 'staff_role' ...
  entity_id uuid,
  payload jsonb not null default '{}',  -- 变更前后值 / 金额 / 目标等
  term_id uuid                   -- §3.2，事件也挂学期轴
)
```
- **RLS**：`insert` 由各 RPC 内部写（security definer）；`select` 按权限键（审计查看权）；**禁止 update/delete**（审计即不可删的事件——加一条 `for update/delete using (false)` 或干脆不 grant）。
- **落桩优先级**：先接三类高危 RPC——财务（`record_payment:497`、`request_refund`、`approve_refund`）、成绩/评分写入、权限变更（`role_permissions` 相关）。其余模块随各自任务陆续接。
- **三个下游共用它**：审计（问责）、站内通知铃铛 + 未来微信推送（消费未读事件）、经营统计（转化漏斗/流失分析按事件流算）。**先建表 + 高危落桩，消费端以后随时接**。

**验收**：一笔收款/一次改分/一次授权后 `domain_events` 各多一条含前后值的记录；尝试 update/delete 该表被拒；审计查看权之外的角色 select 不到。

### 3.2 学期时间轴（你的数据模型里现在没有"时间"）

**现状证据**：`students.grade smallint`（`school_students.sql:14`）是**静态数字**；courses/classrooms/orders/enrollments 全不挂任何学期维度。后果：2026-09-01 全校 grade 同时失真，且"他三年级时的成绩"在数据里无法表达；续费率/课消/招生同比等一切经营指标本是"本学期 vs 上学期"，无学期轴则 P4D-5 续费窗口只能按裸日期硬算；360°档案与未来掌握度模型本质是时间序列，而所有表只答"现在是什么"。

**修法（新 migration）**：
1. `school_terms(id, year smallint, term smallint /*1春 2秋 或按机构*/, name text, starts_on date, ends_on date, is_current boolean)`；单机构多校区留门——预留 `campus_id uuid null`，本期恒空但不写死单校唯一约束。
2. 此后**每张新表**（活动报名、课评、续费窗口、`domain_events`）挂 `term_id`。
3. `grade` 改为可推导：存"入学年份/入学时年级"，当前年级由 `school_terms` 推；或至少建 `student_grade_history(student_id, term_id, grade)` 留痕，避免整体覆盖丢历史。

**验收**：跨学期查询"某生上学期状态/成绩"可表达；新学期切换不改动历史行；报表按 `term_id` 聚合而非裸日期。

### 3.3 内容稳定 uid（学习数据即将和 git 内容耦合）

**现状证据**：terms 71 个概念 MDX、掌握度/作答记录的外键实质是 slug（文件名）。内容是活的：概念会改名、拆分、题目会修订。71 个时改名无所谓；等三年学习数据挂在几百个 slug 上，一次内容重构就是数据迁移灾难。

**修法（内容侧纪律，成本现在≈0）**：
1. 每个概念/题目 frontmatter 加**永不复用**的稳定 `uid`（如 `cn-frac-meaning-01`）；DB 只认 uid 不认 slug。
2. 建 `content_slug_aliases(uid, slug, is_current)` 管改名跳转与旧链接。
3. CI 校验脚本（配合 §3.4 也可）：uid 唯一、不复用、双语齐备。

**验收**：改一个概念文件名，学习数据不受影响、旧 slug 301 到新 slug。

### 3.4 状态机 + migration 追踪（两个小而硬的卫生项）

**状态机**——现状：`students.status`（6 值 check `:16`）、`follow_up_status`（6 值 `:25`）、enrollment（4 值）只约束值合法、**不约束跃迁合法**，DB 拦不住 `alumni→lead`、`lost` 跳过中间态直接 `signed`。修法：合法跃迁集中到 RPC（或 trigger 查一张 `status_transitions` 白名单表），**禁止业务代码裸 `update ... set status`**。趁只有 6 个状态时定，比 20 个状态 10 个写入点时定容易一个数量级。

**migration 追踪**——现状：DB `public` schema 下**无自己的版本表**（只有 supabase 各子系统的），靠"文件名时间戳 + 人肉记得跑没跑"管 30 个 migration，无单一事实源，休假交接/多环境重建时无人答得上库状态。修法：`schema_migrations(version text pk, applied_at timestamptz, checksum text)`，SSH 执行流程里每次自动登记 + 校验文件未被改（把 `CLAUDE.md` 的手动流程升级为带账本的流程）。

**验收**：非法状态跃迁被 RPC/trigger 拒；`schema_migrations` 能回答"这库跑到哪一版、哪些文件被改过"。

---

## 4. P4E-V 业务正确性（跨模块的正确性，非单点 bug）

### 4.1 考勤 ↔ 课消/钱包联动（教培命脉账，现在完全没挂钩）

**现状证据**：`grep ledger|consume|balance` 在 `20260709000700_school_attendance.sql` **零结果**；`account_ledger`/`student_accounts` 在财务模块存在，但与 `session_attendance` 无任何触发关系。点名不自动扣课时，课消要人肉算；预付费课时监管上要求单独管理。等几百条考勤后再补，面对"历史考勤要不要回补扣费"的烂账。

**修法**：点名确认（出勤/请假/旷课）时按规则写 `account_ledger`（出勤扣课时；请假是否扣按 §4.2 补课规则）。先立 `consume_rules` 规则表。此动作同时落 `domain_events`。

**验收**：点名后学生账户课时/余额按规则变动并留一条 ledger + 一条事件；改点名状态产生冲正而非静默改数。

### 4.2 调课/补课/请假实体（现在只有一个 `order.kind='makeup'`）

**现状证据**：补课唯一痕迹是财务 `orders.kind='makeup'`（`school_finance.sql:13`）——把补课建成了**收费事件**，但它首先是**排课事件**；`class_sessions` 层搜不到 reschedule/请假记录（`transfer_student` 转班倒是有，还改过两版）。现实最高频的小学生病假/临时缺课在系统里无处落脚，老师只能记微信。这也让 §4.1 课消规则崩溃——请假扣不扣取决于有没有补课，而补课没有实体。

**修法**：建 `session_changes(session_id, student_id, kind in ('leave','reschedule','makeup'), from_session, to_session, reason, operated_by, term_id)`；请假→补课需求→安排到另一时间/班→对应考勤与课消。补课的"收费"与"排课"解耦：排课走 `session_changes`，收费仍走 order。

**验收**：一次病假可登记→生成补课需求→排到另一节→该次考勤/课消正确对应；报表能查某生本学期请假/补课次数。

### 4.3 学生查重 / 合并（重复档案污染下游）

**现状证据**：`students` 除 `bind_code`、`user_id` 唯一外**无业务唯一约束**；`create_student` 只要名字，phone 默认 `''`（`:139`）——连"手机号唯一"软约束都没有。地推/咨询/试听登记会反复建档（P4D-2 活动域加剧），两个"张三"各挂订单/考勤/成绩后需要**合并**（CRM 最难写、最易错的功能之一）。

**修法**：建档时按手机号/姓名软查重提示（不硬拦，教培同名多）；预留 `student_merges(kept_id, merged_id, operated_by, at)` 合并留痕表 + 合并 RPC（把 merged 的所有关联迁到 kept）。越早有查重，将来合并量越小。

**验收**：录入疑似重复弹提示；合并后 merged 的订单/考勤/跟进全迁到 kept 且留一条合并事件，merged 置 tombstone 不物理删。

### 4.4 广播权威状态服务端对账（承接 2.2-B）

**现状证据**：课堂翻页页码、谁答题、实时评分的事实源在广播消息里（"发出去就没了"），无服务端仲裁者。课堂报告（P4 验收最后一环）聚合这些广播沉淀，若有丢失/冲突则报告错且不可追溯。

**修法**：权威状态除广播外，教师端调 RPC 落库（当前页、评分结果 → `class_sessions` / 评分表），广播只提速、库为最终事实。与 2.2-A 合并交付。

**验收**：断线重连以库为准；课堂报告数据可从库重建、可追溯每次评分的写入事件。

---

## 5. P4E-V 工程可验证性（让已写对的东西不随重构流失）

### 5.1 RLS 越权断言测试网（本层最高优先，是"隐式安全"的唯一守门人）

**论证**：三轮审计中"students 无守卫"是**误报**——`getStudentDetail` 代码里确无应用层校验，真正的行级防线在 `students_select_staff_scope`（`school_students.sql:264`）：`student.view.all` 或（`view.assigned` 且 `assigned_of_student`）。**正确，但隐形**：`.from("students").eq("id",id)` 这行任何 reader 第一眼都判"没做校验"，保护在 100 行外的 migration 里。后果：重构成 security-definer RPC、或新加查询忘走 RLS 路径，水平越权当场重开且 tsc/lint/review 全不报警。审查者也会像我一样误判。**当安全不可见时，唯一守门人是可重复运行、直接对库断言的测试。** 这把"要不要测试"从品味问题抬成架构存续必需。

**修法**：一套用 anon / 错误角色 / 仅 `view.assigned` 角色连库、对每张敏感表跑 select/update/delete **应当被拒**的断言脚本（pgTAP 或复用 SSH psql 跑断言 SQL 批次）。至少覆盖：students 跨归属读、orders 金额篡改、role_permissions 越权写、realtime.messages 学生发权威事件、Storage 跨路径读。纳入"改任何 migration 后必跑"。

**验收**：`view.assigned` 角色拿非名下学生 UUID 断言返回 0 行；anon 读私有笔记/改点赞/传他人 Storage 路径全被拒；脚本一条命令跑完全部越权断言。

### 5.2 类型生成（让重 RPC 架构可维护）

**现状证据**：`transfer_student` 在两个 migration 各定义一次（`create or replace`，`enrollments:211` 与 `p4c_permission_correction:102`），说明 RPC 会反复重定义；前端调用靠参数位置匹配，返回是 any，签名变更 tsc 抓不到。`has_perm(uid,text)` 与 `staff_has_perm(uid,text)` 两个函数并存（`school_rbac.sql:148/163`）——调用点选错哪个也无类型约束。

**修法**：接入 `supabase gen types` 从库 schema 生成 TS 类型，前端对表/RPC 调用受 tsc 约束；生成步骤纳入 migration 后置流程。

**验收**：改一个 RPC 签名/返回列，前端调用点 tsc 报错而非运行时静默错位。

### 5.3 可观测性 + 备份灾备 + 课堂降级（生产存续三件套）

- **备份灾备（最高优先，先于本文一切功能）**：DB 跑在 xiaomi 单机 Docker，一旦有真实学生/订单/收款，单点故障即事故。pg_dump 定时到异机/云 + **恢复演练一次** + Storage 桶备份 + xiaomi 磁盘容量告警（P4D-4 视频会撑爆）。半天量级，插队最前。
- **可观测性**：错误上报（自托管 GlitchTip 或 Sentry）+ 关键 Server Action/RPC 失败日志。现状真实用户出问题只能靠复现。
- **课堂降级预案**：xiaomi 是全校实时教学的单点依赖，重启的 3 分钟 = N 间教室同时卡死的现场事故。P4 有 offline-first 铺垫，但"服务端整个不在"的剧本没演练过。需要：断连时白板/课件退本地继续上课、恢复后补同步；容量摸底（教室数 × 每室连接数）。

**验收**：能从备份完整恢复一次并验证数据一致；关键 RPC 失败进错误看板；拔网模拟服务端消失，课堂能本地续课、恢复后补同步。

---

## 6. P4E-C 合规与身份（不是功能，是运营资格）

### 6.1 手机号/验证码登录（小学生没有邮箱，卡住获客最后一米）

**现状证据**：`(auth)/actions.ts:16` 只有 `signInWithPassword({ email, ... })`。绑码流程完整，但"学生首次登录输入什么"没有答案——小学生无邮箱、半数家长不愿注册邮箱。地推拿到 30 个线索，注册环节流失一半。

**修法**：教师/学辅代建账号（手机号/用户名）+ 家长手机验证码登录。自托管 Supabase 接国内短信网关（GoTrue phone auth + SMS hook）。存量 email 账号双轨过渡——越晚做迁移越难受。**这是独立小期，工程量不小，建议排在 P4D 与 P5 之间。**

**验收**：家长用手机号收验证码登录、绑孩子；存量 email 账号仍可登录；无邮箱路径全程可完成注册→绑码。

### 6.2 未成年人数据合规（PIPL + 备案）

**现状证据**：无隐私政策/同意记录、无账号注销（PIPL 强制权利）、无数据导出；posts 的 `hidden`（`posts_hidden.sql`）只是作者自藏，平台侧对公开 UGC 零审核。你在向 <14 岁儿童收集成绩/行为轨迹/销售跟进，P4D-4 视频含**人脸=生物特征级敏感信息**（PIPL 要求监护人**单独同意**）；notebook 是小学生互发公开 UGC（平台有先审/巡查义务）；另有 ICP/公安备案站点级前提。

**修法**：
1. `guardian_consents(student_id, guardian_id, scope, consented_at, ip_hint)`——绑码时签监护人同意（视频/行为数据单独勾）。
2. 账号注销申请流程（可人工处理，但入口必须有）+ 数据导出。
3. posts 加**平台侧审核状态位**（`review_status`，默认开关可关，先把字段留下）。
4. 隐私政策/儿童个人信息保护规则页 + 备案。

**验收**：绑码流程含单独的视频/数据同意勾选并留记录；注销入口可提交并有处理台账；posts 可被平台侧下架（非仅作者自藏）。

### 6.3 私有存储 + signed URL 基建（P4D-4 视频的前置，现在从零）

**现状证据**：全库仅一处 `getPublicUrl`（notebook `note-assets` **公开**桶，`upload.ts:27`），**无任何 `createSignedUrl`/`expiresIn`**。P4D-4 课后视频含小学生人脸，不能进公开桶（等于把脸挂在可枚举 URL 上）；作业图片流（§4.2 关联）若复用公开桶同样踩雷。

**修法（P4D-4 之前的独立小项）**：私有桶 + 服务端签发 signed URL（**带归属校验**：家长只能签自己孩子的视频）+ 有效期策略 + 防盗链 + 签发落 `domain_events` 审计。顺带复查 `note-assets` 公开桶：约束只放真正可公开的图。

**验收**：私有桶对象无 signed URL 取不到；家长签非自己孩子视频被拒；signed URL 过期后失效；每次签发有审计记录。

---

## 7. P4E-O 组织与家庭维度（必然发生、当前模型答不上来）

### 7.1 员工停用而非删除 + 交接向导

**现状证据**：`staff_role_members` 删行后，TA 名下学生（`students.assigned_to`）、未来课表无批量交接；`created_by` 指向已停用账号页面显示什么无定义（P4D-0 分派是单个操作）。

**修法**：员工"停用（`is_active=false`）而非删除"；交接向导批量改派名下学生/未来课次到接手人，全程落 `domain_events`；历史 `created_by` 保留并在 UI 标"已停用"。

**验收**：停用某员工触发交接清单，改派后其名下无遗留、历史记录仍可读。

### 7.2 代课（临时换教师）

**现状证据**：`class_sessions` 教师若继承自班级，表达不了按次覆盖；工资虽不算，课时统计会错。

**修法**：`class_sessions` 支持按次 `teacher_override`；课时统计按实际到课教师。与 §4.2 `session_changes` 同批设计。

**验收**：某节课临时换人，课表与课时统计归到实际教师。

### 7.3 多监护人差异权限（离异家庭）

**现状证据**：`student_guardians` 是无差别全量可见；离异家庭两位家长都绑码时，谁能看费用/视频无区分——真实家庭纠纷里会变成平台的问题。

**修法**：guardian 加 `scope`（能否看费用/视频/成绩），与 §2.1 家长绑定改造、§6.2 同意记录合并设计——绑定即定 scope，主监护人可调。

**验收**：给定两位不同 scope 的监护人，各自只能看被授权的字段。

---

## 8. 板块 × 加固项影响矩阵（站在整体看：一处横切改动触达哪些模块）

每个横切项都不是孤立补丁，而是穿过多个已完成板块。此矩阵是本文"整体视角"的落点——执行任一项前对照它，确认所有触达面都被覆盖（●=直接改造，○=受益/需回归）。

| 加固项 \ 板块 | 认证auth | 笔记notebook | 游戏games | 教室classroom | 白板whiteboard | 学校school后台 | terms内容 | Storage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3.1 领域事件+审计 | ○ | ○ | ○ | ● | ● | ● 财务/评分/权限 | | ○ |
| 3.2 学期时间轴 | | | ○ 排名周期 | ● 课次归属 | | ● 课程/报名/续费 | | |
| 3.3 内容稳定 uid | | ○ 引用概念 | | ● 课件引用 | | ○ 教学计划 | ● | |
| 3.4 状态机 | | ○ 帖审核态 | | ● 课次态 | | ● 学生/报名态 | | |
| 4.1 考勤↔课消 | | | | ● | | ● 财务钱包 | | |
| 4.2 调课/补课实体 | | | | ● | | ● 排课/考勤/财务 | | |
| 4.4 广播服务端对账 | | | | ● | ● | ● 课堂报告 | | |
| 5.1 RLS 断言网 | ○ | ● | ● | ● | ● | ● 全表 | | ● |
| 5.2 类型生成 | ○ | ○ | ○ | ○ | ○ | ● 重 RPC | | |
| 6.1 手机验证码登录 | ● | | | ○ | | ● 获客 | | |
| 6.2 未成年合规 | ○ | ● UGC审核 | ○ 防沉迷 | | | ● 同意/注销 | | ● |
| 6.3 私有桶+signed URL | | ○ | | ● 课后视频 | | ● 视频/作业图 | | ● |
| 7.x 组织/家庭维度 | ○ | | | ● 代课 | | ● 员工/监护人 | | |

**读法**：一列全是 ○/空 的板块（games、terms）本期基本只需回归；一列多 ● 的板块（classroom、school）是加固重灾区，任务排期时把它们的相关项**尽量合并到同一次改造**，避免同一模块被反复开刀。5.1 RLS 断言网横跨所有 ● 列——它是把整张表焊在一起的那条线。

---

## 9. 任务拆分与排期（与 P4D/P5 交错，非顺序其后）

排期三原则：①安全项不等排期；②"回填成本翻倍"的地基项抢在 P4D 加表前；③合规身份项作为独立小期插在 P4D 与 P5 之间。

| # | 任务 | 触发时机 | 关键验收 |
| --- | --- | --- | --- |
| **P4E-S1** | 备份灾备 + 恢复演练一次 + 磁盘告警 | **立即，先于一切** | 从备份完整恢复并验证一致 |
| **P4E-S2** | 绑码枚举修复（节流+作废+码分离+提熵） | 立即，插当前分支 | §2.1 验收 |
| **P4E-S3** | 教室广播双 topic 分权 + 快照 RPC 化 | 立即，插当前分支 | §2.2 + §2.3 验收 |
| **P4E-F1** | `domain_events` 建表 + 财务/评分/权限三类高危落桩 | **P4D 继续加表前** | §3.1 验收 |
| **P4E-F2** | `school_terms` 学期轴 + grade 历史化；新表挂 term_id | **P4D 加表前**，与 F1 同批 | §3.2 验收 |
| **P4E-F3** | 内容稳定 uid + slug 别名 + CI 校验 | terms 扩量前 | §3.3 验收 |
| **P4E-F4** | 状态机白名单 + `schema_migrations` 追踪表 | 随 F1/F2 | §3.4 验收 |
| **P4E-V1** | RLS 越权断言测试网（覆盖 §8 全部 ● 表） | **F1–F4 落地后立即**，此后改 migration 必跑 | §5.1 验收 |
| **P4E-V2** | `supabase gen types` 接入 | 随 V1 | §5.2 验收 |
| **P4E-V3** | 可观测性 + 课堂降级预案演练 | P4D 中 | §5.3 验收 |
| **P4E-W1** | 考勤↔课消联动 + 调课/补课实体 + 学生查重合并 | **随 P4D-3/P4D-5**（同模块合并开刀） | §4.1/4.2/4.3 验收 |
| **P4E-W2** | 广播权威状态服务端对账（并入 S3-B） | 随 S3 | §4.4 验收 |
| **P4E-C1** | 私有桶 + signed URL 基建 | **P4D-4 视频之前** | §6.3 验收 |
| **P4E-C2** | 未成年合规（同意/注销/导出/UGC审核/备案） | P4D-4 同批 | §6.2 验收 |
| **P4E-C3** | 手机验证码登录 | **P4D 与 P5 之间独立小期** | §6.1 验收 |
| **P4E-O1** | 员工停用+交接 / 代课 / 多监护人 scope | 随 P4D-0/P4D-4 相关面 | §7 验收 |

**与 P4D 的交错点**：F1/F2 必须**先于** P4D 尚未开工的 P4D-2 活动域/P4D-3 课评/P4D-5 续费（它们都要加表，晚挂 term_id/事件就要回填）；C1 必须**先于** P4D-4 视频；W1 与 P4D-3/5 同模块合并；O1 蹭 P4D-0/4 的相关改造面。

---

## 10. 隐含坑清单（本文自身的施工风险）

1. **改 realtime 策略要连带前端**：2.2 双 topic 改 `transports.ts` 订阅逻辑，presence 注册别重复订阅同 topic（该文件注释已有此教训）。
2. **domain_events 落桩别拖慢 RPC**：财务 RPC 已有 5 处 `for update` 行锁，事件 insert 放事务内但保持轻量，别在锁内做重活。
3. **学期轴迁移要回填存量**：现有 students/orders 无 term_id，迁移脚本按现有日期归入对应学期，别留 null 破坏聚合。
4. **RLS 断言网要覆盖 security-definer 绕过面**：definer 函数绕过调用者 RLS，断言不能只测表、还要测每个 definer RPC 内部是否真校验了 `auth.uid()` 对目标行的权属。
5. **手机登录双轨期**：存量 email 账号与新手机账号可能指向同一人，绑定时防重复建 profile。
6. **合规字段先建后用**：review_status/consent/scope 等先加字段（可空、开关默认关），避免阻塞当期功能，再逐步启用。
7. **别把加固做成大重构**：本文全程只加不改已验证正确的模块；任何"顺手重写白板/财务骨架"的冲动都停下来问用户。

## 11. 与既有文档的关系

- 不改 `04-roadmap` 的板块顺序，但**修订其"长期暂缓：消息通知系统"**——领域事件/运营通知回到范围（§3.1 论证），社交向评论/私信仍暂缓。
- 承接并落地 `10-§10`、`11-§10`、`12-§7` 各隐含坑清单中属于横切性质的条目。
- 本文完成后回写 `MEMORY.md`：新增一条"P4E 横切加固计划"指针。
