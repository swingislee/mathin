# 测评经历归类与资料待补

2026-09-08 产品反馈：学生已到场，历程已有学员情况、家长反馈等文字测评，学生列表仍显示待首联。旧读取条件只识别分数、等级及完成时间，遗漏了无分数的文字结果。

## 业务口径

- 已到场的旧测评有学员观察、家长反馈、重点或老师建议时，按已有测评归入待报名；既有报名、在读及课程结束事实继续优先。
- 分数、等级、日期和测评老师保留实际记录。学生列表及测评表共用“资料待补”标签，学生侧栏和测评详情列出具体缺项；补录后重新计算并移除已完成的提示。
- 资料完整性独立于业务阶段。未报名的学生显示测评依据，报名确认提示继续按实际报名事实显示。
- 空记录、只有预约、未到场、已取消和未定稿的快速／教师测评分别保留原有流程。身份关联继续使用学生、线索、参与记录及已关联来源；同名对象分别处理。

## 实现与开发验证

迁移 `20260908120000_student_assessment_stage_facts` 将列表、阶段索引、登记详情、学情背景及 360 的测评判断统一到私有函数 `student_assessment_is_complete`。读取沿用既有权限及当前／历史范围，采用修订后的业务事实；原始业务行保持不变。

本机隔离目标复用 [历史导入目标核对](../../scripts/lib/history-local-target.mjs)。操作入口：

```powershell
node scripts/student-assessment-stage.mjs --preflight
node scripts/student-assessment-stage.mjs --check
node scripts/student-assessment-stage.mjs --apply
```

本次事务演练及开发应用通过：当前名单有 13 条测评记录归入待报名，全部档案中共 99 条归类修正；数据库断言覆盖文字结果、空白、缺席、取消、草稿、有效零分、完成时间、同名身份隔离、列表／详情／统计一致及原有权限。业务表内容摘要保持一致，测试记录全部回滚。

缺项提示、测评读取器及受影响页面的定向 Vitest、ESLint、源码与受影响测试的 TypeScript 检查通过。全仓库 TypeScript 另有 `autumn-identity-review.test.ts`、`source-reconciliation.test.ts` 的既有类型错误，本增量保留这些文件。

状态：**开发端已交付，待人工视觉验收**。验收入口：[学生 · 待报名](http://192.168.5.213:3130/zh/dashboard/students?stage=awaiting_enrollment&scope=all)。生产发布与阶段 Gate 继续按原状态维护。
