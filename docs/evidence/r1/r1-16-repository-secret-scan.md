# R1-16 · 仓库 Secret Scan 子门（进行中）

## 状态

2026-08-12 当前跟踪文件与完整可达 Git 历史的高置信 secret 扫描均为 0 命中。该结果关闭 SEC-04 的仓库扫描子门，不证明开发/预生产/生产 secret、数据、Storage 与域名已经隔离。

| 字段 | 值 |
| --- | --- |
| `gate_id` | `R1-16-REPOSITORY-SECRET-SCAN-20260812` |
| `domain` | Git 当前树 / binary ASCII / 可达历史 blob / CI fetch-depth |
| `result` | `pass`（仓库扫描子门） |
| `measured_value` | 当前扫描 1299 个 tracked、1178 个 text、121 个 binary ASCII，0 命中；历史扫描 4165 个 reachable blob，0 命中；值全程 redacted。 |
| `threshold` | 当前与历史 high-confidence hits=0；受控占位必须全值匹配；高风险 env/key/container 路径拒绝；输出不含匹配值。 |
| `commit_sha` | `3077fee`、`82c0920`；安全复核 follow-up `8e5c076` |
| `migration_head` | `not_applicable` |
| `environment` | 本地 Git 仓库；实现 HEAD `0d6da99`，扫描包含本轮已暂存 active docs/evidence；CI checks 使用 `fetch-depth: 0`；无外部网络。 |
| `dataset_manifest` | Git 跟踪树与 `git rev-list --objects --all` 可达对象；不读取 Git 忽略的本地开发凭据。 |
| `started_at` | `2026-08-12T00:48:00+08:00` |
| `finished_at` | `2026-08-12T02:18:24+08:00` |
| `actor` | Codex desktop agent |
| `approver` | `pending`（生产环境隔离仍要求非执行者复核） |
| `command_or_runbook` | `pnpm secrets:check`；`pnpm secrets:history`；CI checks。 |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-16/repository-secret-scan-20260812.txt` |
| `artifact_hash` | `476147a3b2141ea2bd43861639824246c72c63aa0f4ab0fe459e46130b369e41` |
| `retention` | 本摘要与小型 artifact 随 Git 历史永久保存；扫描输出不保存 secret 值。 |
| `access_roles` | 仓库读权限持有者 |
| `failure_ticket` | 独立环境/data/secret/Storage/domain 隔离、runtime secret-store 复核与非执行者批准 pending。 |
