# 历史资料导入演练

本流程将飞书和 Excel 原文写入独立 SQLite 档案库，供开发管理员查询和核对归属。它不创建正式家庭、沟通、报名、班级、课次或考勤，也不修改现有 Supabase 业务数据。

## 数据范围

- `.base` 保留独立表、原记录 ID、字段原值、可读值、来源日期精度、关联与缺失引用提示；相同快照精确去重，不同内容的快照全部保留。
- `.xlsx` 按 OOXML 的实际单元格提取，保留源行列、公式、缓存值、合并范围和格式。横向多孩名单保留位置上下文并等待归属复核；未计算公式不编造数值。
- `.xls` 和图片随源目录快照保留；本轮 `.xls` 已证实与对应 `.xlsx` 单元格一致，不重复建立检索记录。
- 身份候选只取已完成导入账本可追溯的学生和线索。正式目标通过来源键重新解析，本地 UUID 只用于本次快照定位。
- 唯一姓名与电话组合、或明确来源 ID 可形成匹配；仅姓名、仅电话、多孩、冲突和学生/线索双目标进入复核。明确 person 关联仅作一跳传播，共享班级/活动不传播家庭归属。
- 用户决定另存 `user-confirmed-decisions.json`：30 条测试沟通排除，31 人误升年级仅在预览纠正，5 个历史班级仅归档。保留每次决定变更历史。

## 执行

运行要求：仓库 Node.js 22.16 或兼容 `node:sqlite` 的版本，以及可用的 Python 3 标准库。SQLite 在该 Node.js 版本会提示实验性状态；本流程仅用于本地演练，生产存储适配需单独验证。

1. 按 `docs/agent/operations.md` 核对本机、应用实际 Supabase origin、监听进程及目标目录。将本次检查写入本地 attestation JSON：`checkedAt`（UTC）、`host`、`supabaseOrigin`、`targetDirectory`，以及 `listeners` 数组中每项的 `Address`、`Port`、`Pid`、`Process`。目标目录为工作区 `.tmp/history-archive-rehearsal`。脚本要求最近一小时的本机证明，并再次核对 `.env.local`。
2. 执行下列命令，参数替换为本地已核对的文件路径。快照格式为 `{table,rows}[]`，包括来源账本、学员、线索及其来源信息。决定文件须为已确认历史班级归档的最新版本。

```text
node scripts/history-archive-rehearsal.mjs --source <源目录> --snapshot <只读数据快照.json> --decisions <用户确认.json> --python <python可执行文件> --attestation <本次环境核对.json>
```

脚本复制源文件并核对字节 SHA-256，每次建立新的 `run-…` 目录。提取结果、匹配、实体、决定、原始资料、数据库和 manifest 均保存到该目录。只有覆盖计数、引用和数据库完整性检查通过后才切换 `current.json`，已完成运行继续保留。失败运行不会切换当前档案。

3. 以固定开发管理员打开 `/zh/dashboard/history-import` 或 `/en/dashboard/history-import`。页面同时核对开发环境、staff 使用环境和 admin 身份，数据读取层再次鉴权并使用只读 SQLite 连接。生产模式和非本机 Supabase origin 均拒绝此入口。
4. 按姓名、电话或关键词检索，使用来源/归属筛选，打开完整原文与候选对象。明确匹配对象可查看相关资料；可能相关资料只在查询家庭时按需确认，不形成集中复核队列，也不自动汇集成已确认家庭。日期缺失和源字段冲突保留原状。

源资料与运行目录包含个人信息，只保存在忽略目录；仓库只提交程序、合成测试和匿名汇总。页面是私有管理员预览，尚无生产发布或正式家庭关系写入。

## 检查与恢复

- 执行 `tests/history-archive-*.test.ts` 的定向 Vitest，及 `python tests/history-archive-excel.test.py`。包含来源完整性、横向名单、身份冲突、只读检索、参数化查询、分页与服务端权限边界。
- 页面启动、原文返回和权限检查通过后交给产品负责人抽查，不以自动化结果替代归属与视觉验收。
- 需要回看旧运行时，将 `current.json` 指向已核对的旧 `run-…/archive.sqlite`；数据读取仍检查目录范围、文件实际路径及 schema 版本。此步骤只切换演练查询版本，不回滚或删除 Supabase 数据。
- 已完成运行可重放；新导出文件的跨批次版本合并、人工归属决定写入和生产数据库适配属于后续增量，当前不会覆盖旧档案或同步开发 UUID。
