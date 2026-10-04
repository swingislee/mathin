# DEV-CW-1 Step 8E · 统一课件工作区窄范围部署候选

> **状态**：`CANDIDATE PREPARED / AWAITING PRODUCTION WRITE AUTHORIZATION`
>
> **日期**：2026-09-03
>
> **边界**：本批只准备候选、做一次候选构建、定向合同检查、本地事务回滚演练和生产只读结构快照。没有执行生产 migration、应用发布、数据库／Storage／release 写入，也没有进行全量备份或全量回归。

## 1. 候选提交边界

生产应用当前提交为 `a1650040ce0d3891e98e96b3e9bc14a7394b76e8`。开发验收提交 `71b008dd` 与该生产提交的 merge-base 是 `8b9b195e`；若直接发布会夹带 125 个并行提交，因此没有把开发主线当作部署包。

独立候选分支 `codex/courseware-workspace-rc-20260903` 从生产提交直接建立，候选提交为 `d8fe305d5927ab620c7a2c428a70f282b0296fe7`。它只投影已验收的课件工作区路径及其直接运行依赖，共 111 个文件；候选工作树保持干净。候选包含以下 6 条 migration：

1. `20260831000100_courseware_page_rename.sql`
2. `20260901000100_courseware_adapted_draft_bootstrap.sql`
3. `20260902000100_courseware_admin_object_capability.sql`
4. `20260902000500_courseware_legacy_publish_retirement.sql`
5. `20260902000900_courseware_source_runtime_drafts.sql`
6. `20260903000700_courseware_page_insertions.sql`

## 2. 窄范围机器检查

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 候选定向课件合同 | `PASS` | 8 个课件测试文件，52/52 通过；覆盖共享工作台、节点编辑、4:3、来源运行时草稿、插入与文字编辑 |
| 候选 TypeScript | `PASS` | 候选工作树类型检查通过 |
| 候选 production build | `PASS` | Next.js 16.2.11 完成编译、TypeScript、318 个静态页面生成和路由清单收口 |
| 候选准备脚本 Vitest | `PASS` | `tests/courseware-workspace-rollout.test.ts` 5/5 |
| 候选准备脚本 ESLint | `PASS` | 两个脚本与对应测试无错误 |

这些结果只证明候选边界和所覆盖合同，不代替生产页面人工验收，也不表示已部署。

## 3. 本地 migration 回滚演练

`pnpm cw:workspace-rollout:candidate -- --local-rehearsal --compact` 在本地 Supabase 中建立结构基线，把 6 条 migration 放进同一事务执行，断言新增函数存在、旧公开发布函数已经退出，然后回滚并逐项比对页面、revision、轨道 head、binding、资源、release、冻结课次、migration ledger、约束与相关函数定义 hash。

- `rehearsalPassed=true`
- `rollbackRestoredBaseline=true`
- `migrationCount=6`
- 本地数据库指纹：`5af56ae6…68d0f`

演练未留下本地 schema 或业务数据变更。

## 4. 生产只读结构快照

生产快照在 `REPEATABLE READ READ ONLY` 事务中只读取候选涉及的函数定义／owner／ACL／注释、`cw_page_revisions_doc_check`、6 条 migration ledger 状态和少量聚合计数，事务随后回滚。它不是全库备份，不读取或保存用户明细。

- 目标：`xiaomi` / 既登记生产数据库指纹 `10e3f97e…21a0c`
- 当前 migration head：`20260830000700_teacher_microcourse_editor_unification`
- 6 条候选 migration：全部 `applied=false`
- 当前约束：`cw_page_revisions_doc_check`，`validated=true`
- 捕获的既有相关函数：8 个
- 临时快照：`C:\Users\admin\AppData\Local\Temp\mathin-courseware-rc-20260903-v3\production-courseware-schema-snapshot.json`
- SHA-256：`ac8ab8f6b52cf85b6530b6aae6e470b875cb2182871af70d4c3dc497a48070df`

该快照可用于发布前漂移对照和相关函数／约束的窄范围恢复参考；它不替代正式数据库备份。

## 5. 下一道门

本批到此停止。实际发布需要产品负责人另行明确授权生产 migration 与应用切换；执行时固定候选 `d8fe305d…`，先确认生产指纹、migration head、current/previous 和只读快照未漂移，再按 6 条 migration 顺序与应用候选完成小增量发布及受影响 postflight。任何 preflight 漂移都应停止，而不是自动跟随开发主线。
