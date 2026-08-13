# R1-9 · 两套课程来源 Manifest 子门（进行中）

## 状态

2026-08-13，P6-AIX-2 的范围裁决把爱学习从旧 G+ 4 门/52 讲升级为 G+/X+/A+ 12 门/170 讲。只读、确定性、fail-closed 的来源 manifest 与生产 baseline planner 已同步到 102 门/1305 讲/2610 条 release-1；v4 把每条轨道绑定到捕获时 track head 指向的唯一不可变 release，同时绑定原始 snapshot、含 H5 `launchQuery` 的规范投影，并新增固定只读 SQL、流式对象哈希、H5 逐文件校验核心与受控 CLI runner。该本地合同仍不证明真实生产来源、对象或 R1-9 阶段通过。

| 字段 | 值 |
| --- | --- |
| `gate_id` | `R1-9-COURSEWARE-SOURCE-MANIFEST-V4-CONTROLLED-RUNNER-20260813` |
| `domain` | P6-9 / E 系列 90 门 1135 讲 / 爱学习 G+/X+/A+ 12 门 170 讲 / 双轨来源与对象审计 |
| `result` | `pending`（v4 E1/E2 消费者合同、固定只读 SQL、纯导出核心与受控 runner 通过；真实批准副本 inventory 与 Storage/H5 E3 尚未产生） |
| `measured_value` | 完整合成 fixture 固定 102 门、1305 讲、2610 条目标 release-1；manifest/export/CLI 定向 Vitest 3 文件/35 项通过，`pnpm r1:test` 为 21 文件/156 项，全量 Vitest 为 90 文件/595 项通过、1 项因本机未提供爱学习生成包根而条件跳过。CLI 合同证明只读副本 attestation、连接串不进 argv、子进程 secret 最小化、受限 SSH、Storage 只读请求、错误脱敏和安全输出参数；本机进程环境未配置批准副本 DB/Storage 与外部 provenance，真实捕获未执行。仓库 example 仍只含 2 行并输出三项 blocker；v4 `manifestHash=720bbcf35a23821eed177d8a82df10d519c4b6206784ded8b71299fc8e04cd24`，`contentStateSha256=8f79fd2207c7b77145b566c7c2fbf24adbe1ab399cd325e585fefc80bae85469`，`planHash=ee7831a5fbd6500bb8739c51fd3f14873c535e375d9a76483f8b09d627512bb8`。 |
| `threshold` | 固定 E roster 和爱学习 v31 12 产品 roster；`(course, lecture.no)` 唯一；每讲两轨；每轨 `capturedRelease` UUID 全局唯一，raw snapshot hash 与含 `launchQuery` 的 normalized snapshot 均受绑定；普通对象实际字节 hash 与 H5 manifest/文件集合/逐文件 hash 可流式复核；爱学习显式占位/缺口精确匹配；E adapted 4:3 审批；缺失/漂移=0。`stageClosureAllowed=false` 始终成立。 |
| `commit_sha` | v4 controlled runner `ffcc476`；exporter core `41c0a7f`；v3 captured-release 合同 `46fbc96`；v31 基线同步 `7123a0b`。 |
| `migration_head` | planner 不连接数据库；v31 roster 来源迁移为 `20260813000500_p6_aixuexi_v31_levels.sql`。 |
| `environment` | Windows Node.js 22；本地只读 planner；非生产。 |
| `dataset_manifest` | 仓库 example 与合成完整 fixture；真实 1305 行来源 inventory 尚未从批准只读副本导出。 |
| `started_at` | `2026-08-13T11:49:00+08:00` |
| `finished_at` | `2026-08-13T12:00:00+08:00` |
| `actor` | Codex desktop agent |
| `approver` | `pending`（真实 inventory 与对象审计要求非执行者复核） |
| `command_or_runbook` | `pnpm r1:test`；`pnpm test`；`pnpm sml:test`；`pnpm typecheck`；`pnpm lint`；`pnpm plan:audit`；`pnpm secrets:check`；`node scripts/plan-r1-courseware-source.mjs docs/manifests/r1-courseware-source.example.json`；[运行手册](../../runbooks/r1-courseware-source-manifest.md)。 |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-9/courseware-source-manifest-v4-controlled-runner-20260813.txt` |
| `artifact_hash` | `ab479e98cac2b8cc10d2a1971986796a4a1106fbb38cc8eb1e46b3a362ef460b` |
| `retention` | 本摘要与小型 artifact 随 Git 历史永久保存；真实全量清单按发布证据策略保存。 |
| `access_roles` | 仓库读权限持有者 |
| `failure_ticket` | 批准只读副本 DB/Storage 配置、经审核的 E 系列外部 provenance、真实 1305 行 inventory、`cw-objects`/`cw-h5` 实际字节审计、非执行者复核、R1-15 隔离演练与 R1-18 授权均 pending。 |

同日较早的 v4 exporter core artifact 保留为历史证据，已被 controlled runner 合同取代。

| v4 core 历史字段 | 值 |
| --- | --- |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-9/courseware-source-manifest-v4-export-core-20260813.txt` |
| `artifact_hash` | `ca610a2e52d55cf45d7f3460bcb8737fe3455d9ea99302fa5fbc3fa09b007f56` |

同日较早的 v3 artifact `courseware-source-manifest-v3-contract-20260813.txt`、v31/v2 artifact `courseware-source-manifest-v31-contract-20260813.txt` 保留为历史证据，已被 v4 exporter core 合同取代。2026-08-12 的 94 门/1187 讲/2374 条合同和 artifact 同样只保留历史，不可再用于生产计划。

| v3 历史字段 | 值 |
| --- | --- |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-9/courseware-source-manifest-v3-contract-20260813.txt` |
| `artifact_hash` | `c21d9c84abdf57c8e8f04db617ec2e771eac63983f030a98f029d7c8c838d995` |

| 历史字段 | 值 |
| --- | --- |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-9/courseware-source-manifest-v31-contract-20260813.txt` |
| `artifact_hash` | `39f94364d915a30deb7c783ecfaec7b2697ad7afee84a593d26fc58c5e0bb597` |

| 更早历史字段 | 值 |
| --- | --- |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-9/courseware-source-manifest-contract-20260812.txt` |
| `artifact_hash` | `1fdcc8d1a27e657d8304e7f34b5edf293c0180fa7dbe2e0b72d8f8d72b791f51` |
