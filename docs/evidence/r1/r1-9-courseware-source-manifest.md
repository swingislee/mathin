# R1-9 · 两套课程来源 Manifest 子门（进行中）

## 状态

2026-08-12 完成 E 系列与爱学习 G+ 秋季双轨来源 manifest 的只读、确定性、fail-closed 合同。该结果证明 schema/planner 能拒绝聚合计数、Storage/H5 自报和路径绕过，不证明真实生产来源、对象或 R1-9 阶段通过。

| 字段 | 值 |
| --- | --- |
| `gate_id` | `R1-9-COURSEWARE-SOURCE-MANIFEST-CONTRACT-20260812` |
| `domain` | P6-9 / E 系列 90 门 1135 讲 / 爱学习 4 门 52 讲 / 双轨来源与对象审计 |
| `result` | `pending`（E1/E2 合同通过；真实只读 inventory 与 Storage/H5 E3 未产生） |
| `measured_value` | v2 完整 fixture 为 94 门、1187 讲、2374 条 release-1，定向 Vitest 10/10；仓库 example 只含 2 行并稳定输出 `example-manifest` 与两套 `incomplete-inventory` blocker，`planHash=0a671f38a104070c37688a5e85b1dfa92449583844c76e5d369412abe6672cdf`。 |
| `threshold` | 固定 roster、`(course, lecture.no)` 唯一、每讲两轨、现役 snapshot 字段、可读对象清单 hash、E adapted 4:3 审批、缺失/漂移=0。`p6SourceManifestReady` 只表示所给本地 manifest 满足 E1/E2 合同，不证明真实 provenance、对象审计或批准；`stageClosureAllowed=false` 始终成立。 |
| `commit_sha` | `0cd8b13`；安全复核 follow-up `f4a7444` |
| `migration_head` | `not_applicable`（planner 不连接数据库） |
| `environment` | Windows Node.js 22；本地只读 planner；非生产。 |
| `dataset_manifest` | 仓库 example 与合成完整 fixture；真实 1187 行来源 inventory 尚未从批准只读副本导出。 |
| `started_at` | `2026-08-12T00:48:00+08:00` |
| `finished_at` | `2026-08-12T01:57:00+08:00` |
| `actor` | Codex desktop agent |
| `approver` | `pending`（真实 inventory 与对象审计要求非执行者复核） |
| `command_or_runbook` | `node scripts/plan-r1-courseware-source.mjs`；定向 Vitest/ESLint/TypeScript；[`docs/runbooks/r1-courseware-source-manifest.md`](../../runbooks/r1-courseware-source-manifest.md)。 |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-9/courseware-source-manifest-contract-20260812.txt` |
| `artifact_hash` | `1fdcc8d1a27e657d8304e7f34b5edf293c0180fa7dbe2e0b72d8f8d72b791f51` |
| `retention` | 本摘要与小型 artifact 随 Git 历史永久保存；真实全量清单按发布证据策略保存。 |
| `access_roles` | 仓库读权限持有者 |
| `failure_ticket` | 真实只读 1187 行 inventory、`cw-objects`/`cw-h5` 审计、非执行者复核、R1-15 隔离演练与 R1-18 授权均 pending。 |
