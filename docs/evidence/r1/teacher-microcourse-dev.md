# DEV-TMC-1 普通教师短期微课开发证据

> **结论**：`DEPLOYED / PENDING_USER_ACCEPTANCE`。本机实现与机器检查已完成；2026-08-27 已在明确授权下完成 Xiaomi 生产备份、迁移、应用发布和功能开关启用，独立 postflight 通过。产品负责人尚未完成生产页面的实际操作验收。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `DEV-TMC-1`；teacher microcourse authoring/review/catalog；`DEPLOYED / PENDING_USER_ACCEPTANCE` |
| `measured_value`, `threshold` | 基础闭环三份事务回滚 SQL、微课 Vitest 17/17、普通教师—教研—主管 Playwright 1/1、全量 Vitest 709 通过/1 条件跳过、CI 16/16 与 R1-Live 60/60 保持既有通过证据。2026-08-27 整讲来源增量另通过内容 SQL、微课 Vitest 4 文件 19/19 与固定账号 Playwright 1/1；通用游戏页增量通过回滚式内容 SQL、定向 Vitest 6 文件 47/47、固定账号完整 Playwright 1/1，并最终通过 CI 16/16、全量 Vitest 106 文件 742 通过/1 条件跳过及 production build；课程产品选择器复用增量通过两份 migration 回滚、固定教师权限矩阵、微课 Vitest 4 文件 21/21 与固定账号完整 Playwright 1/1。生产 12 个 migration 在单事务内完成含账本写入的完整回滚演练与正式提交，ledger=`194→206`；应用本地/远端 build、current/previous、zh/en HTTP、真实权限只读 catalog smoke、服务/错误/业务计数和备份复验均零失败 |
| `commit_sha`, `migration_head`, `environment` | 开发 commits `cd3b2bf`、`26698e3`、`96f3301`、`a4fa9e4`、`5c13d5d`、`f418dd9`、`dd9a755`、`1135099`、`210944c`；生产 release commit=`bc76f68f8a68b65514658b97df0dfc4f7e0438b3`，head=`20260827000700_teacher_microcourse_course_catalog_access`；Xiaomi / production，release=`20260827-094025` |
| `dataset_manifest` | 复用 gitignored 固定开发账号；随机 `DEV-TMC-1 <token>` 课程族/班级/课次/项目只写本机，旅程后按精确 ID、名称和类型清理；复核 `classes=0`、`families=0`、`projects=0`。未创建账号，外部通知通道在夹具启动前要求全部 disabled |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-26`；`2026-08-27`；Codex；产品负责人明确指令“将改动推送生产”，产品实际验收仍 `pending` |
| `command_or_runbook` | 开发检查同上；生产执行 [`r1-write-target-policy.md`](../../runbooks/r1-write-target-policy.md) 只读 preflight → PostgreSQL-only pre-change backup → 12 migration 完整 rollback/零残留/formal → `publish-mathin-xiaomi.ps1 -Action Publish` 双 build/原子切换 → 真实管理员 `set_feature_flag` rollback/formal → HTTP、权限、数据库、服务、错误和备份独立 postflight。生产未运行 Playwright、未创建测试账号或夹具 |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | release `/home/swing/services/mathin/releases/20260827-094025/release.json`；备份 `/mnt/openlist-disk/Backups/Mathin/mathin-db-prechange-20260827T092348Z-teacher-microcourse-bc76f68/`，dump SHA-256=`6f8dcb0564ff9ca22994ff2d4f0566e16f5a9fe9234a54d342a219eabaff8432`；immutable release/current/previous、migration ledger 与备份按既有策略保留且本轮无 prune；仓库维护者/Xiaomi 运维角色 |
| `failure_ticket` | `not_applicable`。开发阶段已修复 session 查询歧义、冻结页列表、H5 MIME、审核导航、建班时序和普通教师无 `class.create` 的授权上下文。生产 rollback 演练先暴露三个历史 platform owner 边界和一条旧 RPC 断言签名，全部在提交前自动回滚并经独立零残留核查；最终按真实 owner 边界的完整演练和正式事务均通过 |

## 覆盖边界

- 数据库：既有 `curriculum` 唯一性保留；同维度多份 `microcourse` 可共存；作者、其他普通教师、审核者和管理员的草稿读取边界；提交快照不可替换；退回、重提、发布、撤回和新版 head/旧冻结课次不变量。
- 内容：来源按课次检索，整讲页面按 release 顺序在一个事务内复制；每页钉死 release/revision 与资源绑定快照，任一页面或素材不一致时整体回滚；来源基底不可编辑。通用 `game-page-v1` 覆盖注册内容版本、服务端校验凭证、4/6/9 宫数独、未完成草稿试讲与审核阻断；历史 81 格数独、组合页叠加层、H5 摘要/上限/离线 CSP/私有草稿与不可变发布路径保持覆盖。
- 旅程：普通教师从自由课次选择一个含原生页与爱学习页的正式课次，一次插入本讲全部 2 页，再补图文页、六宫数独游戏页和 H5 并冻结上课；固定教研账号退回并在英文界面通过发布；另一名有建班权限的固定主管从目录检索并创建恰含一个课次的班级；作者英文界面读取已发布状态。

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

## 尚未证明

- 自动化、生产 schema/app/flag postflight 与只读真实权限 smoke 不等于产品负责人实际操作验收；当前状态仍为 `PENDING_USER_ACCEPTANCE`。
- 尚未由真实教师在生产完成“自由课次创建内容 → 冻结试讲 → 教研退回/重提/发布 → 另一教师建班”的写态旅程，也未产生可核验的生产 H5 提升对象或负载/容量证据。后续验收不得创建开发夹具或同步固定开发账号。
