# 数独扩展入口

数独可用于公开挑战、教师带领、目标格讨论和完整解题，材料与反馈适合当前教学用途。

| 对象 | 入口 |
| --- | --- |
| 稳定题型、seed 与可见范围 | `variant.ts` 的 `SUDOKU_VARIANTS` |
| 规则、生成、求解、验证 | `logic.ts` 的 runtime registry |
| 棋盘表现 | `SudokuBoard.tsx` 的 renderer registry |
| 公开与课件选择 | `SudokuVariantSelector.tsx` |
| 教师自编题 | `courseware-contract.ts` |
| 编辑、课堂与镜像 | `SudokuGamePageEditor.tsx`、`SudokuGamePageStage.tsx`、`state.ts` |

对外 `gameId=sudoku`，题型使用稳定 `variantId`。无前缀 seed 表示历史 `classic-9x9`；`sudoku-v1:4/6` 保持历史算法；新题型使用 `sudoku-v2:<variantId>:<baseSeed>`。版本和稳定 ID 保持原语义，未知协议明确拒绝。

客户端和服务端使用同一 runtime。新增题型登记规则、renderer、zh/en 文案和可见范围；排行榜启用前具备题型对应的服务端验证。旧尺寸适配仅承接历史调用，新入口使用稳定题型 ID。

`sudoku-authored-v1` 按历史整题唯一解读取。新页面使用 `sudoku-authored-v2`：`full-solution` 整题唯一；`teaching-target` 盘面可解且目标格在所有合法终盘中取值一致；`teacher-led` 盘面可解并关闭任意答案揭示。多解盘面的第一份求解结果不能当作确定答案。

教师页面通过 composition 中的通用 `game-page-v1` 区块接入。旧 `microcourse-page-v1 mode=sudoku` 已迁移；新增能力沿用通用区块。镜像传操作状态，规则由固定课件内容决定，稳定实例贯穿 `GameMirrorState` 与课堂 `game_state`。

历史独立 `game-page-grid-v1` 12×9 布局与当前 composition 的尺寸合同分别读取对应 schema。新增能力保持历史内容可读，并让老师通过拖动、模板与可理解操作设置材料。

普通增量交付开发端人工使用。测试只按用户明确要求或重大安全、生产风险选择，遵循根入口。
