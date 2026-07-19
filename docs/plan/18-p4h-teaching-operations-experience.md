# Mathin 整体规划 · 18 P4H 教学运营体验重构

> **主题**：从产品使用者视角重做课程、班级、课次与多岗位工作流。
>
> **提出日期**：2026-07-19。
>
> **执行对象**：本文刻意写成低歧义实施规格，可交给低智能 Agent 逐项执行。
>
> **前置阅读（每个执行 Agent 都必须读）**：`00-overview.md`、`01-design-system.md`、`04-roadmap.md`、本文，以及当前任务直接涉及的 `10-school-backend.md`、`11-p4c-dashboard-refit.md`、`12-p4d-student-lifecycle.md` 或 `16-p6-courseware-platform.md`。禁止默认读取整个 `docs/plan/`。
>
> **与 P6 的关系**：P4H-0 是数据安全止血，可立即独立执行；P4H-1～8 必须等当前 P6 工作树被提交或隔离后再开始，并应在 P6-7 大规模扩写课程中台前完成，避免课程/班级页面重写两次。

---

## 0. 执行纪律（不得自行解释）

1. **一条任务一个提交**：P4H-0～P4H-8 每条独立提交，提交信息包含任务号。
2. **严格串行**：除 P4H-0 外，不得跳过前置任务。不得把多个任务合并成一个“大重构”提交。
3. **先保护现有改动**：开始前运行 `git status --short` 并把输出贴进任务记录。所有开始任务前已存在的修改和未跟踪文件都视为用户/P6 Agent 所有；P4H Agent 不得覆盖、回滚、移动或顺手格式化。若当前任务会修改其中任一文件，立即停止并要求先提交、隔离或明确交接。
4. **禁止物理级联删除**：业务 UI 和普通 Server Action 不得对 `courses`、`classrooms`、`class_sessions` 执行 `.delete()`。
5. **禁止权限偷渡**：主管、教研、学辅不能为了“能打开页面”被写进 `classroom_members`。该表继续只表达真实课堂成员。
6. **禁止把 403 伪装成 404**：已知对象存在但无操作权时显示权限解释或跳到管理视图；只有确实不存在或完全不可披露时用 `notFound()`。
7. **服务端边界**：列表、详情、权限和取数默认 Server Component；搜索选择器、抽屉、筛选交互是叶子 Client Component。
8. **Server Action 校验**：所有新 Action 入参必须走 zod；失败返回 `{ok:false,code:"VALIDATION"}`；权限必须服务端复核。
9. **UI 组件**：使用现有 shadcn `Button/Input/Select/Table/Dialog/AlertDialog/Command/Popover/Badge/Tabs/Tooltip`。业务代码不得新增原生 `input/select/table`，不得使用 `window.confirm()`。
10. **国际化**：所有 UI 文案同步写入 `messages/zh.json` 和 `messages/en.json`；执行 `pnpm messages:check`。
11. **数据库**：迁移只做前向追加和安全收紧；上线前用开发库重建/断言验证。不得手工改线上表后不留 migration。
12. **完成门槛**：每条任务至少运行目标测试、`pnpm lint`、`pnpm typecheck`；涉及路由/构建的任务再运行 `pnpm build`。

---

## 1. 已核实的现状与根因

| 编号 | 现状 | 代码证据 | 后果 |
| --- | --- | --- | --- |
| F1 | 建班页把第一门课程自动选中，普通 Select 一次加载全部课程 | `ClassBuildWizard.tsx` | 72+ 课程不可快速寻找，容易误选 |
| F2 | 后台班级详情只软删未开始课次；旧教室入口仍物理删除任意课次 | `school/actions/classes.ts`、`classroom/actions.ts`、`SessionActions.tsx` | 同一对象两套删除规则，存在历史事件级联丢失风险 |
| F3 | 主管在后台可读课次，但课次名链接到课堂成员专属路由 | `SessionListPanel.tsx` → `/classroom/.../session/...` | RLS 返回空后落入怪异 404 |
| F4 | 课程按原规划不提供删除，只能 disabled；页面不解释引用和影响 | `actions/courses.ts`、`CourseCrud.tsx` | 用户不知道应该“下架”而非“删除” |
| F5 | 班级有 `archived_at` 和 archive Action，但缺少完整 UI、筛选和恢复路径 | `classes.ts`、`actions/classes.ts` | 归档数据与正常班混在一起，测试班难清理 |
| F6 | 全局 404 固定给“去看图鉴” | `app/[locale]/not-found.tsx` | 后台走失时出口不符合层级直觉 |
| F7 | 权限并集被误当作对象操作权 | `getMyPerms` + 后台/课堂两套路由 | “能看全部”被错误理解为“能上这节课” |
| F8 | 教师、教研、学辅、主管共享同一张数据库式列表，默认内容不随任务变化 | `courses/page.tsx`、`classes/page.tsx` | 用户第一屏看不到自己的下一步工作 |

P4H 的目标不是给旧表格补按钮，而是统一三个概念：

- **课程**：可复用的教学产品与权威课件。
- **班级**：学生、教师、学辅、排课和进度的运营容器。
- **课次**：一次计划或已经发生的教学事实。

---

## 2. 产品目标、非目标与硬性不变量

### 2.1 产品目标

1. 任一岗位进入课程或班级页面，第一屏看到的是自己要处理的任务。
2. 后台最多两层：列表 → 详情。课次管理使用班级详情内抽屉，不新增后台第三层路由。
3. 课程选择支持名称/编码模糊搜索和年级/学期/班型筛选。
4. 主管管理、教研研发、教师授课、学辅客勤四种职责清晰分离；多人兼岗时用视角切换，不把所有动作混在一起。
5. 正常业务不物理删除课程、班级、课次；下架、归档、取消、作废都有明确语义和恢复路径。
6. 测试数据有显式标记、独立视图、批量归档和受控清理流程。
7. 无权限与不存在分开处理，404 的主要出口永远是语义上一级。

### 2.2 非目标

- 不重做 P6 课件编辑器、DocStage 或 H5 渲染器。
- 不引入第三方搜索服务；课程量级先用 PostgreSQL `ilike` + 结构化筛选。
- 不开发短信、微信、邮件实际发送集成；P4H 只提供学辅通知任务与状态记录。
- 不做永久删除正式历史数据的普通 UI。
- 不重做学生、财务、活动模块。
- 不把所有后台详情改成多层嵌套路由。

### 2.3 不变量

1. 已开课课次的 `courseware`、`courseware_resolved`、事件、板书、考勤、课评和报告必须保留。
2. 课程下架不影响已建班级；教研发布新版不影响已冻结课次。
3. 学辅不是课堂成员，默认不能订阅直播频道或读取课堂资产。
4. `course.manage` 只代表课程研发能力，不代表班级授课能力。
5. `class.view.all` 只代表管理读取，不代表进入直播。
6. 永久清理 CAS 资源只能由“零引用垃圾回收”完成，不能跟随课程/班级级联删除。

---

## 3. 最终信息架构与路由合同

```text
/dashboard
├─ /dashboard/courses
│  └─ /dashboard/courses/[courseId]
├─ /dashboard/classes
│  └─ /dashboard/classes/[classId]
├─ /dashboard/schedule
└─ /classroom/[classId]/session/[sessionId]  ← 只有真实授课/学习角色进入
```

### 3.1 禁止新增的后台路由

禁止新增 `/dashboard/classes/[classId]/sessions/[sessionId]`。后台点击课次时：

- URL 变为 `/dashboard/classes/[classId]?session=<uuid>`；
- 班级详情保持在原页面；
- Client 叶子打开课次管理抽屉；
- 关闭抽屉时移除 `session` query；
- 刷新带 query 的 URL 能重新打开同一抽屉。

### 3.2 课程页 scope

`/dashboard/courses?scope=...` 只允许：

| scope | 出现条件 | 数据集合 | 默认用户 |
| --- | --- | --- | --- |
| `research` | 有 `course.manage` | 待完善、近期将使用、全部可管理课程 | 教研 |
| `teaching` | 有教师责任关系 | 本人任教班级关联课程 | 教师 |
| `all` | 有 `course.view` 且管理范围允许 | 全部可读课程 | 主管/校长 |
| `test` | 有 `course.manage` | `purpose='test'` | 教研/管理员 |

默认选择优先级：`research` → `teaching` → `all`。用户手动切换后把最后 scope 存入 query，不新增数据库偏好表。

学辅若只有销售/跟进/班级责任而无 `course.view`，侧栏不显示课程库；课程摘要从班级详情读取。

### 3.3 班级页 scope

`/dashboard/classes?scope=...` 只允许：

| scope | 数据集合 | 默认用户 |
| --- | --- | --- |
| `teaching` | 本人为 primary_teacher/assistant_teacher，或未来课次 teacher_override | 教师 |
| `support` | 本人为 learning_support | 学辅 |
| `all` | 有 `class.view.all` 的全部班级 | 主管/教务 |
| `test` | 可管理且 `purpose='test'` | 主管/管理员 |

有合法 `scope` query 时使用该值；没有 query 时：仅管理者默认 `all`，仅学辅默认 `support`，具备 teaching 关系者默认 `teaching`，其他情况按 `all` → `support` 回落。不得为“记住视角”新增数据库字段或 localStorage。

---

## 4. 四种视角的页面合同

### 4.1 主管 / 校长

**课程库第一屏**：

- 全部课程数、已下架数、课件不完整数；
- 列表默认按“有异常优先，最近更新其次”；
- 每行显示课程使用班级数和课件完成度；
- 有 `course.manage` 才显示编辑/下架；只有 `course.view` 时只读。

**班级第一屏**：

- scope=`all`；
- 异常徽章：缺主讲、未来 7 天课件未齐、排课冲突、已结束未点名；
- 主要动作是“管理”，不是“进入课堂”；
- 点击课次打开管理抽屉；
- 只有本人也是该班教师/该课次代课教师时，抽屉额外显示“进入课堂”。

### 4.2 教研（定义：拥有 course.manage 的老师）

**课程库第一屏**：

- scope=`research`；
- 默认只看“待完善”和未来 7 天将被班级使用的课程；
- 每行突出讲次完成度、当前 release、最近将使用时间；
- 主要动作：编辑课程、编辑讲次、预览、发布、下架；
- 课程详情可打开“使用中的班级”抽屉，但不因此获得课堂操作权。

**班级第一屏**：

- 若本人没有任何教学责任，侧栏班级入口可隐藏；从课程详情的使用班级抽屉进入只读班级摘要；
- 若本人兼任教师，则显示 scope=`teaching`；
- `course.manage` 不得让其进入未任教班级的直播。

### 4.3 教师

**课程库第一屏**：

- scope=`teaching`；
- 只显示当前任教班级关联的课程；
- 行内主要信息是“下次使用该课程的课次”和“是否备好”；
- 可预览权威课程、编辑课次覆盖层；
- 没有 `course.manage` 时不得修改课程源、讲次名或 release。

**班级第一屏**：

- scope=`teaching`；
- 下一节课置顶；
- 行内主按钮随状态变化：备课 → 候课 → 继续上课 → 复盘；
- 不显示班级删除、课程下架、测试数据清理；
- 对未开始课次只可发起调课/请假工作流，不能直接取消（除非另有 `class.manage`）。

### 4.4 学辅（销售权限 + 教务协作）

**课程库第一屏**：

- 默认无独立课程库入口；
- 在班级详情只读显示课程名、年级、讲次进度和课件准备状态；
- 不显示课程编辑、release、资源库。

**班级第一屏**：

- scope=`support`；
- 每行突出：下一课时间、待通知人数、请假/补课、未点名、待跟进；
- 主要动作是“客勤与跟进”；
- 可按已有权限办理报名、转班、退班、收款和跟进；
- 不能改权威课程、不能控制直播、不能取消历史课次；
- 学辅兼教师时可在 `support` 与 `teaching` 间切换。

---

## 5. 生命周期与动作矩阵

### 5.1 课程

保留现有 `courses.status`，不新增重复的 lifecycle 字段：

| 技术状态 | 产品文案 | 可用于新建班级 | 可恢复 | 删除规则 |
| --- | --- | --- | --- | --- |
| `draft` | 草稿 | 否 | — | 无任何班级/release 引用时可移入回收站 |
| `enabled` | 可用 | 是 | — | 不可删除，只能下架 |
| `disabled` | 已下架 | 否 | 可重新上架 | 不影响既有班级 |
| `trashed_at is not null` | 回收站 | 否 | 可恢复到 draft | 仅测试/未使用草稿允许永久清理 |

课程迁移必须把 status check 扩展为 `draft|enabled|disabled`，现有数据保持原值。

### 5.2 班级

新增 `operational_status`：

| 状态 | 文案 | 允许的核心操作 |
| --- | --- | --- |
| `planning` | 筹备中 | 配课程、配教师/学辅、排课、检查资源、启用 |
| `active` | 进行中 | 日常教学、报名、调课、客勤 |
| `completed` | 已结班 | 报告、续费、只读历史、归档 |
| `archived_at is not null` | 已归档 | 只读、取消归档 |
| `trashed_at is not null` | 回收站 | 只读影响、恢复；正式历史通常不允许进入此状态 |

规则：

- 新建班级一律先保存为 `planning`；
- 资源/教师/排课检查通过后才能激活；
- `purpose='test'` 可带警告激活，但必须保留黄色测试标识；
- 有 active enrollment、订单或已开始课次的班级不能移入回收站，只能结班/归档；
- 归档不删除成员、报名、课次、作业和历史数据。

### 5.3 课次

保留现有 `deleted_at` 作为内部软取消标记，UI 永远不再称“删除”：

| 推导状态 | 条件 | UI 动作 |
| --- | --- | --- |
| 计划中 | started_at、ended_at、deleted_at 均空 | 改时间、换教师、取消 |
| 已取消 | deleted_at 非空 | 恢复、重新排期 |
| 上课中 | started_at 非空、ended_at 空 | 继续、下课 |
| 已结束 | ended_at 非空 | 报告、考勤、课评、复盘 |
| 已作废 | voided_at 非空 | 只读；从运营统计/课消中排除，历史数据保留 |

操作菜单始终存在。不能执行的动作显示 disabled + Tooltip 原因，不允许简单隐藏导致用户猜测。

---

## 6. 数据模型与数据库合同

### 6.1 migration 1：生命周期与责任关系

basename 固定为 `p4h_lifecycle_and_assignments.sql`。执行时先按文件名排序读取 `supabase/migrations/` 当前最大 migration，分配一个**严格更大且未占用**的合法 `YYYYMMDDHHMMSS` 前缀；不得复用本文编写时已经被 P6 占用的 `20260719000100`。把最终文件名写进任务记录，后续 P4H migration 依次使用更大的未占用时间戳。若同 basename 已存在，停止并报告，不得创建第二份。

必须包含：

```sql
alter table public.courses
  add column purpose text not null default 'production'
    check (purpose in ('production','test')),
  add column trashed_at timestamptz,
  add column trashed_by uuid references public.profiles(id) on delete set null;

alter table public.courses drop constraint if exists courses_status_check;
alter table public.courses add constraint courses_status_check
  check (status in ('draft','enabled','disabled'));

alter table public.classrooms
  add column purpose text not null default 'production'
    check (purpose in ('production','test')),
  add column operational_status text not null default 'active'
    check (operational_status in ('planning','active','completed')),
  add column trashed_at timestamptz,
  add column trashed_by uuid references public.profiles(id) on delete set null;

alter table public.class_sessions
  add column cancelled_by uuid references public.profiles(id) on delete set null,
  add column cancel_reason text not null default '',
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles(id) on delete set null,
  add column void_reason text not null default '';

create table public.classroom_staff_assignments (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  responsibility text not null
    check (responsibility in ('primary_teacher','assistant_teacher','learning_support')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (classroom_id,user_id,responsibility)
);
```

还必须：

- 建立 `(user_id,responsibility,classroom_id)` 索引；
- 建立每班最多一个 primary_teacher 的 partial unique index；
- 将现有 `classrooms.owner_id` 对应 teacher 回填为 primary_teacher；
- 将同班其它 teacher member 回填为 assistant_teacher；
- archived_at 非空的班级回填 `operational_status='completed'`；
- 不把任何 staff 自动回填为 learning_support；
- 给新表启用 RLS；
- select：本人 assignment、`class.view.all`、admin；
- insert/update/delete：`class.manage` 且对象作用域允许；
- 新增 `is_classroom_staff_assigned(classroom_id,user_id,responsibility default null)` SECURITY DEFINER helper；
- 给 classrooms 与 class_sessions 追加 assignment scope 的 select policy，但不向 session_events、realtime.messages、Storage 对象追加 support policy；
- learning_support 读取花名册/客勤摘要走受控查询或 RPC，不因 assignment 获得课堂事件正文；
- 不给 authenticated 直接 delete `courses/classrooms/class_sessions`；
- revoke authenticated 对 `course_lectures` 的直接 delete，保留既有受控 RPC；
- 增加注释说明 assignment 与 classroom_members 的区别。

### 6.2 migration 2：受控状态转换与影响预览

basename 固定为 `p4h_lifecycle_rpcs.sql`；时间戳使用 P4H-1 之后下一个未占用值。

新增 SECURITY DEFINER RPC：

| RPC | 权限 | 核心规则 |
| --- | --- | --- |
| `transition_course_status(course_id,target)` | course.manage | target 仅 draft/enabled/disabled；回收站课程拒绝 |
| `trash_course(course_id)` | course.manage | 仅 draft/test，且无 classrooms、class_sessions、published release 引用 |
| `restore_course(course_id)` | course.manage | 清 trashed，恢复 draft |
| `get_course_lifecycle_impact(course_id)` | course.view | 返回 lecture/release/class/session/object counts，不返回 signed URL |
| `transition_classroom_status(classroom_id,target)` | class.manage | planning/active/completed；active 前跑准备检查 |
| `archive_classroom(classroom_id,archived)` | class.manage | 只改 archived_at，历史不动 |
| `trash_classroom(classroom_id)` | class.manage | 无 active enrollment、订单、started session 才允许 |
| `restore_classroom(classroom_id)` | class.manage | 清 trashed，恢复 planning |
| `assign_classroom_staff(classroom_id,user_id,responsibility)` | class.manage | 事务内维护 assignment；教学责任同步课堂 teacher member |
| `remove_classroom_staff(classroom_id,user_id,responsibility)` | class.manage | primary 必须先有替代者；support 不触碰 classroom_members |
| `cancel_session(session_id,reason)` | class.manage | 仅未开始；写 deleted_at/cancelled_by/reason |
| `restore_session(session_id)` | class.manage | 仅未开始且已取消 |
| `void_session(session_id,reason)` | session.void | 仅已结束；保留全部子表 |

RPC 统一：

- `auth.uid()` 为空抛 UNAUTHENTICATED；
- 权限不够抛 FORBIDDEN；
- 行级范围不符抛 FORBIDDEN_SCOPE；
- 状态不符使用固定错误码，例如 SESSION_ALREADY_STARTED、COURSE_IN_USE、CLASSROOM_HAS_HISTORY、PREP_INCOMPLETE；
- 对目标行 `for update`；
- 在同一事务写 `domain_events`；
- `set search_path=public,pg_temp`；
- revoke public/anon，grant authenticated。

assignment 同步规则固定为：

- 新 primary_teacher：更新 `classrooms.owner_id`，确保同人存在 classroom_members teacher 行；旧 primary 降为 assistant_teacher，除非调用方显式移除；
- assistant_teacher：确保同人存在 classroom_members teacher 行；
- learning_support：只写 assignment，绝不写 classroom_members；
- 移除最后一条 teaching responsibility 时才删除对应 teacher member；
- 不能在没有替代者的情况下移除 primary_teacher；
- 所有 staff user 必须是 profiles.role staff/admin，否则抛 INVALID_STAFF;
- assignment 变化写 domain_events。

### 6.3 权限键

在 `src/features/school/permissions.ts` 及 migration 内只新增：

- `session.void`：默认仅 principal；admin 恒有。
- `testdata.purge`：内置岗位默认不给；admin 恒有。

不得新增“research/teacher/support view”之类岗位名权限。岗位视角由已有权限和 responsibility 关系推导。

### 6.4 TypeScript 类型

新增 `src/features/school/teaching-operations/types.ts`，集中定义：

- `CoursePurpose`
- `CourseStatus`
- `ClassroomPurpose`
- `ClassroomOperationalStatus`
- `StaffResponsibility`
- `CourseScope`
- `ClassroomScope`
- `CourseCapabilities`
- `ClassroomCapabilities`
- `SessionCapabilities`

禁止在组件内重复声明字符串 union。

数据库 migration 应用后重新生成并提交 `src/lib/database.types.ts`，再运行 `pnpm db:types:check`。

---

## 7. 能力模型合同

新增目录 `src/features/school/teaching-operations/`：

```text
types.ts
capabilities.ts
scopes.ts
course-queries.ts
classroom-queries.ts
readiness.ts
```

### 7.1 最终能力公式

```text
最终能力 = 岗位权限 ∩ 对象关系 ∩ 当前状态
```

关系判定：

- teaching：primary_teacher、assistant_teacher，或该 session 的 teacher_override；
- support：learning_support；
- management：class.view.all / class.manage；
- research：course.manage。

### 7.2 SessionCapabilities 固定字段

```ts
interface SessionCapabilities {
  canOpenManagement: boolean;
  canPrepare: boolean;
  canEnterLive: boolean;
  canReschedule: boolean;
  canAssignSubstitute: boolean;
  canCancel: boolean;
  canRestore: boolean;
  canVoid: boolean;
  canViewReport: boolean;
  canMarkAttendance: boolean;
  canWriteReview: boolean;
  reasons: Partial<Record<
    "prepare" | "live" | "reschedule" | "substitute" | "cancel" |
    "restore" | "void" | "report" | "attendance" | "review",
    string
  >>;
}
```

组件不得自行用 `startedAt` + permission 拼另一套条件；只消费 capabilities。

### 7.3 主管读取与课堂读取

- 后台管理查询可以由 class.view.all / report.view.all 读取汇总。
- `/classroom` 路由继续依赖课堂成员/真实授课关系。
- 不修改 `getSessionAssetUrls` 的“教室成员”安全边界。
- 不给主管、教研、学辅签发课堂资产 URL。

---

## 8. 页面与组件合同

### 8.1 课程列表

目标文件：

- 改 `src/app/[locale]/dashboard/courses/page.tsx`
- 改 `src/features/school/courses.ts`
- 新增 `src/features/school/teaching-operations/CourseScopeSwitch.tsx`
- 新增 `src/features/school/teaching-operations/CourseFilters.tsx`
- 新增 `src/features/school/teaching-operations/CourseList.tsx`

页面规则：

1. 搜索覆盖 title、product_code、lecture name。
2. 常驻筛选：q、grade、term、classType、status。
3. “更多筛选”：purpose、readiness。
4. 查询参数白名单；非法 scope 回落，不报错。
5. 每行字段固定：title/code/grade+term+type/lecture readiness/class count/status/updated_at。
6. 排序：readiness 有异常在前，再 updated_at desc。
7. 整行可点击；右侧只放权限允许的 overflow actions。
8. 无结果空态保留当前筛选，并给“清除筛选”。
9. 移动端改卡片列表，不强塞宽表。

### 8.2 课程详情

改 `src/app/[locale]/dashboard/courses/[id]/page.tsx`，保持单页：

1. 顶部摘要；
2. 主区讲次列表；
3. “使用中的班级”用 Dialog/Sheet，不建新路由；
4. “变更记录”用折叠区；
5. 危险区只显示下架/恢复/移入回收站；
6. 操作前先调用影响预览；
7. 课程有引用时不显示“永久删除”，解释只能下架。

### 8.3 可搜索 CoursePicker

新增 `src/features/school/teaching-operations/CoursePicker.tsx`：

- 使用 Command + Popover；
- 初始无选中值；
- 输入防抖 250ms；
- 服务端最多返回 30 条；
- 搜索 title/product_code；
- 快捷筛选 grade/term/classType；
- 默认只查 enabled 且 trashed_at 为空；
- purpose=test 仅 test 建班模式可见；
- 每项显示 title、code、grade/term/type、ready/total；
- 不完整项黄色 Badge，但仍可选；
- 键盘上下/Enter/Escape 可用；
- 空结果显示“未找到课程”，不得自动新建课程。

### 8.4 建班向导

重构 `ClassBuildWizard.tsx`，固定四步：

1. 选择课程：CoursePicker 或显式“自由班”次要入口；
2. 班级信息：名称、主讲、学辅、容量、教室、正式/测试；
3. 排课：起始日、星期、时间、时长、逐课调整、冲突提示；
4. 确认：课程完整度、教师冲突、课次数、测试标记。

规则：

- 不默认选择第一门课程或第一位教师；
- 选择课程后班名只填 placeholder，不强写值；
- 切换课程必须清空旧 lecture overrides，并提示一次；
- 提交创建 planning 班；
- 检查全绿时可勾选“创建后立即启用”；
- 正式班准备不完整时不能立即启用；
- 测试班可带警告启用；
- 提交失败保留全部输入；
- 成功跳班级详情。

### 8.5 班级列表

目标文件：

- 改 `src/app/[locale]/dashboard/classes/page.tsx`
- 改 `src/features/school/classes.ts`
- 新增 `ClassroomScopeSwitch.tsx`
- 新增 `ClassroomFilters.tsx`
- 新增 `ClassroomList.tsx`

筛选：

- q（班级名/课程名/产品码）
- teacher
- support
- grade
- operational status
- purpose
- readiness/anomaly

每行固定字段：

- 班级 + 正式/测试 Badge
- 配套课程
- 主讲 + 学辅
- active enrollment / capacity
- ended / total sessions
- next session
- readiness
- anomaly badges
- 与当前视角匹配的主动作

禁止用同一个“打开”链接承担所有角色。

### 8.6 班级详情与课次抽屉

班级详情只保留四个轻量 Tab/锚点：

- sessions
- students
- readiness
- records

默认 Tab：

- teaching → sessions
- support → students
- all → sessions + 顶部异常摘要

课次行点击：

- teaching 且 canPrepare/canEnterLive：主按钮进入教学路由；
- management/support：设置 `?session=id` 打开 `SessionManagementDrawer`；
- research：默认不从班级列表进入课次；从课程侧只看使用摘要。

抽屉分区不嵌套：

1. 状态、时间、主讲/代课；
2. 课件准备；
3. 考勤/客勤摘要；
4. 报告/课评；
5. 当前 capabilities 对应动作。

### 8.7 404 与无权限

新增 `src/components/not-found-actions.tsx` Client 叶子：

- 用项目 i18n `usePathname`；
- 去掉 locale 后删除最后一个路径段；
- 没有业务段时 parent=`/`；
- 主按钮“返回上一级”，次按钮“返回首页”；
- 不使用 `router.back()`，避免直达链接无历史。

改全局 `not-found.tsx` 移除图鉴 CTA。

已知业务详情继续通过 `SchoolPageHeader.backHref` 给精确上级。

新增 `AccessBoundaryNotice`：

- 对象存在但当前用户只能管理查看时，提供管理视图；
- 对象存在但完全无权时显示统一无权限文案；
- 不泄露课程资源 URL、学生隐私或课堂事件正文。

---

## 9. 学辅任务模型

P4H 不接第三方通知，但必须能记录任务闭环。

固定 basename：`p4h_support_tasks.sql`，时间戳使用当时下一个未占用值，归 P4H-6 执行：

```sql
create table public.class_support_tasks (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  session_id uuid references public.class_sessions(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  kind text not null check (kind in (
    'preclass_notice','absence_check','makeup_followup','postclass_followup'
  )),
  status text not null default 'pending'
    check (status in ('pending','done','skipped')),
  due_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  note text not null default '',
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
```

规则：

- learning_support 只读/写自己负责班级的任务；
- class.view.all 可读全校；
- followup.write 才能完成课后跟进；
- attendance.mark 或 class.manage 才能处理客勤异常；
- 不自动发送任何外部消息；
- 完成任务写 domain_events；
- 首期任务可由课次创建/变更流程生成，不做定时 cron。

---

## 10. 任务拆分表

### P4H-0 · 数据安全止血与错误出口（立即执行）

**依赖**：无；但不得覆盖 P6-5 dirty files。

**只做**：

1. 新增 basename 为 `p4h_delete_guard.sql` 的 migration，按 §6.1 的规则分配未占用时间戳，revoke authenticated 对 courses/classrooms/class_sessions/course_lectures 的直接 DELETE；
2. 删除 `classroom/actions.ts` 的物理 `deleteClassSession`；
3. 旧 `/classroom/[id]` 页面移除 DeleteSessionButton；
4. 后台课次名暂时不再跳成员专属路由；P4H-5 再接抽屉；
5. 全局 404 改“上一级 + 首页”；
6. 增加回归测试或静态断言，确保业务源码没有 `.from("class_sessions").delete()`。

**禁止**：本任务不改数据库生命周期、不重做列表、不做 CoursePicker。

**验收**：

- `rg -n 'from\\("class_sessions"\\).*delete|from\\("courses"\\).*delete|from\\("classrooms"\\).*delete' src` 零命中；
- 已结束课次无删除按钮；
- 主管点击后台课次不进入课堂 404；
- 未知三级路径的 404 主按钮到二级路径；
- lint/typecheck/build 全绿。

### P4H-1 · 生命周期 migration 与 assignment 地基

**依赖**：P4H-0。

**执行**：§6.1 migration、权限键、数据库类型、基础 TS union。

**验收**：

- 原 72 courses 行数不变；
- 原 classrooms/class_sessions 行数不变；
- owner teacher 均有 primary_teacher assignment；
- learning_support 回填 0 行；
- 正式表无物理 delete grant；
- DB rebuild、types check、lint/typecheck 全绿。

### P4H-2 · 状态 RPC、影响预览和 capabilities

**依赖**：P4H-1。

**执行**：`6.2、`7。

**测试文件**：

- `tests/p4h-lifecycle.test.ts`
- `tests/p4h-capabilities.test.ts`
- `supabase/tests/p4h_teaching_operations_assertions.sql`

**必测矩阵**：

- manager 非教师：canOpenManagement=true，canEnterLive=false；
- research 非教师：canEditCourse=true，canEnterLive=false；
- teacher 本班：canPrepare/live=true；
- support：canOpenManagement=true，prepare/live=false；
- 未开课可取消/恢复；
- 已开课取消拒绝；
- 课程被班级引用时 trash 拒绝；
- 正式历史班级 trash 拒绝；
- void 保留 session_events 行数。

### P4H-3 · 课程列表与课程详情

**依赖**：P4H-2。

**执行**：`8.1、`8.2。

**验收角色**：principal、research、teacher、sales/support。

**验收**：

- research 默认 research scope；
- teacher 只见任教课程；
- support 无 course.view 时侧栏无课程入口；
- search 同时命中课程名/编码/讲次名；
- course.manage 无引用草稿可回收；
- 有引用课程只能下架；
- 移动端 390px 无横向滚动；
- zh/en 文案齐全。

### P4H-4 · CoursePicker 与建班向导

**依赖**：P4H-3。

**执行**：`8.3、`8.4。

**验收**：

- 初始课程/教师均未选择；
- 输入产品码 3 个字符能在 500ms 内得到结果；
- 年级/学期/班型组合筛选正确；
- 切换课程清空旧排课 override；
- 正式不完整课程只能建 planning；
- test 班带明确 Badge；
- 服务端仍校验 course enabled/purpose/teacher；
- 直接伪造 disabled production courseId 被拒；
- 创建成功后 primary_teacher 与 learning_support assignment 正确，support 未进入 classroom_members；
- 全流程键盘可操作。

### P4H-5 · 班级列表、班级详情与课次抽屉

**依赖**：P4H-4。

**执行**：`8.5、`8.6。

**验收**：

- 主管默认 all，教师默认 teaching，学辅默认 support；
- 多岗位可切换且 query 可分享；
- 主管课次打开管理抽屉，不进入课堂；
- 教师本课次出现备课/上课；
- support 只见负责班；
- cancelled 课次在“已取消”折叠组，可恢复；
- 已结束课次没有取消；
- 禁用动作都有原因；
- 无后台第三层 session route。

### P4H-6 · 教研/教师/学辅/主管工作台接缝

**依赖**：P4H-5。

**执行**：

1. `classroom_staff_assignments` 管理 UI；
2. 学辅任务表与任务卡；
3. dashboard 磁贴链接带正确 scope；
4. 教研磁贴进 research scope；
5. 教师磁贴进 teaching scope；
6. 学辅磁贴进 support scope；
7. 主管异常磁贴进 all scope。

**禁止**：不实现外部通知发送。

**验收**：

- 同一账号 research+teacher 两个视角都存在；
- sales+learning_support 看得到客勤任务和负责班；
- support 不进入直播、不拿 asset URL；
- 移除 learning_support assignment 后相应班级立即消失；
- principal+teacher 可以管理全校，也只能进入自己授课课次。

### P4H-7 · 测试数据视图、回收与受控清理

**依赖**：P4H-6。

**执行**：

- courses/classes 的 test scope；
- 批量归档测试班；
- 影响预览；
- admin-only 永久清理入口；
- CAS 零引用报告，首期只报告不自动删除 Storage。

**永久清理前确认**：

- 必须输入对象显示名；
- 二次显示将删除的 metadata 计数；
- 有 production 引用则整体拒绝；
- 写 domain_events；
- 清理失败必须事务回滚；
- 不允许前端循环逐行 delete。

**验收**：

- 正式数据不会出现在 test scope；
- 测试班批量归档可逐一恢复；
- 共享资源不被删除；
- 无 testdata.purge 者看不到且直调被拒；
- 清理一套无引用 test course+class 后正式课程/班级/资源计数不变。

### P4H-8 · 全角色 E2E、旧入口收口与文档完成

**依赖**：P4H-7。

**执行**：

1. 全局 grep 删除旧 delete/archived 双逻辑；
2. 旧 classroom 页面只保留教学动作；
3. 更新 `04-roadmap.md` 状态；
4. 更新 `.claude/test-accounts.local.md` 的第二学生与岗位组合说明（本地文件，不提交）；
5. 添加 P4H DB audit 脚本和 package script；
6. 真实浏览器走全角色矩阵。

**E2E 路径**：

1. principal：课程库 all → 班级 all → 课次抽屉 → 无直播按钮；
2. research：待完善课程 → 讲次编辑/预览 → 使用班级摘要；
3. teacher：我的班级 → 备课 → 候课/上课；
4. support：负责班级 → 课前通知 → 客勤异常 → 课后跟进；
5. multi-role：scope 切换不串数据；
6. test：建测试班 → 带不完整课程 → 归档 → 恢复 → 管理员清理；
7. 404：课程/班级/课次各自返回正确上级。

**最终命令**：

```powershell
pnpm lint
pnpm typecheck
pnpm messages:check
pnpm db:types:check
pnpm exec vitest run tests/p4h-lifecycle.test.ts tests/p4h-capabilities.test.ts
pnpm build
```

---

## 11. 完整权限矩阵

| 动作 | 主管 | 教研 | 教师 | 学辅 |
| --- | --- | --- | --- | --- |
| 查看全部课程 | course.view | course.view | 默认仅任教关联 | 默认无入口 |
| 修改课程源 | 有 course.manage 时 | 是 | 兼教研时 | 否 |
| 发布 release | 有 release.publish 时 | 是 | 兼教研时 | 否 |
| 查看全部班级 | class.view.all | 否；只看课程使用摘要 | 否 | 否 |
| 查看本人任教班 | 若有教学关系 | 若有教学关系 | 是 | 若兼教师 |
| 查看本人负责班 | 若有 support 关系 | 若有 support 关系 | 若兼学辅 | 是 |
| 建班/改排课 | class.create/class.manage | 默认否 | 默认否 | 有教务权限且在范围内 |
| 报名/转班/退班 | enrollment.manage | 默认否 | 默认否 | 是 |
| 备课/进入直播 | 仅真实授课关系 | 仅真实授课关系 | 是 | 仅兼教师 |
| 查看全部报告 | report.view.all | report.view.all | 本人任教 | 负责班摘要 |
| 课前通知/课后跟进 | 可监督 | 默认否 | 可写教学跟进 | 是 |
| 取消未开课课次 | class.manage | 默认否 | 默认发起申请 | 有教务权限时 |
| 作废已结束课次 | session.void | 默认否 | 否 | 否 |
| 永久清理测试数据 | admin/testdata.purge | 否 | 否 | 否 |

多岗位权限取并集，但直播/备课仍必须命中对象 teaching 关系。

---

## 12. 文案与错误码清单

### 12.1 必备中文概念

- 课程库、我的教学内容、教研任务、使用中的班级
- 草稿、可用、已下架、测试、回收站
- 筹备中、进行中、已结班、已归档
- 我的授课、我负责的班级、全部班级、测试数据
- 主讲教师、助教、学辅
- 取消课次、恢复课次、作废课次
- 课件准备完成度、准备不完整
- 管理视图、授课视图、客勤与跟进
- 返回上一级、返回首页

### 12.2 固定错误码

- COURSE_IN_USE
- COURSE_TRASHED
- COURSE_NOT_ENABLED
- CLASSROOM_HAS_HISTORY
- CLASSROOM_HAS_ACTIVE_ENROLLMENTS
- CLASSROOM_PREP_INCOMPLETE
- SESSION_ALREADY_STARTED
- SESSION_NOT_CANCELLED
- SESSION_ALREADY_VOIDED
- FORBIDDEN_SCOPE
- INVALID_TRANSITION
- TESTDATA_HAS_PRODUCTION_REFERENCE

UI 只能针对这些已知码映射具体文案；未知码走统一 actionFailed。

---

## 13. 查询与性能约束

1. 列表每页 20 行；搜索最多返回 30 个课程候选。
2. readiness、班级数、下一课次必须批量聚合，不允许逐行 N+1。
3. 搜索串截断 80 字并转义 `% _ \\`。
4. 课程列表查询不得下发 page doc、bindings、signed URL。
5. 班级列表不得下发 roster 全量，只返回 count。
6. 管理抽屉按单课次懒取详情。
7. CoursePicker 首次不加载 865 讲明细。
8. 任何新 client bundle 前后执行 `pnpm bundle:report`；列表页不得因引入课程编辑器而显著变大。

---

## 14. 数据回填、上线与回滚

### 14.1 回填

- courses.purpose 全部 production；
- classrooms.purpose 全部 production；本地固定测试班由 P4H-7 migration 后单独标 test，不把本地 ID 写入 migration；
- classrooms.operational_status：archived → completed，其余 → active；
- owner teacher → primary_teacher；
- 其他 teacher members → assistant_teacher；
- 不猜 learning_support。

### 14.2 上线顺序

1. P4H-0 revoke delete；
2. schema migration；
3. RPC/capabilities；
4. 新 UI；
5. scope/dashboard；
6. test cleanup；
7. E2E。

不得先上线依赖新列的 UI 再补 migration。

### 14.3 回滚原则

- P4H migration 不删除旧列；
- 新列有默认值，旧代码可继续读；
- assignment 新表可停用而不影响 classroom_members；
- revoke DELETE 如需紧急回滚，只能通过新 migration 恢复，不手工 grant；
- 已写入的 cancelled/voided/history 不回滚删除。

---

## 15. Definition of Done

P4H 只有同时满足以下条件才能标完成：

- 课程、班级后台最多两层；
- 建班课程选择可模糊搜索和筛选；
- 主管、教研、教师、学辅默认视角符合 §4；
- 多岗位 scope 切换正确；
- 主管管理课次不再落课堂 404；
- 业务源码不存在课程/班级/课次物理 delete；
- 课程下架不影响既有班级；
- 测试数据独立且可恢复；
- 已完成课次不可取消但可受控作废；
- support 无直播/资产权限；
- 404 返回上一级；
- DB assertions、Vitest、lint、typecheck、messages、build 全绿；
- roadmap 与本文件进度同步；
- 每个 P4H 子任务有独立提交和验收记录。

---

## 16. 遇到以下情况必须停止并询问用户

1. 发现 production 数据已经依赖物理删除才能维持业务；
2. 需要删除或重绑 P6 已发布 release/CAS 对象；
3. 一个班级必须支持多个 primary_teacher；
4. 学辅需要真实发送短信/微信/邮件；
5. 需要让主管实时旁听课堂；
6. 需要把 learning_support 加入 classroom_members；
7. 测试数据与正式数据无法可靠区分；
8. 永久清理影响到 production 引用；
9. 计划 basename 已存在，或无法分配严格递增且未占用的 migration 时间戳；
10. 当前工作树仍有未提交 P6-5 改动且任务会改同一文件。

除此之外，按本文固定决策执行，不再让执行 Agent 自行重新设计产品。
