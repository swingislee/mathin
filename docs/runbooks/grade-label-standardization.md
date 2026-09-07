# 年级文字统一操作记录

规范以 [doc 03 数据模型](../plan/03-data-and-tech.md#3-supabase-数据模型) 为准。本次只改变 1–7 年级的文字表示，数值年级和业务归属保持原值。

- 页面文案、课程种子、演示数据、业务文档及新建班级名称使用数字年级。`scripts/seed-courses.mjs` 生成的两份 SQL 与 `teaching-plans.json` 保持一致。
- 学生、班级、班级花名册、小地推和爱学习导入继续识别旧写法；外部原文留在来源字段，业务名称与年级标签规范化。课程／班级名称匹配同时识别旧名称和数字名称。
- 新增迁移 `20260907001300_arabic_grade_labels` 修正可编辑名称、年级字典和线索年级文本，并通过列级触发器统一后续写入。历史 migration 的校验和保持原值。
- 触发器仅覆盖迁移中列出的业务文字列。学生姓名、数值年级、来源键、来源原文、课件 revision、release 和课堂冻结内容继续保留，已有鉴权、RLS、审计及校验规则继续生效。

本地入口复用既有的主机、Supabase origin、监听进程、Docker 网络和数据库指纹核对。按顺序运行：

```powershell
node scripts/normalize-grade-labels-local.mjs --preflight
node scripts/normalize-grade-labels-local.mjs --check
node scripts/normalize-grade-labels-local.mjs --apply
```

`--preflight` 只读统计实际影响。`--check` 在一个事务中应用迁移，核对每条文字转换结果、其他业务字段、原始来源和冻结内容计数，再验证旧名称匹配及写入规则，最后整体回滚。`--apply` 要求迁移校验和与业务输入仍对应已通过的检查，保存本地恢复记录，在提交前执行相同不变量检查，并核对提交后结果。私有恢复记录保留于 gitignored 输出目录。

开发验收入口：[课程](http://192.168.5.213:3130/zh/dashboard/courses)、[班级](http://192.168.5.213:3130/zh/dashboard/classes)、[线索](http://192.168.5.213:3130/zh/dashboard/followups/leads)。检查年级字典、课程／班级名称和年级筛选显示 `1`–`7`。本地通过与生产部署分别记录；生产应用仍按本次明确授权和写目标 runbook 执行。

## 2026-09-07 开发执行结果

状态：**DEVELOPMENT READY / AWAITING USER ACCEPTANCE**。在已核对的隔离开发库完成事务回滚检查和正式应用；本次没有生产操作或正式 Gate 收口。

| 业务字段 | 已修正记录 |
| --- | ---: |
| 课程标题 | 103 |
| 班级名称 | 114 |
| 可编辑课件页标题 | 66 |
| 年级字典 | 7 |
| 线索年级文本 | 2770 |

- 迁移 checksum：`eabe6ccd66ead7e24ca0c1a4792d3fed90c1e4388062425509bbabb69e0bb35e`。提交前后逐条核对转换结果及其他业务字段；学生记录、原始线索来源、revision／release 计数保持一致。
- 年级解析、格式化、旧导入匹配、小地推数字输入、花名册名称、爱学习来源兼容的受影响检查通过；数据库写入触发器、内部函数权限和事务回滚验证通过。
- 来源校验、导出及初始化合同通过。当前课程种子 LF 摘要为 `7f4caef6fbdc1849a6ccecd678bc210bc9ce24ee2c37ebceb3bdc87ab7ed39ea`；历史目录摘要保留在精确白名单中。通过重建旧标题并匹配旧摘要，确认种子差异仅为年级标题文字。
- 受影响 ESLint、双语消息键及生成数据库类型摘要检查通过。匿名中英文导入入口均返回预期登录重定向；人工页面验收待完成。
- 全库 TypeScript 仍报告 `autumn-identity-review`、`source-reconciliation` 与其他任务的 `dashboard-table-field-contract` 测试类型错误。既有线索页面合同仍期待已移除的 `listLeadPool` 调用；测评显示合同仍有 3 项关于时间提示和只读占位的失败。这些未涉及本次年级转换的断言保持原样，本次不记录全库回归通过。
