# R1-16 · 独立生产部署 Preflight 子门（进行中）

## 状态

2026-08-12 完成独立环境、受控配置引用、监控、备份、恢复和回滚的只读 fail-closed 合同。该结果只证明 E1/E2 preflight 可复现，不代表任何生产 E3、R1-16 阶段或发布授权通过。

| 字段 | 值 |
| --- | --- |
| `gate_id` | `R1-16-DEPLOYMENT-PREFLIGHT-CONTRACT-20260812` |
| `domain` | 独立生产环境 / secret 与 config 引用 / 监控 / 数据库与 Storage 恢复 / 应用回滚 |
| `result` | `pending`（E1/E2 合同已通过；9 项生产 E3 均未执行） |
| `measured_value` | `pnpm r1:deployment-plan` 产生确定性 `planHash=6d7630dc29c199c758f7e669dabeee21bb1172dead62683f2bdec6ee48fd8a58`，example manifest 与 9 项 evidence 全部被列为 blocker；最终 `pnpm ci:checks` 15/15，提交态全量 Vitest 64/386、R1 Vitest 17 个文件 112/112、生产 build 314 页。 |
| `threshold` | planner 的 writes/network/SSH/backup/restore/rollback 均为 false；current/target/recovery 指纹隔离；9 项 evidence 全部 `passed` 前 `readyForAuthorizedExecution=false`；任何情况下 `stageClosureAllowed=false`。 |
| `commit_sha` | `35b9f60` |
| `migration_head` | `not_applicable`（未连接数据库，未执行迁移） |
| `environment` | Windows Node.js 22；本地只读 planner；非生产。 |
| `dataset_manifest` | `docs/manifests/r1-production-deployment.example.json`；只有占位指纹、`.invalid` 域名和 pending evidence，不含 secret、主机、项目 ref 或 PII。 |
| `started_at` | `2026-08-12T00:16:00+08:00` |
| `finished_at` | `2026-08-12T00:38:00+08:00` |
| `actor` | Codex desktop agent |
| `approver` | `pending`（实际生产动作和非执行者复核仍未发生） |
| `command_or_runbook` | `pnpm r1:deployment-plan`；`pnpm ci:checks`；[`docs/runbooks/r1-production-deployment-preflight.md`](../../runbooks/r1-production-deployment-preflight.md)。 |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-16/deployment-preflight-contract-20260812.txt` |
| `artifact_hash` | `c9315242009b40c5f03fd234b3c54c648b99b9c2b044bb6bc60a2d3c3bd603f5` |
| `retention` | 本摘要与小型 artifact 随 Git 历史永久保存；实际演练日志按发布证据策略另存。 |
| `access_roles` | 仓库读权限持有者 |
| `failure_ticket` | 9 项生产 E3 保持 pending：R1-14、R1-15、环境隔离、仓库 secret scan、监控探针、数据库恢复、Storage 恢复、应用回滚、非执行者复核。 |
