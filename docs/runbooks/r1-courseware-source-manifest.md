# R1-9 / P6-9 双轨来源 manifest 只读门禁

## 1. 目的与边界

该门禁把正式 `release_no=1` 的来源固定为可审阅、可重复计算的离线清单。它只读取本地 JSON/NDJSON 文件，不连接 Supabase、Storage、SSH 或生产环境，不生成 SQL，也不执行清理、发布或 track head 更新。

默认入口：

```bash
node scripts/plan-r1-courseware-source.mjs
```

仓库 example 只有每套课程各 1 讲，输出必须包含 `example-manifest` 和两项 `incomplete-inventory:*` blocker。示例 Storage/H5 审计文件自身可完整核对，但课程数量仍明确阻断；它不能作为 R1-9、R1-15 或 R1-18 通过证据。

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
| `supabase/seed/teaching-plans.json` | E 系列固定 90 门/1135 讲 roster；路径和 LF 摘要均由 validator 固定 |
| Storage objects NDJSON | 与 binding 范围逐对象对应的可读审计文件；顶层只记录文件路径和 LF 摘要，不接受自报 passed/count |
| H5 package manifest JSON | `mathin-h5-manifest-v1` 包清单；每个 H5 binding 显式记录本地审计路径和 LF 摘要 |
| 爱学习 inventory NDJSON | 4 门、52 讲，每讲固定两轨、页、revision、binding、对象和 snapshot hash |
| E 系列 inventory NDJSON | 90 门、1135 讲，每讲固定两轨、页、revision、binding、对象和 snapshot hash |

每一行只描述一讲，行内必须包含 `native-16x9`、`adapted-4x3` 两轨，且顺序固定。inventory 按 `catalogVersion → productCode → lecture.no → lecture.id` 排序；文件摘要必须使用 `textFileSha256` 的 LF 归一化口径。

## 3. 必须由只读导出器产生的事实

1. 课程使用 `catalogVersion + productCode` 自然键，lecture、page、revision、asset revision 一律使用目标数据集里的 UUID；example 字符串 ID 和重复字符 SHA-256 在任何模式下都拒绝。
2. E 系列每行必须逐项匹配固定 roster 的 product、catalog version、grade、lecture.no，并匹配两个已冻结来源包版本。`(catalogVersion, productCode, lecture.no)` 必须唯一，禁止复制一行只换 UUID 来维持聚合数量。
3. 每个 page 显式记录非空 `requiredBindingKeys`、源 revision、规范化文档 SHA-256、`learningCheckEnabled` 和解析后的非空 binding 明细。required set 缺失或出现额外 binding 时停止，`missingBindingCount` 从集合差值计算。
4. 每个 binding 固定 `bindingKey → assetRevisionId → objectSha256 → bucket/path`。普通 CAS 必须位于 `cw-objects/sha256/<前两位>/<sha256>`；H5 必须位于 `cw-h5/packages/<packageHash>`，其本地 `mathin-h5-manifest-v1` 必须可读、LF 摘要匹配、`packageHash`/`byteCount`/入口与文件集合自洽。
5. 每轨分别计算 page set、binding set、resource set 和目标 release snapshot 的 canonical JSON SHA-256。snapshot 精确对应现役 `publish_cw_track_release` 合同：页按 `page_no`，binding 按 `binding_key`，每页包含 `pageDocId`、`revisionId`、`bindings`、`learningCheckEnabled`。
6. E 系列每一讲的 `adapted-4x3` 必须至少显式绑定一项 `role=background`、`variant=mathin-4x3`、`adaptationStatus=approved` 资源；删除、改名或改成 not-required 均停止。爱学习按 4:3 母版合同使用 `verified-4x3-source-master`。
7. 爱学习只允许四个固定产品码；每个年级恰为 13 讲，编号必须是 `1—6、8—14`，从而显式保存第 7、15 讲的来源缺口。
8. 两个 Storage objects manifest 必须是可读 NDJSON 且 LF 摘要与顶层声明一致；validator 将其逐项与 binding 资源集合比较后自行计算 missing/hash mismatch，不信任自报状态或计数。
9. manifest 内所有文件路径只允许相对路径；URI、UNC、盘符绝对路径、根外路径和符号链接逃逸在读取前拒绝。CLI 默认只读仓库内文件；受控调用方可显式提供预批准的本地 artifact root。

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
