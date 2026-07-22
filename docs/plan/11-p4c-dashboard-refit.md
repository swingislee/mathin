# Mathin 整体规划 · 11 P4C 后台精装修（角色工作台磁贴化 + 权限矫正 + 缺页补齐）

> 本文是 P4C 的权威执行计划，地位等同 `10-school-backend.md` 之于 P4B。前置阅读：`10-school-backend.md`（数据模型与 RBAC 全部沿用）、`01-design-system.md`（设计 token 纪律不变）。
>
> **背景**：P4B 交付后用户于 2026-07-10 全面试用，结论是「基本功能已实现，但 dashboard 处于毛坯阶段」——没有站在使用者角度考虑每个角色进后台要**做什么**。本文把用户的 10 条反馈翻译成不留发挥空间的施工方案。执行 agent 智能水平有限：**遇到本文没写的决策，停下来问用户，不要自行发挥**；每条任务一次独立提交，提交前 `pnpm lint && pnpm typecheck && pnpm build`（build 前先停掉常驻 dev server，二者共用 `.next`）。
>
> 用户 10 条反馈 → 本文章节的映射：
> ①员工/岗位权限页仍是占位、陈旧开发文案 → §8、§3.4；②总览一屏也出现滚动条、顶栏会滚走 → §3；③视觉过于朴素、关键信息看不清 → §5.4；④右侧标题顶端比左侧导航矮一截 → §3.3；⑤暗色下拉菜单白底 → §3.5;⑥磁贴式可自定义总览 → §5;⑦教师误删课次不可恢复/教师不应移出学生/缺教务、教研角色 → §4、§7;⑧学辅看得见全公司财务/缺跟进工作台 → §4.3、§6;⑨学生页面不应有财务 → §4.5;⑩家长总览布局与其他角色不同 → §5.6。
>
> **§0 是全文的第一优先级**（用户 2026-07-10 追加拍板）：先从"这个人每天进后台要干什么"推需求，再由需求定面板，数据可扩充、需求必须被满足。§5/§6 的磁贴清单与页面规格全部以 §0 为依据；两者冲突时以 §0 为准。
>
> **与 P4I 的关系（2026-07-22 追记）**：本文 §5/§6 引入的 staff 可拖拽磁贴工作台（StaffHome）已被 `19-p4i-final.md`（P4I-17/P4I-19）retired——staff 默认首页改为"今日工作"统一工作投影（doc 19 §6），不再有可自定义磁贴池。§0 的角色需求画像本身（"这个人每天进后台要干什么"）作为方法论仍然成立，也正是 P4I 今日工作沿用的出发点；学生/家长的磁贴工作台（§5.6 起）不受影响，继续保留。权限矫正（§7/§4）与缺页补齐部分已并入后续版本，不再是本文单独维护。

> 方法：对每个身份回答四问——日常工作是什么？打开工作台**第一眼**必须看到什么？每天要在工作台上**操作**什么？现有权限画像是否与身份匹配？每节末尾给「需求 → 面板去处」审计表：✅=P4B 已有、🔧=本期建（标任务号）、🌱=数据待扩充（只建磁贴键位与空态或暂不建，不算本期验收）。

### 0.1 校长 / 主管（principal / director）——经营者：异常驱动，不看流水账

一天：早上到校先问三件事——今天全校多少节课、有没有异常（课没备、时间冲突）；昨天进了多少钱、有没有新线索没人跟；有没有压着我的审批（退费）。日间巡数字：本月应收/实收/欠费、生源漏斗卡在哪一档、哪个班快满该开新班、哪个班快上完该推续费。管理动作：审退费、把线索指派给学辅、抽查课堂报告与备课情况、调整员工岗位。

- **第一眼**：今天全校课表（带异常标注）+ 一排"要我处理"的红数字（待审退费、逾期未跟、欠费订单）。
- **日常操作**：审批退费（财务页）、指派跟进人（学生列表/360°）、授岗调权（员工页）——工作台以"看+跳转"为主，重操作在子页。
- **权限审计**：principal 全键 ✓；director 无 refund.approve、无 permission.configure 是**有意设计**（审钱与配权收口到校长/admin），维持；二者均获新键 enrollment.manage（§4.2）。

| 需求 | 面板 | 状态 |
| --- | --- | --- |
| 今天全校课、有无异常 | todaySchedule 磁贴（行内补未备课红徽章） | ✅+🔧 P4C-5 |
| 本月钱进出与欠费 | financeOverview 磁贴 | ✅ |
| 待审退费压件 | refundQueue 磁贴 | ✅ |
| 逾期没人跟的线索 | statOverdueFollowUps 磁贴 → 学生列表逾期筛选 | ✅ |
| 生源漏斗卡点 | funnel 磁贴 | ✅ |
| 催缴名单（谁欠钱欠多少） | **新磁贴 dueOrders**（§5.6） | 🔧 P4C-5 |
| 快结课班级续费预警 / 满班率 | 磁贴键位留空态，课消口径定了再点亮 | 🌱 |

### 0.2 教务（registrar，新角色）——排课与学籍事务中枢

一天：老师请假→调课改时间；插班生办报名进班、转班退班；新学期批量建班；每天核对"昨天的课点名了没有"（教师忘点名是常态，教务补）；核对花名册错位（收了钱没进教室账号的、进了教室没交钱的）；误删课次去回收站捞。

- **第一眼**：本周全校课表 + 三个待处理计数：**未点名课次、花名册错位、今日冲突**。
- **日常操作**：改时间/补排/软删恢复（班级详情）、报名/转班/退班（花名册）、建班（向导）、代点名。
- **权限审计**：§4.2 新画像（class 全权 + enrollment.manage + student.view.all + schedule.view.all + attendance.mark）与上述完全匹配 ✓；不给 finance（收钱是学辅/前台的事）、不给 followup（不做销售跟进）。

| 需求 | 面板 | 状态 |
| --- | --- | --- |
| 全校周课表与冲突 | schedule 页（冲突标色已有）+ todaySchedule 磁贴 | ✅ |
| 未点名课次清单 | **新磁贴 unmarkedAttendance**：近 7 天已结束但零考勤的课次，直达班级详情点名 | 🔧 P4C-5 |
| 花名册错位全局汇总 | **新磁贴 rosterMismatch**：全校"已报名未绑账号 / 进教室无报名"两计数，点进班级列表（单班明细 P4B 已有） | 🔧 P4C-5 |
| 转班/退班/插班 | RosterPanel（enrollment.manage） | ✅+🔧 P4C-1 |
| 误删恢复 | 回收站（§7） | 🔧 P4C-2 |

### 0.3 教研（research）——课程质量：模板是产品，倒排期是命

一天：编写打磨讲次课件模板；**盯倒排期**——未来一周要开课的课次里模板还是空的有哪些（开课即冻结，过点就来不及）；看课堂报告与教师覆盖层（教师自己插了很多页 = 模板不够用的信号）；启停课程。

- **第一眼**：**「即将开课、模板未备」清单**（比模板总进度紧迫得多）+ 完成度总览。
- **日常操作**：模板编辑器（课程→讲次）、课堂报告。
- **权限审计**：现画像 course.manage + courseware.template.edit + report.view.all ✓；**缺 schedule.view.all**——"哪些课次快开课"要读全校 class_sessions，现 RLS 进不去。**§4.2 增补：research 加 schedule.view.all**（只读课表无写权，合理）。

| 需求 | 面板 | 状态 |
| --- | --- | --- |
| 即将开课未备模板 | **新磁贴 templateUrgent**：未来 7 天课次中 lecture 模板为空的，列课程/讲次/班级/时间，直达模板编辑器 | 🔧 P4C-5 |
| 模板完成度总览 | templateProgress 磁贴 | 🔧 P4C-5 |
| 教师插页反查（模板改进信号） | courseware_overlay 聚合面板 | 🌱 |
| 课堂报告抽查 | report 页 | ✅ |

### 0.4 教师（teacher）——今天的课 + 昨天的作业 + 我班学生

一天：课前看"今天几点、哪个班、什么讲次、课件备好没"，进候课页；上课（P4 链路，不在 dashboard）；课后批改作业、给重点学生写课堂表现跟进；每周备课（覆盖层插页）；关注我班异常学生（连续缺勤、成绩下滑）。

- **第一眼**：**今天的课**（时间、班级、讲次、未备课红标、候课/上课直达）+ **待批改数**。
- **日常操作**：备课、批改、点名、写跟进。
- **权限审计**：§4.2 收缩后（无建班/删课次/花名册）与"教学者"精确匹配 ✓；保留 attendance.mark、followup.write、student.view.assigned。**执行时核实**：students 的 select 策略必须含"我任教班级的学生"分支（teacher_of_student）——2026-07-10 实测教师能看到非名下的本班学生，说明分支存在，P4C-1 收缩时不得误伤。

| 需求 | 面板 | 状态 |
| --- | --- | --- |
| 今天的课与直达 | myTeaching 磁贴 | ✅ |
| 待批改**逐份清单** | **新磁贴 gradingQueue**：我班未批改提交列表（学生/作业/交于何时），每行直达批改页——现状是计数点进班级列表隔两层 | 🔧 P4C-5 |
| 我的班级与进度 | myClasses 磁贴 | ✅ |
| 我班异常学生（缺勤/滑坡） | 磁贴键位留空态 | 🌱 |
| 写课堂表现跟进 | 跟进台 §6（followup.write 者可用，教师导航不置顶） | 🔧 P4C-6 |

### 0.5 学辅 / 销售（sales）——名单驱动：今天该打的电话一个不落

一天：早上拉"今天要跟的名单"（昨天承诺今天回访的、逾期的）；看今天有试听的学生并提醒到课；全天打电话记跟进、推进六档状态；签约就下单收款；月中月末盯自己业绩与**催缴**（我名下欠费单）。

- **第一眼**：**今日待跟 + 逾期名单**（人名可点，不是数字）+ 今日试听提醒。
- **日常操作**：记跟进、改状态、新建线索、下单、收款、催缴——收口在跟进台（§6）+ 360° 费用段。
- **权限审计**：§4.2 收缩后无全量订单 ✓；保留 finance.payment.record（前台收钱场景真实存在）✓；无 scholarship/coupon.manage/refund ✓（用券在下单流程里，建券是管理者的事）；student.assign 保留（学辅间移交线索，RPC 已限只能分给 staff）。

| 需求 | 面板 | 状态 |
| --- | --- | --- |
| 今日待跟/逾期名单（可操作） | 跟进台 §6（统计桶 + 六档分组 + 行内操作） | 🔧 P4C-6 |
| 首屏一眼看到欠账 | followupBoardEntry 磁贴 | 🔧 P4C-5 |
| 今日试听到课 | 跟进台顶部第五桶「今日试听」：trialing 学生今天有课 | 🔧 P4C-6 |
| 我的业绩 | myPerformance 磁贴（键改 order.view **或** order.create） | ✅+🔧 |
| 催缴名单 | **新磁贴 dueOrders**（sales=我名下 / 管理者=全校，同贴双 scope） | 🔧 P4C-5 |
| 签约下单收款 | 360° 费用段 | ✅ |

### 0.6 兼职（part-time）——极简

只上课不参与运营：磁贴池命中 myTeaching + todaySchedule（我的），点名走班级详情。现画像匹配 ✓，无缺口。

### 0.7 学生——别迟到、别漏作业、上课有入口

三个动机：①今天/这周几点上课，**快开课时一键进教室**（把后台当上课门户的核心动线，现状教室卡沉底）；②哪些作业快截止、直达提交页（现状只有数字）；③我学得怎么样（星星、成绩、评语）。财务входа已移除（§4.4，家长管钱）。**注意**：星标聚合 2026-07-10 刚修为 payload 形状，「我的课堂」磁贴直接吃 `get_my_learning_summary` 本人行，不要另写聚合。

| 需求 | 面板 | 状态 |
| --- | --- | --- |
| 下节课 + ≤30min 一键进教室 | mySchedule 磁贴增强：距开课 ≤30 分钟且我是该班成员时显示「进教室」主按钮（schedule 数据需带 classroomId，缺列则补） | 🔧 P4C-7 |
| 待交作业逐份直达 | pendingAssignments 磁贴列最近截止 3 份（作业名+截止+直达），不只计数 | 🔧 P4C-7 |
| 我的课堂表现 | **新磁贴 myStars**：星总数 + 近 30 天出勤率 | 🔧 P4C-7 |
| 成绩/笔记/教室 | 既有三磁贴 | ✅ |

### 0.8 家长——接送、表现、交没交作业、该不该交钱

真实家长就四件事：①**孩子这周什么时候上课**（安排接送，第一需求）；②表现如何（出勤、星星、作业成绩——教师跟进按纪律永不可见，学情摘要即家长版反馈）；③**孩子作业交了没**（催娃，现状完全缺失）；④欠不欠费、交过什么钱。

| 需求 | 面板 | 状态 |
| --- | --- | --- |
| 孩子本周上课时间 | childCard 增强：下次上课外加"本周 N 节：周x时刻…"一行 | 🔧 P4C-7 |
| 出勤/星星/成绩 | childCard + children 详情页 | ✅ |
| **孩子待交作业数** | childCard 增强：`get_my_learning_summary` 扩列 `pending_assignment_count`（孩子有账号时按其 classroom_members 教室算未交未过期；无账号显示"—"） | 🔧 P4C-7 |
| 欠费/缴费记录 | childCard 缴费状态 + finance 页 parent 分支 | ✅ |
| 绑定更多孩子 | bindChild 磁贴 | ✅（磁贴化 P4C-4） |
| 老师课后小结推送给家长 | 依赖"教师课后一键生成家长可见小结"新链路 | 🌱（用户拍板后另立） |

### 0.9 汇总：本节反向修订的施工项（已同步进 §4/§5/§6/§9）

新磁贴 6 张：gradingQueue（教师）、dueOrders（学辅/管理者双 scope）、templateUrgent（教研）、unmarkedAttendance（教务/管理者）、rosterMismatch（教务/管理者）、myStars（学生）；磁贴增强 3 处：mySchedule 进教室按钮、pendingAssignments 列表化、childCard（本周课次+待交作业）；权限增补 1 处：research + schedule.view.all；页面增补 1 处：跟进台加「今日试听」桶；新任务 **P4C-7 顾客侧需求补齐**（§9）。🌱 项一律不算本期验收。

### 0.10 学生生命周期地图与画像补全（2026-07-10 用户二轮拍板；新域施工见 `12-p4d-student-lifecycle.md`）

用户给出完整学生生命周期，需求画像按此再补一层。**每个阶段都可能流失，流失用户也可能回流**——所以"流失"不是终点状态而是一个可运营的池子。

| 阶段 | 主责角色 | 系统对象 | 关键动作 |
| --- | --- | --- | --- |
| 0 获客准备 | 学辅（分区）+ 兼职（地推） | students.region、来源预设 | 学辅按地区分派；地推采集电话名单 |
| 1 初始线索 | 学辅 | students（status=lead，source=地推/转介绍/自然引流/活动） | **批量导入**电话名单、查重、分派跟进人 |
| 2 预约到校活动 | 学辅约、教务/主管办 | **activities / activity_registrations**（体验课 / 1v1 测评 / 三板斧 / 讲座 / 竞赛活动） | 报名活动→follow_up_status 推 invited；到场登记→trialed |
| 3 初次到校与持续跟进 | 学辅 | student_follow_ups（P4C-6 跟进台） | 记跟进、推进六档状态 |
| 4 正式课学习 | 教师主责，学辅同看 | 每课产出：**课上表现多维评价 + 入门考/出门测成绩 + 课堂知识总结 + 作业 + 课后视频**（session_reviews / knowledge_summary / session_videos） | 教师课后逐生记录、**倍速审阅课后视频**、写课堂跟进；学辅可见学情与师家沟通 |
| 5（用户未编号，隐含） 阶段间流失 | 学辅 | status=lost/invalid + 流失池 | 流失原因记跟进；**回流=从流失池一键改回跟进中**，历史留痕 |
| 6 学期结束续费 | 学辅+主管 | 续费窗口（剩余课次≤3 的 active enrollment） | 待续费名单→跟进→place_order 续报新班 |

**画像补全**（在 §0.1–§0.8 之上叠加，不重复已列项）：
- **校长/主管**：+活动转化视角（各类活动的 报名→到场→签约 转化）、续费率。第一眼补"本周活动与到场率"。→ 磁贴 activityToday（P4D-2）、renewalDue 升级为 🔧（P4D-5，取代 §0.1 的 🌱 续费预警）。
- **教务**：+活动的场地/排期主办方；活动管理页的建/改/登记到场是教务与主管的操作面。
- **教研**：+从 session_reviews 的出门测均分反查讲次质量（🌱，数据攒够再建面板）。
- **教师**：课后固定动线变为四步——点名 → **课评（逐生入门考/出门测/三维表现+评语）** → 写课堂知识总结 → **审阅课后视频（倍速）**；第一眼补"待写课评 N、待审视频 N"。→ 课评抽屉、videoQueue/reviewGaps 磁贴（P4D-3/4）。
- **学辅**：+跟进台再加两桶「待续费」「流失池（可一键回流）」（P4D-5）；360°/跟进台可见名下学生的课评摘要与视频审阅结论（"老师和家长的沟通情况"=教师写的 follow_ups，学辅本就可见 ✓）。
- **兼职**：+地推名单录入口（批量导入页对 student.import 持有者开放；是否给兼职该键由管理员在权限矩阵勾选，默认不给——地推名单常由学辅统一录入）。
- **学生**：+课后视频上传入口（课次维度）、看自己的出门测成绩与课评。
- **家长**：+孩子每课的"入门考/出门测/课堂表现/知识总结"卡片（比星星实质得多——这正是"课上表现过于简单"的解）；已审课后视频可回看。

**CRUD/批量缺口审计**（用户二轮反馈第二条）：2026-07-10 核查实锤——`create_student`/`assign_student`/`change_student_status` 三个 RPC 在库但**前端零调用**（新建学生、分配跟进人、状态变更入口全缺，360° 资料区只读）；课程域除模板编辑外**没有任何写 Action**（新建课程/改讲次名/启停均无入口）；班级基础信息（名称/容量/教室）建后不可改。全模块审计表与补齐任务在 `12-p4d-student-lifecycle.md` §5。

## 1. 现状核查结论（2026-07-10，执行前不必重查）

- `/dashboard/staff` 与 `/dashboard/staff/roles` 都只渲染 `SchoolPlaceholderPage`（P4B-0 只交付了 RPC 层：`grant_staff_role`/`revoke_staff_role`/`set_role_permissions`/`admin_set_identity` 均已在库且经过冒烟，页面从未实装）。缺的读侧 RPC（员工列表、按邮箱找人）与自定义角色 CRUD RPC 也不存在。
- 陈旧文案三处（zh/en 同步存在）：`school.home.staffIntro`（"…会随 P4B 后续提交逐步点亮"）、`school.courses.intro`（"…将在后续提交中接入"）、`school.schedule.intro`（"员工按权限看全校或本人任教，学生/家长只看自己/孩子的课"——这是开发者视角的权限说明，不是给用户看的）。`SchoolPlaceholderPage` 复用 staffIntro。
- 布局骨架：`dashboard/layout.tsx` = `min-h-screen flex-col` + `SiteHeader`（普通流内元素，会随页滚走）+ `DashboardShell`（aside `sticky top-6 h-[calc(100dvh-7rem)]`）。aside 的固定高度 + SiteHeader 高度 + 内容 padding 恒大于视口 ⇒ **内容不足一屏时 window 也必然出滚动条**，即用户说的"奇怪的滚动条"。各子页自带 `pt-8` 起头，标题顶端因此比 aside 顶低一截（用户反馈④）。
- 暗色机制：`globals.css` 用 `.dark` 类 + `@media (prefers-color-scheme: dark)` 双轨改 CSS 变量，但**从未声明 `color-scheme`** ⇒ 原生 `<select>` 的下拉弹层由操作系统按 light 渲染（白底浅字，反馈⑤）。裸 `<select>` 共 9 处：AttendanceDrawer、ClassBuildWizard、CouponsPanel、FollowUpForm、RosterPanel、ScheduleWeekView、StudentFinancePanel、courses/page、students/page。
- 现网岗位角色权限（`staff_roles`×`role_permissions` 实测 dump）：
  - **teacher**：attendance.mark, **class.create, class.manage**, class.view.mine, course.view, courseware.overlay.edit, followup.view, followup.write, grading.write, student.view.assigned ⇒ 教师能建班、删课次、报名/转班/退班学生（反馈⑦的根源）。
  - **sales**：finance.order.create, **finance.order.view**, finance.payment.record, followup.view, followup.write, student.assign, student.create, student.edit, student.view.assigned ⇒ `finance.order.view` 在 orders RLS 中放行**全量** select，学辅能看全公司订单（反馈⑧根源）；奖学金键 sales 本来就没有，但 `/dashboard/finance` 页各面板的按键显隐要在 P4C-1 逐一核对。
  - **research 教研已存在**（course.manage/course.view/courseware.template.edit/report.view.all）——用户感觉"缺教研"是因为员工页没实装、无法把这个角色授给任何人；**教务 registrar 确实不存在**，需新增。
- 课次删除：`deleteUnstartedSessionAction` 物理 delete（仅挡已开始的），无恢复路径（反馈⑦）。
- 学生端财务入口：`STUDENT_NAV_ITEMS` 含 finance、student 首屏有「我的费用」卡、`/dashboard/finance` 有 student 只读分支（反馈⑨要求全部拿掉；**家长的保留**）。
- 家长首屏结构（大欢迎卡+绑定码+孩子卡+旧三卡）与 staff 分区结构完全两套（反馈⑩），学生首屏又是第三套——磁贴化后统一（§5.6）。

## 2. 范围与非目标

**做**：§3 外壳固定与全局视觉基线修复；§4 权限矫正（教师收缩、学辅收缩、新增教务角色、报名操作独立权限键、学生去财务）；§5 磁贴式可自定义工作台（全部四类角色统一）；§6 学辅跟进工作台页；§7 课次软删与回收站；§8 员工与岗位权限两页实装。

**不做**（除非用户重启议题）：自由 x/y 坐标摆放磁贴（只做「顺序+尺寸档」，见 §5.1 决策理由）；拖拽改变尺寸（尺寸走档位循环按钮）；磁贴跨用户共享模板/管理员下发布局；看板式拖卡跟进（跟进台是分组列表不是 kanban）；新第三方依赖（拖拽用原生 HTML5 Drag API，不引 dnd-kit）；移动端拖拽排序（编辑态用上移/下移按钮代替）。

## 3. P4C-0 外壳固定 + 全局基线修复（反馈②④⑤ + 文案清理①）

### 3.1 App 框架改造（唯一滚动区 = 主内容）

`src/app/[locale]/dashboard/layout.tsx` 的返回结构改为固定框架：

```tsx
<div className="flex h-dvh flex-col overflow-hidden">
  <div className="shrink-0 border-b border-line"><SiteHeader /></div>
  <div className="mx-auto flex w-full max-w-7xl flex-1 overflow-hidden gap-6 px-4 lg:px-8">
    {/* DashboardShell 内部： */}
    <aside className="hidden w-60 shrink-0 overflow-y-auto py-6 lg:block">…NavList（外层去掉 sticky/h-calc，卡片外观保留：把 rounded-2xl border bg-card 移到 aside 内层 div 上）…</aside>
    <main className="min-w-0 flex-1 overflow-y-auto py-6">{children}</main>
  </div>
</div>
```

要点（每条都是踩过坑的硬约束）：
- `SiteHeader` 本体不改（别的板块还在用），只在 dashboard layout 里包 `shrink-0 border-b` 容器。
- **滚动条只允许出现在 `main` 上**。aside 与 main 都是各自 `overflow-y-auto`，`h-dvh + overflow-hidden` 的外框保证 window 永不滚动。验收脚本断言 `document.documentElement.scrollHeight === document.documentElement.clientHeight`。
- 原 `DashboardShell` 的移动端抽屉逻辑保留；「打开导航」按钮移进 main 顶部第一行（现状就在 children 上方，不动）。
- `h-dvh` 而非 `h-screen`（移动端地址栏收放）；iOS 回弹滚动交给内部滚动区，不需要额外处理。
- main 内容容器不再各页自设 `mx-auto max-w-*`——统一由 §3.3 的页头组件与页面根 div 处理，页面根一律 `<div className="mx-auto w-full max-w-6xl">`（工作台首页用 max-w-7xl，其余 6xl；students/[id] 保持 5xl）。

### 3.2 一屏不滚验收

固定框架完成后，工作台首页在 1440×900 下若磁贴总高不足一屏，main 也不得出现滚动条（`main.scrollHeight === main.clientHeight`）。若超一屏，滚动时**顶栏与左侧导航必须纹丝不动**（Playwright：滚动 main 后 `SiteHeader` 的 boundingBox 不变）。

### 3.3 统一页头组件（反馈④）

新建 `src/features/school/PageHeader.tsx`（服务端组件）：

```tsx
export function SchoolPageHeader({ title, eyebrow, actions, children }: {
  title: string; eyebrow?: string; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div>
        {eyebrow && <p className="text-[11px] uppercase tracking-[0.18em] text-crater">{eyebrow}</p>}
        <h1 className="font-display text-2xl">{title}</h1>
        {children /* 可选副标题行 */}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
```

13 个 dashboard 子页（page.tsx：总览、students、students/[id]、courses、courses/[id]、courses/[id]/lectures/[lectureId]、classes、classes/new、classes/[id]、schedule、finance、assignments、children，外加 staff 两页实装时）全部：删掉自己的 `pt-8` 与手写 h1 区，改用 `SchoolPageHeader`。**页面第一元素即页头**，与 aside 顶部（同为 py-6 起点）严格等高——反馈④的验收就是截图上两者顶边对齐。原「返回学生」这类按钮进 `actions` 槽。

### 3.4 陈旧文案清理（反馈①后半）

- 删除 `src/features/school/PlaceholderPage.tsx`（§8 两页实装后无引用）。
- `school.home.staffIntro` 改为：zh「按你的岗位组织今天的工作。」/ en "Your day, organized by your role."（仅 §5 保底欢迎卡还引用它）。
- `school.courses.intro` 改为：zh「课程 → 讲次 → 课件模板，建班排课都从这里长出来。」/ en "Courses, lectures and courseware templates — classes are built from here."
- `school.schedule.intro` 改为：zh「本周的课都在这里。」/ en "This week's sessions at a glance."（权限切面是行为不是文案，不再向用户解释）。
- 全仓 grep 复查：`逐步点亮|后续提交|按权限看全校` 零命中（zh/en 两文件）。

### 3.5 暗色表单控件修复（反馈⑤）

- `globals.css`：`:root { color-scheme: light; }`；`.dark { color-scheme: dark; }`；`@media (prefers-color-scheme: dark) { :root:not(.light) { color-scheme: dark; } }`——与既有 `.dark`/media 双轨变量机制同构（先确认根类名切换逻辑在 `theme-toggle` 里如何落 `.dark`/`.light`，保持同一套判定）。这一步让原生 select/option/date/time 输入的系统弹层跟随主题。
- 新建 `src/features/school/controls.ts` 导出统一控件类名常量：`export const selectClass = "rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none transition focus:ring-2 focus:ring-moon";`（input 同款 `inputClass` 一并收编）。上列 9 个含裸 `<select>` 的文件全部改用该常量，消灭各处手写的 `bg-transparent`（透明底在暗色卡上叠出脏色）。
- 验收：暗色模式下打开 students 页筛选下拉、点名抽屉四态下拉、建班向导周几选择，截图中弹层为深底浅字。

### 3.6 Dashboard 全宽壳层与创作工作台（2026-07-19 修订）

后台页面以表格、排课、数据看板和编辑工作台为主，统一采用全宽壳层。`DashboardShell` 不再按 pathname 切换 `content / wide / workspace` 三档宽度，也不再把「左侧导航 + 业务内容」锁进居中的 `max-w-*` 容器。桌面端导航固定为 `w-60`，壳层使用整个视口可用宽度，板块切换时导航的横坐标、宽度、外侧内边距和栏间距均保持不变。

主内容区统一解除**页面根节点**既有的 `mx-auto/max-w-*`，列表、表格和编辑器使用导航右侧全部可用空间。若阅读型页面确实需要控制行长，应在页面内部的正文、表单或卡片区设置局部 `max-w-*`，不得再次限制整个页面根容器。

课件页面编辑器仍保留工作台行为，但该识别只负责滚动与高度，不再改变壳层宽度：`/dashboard/courseware/[courseId]/[lectureId]/[pageId]` 占满 Header 以下可用空间，页面列表、舞台和属性区在桌面端各自滚动。

实现约束：

- 外框仍是 `h-dvh + overflow-hidden`；普通页唯一纵向滚动区仍为 main。课件工作台仅在桌面端让三个编辑面板独立滚动，窄屏回退为正常页面滚动，禁止横向溢出。
- 全宽策略只能在 DashboardShell 的 `data-dashboard-content` 作用域内覆盖**页面根节点**的最大宽度，不能全局覆盖 `.mx-auto`，以免影响卡片、对话框和公开板块。
- 课件属性的文字/HTML 输入框固定为紧凑的可控高度；完整结构 JSON 保留在显式的“高级编辑”折叠区，避免 SVG path 把右侧属性面板无限拉长。
- DashboardShell 仍使用既有移动端 Sheet；`< 1280px` 不强制桌面三栏高度，保证触屏滚动与窄视口可用。

验收：在同一桌面视口依次切换总览、学生、课程、财务和课件编辑器，左侧导航的横坐标与宽度完全一致，业务内容均使用导航右侧全部可用宽度；在 1440×900，课件编辑器的页面列表、舞台、属性栏可独立滚动且 Header/导航不移动；在 390px，导航仍由 Sheet 打开且无横向滚动；亮/暗模式均使用现有 paper/card/line token。

## 4. P4C-1 权限矫正（反馈⑦⑧⑨的权限部分）

### 4.1 新权限键 `enrollment.manage`（报名/转班/退班从 class.manage 拆出）

- `src/features/school/permissions.ts` 的 `PERMISSION_KEYS` 增加 `enrollment.manage`（放在 class 域后）。
- migration 内 `create or replace function public.school_permission_keys()` 同步加键（**必须与 TS 常量同一提交**，否则权限矩阵页勾了会被 `set_role_permissions` 整体拒）。
- `enroll_student` / `transfer_student` / `withdraw_student` 三个 RPC：`create or replace`，内部 `has_perm(..., 'class.manage')` 改为 `has_perm(..., 'enrollment.manage')`。`place_order` 内部对报名的调用走 `enroll_student_core`（无权限校验版），不受影响——但 `place_order` 自身的 `finance.order.create` 闸不动。
- TS 侧 `enrollStudentAction`/`transferStudentAndAction`/`withdrawStudentAction`（RosterPanel 调的三个 Server Action）改判 `enrollment.manage`；RosterPanel 的报名/转班/退班按钮按新键显隐（页面向 RosterPanel 传 `canManageEnrollment`）。

### 4.2 岗位角色画像修订（migration 内直接 update 现网数据）

| 角色 | 动作 |
| --- | --- |
| teacher | **删** class.create、class.manage（保留 attendance.mark/class.view.mine/course.view/courseware.overlay.edit/followup.view/followup.write/grading.write/student.view.assigned）。教师从此：不能建班、不能删改课次时间、不能动花名册；仍可备课（覆盖层）、点名、批改、跟进、看自己班。 |
| sales | **删** finance.order.view（保留 order.create/payment.record → orders RLS 自动回落到「created_by=我 或 students.assigned_to=我」的行）。 |
| director | **加** enrollment.manage（主管本就有 class.manage）。 |
| principal | **加** enrollment.manage。 |
| registrar（新增） | 新 `is_system=true` 角色，key=`registrar`，name=教务。画像：class.view.all, class.create, class.manage, **enrollment.manage**, schedule.view.all, student.view.all, student.edit, student.assign, course.view, attendance.mark。（不给 followup/finance/courseware——教务管"班和人进出"，不管钱与课件。） |
| research | **加** schedule.view.all（§0.3：教研要盯"即将开课未备模板"倒排期，需读全校课次；只读无写权）。其余不动——画像已够"检验课程模板"（course.manage + courseware.template.edit + report.view.all）。用户感知的"缺教研"由 §8 员工页实装解决——能把该角色授出去。 |

migration 写法：按 `staff_roles.key` 查 id，`delete from role_permissions where role_id=... and perm_key in (...)` / `insert ... on conflict do nothing`；registrar 用 `insert ... on conflict (key) do nothing` 幂等。**执行后必查**：`select key, string_agg(perm_key...)` 与上表逐行核对。

### 4.3 RLS/页面层随动核查（同一提交内完成）

- 审查 `20260709000500_school_enrollments.sql` 里 class_sessions/enrollments 的 update/delete 策略：若存在「教室 teacher 成员即可写」的放行，收紧为 `can_manage_classroom`（教师失键后 Server Action 已挡，RLS 兜底同步收紧，防直连）。enrollments 的写本来只走 RPC，重点是 class_sessions。
- `/dashboard/finance` 页逐面板核对按键显隐：订单段=order.view **或** order.create（学辅要能看自己经手的单）；RefundQueuePanel=refund.approve；CouponsPanel=coupon.manage；ScholarshipsPanel=scholarship.grant；AccountLookupPanel=account.adjust。验收：sales 登录 finance 页只见「订单」段且列表只有自己经手/名下学生的单；「财务概览」磁贴（finance.report.view）对 sales 不渲染。
- `classes/[id]` 页：改课次时间、删课次、归档班级、批量补排按钮按 class.manage 显隐（教师进入只读视图 + 点名 + 课件链接）。`classes/new` 的 `requirePerm` 已是 class.create，不动。

### 4.4 学生去财务（反馈⑨）

- `nav.ts`：`STUDENT_NAV_ITEMS` 删 finance 项（保留 总览/课表/作业）。
- student 首屏磁贴清单（§5.6）不含费用磁贴。
- `/dashboard/finance` 页：`profile.role === "student"` 直接 `redirect('/{locale}/dashboard')`；**parent 分支保留原只读视图**。
- `get_my_orders`/`get_my_account` RPC 不动（家长仍用；学生调了也只是拿到自己数据，无泄露，不值得为此改 SQL）。
- 验收：student 登录无财务导航项，直输 `/dashboard/finance` 302 回总览；parent 一切照旧。

## 5. P4C-4/5 磁贴式工作台（反馈③⑥⑩，本期核心）

### 5.1 核心决策：只持久化「顺序 + 尺寸档」，位置由密排算法自动生成

> **⚠️ 2026-07-11 三轮拍板改判**：本节的「只存顺序+密排」与 §5.7 的「按钮循环调档」在用户实测后被推翻，新模型见 **§5.8（P4C-4b）**。本节保留作 P4C-4 施工记录。

Win10 磁贴的观感来自"大小混排 + 密排填充"，不来自自由坐标。自由 x/y 需要碰撞检测与空洞管理，超出低智能 agent 可靠交付范围。**拍板**：

- 网格：桌面（lg≥1024）**6 列**，行高 **96px**，gap **12px**；md 4 列；sm 以下单列纵排（span 失效，按顺序渲染，编辑态用上移/下移）。
- 磁贴尺寸档 `s` 取值：`1x1`（统计瓦片）、`2x1`（金额条/入口）、`2x2`（漏斗/孩子卡）、`3x2`（列表卡默认）、`3x3`（长列表）、`6x2`（通栏，如课表周视图缩略）。每种磁贴在注册表里声明 `allowedSizes`（第一个为默认），尺寸按钮在档位间循环。
- 布局引擎：容器 `display:grid; grid-template-columns:repeat(6,1fr); grid-auto-rows:96px; grid-auto-flow:dense;`，磁贴 `grid-column:span w; grid-row:span h`。`dense` 自动回填空洞——这就是"磁铁"效果的全部实现，**零 JS 布局计算**。
- 拖拽 = 重排序（改数组顺序），不是摆坐标。HTML5 Drag API：磁贴编辑态 `draggable`，`dragover` 时计算插入点（目标磁贴中线前/后）画 2px crater 高亮线，drop 后 `splice` 重排。移动端不做拖拽。

### 5.2 数据模型（migration P4C-4）

```sql
create table public.dashboard_layouts (
  user_id uuid primary key references public.profiles on delete cascade,
  tiles jsonb not null default '[]',          -- [{"k":"todaySchedule","s":"3x2"},...]，顺序即排布顺序
  updated_at timestamptz not null default now()
);
alter table public.dashboard_layouts enable row level security;
create policy "layouts_own" on public.dashboard_layouts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.dashboard_layouts to authenticated;
```

Server Action `saveDashboardLayout(tiles)`：requireUser；**服务端校验**每项 `k ∈ TILE_REGISTRY`、`s ∈ 该磁贴 allowedSizes`、数组去重、长度 ≤ 40，非法则整体拒（不信任前端）；upsert 本人行。`resetDashboardLayout()`：delete 本人行。

### 5.3 磁贴注册表与渲染架构

`src/features/school/tiles.ts`：

```ts
export interface TileDef {
  key: string;                       // 稳定机读键
  audience: "staff" | "student" | "parent";   // staff 磁贴再叠 requiredPerm
  requiredPerm?: PermissionKey;
  allowedSizes: TileSize[];          // 首个为默认
  tone?: "crater" | "leaf" | "rose"; // §5.4 洗底
  icon: LucideIcon 名;               // 头部图标
}
export const TILE_REGISTRY: readonly TileDef[] = [ …§5.6 全清单… ];
```

渲染分工（**取数留在服务端，客户端只管布局**）：

- `dashboard/page.tsx`（Server Component）：按身份+权限并行取数（沿用 `safe()`），把每个有权限的磁贴渲染成 `<TileFrame def={…}>{内容 JSX}</TileFrame>`，连同用户 layout（服务端读 `dashboard_layouts` 并按 §5.5 合并）一起传给客户端 `<TileGrid>`。
- `TileGrid.tsx`（"use client"）：接收 `Array<{ key, size, node }>`；普通态按顺序+span 渲染；编辑态（右上「编辑布局」切换）给每格套抓手/尺寸循环/隐藏按钮，完成时调 `saveDashboardLayout`。children 是服务端已渲染好的 ReactNode，**编辑操作不触发重新取数**。
- 隐藏 = 从 tiles 数组移除；编辑态底部有「已隐藏磁贴」行（合并算法给出的"有权限但不在 tiles 里"的项），点击重新追加到末尾。「恢复默认」按钮调 reset。

### 5.4 磁贴视觉规范（反馈③，P4C-5 执行）

保持小王子纸感（01-design-system token，无企业蓝），在此基础上把信息层级立起来：

- **磁贴壳**：`rounded-2xl border border-line bg-card p-4`，头部一行 = 图标（16px，strokeWidth 1.75，色 = tone 色）+ 11px 大写字距眉标签（text-muted）+ 右侧可选跳转箭头（整贴可点时整贴 hover:border-crater/50）。
- **tone 洗底**：沿用 globals.css 既有 `color-mix` 模式新增 `[data-tile-tone]`——`crater`（教学/金额）、`leaf`（正向/完成）、`rose`（逾期/欠费/待办）三档：亮色 `background: color-mix(in srgb, var(--card) 92%, var(--<tone>))`，`.dark` 下 88%。只给**语义强调磁贴**上 tone（逾期待跟进、待审退费、欠费订单 = rose；本月实收、已完成进度 = leaf），常规磁贴保持素卡——全上色就等于没上色。
- **数字**：统计主数 `font-display text-4xl tabular-nums`（1x1 贴内垂直居中），副标签 12px muted；金额统一 `Intl.NumberFormat(locale,{style:'currency',currency:'CNY'})`（替换现存 `¥…toFixed(2)` 手拼）。
- **语义色只做三档**：rose=需要行动、leaf=健康、crater=中性强调；文字对比度亮暗两侧都 ≥ 4.5:1（用既有 token，不新造色值）。
- **列表贴**：行高收紧 `py-2`，主字段 `font-medium`，「未备课」「欠费」等状态一律徽章化（`rounded-full bg-rose/10 px-2 text-xs text-rose`），不再用裸文字。
- **空态**：一句话 + 直达链接按钮（buttonVariants secondary sm），禁止只有一行灰字。
- 验收：亮/暗 × 桌面/移动 四档截图报批；用户反馈③的判据是"关键数字一眼可见"——截图缩略 50% 后统计数与徽章仍可辨认。

### 5.5 布局合并算法（服务端，写死）

```
输入：registry（按定义顺序）、用户 tiles（可能为空/含脏数据）、当前身份+权限
1. eligible = registry 里 audience 匹配且（无 requiredPerm 或 perms 含之）的磁贴键集合
2. result = 用户 tiles 顺序过滤：k ∈ eligible 且 k 未重复；s 不合法则回落该磁贴默认档
3. hidden 集 = eligible − result（供编辑态"已隐藏"行）
4. 用户行不存在（从未自定义）：result = eligible 按【§5.6 角色默认顺序】排列并取默认档
   —— staff 按四种画像给预设顺序，判定取首个命中：isManager=student.view.all（教务 registrar
   画像含之，自然走管理者序）→ 教师=class.view.mine → 教研=course.manage → 其余=学辅序；
   student/parent 各一份固定顺序
5. 输出 result + hidden
```

用户一旦保存过布局，新上线的磁贴会出现在 hidden 集而不是自动插入——**新磁贴不打扰已定制的用户**，这是拍板不是遗漏。

### 5.6 磁贴全清单与默认布局（四类角色统一走磁贴壳，反馈⑩就此消除）

**staff 磁贴池**（audience=staff；沿用 P4B-7 的取数函数，函数不动只换壳）：

| key | requiredPerm | 档位（默认加粗） | 内容 |
| --- | --- | --- | --- |
| statEnrolled / statLeads / statWeekSessions / statOverdueFollowUps | student.view.all | **1x1** | 四个独立磁贴（原统计行拆开，各自可点击跳转；逾期贴 tone=rose） |
| todaySchedule | — | **3x2**/3x3/6x2 | 今日课表（无 schedule.view.all 时标题自动"我的今日课表"） |
| funnel | student.view.all | **2x2**/3x2 | 生源漏斗六档横条 |
| myFollowUps | followup.view | **3x2**/3x3 | 我的待跟进（空且 isManager 时默认隐藏=不进第 4 步默认序，但留在池里可手动加回） |
| myPerformance | finance.order.view **或** finance.order.create | **2x1**/2x2 | 本月业绩（键改为二选一：学辅删掉 order.view 后仍要看自己业绩） |
| myTeaching | class.view.mine | **3x2**/3x3 | 我的课与待办（课件/候课直达链接保留） |
| myClasses | class.view.mine | **3x2** | 我的班级（在读/容量、进度徽章） |
| financeOverview | finance.report.view | **3x2**/6x2 | 财务概览四数 |
| refundQueue | finance.refund.approve | **2x1** | 待审退费（count=0 时自动隐藏；>0 tone=rose） |
| templateProgress | course.manage | **2x2** | **新增**（教研关注焦点）：课件模板完成度——`course_lectures` 中 `courseware_template != '[]'` 的讲次数/总数，按年级分 6 行小条；点击进课程列表。取数 `getTemplateProgress()` 新增于 dashboard.ts |
| templateUrgent | course.manage | **3x2** | **新增**（§0.3 倒排期）：未来 7 天 `class_sessions`（未删、未冻结、lecture_id 非空）中对应 `course_lectures.courseware_template = '[]'` 的课次，列 课程/讲次/班级/开课时间，每行直达 `/dashboard/courses/[id]/lectures/[lectureId]`；空态"未来一周的课模板都已就绪"（leaf tone）。取数 `getTemplateUrgent()` |
| gradingQueue | grading.write | **3x2**/3x3 | **新增**（§0.4）：我任教班级未批改提交清单（学生名/作业名/提交时间，升序取 8），每行直达 `/classroom/[cid]/assignment/[aid]`；>0 时 tone=rose。取数 `getGradingQueue(uid)`（submissions ⋈ assignments ⋈ 我班，graded_at is null and submitted_at not null） |
| dueOrders | finance.order.view **或** finance.order.create | **3x2** | **新增**（§0.1/§0.5 催缴）：欠费订单清单（学生名/欠额=due−已收/下单日），行直达 360° 费用段。scope 由 RLS 天然决定：有 order.view 见全校，仅 order.create 的学辅见自己经手/名下——**同一查询零分支**。取数 `getDueOrders()` |
| unmarkedAttendance | class.view.all | **2x2** | **新增**（§0.2）：近 7 天已结束（ended_at 非空或 scheduled_at+duration < now）且 `session_attendance` 零行的课次，列班级/讲次/时间，直达班级详情；空态 leaf"考勤都齐了"。取数 `getUnmarkedSessions()` |
| rosterMismatch | class.view.all | **1x1**/2x1 | **新增**（§0.2）：全校错位两计数——active enrollment 的学生无 user 绑定或其 user 不在该教室 members；教室 student 成员无 active enrollment。>0 tone=rose，点击进班级列表。取数 `getRosterMismatchCount()`（一次查全量 enrollments+members 在内存对账，量级千行内可接受） |
| followupBoardEntry | followup.write | **2x1** | **新增**：跟进工作台入口贴（§6），"逾期 N · 今日 N"两数，点击进 `/dashboard/followups` |

staff 默认顺序：管理者=stat×4 → todaySchedule → dueOrders → funnel → financeOverview → refundQueue → unmarkedAttendance → rosterMismatch → templateProgress → 其余；教务（registrar 画像 = class.view.all 且无 finance.report.view）走管理者序自然命中课表/未点名/错位贴；教师=myTeaching → gradingQueue → myClasses → todaySchedule → myFollowUps → followupBoardEntry；学辅=followupBoardEntry → myFollowUps → dueOrders → myPerformance → todaySchedule；教研（course.manage 且非 manager）=templateUrgent → templateProgress → todaySchedule（默认序判定顺序：manager > 教师 > 教研 > 学辅，取首个命中画像）。

**student 磁贴池**（audience=student；§0.7 增强项在 P4C-7 落）：mySchedule（**3x2**，下节课+本周；**P4C-7 增强**：距开课 ≤30 分钟且本人是该班 classroom_members 时，显示「进教室」主按钮直达 `/classroom/[id]`——schedule 数据源需带 classroomId，缺列则补）、pendingAssignments（**2x1**，**P4C-7 起列表化**：最近截止 3 份（作业名+截止时间+直达 `/classroom/[cid]/assignment/[aid]`），>0 tone=rose）、myStars（**1x1**，**P4C-7 新增**：星总数+近 30 天出勤率，数据=`get_my_learning_summary` 本人行，勿另写聚合）、myScores（**2x2**，原成绩卡）、myNotes（**2x1**，原笔记卡）、myClassrooms（**2x2**，原教室卡）。默认序即此。**无费用磁贴**（§4.4）。未绑定档案时：网格前显示绑定码卡（固定块不是磁贴），磁贴只出 myScores/myNotes/myClassrooms。

**parent 磁贴池**（audience=parent）：childCard:<student_id>（**动态键**，每孩子一贴，**2x2**/3x2，内容=现孩子卡：下次上课/出勤率/星星/缴费状态/进详情；**P4C-7 增强**（§0.8）：加"本周 N 节：周x HH:mm…"一行与"待交作业 N"一行——`get_my_learning_summary` 扩两列 `week_session_count`（未来 7 天课次数+首两个时刻的展示串在 TS 侧拼）与 `pending_assignment_count`（孩子 user_id 非空时按其 classroom_members 教室算未交且未过期，无账号返回 null 显示"—"），migration `create or replace` 该 RPC）、bindChild（**2x1**，绑定码表单贴，常驻）、myScores/myNotes/myClassrooms 同 student 池。动态键校验：`childCard:` 前缀 + 该家长名下 student_id 集合内（合并算法第 2 步一并校验）。家长首屏从此与其他角色同壳同网格（反馈⑩），大欢迎卡删除，`parentTitle/parentIntro` 文案移到 bindChild 磁贴内一句话。

### 5.7 编辑模式交互细节

- 入口：总览页头 actions 槽「编辑布局」（ghost 按钮，PenLine 图标）。进入后：磁贴 `select-none`、左上抓手（GripVertical）、右上「尺寸循环」按钮（显示当前档 2×2 字样，点击到下一档）与「隐藏」按钮（EyeOff）；页头变为「完成 / 取消 / 恢复默认」三按钮。
- 拖拽只在编辑态启用；`dragstart` 存 key，`dragover` 对命中磁贴按指针在其水平中线前后决定插入位，画 2px crater 竖线指示；`drop` 重排数组。**动画只做 `transition: transform 150ms`（reduced-motion 时关闭）**，不做飞入弹跳。
- 「取消」还原进入编辑前的数组（本地暂存）；「完成」调 saveDashboardLayout 后 `router.refresh()`。
- 磁贴内的链接/按钮在编辑态 `pointer-events-none`（防误触）。

### 5.8 P4C-4b 磁贴交互重做（2026-07-11 三轮拍板；**取代 §5.1 密排模型与 §5.7 循环调档**）

用户实测 P4C-4/5 编辑态后三条反馈：① 小尺寸不能是卡片单纯缩小（内容溢出），要有小格专属内容形态并可点开完整预览；② 点按钮循环调尺寸反直觉，要拖边角；③ 密排回填让落点"随机"、拖动过程看不到其他磁贴如何让位。据此拍板：

**(a) 真二维坐标布局（推翻「只存顺序」）**

- 持久化改 `tiles jsonb = [{"k":<key>,"x":<int>,"y":<int>,"w":<int>,"h":<int>},…]`。表结构不变（同一 jsonb 列），无需 migration；服务端合并算法**兼容读旧 `{k,s}` 条目**——检测到旧格式即按默认铺位算法整体重铺一次，不报错。
- 布局引擎：固定列数（lg 6 列 / md 4 列）无限行网格；磁贴显式 `grid-column: x+1 / span w; grid-row: y+1 / span h`，**不再 `grid-auto-flow: dense`**。
- 拖动/调尺寸的碰撞消解 = **确定性 push**（gridstack 模型）：与移动块重叠的磁贴按 (y,x) 稳定序垂直下推至无重叠（递归）；释放后全体"上浮压实"（每贴尽量上移到不重叠），不留空洞悬浮。拖动中实时预览落位，全程 `transform 150ms` 过渡（reduced-motion 关闭）。
- **push+压实写成纯函数模块，服务端与客户端共用**，防两端结果漂移。服务端合并仍是安全边界：越权/脏键丢弃、w/h 钳到该贴 allowedSizes 最近档、x 钳到 `[0, cols−w]`、重叠用同一例程消解。
- 移动端（sm 单列）：按 (y,x) 排序纵排；编辑态仍用上移/下移按钮（交换纵向次序），不做拖拽。

**(b) 拖边角+档位吸附调尺寸（推翻循环按钮）**

- 编辑态磁贴右下角出 resize 抓手（右边缘/下边缘同样可拖），Pointer Events 实现；拖动中把指针拉出的宽高映射到该贴 `allowedSizes` 中**最近档**，画 dashed crater 虚影吸附，释放落档。
- `TILE_SIZES` 扩纵向档：增 `1x2`、`1x3`、`3x1`、`2x3`（按贴配置，不强制全量）。

**(c) 分档内容模板（新增，反馈①）**

- 每贴按当前档归入三形态：`minimal`（1x1：图标+单关键数）、`compact`（宽或高为 1 且面积 ≤3：关键数+一行摘要）、`full`（其余：现完整卡体）。
- Server Component 同一次取数把三形态全部渲出传给客户端，客户端按当前档切换显示——调档零服务端往返，**绝不缩放裁剪**。
- 每贴加「放大」按钮（Maximize2，非编辑态可用）：Dialog 弹出该贴 full 形态 + 底部直达链接。
- minimal 关键数拍板：列表类贴（todaySchedule/myFollowUps/gradingQueue/dueOrders/templateUrgent/unmarkedAttendance/followupBoardEntry 等）=条数；金额类（financeOverview/myPerformance）=首要金额；funnel=线索总数；childCard=下次上课时间；其余取各自最显著单数。compact=关键数+首行内容。

**P4C-4b 验收**：拖动时其他磁贴实时让位、释放无重叠无空洞、刷新位置一致；拖角调档虚影吸附、落档切形态无溢出；塞脏 jsonb（越权键/越界坐标/非法档/重叠）服务端全消解；旧 `{k,s}` 数据自动重铺不报错；放大弹窗可用；移动端上移/下移仍可用；亮/暗 × 桌面/移动截图报批。

## 6. P4C-6 学辅跟进工作台 `/dashboard/followups`（反馈⑧后半）

学辅的日常不是看总览，是**沿生命周期推学生**。新页面（nav 项 `followups`，labelKey=followups，requiredPerm=`followup.view`，插在 students 之前；学辅默认导航序：总览/跟进/学生/课表/财务）：

- **页头 actions**：新建学生按钮（student.create）——**注意：现库并无任何新建学生 UI（create_student RPC 从未被前端调用），本任务需自带一个简版弹窗**（姓名必填 + 电话/年级/来源/备注，调 create_student；完整版含地区/家长文本/批量导入在 P4D-0）；「全部/我名下」切换（仅 student.view.all 持有者显示，searchParams `scope=all|mine`，默认 mine）。
- **顶部五贴统计行**（点击=下方列表过滤，searchParams `bucket=`）：逾期（next_follow_up_at < now，rose）/ 今日（next 在今天内）/ 本周 / 未安排（next is null 且 status 未到 signed/lost）/ **今日试听**（§0.5：status='trialing' 且其 active enrollment 班级今天有未删课次——提醒到课回访，试听后当天必跟）。
- **主体：按 follow_up_status 六档分组列表**（pending→lost 顺序；不做拖拽看板）。每组一张卡，组头=状态名+计数；组内每行：姓名（链接 360°）· 年级 · 学生状态徽章 · 最后跟进时间 · 下次跟进时间（逾期红）· 最近一条跟进摘要（truncate 单行）+ 行尾快捷动作：
  - 「记跟进」：Dialog 弹出复用 `FollowUpForm`（传 studentId，成功后 refresh）；
  - 「改状态」：下拉直调 `change_student_status` RPC 的 Server Action（新增 `changeStudentStatusAction`，判 student.edit）；
  - （有 finance.order.create）「下单」：链接到 `/dashboard/students/<id>#finance`。
- 数据层 `src/features/school/followups.ts`：`listFollowUpBoard(scope, bucket?)` 一次查 students（RLS 自然收窄）+ 每生最近一条 follow_up（`student_follow_ups` 按 student_id in (...) 取 created_at desc 去重，先查学生页 20 条分页再查跟进，别 N+1）。分页每组内折叠显示前 8 行 +「展开全部」。
- 验收：学辅登录默认只见名下学生；逾期学生行红色徽章；记跟进后行内最后跟进时间即时更新；主管切「全部」能见全校；无 followup.view 的账号直输 URL 302。

## 7. P4C-2 课次软删与回收站（反馈⑦前半）

- migration：`alter table class_sessions add column deleted_at timestamptz;`＋`create index class_sessions_alive_idx on class_sessions (classroom_id) where deleted_at is null;`
- `deleteUnstartedSessionAction` 改为 `update set deleted_at = now() where id=… and started_at is null and deleted_at is null`（权限仍 class.manage——P4C-1 后教师已无此键，等于**只有教务/主管/校长/admin 能删**，双保险）。新增 `restoreSessionAction(sessionId)`：同权限，`update set deleted_at = null`。
- **过滤清单**（所有读课次的地方补 `deleted_at is null`，逐个核对）：TS 直查——`classes.ts listClassSessions`、`dashboard.ts getTodaySchedule/getMyTeachingCard/getMyClassroomCards(嵌套 class_sessions)/getStaffStats(weekSession 计数)`、`actions.ts getWeekSchedule(staff 分支)`、`students.ts getStudentLearning(未来课次)`、classroom feature 的课次列表/候课/live/report 取数；SQL RPC——`get_my_schedule`、`get_my_attendance`、`get_my_learning_summary`（下次上课子查询）三个 `create or replace` 补 where。
- 班级详情页课次列表尾部加「回收站」折叠区（仅 class.manage 可见）：列 deleted_at 非空的课次（讲次号/标题/原时间/删除时间）+「恢复」按钮。恢复后回原位（排序按 scheduled_at，天然归位）。
- **不做**定时清理/彻底删除——回收站永存，量级可忽略。
- 验收：删→列表消失、课表消失、学生端 RPC 不返回；回收站可见并恢复；已开始课次删除仍被拒；教师账号看不到删除按钮且直调 action 被 FORBIDDEN。

## 8. P4C-3 员工与岗位权限两页实装（反馈①⑦的角色可用性）

### 8.1 migration：补读侧与角色 CRUD RPC（全部 security definer + `set search_path = public, pg_temp` + revoke from public, anon, authenticated 后按需 grant execute to authenticated）

```sql
list_staff_members()          -- has_perm('staff.manage')；returns table(user_id uuid, display_name text,
                              --   email text, identity text, role_ids uuid[], role_names text[])
                              --   —— profiles(role in ('staff','admin')) join auth.users(email) 左联 staff_role_members
find_profile_by_email(p text) -- has_perm('staff.manage')；按 auth.users.email 精确匹配返回
                              --   (user_id, display_name, identity)；查无返回空行集。邮箱不落日志。
create_staff_role(p_name)     -- has_perm('permission.configure')；key = 'custom_' || 8位随机串，is_system=false
rename_staff_role(role_id, p_name)   -- 同上；system 角色也可改名（种子名只是默认）
delete_staff_role(role_id)    -- 同上；仅 is_system=false；有成员则拒（提示先移除成员），不做级联
```

### 8.2 `/dashboard/staff`（requirePerm staff.manage，现骨架替换）

- 员工表：姓名 / 邮箱 / 身份（admin 徽章金色、staff 素）/ 岗位角色徽章串；行尾「管理岗位」弹窗——checkbox 列出全部 staff_roles，勾选差异逐个调 grant_staff_role/revoke_staff_role（RPC 已有防提权守卫：不能操作自己、非 admin 不能授含 permission.configure 的角色——**前端不重复实现，失败 toast 显示服务端错误码翻译**）。
- 「添加员工」区：邮箱输入 → `find_profile_by_email` → 命中显示姓名+当前身份；若 identity 是 student/parent，显示「提升为员工」按钮（调 `admin_set_identity(target,'staff')`，**该按钮仅 admin 可见**——RPC 本身仅 admin）；已是 staff 则直接进入授岗弹窗。
- 空态与错误文案全进 `school.staff.*` 命名空间（zh/en）。

### 8.3 `/dashboard/staff/roles`（requirePerm permission.configure）

- 左列：角色列表（名称 + 成员数 + is_system 锁标）；底部「新建角色」（名称输入→create_staff_role）；自定义角色行尾改名/删除。
- 右侧：选中角色的权限矩阵——按 PERMISSION_KEYS 的域分组（student/followup/course/courseware/class/enrollment/schedule/attendance/grading/report/finance/staff/permission 各一小节，节标题走 i18n `school.roles.domain_*`），checkbox 全量勾选，「保存」一次性调 set_role_permissions（覆盖式）。保存后 toast + 重查。
- 「permission.configure」这个键的 checkbox 对非 admin 调用者禁用置灰（提示"仅系统管理员可授"——服务端 RPC 反正会拒，这里只是体验）。
- 验收（沿 P4B-0 验收补跑当时跳过的 UI 部分）：admin 把 test-student 临时提为 staff 并授「教师」→ 其总览出现教学磁贴；给「教师」勾 student.view.all → 该账号立即能进学生列表；非 admin 员工授含 permission.configure 的角色被拒且 UI 报错清晰；测完把 test-student 还原（`admin_set_identity` 回 student + 撤岗），**固定测试账号不留污染**。

## 9. 任务拆分（每条 = 一次提交；视觉节点截图亮/暗 × 桌面/移动报批）

| # | 内容 | 关键验收 |
| --- | --- | --- |
| **P4C-0** | §3 全部：h-dvh 固定框架、SchoolPageHeader + 13 页接入、color-scheme + selectClass 统一、文案清理、删 PlaceholderPage 之前先把 staff 两页临时改成 `notFound()`?——**不**：占位页保留到 P4C-3，但 intro 文案换成"建设中，管理员请从数据库授岗"字样的专用 key | window 永不滚动；顶栏/侧栏滚动不动；标题与侧栏顶对齐；暗色下拉深底；grep 陈旧文案零命中 |
| **P4C-1** | §4 全部：enrollment.manage、画像修订 migration（含 registrar）、RPC/Action/RLS 随动、finance 页面板门控核对、学生去财务 | teacher 无删课次/花名册按钮且直调被拒；sales 只见自己经手订单；registrar 可建班转学生；student 无财务入口 |
| **P4C-2** | §7 软删+回收站（含三个 get_my_* RPC 过滤重建） | 删→各端消失；恢复归位；教师不可删 |
| **P4C-3** | §8 员工/岗位权限两页 + 5 个新 RPC | §8.3 验收全过；测试账号复原 |
| **P4C-4** | §5.1-5.3+5.5-5.7 磁贴基建：dashboard_layouts 表、TILE_REGISTRY、TileGrid（拖拽/尺寸/隐藏/恢复默认）、四角色首屏全部迁入磁贴壳（视觉先沿旧卡样式） | 拖拽重排持久化、刷新保留；无权限磁贴永不渲染（改 tiles jsonb 塞键也被服务端过滤）；家长与学生同壳；移动端上移/下移可用 |
| **P4C-5** | §5.4 视觉升级 + §0 反推的 staff 新磁贴七张：templateProgress、templateUrgent、gradingQueue、dueOrders、unmarkedAttendance、rosterMismatch、followupBoardEntry（各自取数函数见 §5.6，全部 `safe()` 包裹） | 四档截图报批；缩略 50% 关键数字可辨；教研账号见倒排期贴、教师账号见批改清单直达批改页、学辅 dueOrders 只见名下、教务见未点名/错位计数且数字与 SQL 手查一致 |
| **P4C-6** | §6 跟进工作台页（含「今日试听」桶） | §6 验收全过 |
| **P4C-4b** | §5.8 磁贴交互重做：真二维坐标+确定性 push、拖边角档位吸附、minimal/compact/full 分档内容模板+放大弹窗（2026-07-11 三轮拍板插队，在 P4C-6 后、P4C-7 前执行） | §5.8 验收全过 |
| **P4C-7** | §0.7/§0.8 顾客侧补齐：mySchedule「进教室」按钮、pendingAssignments 列表化、myStars 磁贴、childCard 增强 + `get_my_learning_summary` 扩 `week_session_count`/`pending_assignment_count` 两列（migration） | 学生开课前 30 分钟内首屏一键进教室；待交作业行直达提交页；家长孩子卡见本周课次与待交作业数；无账号孩子显示"—"不报错 |

顺序理由：P4C-0 是所有后续页面的地基；权限矫正（1）先于一切新 UI（新页面按新键建）；磁贴基建（4）与视觉（5）拆开，防止一次提交过大；跟进台（6）依赖 1 的权限收缩与 0 的外壳。

## 10. 隐含坑清单（10-§10 全部继续有效，以下为本期新增）

**外壳层**
- `overflow-hidden` 外框内**不能再用 `position: sticky`**（祖先裁剪后 sticky 失效且表现诡异）——aside 去 sticky 是必须项，别"保险起见"留着。
- 嵌套滚动容器里的 Radix Dialog/Popover 默认 portal 到 body，不受影响；但 ScheduleWeekView 若有内部横向滚动，确认其在新框架里仍可横滚（main 是纵向滚动，横滚在子容器）。
- `h-dvh` 在旧 Safari 缺失时回落：`h-screen` 兜底类并列写（`h-screen h-dvh` 顺序即可）。
- 各页删 `pt-8` 时注意 `classes/[id]` 等页面里嵌套的二级区块间距是相对页头的，逐页截图核对，不要全局 sed。

**权限层**
- `school_permission_keys()` 与 TS `PERMISSION_KEYS` 必须同一提交同步加 `enrollment.manage`，且**先跑 migration 再部署前端**（顺序反了权限矩阵页保存会整体被拒）。
- teacher 收缩后，**现网已有的 teacher 岗位成员立即失去建班/花名册能力**——这是有意为之（用户拍板），但要在提交信息里写明影响面；测试教师账号的既有班级不受影响（owner 仍是他，classroom RLS 的 owner 权与岗位权限键是两回事，课堂上课链路照常）。
- `create or replace` 改 RPC 权限键时，函数体里可能有多处 has_perm 调用（transfer 里 from/to 两侧），全部替换。
- RosterPanel 等客户端组件的按钮显隐是体验，Server Action 的键判定才是安全——两处都改，缺一不可。

**磁贴层**
- tiles jsonb 是**用户可写表**：服务端合并算法就是安全边界，`k` 不在 registry / 无权限 / `s` 非法都必须静默丢弃或回落，绝不能把用户 jsonb 直接 map 成组件（防注入与防越权探测）。
- 动态键 `childCard:<uuid>` 校验要查 `student_guardians`，别只校验 uuid 形状。
- HTML5 Drag API 在触屏上不可用——移动端隐藏抓手、显示上移/下移，这是设计不是缺陷；`dragover` 里必须 `preventDefault()` 否则 drop 不触发。
- 编辑态磁贴内容 `pointer-events-none` 记得在退出时移除；Dialog 类磁贴内容（如绑定码表单）在编辑态可能吞 focus，统一用遮罩层盖住磁贴内容而不是逐元素禁用。
- `grid-auto-flow: dense` 会让 DOM 顺序 ≠ 视觉顺序（回填），屏幕阅读器按 DOM 序读——可接受（内容互相独立），但 tab 焦点序也随 DOM，编辑态的上移/下移按钮操作的是数组序，两者一致，无需额外处理。
- 服务端渲染的磁贴内容传入客户端 TileGrid 是 ReactNode props——**TileGrid 不能是 async 组件**，且内容里的 Server Action 引用照常可用（React 序列化边界允许），但别在 TileGrid 里 cloneElement 改内容。

**§0 新磁贴数据层**
- `getDueOrders` 的欠额 = `amount_due − sum(payments.amount)`（PostgREST 嵌套 payments 后 TS 求和），别只看 `orders.status`；scope 完全交给 RLS（有 order.view 见全校、否则自己经手/名下），函数体**零权限分支**、必须用调用者身份的 server client（绝不用 service key）。
- `getRosterMismatchCount` 一次取全量 active enrollments（student_id,classroom_id,students.user_id）与 classroom_members(role='student') 两个数组在内存对账，千行量级没问题；**不许写成按班级循环的 N+1**。
- `getTemplateUrgent`：PostgREST 不支持函数过滤，先查未来 7 天课次（`deleted_at is null`、`courseware_frozen_at is null`、`lecture_id not null`），再 `in()` 取对应 `course_lectures` 的 `id,courseware_template`，TS 侧 `Array.isArray(t) && t.length === 0` 判空模板。
- `getUnmarkedSessions` 的"已结束"判定：`ended_at` 非空 **或** `scheduled_at + duration_min` 已过（duration 可空按 0 处理）；考勤有无用 `session_attendance` 按 session_id 计数一次查回 Set 对账，同样禁 N+1。
- **`get_my_learning_summary` 扩返回列必须先 `drop function` 再 `create`**——`create or replace` 不允许更改 returns table 列集，直接跑会报错；drop 与 create 在同一 migration 事务内，TS 调用方（customer.ts 类型）同一提交更新。`pending_assignment_count` 对无账号孩子返回 null（TS 显示"—"），别返回 0（0 是"都交了"，语义完全不同）。
- 学生「进教室」按钮的显示条件是 **classroom_members 成员**（账号维度，上课权限），不是 enrollment（教务事实）——两者按 10-§4.2 是解耦的；课表数据若缺 classroomId 列，补列时同步核对 `get_my_schedule` RPC 的 returns table（改列集同样要 drop 重建）。

**软删层**
- 过滤条件漏一处就是"幽灵课次"：§7 的过滤清单是穷举，执行时以 `grep -rn "class_sessions" src supabase/migrations` 的全部读路径为准逐一勾对，别只改清单里想起来的。
- 候课/上课页按 sessionId 直达：已删课次直接 `notFound()`（getSession 过滤后自然 404），不需要特判。
- `enrollments_one_active` 唯一约束与软删无关（那是报名不是课次），别顺手"统一"。

**员工页层**
- `auth.users` 只能在 security definer SQL 里读，返回列白名单只有 email——不要 `returns setof auth.users`。
- `find_profile_by_email` 用精确匹配不用 ilike（防枚举撞库）；输入邮箱不写日志、不进 URL（POST/Server Action 体）。
- 提升身份按钮双闸：UI 只对 admin 显示 + RPC 本身仅 admin——有 staff.manage 的主管只能给**已是 staff** 的人授岗。
- 测试账号纪律：验收中对固定账号的任何身份/岗位改动，验收完必须复原（`.claude/test-accounts.local.md` 是唯一事实源，改了要同步记录）。

## 11. 与既有文档的关系

- `04-roadmap.md`：P4B 之后插入 P4C 段（随本文提交修订）；P5 继续顺延。
- `10-school-backend.md`：§3.2 内置角色表增加 registrar 教务行、teacher/sales 画像以本文 §4.2 为准；§3.3 权限键清单增加 `enrollment.manage`；§7 首屏规格被本文 §5 磁贴制取代。该文其余（数据模型/RLS/财务）全部继续有效，不回改原文，本文为增量修订层。
- P4B 交付时的已知遗留（404 页品牌化、点名预填不认教师发星、865 讲模板为空）不在 P4C 范围，留待用户单独拍板。
