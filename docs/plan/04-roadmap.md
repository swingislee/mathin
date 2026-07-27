# Mathin 整体规划 · 04 分期路线图

原则：每期结束时网站都是完整可用的（没有半成品页面暴露给访客）；每期内的任务按序执行，单个任务 = 一次独立提交，提交前跑 `pnpm lint && pnpm typecheck && pnpm build`。涉及视觉的任务完成后截图（亮/暗 × 桌面/移动）给用户确认再进入下一任务。

排序理由：先把设计系统和骨架立起来（一切页面的地基）→ 优先做见效最快、已有 demo 的 tools 和核心初衷 terms → 游戏与社交 → 最重的教室/白板 → 依赖漫画产出的 story 内容期贯穿始终。

## P0 设计地基与首页

1. **设计 token 落地**：按 01 改造 `globals.css`（重命名变量、星夜暗色、`@theme` 映射）；全局替换旧变量引用。
2. **字体**：接入霞鹜文楷子集（`next/font/local`）用于标题与 Logo；正文切换系统栈。
3. **基础组件**：`Star4`、`StarPath`、`PlanetLink`、`EmptyState`、shadcn `button` 定制三变体。
4. **首页重设计**：按 02-1 实现「月亮与五颗星球」；header 移除五个文字导航；新增 `home.cta` 文案。
5. **`SectionShell`**：按 02-2 实现，替换 `SectionPage`，全部九板块套壳 + `EmptyState`；退出登录移入 UtilitySheet。
6. **登录/注册页**视觉统一（02-3.10）。

验收：02-1.4 清单全过；九个板块页 + 首页 + 登录注册风格一致；无任何硬编码色值/文案。

## P1 工具与知识框架

0. **五星球主题基建**：`SectionShell` 增加 `data-planet` 机制 + `globals.css` 五套 `--p-*` 作用域变量（05-§2）；首页站点星球化（05-§4，迷你星球 SVG 需用户确认）。
1. **注册表基建**：`features/tools/registry.ts`、`/tools` 列表页、`/tools/[tool]` 全屏页、`/embed/[tool]` 纯净路由 + proxy 放行。
2. **迁移首批工具**（与用户逐个确认 demo 交互细节）：分数数轴 → 相遇追击演示。
3. **MDX 管线**：选型报批 → `content/` 目录 + KaTeX；`terms`、`minds` 的 MDX 渲染组件。
4. **`/terms` 学习线总览** + `/terms/[slug]` 概念页四段结构（02-3.3）；先由用户提供 3–5 个概念的内容作为样板打通全流程。
5. **`/minds`** 卡片 + 文章最小结构。

验收：一个工具能在教学课件 iframe 中正常嵌入使用；一条包含 ≥3 个概念、带前后置跳转的知识样板线上线。

## P2 游戏与排名（已完成）

1. `profiles` 表 + 注册触发器 + `requireTeacher`（migration 起点）。
2. 游戏框架：`GameDef`/`GameBoard` 接口、对局页统一框架、`game_sessions`/`game_scores` 表与服务端校验（03-3.2）。
3. 首个游戏：数独（生成器 + 求解校验器放服务端）。
4. 排行榜页 + dashboard 的成绩卡。
5. 第二、三游戏：数和、幻方（复用框架，验证抽象是否成立）。

验收：两名用户可各自完赛并在排行榜看到彼此；直接 POST 伪造成绩被服务端拒绝。

## P3 笔记（社交最小闭环）（已完成）

0. **规划同步与依赖**：修订旧规划描述，安装 BlockNote/shadcn、zustand 与服务端消毒依赖。
1. **数据层**：`notes`/`posts`/`post_likes`、RLS、触发器、Storage 桶与策略。
2. **工作区骨架**：四条路由、悬浮面板、无限层级笔记树、回收站、zustand 单一数据源与跨端失效通知。
3. **富文本编辑**：BlockNote 双语界面、标题三处同步、防抖自动保存、乐观锁冲突提示、图片 hash 去重与 emoji 图标。
4. **发布闭环**：服务端 HTML 快照与消毒、公开帖子流/详情、最新/最热、点赞、SEO metadata。
5. **搜索与收尾**：Cmd+K、dashboard 笔记卡、面板色调、移动端/无障碍/亮暗主题回归。

验收以 `07-p3-notebook.md` §9 为准：未登录浏览与登录写作发布点赞闭环可用；连续输入期间零保存请求、停顿后单次写入；标题三处一致且双标签冲突不覆盖；anon 越权读私有笔记、改点赞数、传他人 Storage 路径均被拒；中英编辑器 UI 正确；lint/typecheck/build 与四档视觉验收全过。

## P4 教室与画板（当前阶段，最重，拆细执行；执行计划见 `08-p4-classroom-whiteboard.md`）

1. 白板先行（教室依赖它）：Canvas 画布 + 工具条 → `whiteboards` 表与快照 → Realtime 协作同步。
2. 教室结构：`classrooms`/`classroom_members` + 邀请码加入 + 教室主页。
3. 上课页：课件展示与教师翻页同步 → 学生答题与实时评分 → 插入 tools/白板 → 课堂报告聚合。
4. 作业：布置 / 提交 / 批改（`assignments`/`submissions`）。
5. dashboard 教室卡。

验收：一次真实模拟课（1 教师 + 2 学生浏览器）全流程走通：进入 → 同步翻页 → 发题 → 作答 → 评分 → 报告。

## P4B 学校端后台（当前阶段，执行计划见 `10-school-backend.md`）

**2026-07-09 新增**：暂缓 P5，回头对 P4 深度加工——建立完整的学校端后台。推翻 08-§1「不做教培 CRM」的非目标；财务模块回到范围内（订单/收款/退费/优惠券/奖学金/账户），仅多租户与工资支出仍不做。角色升级为**可配置 RBAC**：身份类 student/parent/staff/admin + 岗位角色（校长/主管/教研/教师/学辅/兼职，管理员可增改）+ 权限键颗粒度配置。

0. RBAC 基建：`profiles.role` 扩展 + `staff_roles`/`role_permissions`/`staff_role_members` + `has_perm` + 权限配置/员工页 + `/dashboard` 身份分发骨架。
1. 课程体系：`courses`/`course_lectures` + 教学计划种子导入（72 门课 / 865 讲）。
2. 学生档案：`students`/`student_guardians`/`student_follow_ups`，360° 档案页与跟进时间线。
3. 建班报名排课 + 课件模板/覆盖层：`classrooms`/`class_sessions` 扩展列 + `enrollments`；课件走「模板引用+受限覆盖层+开课冻结」（不深拷贝）。
4. 课表周视图（全校/教师/本人/孩子切面）。
5. 考勤 `session_attendance` 与学生学情聚合。
6. 财务模块：`orders`/`order_items`/`payments`/`refunds`/`coupons`/`scholarships`/`student_accounts`/`account_ledger` + 全部财务 RPC。
7. staff 工作台首屏（按权限自适应卡片）。
8. 学生/家长端收尾与 Playwright 全链路验收。

验收：全链路——admin 配岗位权限 → 建课建班 → 学辅报名下单收款 → 学生/家长绑码 → 教师点名跟进 → 各端看到课表/学情/费用；越权（权限键伪造、订单金额篡改、跨界读写）全部被拒。权威计划见 `10-school-backend.md`。（2026-07-10 全角色 Playwright 回归通过，验收关闭。）

## P4C 后台精装修（当前阶段，执行计划见 `11-p4c-dashboard-refit.md`）

**2026-07-10 新增**：P4B 试用结论"功能已通、体验毛坯"。P4C 按使用者视角重修后台。**第一优先级是 11-§0 角色需求画像**（校长/主管、教务、教研、教师、学辅、兼职、学生、家长逐一推"每天进后台干什么→第一眼看什么→操作什么→权限是否匹配"，面板由需求倒推，数据可扩充、需求必须被满足）：

0. 外壳固定（顶栏/侧栏不滚、唯一滚动区=内容）+ 统一页头 + 暗色表单控件修复 + 陈旧文案清理。
1. 权限矫正：新键 `enrollment.manage`；教师收缩（去建班/删课次/花名册）；学辅收缩（去全量订单可见）；新增内置「教务 registrar」角色；学生端去财务。
2. 课次软删 `deleted_at` + 班级详情回收站。
3. 员工与岗位权限两页实装（P4B-0 只交付了 RPC，页面一直是占位）。
4. 磁贴式工作台基建：`dashboard_layouts` 每用户布局，「顺序+尺寸档」持久化、拖拽重排、隐藏/恢复，四类角色统一磁贴壳。
5. 磁贴视觉升级（tone 洗底/语义色/数字层级）+ 教研模板进度磁贴。
6. 学辅跟进工作台 `/dashboard/followups`（全生命周期操作面板，含今日试听桶）。
7. 顾客侧需求补齐：学生"一键进教室"/作业直达/我的课堂；家长孩子卡加本周课次与待交作业数。

## P4D 学生生命周期深化（已完成，执行计划见 `12-p4d-student-lifecycle.md`，审计见 `14-p4d-completion-audit.md`）

**2026-07-10 二轮新增**：按完整生命周期（地推获客→线索→到校活动→跟进→正式课多维记录→续费，流失可回流）深化：

0. 学生域 CRUD 补齐：360° 可编辑/状态变更/跟进人分派、软删回收站、地区与来源、**批量导入**（create_student 等 RPC 一直在库但前端零调用，本期兑现）。
1. 课程/班级域 CRUD 补齐（新建课程/改讲次/班级信息编辑——P4B-1 验收虚标项兑现）。
2. 活动域：体验课 / 1v1 测评 / 三板斧 / 讲座 / 竞赛活动的建档、报名、到场登记，与跟进状态联动。
3. 课堂多维记录：入门考/出门测成绩 + 专注/参与/掌握三维 + 课堂知识总结（星星保留为课堂即时激励，两者并存）。
4. 课后视频：学生上传、教师**倍速审阅**、家长回看已审视频（signed URL）。
5. 续费窗口与流失池（回流留痕）。
6. 全模块 CRUD/批量/回收审计收尾 + 生命周期一条龙回归。

新权限键 6 个：activity.manage / activity.register / review.write / video.review / student.import / student.delete。

**2026-07-12 完工**：P4D-0～6 已按任务独立落地；学生 CRUD/导入、课程与班级 CRUD、活动、课评、视频、续费与流失回流全链路代码完成。P4D 迁移已部署到自托管开发库，数据库事务审计与真实视频 Storage/API 角色回归均通过，证据见 `14-p4d-completion-audit.md`。

## P5 故事（暂缓，待 P4D 完成后重启；执行计划见 `09-p5-story.md`）

**2026-07-08 修订**：从「漫画阅读」升级为**网页沉浸式故事游戏**（风格参照 messenger.abeto.co：小世界漫游 + 对话任务 + 环境音，每章 10–20 分钟，手机可玩）。技术路线 = 自研 DOM/CSS 2.5D 分层插画场景引擎，零新依赖，不用游戏引擎；漫画降为受支持的章节媒介之一。

1. 拍板与序章样板脚本（P5-0，无代码）。
2. 故事引擎核心：场景漫游/对话/谜题 beat/本地存档，占位美术（P5-1）。
3. 序章上线打通资产管线与体积预算（P5-2）→ 时间线页（P5-3）→ 云存档 `story_progress`（P5-4）。
4. 随用户脚本与美术产出逐章上线（P5-5…）；故事资产随 git 入 `public/story/`，不迁 Supabase Storage。

（故事的脚本创作与用户并行进行；引擎不等美术——一切工程任务用几何占位推进。）

## P6 课件资产平台（新立项 2026-07-17，执行计划见 `16-p6-courseware-platform.md`）

把已竣工的魔法校课件镜像项目（`D:\code\2026\2026-07_mofaxiao_courseware`，72 产品 / 865 讲 / 55,110 页 / 22GB CAS + 19GB H5）全量迁入 mathin：

0. ~~地基核查~~（✅ 2026-07-17 完成：磁盘 196G 够用；补齐 MFHK01863 第 15 讲后 865 讲全对齐；H5 spike 得出「public 桶 + mathin HTML 垫片」方案；page-doc-v1 已冻结进 `courseware-doc/schema.ts`；双桶已建）。五项关键决策同日拍板（doc 16 §10）：cw-h5 public / 4:3 按讲灰度＋16:9 顶置打底 / 不做预览分享 / 资产读收紧为 staff＋课次批签 / 镜像转维护不做增量。
1. ~~镜像侧 v2 发布包导出（全 kind 资产 + 页文档 + H5 包 + 讲次映射，在镜像仓库执行）~~ ✅ 2026-07-17：`export mathin-package` 落地（镜像阶段 25），样本讲与全量（865 讲/55,101 页/usages 160,647/H5 包 1,240）audit 全绿，页文档过 mathin 冻结 schema；镜像项目转维护模式。导入用 exportId `2490b13a…`。
2. ~~mathin 资产层 migration（CAS 对象 / 公共资源 / 资源版本 / 页面绑定 / 页 revision / 讲 release）~~ ✅ 2026-07-17：migration ×5 + RLS + 权限键 + RPC + `getSessionAssetUrls` 批签 action，安全断言在开发库通过。
3. ~~幂等导入 CLI + 样本讲垂直打穿~~ ✅ 2026-07-18：`scripts/cw-import.mjs`（包校验/TUS 上传/单事务/对账）；审核发现导入期 sanitize 损毁标记，已改「无损门禁」（doc 原样入库、会改写即失败）并清除重导——样本 69 页 verbatim、幂等复跑零新增。
4. 原布局渲染器移植（Viewer 实装渲染 + 交互执行器 → React 组件）。
5. 课堂接入（doc 页型、候课预载、冻结物化 resolved bindings）。
6. 4:3 增强轨（✅ 2026-07-26 全量发布与退回闭环完成）：A–F 分类、确定性 4:3 CAS、人工背景闸门、课程→讲次审校筛选与单讲/批量 release 路径已打通；开发库 718 份背景 approved，16:9 与 4:3 当前轨均为 865/865，兼容主指针仍保持 16:9。21 条 CAS 修复技术历史已回填为 `superseded`，当前 binding/page/release 引用为 0、无需返工且不阻塞；人工退回现强制结构化原因，只有当前 binding 仍选中时进入“退回待修”，裁切修复会创建带替代链的新候选并重新送审，历史审计只读。实际库当前 pending=0、rejected=0、superseded=21，详见 doc 16 §6.3.1。
7. 教研中台第一期（改文字/挪图/加元素/调页 + 页 revision / 讲 release 版本管理）。
8. 公共资源批量替换（✅ 2026-07-19：全量推指针 / 部分分支重绑 + 审计回滚；已发布 release 与冻结课次隔离）。
   - ✅ 同日按实际授课流程补强：16:9 原生版与 4:3 稳定版长期双轨；编辑页可切轨、轨内批量换背景；班级可选默认轨并对未开课单讲覆盖，开课冻结精确 release。
9. 全量迁移与总验收：数据导入在 P4H-3 后可执行；“865 讲可浏览”的 UI 验收等待 P4H-5/6，使用课程产品教学计划与唯一课件 workbench，不再扩写旧三级目录。

验收：865 讲可浏览可开课（16:9 页在 4:3 舞台顶置呈现、下方板书带可写）；样本讲与镜像 Viewer 视觉一致；教研发布不影响已冻结课次；4:3 可按讲灰度并可回滚；导入对账零 silent missing。

## P4H 教学运营体验重构（已完成，2026-07-19 立项，2026-07-20 全部 0→11 完成；执行计划见 `18-p4h-teaching-operations-experience.md`）

从产品使用者视角统一课程产品、课程版本、讲次、课件、班级、上课课次和多岗位工作流。重点解决：现有 72 个 E 系列组合版本被误当成 72 门顶层课程；课程详情、课件中台课程表、课件中台讲次表形成三套重复目录；浏览态直接暴露模板修改/保存/删除；预览与编辑返回链路循环；运营学年学期误放课程页；以及课程选择不可搜索、删除逻辑、主管课堂 404、教研/教师/学辅/主管视角混杂。

最终课程信息架构固定为：**课程产品 family → 年级/课程季节/班型版本（保留现有 `courses` ID）→ 教学计划讲次 → 单一课件 workbench**。当前 seed 的 72 个 MFHK 版本原位归入一个 E 系列 family，865 讲和 P6 page/revision/release/CAS 引用全部不重建、不重绑。

执行顺序固定为：

0. 数据安全止血：撤销版本/讲次/班级/课次直接 DELETE，移除讲次垃圾桶和旧教室物理删除入口，主管后台课次不再跳课堂成员路由，404 改“上一级 + 首页”。
1. 生命周期与责任关系：版本正式/测试、讲次草稿/可用/归档、班级筹备/进行/结班/归档、课次取消/作废；新增主讲/助教/学辅 assignment，学辅不进入 classroom_members。
2. 状态转换 RPC、讲次归档/整份教学计划事务保存、影响预览和统一 capabilities；权限 = 岗位权限 × 对象关系 × 当前状态。
3. 课程产品 family 数据层：显式把 seed 的 72 个 MFHK 版本原位归入 E 系列 family；额外课程一对一保留；分开 `courseSeason` 与运营 `schoolTerm`。
4. 侧栏、学年学期与产品库：移除独立资源库入口，把学期设置移到排课；课程库按 family 去重、按角色 scope 聚合搜索。
5. 产品教学计划页：年级/课程季节/班型切换；浏览态只读；讲次同页预览；显式编辑教学计划、单次事务保存、讲次归档而非删除。
6. 唯一课件工作台：`/courseware` 改按讲次任务队列；preview/edit/page/track 共用 canonical shell；五类旧路由 308 收口并回到原 family + variant。
7. 可搜索 CoursePicker + 四步建班向导；不默认选第一门课程/教师，不完整正式课只能先建筹备班。
8. 班级列表与详情：我的授课/我负责/全部/测试 scope；后台课次用详情内抽屉，只有真实教师进入课堂。
9. 主管、教研、教师、学辅工作台接缝与学辅通知/客勤/课后跟进任务。
10. 测试数据视图、批量归档、恢复、影响预览与 admin-only 受控清理；共享 CAS 资源不跟随删除。
11. 全角色 E2E、旧入口与死代码收口、P6 回归、DB/route audit 和文档完成。

排期约束：P6-8 已完成，P4H 现在可启动并严格按 0→11 串行；P4H-3 完成后可执行 P6-9 全量数据导入，P6-9 的“865 讲可浏览”最终验收必须等待 P4H-5/6 并使用新入口。每条任务一次独立提交，验收细节、文件范围、错误码与停止条件以 doc 18 为准。（P4H-11 收尾：主管/教研/教师/学辅/多岗位/测试数据/旧路由/404/P6 回归共 9 条路径全角色 Playwright 回归通过，过程中发现并修复两处遗留问题——`/dashboard/classes/[id]` 的“进入教室”入口曾对管理视角（无课堂成员关系）展示并 404（对应 F3），已改为仅 `isTeachingView` 才显示；`school.classes.name` 中英文案缺失已补全。`scripts/verify-p4h-route-audit.mjs` 上线，确认 §3.3 五条旧路由仍是纯 redirect 壳、仓库内无死链接、`CoursewareTemplateEditor` 零引用。验收关闭。）**2026-07-20 追记**：导航分组、路由合同（§3）、员工首页磁贴、课次入口与多岗位视角切换规则已被 `P4I`（`19-p4i-final.md`）修订取代；P4H 落地的生命周期状态机、状态转换 RPC、capability 模型、assignment 数据结构与安全不变量继续保留，P4I 在其上重排产品结构与工作流。

## P4I 学校端工作台、课程研发与教学运营重构（当前阶段，2026-07-20 立项；执行计划见 `19-p4i-final.md`）

P4H 试用后发现问题不在功能而在信息架构：课程/课件/班级/课次各自有多套目录和返回链路，员工首页是可自由拖拽的磁贴池、无法区分任务与异常，多岗位用户被迫选一个"最像的角色"。P4I 是对 P4H 在导航、页面归属、课程 scope、制作工作台、讲次/课次入口、多岗位视角、员工首页方面的最终修订版——**与 doc 18 冲突处以 doc 19 为准**；doc 18 已落地的生命周期状态机、安全不变量、历史保留、assignment 能力继续保留，不重做。

最终结构：任务入口（今日工作）→ 唯一对象工作区（课程产品/讲次/班级/课次各自只有一个 canonical 工作区）→ 专用工具（Studio/Classroom/排课）→ 退出回到原对象。新增课程研发多轮校对（1/2/3 校，主管可配置校对级数与是否允许制作人自校）、统一工作项投影（`list_my_work_items`，区分 action/alert/metric 与 direct/delegated/oversight）、员工兼家长的环境切换（工作台/家庭/学习）。

**2026-07-20 P4I-0 基线**：commit `ff29642`，`git status --short` 为空（clean tree）。

执行顺序固定为（§22，严格串行，一任务一提交，细节/验收/停止条件以 doc 19 为准）：

0. 规划冻结与基线：写入本节、标记 P4H 被修订部分、记录 commit/git status、固定测试账号/样本对象/5 视口、拍摄改造前截图、建立旧功能回归清单。
1. 使用环境与对象镜头：staff/family/learning 环境识别、员工兼家长切换、`returnTo` 白名单。
2. 课程责任、权限与校对政策：`course_staff_assignments`、`cw_workflow_policies`（默认 1 校 + 允许自校）。
3. 课程制作与多轮校对状态机：`cw_lecture_workflows`/`cw_review_cycles`，提交/退回/通过/紧急发布 RPC。
4. 课次备课与课后数据：`session_preparations`、`session_completion_tasks`。
5. 学辅与家庭摘要底座：主责学辅、`class_support_task_recipients`、`session_family_briefs`。
6. 统一工作投影：`work_item_user_state`、`list_my_work_items`、旧 StaffHome 数量对账。
7. 页面原语与 StageViewport：`ObjectBar`/`ObjectWorkspace`/`ObjectOverlay`/`DecisionRail` 等。
8. 今日工作只读试用：`/dashboard/work`（该临时路由已由 doc 22 删除，今日工作的 canonical 地址是 `/dashboard`），不删旧磁贴首页（**停止点**：需真实账号试用通过）。
9. 课程研发导航与产品库：新导航分组、研发任务、课程产品库。
10. 课程产品工作区：产品总览、版本矩阵、教学计划编辑模式。
11. 讲次工作区：canonical `/dashboard/curriculum/lectures/[id]`（doc 22 已改名为 `/dashboard/courseware/lectures/[lectureId]`）、拦截路由覆盖层。
12. Studio 壳层：`/studio/courseware/[lectureId]` 单工具栏三栏。
13. 班级工作区：下一课/需要处理/未来/已结束/已取消固定分组。
14. 课次工作区与备课冻结：canonical `/dashboard/sessions/[id]`、课前/课堂/课后。
15. 课后工作与学辅接缝：点名/课评/总结/作业/视频/跟进 + 家庭摘要发布。
16. 课表与快速抽屉：全高日历、抽屉收缩为纯排课操作。
17. 今日工作切换为默认首页（**前提**：P4I-8 通过），逐步删除 StaffHome 并行查询。
18. 全角色、全状态、全视口验收（11 种角色组合 × 5 视口：1920×1080/1440×900/1280×800/1024×768/390×844）。
19. 旧入口、死代码与文档收口：更新 00/04/10/11/16/18，DB audit，用户截图签收。

**2026-07-22 追记（P4I-17～19 收尾）**：P4I-17 上线后用户真实使用发现讲次预览弹窗/适配校对与公共资源二级路由/课件预览翻页/研发任务与课程产品页密度/财务导航分组/课表布局共 7 项问题，已修复（讲次预览复原为独立可复用组件、讲次工作区取消弹窗形态、适配校对与公共资源提升为一级路由，开发阶段不加 302/308，旧地址直接 404）。P4I-18 全角色/全状态/全视口验收发现并修复两处真实缺陷（`nav.ts` 导航权限门禁与页面实际鉴权口径不一致、课程产品页装饰性大封面违反视觉验收标准并挤出教学计划首屏行数）。P4I-19 收口：删除 StaffHome 与 staff 磁贴注册（学生/家长磁贴保留）、退休 P4H 时代 5 个 courseware/course 旧路由兼容壳（同样不建重定向、直接 404）、清理由此产生的死代码与死测试断言、本节及 00/10/11/16 追加与 doc 19 的关系说明、跑通数据库类型生成与只读审计。细节见 `.claude/p4i-0-baseline.md`（本地文件，不进仓库）。P4I 系列至此按 doc 19 §22 全部完成，等待用户对真实页面截图签收。

## UI-L1 页面布局与五星球场景重构（2026-07-25 第一轮完成）

权威施工记录见 `20-ui-layout-refit.md`。本轮已完成：

1. 移除全宽视觉顶部栏，改为左上品牌签名、右上通知/菜单的边缘控制。
2. UtilitySheet 改为固定账户头部、唯一滚动中部、固定账户尾部；导航组为容器卡，组内为紧凑行。
3. Story/Games/Minds/Terms/Tools 使用统一 `ThemePageIdentity`，并按沙丘、皇家大厅、路灯轴、星系、工作台建立场景结构。
4. Dashboard 品牌融入左侧导航，主工作区承担滚动；全局滚动条统一为 6px 窄条。
5. 中文全局霞鹜文楷，其他语言使用书卷感衬线栈；注册页加入昵称、邀请码和双隐私同意，主管可配置邀请码。

剩余验收：参考截图逐页视觉签收、场景局部硬编码色提取为 `--scene-*` token。Story 真实章节内容仍属于 P5，不因场景首页完成而提前标记完成。

## UI-L2 Dashboard 统一内容坐标系与命令面板（2026-07-27 完成）

权威施工记录见 `21-dashboard-unified-canvas-command-panel-refactor.md`（含 §30 施工记录与实际偏差）。UI-L1 把 Dashboard 外壳统一成「固定左侧导航 + 视口边缘悬浮控制」之后，普通页面内部仍然是四套 `max-w-*` 混用的居中网页，切页时标题、筛选和表格持续横向跳动。本轮把宽度决定权收归 `DashboardShell`：

1. `--dashboard-gutter` 成为 A→B / C→D 的唯一来源；整页 `lg:pr-24` 删除，右上悬浮控件改由 ResizeObserver 测量 + 页头透明占位避让。
2. 新增 `src/features/school/dashboard-page/`（无宽度参数的 `DashboardPage` + 命令面板 + 12 列容器查询网格）与 `src/components/global-floating-controls/`。
3. 21 个普通页面全部迁移；页头不再承载业务 actions，状态/筛选/操作统一进命令面板；财务、学生详情、孩子、测试数据按 §22 完成宽屏内部适配。
4. `SchoolPageHeader` 与全局 `[data-dashboard-content] > .mx-auto` 兜底规则退休；新增 `pnpm doc21:audit` 与一条 ESLint 规则防回退。

验收：9 页 × 6 视口边线完全一致、悬浮控件安全区随控件增减自动跟随、工作区页面无回归；`lint`/`typecheck`/`build`/`messages:check` 全过。剩余人工项：固定视口截图的亮/暗逐页视觉签收。

## UI-L3 Dashboard 路由信息架构与资源操作模型重构（2026-07-27 完成）

权威施工记录见 `22-dashboard-route-information-architecture-refactor.md`（含 §18 施工记录与实际偏差）。起因是侧栏双重高亮，但根因不是 active 算法而是 URL 表达了错误的父子关系：岗位权限不是员工的子页面，数据维护也不是错误日志的子页面。项目尚未首次部署，因此本轮是一次性 hard cut——旧 URL 不留重定向、不留 alias、直接 404。

1. 新增 `src/features/school/dashboard-routes.ts` 路由合同（页面类型 × 使用环境 × 权限 × 创建方式 × 导航归属），三套侧栏全部由它派生；它的职责是**阻止后续 agent 靠目录对称性推断产品结构**——`createSurface: "none"` 是主动结论而不是"还没做"。
2. 八条旧 URL 迁移：`staff/roles`→`access-control`、`registration`→`registration-settings`、`operations`→`system-health`、`operations/testdata`→`data-maintenance`、`adapt-review`→`courseware/review`、`curriculum/lectures/[id]`→`courseware/lectures/[lectureId]`、`shared-assets`→`courseware-assets`。
3. 动态参数语义化（`[studentId]`/`[classId]`/`[courseFamilyId]`），删除 Course Variant 旧 ID 兼容；删除 `/dashboard/work`（P4I-17 后只是 redirect 空壳）与 `/dashboard/videos`（无入口的孤儿页，能力已并入课次课后 tab）。
4. 新增本轮唯一的创建路由 `/dashboard/courses/new` + `create_course_family` RPC，兑现从 P4B 起就零消费方的 `course.product.create`；顺带修 `list_course_families` 让零版本产品在库里可见。
5. `requireDashboardEnvironment` 统一环境守卫（环境闸门先于权限键），finance 按 activeEnvironment 而非 profiles.role 分派；导航 active 改最长匹配、桌面与移动共用一个结果。
6. 新增 `pnpm doc22:audit` 防回流（旧路由 / `[id]` 目录 / 禁止的创建路由 / **合同与真实路由树一一对应**），并把一直未进 CI 的 `doc21:audit` 与 `p4i1:boundary-audit` 接进 workflow。

验收：`lint`/`typecheck`/`build`/`messages:check`/`db:types:check` 与四条 audit 全过；Playwright 回归通过——19 条新路由 200 且侧栏唯一高亮、9 条旧路由 404 且零重定向、对象详情与创建流程可用、family/learning/teacher 三套环境守卫矩阵全绿。回归中发现并修掉两处同源缺陷（`course_families` 的 RLS 可见性启发式让零版本产品对直接表读不存在；详情页那次已失去意义的直接预读）。剩余人工项：导航分组重排后的亮/暗 × 桌面/移动视觉签收。

## UI-L4 对象详情页与专业工作区整体重建（2026-07-27 完成）

权威施工记录见 `23-dashboard-object-pages-workspaces-rebuild.md`（含 §25 施工记录与实际偏差）。doc 21 统一了普通页面的坐标系、doc 22 统一了路由，但六个对象页的**骨架**仍各写各的：学生详情是一条超长纵向主栏加三个操作型侧栏，班级把身份拼成一条长字符串、异常做成正文横幅，课程版本顶部有一张重复身份的统计卡，课次只有三个业务面板的切换壳，讲次和素材各自拥有一份专用两栏布局。返回入口写了两遍（工作区那份在移动端还被隐藏），URL 标签写了两遍。

1. `shellMode` 进 `dashboard-routes.ts`，`DashboardShell` 不再按 segment 猜哪些页面是专业工作区；素材替换随之进入 panel。
2. 共享原语收敛为一套：`DashboardBackLink`（唯一返回）、`navigation/RouteTabs`（`DashboardCommandTabs` / `ObjectTabs` / `StageNavigation` / `TrackSwitcher` 的共同实现）、重写的 `ObjectBar`（返回在身份之前、结构化上下文、稳定区域）、`ObjectWorkspace`（ambient 复用 `DashboardPageChrome` + `DashboardPageBody`，internal 把滚动交给 `WorkspaceMain` / `WorkspaceSplitShell` + `WorkspaceRail`）。
3. 六页按蓝图重排：主栏放"这一页要做的事"，侧栏 / Rail 放"跨视图不变的状况"。课程、班级、学生走主 + 侧栏；课次、讲次、素材走 panel 分栏。
4. 课次 `?tab=` 硬切 `?stage=`；`object-workspace/return-target.ts` 落地 §18 返回来源合同（站内 + 命中路由合同 + 当前使用环境可访问，否则回落 canonical 父页面）。
5. 删除 `ContextBar` / `LectureWorkspaceShell` / `DecisionRail` 壳层 / `SharedAssetReplacementEditor` 单体 / `StudentLifecycleActions`；新增 `pnpm doc23:audit` 并接入 CI。

验收：`lint`/`typecheck`/`build`/`messages:check` 与 doc21/22/23、P4I-1 四条 audit 全过；六页 × 三档视口（panel 页额外 1920×1080）真实浏览器回归通过，逐页确认返回唯一、侧栏唯一高亮、无横向溢出、普通页单一滚动区、panel 页只有主区与 Rail 两个滚动区。剩余人工项：亮 / 暗双主题逐页视觉签收。

## 长期暂缓（明确不做，除非用户重启议题）

- 评论区、关注/私信、消息通知系统
- 教师申请审批流程、多租户机构
- 移动端 App、PWA 离线
- AI 助教 / 自动批改主观题
