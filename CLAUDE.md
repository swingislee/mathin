@AGENTS.md

# Claude Code specific instructions

- 对复杂任务先给出实施计划。
- 使用 Claude 专属子代理时，不要让多个子代理同时修改同一文件。
- 使用中文回复
- 开始协作任务时运行 `node scripts/agent-context.mjs`，从输出中的集成分支索引定位任务卡；按卡片登记的 worktree 和修改范围施工。
- 修改子目录前读取该目录及祖先目录的局部 `AGENTS.md`。根目录的导入不代表所有局部规则都已加载。
- 使用项目技能时直接读取 `.agents/skills/<name>/SKILL.md`；其中 `verify` 的入口是 `.agents/skills/verify/SKILL.md`，共享版本也可作为普通文件读取，无需安装插件或同步私人设置。
