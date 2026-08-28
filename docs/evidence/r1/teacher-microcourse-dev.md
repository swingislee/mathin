# DEV-TMC-1/2 普通教师短期微课与课次多方案证据

> **结论**：`DEPLOYED / PENDING_USER_ACCEPTANCE`。DEV-TMC-1 于 2026-08-27 完成首轮生产发布；DEV-TMC-2 的课次多方案协作/选用及已结课班级重新启用入口于 2026-08-28 在明确授权下完成全量备份、事务迁移、双 release 发布和独立 postflight。产品负责人尚未完成生产写态操作验收。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `DEV-TMC-1`、`DEV-TMC-2`；teacher microcourse authoring/review/catalog、session proposal collaboration/selection、classroom reactivation；`DEPLOYED / PENDING_USER_ACCEPTANCE` |
| `measured_value`, `threshold` | DEV-TMC-1 既有 SQL/Vitest/Playwright/CI 证据保持通过。2026-08-28 候选另通过两份事务回滚 SQL、定向 Vitest 8 文件 64/64、固定账号新旧 Playwright 2/2、`pnpm ci:checks` 16/16、全量 Vitest 108 文件 761 通过/1 条件跳过及 production build；三条 migration 在同一 `SERIALIZABLE` 事务中完成含账本写入的完整 rollback/零残留/formal，ledger=`208→211`。双 release、zh/en HTTP、数据库/ACL/触发器、服务/错误/业务计数和浏览器只读页面 postflight 均通过 |
| `commit_sha`, `migration_head`, `environment` | DEV-TMC-1 开发 commits 同下；DEV-TMC-2/重新启用生产候选=`087b49795f885cd7c9902eccc5b3978ac4bf3634`，数据库 head 仍为按名称排序更后的 `20260828000200_courseware_summer_a_plus_catalog`；Xiaomi / production，current=`20260828-071313`、previous=`20260828-071024`，两者均为同一候选 commit |
| `dataset_manifest` | 复用 gitignored 固定开发账号；随机 `DEV-TMC-1 <token>` 课程族/班级/课次/项目只写本机，旅程后按精确 ID、名称和类型清理；复核 `classes=0`、`families=0`、`projects=0`。未创建账号，外部通知通道在夹具启动前要求全部 disabled |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-26`；`2026-08-28`；Codex；产品负责人先后明确要求推送 DEV-TMC-1 与“设计老师短期课件制作流程”开发设计到生产，产品实际写态验收仍 `pending` |
| `command_or_runbook` | 两轮生产均执行 [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 只读 preflight。2026-08-28 为 PostgreSQL+Storage 全量备份 → 三 migration 完整 rollback/零残留/formal → `publish-mathin-xiaomi.ps1 -Action Publish` 两次发布，使 current/previous 同 schema → HTTP、数据库、权限、服务、错误、业务不变量和登录态浏览器只读 postflight。生产未运行写态 Playwright、未创建测试账号或夹具 |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | current release `/home/swing/services/mathin/releases/20260828-071313/release.json`，previous `/home/swing/services/mathin/releases/20260828-071024/release.json`；全量备份 `/mnt/openlist-disk/Backups/Mathin/mathin-20260828T052842Z-teacher-microcourse-variant-087b497/`，database dump SHA-256=`771fe4c4a9c63dd0c150be5037fda67df372d3f5b68736730550a73c8ce408da`，Storage SHA-256=`5193404fe9e25a11973602d80f786dff2e5c9414a939f4395e93e421c28c9f83`，manifest SHA-256=`50dc92dabf6c9ea2197d70b0b2f7a767f625b734287e4db7aa82b4eadcb988bc`；immutable release/current/previous、migration ledger 与备份按既有策略保留，本轮无 prune；仓库维护者/Xiaomi 运维角色 |
| `failure_ticket` | `not_applicable`。开发阶段已修复 session 查询歧义、冻结页列表、H5 MIME、审核导航、建班时序和普通教师无 `class.create` 的授权上下文。生产 rollback 演练先暴露三个历史 platform owner 边界和一条旧 RPC 断言签名，全部在提交前自动回滚并经独立零残留核查；最终按真实 owner 边界的完整演练和正式事务均通过 |

## 覆盖边界

- 数据库：既有 `curriculum` 唯一性保留；同维度多份 `microcourse` 可共存；作者、其他普通教师、审核者和管理员的草稿读取边界；提交快照不可替换；退回、重提、发布、撤回和新版 head/旧冻结课次不变量。
- 内容：来源按课次检索，整讲页面按 release 顺序在一个事务内复制；每页钉死 release/revision 与资源绑定快照，任一页面或素材不一致时整体回滚；来源基底不可编辑。通用 `game-page-v1` 覆盖注册内容版本、服务端校验凭证、4/6/9 宫数独、未完成草稿试讲与审核阻断；历史 81 格数独、组合页叠加层、H5 摘要/上限/离线 CSP/私有草稿与不可变发布路径保持覆盖。
- 旅程：普通教师从自由课次选择一个含原生页与爱学习页的正式课次，一次插入本讲全部 2 页，再补图文页、六宫数独游戏页和 H5 并冻结上课；固定教研账号退回并在英文界面通过发布；另一名有建班权限的固定主管从目录检索并创建恰含一个课次的班级；作者英文界面读取已发布状态。
- 多方案：任课教师与教研均可创建课次方案；修改他人方案派生新 head 并保留来源关系；只有任课教师能设置“本节使用”，冻结读取所选方案的不可变页面、资源、H5 与游戏校验事实。已结课班级只允许具备班级管理权限的角色重新启用，恢复后既有课次与历史事实不重写。

## 2026-08-27 整讲来源增量

- 产品反馈把选择对象从“页面”改为“课次”。`dd9a755` 删除页面级多选/排序面板，搜索不再匹配页面标题；课次卡展示首屏预览和总页数，主按钮一次插入本讲全部页面。老师随后使用既有页面列表删除、移动或补充内容。
- migration `20260827000100_teacher_microcourse_lecture_source_picker` 只返回能完整复制的正式 `curriculum` 当前 release，并以一个 RPC 事务按 snapshot 顺序逐页复制；200 页上限、当前 release、来源格式与绑定 revision 任一不满足都会使整讲回滚。
- 该增量开发验证时只操作本机 Docker；Playwright 随机 `DEV-TMC-1` 夹具结束后复核课程族、班级和微课项目均为 0。生产晋级另按下文独立授权与证据执行。

## 2026-08-27 通用游戏页增量

- commit `1135099` 新增 `game-page-v1`、`cw_game_content_contracts` 与逐 revision 的 `cw_game_revision_validations`。创建和保存只开放给服务端角色，数据库再次核对真实作者、来源自由课次、注册内容版本和 validator version；普通教师不能直接写校验凭证。
- 首个 `sudoku-authored-v1` 适配器复用数独题型/runtime/renderer 注册表，编辑器和课堂统一支持四宫、六宫、九宫。空题草稿可以保存和冻结试讲，提交审核必须由当前 revision 的不可变凭证证明唯一解；旧 `microcourse-page-v1 mode=sudoku` 不迁写。
- 正式来源页搜索与整讲复制改为调用统一 revision capability predicate。未来注册且标记 `copyable` 的游戏内容版本自动复用搜索、快照复制与锁定叠加层，无需修改微课来源 RPC。
- 该增量开发时确认应用 origin 为 `http://127.0.0.1:35421`，migrations `20260827000300`～`20260827000400` 与 LF 规范化 checksum 先只登记到本机账本。固定账号 Playwright 以六宫题完成自动保存、课堂、退回重提、英文发布和单讲建班并自动清理；生产未复用这些开发账号。
- 最终 `pnpm ci:checks` 为 16/16；其中全量 Vitest 为 106 文件、742 通过/1 条件跳过，Next.js 16.2.11 production build 成功。该机器结果不替代产品负责人验收。

## 2026-08-27 课程产品选择器复用增量

- 删除来源页面预览、缩略图签名和独立页面级搜索 UI；直接复用建班课程产品 `CoursePicker`，先按既有课程族/版本、年级、课程季节、班型和历史版本筛选课程，再列出该课程可整讲复制的课次名称与页数。
- migration `20260827000600_teacher_microcourse_course_catalog_picker` 提供不含 preview doc/binding 的紧凑课次 RPC，并给整讲复制 RPC 增加生产正式课程/current release 边界。migration `20260827000700_teacher_microcourse_course_catalog_access` 让同一课程目录筛选 RPC 支持两种固定授权上下文：建班保持 `class.create`，作者只允许 `purpose='production'`、`course_kind='curriculum'`，详情查询也拒绝作者读取教师微课候选。
- 本机固定教师实际只有 `courseware.microcourse.author`、没有 `class.create`。JWT 角色模拟证明该身份可读 30 条生产正式课程和一份课程详情，测试目的目录及 `microcourse` 目录均返回 `FORBIDDEN`；完整 Playwright 随机夹具继续完成整讲插入、六宫数独、H5、冻结上课、退回重提、英文发布和单讲建班并自动清理。

## 2026-08-27 生产发布

- 写前只读 preflight 确认 Xiaomi、`https://supabase.mathin.club`、生产数据库指纹、全部 Supabase 容器、current/previous、ledger=`194`、业务/Storage 计数和错误基线；唯一 started 未 ended 课次是历史状态，最近 60 分钟事件为 0，发布窗口内附近排课、课堂事件和其他活跃数据库会话均为 0。
- 新建 PostgreSQL-only 备份 `mathin-db-prechange-20260827T092348Z-teacher-microcourse-bc76f68`，dump=`249657570` bytes、TOC=`3793`、SHA-256=`6f8dcb05…8432`。备份前后 auth/profile/student/course/lecture/release/class/session/enrollment/attendance/Storage/ledger 计数完全一致；发布后再次运行 `sha256sum -c`，五项均为 `OK`，未归档 Storage、未 prune。
- migrations `20260826000200`～`20260827000700` 的 12 个 LF 规范化 checksum 先确认生产账本全部缺失。完整 rollback 演练包含 DDL、权限、owner、12 条 ledger 插入和最终合同断言；独立核查 ledger=`194`、新列/表/flag=`0` 后才正式原子提交。postflight 为 ledger=`206`、12/12 checksum、102 门既有课程全部 `curriculum`、微课项目=`0`、受控主题=`5`、启用游戏合同=`1`。
- 应用 release `20260827-094025` 从干净 commit `bc76f68` 通过本地 lint/typecheck/build 和 Xiaomi Next.js production build 后原子切换；previous 保留 `20260826-125052` / `964ca5e…`。服务 active/running、`NRestarts=0`、`ExecMainStatus=0`，loopback/Caddy/公网 health、zh/en login 与匿名受保护路由均通过，发布后 journal error=`0`、`operational_errors` 新增=`0`。
- `teaching.teacher_microcourses_v1` 由唯一真实管理员通过既有 `set_feature_flag` 审计 RPC 从 version 1 / false 推进到 version 2 / true；正式提交前同一流程已完整 rollback。旧区间闭合、真实 `created_by`、`feature_flag.versioned` domain event 和即时有效性均通过。随后使用现有微课作者身份做只读 catalog smoke：生产 `curriculum` 课程可筛选、选中课程可列出课次，`test` 范围继续 `FORBIDDEN`。
- 发布没有创建账号、班级、课次、报名、点名、微课作品或 Storage 对象。最终计数保持 auth/profile/student/family/course/lecture/release/class/session/enrollment/attendance/Storage=`14/14/5/3/102/1315/2633/3/16/1/0/123602`。

## 2026-08-28 DEV-TMC-2 与班级重新启用生产发布

- 候选只纳入原对话的 `66d5802`（课件访问说明与班级重新启用）和 `5361cf6`（课次多方案协作）两项设计；明确排除同一开发树中的 `5c8f606` 班级课型/活动类型增量。干净候选 `087b49795f885cd7c9902eccc5b3978ac4bf3634` 基于当时生产 `b4ad4a9…` 构造。
- 本机三条 migration 的 LF 规范化 checksum 分别为 `19ab02a7853ad9c1081625eabd9430dd355fff98fc245c4a2e3864adfe333282`、`4e802238fc5681c9b45ba8c77976e9d7962df0d1dd62eff486f349bb59735aeb`、`fbc66554be2d3358f01aa114e586ae752729c9ac9b911de2b115162d43bd987a`。两份数据库断言在本机回滚，固定账号 Playwright 2/2 同时覆盖既有完整旅程和教师/教研派生—教师选用—冻结旅程；候选最终 CI 16/16。
- 写前只读 preflight 锁定 Xiaomi、生产 Supabase origin/数据库指纹、current/previous、ledger=`208`、未来两小时无课次与全部业务/Storage/错误基线。新建 PostgreSQL+Storage 同批次全量备份 `mathin-20260828T052842Z-teacher-microcourse-variant-087b497`；备份前后数据库计数、Storage 路径/大小/mtime 清单一致，`sha256sum -c`、dump TOC、`pigz -t` 和 tar 全量清单均通过，未恢复、未 prune。
- 三条 migration 先在单一 `SERIALIZABLE` 事务中完整应用、断言并显式回滚；新连接确认零残留后，以完全相同事务正式提交。postflight 为 ledger=`211`、三条 checksum 精确匹配、目标列/函数/ACL/选用守卫触发器存在；教研只新增微课作者权限，未获得班级或点名权限。微课/方案/选用记录仍为 0，既有 auth/profile/student/guardian/course/lecture/release/class/session/enrollment/attendance、来源包、Storage 和错误计数无漂移。
- 应用连续发布两次，使 current=`20260828-071313`、previous=`20260828-071024` 均为 `087b497…`，避免回退到不认识多方案 schema 的旧 bundle。服务 `active/running`、`NRestarts=0`、`ExecMainStatus=0`，loopback/Caddy/公网 health、zh/en login 与匿名受保护路由均通过，发布后 journal error=`0`。
- 复用现有 Chrome 登录会话只读打开生产“4:3 适配校对与发布”，实见“教师微课、背景确认、退回待修、页面分类与编辑、待发布讲次、历史审计”流程和正常空状态。该浏览器证据只证明认证壳与页面呈现；未点击提交、选用、重新启用或其他写态按钮。

## 尚未证明

- 自动化、生产 schema/app/flag postflight 与只读真实权限 smoke 不等于产品负责人实际操作验收；当前状态仍为 `PENDING_USER_ACCEPTANCE`。
- 尚未由真实教师在生产完成“自由课次创建内容 → 多方案派生/选用 → 冻结试讲 → 教研退回/重提/发布 → 另一教师建班”的写态旅程，也未由产品负责人实际点击已结课班级的重新启用入口；未产生可核验的生产 H5 提升对象或负载/容量证据。后续验收不得创建开发夹具或同步固定开发账号。
