# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# Claude Code specific instructions

- 对复杂任务先给出实施计划。
- 使用 Claude 专属子代理时，不要让多个子代理同时修改同一文件。
- 使用中文回复
- 开始协作任务时运行 `node scripts/agent-context.mjs`；已分配任务时加 `--task TASK-ID` 核对分支和修改范围，从 `main` 的登记表定位任务卡。
- 修改子目录前读取该目录及祖先目录的局部 `AGENTS.md`。根目录的导入不代表所有局部规则都已加载。
- 项目端到端验证使用 `mathin-verify` 入口，它读取 `.agents/skills/verify/SKILL.md` 的唯一正文；若技能菜单尚未刷新，直接读取源文件。旧私人 `verify` 副本按共享规则处理。

## 常用命令速查

完整检查清单与各套件当前基线见 `README.md`「检查」；验证分级见 `docs/agent/operations.md`。包管理器为 pnpm（`packageManager` 已锁定，必要时加 `corepack` 前缀）。

- 开发：`pnpm dev`（`scripts/dev.mjs` 包装 Next 16，监听 `0.0.0.0:3130`，统一堆预算）。
- 窄检查：`pnpm lint`、`pnpm typecheck`。
- 单个单测：`pnpm vitest run tests/<name>.test.ts`，按用例名过滤加 `-t "<用例名>"`；Vitest 只收 `tests/**/*.test.ts`，`@` 指向 `src`。
- 单个 E2E：`pnpm playwright test e2e/<name>.spec.ts`；固定账号读 Git 忽略文件，非必要不跑（见 AGENTS.md 人工验收规则）。
- 数据库类型：改 schema 后跑 `pnpm db:types`，`pnpm db:types:check` 校验；migration 位于 `supabase/migrations/`，`pnpm migrations:ledger` 维护台账。
- 专题门禁：`doc21:audit`～`doc24:audit`、`p4e:audit`、`sml:test` 等只在触及对应领域时运行；`pnpm plan:audit` 只在阶段收口时运行。

## 架构地图

- `src/app/[locale]/`：next-intl 双语路由（zh/en，文案在 `messages/`）；`src/app/api/` 含 `v1`（家长端等外部合同，规范见 `contracts/parent-api/`）、H5 嵌入与健康检查；`src/app/embed/` 为课件/H5 嵌入入口；`src/proxy.ts` 是 Next 16 的请求代理（替代 middleware）。
- `src/features/<域>/`：业务按领域纵向组织（school 运营后台、classroom/whiteboard 课堂、courseware-* 课件平台、spatial-math 3D、notebook、terms、games、parent-portal 等），页面路由只做组装。若有局部 `AGENTS.md`（school、courseware-doc、tools、games/sudoku）先读。
- `src/lib/`：横切基础设施——`supabase/` 客户端、`auth.ts` 鉴权、`environment.ts` 环境边界、`uuid.ts`（`newId()`）、`database.types.ts`（生成文件，勿手改）。
- `supabase/`：自托管 Supabase 的 migrations、seed、tests 与 CI 重建脚本；RLS 与 Server Action 规则见 `docs/agent/data-and-classroom.md`。
- `apps/`：原生家长端（微信小程序 / iOS / Android），独立构建，共用后端；先读 `apps/AGENTS.md`。
- `scripts/`：开发包装、审计门禁、课件导入（`cw:*`）、R1 生产规划与造数脚本；含写入的脚本受 AGENTS.md 生产边界约束。
- `docs/plan/` 是产品与阶段权威，`docs/agent/` 是按任务读取的 Agent 细则，`.ai/` 是多 Agent 任务登记。
