# Dashboard 路由信息架构与资源操作模型重构规划

> **规划状态**：`complete`
>
> **当前用途**：UI-L2 路由信息架构与资源操作模型竣工记录。
>
> **权威边界**：当前代码与 P4I 工作流优先于历史任务分解。
>
> **剩余项**：保持审计绿色，仅修发布阻断回归。
>
> **最后核对**：2026-07-28。

> 建议仓库路径：`docs/plan/22-dashboard-route-information-architecture-refactor.md`
> 审计基线：远端 `main`，commit `c66613f20aaf78c94f89d579a05a66a3bff4be7c`
> 适用范围：Dashboard 文件路由、导航、权限守卫、环境分派、内部链接、资源创建入口和历史兼容代码
> 规划性质：首次正式部署前的一次性 hard cut

---

## 1. 背景

### 1.1 问题最初暴露于导航双重高亮

Dashboard 当前的侧栏 active 判断基于路径前缀。

当访问：

```text
/dashboard/staff/roles
```

时，会同时匹配：

```text
/dashboard/staff
/dashboard/staff/roles
```

因此“员工”和“岗位权限”可能同时高亮。

相同问题还出现在：

```text
/dashboard/operations
/dashboard/operations/testdata
```

最初可以通过“最长路径优先”修复视觉结果，但进一步检查后发现，问题的根源不是 active 算法，而是 URL 本身表达了错误的父子关系：

- 岗位权限并不是员工详情的子页面；
- 测试数据和数据清理也不是运营页面的子页面。

这些路径主要来自多轮开发中的历史就近放置，而不是稳定的信息架构。

---

### 1.2 项目尚未正式部署，不需要保留历史 URL

当前项目还未完成初版正式部署，因此本次路由调整不承担兼容成本。

本轮采用一次性 hard cut：

```text
不保留旧 URL
不建立重定向页面
不保留旧参数兼容
不保留旧路径识别
直接删除无效目录和引用
```

这样可以避免旧路径继续误导：

- 后续 agent；
- 导航配置；
- 面包屑；
- 权限判断；
- `revalidatePath`；
- 测试与文档；
- 新页面的目录归属。

---

### 1.3 路由审计随后扩展到整个 Dashboard

对整个 Dashboard 进行审计后，发现问题不止两组双重高亮。

当前还存在：

- `/dashboard/adapt-review` 使用内部实现词作为顶层 URL；
- `/dashboard/curriculum/lectures/[lectureId]` 存在没有首页的虚假中间层；
- `/dashboard/shared-assets` 名称过于宽泛；
- `/dashboard/registration` 无法表达它实际是组织级单例注册设置；
- `/dashboard/operations` 实际展示的是系统错误和健康状态，而不是业务运营；
- `/dashboard/courses/[id]` 同时兼容 Course Family ID 与旧 Course Variant ID；
- 多个动态参数仍使用泛化的 `[id]`；
- staff、family、learning 的环境守卫与部分页面内部判断不完全统一。

因此，本项从“修复双重高亮”升级为：

> **清理 Dashboard 路由信息架构、历史兼容和错误模块命名。**

---

### 1.4 进一步复查资源生命周期后，需要避免机械补齐 `/new`

在初步整理路由树时，容易看到：

```text
students
├── import
└── [studentId]
```

而：

```text
classes
├── new
└── [classId]
```

从而认为所有拥有 `[id]` 的资源都缺少 `/new`。

但深入复查当前仓库的真实资源结构后，可以确认项目已经形成四种合理的操作模式：

```text
轻量动作            → Dialog / Popover
复杂构建            → 独立页面
从属资源            → 父对象内创建
队列 / 单例 / 工具   → 不设置 new
```

仓库中的典型例子：

- 新建学生、添加员工、新建岗位、新建活动：轻量 Dialog；
- 新建班级、批量导入学生：独立流程页；
- 新建课程版本、添加讲次、创建课次：在父对象上下文内完成；
- 跟进、今日工作、课表、课件审阅：工作队列或聚合页；
- 岗位权限、注册设置：单例配置页；
- 系统健康、数据维护：工具页。

因此，本轮不追求“每个 `[id]` 都配一个 `/new`”，而是：

1. 删除错误的父子 URL；
2. 统一模糊和历史性路由命名；
3. 明确每类资源应采用哪一种创建入口；
4. 补齐当前真正缺失的课程产品创建能力；
5. 删除未部署系统中没有价值的旧 URL 和兼容代码；
6. 让后续 agent 不再通过目录对称性错误推断产品结构。

---

## 2. 核心原则

### 2.1 URL 表达真实资源关系

路由嵌套只用于表达：

- 资源详情；
- 复杂创建或导入流程；
- 真实依赖父资源的子资源；
- 明确属于父模块的工作区。

不因代码复用、组件目录或开发便利构造虚假父子关系。

---

### 2.2 导航分组、URL 层级和代码目录彼此独立

| 层级 | 作用 |
|---|---|
| URL 层级 | 表达产品资源关系 |
| 导航分组 | 帮助用户理解功能领域 |
| 代码目录 | 帮助开发者组织文件 |
| 权限合同 | 表达访问边界 |

员工和岗位权限可以在同一“组织管理”导航组，但 URL 保持同级：

```text
/dashboard/staff
/dashboard/access-control
```

---

### 2.3 路由不追求形式对称

以下结构可以同时合理存在：

```text
students
├── import
└── [studentId]
```

```text
classes
├── new
└── [classId]
```

原因是：

- 学生单个创建只建立轻量线索档案，适合 Dialog；
- 班级创建涉及课程、教师、学辅、学期、排课和冲突检查，适合完整 Wizard。

统一的是资源语义，不是目录外形。

---

### 2.4 有详情路由不代表需要顶层创建路由

以下对象有稳定详情工作区，但只能在父对象中产生：

```text
sessions/[sessionId]
courseware/lectures/[lectureId]
courseware-assets/[assetId]
```

因此不应机械增加：

```text
/sessions/new
/courseware/lectures/new
/courseware-assets/new
```

---

### 2.5 轻量 Dialog 是正式产品设计

当操作满足以下条件时，Dialog 是长期方案：

- 字段较少；
- 不需要多个步骤；
- 不需要保存草稿；
- 不需要可分享的创建中间 URL；
- 完成后继续留在当前列表或队列；
- 操作依赖当前页面上下文。

当前继续保留：

```text
新建学生       → NewStudentDialog
添加员工       → 员工页邮箱查找 / 提升
新建岗位       → 岗位权限页内创建
新建活动       → ActivitiesManager Dialog
创建课程版本   → Course Family 内 CreateVariantDialog
记录跟进       → 学生 / 跟进队列内 FollowUpForm
```

---

### 2.6 当前明确缺失的创建路由只有课程产品

权限系统已经存在：

```text
course.product.create
```

现有课程工作区支持在 Course Family 下创建 Variant，但没有从零创建 Course Family 的入口。

本轮明确新增：

```text
/dashboard/courses/new
```

---

## 3. 页面类型与创建方式合同

建议定义：

```ts
export type DashboardRouteKind =
  | "collection"
  | "object"
  | "workflow"
  | "queue"
  | "singleton"
  | "tool";

export type DashboardCreateSurface =
  | "dialog"
  | "page"
  | "parent"
  | "derived"
  | "none";
```

### 3.1 页面类型

| 类型 | 说明 |
|---|---|
| `collection` | 资源集合，可通过 Dialog 或页面创建 |
| `object` | 稳定 ID 对象工作区 |
| `workflow` | 多步骤、批量或复杂流程 |
| `queue` | 待办、聚合、审阅或时间视图 |
| `singleton` | 组织级单例配置 |
| `tool` | 诊断、审计或维护工具 |

### 3.2 创建方式

| 方式 | 说明 |
|---|---|
| `dialog` | 在当前页面轻量创建 |
| `page` | 独立 `/new` 或专用流程页 |
| `parent` | 必须在父对象上下文内创建 |
| `derived` | 由其他业务流程自动产生 |
| `none` | 不存在普通创建行为 |

建议在：

```text
src/features/school/dashboard-routes.ts
```

统一声明：

- `href` / `hrefPattern`；
- `kind`；
- `environments`；
- `permission` / `permissionAny`；
- `createSurface`；
- `createHref` 或 `creationOwner`；
- 导航归属。

示例：

```ts
export const DASHBOARD_ROUTES = {
  students: {
    href: "/dashboard/students",
    kind: "collection",
    createSurface: "dialog",
    environments: ["staff"],
  },

  studentImport: {
    href: "/dashboard/students/import",
    kind: "workflow",
    createSurface: "none",
    parent: "students",
  },

  classes: {
    href: "/dashboard/classes",
    kind: "collection",
    createSurface: "page",
    createHref: "/dashboard/classes/new",
    environments: ["staff"],
  },

  courses: {
    href: "/dashboard/courses",
    kind: "collection",
    createSurface: "page",
    createHref: "/dashboard/courses/new",
    environments: ["staff"],
  },

  sessions: {
    hrefPattern: "/dashboard/sessions/[sessionId]",
    kind: "object",
    createSurface: "parent",
    creationOwner: "classes",
  },

  registrationSettings: {
    href: "/dashboard/registration-settings",
    kind: "singleton",
    createSurface: "none",
  },
} as const;
```

该合同用于防止后续 agent 根据目录对称性自动补路由。

---

## 4. 最终推荐路由树

```text
/dashboard
│
├── work
├── schedule
├── finance
│
├── students
│   ├── import
│   └── [studentId]
├── followups
├── activities
│
├── classes
│   ├── new
│   └── [classId]
├── sessions
│   └── [sessionId]
│
├── courses
│   ├── new
│   └── [courseFamilyId]
├── courseware
│   ├── review
│   └── lectures
│       └── [lectureId]
├── courseware-assets
│   └── [assetId]
│
├── staff
├── access-control
│
├── registration-settings
├── system-health
├── data-maintenance
│
├── children
└── assignments
```

---

## 5. 模块详细结论

### 5.1 `/dashboard`

保留。

根据当前激活环境分派：

- staff：学校工作首页；
- family：家庭首页；
- learning：学习首页。

环境切换不改变根 URL。

---

### 5.2 `/dashboard/work`

保留并纳入正式路由合同。

它是员工侧聚合工作页，包含：

- 当前最紧急工作；
- 我的任务；
- 今日课表；
- 需要关注的监督项。

它不是资源集合，不需要：

```text
/work/new
/work/[workItemId]
```

工作项应链接回真实业务对象。

施工时需明确它是长期独立工作队列，还是未来替代 staff 环境首页。本轮不合并二者。

---

### 5.3 `/dashboard/schedule`

保留。

它是跨班级、教师和课次的聚合视图。

课次创建仍属于班级上下文，不新增：

```text
/schedule/new
/sessions/new
```

继续保留：

```text
?session=[sessionId]
```

---

### 5.4 `/dashboard/finance`

暂时保留单页。

当前包含：

- 订单；
- 收款；
- 退款；
- 优惠券；
- 奖学金；
- 学生账户；
- 财务汇总。

不同对象的创建来源不同，因此 `/finance/new` 没有统一语义。

本轮只处理：

- staff / family 环境分派；
- 路由合同；
- 权限和导航。

财务页面过载与未来子路由拆分另立规划。

---

### 5.5 `/dashboard/students`

保留。

创建模型：

```text
单个学生 → NewStudentDialog
批量学生 → /students/import
```

不新增：

```text
/students/new
```

单个学生创建只建立最小线索档案，完整资料在 `[studentId]` 中维护。

---

### 5.6 `/dashboard/students/import`

保留。

这是批量导入 Workflow，包含：

- 解析；
- 行级预览；
- 校验；
- 重复判断；
- 批量提交；
- 导入结果。

---

### 5.7 `/dashboard/students/[studentId]`

保留。

代码目录从：

```text
students/[id]
```

改为：

```text
students/[studentId]
```

URL 不变。

---

### 5.8 `/dashboard/followups`

保留。

它是跨学生工作队列。

跟进记录继续从学生详情或队列行内 Dialog 创建，不新增：

```text
/followups/new
/followups/[followupId]
```

继续保留：

```text
?scope=
?bucket=
```

---

### 5.9 `/dashboard/activities`

现阶段保留单页，创建和编辑继续使用 Dialog。

当前活动创建字段仍属于轻量范围。

真正风险是页面同时承担：

- 活动列表；
- 报名；
- 出席；
- 缺席；
- 结果。

未来出现候补、通知、附件、历史或大规模报名后，再增加：

```text
/activities/[activityId]
```

即使增加详情页，新建活动仍可继续使用 Dialog。

---

### 5.10 `/dashboard/classes`

保留。

---

### 5.11 `/dashboard/classes/new`

保留，作为复杂创建流程样板。

它承载：

- 课程版本；
- 正式 / 测试用途；
- 主讲；
- 学辅；
- 运营学期；
- 排课预览；
- 课程准备度；
- 教师冲突检测；
- 立即启用判断。

---

### 5.12 `/dashboard/classes/[classId]`

保留。

代码目录从：

```text
classes/[id]
```

改为：

```text
classes/[classId]
```

---

### 5.13 `/dashboard/sessions/[sessionId]`

保留顶层 canonical object route。

课次从多个入口进入，因此需要稳定详情 URL；但创建责任属于班级。

不新增：

```text
/sessions/new
```

---

### 5.14 `/dashboard/courses`

保留。

---

### 5.15 `/dashboard/courses/new`

新增。

这是当前明确的功能缺口。

最小范围：

1. 课程产品名称；
2. 出版社 / 品牌；
3. 学段；
4. 学科；
5. 教材版本；
6. 产品描述；
7. 正式 / 测试用途；
8. 初始负责人；
9. 可选首个课程版本。

建议流程：

```text
产品身份
→ 负责人和用途
→ 可选首个版本
→ 确认创建
```

创建成功后跳转：

```text
/dashboard/courses/[courseFamilyId]
```

保留已有 `CreateVariantDialog`，不将 Variant 创建拆成独立 URL。

---

### 5.16 `/dashboard/courses/[courseFamilyId]`

保留。

代码目录从：

```text
courses/[id]
```

改为：

```text
courses/[courseFamilyId]
```

删除旧 Course Variant ID 兼容：

```text
findCourseFamilyForLegacyVariant
permanentRedirect
旧 Variant ID 自动映射
```

只接受 Course Family ID，无效 ID 直接 `notFound()`。

---

### 5.17 `/dashboard/courseware`

保留。

它是课件任务与生产工作台。

---

### 5.18 `/dashboard/courseware/review`

由：

```text
/dashboard/adapt-review
```

迁移而来。

该页面真实归属于课件生产，包括：

- 背景审阅；
- 返工；
- 页面审阅；
- 发布；
- 历史。

导航可以：

1. 只显示“课件工作台”，从内部进入审阅；
2. 或显示为“课件工作台”的视觉子项。

若审阅为可见导航项，active 匹配必须只高亮最具体项。

---

### 5.19 `/dashboard/courseware/lectures/[lectureId]`

由：

```text
/dashboard/curriculum/lectures/[lectureId]
```

迁移而来。

`curriculum` 是代码领域名泄漏，系统没有对应可见首页。

讲次继续在课程版本教学计划中创建，不新增：

```text
/courseware/lectures/new
```

---

### 5.20 `/dashboard/courseware-assets`

由：

```text
/dashboard/shared-assets
```

迁移而来。

`shared-assets` 过于宽泛，该模块实际只管理课件素材。

保持顶层，不改为 `/courseware/assets`，因为课件素材是独立侧栏入口。

---

### 5.21 `/dashboard/courseware-assets/[assetId]`

保留。

当前素材由课件流程产生，素材库负责：

- 使用范围审计；
- 预览；
- 全局替换；
- 资源治理。

不新增：

```text
/courseware-assets/new
/courseware-assets/upload
```

---

### 5.22 `/dashboard/staff`

保留。

添加员工继续使用轻量流程：

```text
精确邮箱查找已有账号
→ 必要时提升为 staff
→ 分配岗位
```

它不是直接创建一个全新账户，因此不新增：

```text
/staff/new
/staff/add
```

只有未来支持邀请未注册人员时，才规划：

```text
/staff/invite
```

---

### 5.23 `/dashboard/access-control`

由：

```text
/dashboard/staff/roles
```

迁移而来。

岗位权限是独立配置控制台，不依赖具体员工。

角色名称继续页内创建，不新增：

```text
/access-control/new
/access-control/[roleId]
```

删除：

```text
backHref="/dashboard/staff"
员工 / 岗位权限 的伪父子面包屑
```

---

### 5.24 `/dashboard/registration-settings`

由：

```text
/dashboard/registration
```

迁移而来。

当前数据模型是一套组织级注册邀请设置，而不是邀请码集合，因此不用：

```text
registration-invites
```

也不需要：

```text
/new
/[inviteId]
```

---

### 5.25 `/dashboard/system-health`

由：

```text
/dashboard/operations
```

迁移而来。

页面实际展示：

- 系统错误；
- 请求路径和方法；
- 环境；
- release；
- roster mismatch；
- 数据一致性信号。

它不是业务运营。

---

### 5.26 `/dashboard/data-maintenance`

由：

```text
/dashboard/operations/testdata
```

迁移而来。

页面包含：

- 测试数据清理；
- 零引用课件素材；
- 课程产品清理；
- 班级清理；
- 级联影响；
- 高危确认。

它是跨资源维护工具。

---

### 5.27 `/dashboard/children`

保留。

家长只能绑定已有学生，继续使用 `BindCodeForm`，不新增：

```text
/children/new
```

继续保留：

```text
?child=[studentId]
```

---

### 5.28 `/dashboard/assignments`

保留。

它是 learning 环境的任务队列，学生不从这里创建作业。

---

## 6. 旧 URL 清理

直接删除：

```text
/dashboard/staff/roles
/dashboard/operations
/dashboard/operations/testdata
/dashboard/registration
/dashboard/adapt-review
/dashboard/curriculum/lectures/[lectureId]
/dashboard/shared-assets
/dashboard/shared-assets/[assetId]
```

替换为：

```text
/dashboard/access-control
/dashboard/system-health
/dashboard/data-maintenance
/dashboard/registration-settings
/dashboard/courseware/review
/dashboard/courseware/lectures/[lectureId]
/dashboard/courseware-assets
/dashboard/courseware-assets/[assetId]
```

项目尚未正式部署，因此：

- 不创建 redirect stub；
- 不保留 route alias；
- 不保留旧路径匹配；
- 旧路径必须返回 404。

---

## 7. 明确禁止新增的路由

本轮不得仅为了目录对称新增：

```text
/dashboard/students/new
/dashboard/activities/new
/dashboard/staff/new
/dashboard/staff/add
/dashboard/access-control/new
/dashboard/sessions/new
/dashboard/courseware/lectures/new
/dashboard/courseware-assets/new
/dashboard/courseware-assets/upload
/dashboard/followups/new
/dashboard/children/new
/dashboard/assignments/new
/dashboard/finance/new
/dashboard/registration-settings/new
```

未来产品模型改变时，应先更新资源合同，再增加对应路由。

---

## 8. 导航建议

### 8.1 Staff 环境

```text
工作
├── 总览
├── 今日工作
└── 课表

学生服务
├── 跟进
├── 学生
└── 活动

教学运营
├── 班级
└── 课程

课件
├── 课件工作台
├── 课件审阅
└── 课件素材

财务
└── 财务

组织管理
├── 员工
└── 岗位权限

系统
├── 注册设置
├── 系统健康
└── 数据维护
```

### 8.2 Family 环境

```text
总览
我的孩子
课表
财务
```

### 8.3 Learning 环境

```text
总览
作业
课表
```

---

## 9. Active 匹配规则

路由清理后，以下伪父子冲突会消失：

```text
staff / access-control
system-health / data-maintenance
```

但以下真实父子结构仍存在：

```text
courseware
├── review
└── lectures/[lectureId]
```

统一规则应为：

> 找出所有可匹配导航项，选择最具体路径。

特殊规则：

- `/dashboard` 只精确匹配；
- 对象详情归属集合；
- `courseware/review` 只高亮审阅项；
- `courseware/lectures/[lectureId]` 归属课件工作台；
- 桌面与移动端共享同一 active 结果。

---

## 10. 环境合同

| 路由 | 环境 |
|---|---|
| `/dashboard` | staff / family / learning |
| `/dashboard/work` | staff |
| `/dashboard/schedule` | staff / family / learning |
| `/dashboard/finance` | staff / family |
| 学生、班级、课程、课件、组织和系统路由 | staff |
| `/dashboard/children` | family |
| `/dashboard/assignments` | learning |

建立统一：

```ts
requireDashboardEnvironment(locale, allowedEnvironments)
```

页面权限守卫在环境守卫之后执行。

`/dashboard/finance` 必须依据：

```text
activeEnvironment
```

分派，而不是固定 profile role。

---

## 11. Route Groups

本轮不强制加入大量 Route Groups。

原因：

- URL 移动本身已经有较大改动；
- Route Groups 不产生直接用户价值；
- 同时加入可能影响 layout、loading 和错误边界；
- 会增加 agent 对文件移动目的的理解成本。

推荐先完成真实 URL 清理，稳定后再评估：

```text
(student-service)
(teaching)
(courseware)
(system)
```

即使后续增加 Route Groups，也不得仅为分组增加新的 `layout.tsx`。

---

## 12. 施工阶段

### 阶段 A：冻结资源操作合同

- 将本文档加入仓库；
- 建立 `DashboardRouteKind`；
- 建立 `DashboardCreateSurface`；
- 登记所有路由；
- 明确只有 `/courses/new` 是本轮新增创建路由。

### 阶段 B：建立路由合同

新增：

```text
src/features/school/dashboard-routes.ts
```

声明：

- href；
- 页面类型；
- 环境；
- 权限；
- 创建方式；
- 导航归属。

### 阶段 C：迁移组织和系统路由

```text
staff/roles         → access-control
registration        → registration-settings
operations          → system-health
operations/testdata → data-maintenance
```

同步更新：

- 页面文件；
- nav；
- 标题；
- 面包屑；
- Link；
- router.push / replace；
- redirect；
- revalidatePath；
- 测试；
- 文档；
- 翻译。

### 阶段 D：迁移课程与课件路由

```text
adapt-review             → courseware/review
curriculum/lectures/[id] → courseware/lectures/[lectureId]
shared-assets            → courseware-assets
shared-assets/[assetId]  → courseware-assets/[assetId]
courses/[id]             → courses/[courseFamilyId]
```

### 阶段 E：新增课程产品创建页

新增：

```text
/dashboard/courses/new
```

权限：

```text
course.product.create
```

该功能应单独提交，不与大批路径移动混在同一提交。

### 阶段 F：清理参数名和历史兼容

```text
students/[id] → [studentId]
classes/[id]  → [classId]
courses/[id]  → [courseFamilyId]
```

删除：

```text
findCourseFamilyForLegacyVariant
permanentRedirect
旧 Variant ID 自动映射
旧 curriculum 路径判断
旧 shared-assets 路径判断
旧 operations/testdata 路径判断
```

### 阶段 G：统一环境守卫

修复：

- work；
- finance；
- children；
- assignments；
- 所有 staff 管理页面。

### 阶段 H：统一导航 active

实现：

- 最具体路径优先；
- Dashboard 首页只精确匹配；
- 桌面与移动端共用结果；
- 真实父子路由正确归属。

### 阶段 I：全仓清理

```bash
rg   'staff/roles|operations/testdata|/dashboard/operations|/dashboard/registration|adapt-review|curriculum/lectures|shared-assets'   src tests docs
```

预期没有有效代码命中。

---

## 13. 测试方案

### 13.1 静态检查

```bash
pnpm typecheck
pnpm lint
pnpm build
```

### 13.2 新路由访问测试

逐项验证最终路由树。

### 13.3 旧 URL 404 测试

所有旧路径必须返回 404，不得重定向。

### 13.4 创建入口测试

| 模块 | 预期创建入口 |
|---|---|
| Students | CommandPanel Dialog |
| Student import | `/students/import` |
| Classes | `/classes/new` |
| Courses | `/courses/new` |
| Course variants | Course Family 内 Dialog |
| Staff | Staff 页 Dialog / Panel |
| Roles | Access Control 页内创建 |
| Activities | Activities 页 Dialog |
| Sessions | Class 工作区内创建 |
| Lectures | Teaching Plan 内创建 |
| Followups | Student / Followup 行内 Dialog |
| Children | BindCodeForm |
| Courseware assets | 由课件流程产生 |

### 13.5 权限与环境测试

- `student.create` 才显示新建学生；
- `course.product.create` 才能访问 `/courses/new`；
- `staff.manage` 不自动获得 `permission.configure`；
- family 无法进入 staff 页面；
- learning 无法进入 children；
- finance 根据 active environment 正确分派。

---

## 14. CI 防回流

旧路由扫描：

```bash
if rg   'staff/roles|operations/testdata|/dashboard/operations|/dashboard/registration|adapt-review|curriculum/lectures|shared-assets'   src tests docs; then
  echo "Legacy dashboard routes detected"
  exit 1
fi
```

泛化参数扫描：

```bash
find 'src/app/[locale]/dashboard' -type d -name '[id]'
```

错误创建路由扫描：

```bash
if rg   '/dashboard/(students/new|staff/new|sessions/new|followups/new|children/new)'   src tests docs; then
  echo "Unsupported dashboard creation route detected"
  exit 1
fi
```

---

## 15. 完工标准

1. 最终路由树与本文一致；
2. `/dashboard/work` 纳入正式合同；
3. 所有伪父子路由已删除；
4. 旧 URL 不保留重定向；
5. 旧 URL 返回 404；
6. `staff/roles` 已迁移为 `access-control`；
7. `registration` 已迁移为 `registration-settings`；
8. `operations` 已迁移为 `system-health`；
9. `operations/testdata` 已迁移为 `data-maintenance`；
10. `adapt-review` 已迁移为 `courseware/review`；
11. `curriculum/lectures` 已迁移为 `courseware/lectures`；
12. `shared-assets` 已迁移为 `courseware-assets`；
13. 动态参数使用业务语义；
14. 课程旧 ID 兼容已删除；
15. `/courses/new` 已建立；
16. 学生创建继续使用 Dialog；
17. 员工添加继续使用已有账号查找 / 提升；
18. 课程版本继续在 Course Family 内创建；
19. 课次和讲次继续由父对象创建；
20. 未错误为队列、单例和工具页增加 `/new`；
21. 路由合同包含页面类型和创建方式；
22. 环境守卫统一；
23. finance 按 active environment 分派；
24. 导航无双重高亮；
25. CI 防回流生效；
26. `typecheck`、`lint`、`build` 全部通过。

---

## 16. 推荐提交顺序

```text
Commit 1  建立路由合同与资源操作元数据
Commit 2  迁移组织和系统路由
Commit 3  迁移课程与课件路由
Commit 4  重命名动态参数并删除历史兼容
Commit 5  新增 courses/new 课程产品创建流程
Commit 6  统一环境守卫与导航 active
Commit 7  清理测试、文档和 CI 防回流
```

---

## 17. 最终原则

本规划不追求：

```text
每个 [id] 旁边都有 new
```

而追求：

```text
每种资源都有明确、稳定、符合业务上下文的创建与管理入口
```

最终职责保持：

```text
URL      → 表达真实资源关系
导航     → 表达用户功能分组
代码目录 → 表达开发领域
权限     → 表达访问边界
创建入口 → 由操作复杂度和上下文决定
```

---

## 18. 施工记录与实际偏差（2026-07-27）

阶段 A～I 已按 §16 的顺序落地，六次提交：

```text
6b1f3fa  doc22-b  路由合同 + 三套侧栏从合同派生 + active 最长匹配
ccc5f6d  doc22-c  组织与系统路由拆平
726900b  doc22-d  课件路由归位
9850eb7  doc22-f  动态参数语义化 + 删除历史兼容 + 删除两条死路由
2ef1076  doc22-e  courses/new 课程产品创建流程（含 migration）
8aff186  doc22-g  环境守卫统一 + finance 按环境分派
```

### 18.1 与本文规划不一致、按现状修订的三处

**`/dashboard/work` 改为删除，不纳入合同（推翻 §5.2 与 §15-2）。**
本文审计基线 `c66613f` 之前，P4I-17 已经把「今日工作」转正为 `/dashboard` 员工首页，
`/dashboard/work` 当时只剩一个为老书签保留的 redirect 空壳。§5.2 描述的「员工侧聚合
工作页」实际就是现在的 `TodayWorkHome`，两者早已合并，"本轮不合并二者"这句已经过期。
既然本文同时要求「不建重定向、旧 URL 必须 404」，保留一个 redirect 空壳与该原则直接
冲突，因此按 §1.2 的 hard cut 删除。今日工作的 canonical 地址就是 `/dashboard`。

**`/dashboard/videos` 一并删除（本文未提及）。**
仓库里存在一个不分课次的全校课后视频审阅队列页，既不在 §4 路由树也不在 §6 删除清单
里，且没有任何侧栏入口、全仓零链接指向它。单课次的视频审阅一直在「课次工作区 → 课后
tab」的 `SessionPostworkPanel` 里，与点名/课评/作业/跟进并列，那才是真实入口。已确认
后删除全校页与 `listReviewVideos`；原本只挂在该页上的「管理员删除视频」（P4D-4）移到
课次课后 tab，能力不随页面消失（真正的授权始终在 `delete_session_video` RPC）。

**新增 `list_course_families` 的零版本产品分支（§5.15 的隐含前提）。**
该 RPC 原本用 `join public.courses` 聚合版本，零版本的 family 一行都不返回。§5.15 把
「首个课程版本」定为可选步骤，但不改这里的话，只填产品身份创建的产品在离开详情页之后
就再也找不到——「可选」会变成陷阱。修法是并上一条零版本分支而不是把 join 改成
left join：后者会让 grade / courseSeason / classType / variantStatus / readiness 这些
**版本级**筛选失效（筛年级 3 会列出所有产品、只是匹配版本为空）。零版本分支只在没有
任何版本级筛选时参与。

### 18.2 §8.1 导航分组已按本文重排

侧栏从 doc 19 的分组改为本文 §8.1：新增「工作」（总览、课表）与「课件」「财务」组，
课程产品从「课程研发」移到「教学运营」，并补上一直没有侧栏入口的「适配校对」
（原 `/dashboard/adapt-review`）。导航项文案沿用 doc 19/UI-L1 已签收的措辞
（研发任务 / 适配校对 / 公共资源），只改分组归属，不改用户已经熟悉的名字。

三套侧栏（员工 / 家庭 / 学习）现在全部从 `src/features/school/dashboard-routes.ts`
派生，`nav.ts` 不再是第二份 href 与权限真相。

### 18.3 代码目录未跟随 URL 改名（§2.2 的直接后果）

`src/features/courseware-studio/adapt-review-data.ts`、`adapt-review-shared.ts` 等
模块文件名保持不变。§2.2 明确代码目录只表达开发领域，与 URL 无关；因此 §14 的旧路由
扫描锚定 `/dashboard/` 前缀，不做裸词匹配。

### 18.4 CI 防回流

新增 `pnpm doc22:audit`（`scripts/verify-doc22-routes.mjs`），四条检查：

1. §6 八条旧路由不得以可执行形式回来（扫描前先把注释换成等长空白——迁移的"为什么"
   正是靠注释解释的，注释里必须能自由写出旧路径）；
2. dashboard 下不得出现泛化 `[id]` 目录；
3. §7 明确禁止的创建路由不得被补齐；
4. **路由合同与真实文件路由树一一对应**——合同写了但没建、建了但没登记都算失败。
   第 4 条是这份脚本存在的主要理由：合同一旦与现实脱节，就从护栏退化成过期注释。

同时把一直只存在于 `package.json`、从未进 CI 的 `doc21:audit` 与
`p4i1:boundary-audit` 一并接入 workflow；后者自 P4I-19 退休 `StaffHome` 起就一直失败，
已改指向 `TodayWorkHome`。

### 18.5 回归验收（2026-07-27，Playwright + 固定测试账号）

§13.2～13.5 已用真实浏览器跑通，全部通过：

- **19 条新路由**全部 200，且侧栏**有且只有一个** `aria-current="page"`——包括
  `/courseware` 与 `/courseware/review` 这一对真实父子（旧的前缀匹配正是在这里双高亮）。
- **9 条旧路由**全部 HTTP 404 且**未发生任何重定向**（`staff/roles`、`registration`、
  `operations`、`operations/testdata`、`adapt-review`、`curriculum/lectures/[id]`、
  `shared-assets`、`work`、`videos`）。
- 6 条对象详情路由（学生/班级/课次/课程产品/讲次/素材）200 且归属正确的侧栏项。
- 传 Course Variant ID 给 `/dashboard/courses/[courseFamilyId]` 得到 404 页，不再 308。
- `/courses/new` 四步流程：不勾选首个版本也能建成 → 跳转产品工作区显示标题 →
  在课程产品库里可搜到。
- 环境矩阵：family 进不了 students/classes/assignments/courseware，learning 进不了
  children/finance/students，teacher 进不了 courses/new / access-control /
  data-maintenance / registration-settings，全部踢回 `/dashboard`；`course.product.create`
  决定课程库是否显示「新建课程产品」入口。

**回归中发现并修掉的两处真实缺陷**（均是"零版本产品不可见"的同源问题）：

1. `course_families` 的 SELECT 策略同样带
   `exists (select 1 from courses where family_id = ...)`，于是零版本产品对**任何直接表读**
   都不存在——课程库能搜到（走 security definer 的 RPC），点进详情页却 404（详情页先直接
   读了一次表）。这条 exists 是可见性启发式而不是授权条件，已放开"确实一个版本都没有"
   这一种情况；全部版本都不可见（草稿/停用/回收）的产品继续隐藏。
   见 `20260727000200_doc22_childless_course_family_visibility.sql`。
2. 详情页那次直接读本身也删掉了：它当初唯一的作用是分辨"这是 family 还是 legacy variant"，
   随 §5.16 的兼容一起失去意义，RPC 抛的 `COURSE_FAMILY_NOT_FOUND` 已经接成 `notFound()`。

另外给侧栏 `<nav>` 补了 `aria-label` 与 `data-dashboard-nav`：讲次工作区会渲染自己的
`<nav>`，两个无名导航既让读屏用户分不清，也让"侧栏当前项"无法被稳定选中。

**踩坑留档**：`next build` 与常驻 `pnpm dev` 共用 `.next`，构建期间跑验收会让 dev server
的路由清单失效——表现是**所有动态段路由（`[studentId]`/`[classId]`/…）返回 Next 内建
404**，而静态路由一切正常，极易误判成"目录改名没生效"。删掉 `.next` 重启 dev server 即恢复。

**剩余人工项**：亮/暗 × 桌面/移动的逐页视觉签收（导航分组重排后的观感）。
