# Mathin 整体规划 · 12 P4D 学生生命周期深化（获客活动 + 课堂多维记录 + 课后视频 + 续费流失 + 全模块 CRUD 补齐）

> 本文是 P4D 的权威执行计划，承接 `11-p4c-dashboard-refit.md`（P4C 精装修）：**P4C 全部完成后再开工 P4D**。前置阅读：`10-school-backend.md`（数据模型/RBAC 底座）、`11-…md` §0（角色需求画像，尤其 §0.10 生命周期地图——本文就是它的施工层）。执行纪律同前：遇到本文没写的决策停下来问用户；每条任务一次提交；提交前 lint/typecheck/build（先停 dev server）。
>
> 源头（用户 2026-07-10 二轮拍板）：一、完整学生生命周期 0 获客 → 1 线索 → 2 到校活动 → 3 持续跟进 → 4 正式课（每课产出多维记录+课后视频）→ 6 续费，每阶段可流失、流失可回流；二、各数据板块普遍缺少「新建/修改/删除/回收」与批量入口，权限需随之规整。

## 1. 范围与非目标

**做**：①学生域 CRUD 与批量导入补齐（含软删回收站、地区/来源字段）；②活动域（体验课/1v1 测评/三板斧/讲座/竞赛活动的建档、报名、到场登记、与跟进状态联动）；③课堂多维记录（入门考/出门测成绩、三维课上表现、课堂知识总结）；④课后视频（学生上传、教师**倍速**审阅、家长回看）；⑤续费窗口与流失池（含回流）；⑥课程域/班级域 CRUD 补齐；⑦以上全部的权限键规整与顾客侧白名单扩展。

**不做**（除非用户重启议题）：短信/微信/推送通知（到课提醒等靠人看名单打电话）；在线支付；视频转码/剪辑/AI 分析（原样存原样播，倍速是播放器能力）；营销装修类工具（拼团/砍价等，10-§2 排除项不变）；活动签到硬件（扫码/闸机）；自动流失判定（流失是人工标记）。**财务表与跟进时间线维持 append-only 纪律**——不提供改/删入口，改错用冲正（财务）或补记更正（跟进），这是设计不是缺口（§5 审计表如此声明）。

## 2. 权限键增补与角色画像修订

`PERMISSION_KEYS` 新增 6 键（`school_permission_keys()` SQL 同一 migration 同步，老规矩：先跑 migration 再部署前端）：

```
activity.manage      // 建/改/软删活动场次
activity.register    // 给作用域内学生报名活动、登记到场/爽约、填现场结论
review.write         // 课评（入门考/出门测/三维表现/评语）与课堂知识总结的写
video.review         // 审阅课后视频（评语/评分/标记已审）
student.import       // 批量导入学生线索
student.delete       // 软删学生（进回收站）与恢复
```

角色画像增补（migration 内按 key 定位 update，全部 `on conflict do nothing` 幂等；P4C-1 修订后的画像为基线）：

| 角色 | 新增 |
| --- | --- |
| principal | 全部 6 键 |
| director | activity.manage, activity.register, review.write, video.review, student.import |
| registrar 教务 | activity.manage, activity.register, student.import, student.delete |
| teacher | review.write, video.review |
| sales 学辅 | activity.register, student.import |
| research 教研 | （无——出门测质量反查是 🌱 面板，用既有 report.view.all 读） |
| part_time 兼职 | （默认无；地推名单录入是否给 student.import 由管理员在矩阵里勾，见 11-§0.10） |

admin 恒真不变。学生上传视频、学生/家长看课评**不走权限键**（顾客侧，靠 RLS 本人/孩子作用域 + 白名单 RPC，10-§3.4 纪律）。

## 3. 数据模型（migrations，SSH 执行，全部 RLS + 03-§3 通用约定）

### 3.1 学生域扩展（P4D-0）

```sql
alter table public.students
  add column region text not null default '',        -- 地区/校区片区（自由文本+前端预设 datalist，不建表）
  add column deleted_at timestamptz;                  -- 软删；线索误录/重复合并后的归宿
-- source 列已存在；前端改为预设 datalist：地推 / 转介绍 / 自然引流 / 活动 / 其他（存文本，不加约束）
create index students_region_idx on public.students (region) where deleted_at is null;

-- RPC
create_student(...)      -- 已存在；create or replace 加 p_region/p_source/p_parent_name/p_parent_phone/p_remark 参数
                         --   （改参数签名必须 drop 旧签名再 create，旧签名 revoke 记录一并迁移）
import_students(rows jsonb)  -- has_perm('student.import')；单事务逐行：
                         --   {name*, phone, grade, region, source, remark}；name 空→计入 errors；
                         --   phone 非空且已存在同 phone 未删学生→跳过计 dup；插入行 status='lead'、
                         --   assigned_to=调用者（学辅自录自跟；管理员导入后再分派）、bind_code 服务端生成；
                         --   返回 jsonb {inserted, dup, errors:[{row,reason}]}；≤500 行/次，超限整体拒
soft_delete_student(id) / restore_student(id)  -- has_perm('student.delete')；置/清 deleted_at；
                         --   已有 active enrollment 的学生拒删（提示先退班）
```

**软删过滤清单**（`deleted_at is null` 逐处补，漏一处=幽灵学生）：students 列表页查询、`searchStudentsForEnroll`/`searchStudentsForFinance`、跟进台 `listFollowUpBoard`、漏斗与统计 `getStaffStats`/`getFollowUpFunnel`/`getMyOverdueFollowUps`、`get_my_students`/`get_my_learning_summary`（RPC drop 重建）、rosterMismatch/dueOrders 取数、360° `getStudentDetail`（已删显示回收站横幅+恢复按钮而非 404，student.delete 持有者可见）。RLS 不改（软删是业务过滤不是权限）。

### 3.2 活动域（P4D-2）

```sql
activities (
  id uuid pk, kind text not null check (kind in ('trial_class','assessment_1v1','sanbanfu','lecture','competition')),
  title text not null, scheduled_at timestamptz not null, duration_min smallint,
  location text not null default '', capacity smallint,           -- 可空=不限
  remark text not null default '',
  created_by uuid references profiles, created_at, deleted_at timestamptz   -- 软删
)
activity_registrations (
  id uuid pk, activity_id uuid not null references activities on delete cascade,
  student_id uuid not null references students on delete cascade,
  status text not null default 'booked' check (status in ('booked','attended','no_show','cancelled')),
  outcome text not null default '',                                -- 现场结论：测评结果/意向度，自由文本
  operated_by uuid references profiles, created_at, updated_at,
  unique (activity_id, student_id)
)
-- RLS：admin 全权；staff select = is_staff（活动是内部运营日历，全员工可见）；
--      写全走 RPC，表级不授 insert/update/delete；student/parent 无任何读（不向顾客暴露运营数据）
-- RPC（security definer）：
--   create_activity/update_activity/delete_activity(软删)   has_perm('activity.manage')
--   book_activity(activity_id, student_id)     has_perm('activity.register') 且 can_access_student；
--       容量校验（booked+attended < capacity，否则拒）；upsert registration(status='booked')；
--       学生 follow_up_status ∈ (pending,following) → 置 invited；写一条 follow_ups(kind='activity',
--       content='报名活动：'||title)——kinds check 约束需 drop+add 加 'activity'
--   mark_activity_result(registration_id, status, outcome)  has_perm('activity.register')；
--       status='attended' 且 activities.kind in ('trial_class','assessment_1v1','sanbanfu')
--       且学生 follow_up_status ∈ (pending,following,invited) → 置 trialed；
--       no_show 不自动降状态（人工判断），一律写 follow_ups 留痕
```

### 3.3 课堂多维记录（P4D-3）

```sql
alter table public.class_sessions add column knowledge_summary text not null default '';  -- 课堂知识总结（每课一份，教师课后写）

session_reviews (
  session_id uuid references class_sessions on delete cascade,
  student_id uuid references students on delete cascade,
  entry_score numeric(5,1),  exit_score numeric(5,1),      -- 入门考/出门测，可空=未考；0-100 由前端约束、服务端 check (between 0 and 100)
  focus smallint check (focus between 1 and 5),            -- 专注度
  participation smallint check (participation between 1 and 5),  -- 参与度
  mastery smallint check (mastery between 1 and 5),        -- 掌握度
  comment text not null default '',
  created_by uuid references profiles, updated_at timestamptz not null default now(),
  primary key (session_id, student_id)
)
-- 辅助 can_review_session(cid, uid) = has_perm('review.write') and (is_classroom_teacher or can_manage_classroom)
--   —— 照抄 20260709000700 的 can_mark_attendance 模式（security definer 全套）
-- RLS：admin 全权；can_review_session 读写（upsert）；staff 读 = can_access_student(student)（学辅看名下学情）；
--      student/parent 无表级读，走白名单 RPC get_my_session_reviews(from,to)：本人/孩子的
--      session/讲次名/entry/exit/三维/comment + 该课次 knowledge_summary
-- knowledge_summary 的写：Server Action 判 review.write + 本班（同 can_review_session），单列 update
```

### 3.4 课后视频（P4D-4）

```sql
session_videos (
  id uuid pk, session_id uuid not null references class_sessions on delete cascade,
  student_id uuid not null references students on delete cascade,
  uploaded_by uuid not null references profiles,           -- 学生本人或员工代传
  storage_path text not null, duration_sec int, size_bytes bigint,
  note text not null default '',                            -- 学生留言
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references profiles, reviewed_at timestamptz,
  review_comment text not null default '', review_score smallint check (review_score between 1 and 5),
  deleted_at timestamptz
)
create index session_videos_session_idx on session_videos (session_id) where deleted_at is null;
-- Storage：私有 bucket `session-videos`，路径 = <classroom_id>/<session_id>/<video_id>.<ext>；
--   file_size_limit 200MB；insert = 该教室成员或 can_review 的 staff（路径首段校验照抄 courseware bucket 策略）；
--   select 不给 authenticated 表级——一律走下方 signed URL Action（家长无法进 storage RLS 按路径判亲子关系）
-- 表 RLS：admin 全权；行 insert = 本人（students.user_id=auth.uid() 且是该教室成员）或 can_review_session 的 staff；
--   select = 本人 / can_access_student 的 staff；家长走 RPC/Action；
--   review 列更新走 Server Action（video.review），软删 = 上传者本人（未审前）或 admin
```

- `getVideoSignedUrl(videoId)` Server Action：requireUser → 行级校验（本人 / guardian / can_access_student 的 staff）→ **service client**（`SUPABASE_SECRET_KEY`，仅服务端）`createSignedUrl(path, 3600)`。
- 审阅界面播放器：原生 `<video controls>` + 倍速按钮组 0.5 / 1 / 1.5 / 2 / 3（`video.playbackRate`）+ ±10s 快进退按钮；`reviewVideoAction(videoId, comment, score)` 判 `video.review`。

### 3.5 课程/班级域 CRUD 补齐（P4D-1，无新表）

Server Actions（全部走既有 RLS，course.manage / class.manage 键）：`createCourseAction`、`updateCourseAction`（title/grade/term/class_type/status）、`createLectureAction`/`updateLectureAction`（改名/objectives）/`deleteLectureAction`/`reorderLecturesAction`（no 重排，事务内两步 update 防 unique(course_id,no) 冲突：先挪到负数区再落位）、`updateClassroomAction`（name/capacity/room/grade）。课程**不做删除**（被 classrooms 引用，`status='disabled'` 即下架——审计表如此声明）；讲次删除仅当无 class_sessions 引用（有引用则拒并提示）。

## 4. 页面与面板规格

### 4.1 活动管理页 `/dashboard/activities`（nav 项 activities，requiredPerm activity.register，教务/学辅/主管可见）

- 页头 actions：「新建活动」（activity.manage）——弹窗：类型五选/标题/时间/时长/地点/容量/备注。
- 主体：即将举行（升序）与已结束（降序折叠）两组；活动卡：类型徽章（五类五个 icon）、标题、时间地点、**报名 n / 到场 m / 容量 c**；卡内展开报名名单：学生名（链 360°）/状态徽章/结论摘要 + 行内「到场/爽约」登记按钮与结论输入（mark_activity_result）；「添加学生」搜索框（作用域内学生，book_activity）。
- 已结束活动登记补录允许（离场后补记是常态）；活动软删（activity.manage）确认弹窗。
- 磁贴 `activityToday`（audience=staff，requiredPerm activity.register，2x2）：今明两天的活动（标题/时间/报名数），空态"近两天没有活动"。

### 4.2 学生批量导入 `/dashboard/students/import`（requirePerm student.import）

textarea 粘贴 CSV/TSV（表头可有可无，列序固定：姓名,电话,年级,地区,来源,备注）→ 前端解析预览表（错误行红标：缺姓名/年级非数字）→ 提交 `import_students` → 结果报告（成功 n / 重复跳过 n / 错误明细）。入口：学生列表页头 actions +「导入」按钮。手机号 PII：预览与报告都在页内 state，不进 URL 不写日志。

### 4.3 学生 360° 补齐（P4D-0，兑现 10-§8 原规格）

- 资料区变可编辑表单（student.edit，基本列：姓名/性别/生日/电话/微信/学校/年级/地区/来源/家长文本三件/备注），保存走表级 RLS update（列级 grant 已拆）。
- 头部状态徽章旁：「变更状态」下拉（change_student_status，student.edit）+「分配跟进人」下拉（assign_student，student.assign，选项=list_staff_members 有 followup.write 岗位的员工——P4C-3 交付的 RPC 复用）+「删除」（student.delete，软删确认后回列表）。
- 「学习」tab 加「近期课评」列表（session_reviews 最近 5 课：讲次/入门考/出门测/三维小圆点/评语）与「课后视频」列表（状态：待审/已审+分数，staff 可点开播放）。
- 学生列表页：`?tab=recycle` 回收站视图（student.delete 持有者可见），行内恢复按钮。

### 4.4 课评抽屉与知识总结（P4D-3）

班级详情课次行（已结束或已开始的）新增「课评」按钮（review.write）→ 抽屉：顶部「课堂知识总结」textarea（每课一份）；下方按 enrollments 花名册逐生一行：入门考/出门测两个数字输入 + 三维 1-5 星选择 + 评语输入；「保存」批量 upsert（onConflict session_id,student_id，幂等同点名抽屉）。已有点名抽屉不动（考勤与课评是两个动作两份数据）。

- 教师磁贴 `reviewGaps`（review.write，2x1）：近 7 天我班已结束但**零课评**的课次数，直达班级详情；`videoQueue`（video.review，2x1）：待审视频数（submitted 未 reviewed），直达视频审阅。
- 学生/家长端：children 详情页与学生「我的课堂」磁贴下钻页展示 get_my_session_reviews（课次倒序卡片：讲次名/出入门测/三维/评语/知识总结）；childCard 的"最近课堂"行换成最近一次课评摘要（有课评时优先于纯星星）。

### 4.5 视频上传与审阅（P4D-4）

- 学生端入口：`/dashboard/assignments` 页每课次区块 or 教室课次详情加「上传课后视频」（近 14 天内已结束课次可传，文件选择→直传 bucket→insert 行；同课次重复上传=新增一行不覆盖）。
- 教师审阅页 `/dashboard/videos`（nav 不加项，从 videoQueue 磁贴与班级详情进入；requirePerm video.review）：待审列表（学生/班级/课次/时长/交于何时）→ 点开右侧播放器（§3.4 倍速组）+ 评语/评分表单 → 标记已审。已审列表折叠在下。
- 家长端：children 详情页课评卡内，若该课次有**已审**视频则显示「回看视频」（getVideoSignedUrl）；未审不露出（教学质量把关后再给家长看——拍板）。

### 4.6 跟进台增强（P4D-5，叠在 P4C-6 之上）

- 统计桶从五个扩到七个：+「待续费」（我名下/全部 active enrollment 所在班 剩余课次≤3）、+「流失池」（status in (lost) 或 students.status='invalid'，含已流失时长）。
- 流失池行内动作：「回流」（change_student_status → following + 自动记一条 follow_ups kind='note' content='流失回流'）——**回流不清历史**，时间线完整留痕。
- 磁贴 `renewalDue`（finance.order.view 或 followup.view，2x1）：待续费人数，直达跟进台该桶（取代 11-§0.1 的 🌱 续费预警）。

## 5. 全模块 CRUD / 批量 / 回收审计表（用户二轮反馈第二条的总答卷；执行到 P4D-6 时逐行复核打勾）

| 模块 | 新建 | 修改 | 删除/回收 | 批量 | 结论/去处 |
| --- | --- | --- | --- | --- | --- |
| 学生 students | RPC 有 UI 无 → **P4C-6 简版 + P4D-0 完整版** | 360° 只读 → **P4D-0 可编辑+状态+分派** | 无 → **P4D-0 软删+回收站**（student.delete） | 无 → **P4D-0 导入**（student.import） | 本表最大缺口 |
| 跟进 follow_ups | ✅ P4C 已补 | **政策：append-only 不做改删**，写错补记更正 | 同左 | 不需要 | 声明即闭环 |
| 课程 courses | 无任何写 Action → **P4D-1** | 同左 → **P4D-1** | **政策：不删，status=disabled 下架**（被班级引用） | 种子脚本已有（scripts/seed-courses.mjs），不做 UI 批量 | P4B-1 验收虚标，P4D-1 兑现 |
| 讲次 course_lectures | → **P4D-1**（增/改名/objectives/重排） | 同左 | 无引用可删，有 class_sessions 引用则拒 → **P4D-1** | 随课程种子 | |
| 课件模板 | ✅ 编辑器已有（P4B-3） | ✅ | 页级增删在编辑器内 ✅ | 不需要 | |
| 班级 classrooms | ✅ 建班向导 | 基础信息不可改 → **P4D-1 updateClassroomAction** | ✅ 归档/取消归档（archived_at 即软删语义） | 不需要 | |
| 课次 class_sessions | ✅ 建班批量生成 + 单班补排 | ✅ 改时间 | **P4C-2 软删+回收站** | ✅ 建班时批量 | P4C 已排 |
| 报名 enrollments | ✅ RosterPanel 报名 | ✅ 转班 | ✅ 退班（状态机即回收语义，不物理删） | 不做批量转班（逐人操作，防误伤） | |
| 考勤 | ✅ 点名抽屉 upsert | ✅ 重提交幂等 | 不删（改状态即可） | ✅ 整班一次提交 | |
| 课评 session_reviews | → **P4D-3 抽屉** | ✅ upsert 幂等 | 不删（改分即可） | ✅ 整班一次提交 | 新域 |
| 活动 activities | → **P4D-2** | → **P4D-2** | 软删 → **P4D-2** | 报名逐人（现场登记本来就是逐人） | 新域 |
| 视频 session_videos | 学生上传 → **P4D-4** | 审阅字段 → **P4D-4** | 上传者未审前可删 + admin | 不需要 | 新域 |
| 财务八表 | ✅ RPC 齐 | **政策：append-only**，改错走冲正（负 delta/void）——10-§10 纪律 | 同左 | 不做批量下单 | 声明即闭环 |
| 优惠券/奖学金 | ✅ | ✅ 启停/撤销 | 撤销即回收语义 | 不需要 | |
| 员工/岗位 | → P4C-3 | → P4C-3 | 自定义角色可删（无成员时） | 不需要 | P4C 已排 |
| 磁贴布局 | ✅ P4C-4（隐藏/恢复默认即回收） | ✅ | ✅ | 不需要 | |

## 6. 任务拆分（每条 = 一次提交；顺序即依赖序）

| # | 内容 | 关键验收 |
| --- | --- | --- |
| **P4D-0** | §3.1 学生域 migration（region/deleted_at/import_students/soft_delete/create_student 扩参）+ §4.2 批量导入页 + §4.3 360° 补齐（编辑/状态/分派/软删/回收站）+ 软删过滤清单逐处落 | 导入 3 行含 1 重复 1 缺名 → 报告 1 成功 1 dup 1 error；软删学生从列表/搜索/漏斗/顾客端 RPC 全消失、回收站可恢复；有 active 报名的学生拒删；学辅编辑名下学生资料成功、改 assigned_to 被列级 grant 拒 |
| **P4D-1** | §3.5 课程/班级 CRUD Actions + UI（课程新建/编辑/启停、讲次增删改重排、班级信息编辑） | 无 course.manage 者不见按钮且直调被拒；讲次重排后 no 连续无冲突；被引用讲次拒删提示清晰 |
| **P4D-2** | §3.2 活动域 migration + §4.1 活动页 + activityToday 磁贴 + 跟进状态联动 | book 满员拒；报名后学生状态 pending→invited、时间线出现 kind=activity 行；到场登记三板斧→trialed；no_show 不降状态；顾客账号读 activities 被 RLS 拒 |
| **P4D-3** | §3.3 课评 migration + §4.4 抽屉/知识总结 + reviewGaps 磁贴 + get_my_session_reviews + 学生/家长端展示 + 360° 学习 tab 课评列表 | 课评 upsert 幂等；无 review.write 的学辅可读名下学生课评不可写；家长只见孩子课评；出门测分数与 SQL 手查一致 |
| **P4D-4** | §3.4 视频 migration + bucket + 上传/审阅/videoQueue + getVideoSignedUrl | 学生传自己课次成功、传别班被拒；教师 2x 倍速播放（playbackRate 断言）；家长只能拿到已审视频的 signed URL、未审/别人孩子拿不到；signed URL 过期后 403 |
| **P4D-5** | §4.6 跟进台待续费/流失池两桶 + renewalDue 磁贴 + 回流动作 | 剩余≤3 课次的学生进待续费；回流后状态 following 且时间线留痕；学辅只见名下 |
| **P4D-6** | §5 审计表逐行复核收尾（补漏项、政策项在 UI 加说明文案）+ 五角色全链路回归（Playwright，复用 P4B 验收脚手架）+ memory/roadmap 更新 | 审计表全行打勾或注明政策；生命周期全链路：导入线索→约活动→到场→报名缴费→课评+视频→续费提醒→流失回流 一条龙走通 |

## 7. 隐含坑清单（10-§10、11-§10 全部继续有效，本期新增）

- **改函数签名/返回列集一律 drop 再 create**：`create_student` 加参、`get_my_learning_summary` 若再扩列（P4C-7 之后第二次），`create or replace` 都会报错；drop+create 同事务，前端类型同提交更新。
- `student_follow_ups.kind` 加 'activity'：check 约束改法 = `alter table … drop constraint <名> ; add constraint … check (kind in ('note','call','class','visit','activity'))`——先 `\d` 查现网约束名（10-§10 老坑）。
- **软删学生的连锁语义**：不影响历史事实（enrollments/orders/attendance/reviews 保留，报表仍算历史数），只从"活人列表"消失；拒删有 active enrollment 者是为防误删在读生。恢复后一切如初。
- import_students 的查重键是 phone（非空时）——**同名不算重复**（同名学生真实存在）；500 行上限防单事务过大；bind_code 生成循环撞库重试照抄 invite_code 模式。
- 活动到场登记允许补录（活动已结束仍可 mark），但 book 满员校验只数 booked+attended（cancelled/no_show 让位）。
- 状态联动只升不降且只在早期档位间（§3.2 写死的档位集合），**绝不覆盖 signed/lost**——已签约学生来参加竞赛活动不能被打回 trialed。
- session_reviews 的 entry/exit 是 numeric(5,1)：JS 侧 `Number` 精度足够，但**不要**在 TS 里做均分再写库（报表现算，不存派生值）。
- 视频 bucket：客户端直传沿 courseware 模式；**LAN 非安全上下文**下 File API 可用无碍，但上传大文件要显示进度（supabase-js upload 无进度回调——用 XMLHttpRequest 直传 storage REST 或接受无进度+转圈，拍板：转圈+完成提示，不引依赖）；`SUPABASE_SECRET_KEY` 只在 server action 用于 signed URL，绝不下发。
- 视频行 insert 的 RLS 要同时校验 `session_id` 属于学生所在教室（防把视频挂到别班课次）；storage 路径首段 classroom_id 与行数据一致性在 Action 内核验。
- 家长"只看已审视频"是**产品拍板**（质量把关），不是技术限制——getVideoSignedUrl 对 parent 身份加 `reviewed_at is not null` 条件，对 staff/本人不加。
- 续费窗口的"剩余课次"= 未删且未结束课次计数，与 rosterMismatch/renewalDue 都是内存对账型查询——沿 11-§10 的禁 N+1 纪律。
- 活动/课评/视频三个新域的列表页都先写空态（EmptyState），后台初期数据稀。
- 权限键 6 连增后，P4C-3 的权限矩阵页**自动**出现新域分组（PERMISSION_KEYS 驱动渲染），无需改矩阵页代码——若矩阵页硬编码了域列表就是写错了，回去修。

## 8. 与既有文档的关系

- `04-roadmap.md`：P4C 之后插入 P4D（随本文提交修订），P5 顺延至 P4D 后。
- `11-p4c-dashboard-refit.md`：§0.10 是本文的需求依据；P4C-6 跟进台先行交付五桶版，本文 P4D-5 扩到七桶；11-§0.1 的续费预警 🌱 由本文 P4D-5 落地。
- `10-school-backend.md`：students 表扩列、follow_ups.kind 扩值、§3.3 权限键清单 +6、§3.2 画像叠加本文 §2——均为增量修订层，不回改原文。
- 课上表现的「星星」（P4 session_events）继续存在：星星是**课堂即时激励**（大屏实时），课评是**课后结构化评价**，两者并存不合并。
