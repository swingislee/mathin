# Mathin 整体规划 · 10 P4B 学校端后台（角色仪表盘 + 教务数据底座）

> 本文是 P4B 的权威执行计划，地位等同 `08-p4-classroom-whiteboard.md` 之于 P4。前置阅读：`00-overview.md`、`03-data-and-tech.md`、`08-p4-classroom-whiteboard.md`（尤其 §4 数据模型——P4B 直接在其上扩展）。
>
> **修订声明**：本文**推翻** 08-§1 中「不做教培 CRM」的非目标（用户 2026-07-09 拍板重启该议题），并**暂缓 P5**（09-p5-story 顺延，规划保留不动）。但 04-roadmap「长期暂缓」中的**多租户机构、移动端 App** 仍然不做——本系统按**单机构**设计。
>
> 执行方式：任务拆分（§9）按序交给执行 agent，每条 = 一次独立提交。执行 agent 智能水平有限，因此本文把数据模型写到列级、把页面写到区块级、把决策写死不留发挥空间；**遇到本文没写的决策，停下来问用户，不要自行发挥**。
>
> **与 P4I 的关系（2026-07-22 追记）**：本文是 P4B 首次落地时的执行规格，之后依次被 P4C/P4D/P4H/`19-p4i-final.md`（P4I）多轮修订。P4B 打下的数据模型（学生/班级/订单等表结构）仍然是地基，但导航、员工首页、路由与页面归属等表述已被后续版本取代——与 doc 19 冲突处一律以 doc 19 为准，执行 agent 不再按本文的导航/路由描述实现新页面。

## 1. 背景：为什么要自建学校端后台

参考系统是「未来魔法校」的机构后台（完整结构见 `.claude/魔法校后台/后台结构参考.md`）。它功能齐全，但有三个根本问题，本项目的设计围绕解决它们展开：

1. **没有课程自建与管理**。魔法校的课程来自应用商城（官方建好、绑定好资源），机构只能挑选后自动生成讲次建班；自建课程只有名字和讲次名，无法绑定资源。我们需要：**完整的自建课程体系**——课程 → 讲次 → 每讲的课件/资源，全部自己建、自己管，排课建班从自己的课程长出来。第一步的课程框架直接采用「魔法校 E 系列数学教学计划汇总」的整体结构（6 个年级 × 暑秋寒春 4 学期 × A/B/S 三班型 = 72 门课、865 讲，已提取为 `supabase/seed/teaching-plans.json`），讲次内的详细教学资源后续慢慢填充。
2. **信息齐全但流转断裂**。数据都在，但按「功能模块」组织而不是按「使用者视角」组织：老师打开后台看不到自己班级学生的学情与跟进历史；销售看不到自己跟进的学生后续报没报名；教学主管看不到老师们的备课上课情况。**我们的后台按角色组织信息**：同一份数据（学生、课程、班级、跟进记录）在不同角色的仪表盘下有不同的切面与入口。
3. **老师没有可写的工作台**。学生的电话沟通记录、课堂表现、学情备注是老师日常要写要看的核心，魔法校里老师只有组卷编题功能。我们把**学生 360° 档案页**（基本资料 + 生命周期 + 跟进时间线 + 课表 + 学情）作为全后台的枢纽页面，教师、管理者都从各自入口汇到这一页。

**重点施工位置：`/dashboard`**。现有 dashboard（成绩卡 + 笔记卡 + 教室卡）升级为**按角色分发的多页后台**，管理者、教师、学生、家长各见一套首屏与导航。

## 2. 范围与非目标

**做**：

1. 角色与权限（**可配置 RBAC**，2026-07-09 用户拍板）：员工岗位角色（校长/主管/教研/教师/学辅/兼职 + 系统管理员）不再是固定枚举，而是数据行；管理员按**权限键**颗粒度勾选每个角色能做什么。见 §3。
2. 课程体系：`courses` / `course_lectures` 两表 + 管理页 + 教学计划种子数据导入。
3. 学生档案（CRM 核心）：`students` / `student_guardians` / `student_follow_ups`，学生列表 + 360° 档案页 + 跟进时间线；学辅（销售）为跟进人 `assigned_to`。
4. 建班报名排课：`classrooms` 挂接课程、`enrollments` 报名关系、`class_sessions` 挂接讲次与上课时间、批量排课。
5. 课表视图：按周的日历课表（全校 / 按教师 / 本人 / 孩子四种切面）。
6. 考勤与学情：`session_attendance` 点名 + 学生学情聚合（出勤/星星/作业成绩）。
7. **财务模块**（2026-07-09 用户拍板，回到范围内）：报名订单 `orders`/`order_items`、收款 `payments`、退费 `refunds`、优惠券 `coupons`/`coupon_grants`、奖学金 `scholarships`、学生账户与流水 `student_accounts`/`account_ledger`。收费报表作为收尾子任务。
8. 角色仪表盘首屏：员工端（按角色/权限自适应）、学生端、家长端。

**不做**（明确排除，除非用户重启议题）：

- 营销与招生工具：网校装修、拼团、助力、活码、积分商城、测评管理。
- 多校区/多租户：单机构运行，不建 `campuses` 表（魔法校的「校区」字段一律不要）。
- 工资/费用支出与收银对账（财务只做「向学生收退的钱与账户」，不做机构内部支出与工资）。
- 短信/电话/微信集成、消息推送、第三方支付网关对接（收款为**手工录入**：现金/扫码/转账，记录事实不做在线支付）。
- 直播平台：线上上课能力已由 P4 的教室/上课页承担，不另建直播模块。

## 3. 角色与权限模型（可配置 RBAC，2026-07-09 用户拍板）

### 3.1 两层授权，各管一件事（核心决策，不可混淆）

固定枚举 `role` 不足以表达「管理员按颗粒度配置权限」。改为**双层**：

- **第一层 · 身份类（`profiles.role`，仍是枚举）**：`student`（默认）| `parent` | `staff` | `admin`。这一层只区分「你是哪一类人」——顾客侧的学生/家长，员工侧的 staff，以及系统管理员 admin。**RLS 的行级作用域基于这一层 + 数据关系**（我是不是这个学生的跟进人/任课教师、我是不是 owner），不基于细粒度权限键——RLS 里塞几十个权限键既慢又难维护，也没必要（敏感写全走 Server Action / RPC，见 §4.5）。
- **第二层 · 岗位与权限（可配置 RBAC，表驱动）**：员工的**岗位角色**（校长/主管/教研/教师/学辅/兼职…）是 `staff_roles` 表的数据行，管理员可增删改名；每个岗位角色勾选一组**权限键**（`role_permissions`）；员工可挂**多个**岗位角色，有效权限 = 并集。**功能级授权（能看哪个菜单、能点哪个按钮、能进哪个页面、能发起哪个操作）基于这一层**，在 Server Action 开头与 UI 渲染时用 `hasPerm(uid, key)` 判定。

一句话分工：**RLS 管「你能碰哪些行」（结构性、关系驱动、写死）；权限键管「你能用哪些功能」（配置性、管理员可调）。** 两层叠加即最终可见/可为。

### 3.2 内置岗位角色（`staff_roles` 种子行，管理员可再改）

| 岗位角色 | 默认权限画像（管理员可再调） |
| --- | --- |
| 校长 principal | 全部权限（含权限配置、财务全权、员工管理） |
| 主管 director | 教务全权 + 财务查看/收款 + 学情/报告全校可见；无权限配置、无退费审批 |
| 教研 research | 课程与课件模板读写、学情只读；无学生跟进、无财务 |
| 教师 teacher | 我的班级：学生基本档案与跟进读写、排课/点名/批改、课件覆盖层编辑 |
| 学辅 sales（=销售） | 学生线索与跟进读写（我负责的）、报名下单、优惠券使用、查看我名下学生的报名与回款；无课件、无排课 |
| 兼职 part-time | 最小集：我的班级点名 + 我的课表；默认无学生档案写、无财务 |

- `admin`（系统管理员，`profiles.role='admin'`）是**超级用户**：绕过权限键检查（`hasPerm` 对 admin 恒真），负责配置 `staff_roles`/`role_permissions`、授予员工角色。校长岗位角色可被配置到接近 admin，但**权限配置本身（`permission.configure`）默认只给 admin 与校长**——防止普通员工给自己提权。
- 员工可同时挂多个岗位（如「主管+教师」）；首屏与导航按有效权限并集自适应渲染，不做互斥分发。

### 3.3 权限键清单（`permission_keys` 常量，代码内枚举，不入库）

权限键是**代码里的字符串常量**（`src/features/school/permissions.ts` 导出 `PERMISSION_KEYS`），不是用户可造的数据——管理员只能勾选已定义的键，不能凭空发明。分域列举（执行 agent 按此建常量，后续域增补即追加）：

```
student.view.all / student.view.assigned / student.edit / student.create / student.assign
followup.view / followup.write
course.view / course.manage            // 课程与讲次
courseware.template.edit / courseware.overlay.edit
class.view.all / class.view.mine / class.create / class.manage
schedule.view.all
attendance.mark
grading.write                          // 批改
report.view.all
finance.order.view / finance.order.create / finance.payment.record /
finance.refund.request / finance.refund.approve /
finance.coupon.manage / finance.scholarship.grant / finance.account.adjust /
finance.report.view
staff.manage                           // 增员工、授岗位角色
permission.configure                   // 编辑 staff_roles / role_permissions
```

`hasPerm(uid, key)`：admin 恒真；否则查该用户所有岗位角色的权限并集是否含 key。实现为一个 security definer SQL 函数（RLS 与 Server Action 同源调用）+ 一份进程内 request 级缓存（避免同一请求内反复查库）。

### 3.4 顾客侧（学生/家长）不参与 RBAC

`student` / `parent` 是顾客，不挂岗位角色、不看后台功能菜单。他们的数据一律经白名单 RPC（`get_my_*`）读取，永不表级 select 内部表。

- **student**：本人视角——我的课表、作业、成绩、教室、**我的订单与账户余额**（只读自己的财务）；不可见任何内部字段（跟进/成本/他人）。
- **parent**：经绑定码关联孩子后，只读孩子的课表、出勤、作业成绩、课堂学情、**孩子的订单与缴费记录**。
- 家长数据视图由 `student_guardians` 数据驱动：staff 账号若也绑了孩子，其仪表盘额外出现「我的孩子」卡。

### 3.5 可见性矩阵（RLS 设计依据；「功能开关」列 = 权限键，不进 RLS）

| 数据 | admin | staff（视权限键） | student 本人 | parent |
| --- | --- | --- | --- | --- |
| courses / course_lectures | 读写 | `course.view`/`course.manage` 决定读/写 | ✗ 直读（经课表间接见讲次名） | 同 student |
| courseware_template | 读写 | `courseware.template.edit` | ✗ | ✗ |
| students 全列（跟进人/标签/内部备注/财务关联） | 读写 | `student.view.all` 读全部 / `student.view.assigned` 只读我名下或我班的；`student.edit` 才可写基本列 | ✗ | ✗ |
| students 白名单列（姓名/年级/状态） | — | — | 经 RPC 读本人 | 经 RPC 读孩子 |
| student_follow_ups | 读写 | `followup.view`/`followup.write`，且只限我名下或我班学生 | **✗ 永不可见** | **✗ 永不可见** |
| enrollments | 读写 | 我班/我名下只读；下单经 RPC | 本人只读 | 孩子只读 |
| class_sessions（排课） | 读写 | `class.manage` 我班读写 | 本人班只读 | 孩子班只读 |
| session_attendance | 读写 | `attendance.mark` 我班读写 | 本人只读 | 孩子只读 |
| orders / payments / refunds | 读写 | `finance.*` 各键分别决定 | 本人订单只读 | 孩子订单只读 |
| coupons / scholarships | 读写 | `finance.coupon.manage`/`finance.scholarship.grant` | ✗（只见落到自己的券/奖学金） | 同 student |
| 课堂报告（全班聚合） | 读 | `report.view.all` 或我班 | ✗（只见本人学情） | ✗（只见孩子学情） |
| staff_roles / role_permissions | 读写 | `permission.configure` | ✗ | ✗ |
| profiles 角色/岗位授予 | RPC 写 | `staff.manage`（授岗位角色，但不可授 `permission.configure` 越权） | ✗ | ✗ |

「staff（视权限键）」列的读写并非人人如此——RLS 只放行到「staff 且数据关系成立」，具体能不能用某功能由权限键在 Server Action 再收一道。RLS 层对 staff 的**行作用域**统一按：`student.view.all`/`report.view.all` 等「全局查看」类权限的持有者放行全表，否则仅放行「我名下（assigned_to=我）或我任课班级」的行。这条「全局 vs 仅限本人」的边界是唯一需要进 RLS 的权限判断（用 `staff_has_perm` 辅助函数）。

## 4. 核心架构决策（不可更改，执行时照办）

### 4.1 班级 = 扩展现有 `classrooms`，不建新表

P4 的教室（`classrooms` + `classroom_members` + `class_sessions` + `session_events` + `assignments`）已经打通候课/离线上课/报告/作业全链路。**班级就是挂上课程与排课信息的教室**：给 `classrooms` 加可空列（`course_id`、`grade`、`capacity`、`room`、`archived_at`），给 `class_sessions` 加可空列（`lecture_no`、`scheduled_at`、`duration_min`）。旧的轻量教室（无课程）继续原样工作——所有新列可空，一行 SQL 都不用迁移旧数据。

### 4.2 学生档案与登录账号分离

魔法校用手机号直接开账号；我们的学生自主注册。学校端的「学生」是 **CRM 实体**（`students` 表），从销售线索阶段就存在，**不要求有登录账号**；`students.user_id` 可空、唯一，学生本人凭**绑定码**（RPC）把自己的账号挂到档案上。这样：潜在学生（纯线索）、在读学生（有档案有账号）、历史学生共用一张表，靠 `status` 区分生命周期。

- 教室成员（`classroom_members`，账号维度，管上课权限）与报名（`enrollments`，档案维度，管教务事实）**解耦、不互相触发**。花名册 UI 同时展示两者并标出错位：「已报名未绑定账号」「已进教室但无报名记录」，由人工处理，不做自动 reconciliation。

### 4.3 讲次课件：模板引用 + 受限覆盖层 + 开课冻结（用户 2026-07-09 拍板，取代最初的深拷贝方案）

统一教研体系下，课件的唯一权威是 `course_lectures.courseware_template`（与 `class_sessions.courseware` 同构，08-§3.6 的页数组）；**建班时不拷贝**。教师对单个课次能做的只有三件事，全部记在该课次的**覆盖层** `class_sessions.courseware_overlay`：插入自己的页（空白板书页/练习页/图片页）、调整页面顺序、——**不能删除模板页、不能修改模板页内容**。教研更新模板后，所有未上的课次自动生效。

**overlay 结构与合并算法**（实现为纯函数 `src/features/school/courseware-overlay.ts`，课件管理页与候课页共用）：

```
courseware_overlay = [ {ref: <模板页id>} | {page: <完整新页对象，教师插入>} , … ]   -- 有序数组
resolve(template, overlay):
  校验：所有 ref 去重后 = 模板页 id 集合（一个排列，不多不少 ⇒ 天然禁止删页）；
        新页 type ∈ {board, game, image, video}；新页 id 为客户端新生成 uuid
  自愈（模板在建班后被教研修改时）：
    模板新增的页（overlay 中无 ref）→ 按模板顺序插回其模板前驱页之后；
    overlay 中 ref 指向已不存在的模板页 → 静默丢弃该条
  输出：按 overlay 顺序展开（ref → 模板页对象，page → 原样），得到有效页数组
```

校验在**服务端** Server Action 保存 overlay 时执行（不信任前端）；违规 overlay 整体拒绝。

**开课冻结**：候课检查单全绿、教师点「开始上课」时（rehearsal 试讲不冻结），Server Action 把 `resolve(template, overlay)` 的结果写入 `class_sessions.courseware` 并设 `courseware_frozen_at`。此后模板/overlay 变更不再影响该课次——历史课的课件、板书快照、报告永远对应当时实际上课的版本。**P4 的整个 live/离线栈只读 `courseware` 列，行为零改动**；未冻结课次的课件管理页展示的是 resolve 预览。无 `lecture_id` 的自由课次跳过整套机制，直接编辑 `courseware`（现状行为）。

**模板页的媒体文件**：新增私有 bucket `course-assets`（路径首段 = course_id；insert/delete = admin，select = authenticated）。模板因此可以包含 image/video 页，候课预载对模板页与教师插入页一视同仁（都在 resolve 结果里）。

### 4.4 仪表盘 = `/dashboard` 下的角色分发多页应用

不新建 `/admin` 路由段。`/dashboard` 首页按身份（student/parent/staff）渲染首屏，staff 工作台内部按权限键自适应（§7）；子页面各自在服务端做 `requirePerm(locale, key)` 校验（`src/lib/auth.ts` 新增，内部 `hasPerm`，不满足 302 回 `/dashboard`）。理由：proxy 的保护前缀已覆盖 `/dashboard`，UtilitySheet 入口不变，学生/家长感知不到「后台」的存在——他们看到的仍是「我的仪表盘」。

### 4.5 写路径纪律

沿 P4-7 的结论：**跨权限边界或涉钱的写一律走 SECURITY DEFINER RPC**（授岗位角色、配置权限、绑定账号/家长、报名/转班/退班、下单/收款/退费/发券/发奖学金/调账），普通同边界 CRUD（教师改自己班的课次、有 `course.manage` 者改课程）走表级 RLS + Server Action。

**每个 Server Action / RPC 开头两道闸**：①`requireUser`（登录）；②`hasPerm(uid, key)`（功能权限，admin 恒过）——两者都不信任前端。RLS 是第三道行级兜底。财务类 RPC 内部再自校验金额非负、状态机合法（如退费金额 ≤ 可退余额）。

## 5. 数据模型（migrations，经 SSH 执行，流程同 CLAUDE.md）

> 全部 `public` schema、全部 `enable row level security`、全部按 03-§3 通用约定（uuid pk、created_at）。以下为列级草案，执行 agent 落 migration 时保持列名一致；RLS 辅助函数照抄 `20260708000300_classrooms.sql` 的 security definer 模式防递归。

### 5.1 身份类扩展 + RBAC 权限体系（P4B-0）

**身份类枚举**（`profiles.role`，第一层）：

```sql
alter table public.profiles drop constraint profiles_role_check;  -- 先查现网约束名，见 §10
alter table public.profiles add constraint profiles_role_check
  check (role in ('student','parent','staff','admin'));
-- 说明：原有 'teacher' 一律迁为 'staff' 并挂「教师」岗位角色（migration 内 update + insert staff_role_members）；
--       admin 保留为超级用户；顾客侧 student/parent 不挂岗位角色
```

**RBAC 三表**（第二层，管理员可配置）：

```sql
staff_roles (
  id uuid pk, key text unique not null,        -- 稳定机读键：principal/director/research/teacher/sales/part_time；自定义角色 key 自动生成
  name text not null,                          -- 展示名（校长/主管/…），可改
  is_system boolean not null default false,    -- 内置角色不可删（可改权限与名）
  created_at
)
role_permissions (
  role_id uuid references staff_roles on delete cascade,
  perm_key text not null,                       -- 必须 ∈ 代码常量 PERMISSION_KEYS（服务端校验，见 §3.3）
  primary key (role_id, perm_key)
)
staff_role_members (
  user_id uuid references profiles on delete cascade,
  role_id uuid references staff_roles on delete cascade,
  granted_by uuid references profiles, created_at,
  primary key (user_id, role_id)
)
-- RLS：staff_roles/role_permissions 读=任意 staff（前端要按权限渲染菜单），表级不授 insert/update/delete；
--      staff_role_members 读=本人自己的行 + has_perm('staff.manage') 读全部，表级不授 insert/delete。
--      所有写操作只走下方 SECURITY DEFINER RPC，避免绕过提权守卫。
```

**核心辅助函数**（security definer，后续所有策略与 Server Action 复用）：

```sql
is_admin(uid)            -- profiles.role = 'admin'
is_staff(uid)            -- profiles.role in ('staff','admin')
has_perm(uid, key)       -- admin 恒 true；否则 exists(staff_role_members ⋈ role_permissions where perm_key=key)
staff_has_perm(uid, key) -- = has_perm，供 RLS 内联调用（命名区分：RLS 里只用它判「全局 vs 仅本人」）
teacher_of_student(sid, uid)  -- uid 是某教室 teacher 成员且该教室有 sid 的 active enrollment
assigned_of_student(sid, uid) -- students.assigned_to = uid（学辅/跟进人边界）
```

**RPC**（security definer）：

```sql
admin_set_identity(target uuid, new_role text)   -- 改 profiles.role；仅 admin；target<>self；new_role∈四值；
                                                 --   P4B-0 必须同步改造 protect_profile_role 触发器，
                                                 --   允许本 RPC 安全改 role，不能被旧的 authenticated 拦截逻辑挡住
grant_staff_role(target uuid, role_id uuid)      -- 授岗位角色；调用者需 has_perm('staff.manage')；
                                                 --   target<>调用者本人；且不得授含 'permission.configure' 的角色除非调用者 is_admin（防提权）
revoke_staff_role(target uuid, role_id uuid)     -- 同上守卫
set_role_permissions(role_id, perm_keys text[])  -- 覆盖式设权限；需 has_perm('permission.configure')；
                                                 --   每个 key 必须 ∈ PERMISSION_KEYS（传一份服务端常量做交集校验），非法键整体拒
```

**种子**：migration 末尾插入 6 个 `is_system=true` 岗位角色及其 §3.2 默认权限画像（`role_permissions` 批量 insert）。默认画像写死在 migration 里，管理员之后可改。

### 5.2 课程体系（P4B-1）

```sql
courses (
  id uuid pk, title text not null, product_code text unique,      -- 种子数据带 MFHK 编号，自建课可空
  grade smallint not null check (grade between 1 and 9),
  term smallint not null check (term between 1 and 4),             -- 1暑 2秋 3寒 4春，展示文案走 i18n
  class_type text not null default '',                             -- 'A'|'B'|'S'|自定义
  status text not null default 'enabled' check (status in ('enabled','disabled')),
  created_by uuid references profiles, created_at, updated_at
)
course_lectures (
  id uuid pk, course_id uuid not null references courses on delete cascade,
  no smallint not null, name text not null,
  objectives text not null default '',                             -- 教学目标/备注
  courseware_template jsonb not null default '[]',                 -- 同 class_sessions.courseware 结构，1MB cap 同款 check
  updated_at, unique (course_id, no)
)
-- RLS：admin/has_perm('course.manage') 全权；has_perm('course.view') select（status='enabled'）；
--       courseware_template 的写另需 has_perm('courseware.template.edit')；student/parent 无直读
```

### 5.3 学生档案（P4B-2）

```sql
students (
  id uuid pk,
  name text not null, gender text default '' , birthday date,
  phone text not null default '', wechat text not null default '',
  school text not null default '', grade smallint,                 -- 公立校与年级
  status text not null default 'lead'
    check (status in ('lead','trialing','enrolled','paused','alumni','invalid')),
    -- 潜在→试听→在读→停课→历史→无效；状态只做标记，不做状态机强校验
  source text not null default '', referrer text not null default '',
  tags text[] not null default '{}',
  parent_name text not null default '', parent_relation text not null default '',
  parent_phone text not null default '',                            -- CRM 纯文本家长信息（无账号也要能记）
  assigned_to uuid references profiles,                             -- 跟进人（学辅/销售），由 has_perm('student.assign') 者分配
  follow_up_status text not null default 'pending'
    check (follow_up_status in ('pending','following','invited','trialed','signed','lost')),
  last_follow_up_at timestamptz, next_follow_up_at timestamptz,     -- 由触发器随 follow_ups 插入更新
  user_id uuid unique references profiles,                          -- 绑定的登录账号，可空
  bind_code text not null unique,                                   -- 8 位码，账号绑定与家长绑定共用（生成方式照抄 invite_code）
  remark text not null default '',
  created_by uuid references profiles, created_at, updated_at
)
student_guardians (
  student_id uuid references students on delete cascade,
  guardian_id uuid references profiles on delete cascade,
  relation text not null default '',                                -- 爸爸/妈妈/…
  created_at, primary key (student_id, guardian_id)
)
student_follow_ups (
  id uuid pk, student_id uuid not null references students on delete cascade,
  author_id uuid not null references profiles,
  content text not null,
  kind text not null default 'note' check (kind in ('note','call','class','visit')),  -- 记录类型：备注/电话/课堂/到访
  next_follow_up_at timestamptz,
  status_after text,                                                -- 本次跟进后学生的 follow_up_status（可空=不变）
  created_at
)
-- 触发器：insert follow_up 后更新 students 的 last/next_follow_up_at 与 follow_up_status
-- RLS：students/follow_ups —— admin 全权；
--   select 行作用域：staff_has_perm('student.view.all') 放行全表，否则仅 assigned_of_student 或 teacher_of_student 的行；
--   update 需 has_perm('student.edit') 且仅基本列（name/gender/birthday/phone/school/grade/parent_*/remark，
--     不得改 status/assigned_to/user_id/bind_code，用列级 grant 拆）；
--   follow_ups 写需 has_perm('followup.write') 且学生在我作用域内；
--   student/parent 无表级 select（跟进永不可见）。
-- RPC（security definer）：
--   create_student(...)           has_perm('student.create')；生成 bind_code；服务端写 created_by
--   assign_student(student_id, staff_user_id) has_perm('student.assign')；只允许分给 staff/admin
--   change_student_status(student_id, status) has_perm('student.edit')；受控改 status，不开放表级列更新
--   claim_student_account(code)   登录学生凭码绑定 user_id（已绑定则拒）；若当前 role=student 保持不变
--   bind_guardian(code, relation) 登录账号凭码建 guardian 行（幂等）；若当前 role=student 可升为 parent；
--                                 若当前 role=staff/admin 保持原身份，仅额外获得孩子入口
--   get_my_students()             返回本人（user_id 匹配）或孩子（guardian 匹配）的白名单列：
--                                 id/name/grade/status —— 供学生/家长端一切页面取数的根
```

### 5.4 报名与排课（P4B-3）

```sql
alter table classrooms add column course_id uuid references courses,
  add column grade smallint, add column capacity smallint, add column room text not null default '',
  add column archived_at timestamptz;
alter table class_sessions add column lecture_id uuid references course_lectures, -- 可空=自由课次；冻结/resolve 以此找模板
  add column lecture_no smallint,                                -- 展示冗余：对应 course_lectures.no，可空=自由课次
  add column scheduled_at timestamptz, add column duration_min smallint,
  add column courseware_overlay jsonb not null default '[]',     -- §4.3 覆盖层：ref/page 有序数组
  add column courseware_frozen_at timestamptz;                   -- 开课冻结时间；非空后 live 只读 courseware
create index class_sessions_sched_idx on class_sessions (scheduled_at);
create index class_sessions_lecture_idx on class_sessions (lecture_id);

enrollments (
  id uuid pk, classroom_id uuid not null references classrooms on delete cascade,
  student_id uuid not null references students on delete cascade,
  status text not null default 'active'
    check (status in ('active','completed','transferred_out','withdrawn')),
  joined_at timestamptz not null default now(), left_at timestamptz,
  remark text not null default '', operated_by uuid references profiles,
  created_at,
  -- 同班同学生仅一条 active：
  constraint enrollments_one_active unique nulls not distinct (classroom_id, student_id, left_at)
)   -- 若 unique nulls not distinct 写法过不了，改用 partial unique index where status='active'
create index enrollments_student_idx on enrollments (student_id);
create index enrollments_classroom_idx on enrollments (classroom_id) ;
-- RLS：admin 全权；staff 本班/本人名下只读（作用域同 students）；student/parent 无表级读（走 get_my_schedule RPC）
-- RPC：enroll_student(classroom_id, student_id, remark[, order 相关见 §5.7])
--      transfer_student(student_id, from_classroom, to_classroom, remark)   -- 原行置 transferred_out+left_at，新班插 active，单事务
--      withdraw_student(enrollment_id, remark)
-- 三个 RPC 需 has_perm('class.manage')（学辅报名另经 §5.7 下单 RPC，内部调 enroll）；
-- 报名时 status='lead/trialing' 的学生自动升 'enrolled'
```

**开课冻结 RPC/Action**：P4B-3 必须把现有 `startClassSession()` 改为服务端事务：锁定 `class_sessions` 行；若 `lecture_id` 非空且 `courseware_frozen_at` 为空，则读取 `course_lectures.courseware_template` + `courseware_overlay`，服务端校验/resolve 后写入 `class_sessions.courseware` 与 `courseware_frozen_at`；再写 `started_at`。客户端必须在该事务成功后再广播 `session_ctl:start`。`mode=rehearsal` 不调用冻结事务。

> **报名 ↔ 下单的关系**：教务上的「报名」（enrollments，进班的事实）与财务上的「下单收费」（orders，§5.7）是两件事但常同时发生。约定：学辅走 `place_order` RPC 一步完成「建订单 + 报名进班」（单事务）；admin/主管也可只报名不建单（试听/免费/内部）或只建单不进班（补费）。`enroll_student` 保持可独立调用，`place_order` 内部复用它。

### 5.5 考勤（P4B-5）

```sql
session_attendance (
  session_id uuid references class_sessions on delete cascade,
  student_id uuid references students on delete cascade,
  status text not null check (status in ('present','absent','late','leave')),
  note text not null default '',
  marked_by uuid references profiles, marked_at timestamptz not null default now(),
  primary key (session_id, student_id)
)
-- RLS：admin 全权；has_perm('attendance.mark') 且本班的 staff 读写（upsert）；student/parent 经 get_my_attendance RPC 读白名单
```

### 5.6 财务模块（P4B-6，2026-07-09 用户拍板）

> 设计原则：**账目一律 append-only + 状态机，绝不原地改金额**（改动留痕、可审计、可对账）；金额统一 `numeric(12,2)`、分币种但首版只 `CNY`；收款是**手工录入事实**，不接支付网关。奖学金 = 一种优惠来源，落到订单折扣或学生账户预存。

```sql
orders (
  id uuid pk, order_no text unique not null,       -- 可读单号，RPC 生成（日期+序列）
  student_id uuid not null references students,
  classroom_id uuid references classrooms,          -- 报名类订单关联班级；补费/预存类可空
  kind text not null default 'enroll'
    check (kind in ('enroll','makeup','deposit')),  -- 报名/补费/预存
  amount_original numeric(12,2) not null default 0, -- 原价合计
  amount_discount numeric(12,2) not null default 0, -- 优惠合计（券+奖学金+手动）
  amount_due      numeric(12,2) not null default 0, -- 应收 = original - discount，RPC 内算不信前端
  status text not null
    check (status in ('unpaid','partial','paid','refunding','refunded','void')),
  remark text not null default '',
  created_by uuid references profiles, created_at, updated_at
)
order_items (
  id uuid pk, order_id uuid not null references orders on delete cascade,
  name text not null,                               -- 课程费/教辅费…
  category text not null default 'course' check (category in ('course','material','other')),
  unit_price numeric(12,2) not null default 0, qty smallint not null default 1,
  refundable boolean not null default true          -- 教辅费常「报名后不退」
)
payments (
  id uuid pk, order_id uuid not null references orders,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','scan','transfer','account')), -- account=用账户余额抵扣
  paid_at timestamptz not null default now(),
  operator_id uuid references profiles, remark text not null default ''
)
refunds (
  id uuid pk, order_id uuid not null references orders,
  amount numeric(12,2) not null check (amount > 0),
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','done')),
  requested_by uuid references profiles, requested_at timestamptz default now(),
  approved_by uuid references profiles, approved_at timestamptz         -- 审批留痕
)
coupons (
  id uuid pk, code text unique, name text not null,
  kind text not null check (kind in ('amount','percent')),
  value numeric(12,2) not null,                     -- amount=减额；percent=百分比(0-100)
  scope jsonb not null default '{}',                -- 适用范围（课程/年级；空=通用）
  valid_from timestamptz, valid_to timestamptz,
  status text not null default 'enabled' check (status in ('enabled','disabled')),
  created_by uuid references profiles, created_at
)
coupon_grants (                                     -- 券发放/使用一体（append-only）
  id uuid pk, coupon_id uuid references coupons, student_id uuid references students,
  order_id uuid references orders,                  -- 已核销则非空
  status text not null default 'granted' check (status in ('granted','used','expired','revoked')),
  granted_by uuid references profiles, granted_at timestamptz default now(), used_at timestamptz
)
scholarships (
  id uuid pk, student_id uuid not null references students,
  amount numeric(12,2) not null check (amount > 0),
  kind text not null default 'discount' check (kind in ('discount','deposit')), -- 抵学费 / 充入账户
  reason text not null default '', order_id uuid references orders,
  granted_by uuid references profiles, granted_at timestamptz default now()
)
student_accounts (                                  -- 每学生一行钱包（余额是流水汇总的缓存）
  student_id uuid primary key references students on delete cascade,
  balance numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
)
account_ledger (                                    -- 账户流水 append-only，balance 由触发器随流水更新
  id uuid pk, student_id uuid not null references students,
  delta numeric(12,2) not null,                     -- 正=预存/奖学金充值/退费入账，负=扣费
  reason text not null,                             -- deposit/deduct/scholarship/refund
  ref_order uuid references orders, operator_id uuid references profiles,
  created_at timestamptz default now()
)
```

**RPC（全部 security definer + 权限键 + 金额/状态自校验）**：

```
place_order(student_id, classroom_id, items[], coupon_grant_id?, remark)  -- has_perm('finance.order.create')
    单事务：建 orders + order_items；应用券/奖学金算 amount_*；kind='enroll' 时内部调 enroll_student；
            校验券属于该学生、未核销、未过期且适用当前课程/年级；券置 used；返回 order_id。
            金额一律服务端算，前端传的 due 一律忽略。
record_payment(order_id, amount, method)          -- has_perm('finance.payment.record')；
    method='account' 时校验余额充足并写 account_ledger(负)；累计已付≥应收则 status→paid，否则 partial。
request_refund(order_id, amount, reason)          -- has_perm('finance.refund.request')；amount≤可退额（已付−不可退项）
approve_refund(refund_id, ok bool)                -- has_perm('finance.refund.approve')；通过则写 account_ledger 或记现金退，order.status 收敛
grant_coupon / revoke_coupon                      -- has_perm('finance.coupon.manage')
grant_scholarship(student_id, amount, kind, reason)-- has_perm('finance.scholarship.grant')；kind='deposit' 写 account_ledger(正)
adjust_account(student_id, delta, reason)         -- has_perm('finance.account.adjust')；预存/手动纠正
get_my_orders()                                   -- 学生/家长读本人/孩子订单与缴费（白名单列）
get_my_account()                                  -- 学生/家长读本人/孩子账户余额与白名单流水
```

**RLS**：所有财务表 admin 全权；staff 依 `finance.*` 各键读/写（`finance.order.view` 决定能否 select 全量订单，否则仅自己经手 `created_by=我` 或 `students.assigned_to=我` 的订单/收款，避免代收款后学辅看不到自己学生回款）；写一律走上列 RPC，表级不给 insert/update。学生/家长无表级 select，只经 `get_my_orders`/`get_my_account`。触发器：`payments`/`account_ledger`/`refunds` 变动后重算 `orders.status` 与 `student_accounts.balance`（幂等，按流水求和，不做增量写回——防并发错账）。

### 5.7 种子数据（P4B-1 内执行）

- 数据文件：`supabase/seed/teaching-plans.json`（**已在仓库**，本规划撰写时从魔法校 xlsx 提取）。结构：数组，每项 `{ productCode, title, grade, term(中文), termIndex(1-4), classType, lectures: [{no, name}] }`，共 72 门课 / 865 讲。
- 写导入脚本 `scripts/seed-courses.mjs`：读 JSON → 生成 `supabase/seed/courses.seed.sql`（`insert … on conflict (product_code) do nothing` + 讲次按 `(course_id, no)` conflict，course_id 用 `select id from courses where product_code = …` 子查询关联）→ 经 SSH 事务执行。**幂等**：重跑零副作用。`term` 存 `termIndex`。
- seed SQL 不是 migration，放 `supabase/seed/`，不进 migrations 目录。

### 5.8 顾客侧白名单 RPC 汇总（各期按需落）

学生/家长端永不直读内部表。以下 RPC 都 `security definer`，返回 `returns table(...)` 明确列清单，并以 `students.user_id = auth.uid()` 或 `student_guardians.guardian_id = auth.uid()` 限定本人/孩子：

```
get_my_students()      -- P4B-2：本人/孩子档案白名单 id/name/grade/status
get_my_schedule(...)   -- P4B-4：本人/孩子未来课次，返回时间/班级/讲次/教师展示名
get_my_attendance(...) -- P4B-5：本人/孩子考勤与学情白名单
get_my_orders()        -- P4B-6：本人/孩子订单与缴费白名单
get_my_account()       -- P4B-6：本人/孩子账户余额与白名单流水
```

## 6. 前端架构

```
src/features/school/            # 学校端后台专属 feature（不与 classroom/games 互相 import）
  permissions.ts                # PERMISSION_KEYS 常量 + hasPerm 客户端镜像（服务端权威在 auth.ts）
  actions.ts                    # 全部 Server Actions（按域拆 students.ts/courses.ts/enroll.ts/finance.ts 亦可）
  types.ts
  nav.ts                        # 导航项定义（每项声明 requiredPerm）；首屏与侧栏据此按权限过滤
  students/                     # 列表、360° 档案、跟进时间线组件
  courses/                      # 课程列表、讲次编辑、课件模板编辑
  classes/                      # 建班向导、花名册、排课
  schedule/                     # 周课表（纯 CSS grid 手写，禁止引日历库）
  finance/                      # 订单/收款/退费/券/奖学金/账户组件
  staff/                        # 员工列表、岗位角色配置（权限键勾选矩阵）
  home/                         # 各角色首屏的卡片组件
  learning.ts                   # 学情聚合纯函数（员工/学生/家长复用）
  courseware-overlay.ts         # 模板+覆盖层 resolve（§4.3）
src/app/[locale]/dashboard/
  page.tsx                      # 身份分发首屏：staff→按权限自适应工作台 / student / parent（§7）
  students/page.tsx             # perm: student.view.*
  students/[id]/page.tsx        # 学生 360°
  courses/page.tsx              # perm: course.view
  courses/[id]/page.tsx         # 讲次 + 课件模板编辑（perm: course.manage / courseware.template.edit）
  classes/page.tsx              # 全部（class.view.all）/ 我的（class.view.mine）
  classes/new/page.tsx          # 建班向导（perm: class.create）
  classes/[id]/page.tsx         # 班级详情：花名册/排课/点名
  schedule/page.tsx             # 全角色可入，内容按身份+权限切面
  finance/page.tsx              # 订单/收款/退费/券/奖学金（perm: finance.*，子 tab 按键显隐）
  children/page.tsx             # parent 绑定与孩子列表
  staff/page.tsx                # 员工列表 + 授岗位角色（perm: staff.manage）
  staff/roles/page.tsx          # 岗位角色与权限键配置矩阵（perm: permission.configure）
```

- 布局：dashboard 首页保留 `SectionShell`；staff 子页面加持久左侧导航（桌面）/顶部横向 tab（移动），**导航项按 `hasPerm` 过滤**（`nav.ts` 每项声明 `requiredPerm`）。用 shadcn 既有组件（`table`、`tabs`、`dialog`、`select`、`badge`、`checkbox`），缺的先 `pnpm dlx shadcn@latest add`。
- **权限双端一致**：服务端 `getMyPerms(uid)` 返回权限键集合（一次查，注入布局）；客户端组件据此显隐按钮。但显隐只是体验，**每个 page.tsx 与每个 Server Action / RPC 必须独立服务端校验**（§4.5），绝不靠前端隐藏当安全。
- 所有界面文案进 `messages/{zh,en}.json`（`school.*` 命名空间）；**课程名/讲次名/学生姓名/岗位角色展示名是数据不是文案**，直接渲染，不走 i18n。金额用 `Intl.NumberFormat(locale,{style:'currency',currency:'CNY'})`。
- 列表页模式统一：服务端组件取数 + 顶部筛选（searchParams 驱动，`await searchParams`）+ 分页（`range()`，每页 20）。不引 SWR、不引表格库、不引图表/日历库。
- 设计 token 纪律不变（01-design-system），后台页面同样是小王子风格——大面积留白 + line 边框卡片，不做「企业后台蓝」。

## 7. 首屏规格（`/dashboard` page.tsx 按身份分发 → staff 内部按权限自适应）

身份分三支：`staff`（含 admin）走**卡片自适应工作台**、`student`、`parent`。staff 工作台不再按固定岗位分「admin 首屏/teacher 首屏」，而是**一组卡片各自声明 `requiredPerm`，命中则渲染**——校长看到全部，教师只看到与教学相关的几张，学辅只看到线索与业绩几张。这样多岗位（主管+教师）自然并集，无需分发逻辑。

**staff 工作台卡片池**（每张标注 requiredPerm，无权限则不渲染；全空时给通用欢迎卡）：

1. 统计卡行（`student.view.all`）：在读学生数 / 潜在学生数（lead+trialing）/ 本周课次数 / 逾期待跟进数。
2. 「今日课表」卡（`schedule.view.all` 看全校 / 否则看我的）：今天 class_sessions（时间、班级、讲次名、教师）。
3. 「生源漏斗」卡（`student.view.all`）：follow_up_status 六档计数横向条（纯 div 宽度百分比，不引图表库）。
4. 「我的待跟进」卡（`followup.view`）：我名下 next_follow_up_at 逾期的学生（学辅的核心视图）。
5. 「本月业绩」卡（`finance.order.view`）：我经手订单的应收/实收合计、报名人数（学辅/主管看业绩）。
6. 「我的课与待办」卡（`class.view.mine`）：我任教班级的今日/本周课 + 待批改 + 未备课课次，每条给「课件/候课/上课」直达链接（复用 P4 路由）。
7. 「我的班级」卡（`class.view.mine`）：班级名、在读人数/容量、进度（已上/总课次）。
8. 「财务概览」卡（`finance.report.view`）：本月应收/实收/退费合计、欠费订单数。
9. 「待审退费」卡（`finance.refund.approve`）：pending 退费申请数，点击进审批。

保留既有笔记卡对所有 staff 可见；成绩卡对 staff 隐藏。

**student 首屏**：现有三卡（成绩/笔记/教室）之上加：
1. 「我的课表」卡：绑定档案后显示未来 7 天课次；未绑定显示绑定码输入框（走 `claim_student_account`）。
2. 「待交作业」卡：我所在教室 assignments 中未提交且未过期的。
3. 「我的费用」卡：我的订单状态与账户余额（走 `get_my_orders`/`get_my_account`），只读。

**parent 首屏**：
1. 未绑定孩子：绑定码输入卡（走 `bind_guardian`）。
2. 每个孩子一张卡：姓名年级、下次上课时间、近 30 天出勤率、最近作业成绩、最近课堂学情摘要（本人星星数——聚合该生 user 关联的 session_events，无账号则显示「未绑定账号，仅出勤」）、缴费状态（欠费/已缴，只读）。点击进孩子详情页（`/dashboard/children` 内 tab，复用学情聚合组件的只读版）。

## 8. 学生 360° 档案页规格（`/dashboard/students/[id]`，全后台枢纽）

三栏/三 tab（移动端 tab 化）：

1. **资料**：基本信息表单（`student.edit` 可改基本列，admin 全改）、状态徽章 + 状态变更（含 `student.assign` 才见的跟进人分配）、标签、家长信息、绑定状态（账号/家长绑定情况 + 绑定码展示，staff 可见码）。
2. **跟进**（`followup.view` 才渲染此 tab）：时间线（倒序，作者头像+类型徽章+内容+下次跟进时间），顶部快捷添加表单（内容、类型四选、下次跟进时间、跟进状态变更下拉，`followup.write` 才可提交）。这是教师与学辅的日常写入口，交互要轻（提交后乐观追加）。
3. **学习**：报名记录（班级、状态、起止）→ 课表（该生班级的未来课次）→ 学情汇总：出勤统计（present/absent/late/leave 计数与出勤率）、课堂星星总数（有账号时聚合 session_events type='star' − 'star_undo'）、作业成绩列表（submissions join assignments）。聚合逻辑写成纯函数 `src/features/school/learning.ts`，学生/家长端复用同一函数的只读渲染。
4. **费用**（`finance.order.view` 才渲染此 tab）：该生订单列表、缴费/退费记录、账户余额与流水；下单/收款/退费/发券/发奖学金按钮各按对应 `finance.*` 键显隐。

## 9. 任务拆分（每条 = 一次提交；提交前 `pnpm lint && pnpm typecheck && pnpm build`；涉及视觉的截图亮/暗 × 桌面/移动报批）

- **P4B-0 RBAC 基建与仪表盘骨架**：§5.1 migration（身份枚举扩展 + `teacher→staff` 数据迁移 + RBAC 三表 + `is_admin`/`is_staff`/`has_perm`/`staff_has_perm` 辅助 + 6 个内置岗位角色及默认权限画像种子 + 五个 RBAC RPC + 改造 `protect_profile_role` 使 `admin_set_identity` 可安全改身份）；同步迁移旧课堂硬编码：`create_classroom` 的 `profiles.role in ('teacher','admin')` 改为 `is_staff(uid)`，`requireTeacher` 保留但内部改判 `is_staff`，所有 TS `ProfileRole` 更新为 `student|parent|staff|admin`，`classroom_members.role='teacher'` 保持不变（这是教室内身份，不是 profiles 身份）；`src/features/school/permissions.ts` 定义 `PERMISSION_KEYS` 常量（§3.3 全清单）；`src/lib/auth.ts` 加 `getProfile`、`getMyPerms(uid)`、`requirePerm(locale, key)`；`nav.ts` 导航项（各带 requiredPerm）；dashboard 改造为身份分发 + staff 工作台按权限渲染卡片（本期卡片可为骨架空态）；左侧导航骨架（空页占位，但 `hasPerm` 过滤必须生效）；`staff/page.tsx`（员工列表 + 按 email 搜索 + 授岗位角色，调 `grant_staff_role`）与 `staff/roles/page.tsx`（岗位角色 × 权限键勾选矩阵，调 `set_role_permissions`）。messages `school.*` 起步。验收：admin 把某 student 提为 staff 并授「教师」岗位后，其 dashboard 出现教学卡片、`/dashboard/staff` 仍 302（无 `staff.manage`）；给「教师」角色勾上 `student.view.all` 后该员工立即能进学生列表；非 admin 员工无法授出含 `permission.configure` 的角色（RPC 拒）；`set_role_permissions` 传非法权限键被整体拒；staff 可以继续新建轻量教室，旧 `/classroom` 能用。
- **P4B-1 课程框架与种子导入**：§5.2 migration；`scripts/seed-courses.mjs` + 生成 seed SQL + SSH 执行（幂等验证：跑两遍行数不变，`courses`=72、`course_lectures`=865）；`/dashboard/courses` 列表（筛选：年级/学期/班型/状态，分页，`course.view`）与 `[id]` 详情（讲次表格：改名/增删/重排 no、objectives 编辑，`course.manage`；courseware_template 编辑**本期只留入口按钮 disabled**，模板编辑器放 P4B-3）；新建课程表单；启用/停用。无 `course.manage` 者只读浏览。验收：种子幂等；无 `course.manage` 的员工改课程被 RLS 拒；anon 读 courses 被拒。
- **P4B-2 学生档案**：§5.3 migration（含触发器与三个 RPC）；`/dashboard/students` 列表（筛选：status/follow_up_status/grade/跟进人/关键字，列：姓名/年级/状态/跟进状态/跟进人/最后跟进/下次跟进；分页；`student.view.all` 见全部、否则仅名下/我班）；新建学生表单（`student.create`）；§8 档案页「资料」+「跟进」两 tab（学习/费用 tab 空态占位）；跟进人分配（`student.assign`）。验收：仅 `student.view.assigned` 的员工只看到 assigned_to=自己或自己班的学生；student 账号直接 select students 被拒但 `get_my_students()` 返回本人白名单列；跟进插入后 students 冗余字段被触发器更新；无 `followup.view` 的员工看不到跟进 tab。
- **P4B-3 建班、报名、排课与课件模板/覆盖层**：§5.4 migration + 报名 RPC；`courseware-overlay.ts`（§4.3 resolve/校验/自愈纯函数）；课件模板编辑器（P4B-1 留的入口点亮，编辑 `course_lectures.courseware_template`，`course-assets` bucket 支持模板图片/视频页）；课次课件管理页接**覆盖层编辑**（教师只能插页/排序，UI 与服务端都禁止删改模板页，`courseware.overlay.edit`）；建班向导 `/dashboard/classes/new`：选课程（或不选=自由班）→ 班级名/容量/教室/教师 → 排课规则（开始日期 + 每周几 + 时间段 + 时长）→ 预览课次列表（每讲次一行，可单行改时间）→ 提交批量插入 class_sessions（title=讲次名、lecture_no、scheduled_at；**courseware 留空 `[]`，courseware_overlay 初始为模板页的全 ref 序列——不拷贝内容**）；`/dashboard/classes` 列表（`class.view.all`/`class.view.mine`）；班级详情 `[id]`（花名册 enrollments+classroom_members 错位标注、报名/转班/退班、课次列表可改时间/补排/删未上课次）。验收：从种子课程建班生成 10 讲课次、courseware 全空而 resolve 预览 = 模板 10 页；教研改模板后未冻结课次的预览随之变；教师给某课次插一页板书、拖动顺序，不影响同课程别的班；教师尝试删模板页/改模板页内容被服务端拒；转班后旧班行 transferred_out、新班 active；满员时 enroll RPC 拒绝。
- **P4B-4 课表视图**：`/dashboard/schedule` 周视图（CSS grid：7 列 × 时间轴行，课次块显示 时间/班级/讲次/教师；上一周/下一周/回今天；`schedule.view.all` 加教师筛选下拉）；切面（`schedule.view.all` 全校、否则本人任教、student 本人班级、parent 孩子班级——后两者经 `get_my_schedule` RPC）；同教师同时段重叠的课次块标冲突色（token 内的警示色）。验收：各身份各自只见该见的课；冲突排课出现标记。
- **P4B-5 考勤与学情**：§5.5 migration + `get_my_attendance`；班级详情/课次行加「点名」抽屉（`attendance.mark`）：按 enrollments 花名册逐人四态 upsert，**有账号且该 session 有其 user 事件的默认预填 present**；§8 档案页「学习」tab 补全（`learning.ts` 聚合纯函数 + 渲染）。验收：点名幂等（重复提交不重复计）；出勤率计算与手工数数一致；parent 经 RPC 只能拿到自己孩子的考勤。
- **P4B-6 财务模块**：§5.6 migration（八表 + 触发器重算 status/balance + 全部财务 RPC）；`/dashboard/finance` 页（子 tab：订单/收款/退费/优惠券/奖学金/账户，各按 `finance.*` 键显隐）；档案页「费用」tab（下单弹窗：选班级+课程费/教辅费明细 → 选券/奖学金 → 服务端算应收 → 建单，`finance.order.create`；收款、发起退费、审批退费、发券、发奖学金、账户预存/扣费按钮各按键显隐）；student/parent 首屏「我的费用」卡（`get_my_orders`/`get_my_account`）。验收：`place_order` 一步建单+进班、应收由服务端算（前端篡改 due 无效）；分次收款累计达应收自动 paid；退费金额超可退额被 RPC 拒；`method='account'` 收款余额不足被拒；无 `finance.refund.approve` 的员工调审批 RPC 被拒且不改数据；学生越权直读 orders 被拒、`get_my_orders` 只返回本人；账户余额 = 流水求和（并发两笔收款不错账）。
- **P4B-7 staff 工作台首屏**：按 §7 实装 staff 工作台卡片池（此前是骨架空态），每张卡服务端判 `hasPerm` 决定是否查询与渲染；统计/聚合查询在 Server Component 内 `Promise.all` 并行，单卡 try/catch 落空态。验收：校长看到全部卡、纯教师只见教学卡、学辅只见线索+业绩卡，与手工勾选的权限一致；各卡数字与 SQL 手查一致。
- **P4B-8 学生与家长端收尾与全链路验收**：student 首屏三卡 + parent 首屏与 `/dashboard/children`（§7）；`claim_student_account`/`bind_guardian` 绑定表单闭环；全后台亮/暗 × 桌面/移动回归截图报批；memory 与 roadmap 状态更新。验收：Playwright 全链路——admin 配岗位权限 → 建课建班 → 学辅报名下单收款 → 学生绑码 → 家长绑码 → 教师点名跟进 → 学生/家长各自看到课表/学情/费用；越权用例全被拒（student 调 `admin_set_identity`、无权员工调财务/权限 RPC、parent 直读 follow_ups、跨家长读别人孩子、前端篡改权限键或订单金额）。

## 10. 隐含坑清单（执行 agent 必读，08-§7 全部继续有效）

**权限 / RBAC 层（本期新增，最易错）**

- **两层别混**：RLS 永远只判「身份类 + 数据关系 + 全局查看权（`staff_has_perm`）」，**不要在 RLS 里逐个 join 权限键**（几十个键 × 每行 = 灾难）。功能级权限键在 Server Action / RPC 判。写策略时先问自己「这是行作用域还是功能开关」。
- `has_perm` 对 admin 恒真必须写进函数本体，否则给 admin 建全套 role_permissions 才是坑。
- `PERMISSION_KEYS` 是**代码常量不入库**；`set_role_permissions` 必须拿一份服务端常量对传入键做交集校验，非法键整体拒——否则管理员能给角色塞出未定义的键，前端 `hasPerm` 永假、形同虚设。
- RBAC 三表表级**只读不写**；所有授权、撤权、权限矩阵修改只走 RPC。否则有 `staff.manage` 的人可以直接 insert `staff_role_members` 绕过 `grant_staff_role` 的防提权守卫。
- 提权防线：`grant_staff_role` 里「target<>自己」与「非 admin 不得授出含 `permission.configure` 的角色」两条守卫漏任意一条，任意有 `staff.manage` 的人都可能给自己套校长角色拿全权。
- `getMyPerms` 每请求查一次并在 request 内缓存；别在每个卡片/每行里各查一次库。

**数据库层**

- `profiles_role_check` 改约束前先查现网约束名（`\d public.profiles`），drop 时名字对不上会失败。**先迁数据再改约束**：现网 `role='teacher'` 的行要在加新约束前 update 成 `staff` 并补 `staff_role_members`（挂教师岗位角色），否则新约束（无 teacher）直接拒绝旧行。
- 现有 `protect_profile_role()` 会按 `auth.role()='authenticated'` 拦截 role 更新；security definer RPC 里 `auth.role()` 仍是 authenticated。P4B-0 必须同步改造触发器或改为只阻止普通表级 update，否则 `admin_set_identity` 会天然失败。
- `profiles.role='teacher'` 迁为 `staff` 后，旧课堂/作业 SQL 与 TS 里的 teacher profile 身份硬编码要一起改；`classroom_members.role='teacher'` 不改，它表示某教室内的任课角色。
- 新增所有 RLS 辅助函数必须 `security definer + set search_path = public, pg_temp` 并 revoke/grant（照抄 classrooms migration），否则策略互查递归或被 search_path 注入。
- `teacher_of_student`/`assigned_of_student`/`has_perm` 会出现在 students/follow_ups/财务表的每行策略里，务必保证 `enrollments (student_id)`、`classroom_members (user_id)`、`staff_role_members (user_id)`、`students (assigned_to)` 索引存在，且函数体是单条 `exists`。
- 列级 grant 与 RLS 叠加：`grant update (…列) on students to authenticated` 拆「只能改基本列」；漏 revoke all 先行会导致全列可写。
- `unique nulls not distinct` 需要 PG15+；自托管版本若不支持，退回 partial unique index（migration 里写清所选方案）。
- seed SQL 与 migration 分目录；seed 幂等靠 `on conflict do nothing`，**绝不 truncate 重灌**（course_id 被 classrooms 引用后重灌会断外键）。
- RPC 返回白名单列时用 `returns table(…)` 明确列清单，不要 `returns setof students`（会把整行类型漏出去）。

**财务层（本期新增）**

- **金额一律服务端算**：`amount_due`、优惠、退费上限全在 RPC 内基于 order_items/券/奖学金推导，前端传的金额一律忽略——否则改个请求就白报名。
- **余额与订单状态是流水的派生量**：`student_accounts.balance` / `orders.status` 由触发器**按流水全量求和重算**，绝不 `balance = balance ± delta` 增量写回（并发两笔收款会丢一笔）。同 P4 星星撤销的教训。
- 账目 append-only：改错了记一条冲正流水（负 delta / void 单），**不 update 历史行、不 delete**——审计与对账靠留痕。
- `numeric(12,2)` 不用 float；比较金额用 `>=` 容差要小心浮点，全程 numeric 不转 JS number 再回写。
- 退费状态机：`request_refund` 建 pending，`approve_refund` 才动账；两步之间订单 status='refunding'，别让它被并发收款覆盖。

**业务逻辑层**

- 课件走**引用+覆盖层**（§4.3），不深拷贝：建班时 `courseware` 留空、`courseware_overlay` 存全 ref 序列；开课冻结才 resolve 落 `courseware`。覆盖层里教师**插入的新页** id 必须新生成 uuid（非安全上下文用 `newStrokeId` 同款手拼 v4）；ref 指向的模板页 id 保持不变（同一模板页在不同班的课次里共享 id 没问题——因为板书快照落在 `session_events`，按 `session_id` + page id 隔离，session_id 已不同）。
- overlay 校验必须服务端做：`ref` 集合 = 模板页 id 集合的一个排列（不多不少），天然禁止删页；违规整体拒。自愈逻辑（模板增页/删页）见 §4.3。
- 报名自动升状态只在 `lead/trialing → enrolled` 单向发生，退班**不**自动降状态（是否转「历史」由人判断）。
- 出勤预填只是预填，教师必须能改（网络在别处开着页面不等于人到了教室）。
- 周视图时区：`scheduled_at` 是 timestamptz，前端一律用用户本地时区渲染（`Intl.DateTimeFormat`），周边界按本地周一 00:00 计算；服务端查询区间由前端算好传 ISO 串，避免服务端猜时区。
- 学生列表关键字搜索用 `ilike`，注意 `%` 转义；手机号是 PII，**不写进日志、不进 URL**（筛选用 POST/searchParams 只放状态类字段）。

**前端层**

- 子导航/按钮按 `hasPerm` 显隐是 UI 便利，**每个 page.tsx 都要独立 `requirePerm`、每个 Server Action/RPC 都要服务端判权限**——直接输 URL / 直接 POST 必须被服务端挡住。前端隐藏永不等于授权。
- 列表分页用 supabase `range()`，`count: "estimated"` 够用；不要为总数发第二条精确 count 查询。
- 空态优先：每张卡/每个列表先写空态（EmptyState 组件已有），后台初期数据是稀的。
- 不引入任何新依赖（日历、图表、表格库都不要）；shadcn 组件按需 add 属于既有约定不算新依赖。
- 首屏统计聚合查询多，全部 `Promise.all` 并行；单卡失败不拖垮整页（try/catch 落空态）。

## 11. 与既有文档的关系

- `04-roadmap.md`：P4 之后插入本期（P4B），P5 标注暂缓顺延——已随本文提交修订。
- `08-p4-classroom-whiteboard.md`：其 §1「不做 CRM」非目标被本文推翻，其余（离线架构、事件流、白板）全部继续有效；本文不改动上课页既有行为。
- `03-data-and-tech.md` §3.1/§3.4：`profiles.role` 由「student/teacher/admin」升级为「student/parent/staff/admin」+ RBAC 岗位角色（本文 §3/§5.1 为准）；classrooms 系列表的扩展列以本文 §5 为准。
- `00-overview.md` §3 权限模型：教师专属能力的判定由「查 `profiles.role`」升级为「查权限键 `has_perm`」，`requireTeacher` 保留但内部改判 `is_staff`，新代码用 `requirePerm`。
