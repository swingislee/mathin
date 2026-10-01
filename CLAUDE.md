@AGENTS.md

# Claude Code specific instructions

- 对复杂任务先给出实施计划。
- 使用 Claude 专属子代理时，不要让多个子代理同时修改同一文件。
- 使用中文回复
- 开始协作任务时运行 `node scripts/agent-context.mjs`；已分配任务时加 `--task TASK-ID` 核对分支和修改范围，从 `main` 的登记表定位任务卡。
- 修改子目录前读取该目录及祖先目录的局部 `AGENTS.md`。根目录的导入不代表所有局部规则都已加载。
- 项目端到端验证使用 `mathin-verify` 入口，它读取 `.agents/skills/verify/SKILL.md` 的唯一正文；若技能菜单尚未刷新，直接读取源文件。旧私人 `verify` 副本按共享规则处理。
