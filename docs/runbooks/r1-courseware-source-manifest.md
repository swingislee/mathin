# R1-9 / P6-9 双轨来源 manifest 只读门禁

## 1. 目的与边界

该门禁把正式 `release_no=1` 的来源固定为可审阅、可重复计算的离线清单。它只读取本地 JSON/NDJSON，不连接 Supabase、Storage、SSH 或生产环境，不生成 SQL，也不执行清理、发布或 track head 更新。

```bash
node scripts/plan-r1-courseware-source.mjs
node scripts/plan-r1-courseware-source.mjs <reviewed-manifest.json>
node scripts/plan-r1-courseware-source.mjs <reviewed-manifest.json> --artifact-root <approved-local-directory>
```

仓库 example 每套课程体系各含 1 讲，必须输出 `example-manifest` 和两项 `incomplete-inventory:*` blocker。即使真实 manifest 无 blocker，planner 也固定 `stageClosureAllowed=false`；它只证明 P6 来源清单满足 E1/E2 合同，不能关闭 R1-9、R1-15 或 R1-18。

## 2. 文件组成

| 文件 | 内容 |
| --- | --- |
| `schemas/r1-courseware-source-manifest.schema.json` | v3 顶层只读边界、1305/2610 目标、现役 release 身份和 NDJSON 行结构 |
| 顶层 manifest | 数据库只读导出指纹、两份 inventory 的 LF 归一化 SHA-256、两类 Storage 审计和最终计数 |
| `supabase/seed/teaching-plans.json` | E 系列固定 90 门/1135 讲 roster；路径和 LF 摘要均由 validator 固定 |
| 爱学习 inventory NDJSON | G+/X+/A+ 12 门/170 讲，每讲固定两轨、页、revision、binding、对象和 snapshot hash |
| E 系列 inventory NDJSON | 90 门/1135 讲，字段合同同上 |
| Storage objects NDJSON | 与 binding 范围逐对象对应的可读审计文件；不接受自报 passed/count |
| H5 package manifest JSON | `mathin-h5-manifest-v1` 包清单；每个 H5 binding 显式记录本地路径和 LF 摘要 |

每行只描述一讲，必须按 `catalogVersion → productCode → lecture.no → lecture.id` 排序，并依次包含 `native-16x9`、`adapted-4x3` 两轨。文件摘要必须使用 `textFileSha256` 的 LF 归一化口径。

## 3. 只读导出必须证明的事实

1. 课程使用 `catalogVersion + productCode` 自然键；lecture、page、revision、asset revision 使用目标数据集 UUID。example ID 和重复字符 SHA-256 在真实模式拒绝。
2. E 系列逐项匹配固定 90 门 roster 和两个冻结来源包；爱学习逐项匹配 projection v31 的 12 个产品码、三个 package key、年级和讲号。
3. 爱学习显式讲号合同为：G+ 三/四年级、X+ 一/三/四年级和 A+ 一/二年级各 1～15 讲；G+ 五/六年级与 X+ 二/五/六年级只含 1～6、8～14。前者的第 7/15 讲是来源占位，后者是来源缺失，两者不得混淆。
4. 每个 page 显式记录源 revision、规范化文档 SHA-256、`learningCheckEnabled`、非空 `requiredBindingKeys` 和解析后的 binding 明细；required set 差异使流程停止。
5. 每个 binding 固定 `bindingKey → assetRevisionId → objectSha256 → bucket/path`。普通 CAS 位于 `cw-objects/sha256/<前两位>/<sha256>`；H5 位于 `cw-h5/packages/<packageHash>`，包 manifest 的入口、字节数和文件集合必须自洽。
6. 每轨分别计算 page set、binding set、resource set 和 release snapshot 的 canonical JSON SHA-256。`capturedRelease` 必须来自 `cw_lecture_track_heads.current_release_id → cw_lecture_releases` 的严格连接，记录唯一 release UUID、实际 release number 和 immutable snapshot hash；页面、revision 与 binding 只沿该 snapshot 解析，禁止从 draft/current page head、可变 binding 或任意历史 release 拼装。目标 `release` 仍描述未来 `production-v1.0-baseline` release-1，两套 snapshot hash 必须与显式页面内容一致。
7. E 系列 `adapted-4x3` 每讲至少绑定一个 approved `mathin-4x3` 背景；爱学习使用 v31 的 `verified-4x3-source-master`/源播放器兼容结果，不要求 E 系列背景合同。
8. Storage objects manifest 必须可读，LF 摘要与顶层声明一致；validator 从 binding 集合计算 missing/hash mismatch，不信任自报状态。
9. 所有声明路径必须为仓库或 `--artifact-root` 明确批准根内的相对路径；URI、UNC、盘符路径、根外路径和符号链接逃逸在读取前拒绝。顶层 `$schema` 固定从仓库根解析，受控 artifact 不得替换 validator schema。

## 4. 固定数量

| 范围 | course | lecture | native | adapted | release-1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| E 系列 2025 | 54 | 651 | 651 | 651 | 1302 |
| E 系列 2026 | 36 | 484 | 484 | 484 | 968 |
| 爱学习 G+ 2026 秋季 | 4 | 56 | 56 | 56 | 112 |
| 爱学习 X+ 2026 秋季 | 6 | 84 | 84 | 84 | 168 |
| 爱学习 A+ 2026 秋季 | 2 | 30 | 30 | 30 | 60 |
| 合计 | 102 | 1305 | 1305 | 1305 | 2610 |

目标 release note 固定为 `production-v1.0-baseline`，每讲每轨目标 `releaseNo=1`，legacy current release 最终有 1305 个并指向 native release-1。本 planner 不创建这些 release。

## 5. 仍需真实环境完成的 E3

- 在批准的只读数据副本中以单个 `REPEATABLE READ READ ONLY` 快照运行待补 exporter，产出 1305 行全量 inventory；记录数据集指纹、migration head、执行人、复核人和时间。当前仓库已冻结 v3 consumer/validator，真实数据库与 Storage producer 仍 pending。
- 对 `cw-objects` 与 `cw-h5` 执行真实对象读取和 SHA-256 核对；大清单保存到受控 artifact，并在 R1 证据索引登记摘要、保留期和访问角色。
- 由非执行者复核 E 系列 90/1135、爱学习 12/170、2610 个 snapshot、14 个来源显式复习占位、其余讲号缺口及 Storage 零缺失/零漂移。
- R1-15 只能在生产快照隔离副本使用同一来源 manifest 演练；R1-18 仍需人工批准、备份验证和目标二次确认。本手册不授权写操作。
