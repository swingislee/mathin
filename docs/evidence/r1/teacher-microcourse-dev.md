# DEV-TMC-1 普通教师短期微课开发证据

> **结论**：`DEVELOPMENT_MACHINE_VERIFIED / PENDING_USER_ACCEPTANCE`。本机开发目标已完成实现与机器检查；未连接、迁移或启用 Xiaomi 生产环境。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `DEV-TMC-1`；teacher microcourse authoring/review/catalog；`DEVELOPMENT_MACHINE_VERIFIED`，产品负责人初验 `UNKNOWN` |
| `measured_value`, `threshold` | 基础闭环三份事务回滚 SQL、微课 Vitest 17/17、普通教师—教研—主管 Playwright 1/1、全量 Vitest 709 通过/1 条件跳过、CI 16/16 与 R1-Live 60/60 保持既有通过证据。2026-08-27 整讲来源增量另通过内容 SQL、微课 Vitest 4 文件 19/19 与固定账号 Playwright 1/1；通用游戏页增量通过回滚式内容 SQL、定向 Vitest 6 文件 47/47、固定账号完整 Playwright 1/1，并最终通过 CI 16/16、全量 Vitest 106 文件 742 通过/1 条件跳过及 production build；阈值为相关断言零失败、E2E 零 skip |
| `commit_sha`, `migration_head`, `environment` | `cd3b2bfae1e2df54c0e55db927e21737ba411825`、`26698e31ba6e1f1b1f17f295afa44344a5f47832`、`96f3301ef8b4a8c645def82b41a47d48ac2bd368`、`a4fa9e40c318159ac40f327d915124e54130d86a`、`5c13d5d4801c547c7e5af23cefc115894117bda0`、`f418dd9c20bea654ddb9410d038839b9043a9e10`、`dd9a755`、`1135099`；本机 head=`20260827000400_teacher_microcourse_game_source_adapter`；Windows Docker Desktop / `http://127.0.0.1:35421`，未连接 Xiaomi |
| `dataset_manifest` | 复用 gitignored 固定开发账号；随机 `DEV-TMC-1 <token>` 课程族/班级/课次/项目只写本机，旅程后按精确 ID、名称和类型清理；复核 `classes=0`、`families=0`、`projects=0`。未创建账号，外部通知通道在夹具启动前要求全部 disabled |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-26`；`2026-08-27`；Codex 本机开发执行；产品负责人 `pending` |
| `command_or_runbook` | 基础闭环：三份 teacher microcourse SQL、微课 Vitest、`R1_DEV_TEST_FIXTURES=1` 的 `e2e/teacher-microcourse.spec.ts`、`pnpm ci:checks`、`pnpm r1:live:test`。整讲增量：`teacher_microcourse_content_assertions.sql`、4 份微课 Vitest及同一 Playwright spec。通用游戏页增量：同一回滚式内容 SQL、6 份定向 Vitest、`pnpm typecheck`、`messages:check`、`db:types:check`、定向 lint、同一 Playwright spec 及最终 `pnpm ci:checks` |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | `not_applicable`（没有提交截图、视频或大日志）；`not_applicable`；可重跑源码与小摘要随 Git 保留；仓库读权限持有者 |
| `failure_ticket` | `not_applicable`。浏览器旅程发现并修复 session 查询歧义、自由课冻结未生成 doc 页列表、H5 MIME、审核导航和建班时序；通用游戏页增量把初始化 manifest 同步至 207 个 migration 后完整 Gate 通过 |

## 覆盖边界

- 数据库：既有 `curriculum` 唯一性保留；同维度多份 `microcourse` 可共存；作者、其他普通教师、审核者和管理员的草稿读取边界；提交快照不可替换；退回、重提、发布、撤回和新版 head/旧冻结课次不变量。
- 内容：来源按课次检索，整讲页面按 release 顺序在一个事务内复制；每页钉死 release/revision 与资源绑定快照，任一页面或素材不一致时整体回滚；来源基底不可编辑。通用 `game-page-v1` 覆盖注册内容版本、服务端校验凭证、4/6/9 宫数独、未完成草稿试讲与审核阻断；历史 81 格数独、组合页叠加层、H5 摘要/上限/离线 CSP/私有草稿与不可变发布路径保持覆盖。
- 旅程：普通教师从自由课次选择一个含原生页与爱学习页的正式课次，一次插入本讲全部 2 页，再补图文页、六宫数独游戏页和 H5 并冻结上课；固定教研账号退回并在英文界面通过发布；另一名有建班权限的固定主管从目录检索并创建恰含一个课次的班级；作者英文界面读取已发布状态。

## 2026-08-27 整讲来源增量

- 产品反馈把选择对象从“页面”改为“课次”。`dd9a755` 删除页面级多选/排序面板，搜索不再匹配页面标题；课次卡展示首屏预览和总页数，主按钮一次插入本讲全部页面。老师随后使用既有页面列表删除、移动或补充内容。
- migration `20260827000100_teacher_microcourse_lecture_source_picker` 只返回能完整复制的正式 `curriculum` 当前 release，并以一个 RPC 事务按 snapshot 顺序逐页复制；200 页上限、当前 release、来源格式与绑定 revision 任一不满足都会使整讲回滚。
- 本机 `.env.local`、`127.0.0.1:35421` 监听和 Docker 容器已在写前核对；migration 与规范化 checksum 只登记到本机账本。Playwright 随机 `DEV-TMC-1` 夹具结束后复核课程族、班级和微课项目均为 0；未连接 Xiaomi。

## 2026-08-27 通用游戏页增量

- commit `1135099` 新增 `game-page-v1`、`cw_game_content_contracts` 与逐 revision 的 `cw_game_revision_validations`。创建和保存只开放给服务端角色，数据库再次核对真实作者、来源自由课次、注册内容版本和 validator version；普通教师不能直接写校验凭证。
- 首个 `sudoku-authored-v1` 适配器复用数独题型/runtime/renderer 注册表，编辑器和课堂统一支持四宫、六宫、九宫。空题草稿可以保存和冻结试讲，提交审核必须由当前 revision 的不可变凭证证明唯一解；旧 `microcourse-page-v1 mode=sudoku` 不迁写。
- 正式来源页搜索与整讲复制改为调用统一 revision capability predicate。未来注册且标记 `copyable` 的游戏内容版本自动复用搜索、快照复制与锁定叠加层，无需修改微课来源 RPC。
- 写前确认应用 origin 为 `http://127.0.0.1:35421`、本机监听和健康 `supabase-db`；migrations `20260827000300`～`20260827000400` 与 LF 规范化 checksum 只登记到本机账本。固定账号 Playwright 以六宫题完成自动保存、课堂、退回重提、英文发布和单讲建班并自动清理；未连接 Xiaomi。
- 最终 `pnpm ci:checks` 为 16/16；其中全量 Vitest 为 106 文件、742 通过/1 条件跳过，Next.js 16.2.11 production build 成功。该机器结果不替代产品负责人验收。

## 尚未证明

- 自动化不等于产品负责人实际操作验收；当前状态仍为 `PENDING_USER_ACCEPTANCE`。
- 本任务没有连接 Xiaomi，不能证明生产迁移、生产数据兼容、生产 H5 对象提升、正式教师旅程或生产性能。生产晋级须另行获得明确授权并执行写目标 preflight、备份/current/previous、迁移回退与 postflight。
