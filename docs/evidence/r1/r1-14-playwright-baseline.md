# R1-14 · 非五模块 Playwright 基线子门（进行中）

## 状态

2026-08-12 建立正式 Playwright Chromium 基线和 release fail-closed runner。9 条本地/LAN 读态旅程均有绿色证据；未提供明确非生产 target attestation 时 release runner 主动失败，写态、英文、跨浏览器与连续无 flaky 门仍 pending。

| 字段 | 值 |
| --- | --- |
| `gate_id` | `R1-14-NON-MODULE-PLAYWRIGHT-BASELINE-20260812` |
| `domain` | 鉴权边界 / 学生、家长、教师门户 / Notebook / LAN / release target policy |
| `result` | `pending`（本地 Chromium 基线通过；正式 release 门未执行） |
| `measured_value` | 静态合同 16/16；Playwright 精确列出 9 条；真实 Chromium 首轮 8/9，Notebook 产品修复 commit `ffe3ec6` 后失败项定向 1/1，合计 9 条均绿；缺 target attestation 的 `e2e:release` 按预期失败。 |
| `threshold` | release 必须 exact origin、64-hex target fingerprint、明确非生产环境、LAN origin、student/parent/teacher 三个必需旅程角色齐全、9/9 expected、skipped/unexpected/flaky=0；安全修订后固定账号项目 trace/screenshot/video 永久 off。 |
| `commit_sha` | `0d55044`；安全复核 follow-up `8e5c076` |
| `migration_head` | 开发库 `20260812000300`；本子门不执行迁移。 |
| `environment` | loopback 与 `192.168.5.213:3130` 开发目标；固定忽略账号；非生产。 |
| `dataset_manifest` | `.claude/test-accounts.local.md` 固定开发账号（Git 忽略）；未创建账号。首轮失败的临时 artifact 已清除且未入库；commit `8e5c076` 后固定账号项目永久关闭 trace/截图/视频。 |
| `started_at` | `2026-08-12T00:49:00+08:00` |
| `finished_at` | `2026-08-12T01:54:00+08:00` |
| `actor` | Codex desktop agent |
| `approver` | `pending`（release target attestation 与非执行者复核未产生） |
| `command_or_runbook` | `pnpm e2e`；`pnpm e2e:release` fail-closed 检查；[`docs/runbooks/r1-playwright-release.md`](../../runbooks/r1-playwright-release.md)。 |
| `artifact_url_or_path` | `docs/evidence/r1/artifacts/r1-14/non-module-playwright-baseline-20260812.txt` |
| `artifact_hash` | `cb6e5803e9778139f10d5fc621869d41c05f0d5289d6b645440ca334132e6a2a` |
| `retention` | 本摘要与小型 artifact 随 Git 历史永久保存；首轮失败的临时浏览器 artifact 已清除且未入库，安全修订后固定账号项目不再生成这些 artifact。 |
| `access_roles` | 仓库读权限持有者 |
| `failure_ticket` | 正式非生产 release 9/9 零 skip 重跑、写态业务旅程、zh/en、跨浏览器和连续 3 次无 flaky failure pending。 |
