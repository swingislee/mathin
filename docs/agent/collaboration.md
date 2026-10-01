# Codex 与 Claude 协作协议

> 适用范围：同一 Mathin 仓库中的任务分工、并行施工、接手和互审。产品范围、阶段和发布权限继续由现有规划与运维规则管理。

## 1. 角色与权威来源

分工由产品负责人逐任务设定，常用安排是 Claude 负责前端。特殊任务、额度不足或用户调整时可以换人；本次任务登记决定职责。未单独指定统筹时，由接到当前请求的 Agent 维护本次任务记录，这不构成永久分工。

一个并行批次只设一名当前集成人，由 `.ai/registry.json` 的 `coordinatorTaskId` 指定，统一写入 `main` 的任务分配与集成结果；各任务实现者可以不同。两个会话都需要更新登记时交由该集成人串行处理，登记文件与检查脚本均不提供文件锁。

| 角色 | 责任 | 交付物 |
| --- | --- | --- |
| 产品负责人 | 选择业务目标、优先级和验收条件，给出人工验收及生产操作授权 | 明确的任务范围与验收反馈 |
| 统筹 / 集成人（逐任务指定） | 按产品负责人分工拆任务，登记唯一实现者、复核者、文件归属、依赖和环境，集成提交 | 任务卡、协作索引、可验收版本 |
| 实现者（Codex 或 Claude） | 在指定 worktree 实现一个可独立验收的增量，完成定向检查 | 代码提交与交接单 |
| 复核者（另一 Agent） | 只读检查指定提交，核对业务合同、风险和证据，向实现者提出具体问题 | 带文件位置的结论及待修项 |

Claude 前端、Codex 接口与工程可作为派工参考；具体人选以产品负责人当前指令为准，不能依据模型名称自行扩大任务范围。跨领域任务仍只设一个主责实现者。独立复核用于跨 Agent 交付及共享合同变更；额度不足时记录复核待补，继续已授权且不依赖该复核的工作，用户可指定其他复核方式。普通单人小改动沿用现有内循环。

| 信息 | 唯一维护位置 |
| --- | --- |
| 工程与安全约束 | [根 AGENTS.md](../../AGENTS.md) 与任务命中的 `docs/agent/` 文档 |
| 产品合同 / 当前阶段 / 发布门 | [doc 00](../plan/00-overview.md)、[doc 04](../plan/04-roadmap.md)、[doc 25](../plan/25-production-1.0-product-completeness.md) |
| 谁在做什么、分支、文件归属、提交检查点、下一步 | `main` 分支的 [.ai/registry.json](../../.ai/registry.json)；[STATUS.md](../../.ai/STATUS.md) 只提供入口 |
| 目标、验收、依赖说明、沟通依据 | 登记表链接的任务卡；交接单记录实现与复核证据 |
| 代码与接口事实 | 指定 commit 的实现、类型、迁移及检查结果 |
| 稳定设计决定 | 相应专题文档；任务卡链接到决定，避免复制架构与路线图 |
| 项目技能 | Git 跟踪的 `.agents/skills/`；两个 Agent 读取同一源文件 |
| 私人偏好、权限、模型、连接与本机记忆 | 各工具的私有配置；影响另一 Agent 的项目结论提升到上述共享位置 |

登记表的 `agent` 表示实际执行工具；Codex 会话可填实际 `threadId`，Claude 或人工接入没有可用会话 ID 时填 `null`，以任务 ID 交接。工具身份与沟通渠道不构成额外任务授权。

## 2. 任务从需求到交付

1. **拆分**：统筹从[任务模板](../../.ai/tasks/TEMPLATE.md)建立一张可独立验收的任务卡，写清业务结果、授权来源、依赖、复核安排和验收动作；负责人、状态、分支与路径仅在登记表维护。多文件小改动可以是一张卡；同一需求内真正独立的并行增量才分卡。
2. **确定合同**：列出精确路径、共享文件唯一写入者和依赖。两端共同消费的新接口先由一人提交类型、输入输出及错误语义，记录合同提交号；已有稳定接口直接引用现有 commit，无需制造空合同提交。
3. **派工**：统筹运行 `node scripts/agent-context.mjs --check` 验证登记，提交任务卡与登记，再从包含任务说明与合同的精确 commit 建 worktree。每张卡的实现者唯一；认领冲突由统筹解决，卡片尚未分配时可以先只读调研。
4. **实现**：实现者只改本卡约定范围。新发现的跨范围修改先交给统筹更新归属；明确独立的其他工作继续推进。检查按[验证分级](operations.md#验证分级)执行。
5. **交接与互审**：实现者提交代码，记录 base/head、实际改动、验证、未决问题和下一步。复核者按提交范围审阅，修复仍由实现者提交，复核结论绑定新的 head。
6. **集成与验收**：统筹检查范围和工作树，将已复核提交集成到 `main`，处理冲突并只补集成新增风险的检查，交付开发页面。产品验收、部署和 Gate 按各自证据另记。

状态统一使用 `ready` → `in_progress` → `in_review` → `integrated`，遇到依赖可记 `blocked` 并注明解除条件。任务取消记 `cancelled`。验收与环境另外登记，`integrated` 只代表代码已集成；`done` 需要任务约定的验收结果成立。文档任务可以以文档检查作为完成条件，不能由此关闭业务 Gate。

### 额度不足或临时换人

1. 产品负责人指定接手者；统筹更新登记表中的负责人和检查点，在原卡记录切换原因与交接依据，保持同一个任务 ID、验收条件及既有验证证据。
2. 原 Agent 能响应时先停止写入，提交可安全独立验收的增量并写交接；突然中断时由接手者只读检查原 worktree 的状态、diff、最后提交与已有记录，补出交接检查点。未提交改动只登记，不擅自丢弃或宣称验证通过。
3. 确认旧会话不再写入并完成归属转交后，接手者可以继续使用该任务 worktree；分支名中的旧模型名称只表示创建时的 lane，无需为改名搬动文件。需要新 worktree 时从已提交检查点继续，未提交部分先由接手负责人按原意整理，不能假定它已进入新目录。
4. 接手后先验证尚不明确或新增风险的部分，复用同一代码状态下已有可信通过结果。原 Agent 恢复额度后按最新登记读取自己的角色，不自动恢复写入权。

## 3. 工作目录、共享资源与 Git

- 当前主 checkout 的 `main` 是集成入口。产品负责人验收使用主 checkout 的 `http://192.168.5.213:3130/...`。
- 同时写代码的 Agent 使用不同 worktree、不同任务分支。两个会话指向同一 checkout 时，只有已登记的实现者写入，另一会话先只读；切分分支并不能隔离同一目录中的文件和 Git index。
- 2026-10-01 已沟通的现有业务增量以 `primary-transition` 过渡：原 Agent 完成当前安全切片，只处理已登记范围；共享文件和 Git 提交串行协调。该例外在本增量完成后结束，新批次使用 `worktree`。迁移前核对自己的未提交内容，混有他人修改时不用整目录搬迁或自动 Handoff。
- 每个任务使用 `codex/<task>-<lane>` 分支，`lane` 可为 `codex` 或 `claude`，前缀遵循仓库约定。新任务优先检查现有工作树是否适用，不复用仍有他人工作或来源不明的分支。
- 新 worktree 使用约定的已提交基线。未提交修改、依赖目录和忽略的私有配置不会随 Git 提交自动带入；按任务准备依赖与开发环境，凭据留在受控本机配置中。
- worktree 隔离代码与 index；数据库、Storage、端口和外部服务仍可能共享。任务卡指定开发服务与数据库写入负责人，迁移、造数、清理按环境规则串行执行；使用另一端口不会产生另一套数据库。
- `3130` 归集成 checkout。worker 需要服务时先登记独立端口，在自己的目录构建，避免共用 `.next` 或重启别人的服务。worker 的临时预览在交接中说明，产品交付回到统一开发入口。
- doc 00/04/25、登记表和任务卡由统筹维护；实现者通过自己的交接单提供状态。登记的 `writePaths` 是本任务独占范围，`sharedPaths` 是需逐次协调写入的共享文件。路径使用精确文件或以 `/` 结尾的目录，`[locale]` 是字面路径；不使用 glob。生成类型、migration 顺序、消息文件、依赖和锁文件均需明确归属。
- 过渡期间的共享文件按本任务片段暂存，并检查真实 staged diff；`git add CHANGELOG.md` 或 `git commit --only CHANGELOG.md` 都可能带入其他任务内容。同一 index 的操作串行执行，不能通过删除他人暂存内容获得干净工作区。每次提交仍保留隐私 hook。
- 提交、合并前按 [operations.md](operations.md#提交与交付)检查状态、实际暂存内容及隐私扫描。保留现有 hooks；每个增量只包含本任务内容。合并前若目标 checkout 有他人修改，先交接或另建集成候选，不替他人 stash、reset 或清理。
- 已有 worktree 的移除与归档单独处理，不能把历史工作树当成此次初始化的垃圾。

由统筹在任务卡与合同已提交后执行以下形态的命令。变量替换成任务的实际登记值；这不是自动执行的启动钩子：

```powershell
$taskId = '20261001-example'
$contractCommit = git rev-parse main
git worktree add -b "codex/$taskId-claude" ".worktrees/$taskId-claude" $contractCommit
```

将得到的目录交给 Claude 打开。需要第二名并行实现者时，再为其独立任务建 worktree；只读复核可直接查看另一分支的提交。创建前确认目标目录与分支未被占用，失败后检查现状再继续。

## 4. 跨 worktree 读取与交接

**worktree 的文件副本不会实时同步。** 同一仓库共享 Git refs，因此以已提交的 `main` 登记表作为任务分配入口。两个工具开工、恢复上下文、交接和准备集成时运行：

```powershell
node scripts/agent-context.mjs
node scripts/agent-context.mjs --task TASK-ID
```

该只读命令从同一个 main 提交读取登记及任务卡，显示当前文件改动归属、共享窗口和过渡任务；`--task` 另外拒绝在错误分支执行已分配的活跃任务。独占路径重叠、任务 ID 重复和卡片缺失会报错。`--check` 检查当前工作副本，供集成人提交前使用，其结果不表示登记已生效。命令不修改文件、切换分支、启动 Agent 或连接业务服务；未登记文件只提示核对，不自动清理。

若运行环境限制 Node 启动 Git 子进程，直接用终端执行 `git status --short`、`git rev-parse main` 和 `git show main:.ai/registry.json` 核对；共享技能按路径读取即可。

按输出定位任务卡，再读取最新的集成分支版本：

```powershell
git show main:.ai/tasks/<task-id>.md
git show main:docs/plan/04-roadmap.md
```

命令中的任务 ID 与路径换成登记表给出的实际值。需要可复核快照时，将 `main` 换成上下文命令输出的集成提交 SHA。当前分支旧副本里的“空闲”或 `ready` 不构成认领依据。多个独立 clone 不共享本机 refs，必须先通过约定的远端同步，本协议中的即时读取仅适用于同一仓库的 worktree。

实现者在自己的分支建立 `.ai/handoffs/<task-id>-<agent>-<序号>.md`，使用[交接模板](../../.ai/handoffs/TEMPLATE.md)。先提交代码，再将其 commit 写入交接单并提交，避免自引用；一份交接单只有一个写入者，补充结果用下一序号。复核者也使用自己的新交接文件，不修改实现者的结论。

将任务 ID、分支、代码 head 与交接路径提供给另一方。统筹可用 `git show <branch>:<handoff-path>`读取尚未合并的交接，复核以登记的代码 head 为准；接收确认前状态写为“待接收”。文件交接不等于自动唤醒另一工具，本轮只有明确运行并返回结果的 Agent 才登记为已参与。

## 5. 本机技能接入

保留既有 `.agents/skills/` 作为共享源。Claude 的版本化薄入口 [.claude/skills/mathin-verify/SKILL.md](../../.claude/skills/mathin-verify/SKILL.md) 仅引用 [共享 verify](../../.agents/skills/verify/SKILL.md)，因此新 clone/worktree 可获得相同入口，无需复制正文、创建符号链接或同步私人配置。菜单尚未刷新时可直接读取源文件。

本机 `.claude/skills/verify/SKILL.md` 的历史副本保留，项目调用使用新的 `mathin-verify` 入口。`.gitignore` 仅放行这一份薄入口；settings、账号文件、旧副本和其他私人材料继续忽略。权限和模型偏好分别由各工具维护。

工具发现入口、读取共享正文和实际完成跨模型任务是不同结果。Claude 尚未运行回传时，记录“入口已交付、实际接入待确认”。

## 6. 可直接交给另一方的启动说明

```text
在任务卡指定的 worktree 工作。先读 CLAUDE.md / AGENTS.md，运行 node scripts/agent-context.mjs，
从 main 的最新登记找到 <task-id>，用 --task 核对分支，按任务卡确认合同、依赖和验收条件。
按卡片要求读取产品专题与局部 AGENTS.md；涉及项目验证时读取 .agents/skills/verify/SKILL.md。
完成一个可独立验收增量，运行覆盖风险的定向检查，提交自己的文件，写交接单并返回提交号。
若当前只分配了复核，针对登记的 base/head 只读审查并记录具体问题。
```

首次接入还没有业务任务时，先只读确认规则来源、角色和验证边界，再由产品负责人选择首个试运行任务。

## 7. 已核对的工具依据

2026-10-01 核对：[Codex 分层项目指令](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Codex worktree](https://learn.chatgpt.com/docs/environments/git-worktrees)、[Codex 项目技能路径](https://learn.chatgpt.com/docs/build-skills)、[Claude 共享指令导入](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools)、[Claude 技能发现](https://code.claude.com/docs/en/skills)。保留 Windows 上可用的 `@AGENTS.md` 导入，避免把客户端版本差异转化为两份项目规则。
