# R1-9 / P6-9 双轨来源 manifest 只读门禁

## 1. 目的与边界

该门禁把正式 `release_no=1` 的来源固定为可审阅、可重复计算的离线清单。它只读取本地 JSON/NDJSON 文件，不连接 Supabase、Storage、SSH 或生产环境，不生成 SQL，也不执行清理、发布或 track head 更新。

默认入口：

```bash
node scripts/plan-r1-courseware-source.mjs
```

仓库 example 只有每套课程各 1 讲，输出必须包含 `example-manifest`、两项 `incomplete-inventory:*` 和两项 `storage-audit-pending:*` blocker。它用于展示格式，不能作为 R1-9、R1-15 或 R1-18 通过证据。

实际只读导出的入口：

```bash
node scripts/plan-r1-courseware-source.mjs <reviewed-manifest.json>
```

planner 即使无 blocker 也固定 `stageClosureAllowed=false`。无 blocker 只证明 P6 来源清单满足 E1/E2 合同；R1-9 还需要登记受控环境中的真实导出和 Storage 读取证据，R1-15/18 仍分别受隔离演练和人工生产批准约束。

## 2. 文件组成

| 文件 | 内容 |
| --- | --- |
| `r1-courseware-source-manifest.schema.json` | 顶层只读边界、1187/2374 目标和 NDJSON 行结构 |
| 顶层 manifest | 数据库只读导出指纹、两份 inventory 文件 LF 归一化 SHA-256、两类 Storage 审计和最终计数 |
| 爱学习 inventory NDJSON | 4 门、52 讲，每讲固定两轨、页、revision、binding、对象和 snapshot hash |
| E 系列 inventory NDJSON | 90 门、1135 讲，每讲固定两轨、页、revision、binding、对象和 snapshot hash |

每一行只描述一讲，行内必须包含 `native-16x9`、`adapted-4x3` 两轨，且顺序固定。inventory 按 `catalogVersion → productCode → lecture.no → lecture.id` 排序；文件摘要必须使用 `textFileSha256` 的 LF 归一化口径。

## 3. 必须由只读导出器产生的事实

1. 课程使用 `catalogVersion + productCode` 自然键，lecture、page、revision、asset revision 使用目标数据集里的稳定 UUID。实际 manifest 禁止 placeholder。
2. 每个 page 记录源 revision、规范化文档 SHA-256、文档 binding key 集摘要和解析后的 binding 明细。文档 key 集与解析明细不一致时停止。
3. 每个 binding 固定 `bindingKey → assetRevisionId → objectSha256 → bucket/path`。普通 CAS 必须位于 `cw-objects/sha256/<前两位>/<sha256>`；H5 必须位于 `cw-h5/packages/<packageHash>`，并记录 `__mathin_manifest.json` 的 SHA-256。
4. 每轨分别计算 page set、binding set、resource set 和目标 release snapshot 的 canonical JSON SHA-256。snapshot 的数组顺序与 `publish_cw_track_release` 一致：页按 `page_no`，binding 按 `binding_key`。
5. E 系列 `adapted-4x3` 中 `role=background` 且 `variant=mathin-4x3` 的资源必须逐项为 `approved`；未批准、pending、rejected 或悬空资源使导出失败。爱学习按 4:3 母版合同使用 `verified-4x3-source-master`，不伪装成 E 系列派生背景。
6. 爱学习只允许四个固定产品码；每个年级恰为 13 讲，编号必须是 `1—6、8—14`，从而显式保存第 7、15 讲的来源缺口。
7. Storage 审计必须读取清单范围内全部对象，报告 `missingObjectCount=0`、`hashMismatchCount=0`，并让审计的 resource set hash 与 inventory 逐项重算结果一致。H5 审计还需逐包核对 manifest；只检查数据库行存在不够。

## 4. 固定数量

| 范围 | course | lecture | native | adapted | release-1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| E 系列 2025 | 54 | 651 | 651 | 651 | 1302 |
| E 系列 2026 | 36 | 484 | 484 | 484 | 968 |
| 爱学习 G+ 2026 秋季 | 4 | 52 | 52 | 52 | 104 |
| 合计 | 94 | 1187 | 1187 | 1187 | 2374 |

实际清单任何一项数量不符均停止。目标 release note 固定为 `production-v1.0-baseline`，每讲每轨目标 `releaseNo=1`，legacy current release 的最终目标为 1187 个 native release-1；本 planner 不创建这些 release。

## 5. 仍需真实环境完成的 E3

- 在批准的只读数据副本中实现/运行导出器，产出 1187 行全量 inventory；记录数据集指纹、migration head、执行人、复核人和时间。
- 对 `cw-objects` 与 `cw-h5` 的清单范围执行真实对象读取与 SHA-256 核对；大清单作为受控 artifact 保存，在 `docs/evidence/r1/README.md` 登记 LF 归一化摘要、保留期和访问角色。
- 由非执行者复核 E 系列 90/1135、爱学习 4/52、两轨 2374 个 snapshot hash、爱学习编号缺口及 Storage 零缺失/零漂移。
- R1-15 只能在生产快照隔离副本把同一来源 manifest 用于清理/release-1 演练；R1-18 仍需人工批准、备份验证和目标二次确认。该 runbook 不授权任何写操作。
