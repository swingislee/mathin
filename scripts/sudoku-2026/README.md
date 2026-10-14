# 数独教学 2026 版生成与复核

本课程是独立正式课程，使用 `sudoku-authored-v3` 原生游戏组件。课程内容写在 `lessons.mjs`：每一页的学生文字、要用的盘面样式和教师提问链；题目按样式生成后逐题证明。设计依据见 `content/courses/sudoku-2026/教学逻辑校准.md`。

```powershell
node scripts/sudoku-2026/generate.mjs          # 按 lessons.mjs 生成题库 bank.json（可加讲次 B1 M2… 只生成部分）
node scripts/sudoku-2026/audit.mjs             # 数学、进度、教学设计三层校验 + 逐步理由回放
node scripts/sudoku-2026/build.cjs             # 应用校验器与原生求解器复核，组成课件包
node scripts/sudoku-2026/materials.mjs         # 教师用书、教师答案、学生讲义、课后练习、校验报告
node scripts/sudoku-2026/update-local.mjs      # 预览开发库改动；加 --apply 写入
```

- `generators.mjs`：按样式出题。宫内排除 E0–E6、行列 L1–L3、唯一余数、区块 K1–K4、变形探索页、按提示数与卡点分档的整题。
- `generate.mjs` 使用固定种子，逐页缓存在 `.tmp/sudoku-2026/bank-cache-v2/`；页面的样式要求变化时只重算该页。
- `curriculum-check.mjs`：L1 数学（唯一解、目标格确定）、L2 进度（只用已学方法，必用方法撤掉即停滞，变形规则不可省）、L3 设计（页面样式、难度档位与顺序、规则确有使用），以及不依赖出题求解器的逐步理由回放。
- `check-four.mjs`：四宫穷举，证明标准四宫的唯一解题都能只用宫内排除完成。
- `import-local.mjs --apply`：在新开发库上首次导入；已存在课程时拒绝重复导入。
- `update-local.mjs --apply`：在已有开发课程上原位替换 12 讲的页面。只覆盖本任务生成过的页面（换行丢失、磁贴吸附视为生成内容），发现人工修改即停止；不动发布版本和课次引用。

两个脚本都只连本机开发库，不支持生产目标。机器校验不替代真实课堂的节奏与手感验收。
