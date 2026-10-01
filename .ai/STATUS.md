# 协作索引

> 集成分支：`main`。当前负责人、状态、分支、文件归属与检查点唯一维护在 [registry.json](registry.json)，由本批集成人提交后生效。本页只提供入口。
> 项目阶段与施工优先级继续读取 [doc 04](../docs/plan/04-roadmap.md)；本文件仅维护协作执行索引。

- 分工由产品负责人逐任务指定；常用安排为 Claude 负责前端，额度不足或特殊任务时可以转交。
- 本批集成人由登记表的 `coordinatorTaskId` 指定；具体分工仍由产品负责人决定。
- Claude 接入能力与实际参与分别记录；可发现技能入口已纳入版本控制，实际接入仍待 Claude 回传。
- 共享规则与流程：[AGENTS.md](../AGENTS.md) → [协作协议](../docs/agent/collaboration.md)。
- 模板：[任务卡](tasks/TEMPLATE.md)、[交接单](handoffs/TEMPLATE.md)。

## 日常入口

```powershell
node scripts/agent-context.mjs
node scripts/agent-context.mjs --task TASK-ID
```

第一条读取 `main` 的已提交登记并显示当前修改归属；第二条额外核对本任务分支。编辑登记表时用 `node scripts/agent-context.mjs --check` 检查工作副本；提交后才生效。

## 当前批次与历史

- [协作架构复查](tasks/COLLAB-20261001-R2.md)：协调当前会话并建立可检查登记。
- [Motion Lab](tasks/DEV-MOTION-20261001.md)、[班级列表](tasks/DEV-CLASS-LIST-20261001.md)、[数位教具](tasks/DEV-PLACE-VALUE-20261001.md)：当前业务范围与检查点依据；实时状态以登记表为准。
- [首次协作设置](tasks/COLLAB-20261001.md)：历史交付记录。

本次沟通确认的旧任务可在主目录完成当前安全增量，以 `primary-transition` 标记；新并行批次使用独立 worktree。历史未登记任务与缓存保持原状。
