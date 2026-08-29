# 自研课堂互动状态同步热修 · 本机证据

> **结果**：`LOCAL MACHINE/BROWSER CHECKS PASSED / PENDING REAL IPAD ACCEPTANCE / NOT DEPLOYED`
>
> **日期**：2026-08-29
>
> **目标**：本机 Next `http://127.0.0.1:3130` 与 `.env.local` 指向的本机 Supabase；未连接或写入 Xiaomi
>
> **本机热修提交**：`5783b9300dfa2eff1ee4dbd78ffa3a57f19f3977`；生产候选与发布授权尚未产生

## 根因与修复

`game-page-v1` 在 `LiveShell → DocCoursewarePage → StagePreview → GamePageStage → SudokuGamePageStage → SudokuBoard` 新适配链只传递 `interactive`，遗漏既有 `GameMirrorState` 的 `mirror/onMirror`。因此教师端填数、候选数和教学突出显示只更新 iPad 本地 React state，没有生成课堂 durable `game_state`；历史 `CoursewarePage type="game"` 链路正常，原测试也只覆盖该路径。

热修补齐上述双向镜像链，并将游戏状态发送从 350ms trailing debounce 改为 100ms 固定合并窗口：连续点按期间持续广播每个窗口的最新轻状态，切页和卸载前刷新待发送状态。发送端与 reducer 同时执行 32 KiB payload 预算。

## 未来互动审计门

- `ClassroomInteractionSyncProvider` 与既有指针输入 provider 分离；DOM 能点击不再被视为状态已同步。
- 每个 Mathin 自研 `CoursewareDoc.docVersion`、微课 mode 和游戏 registry 项必须穷尽声明 snapshot、语义 command 或课堂只读；新增 union/registry 项遗漏声明时 TypeScript 或审计测试失败。
- 自编数独声明 `game-mirror-v1` / `game_state`。自研 H5 在 `h5-state-v1` 完成前只读，`spatial-page-v1` 在 `spatial-command-v1` 接入事件流和 replay 前只读；未知 provider 同样 fail closed。
- 根舞台输出 provider、version、mode、protocol、event 与 ownership 属性，便于 E2E、审阅和运行时诊断。

## 机器与浏览器检查

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| `pnpm test -- tests/classroom-interaction-sync.test.ts tests/sudoku-variants.test.ts tests/sudoku-teaching-board.test.ts tests/game-courseware-contract.test.ts tests/classroom-input-router.test.ts tests/r1-classroom-continuity.test.ts` | 6 文件，72/72 | 数独状态、游戏合同、输入路由、课堂连续性、镜像 reducer 与适配链 |
| `pnpm classroom:interaction-sync:audit` | 1 文件，4/4 | docVersion/mode/registry 穷尽、provider 组合、H5/3D fail-closed、payload 与镜像链 |
| `pnpm typecheck` | PASS | 新 provider、fixture 和 adapter 类型边界 |
| 受影响文件 ESLint | PASS | 热修、审计、E2E 与本地 fixture |
| `pnpm plan:audit` | PASS | 00～28 状态、唯一阶段、索引与 1.0 契约 |
| `pnpm e2e:classroom` | Chromium 2/2 | 固定教师账号；既有 H5 合同保持通过；新增同一正式本地课次的控制页→展示页填数与“突出行”同步 |
| `git diff --check` | PASS | 补丁空白与冲突标记 |

Playwright 新用例使用同一浏览器上下文的控制页和展示页，证明课堂事件传输与 viewer replay 在本地正式课次生效；它不证明真实 iPad Safari、两台物理设备、局域网/P2P 或生产 Supabase。首次新增 E2E 运行暴露的是夹具入口问题：新增的 server-side runner 标志检查使原有开发验收夹具未被启用，且登录 helper 只接受 pathname、不能把 query 拼进 destination；移除这项多余的 server 检查、继续由 runner 和非 production 边界双重限制，并在登录后导航 query 后，完整 2/2 重跑通过。

## 数据与发布边界

- 复用 gitignored manifest 中的固定 admin/teacher 开发账号；没有创建账号。
- E2E 只在写目标保险丝确认的本机 Supabase 创建 `purpose=test` 的临时班级/课次，并由 fixture cleanup 校验删除；没有保留业务对象。
- 没有 migration、schema、Storage、Xiaomi、`mathin.club`、服务重载或生产发布操作。
- `approver=pending`，`production_commit=pending`，`production_postflight=pending`，真实 iPad 验收 `pending`；因此本记录不能提升为生产通过。

结构化字段：`gate_id=HOTFIX-20260829-CLASSROOM-INTERACTION-SYNC`，`domain=classroom-interaction-state`，`result=local_machine_browser_pass`，`commit_sha=5783b9300dfa2eff1ee4dbd78ffa3a57f19f3977`，`environment=local-development`，`dataset_manifest=fixed-accounts-plus-ephemeral-purpose-test-fixture`，`actor=Codex`，`approver=pending`，`artifact_url_or_path=docs/evidence/r1/classroom-interaction-sync-hotfix.md`，`artifact_hash=not_applicable`，`retention=git-history`，`access_roles=repository-readers`，`failure_ticket=resolved-test-harness-only`。
