# 课程资源导入与导出

教师需要持续使用自己的教材、页内容与课堂材料。导入保持源资源可追溯，并形成可以编辑、备课和发布的对象。

- `pnpm cw:import`：导入课程资源包。
- `pnpm cw:adapt-4x3`：生成或调整 4:3 衍生资源。
- `pnpm cw:aixuexi:build`、`pnpm cw:aixuexi:import`、`pnpm cw:aixuexi:task`：爱学习资源包处理与任务续作。
- `pnpm cw:source:export`：按源清单导出。

每个命令先看参数与当前输入，识别源目录、输出目录、课程范围与真实数据库目标；连接凭据从私有配置读取。输入包、导出文件和临时截图按数据性质放受控目录。

源页、16:9/4:3 衍生页、教师修改与正式 release 保持稳定身份。替换某页先明确当前页和传播范围，保留冻结版本、课堂引用与必要追溯。正式课程资源按 [数据操作](data-operations.md) 保护。

包结构的精确合同在 `schemas/r1-courseware-source-manifest.schema.json`、`scripts/lib/` 和实际命令实现中；历史批次方法保存在 [归档](../../archive/README.md)。普通课程处理不附加旧阶段的统一发布审计。
