# 数独题型扩展合同

本文件适用于 `src/features/games/sudoku/**`。新增或修改数独题型时，必须同时遵守仓库根 `AGENTS.md`。

## 1. 唯一扩展入口

| 对象 | 权威位置 | 合同 |
| --- | --- | --- |
| 题型元数据与 seed | `variant.ts` 的 `SUDOKU_VARIANTS` | 稳定 `variantId`、尺寸、runtime、renderer、出现界面、排行策略和挖空数只在此登记 |
| 规则、生成、求解、验证 | `logic.ts` 的 `SudokuVariantRuntime` / `SUDOKU_RUNTIME_REGISTRY` | 客户端判定与服务端 `verifySudoku` 必须调用同一 runtime |
| 棋盘表现 | `SudokuBoard.tsx` 的 `SUDOKU_RENDERER_REGISTRY` | 新 renderer 必须显式登记；不得让未知 renderer 静默套用普通棋盘 |
| 题型按钮 | `SudokuVariantSelector.tsx` | 公开游戏和课件入口复用同一选择器；可见性来自 `selectableIn` |
| 课堂轻状态 | `state.ts` / `GameMirrorState` | 题型由课件页 seed 决定；镜像只传操作状态，不重复传规则定义 |
| 合同测试 | `tests/sudoku-variants.test.ts` | 注册表、seed、确定性生成、runtime、服务端验证和镜像兼容必须覆盖 |

`SudokuSizeSelector` 只为旧尺寸调用保留。新代码必须使用 `SudokuVariantSelector` 和稳定 `variantId`，否则无法区分同为 9×9 的标准数独与变形数独。

## 2. 稳定协议

- 对外 `gameId` 永远是 `sudoku`。题型不是新游戏，不得创建 `diagonal-sudoku` 等平行 gameId。
- 无前缀 seed 永久表示 `classic-9x9`，用于所有历史公开对局和“宫区块摈除”课件。
- `sudoku-v1:4:<baseSeed>` 与 `sudoku-v1:6:<baseSeed>` 永久表示当前四宫、六宫；不得改写既有题面算法或 RNG 输入。
- 新变形题型使用 `sudoku-v2:<variantId>:<baseSeed>`。`variantId` 使用小写 kebab-case，发布后不得改名、复用或改变语义。
- 未知或畸形的 `sudoku-v1/v2` 必须 fail closed，不能降级成 9×9 继续生成或通过服务端验证。
- 课件与课堂继续复用 `{ gameId, difficulty, seed }` 及现有 `GameMirrorState`。只有规则无法由 seed 确定性恢复时，才可提出新的版本化课件字段；不得先把规则对象塞进镜像事件。

标准调用：

```ts
const variant = getSudokuVariant(variantId);
const seed = sudokuSeedForVariant(baseSeed, variantId);
const parsed = parseSudokuVariantSeed(seed);
const puzzle = sudokuPuzzle(seed, difficulty);
const solved = solveSudokuGrid(puzzle, variantId);
```

仅标准 4×4 / 6×6 / 9×9 兼容代码可以调用 `sudokuVariantForSize`、`sudokuSeedForSize` 或按格数推断。任何同尺寸变形题型必须显式传 `variantId`。

## 3. 新增题型步骤

1. 在 `SUDOKU_VARIANTS` 增加定义，选择永久 ID，并默认使用 `seedEncoding: "variant-v2"`。
2. 判断现有 runtime 是否完整覆盖新规则。若不能，新增 `runtimeId` 和 `SudokuVariantRuntime` 实现，并注册到 `SUDOKU_RUNTIME_REGISTRY`。生成、候选合法性、求解、唯一性分析、逐格验证和最终 proof 验证不得分叉。
3. 判断 `classic-grid-v1` 是否能准确表达宫边界、附加线索和课堂突出。若不能，新增 renderer 并在 `SUDOKU_RENDERER_REGISTRY` 登记；仅隐藏规则标记不算支持。
4. 在 `messages/zh.json`、`messages/en.json` 的 `games.sudokuVariants.<variantId>` 添加同名 key。
5. 通过 `selectableIn` 决定是否出现在公开游戏和课件。不得另建按钮列表或插入弹窗分支。
6. 新题型默认 `ranked: false`。只有开始会话、seed 发放、服务端验证和排行榜维度都显式包含题型后才可设为 `true`。
7. 若教师自编题、微课或导入格式需要该题型，文档 schema 必须增加版本化 `variantId` 并由服务端分析；不能只在 React props 中临时传值。

## 4. 必须验收

- `sudokuVariantRegistryIssues()` 返回空数组，runtime/renderer 注册表覆盖所有已登记 ID。
- 历史 raw seed 与 v1 seed 生成结果不变；同 seed + 难度 + variant 在服务端和浏览器得到同一题面。
- 每个新题型至少覆盖：合法终盘、错误终盘、逐格错误、确定性生成、proof 验证、seed round-trip 和未知协议拒绝。
- 课堂覆盖填数、候选、删除、突出、答案、撤销与镜像恢复；不适用的工具必须由 renderer 明示禁用。
- 公开页和课件入口 zh/en 均可选择；1024×768 的 4:3 工作区无横向滚动。
- 最窄检查至少运行：

```text
pnpm test -- tests/sudoku-variants.test.ts tests/sudoku-teaching-board.test.ts
pnpm typecheck
pnpm messages:check
```

视觉、输入或课堂能力变化还要按仓库 `verify` skill 做对应真实页面验收。
