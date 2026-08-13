# R1-9 · 两套课程来源 Manifest 子门（进行中）

## 状态

2026-08-13，P6-AIX-2 的范围裁决把爱学习从旧 G+ 4 门/52 讲升级为 G+/X+/A+ 12 门/170 讲。只读、确定性、fail-closed 的来源 manifest 与生产 baseline planner 已同步到 102 门/1305 讲/2610 条 release-1；这仍不证明真实生产来源、对象或 R1-9 阶段通过。

| 字段 | 值 |
| --- | --- |
| `gate_id` | `R1-9-COURSEWARE-SOURCE-MANIFEST-V31-CONTRACT-20260813` |
| `domain` | P6-9 / E 系列 90 门 1135 讲 / 爱学习 G+/X+/A+ 12 门 170 讲 / 双轨来源与对象审计 |
| `result` | `pending`（E1/E2 合同通过；真实只读 inventory 与 Storage/H5 E3 未产生） |
| `measured_value` | 完整合成 fixture 为 102 门、1305 讲、2610 条 release-1；生产 baseline + 来源 manifest 定向 Vitest 2 文件/15 项通过。仓库 example 只含 2 行并输出三项 blocker；source `planHash=3e6b23dde0b5da3cba97662bf433c474c587b63eacc7fe7f177d2d67cbae0848`。 |
| `threshold` | 固定 E roster 和爱学习 v31 12 产品 roster；`(course, lecture.no)` 唯一；每讲两轨；现役 snapshot 字段；可读对象清单 hash；爱学习显式占位/缺口精确匹配；E adapted 4:3 审批；缺失/漂移=0。`stageClosureAllowed=false` 始终成立。 |
| `commit_sha` | 原 v2 合同 `0cd8b13`、安全复核 `f4a7444`；v31 基线同步为本次 P6-AIX-2 收尾提交。 |
| `migration_head` | planner 不连接数据库；v31 roster 来源迁移为 `20260813000500_p6_aixuexi_v31_levels.sql`。 |
| `environment` | Windows Node.js 22；本地只读 planner；非生产。 |
| `dataset_manifest` | 仓库 example 与合成完整 fixture；真实 1305 行来源 inventory 尚未从批准只读副本导出。 |
| `started_at` | `2026-08-13T10:35:00+08:00` |
| `finished_at` | `2026-08-13T10:50:00+08:00` |
| `actor` | Codex desktop agent |
| `approver` | `pending`（真实 inventory 与对象审计要求非执行者复核） |
| `command_or_runbook` | `pnpm r1:baseline-plan`；`node scripts/plan-r1-courseware-source.mjs`；`pnpm exec vitest run tests/r1-production-baseline.test.ts tests/r1-courseware-source-manifest.test.ts`；[运行手册](../../runbooks/r1-courseware-source-manifest.md)。 |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-9/courseware-source-manifest-v31-contract-20260813.txt` |
| `artifact_hash` | `39f94364d915a30deb7c783ecfaec7b2697ad7afee84a593d26fc58c5e0bb597` |
| `retention` | 本摘要与小型 artifact 随 Git 历史永久保存；真实全量清单按发布证据策略保存。 |
| `access_roles` | 仓库读权限持有者 |
| `failure_ticket` | 真实只读 1305 行 inventory、`cw-objects`/`cw-h5` 审计、非执行者复核、R1-15 隔离演练与 R1-18 授权均 pending。 |

2026-08-12 的 94 门/1187 讲/2374 条合同和 artifact 保留为历史证据，已被本记录取代，不可再用于生产计划。

| 历史字段 | 值 |
| --- | --- |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-9/courseware-source-manifest-contract-20260812.txt` |
| `artifact_hash` | `1fdcc8d1a27e657d8304e7f34b5edf293c0180fa7dbe2e0b72d8f8d72b791f51` |
