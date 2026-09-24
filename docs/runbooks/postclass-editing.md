# 课后学情修订与作业模板

状态：2026-09-25 开发端已交付，待人工视觉与业务验收。本轮只更新本机隔离开发库；没有生产部署，也不关闭 R1-Live Gate。

## 操作入口

- 班级展开课次或进入课次的课后记录，使用“补录／修订学情”。可保留原检查点 ID 更名、补充检查点、更正逐生档位，并修改分数、专注度、参与度、掌握度和评语。已发布课评修改后沿原发布流程重新发布。
- 班级详情的“班级作业题号模板”维护常用题号与分组名称，可从 6 题或 8 题开始，再增减题号。同一组内题号唯一，不同组可以各有第 1 题。
- 教研讲次的“本讲作业与标准教案”维护本讲题库、参考答案、主题和文字教案。教研负责标准内容，班级教师读取并复制到具体作业。
- 发布课次作业时，优先复制班级题号结构；没有班级模板时使用讲次题库结构。按“分组名称＋题号”匹配具体题目，未匹配的题目留空，由老师在编辑入口选择本讲题目或自行填写。
- 已发布作业旁和逐题登记页提供“编辑作业与课后主题”。全班共同题目和逐生题目分别编辑；学生调整可以恢复共同内容。原有题目可更名与调整内容，已有题目及逐题结果继续保留。
- 跟进提交保存所有已填写学生并显示成功人数，空白学生不提交。班级名单使用一次数据库批量写入；课后沟通逐条保存，失败草稿保留，重试只提交剩余记录。班级整体沟通单独提示，不计入学生人数。

## 数据与权限

- 学情修订按课次教师分配／代课范围和原功能权限执行；冻结名单及临时调入学生沿用课次名单。保存前核对完整读取版本，冲突时保留草稿。
- `session_learning_amendments` 保存修订前后内容与操作人。清除某格当前判断时，其原值仍保存在修订记录中；原课程 release 与冻结课件不变。
- `homework_documents` 分别关联班级、讲次或具体作业，`homework_document_revisions` 保留每次保存前后值。题目以独立副本保存，教研／班级模板后续修改不会传播覆盖已布置作业。
- 教研写入要求 `courseware.review`；班级模板与作业调整沿用班级教师及管理员范围。管理者原有的独立作业发布权限继续保留。两类修订表均启用 RLS，普通学生及无关人员不能读取内部答案、个性化配置或审计内容。

## 本机验证与迁移

入口 `scripts/postclass-work-local.mjs` 在任何数据库写入前核对主机、Supabase origin、监听进程、Docker 网络与数据库指纹。凭据与身份来源沿用已有私有开发配置，原始错误与 HTTP 结果只保存到忽略的 `.tmp/`。

按顺序执行，每个 scope 的 `--apply` 要求相同主机和 SQL 校验和的 `--check` 已通过：

```text
node scripts/postclass-work-local.mjs --preflight learning
node scripts/postclass-work-local.mjs --check learning
node scripts/postclass-work-local.mjs --apply learning
node scripts/postclass-work-local.mjs --preflight homework
node scripts/postclass-work-local.mjs --check homework
node scripts/postclass-work-local.mjs --apply homework
```

对应迁移：

- `20260924010000_postclass_learning_amendments`
- `20260924011000_homework_templates`
- `20260925000100_homework_group_labels`

已通过：事务内的已下课学情更正、补录、版本冲突、前后审计、题号分组、模板绑定、逐生调整、原结果保留、越权／RLS 拒绝和夹具回滚；受影响组件与 Action 测试、TypeScript、变更文件 lint。固定开发教师的中英文班级、课后记录、教研讲次页面 HTTP 启动检查通过。现有固定样本尚未下课，正式提交后的修订由已下课事务夹具与组件测试覆盖，真实业务操作仍待用户验收。

生成类型只纳入本任务新建的 3 张表和 7 个函数的实际 pg-meta 输出，保留仓库现有其他类型，避免带入本机无关 schema 漂移；迁移摘要检查通过。
