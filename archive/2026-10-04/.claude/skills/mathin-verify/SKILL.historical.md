---
name: mathin-verify
description: Mathin 项目端到端验证入口。在明确需要浏览器或 Playwright 验证时，读取仓库共享配方并复用固定开发账号。
---

# Mathin 共享验证入口

读取并执行 [共享 verify 配方](../../../.agents/skills/verify/SKILL.md)。该文件是唯一正文，本入口只负责 Claude 的技能发现。

按根 `AGENTS.md` 判断本任务是否需要浏览器验证；产品人工验收与自动检查分别记录。旧的本机 `verify` 副本保留为私人历史，不作为本项目验证流程。
