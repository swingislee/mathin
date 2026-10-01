# 协作索引

> 集成分支：`main`。由统筹更新并提交后生效；worktree 内运行 `node scripts/agent-context.mjs` 获取集成分支版本。
> 项目阶段与施工优先级继续读取 [doc 04](../docs/plan/04-roadmap.md)；本文件仅维护协作执行索引。

- 分工由产品负责人逐任务指定；常用安排为 Claude 负责前端，额度不足或特殊任务时可以转交。
- 本次协作设置由 Codex 维护；后续统筹与集成人在具体任务卡中指定。
- 实现者 / 复核者：由任务卡指定；Claude 尚未在本轮回传接入确认。
- 共享规则与流程：[AGENTS.md](../AGENTS.md) → [协作协议](../docs/agent/collaboration.md)。
- 模板：[任务卡](tasks/TEMPLATE.md)、[交接单](handoffs/TEMPLATE.md)。

## 当前任务

| ID | 目标 | 实现者 | 复核者 | 执行状态 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| [COLLAB-20261001](tasks/COLLAB-20261001.md) | 建立双 Agent 项目管理入口 | Codex | Claude 接入确认待回传 | done（配置与文档） | 按卡片中的启动说明接入 Claude，再选择首个业务任务 |

此表只登记新协议下明确分配的任务。既有聊天与历史 worktree 未纳入本次认领；开工仍需核对实际工作树及用户当前指令。

## 等待安排

首次试运行由产品负责人选择一个真实业务增量，再由统筹创建任务卡与隔离 worktree。当前没有为 Claude 自动选取业务任务，也没有改变 R1-Live 的任何验收状态。
