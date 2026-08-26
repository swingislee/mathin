# DEV-TMC-1 普通教师短期微课开发证据

> **结论**：`DEVELOPMENT_MACHINE_VERIFIED / PENDING_USER_ACCEPTANCE`。本机开发目标已完成实现与机器检查；未连接、迁移或启用 Xiaomi 生产环境。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `DEV-TMC-1`；teacher microcourse authoring/review/catalog；`DEVELOPMENT_MACHINE_VERIFIED`，产品负责人初验 `UNKNOWN` |
| `measured_value`, `threshold` | 三份事务回滚 SQL 断言通过；微课定向 Vitest 3 文件 17/17；普通教师作者、教研退回/英文发布、主管目录建班 Playwright 1/1；全量 Vitest 103 文件 709 通过/1 条件跳过；production build 通过；`pnpm ci:checks` 16/16；当前 R1-Live 合同 7 文件 60/60。阈值为相关断言零失败、E2E 零 skip、CI 16/16 |
| `commit_sha`, `migration_head`, `environment` | `cd3b2bfae1e2df54c0e55db927e21737ba411825`、`26698e31ba6e1f1b1f17f295afa44344a5f47832`、`96f3301ef8b4a8c645def82b41a47d48ac2bd368`、`a4fa9e40c318159ac40f327d915124e54130d86a`、`5c13d5d4801c547c7e5af23cefc115894117bda0`、`f418dd9c20bea654ddb9410d038839b9043a9e10`；本机 head=`20260826000600_teacher_microcourse_runtime_fixes`；Windows Docker Desktop / `http://127.0.0.1:35421`，未连接 Xiaomi |
| `dataset_manifest` | 复用 gitignored 固定开发账号；随机 `DEV-TMC-1 <token>` 课程族/班级/课次/项目只写本机，旅程后按精确 ID、名称和类型清理；复核 `classes=0`、`families=0`、`projects=0`。未创建账号，外部通知通道在夹具启动前要求全部 disabled |
| `started_at`, `finished_at`, `actor`, `approver` | `2026-08-26`；`2026-08-26`；Codex 本机开发执行；产品负责人 `pending` |
| `command_or_runbook` | `supabase/tests/teacher_microcourses_core_assertions.sql`、`teacher_microcourse_content_assertions.sql`、`teacher_microcourse_lifecycle_assertions.sql`；`pnpm test -- tests/teacher-microcourses-core.test.ts tests/teacher-microcourse-doc.test.ts tests/teacher-microcourse-ui.test.ts`；`R1_DEV_TEST_FIXTURES=1` 的 `e2e/teacher-microcourse.spec.ts`；`pnpm ci:checks`；`pnpm r1:live:test` |
| `artifact_url_or_path`, `artifact_hash`, `retention`, `access_roles` | `not_applicable`（没有提交截图、视频或大日志）；`not_applicable`；可重跑源码与小摘要随 Git 保留；仓库读权限持有者 |
| `failure_ticket` | `not_applicable`。浏览器旅程发现并修复 session 查询歧义、自由课冻结未生成 doc 页列表、H5 MIME、审核导航和建班时序；初始化 manifest 同步至 202 个 migration 后完整 Gate 通过 |

## 覆盖边界

- 数据库：既有 `curriculum` 唯一性保留；同维度多份 `microcourse` 可共存；作者、其他普通教师、审核者和管理员的草稿读取边界；提交快照不可替换；退回、重提、发布、撤回和新版 head/旧冻结课次不变量。
- 内容：来源 release/revision 与资源绑定快照、不可编辑来源基底、组合页叠加层、数独冲突/无解/多解/唯一解、H5 规范化摘要/5 MiB 上限/离线 CSP/私有草稿与不可变发布路径。
- 旅程：普通教师从自由课次创建并编辑原生来源页、爱学习来源页、图文页、数独和 H5，冻结后立即进入课堂；固定教研账号退回并在英文界面通过发布；另一名有建班权限的固定主管从目录检索并创建恰含一个课次的班级；作者英文界面读取已发布状态。

## 尚未证明

- 自动化不等于产品负责人实际操作验收；当前状态仍为 `PENDING_USER_ACCEPTANCE`。
- 本任务没有连接 Xiaomi，不能证明生产迁移、生产数据兼容、生产 H5 对象提升、正式教师旅程或生产性能。生产晋级须另行获得明确授权并执行写目标 preflight、备份/current/previous、迁移回退与 postflight。
