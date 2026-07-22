# Mathin 整体规划 · 19 P4I Final：学校端工作台、课程研发与教学运营重构

> **状态**：最终执行规范。  
> **编号**：P4I / `docs/plan/19-p4i-final.md`。  
> **提出日期**：2026-07-20。  
> **适用范围**：员工工作台、课程研发、课程产品、讲次课件、班级、课次、课表、备课、课后闭环及其与学辅/家庭摘要的数据接缝。  
> **执行方式**：P4I-0～P4I-19 严格串行，一项一个提交。
>
> 本文合并并取代 P4I-A v0.1～v0.5 的全部临时决策稿。执行 Agent **只读本文，不再串联读取临时稿**。
>
> 当本文与 `18 P4H 教学运营体验重构` 在导航、页面归属、课程 scope、制作工作台、讲次详情、课次入口、多岗位视角或员工首页方面冲突时，**本文优先**。P4H 已落地的数据生命周期、安全不变量、历史保留和 assignment 能力继续保留。
>
> P6 的 DocStage、页 revision、讲 release、资源 binding、H5 运行时、CAS 和双轨数据语义保持不变；P4I 只重构它们的业务工作流、入口、壳层、权限作用域和返回链路。

---

# 0. 最终结论

Mathin 学校端最终采用：

```text
任务入口
→ 唯一对象工作区
→ 专用工具
→ 返回原对象
```

而不是：

```text
数据库模块
→ 多套列表
→ 多套详情
→ 每个页面各自决定按钮和返回链路
```

最终产品分为五个使用环境：

```text
公开数学世界
学习门户
家庭门户
员工工作台
课堂 / Studio 等专用工具
```

员工后台按工作领域组织：

```text
今日工作

学员服务
├─ 学生
├─ 跟进
└─ 活动

教学运营
├─ 班级
└─ 课表

课程研发
├─ 研发任务
├─ 课程产品
├─ 适配校对
└─ 公共资源

财务

组织管理
├─ 员工
└─ 岗位权限

系统
├─ 运行与错误
└─ 测试数据
```

核心对象只有一个“家”：

| 对象 | 唯一工作区 |
| --- | --- |
| 学生 | 学生 360° 工作区 |
| 课程产品 | 产品、版本、教学计划、使用与责任 |
| 讲次 | 教学目标、权威课件、制作校对发布、使用情况 |
| 班级 | 学生、员工、下一课、课次、教学准备、运营记录 |
| 上课课次 | 课前、课堂、课后完整生命周期 |
| 订单/退款 | 对应财务对象工作区 |

---

# 1. 背景与根因

现有实现已经具备大量业务能力，但产品结构由工程对象持续叠加形成：

- `/dashboard/courses` 表示课程；
- `/dashboard/courseware` 又形成一套制作课程目录；
- `/dashboard/classes` 管理班级和课次；
- `/classroom/.../session/...` 同时承担备课和课堂入口；
- 员工首页将学生、课表、财务、课程、课评、视频和学辅任务全部放进可自由排布的磁贴池；
- 多岗位用户通过默认 role 画像或 scope 切换决定第一屏；
- 同一个课次行会因权限分别跳向课堂、管理抽屉或不可点击；
- 课次抽屉同时承担调课、代课、轨道、点名、课评、取消和作废。

根本问题不是卡片太大或筛选过多，而是：

1. 用户的连续任务被拆成多个工程模块；
2. 同一个对象没有稳定工作区；
3. 访问范围、工作视图、筛选和对象上下文混为一体；
4. 员工首页无法区分任务、异常与指标；
5. 多岗位用户被迫选择一个“最像的角色”；
6. 课件制作、校对、发布和课堂实际使用没有形成清晰闭环。

---

# 2. 产品原则

## 2.1 任务是入口，对象是上下文，工具是临时模式

- 今日工作和研发任务负责找到当前工作；
- 对象工作区负责理解状态、关系、影响和下一步；
- Studio、Classroom、排课和批量工具负责高专注操作；
- 工具退出后回到原对象，而不是模块首页。

## 2.2 一个对象只有一个 canonical 工作区

列表、搜索、任务、日历和异常都只能深链到同一个对象。

禁止：

- 课程页一套讲次详情；
- 制作任务一套讲次详情；
- Studio 再实现一套业务详情；
- 教师和主管点击同一课次却进入完全不同的对象。

## 2.3 权限决定能做什么，关系决定能对什么做

最终能力 = 身份类 + 岗位权限 + 对象关系 + 当前状态。

示例：

- `courseware.page.edit` 不等于能编辑全机构所有讲次；
- `class.view.all` 不等于课堂成员；
- 学辅 assignment 不等于实时课堂权限；
- 主管能审阅课次事实，不因此加入 `classroom_members`。

## 2.4 同一对象结构稳定，角色只改变焦点和动作

不为主管、教师、教务和学辅复制不同班级页。

同一个班级工作区保持：

```text
课次 / 学生 / 教学准备 / 运营记录
```

但：

- 教务默认聚焦课次和花名册；
- 教师默认聚焦下一课和学生；
- 学辅默认聚焦通知、请假和补课；
- 主管默认聚焦异常。

## 2.5 不使用全局岗位模式切换

用户不需要切换：

```text
我是主管 / 我是教师 / 我是教研
```

多岗位任务直接合并。

允许的只是工作集合筛选：

```text
全部 / 教学 / 课程研发 / 学员服务
```

这不改变权限、对象结构或身份，只缩小任务列表。

## 2.6 访问范围、工作视图、筛选、上下文必须分离

| 概念 | 含义 | UI |
| --- | --- | --- |
| 访问范围 | 用户依法能读取哪些对象 | 服务端/RLS，通常不显示 |
| 工作视图 | 当前要处理哪类工作 | 今日工作区块或任务 Tab |
| 数据筛选 | 缩小一个明确集合 | 搜索与筛选 |
| 对象上下文 | 同一对象内部切换子对象 | 版本/孩子/课次选择器 |

`教研 / 我的教学 / 全部 / 测试` 不再作为同一排课程 scope。

## 2.7 对象上下文镜头不是角色模式

同一对象可从不同业务入口进入，并使用不同默认焦点：

```text
production   课程制作
teaching     当前教学使用
management   管理审阅
support      学辅服务
family       家庭可见
learning     学生学习
```

规则：

- 镜头只决定默认展示和信息优先级；
- 不扩大权限；
- 不复制页面；
- 从课次进入讲次，首先展示本次冻结的使用版本；
- 从研发任务进入讲次，首先展示当前制作与校对状态。

---

# 3. 使用环境与跨环境切换

## 3.1 公开数学世界

面向未登录访客和公共学习：

- Story
- Games
- Minds
- Terms
- Tools

不出现学校运营信息。

## 3.2 学习门户

面向学生：

- 下一节课；
- 进入课堂；
- 作业；
- 讲题视频；
- 学习反馈；
- 课程进度。

## 3.3 家庭门户

面向家长：

- 孩子；
- 下一节课；
- 课前通知；
- 请假与补课状态；
- 家庭可见课后摘要；
- 作业；
- 缴费与续费。

## 3.4 员工工作台

面向主管、教务、教研、教师、学辅、财务和管理员。

## 3.5 专用工具

- Classroom；
- Studio；
- 排课工具；
- 批量导入；
- 权限矩阵；
- 财务对账。

## 3.6 员工兼家长

同一账号可以同时是 staff/admin，并通过 `student_guardians` 关联孩子。

顶部账号菜单提供：

```text
工作台
家庭
```

若账号同时具有学生身份或测试学习身份，可再提供：

```text
学习
```

这是**环境切换**，不是岗位切换。

规则：

- 默认回到上次使用环境；
- 工作任务不混入家庭门户；
- 孩子缴费、请假和家庭反馈不混入员工今日工作；
- 每个环境使用自己的导航和数据白名单。

---

# 4. 员工导航

导航分组顺序稳定，不按岗位重排。

无权领域整组隐藏；有多个岗位时显示权限并集。

```text
今日工作

学员服务
├─ 学生
├─ 跟进
└─ 活动

教学运营
├─ 班级
└─ 课表

课程研发
├─ 研发任务
├─ 课程产品
├─ 适配校对
└─ 公共资源

财务

组织管理
├─ 员工
└─ 岗位权限

系统
├─ 运行与错误
└─ 测试数据
```

取消左侧平级入口：

```text
课程
制作工作台
班级
课表
```

其中：

- 研发任务负责找到工作；
- 课程产品负责浏览和管理课程；
- Studio 是具体讲次的专用工具；
- 测试数据归系统，不是课程 scope。

---

# 5. 角色工作流

## 5.1 主管

### 打开后台的动机

- 处理需要本人决定的事项；
- 发现近期教学和经营风险；
- 分配责任；
- 确认委派问题没有失控。

### 今日工作结构

```text
需要我决定
已委派待关注
需要关注
经营概览入口
```

### 典型流程

```text
今日工作
→ 发现“明天使用但无负责人”的讲次
→ 打开讲次工作区
→ 分配 Owner / Editor / 校对人
→ 任务变为已委派观察
→ 临近截止仍未推进时重新浮现
```

主管可以审阅课堂事实，但不会因此加入课堂成员或实时频道。

## 5.2 教研 + 教师

### 时间结构

- 教学任务：固定时间、不可错过；
- 研发任务：弹性时间、有截止。

### 规则

- 距本人上课 ≤30 分钟，教学任务进入“现在”；
- 固定教学任务优先于普通研发任务；
- 从研发任务进入讲次使用 production 镜头；
- 从课次进入讲次使用 teaching 镜头；
- 未发布草稿不能进入课堂；
- 已备课课次继续使用冻结 release。

## 5.3 教师

```text
今日工作
→ 下一节课
→ 课次工作区
→ 开始/继续备课
→ 完成备课并冻结
→ 候课
→ Classroom
→ 课后点名、课评、总结
→ 完成本次课
```

教师可以编辑本次课覆盖层，不能修改权威课程。

## 5.4 学辅

```text
今日工作
→ 课前通知
→ 班级客勤视角
→ 逐个学生/家长记录通知与确认

课后
→ 缺勤确认
→ 学生服务视角
→ 记录原因并发起补课协作

回访
→ 查看家庭可见摘要
→ 联系家长
→ 写沟通记录
```

学辅默认不进入课程研发，不读取草稿、校对意见和内部教师评语。

## 5.5 家长

```text
家庭门户
→ 选择孩子
→ 查看下一课
→ 确认通知或提交请假
→ 查看家庭可见课后摘要
→ 查看作业、补课和费用
```

家长不能直接修改排课；请假是请求，进入学辅/教务工作流。

## 5.6 学生

```text
学习门户
→ 下一节课
→ 进入课堂
→ 查看课后总结
→ 完成作业
→ 录制讲题视频
→ 查看教师反馈
```

P4I 建立学生/家庭所需数据边界；完整学习与家庭门户由后续 P4J 实施。

---

# 6. 今日工作

## 6.1 员工首页退出可拖拽磁贴墙

员工默认首页改为：

> **今日工作**

关键任务不能被用户通过磁贴尺寸、拖动或隐藏移出视野。

学生和家长门户可以继续使用卡片式布局；本决定只针对 staff。

## 6.2 页面结构

```text
现在
我的工作
今天的安排
需要关注
```

### 现在

最多显示 3 个对象工作组，仅包含：

- 本人正在进行的课；
- 距本人授课 ≤30 分钟；
- 24 小时内会阻塞真实教学的异常；
- 需要当前用户即时决定的严重事项。

### 我的工作

- 明确指派给本人；
- 本人是 owner/editor/当前校对人；
- 本人是主讲/助教/学辅；
- 本人是学生跟进人；
- 本人是审批责任人。

### 今天的安排

只显示时间事件，不重复普通截止任务。

### 需要关注

仅对有管理范围者显示：

- 无负责人；
- 排课冲突；
- 花名册异常；
- 未来课件风险；
- 长时间未推进的委派事项。

## 6.3 任务、异常、指标分离

| 类型 | 含义 | 示例 |
| --- | --- | --- |
| Action | 当前用户可亲自完成 | 备课、校对、点名、审批 |
| Alert | 需要关注但未必亲自完成 | 无负责人、冲突、错位 |
| Metric | 理解趋势 | 在读数、漏斗、回款 |

Metric 不进入统一工作项队列，回到所属领域概览。

## 6.4 工作项优先级

使用可解释的桶：

```text
now
overdue
today
upcoming
backlog
```

桶内排序：

```text
是否阻塞真实教学
→ 责任强度
→ 严重程度
→ 有效截止时间
→ 创建时间
→ 稳定 workKey
```

用户看到原因：

```text
距开课 22 分钟
已逾期 2 天
明天将被王一 A 使用
等待你进行 1 校
你是本讲负责人
```

不展示不可解释的综合分。

## 6.5 直接、委派与观察

工作项责任模式：

```text
direct
delegated
oversight
```

- direct：本人可直接完成；
- delegated：本人已经委派，仍需跟踪；
- oversight：管理范围异常。

管理者委派后：

- 原“无负责人”异常消失；
- 接收人获得 direct 任务；
- 管理者获得 delegated 观察；
- 临近截止仍未推进时重新浮现。

## 6.6 工作项用户状态

`work_item_user_state` 保存：

```text
last_seen_at
snoozed_until
pinned_at
acknowledged_at
watching
```

规则：

- 已读不等于完成；
- 稍后处理不改变真实截止；
- critical/now 的延后受到限制；
- 置顶只在同一紧急桶内生效；
- 通用层不提供虚假的“完成任务”按钮。

---

# 7. 统一工作项投影

## 7.1 原则

不建立控制所有业务的 `generic_tasks`。

使用：

```text
领域事实表
→ list_my_work_items RPC 投影
→ 今日工作
```

业务完成仍调用领域 RPC。

## 7.2 统一合同

```ts
interface WorkItemRow {
  workKey: string;
  groupKey: string;

  type: "action" | "alert";
  domain:
    | "curriculum"
    | "teaching"
    | "student_service"
    | "finance"
    | "operations";

  kind: string;

  primaryObjectType:
    | "course_family"
    | "course_variant"
    | "lecture"
    | "classroom"
    | "session"
    | "student"
    | "order"
    | "refund"
    | "activity";

  primaryObjectId: string;
  primaryObjectName: string;

  secondaryObjectType?: string;
  secondaryObjectId?: string;
  secondaryObjectName?: string;

  context: Json;

  responsibility:
    | "explicit_assignee"
    | "object_owner"
    | "object_editor"
    | "reviewer"
    | "primary_teacher"
    | "assistant_teacher"
    | "learning_support"
    | "student_owner"
    | "approver"
    | "manager_oversight";

  ownershipMode: "direct" | "delegated" | "oversight";

  availableAt?: string;
  dueAt?: string;
  scheduledAt?: string;
  createdAt: string;

  urgencyBucket: "now" | "overdue" | "today" | "upcoming" | "backlog";
  severity: "critical" | "high" | "normal" | "low";

  escalationLevel: number;
  resurfaceAt?: string;
  reasonCodes: string[];

  actionCode?: string;
  canAct: boolean;

  contextLens:
    | "production"
    | "teaching"
    | "management"
    | "support"
    | "family"
    | "learning";

  routeTarget: string;
  routeParams: Json;
}
```

## 7.3 稳定键

```text
session:<sessionId>:prepare
session:<sessionId>:attendance
lecture:<lectureId>:<track>:review:<round>
student:<studentId>:followup:<followupId>
refund:<refundId>:approve
support-task:<taskId>
```

## 7.4 对象分组

同一对象多个事项合并为工作组：

```text
王一 A · 第 3 讲
├─ 完成备课
├─ 3 人未确认通知
└─ 1 人请假待安排
```

主体点击始终进入同一个课次工作区；主动作按用户责任和紧急程度选择。

## 7.5 首期来源

### 课程研发

- 无负责人；
- 制作中；
- 校对退回；
- 等待 1/2/3 校；
- 待发布；
- 未来 7 天使用但无 release；
- 4:3 适配待校对。

### 教学

- 下一课；
- 开课 ≤30 分钟；
- 备课未开始/未完成；
- 点名；
- 课评；
- 总结；
- 完成本次课。

### 学辅

- 课前通知；
- 缺勤确认；
- 补课跟进；
- 课后回访；
- 今日跟进；
- 续费；
- 催缴。

### 管理/教务

- 排课冲突；
- 无主讲；
- 过时未开始；
- 花名册错位；
- 筹备班硬性项缺失。

### 财务

- 退款审批；
- 明确指派的收款/催缴。

---

# 8. 课程产品工作区

## 8.1 对象定义

课程产品是稳定大课程，例如：

> E 系列小学数学 · 全国版

课程版本是其内部上下文：

```text
年级 × 课程季节 × 班型
```

## 8.2 进入规则

### 未指定版本

进入产品总览，不自动选择数据库第一版本。

### 已携带版本

从班级、搜索、教学或课程任务进入时，直接打开对应版本。

## 8.3 产品总览

首屏包含：

- 产品身份；
- 版本矩阵；
- 整体准备度；
- 需要处理的风险；
- 使用班级摘要。

不出现：

- 大封面；
- 商品式大卡；
- 多个嵌套统计卡；
- 全局筛选器。

版本矩阵：

```text
             暑期       秋季       寒假       春季
一年级       A B S      A B S      A B S      A B S
……
六年级       A B S      A B S      A B S      A B S
```

每个单元显示：

- 生命周期；
- 发布进度；
- 使用班级；
- 风险角标。

## 8.4 版本教学计划

默认主内容：

| 讲次 | 名称与目标 | 内容状态 | 责任 | 使用/截止 |
| --- | --- | --- | --- | --- |

浏览态禁止：

- 名称输入；
- 上下移动；
- 逐行保存；
- 删除；
- revision/binding 技术信息。

“编辑教学计划”进入显式模式，整页只有一次事务保存。

## 8.5 产品级动作

主动作按当前状态选择：

- 创建第一个版本；
- 管理版本；
- 编辑教学计划；
- 用此版本建班；
- 分配负责人；
- 无动作。

其他动作进入 `⋯`。

---

# 9. 讲次工作区

## 9.1 讲次是课程研发的核心对象

负责：

- 教学目标；
- 权威课件预览；
- 16:9 / 4:3 状态；
- 制作人；
- 当前校对轮次；
- 校对人；
- 截止；
- 当前 release；
- 使用班级和课次；
- 历史与校对意见。

## 9.2 canonical URL

```text
/dashboard/curriculum/lectures/[lectureId]
```

从课程产品和研发任务打开时，桌面端使用拦截路由显示全高覆盖层；刷新或直接访问显示完整页。

## 9.3 覆盖层

1440×900：

```text
全高 836px
宽度 1040px
右侧贴边
```

关闭后恢复：

- 原列表；
- 当前版本；
- 筛选；
- 分页；
- 滚动位置。

## 9.4 结构状态与生产状态分离

讲次结构状态：

```text
draft / active / archived
```

课件生产状态：

```text
idle
editing
in_review
changes_requested
ready_to_publish
```

用户文案：

```text
未开始
制作中
待 1 校
1 校退回
待 2 校
2 校退回
待 3 校
3 校退回
待发布
已发布
已发布 · 有未发布修改
```

`active` 不等于“课件已准备”。

---

# 10. 课程制作、1 校、2 校、3 校与发布

## 10.1 设计目标

当前团队可能只有一名或极少数教研，不应强制“另一个人审核”阻塞整个链路。

同时，系统必须预留未来升级为：

```text
制作
→ 1 校
→ 2 校
→ 3 校
→ 发布
```

## 10.2 主管可配置的校对政策

课程产品、课程版本或讲次可继承/覆盖以下政策：

```text
校对级数：1 校 / 2 校 / 3 校
制作人是否允许兼任校对人：允许 / 不允许
是否允许紧急发布：允许 / 不允许
校对默认 SLA
```

初始推荐默认：

```text
required_review_rounds = 1
allow_creator_as_reviewer = true
```

即：

> 当前阶段默认只需 1 校，制作人可以自己完成 1 校；主管随时可改为必须由他人校对，或升级为 2 校、3 校。

## 10.3 政策继承

```text
机构默认
→ 课程产品
→ 课程版本
→ 讲次
```

最近层级覆盖上级。

只有拥有 `course.assignment.manage` 或相应主管能力的人可以修改。

## 10.4 校对人

每一校可以：

- 固定指派校对人；
- 提交后由符合条件者领取；
- 在允许自校时由制作人领取。

若 `allow_creator_as_reviewer=false`：

- 当前制作人不能领取任何校对轮次；
- 系统必须提示缺少可用校对人；
- 主管可更改政策、分配他人或使用紧急发布。

首期不强制 1 校、2 校、3 校由三个不同的人完成；未来可扩展：

```text
reviewer_distinctness
```

但不在本期 UI 暴露。

## 10.5 工作流

每讲每轨独立：

```text
lecture_id + track
```

状态转换：

```text
idle
→ editing
→ in_review(round=1)
   ├─ changes_requested(round=1) → editing
   └─ pass
       ├─ required=1 → ready_to_publish
       └─ required>1 → in_review(round=2)
                         ├─ 退回 → editing
                         └─ 通过
                             ├─ required=2 → ready_to_publish
                             └─ in_review(round=3)
→ ready_to_publish
→ publish
→ idle
```

## 10.6 提交校对

提交时冻结校对快照：

- 页面 revision 集；
- 资源 binding；
- track；
- 校验报告；
- 提交说明；
- 当前校对政策版本。

校对中制作人默认不能继续改变该快照。

需要修改时：

- 主动撤回；
- 或校对人退回。

## 10.7 通过与退回

校对人可以：

- 通过；
- 退回修改；
- 写总体意见；
- 标记涉及页码。

第一阶段不做画布内逐点批注。

## 10.8 自校

当政策允许：

- 制作人可以领取当前校对轮次；
- UI 明确标记“制作人自校”；
- 审计记录保留；
- 自校不等于自动发布；
- 发布仍需相应发布能力。

## 10.9 紧急发布

拥有 `courseware.emergency_publish` 时可绕过未完成校对轮次。

必须：

- 输入原因；
- 二次确认；
- 标记未完成轮次；
- 记录发布人、政策和影响；
- 进入主管观察与后续补校任务。

## 10.10 发布

全部要求轮次通过后进入 `ready_to_publish`。

发布：

- 生成新 release；
- 更新 current release；
- 工作流回到 idle；
- 已冻结课次不受影响；
- 未冻结课次可提示新版本。

---

# 11. 课程责任

`course_staff_assignments` 支持：

```text
scope：family / variant / lecture
responsibility：owner / editor / reviewer
```

规则：

- owner 最近层级继承；
- editor/reviewer 可多人；
- 上级 assignment 向下继承；
- 子级可追加协作者；
- assignment 不进入课堂成员；
- 任务使用当前有效 assignment 和校对轮次推导。

页面显示责任来源：

```text
负责人：张老师
来源：一年级暑期 A
```

---

# 12. Studio

## 12.1 路由

```text
/studio/courseware/[lectureId]
```

## 12.2 壳层

```text
顶部单工具栏
页面列表 220
舞台 contain
属性栏 320
底部状态栏
```

硬规则：

- 不显示 Dashboard 左导航；
- 不显示“制作工作台”大标题；
- 不重复讲次标题；
- 主动作是保存草稿；
- 保存后可提交当前校对轮次；
- 退出回讲次工作区；
- 不重写 DocStage、revision、release、binding 和 H5 逻辑。

---

# 13. 班级工作区

## 13.1 顶部

显示：

- 班级名称；
- 生命周期；
- 课程版本；
- 主讲；
- 学辅；
- 人数；
- 下一课；
- 唯一主动作。

## 13.2 稳定区域

```text
课次
学生
教学准备
运营记录
```

## 13.3 课次区域

固定分组：

```text
下一课
需要处理
未来课次
已结束
已取消
```

点击合同：

```text
课次主体 → 课次工作区
行尾 ⋯ → 快速管理
进入课堂按钮 → Classroom
```

禁止按用户权限让整行跳到不同系统。

## 13.4 学生区域

点击学生始终进入学生工作区。

默认列按角色变化：

- 教务：报名、账号、转退班；
- 教师：出勤、作业、学习异常；
- 学辅：通知、请假、补课、欠费摘要；
- 主管：综合异常。

## 13.5 教学准备

显示：

- 课程版本；
- 班级默认轨道；
- 下一批讲次准备度；
- 教师备课状态；
- 本次覆盖；
- 未发布/退回风险。

不再只是画幅下拉框。

## 13.6 班级生命周期

```text
planning
→ active
→ completed
→ archived
```

未使用 planning 班级可进入回收站。

启用硬条件：

- 有课程版本；
- 有主讲；
- 有学年学期；
- 至少一个未来课次；
- 时间合法。

课件风险是强警告，不是绝对阻塞；确认后生成课程研发 Alert。

---

# 14. 课次工作区

## 14.1 canonical URL

```text
/dashboard/sessions/[sessionId]
```

## 14.2 两类状态

事件状态：

```text
scheduled / cancelled / live / ended / voided
```

工作状态：

```text
not_ready / ready / post_pending / completed
```

用户文案：

```text
计划中 · 待备课
计划中 · 已准备
即将开始
上课中
已结束 · 课后待完成
已完成
已取消
已作废
```

## 14.3 课前

显示：

- 时间地点；
- 主讲/代课；
- 学生名单；
- 请假；
- 讲次目标；
- 权威课件；
- 当前 release；
- 当前轨道；
- 本次覆盖；
- 准备检查。

主动作：

```text
开始备课
继续备课
完成备课
进入候课
进入课堂
```

## 14.4 教师备课

教师编辑本次课覆盖层：

- 临时页；
- 教师提示；
- 本次页序；
- 本次轨道；
- 复制历史准备。

不修改权威讲次。

## 14.5 备课复制

允许从同讲次的其他课次复制准备。

规则：

- 复制后形成新的 session-local 快照；
- 记录来源课次；
- release 不同必须展示差异；
- 不继续引用另一课次的可变内容。

## 14.6 完成备课与冻结

完成备课时：

1. 选择权威 release；
2. 选择轨道；
3. 合并本次覆盖；
4. 解析资源；
5. 写入既有 `courseware` / `courseware_resolved`；
6. 记录 final confirmer 和时间；
7. 进入 ready。

后续发布新 release：

- 不自动替换；
- 显示 update_available；
- 教师可查看差异；
- 选择保持当前或更新；
- 开课后不可更改。

未完成备课进入候课/课堂时自动冻结并记录 `auto_frozen`。

## 14.7 无 release 降级

正式课次无可用 release 时允许：

```text
使用临时空白课堂
```

必须：

- 填写原因；
- 记录异常；
- 允许白板和临时页；
- 不回写权威课程；
- 进入主管和教研 Alert。

## 14.8 课堂

真实课堂成员进入 Classroom。

主管、教务和学辅可以审阅必要状态，不获得实时频道或课堂资产权限。

## 14.9 课后

默认任务：

- 点名；
- 逐生课评；
- 知识总结；
- 作业；
- 视频审阅；
- 跟进。

每项有：

```text
required
assigned_to
status
completed_by
completed_at
```

默认责任：

| 任务 | 默认责任 |
| --- | --- |
| 点名 | 主讲，教务可补 |
| 逐生课评 | 主讲/助教 |
| 知识总结 | 主讲 |
| 作业 | 主讲 |
| 视频审阅 | 指定教师 |
| 客勤跟进 | 主责学辅 |
| 学习异常跟进 | 教师或学辅，按类型 |

主动作指向第一项未完成必需任务。

全部 required 完成后才能“完成本次课”。

---

# 15. 课表与快速抽屉

## 15.1 课表

- 使用全部可用空间；
- Window 不滚动；
- 日历内部滚动；
- 日期表头 sticky；
- 显示当前时间和冲突；
- 支持教师、班级、教室和管理范围。

## 15.2 快速抽屉

宽约 420px，仅负责：

- 时间和地点；
- 主讲/代课；
- 调课；
- 取消、恢复、作废；
- 打开完整课次。

不再包含：

- 点名；
- 课评；
- 完整备课；
- 课程生产状态；
- 全部课后任务。

---

# 16. 学辅任务与家庭摘要

## 16.1 主责学辅

每班：

- 最多一个 `primary_learning_support`；
- 可有多个 learning support 协作者。

任务默认分配给主责学辅，协作者可接管。

## 16.2 支持任务

保留 `class_support_tasks`，新增逐人明细。

任务类型：

```text
preclass_notice
absence_check
makeup_followup
postclass_followup
renewal_followup
```

每种任务使用自己的完成表单，不再只靠通用 done/skipped。

## 16.3 通知接收人

`class_support_task_recipients` 记录：

```text
student
guardian
pending / sent / confirmed / failed / waived
channel
sent_at
confirmed_at
note
```

## 16.4 截止策略

`support_task_policies`：

- 课前通知默认上课前 24 小时到期；
- 调课后重新计算；
- 取消课次后任务失效；
- 缺勤确认、补课和回访使用各自 offset。

## 16.5 家庭可见摘要

`session_family_briefs` 是家庭、学生和学辅共同可见的信息边界：

```text
lesson_title
learning_summary
homework_summary
materials_note
teacher_public_comment
published_by
published_at
```

内部教师课评、课程草稿和校对意见不得直接暴露。

P4I 只交付数据和员工发布入口；完整家庭/学习门户由 P4J 实施。

---

# 17. 页面空间与响应式合同

## 17.1 基准视口

```text
1440 × 900
```

辅助验收：

```text
1920 × 1080
1280 × 800
1024 × 768
390 × 844
```

## 17.2 员工外框

1440×900：

```text
顶栏 64
左导航 220
页面外边距 20
主内容约 1160
```

规则：

- Window 不滚动；
- 普通对象页主内容滚动；
- Studio、课表、覆盖层和课次工作区内部滚动；
- 页面显式声明布局，不再依赖全局 max-width 覆盖。

## 17.3 对象栏

64px，只包含：

- 一个返回入口；
- 对象名称；
- 必要上下文；
- 状态；
- 一个主动作；
- `⋯`。

禁止同页重复：

- 面包屑；
- 返回按钮；
- 板块标题；
- 对象标题；
- 编辑器标题。

## 17.4 讲次覆盖层

1440×900：

```text
1040 × 836
右侧贴边
```

左主区约 680，右决策栏约 320。

## 17.5 1024 以下

- 左导航进入 Sheet；
- 右决策栏折叠；
- 覆盖层退化完整页；
- 版本矩阵可局部横向滚动；
- 页面无横向溢出。

## 17.6 手机

使用单列，不强缩桌面三栏。

课次主动作固定底部；讲次状态和责任折叠。

---

# 18. 权限与 capability

新增建议权限：

```text
course.view.all
course.product.create
course.assignment.manage
courseware.review
courseware.emergency_publish
session.postwork.manage
```

保留：

```text
course.manage
courseware.page.edit
courseware.release.publish
class.manage
attendance.mark
review.write
video.review
```

解释：

- `course.view.all`：管理读取；
- `course.manage`：在 assignment 范围内维护课程结构；
- `course.assignment.manage`：分配责任和校对政策；
- `courseware.page.edit`：编辑被分配讲次；
- `courseware.review`：执行当前校对轮次；
- `courseware.release.publish`：完成规定轮次后发布；
- `courseware.emergency_publish`：绕过校对发布；
- `session.postwork.manage`：重新打开或管理课后状态。

所有 UI 动作必须由服务端 capability 再校验。

---

# 19. 数据模型

## 19.1 使用环境与上下文

可复用现有身份关系，不新增“当前角色”字段。

新增用户偏好：

```text
last_active_environment
```

允许值：

```text
staff / family / learning
```

对象镜头通过受控 query/route state 传递，不写入权限表。

## 19.2 课程责任

`course_staff_assignments`：

```text
id
user_id
scope_type family | variant | lecture
family_id
course_id
lecture_id
responsibility owner | editor | reviewer
starts_at
ends_at
created_by
created_at
archived_at
```

## 19.3 校对政策

`cw_workflow_policies`：

```text
id
scope_type organization | family | variant | lecture
family_id
course_id
lecture_id
required_review_rounds smallint check 1..3
allow_creator_as_reviewer boolean
emergency_publish_enabled boolean
default_review_sla_hours integer
created_by
created_at
updated_by
updated_at
```

当前默认种子：

```text
required_review_rounds = 1
allow_creator_as_reviewer = true
emergency_publish_enabled = true
```

## 19.4 当前工作流

`cw_lecture_workflows`：

```text
lecture_id
track native-16x9 | adapted-4x3
stage idle | editing | in_review | changes_requested | ready_to_publish
current_review_round smallint
required_review_rounds_snapshot smallint
active_review_cycle_id
internal_due_at
updated_by
updated_at
```

唯一键：

```text
lecture_id + track
```

## 19.5 校对轮次

`cw_review_cycles`：

```text
id
lecture_id
track
workflow_cycle_no
review_round_no
status submitted | changes_requested | passed | withdrawn | published | bypassed
creator_id
reviewer_id
self_review boolean
policy_snapshot jsonb
content_snapshot jsonb
submission_note
submitted_at
review_note
reviewed_pages integer[]
reviewed_at
published_release_id
closed_at
```

## 19.6 课次备课

`session_preparations`：

```text
session_id primary key
status not_started | in_progress | ready
source_release_id
track
prepared_by
prepared_at
auto_frozen
overlay_revision_id
copied_from_session_id
source_preparation_id
last_contributor_id
invalidated_at
invalidated_by
invalidate_reason
updated_at
```

实际冻结大数据继续写既有：

```text
class_sessions.courseware
class_sessions.courseware_resolved
```

## 19.7 课后任务

`session_completion_tasks`：

```text
id
session_id
kind attendance | reviews | summary | assignment | video_review | followup
required
status pending | done | skipped
assigned_to
due_at
completed_by
completed_at
skip_reason
created_at
updated_at
```

唯一：

```text
session_id + kind
```

`session_task_policies`：

```text
kind
enabled
required_by_default
due_offset_minutes
default_responsibility
allow_reassign
updated_by
updated_at
```

## 19.8 学辅任务

扩展 `classroom_staff_assignments` 以表达主责学辅，或增加独立唯一约束。

新增：

```text
class_support_task_recipients
support_task_policies
session_family_briefs
```

## 19.9 统一工作状态

`work_item_user_state`：

```text
user_id
work_key
last_seen_at
snoozed_until
pinned_at
acknowledged_at
watching
created_at
updated_at
```

---

# 20. 路由

```text
/dashboard                         今日工作
/dashboard/work                    全部工作
/dashboard/overview                管理/经营概览

/dashboard/students
/dashboard/students/[studentId]

/dashboard/classes
/dashboard/classes/[classroomId]
/dashboard/sessions/[sessionId]
/dashboard/schedule

/dashboard/curriculum/tasks
/dashboard/curriculum/products
/dashboard/curriculum/products/[familyId]
/dashboard/curriculum/lectures/[lectureId]

/dashboard/finance
/dashboard/staff
/dashboard/staff/roles
/dashboard/operations

/studio/courseware/[lectureId]
/studio/courseware/adapt
/studio/assets

/classroom/[classroomId]/session/[sessionId]

/family
/learning
```

旧课程和 courseware 路由保留一个发布周期 redirect。

`returnTo` 只接受站内白名单；浏览器历史优先。

> **实际落地脚注（P4I-19，2026-07-22）**：本表 `/dashboard/curriculum/tasks`、`/dashboard/curriculum/products` 两条从未按字面落地，实施时务实保留了 P4H 时代已有的 `/dashboard/courseware`（研发任务）、`/dashboard/courses`（课程产品）命名，避免无谓改名+加重定向；`/dashboard/curriculum/lectures/[lectureId]`（讲次工作区）按本表原样落地。"旧课程和 courseware 路由保留一个发布周期 redirect" 这条原则已在 P4I-19 执行：5 个 P4H-6/P4H-11 兼容壳已超过一个发布周期，随 P4I-19 直接删除（不建重定向，开发阶段旧地址直接 404，与本批次 `957641a` 确立的原则一致）。本表其余路由与实际代码一致，可继续当活文档使用。

---

# 21. 不变量

1. 已开课课次的课件、事件、板书、考勤、课评和报告必须保留。
2. 课程下架不影响既有班级。
3. 新 release 不影响已经冻结的课次。
4. 学辅不是课堂成员。
5. 管理读取不等于实时课堂权限。
6. 正式历史无普通物理删除入口。
7. CAS 只通过零引用垃圾回收清理。
8. 现有课程、讲次、班级、课次 ID 不重建。
9. P6 DocStage、revision、release、binding 和 H5 语义不重写。
10. 员工今日工作正式替换前必须先进行只读试用和旧新对账。
11. 家庭摘要与内部课评严格分离。
12. 校对级数和是否允许自校由主管配置，不能写死为必须另一个人。

---

# 22. 串行施工计划

## P4I-0：规划冻结与基线

- 将本文写入权威规划；
- 标记 P4H 被修订部分；
- 记录当前 commit 和 `git status --short`；
- 固定测试账号、对象和 5 个视口；
- 保存当前页面截图；
- 建立旧功能回归清单。

**停止条件**：工作树冲突、测试数据不稳定或 P6 并行改动未隔离。

## P4I-1：使用环境与对象镜头

- staff/family/learning 环境识别；
- 员工兼家长切换；
- `last_active_environment`；
- context lens 合同；
- `returnTo` 白名单；
- 家庭可见数据边界测试。

**验收**：环境切换不改变岗位权限；家庭数据不进入员工首页。

## P4I-2：课程责任、权限与校对政策

- 新权限键；
- `course_staff_assignments`；
- 责任继承；
- `cw_workflow_policies`；
- 1/2/3 校配置；
- 允许/禁止制作人自校；
- 校对人 assignment；
- RLS/capability。

**验收**：默认 1 校且允许自校；主管可改为 2/3 校或禁止自校。

## P4I-3：课程制作与多轮校对状态机

- `cw_lecture_workflows`；
- `cw_review_cycles`；
- 提交、撤回、退回、通过、下一校、发布、紧急发布 RPC；
- 校对快照；
- policy snapshot；
- 现有 release/草稿回填；
- 审计。

**验收**：1/2/3 校均可完整流转；自校标记正确；已冻结课次不受影响。

## P4I-4：课次备课与课后数据

- `session_preparations`；
- 备课复制；
- 完成备课；
- 自动冻结；
- 更新 release；
- 失效；
- `session_completion_tasks`；
- `session_task_policies`；
- 完成本次课；
- 重新打开。

## P4I-5：学辅与家庭摘要底座

- 主责学辅；
- `class_support_task_recipients`；
- `support_task_policies`；
- 调课/取消任务更新；
- `session_family_briefs`；
- 家庭字段白名单；
- 请假请求接口预留。

## P4I-6：统一工作投影

- `work_item_user_state`；
- `list_my_work_items`；
- `list_my_work_summary`；
- direct/delegated/oversight；
- escalation/resurface；
- snooze/seen/pin/acknowledge/watch；
- 工作领域筛选；
- 对象分组；
- 旧 StaffHome 数量对账。

## P4I-7：页面原语与 StageViewport

新增：

- `ObjectBar`
- `ContextBar`
- `StatusStrip`
- `ObjectWorkspace`
- `ObjectOverlay`
- `DecisionRail`
- `WorkItemList`
- `WorkItemGroup`
- `StageViewport`
- `FullScreenToolShell`

实现覆盖层历史恢复、内部滚动和统一舞台 contain。

## P4I-8：今日工作只读试用

- `/dashboard/work`；
- Now / My Work / Today / Oversight；
- 优先原因；
- 委派观察；
- 只读跳转；
- 不删除旧员工磁贴首页。

**停止条件**：真实账号认为排序不符合工作直觉或存在关键遗漏。

## P4I-9：课程研发导航与产品库

- 新导航分组；
- 研发任务；
- 课程产品库；
- 紧凑搜索；
- 取消旧 scope；
- 测试数据归系统；
- 产品/版本/讲次命中路由。

## P4I-10：课程产品工作区

- 产品总览；
- 版本矩阵；
- 不自动选第一版本；
- 教学计划；
- 使用情况；
- 责任与历史；
- 教学计划编辑模式；
- 新建/启停版本。

## P4I-11：讲次工作区

- canonical lecture route；
- 产品/任务拦截覆盖层；
- 课件预览；
- 当前 1/2/3 校；
- 责任、截止、使用、校对意见和历史；
- 唯一主动作。

## P4I-12：Studio 壳层

- 新路由；
- 单工具栏；
- 三栏；
- 保存；
- 提交当前校对轮次；
- 未保存保护；
- 旧 workbench redirect。

## P4I-13：班级工作区

- 下一课；
- 需要处理；
- 未来/结束/取消课次；
- 学生角色重点列；
- 教学准备；
- 运营记录；
- 设置 Sheet；
- 统一课次点击。

## P4I-14：课次工作区与备课冻结

- canonical session route；
- 课前/课堂/课后；
- 本次覆盖；
- 备课复制；
- 完成备课冻结；
- 自动冻结；
- 更新 release；
- 空白课堂降级；
- 主动作算法。

## P4I-15：课后工作与学辅接缝

- 点名、课评、总结、作业、视频和跟进；
- 责任策略；
- 完成本次课；
- 支持任务对象化；
- 缺勤/补课生成；
- 家庭摘要发布入口。

## P4I-16：课表与快速抽屉

- 全高日历；
- 内部滚动；
- sticky 日期；
- 冲突；
- 快速抽屉收缩；
- 打开完整课次；
- 点击语义统一。

## P4I-17：今日工作切换为默认首页

前提：P4I-8 真实试用通过。

- `/dashboard` 使用今日工作；
- 接入真实动作；
- 旧磁贴只读对账；
- 指标迁移领域概览；
- staff 不再读取 `dashboard_layouts`；
- 逐步删除 StaffHome 并行查询。

## P4I-18：全角色、全状态、全视口验收

角色：

- 主管；
- 教务；
- 教研；
- 教研+教师；
- 教师；
- 教师+学辅；
- 学辅；
- 员工+家长；
- 学生；
- 家长；
- 无 assignment 员工。

状态：

- 课程/版本生命周期；
- 讲次结构；
- 制作与 1/2/3 校；
- 班级生命周期；
- 课次事件；
- 备课；
- 课后。

视口：

- 1920×1080；
- 1440×900；
- 1280×800；
- 1024×768；
- 390×844。

## P4I-19：旧入口、死代码与文档收口

- 旧 scope redirect；
- 旧 courseware 目录 redirect；
- 删除 staff 磁贴注册与 StaffHome；
- 保留学生/家长卡片；
- 清理失效 CSS；
- 更新 00/04/10/11/16/18；
- 生成数据库类型；
- DB audit；
- 最终 README；
- 用户截图签收。

---

# 23. 视觉验收

## 课程产品

- 未指定版本时不自动进入具体版本；
- 1440×900 首屏完整显示版本矩阵；
- 教学计划首屏至少 7 行；
- 无大封面和商品式卡片。

## 讲次

- 产品和任务打开同一 canonical 对象；
- 首屏看到课件、当前校次、责任、截止和下次使用；
- 一个主动作；
- 舞台完整 contain；
- 关闭恢复原位置。

## 班级

- 首屏第一块是下一课；
- 课次主体始终进入课次工作区；
- 行尾才快速管理；
- 班级页不重复返回按钮。

## 课次

- 清楚区分课前、课堂、课后；
- 已结束不等于已完成；
- 完成备课后新 release 不自动替换；
- 点名、课评和课后任务不塞入快速抽屉。

## 今日工作

- 个人固定时间教学优先于管理观察；
- 主管能看到委派和重新浮现；
- 多岗位不丢任务；
- 同一对象正确分组；
- 关键任务不能通过自定义布局隐藏。

---

# 24. 完成标准

P4I 完成后，用户应获得以下体验：

## 主管

打开后台直接知道：

- 哪些事需要本人决定；
- 哪些问题已经委派；
- 哪些风险临近失控。

## 教研

从任务进入具体讲次，在一个上下文内完成：

```text
制作 → 1/2/3 校 → 发布
```

当前团队可以选择：

```text
1 校 + 允许自校
```

未来不改架构即可升级为：

```text
2 校 / 3 校 + 禁止自校
```

## 教师

从下一节课进入：

```text
备课 → 冻结 → Classroom → 课后闭环
```

## 学辅

从名单和服务任务进入：

```text
通知 → 缺勤 → 补课 → 回访
```

并只使用家庭可见摘要。

## 家长与学生

通过独立环境获得自己的课程、反馈和行动，不进入员工后台心智。

## 系统

标题、导航、对象上下文、筛选、权限和主动作各自只承担一种语义；不再通过不断补卡片和 scope 掩盖信息架构问题。
