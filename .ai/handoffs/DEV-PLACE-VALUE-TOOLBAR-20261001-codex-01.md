# DEV-PLACE-VALUE-TOOLBAR-20261001 · Codex 第 01 次交接

- 发出方 / 接收方：数位积木原会话 / 当前集成人。
- 目的：交付已批准的右栏原位整理，供只读复核并集成本地开发页面。
- 关联任务卡：[DEV-PLACE-VALUE-TOOLBAR-20261001](../tasks/DEV-PLACE-VALUE-TOOLBAR-20261001.md)。
- 代码 base：`ec241ddb9c5b476edcd02b21fc271b74d7600fc8`。
- 代码 head：`99d537ba8adf674ee459682cbf41aaf1c7048ae5`。
- 分支 / worktree：`codex/place-value-toolbar-codex` / `.worktrees/place-value-pan-codex`；复用此前干净独立目录，原 pan 分支保留。

## 行为与边界

- 右栏按“视角、教学、显示、历史”分成四组。保留原单列窄栏、顶部视角条和竖屏横排规则，沿用原工作台 dock 定位；没有移动舞台、展示柜、底座或对象旁动作。
- 教学入口为“摆数、表示方式、比较两数、观察单位”，同步英文名称。新增 `placePrepare`、`placeCompare`、`placeInspect`，数位专用 `placePresentation` 改用积木图标；其他工作台使用的 `prepare`、`compareScenes`、`observe` 及取出组成图标保持不变。
- 数位右栏统一 20px 图标和 1.7 线宽；参数面板使用角标及展开标识，数字开关使用状态点，一次性命令不保持选中。面板按钮用 `aria-expanded`，模式和显示开关继续用 `aria-pressed`。样式限定在数位工作台，不改共用按钮实现或全局样式。
- “拆单位”从右栏收进已有“观察单位”面板，保留原禁用、动画、撤销及课堂写入逻辑；面板内文字按钮补用共用动作 SVG。取出、放回和组成对比仍在原对象旁入口及观察面板。
- 本次仅修改登记的八个源码/测试文件。不改 Canvas、相机实现、数学模型、保存版本、课堂同步合同、依赖或数据库。

## 定向检查

- `node node_modules/vitest/vitest.mjs run tests/place-value-workspace.test.ts`：29 项通过。新增中英文分组与语义状态、面板展开/收起、数字切换、观察面板拆分及撤销重做；继续覆盖无 `randomUUID`、只读、进位保护、相机切换、对象旁操作和课堂回显。
- `node node_modules/vitest/vitest.mjs run tests/spatial-button-interaction.test.ts tests/spatial-workbench-policy.test.ts`：两文件共 10 项通过，实际与首次数位检查同批运行；后续仅补正新测试对撤销动画结束的等待，复用这两文件结果。
- `node scripts/spatial-controls-catalog.mjs`：5 项通过，实际 SVG 对照页生成至本工作区 `.tmp/spatial-controls-comparison.html`，包含数位专用图标及对其他工作台语义的保护。
- 八个变更文件中的七个 TS/TSX 文件 ESLint 通过；调整后的数位测试单独复查通过。`git diff --check`、真实暂存差异检查及 pre-commit 暂存隐私扫描通过。
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`：全库未通过，仅报告既有 `tests/agent-coordination.test.ts` 第 97、105、106、117 行 TS2353（`taskId` 不在脚本推断的参数类型中）。本轮文件没有类型诊断；对应测试和 `scripts/agent-context.mjs` 与已记录同类错误的 `9fc0079a` 完全相同，未扩大范围修改协作工具。
- 默认受限环境无法启动测试子进程，定向 Vitest 与目录生成经本机权限审批后执行。首次新增撤销/重做测试缺少等待撤销动画的步骤；补齐等待后通过，业务源码没有为测试改动动画规则。
- 没有运行浏览器自动化、视觉截图、全量回归或发布 Gate；布局观感和操作手感仍由产品负责人在开发页面验收。

## 交接与状态

- 代码提交后工作树干净；本交接单为后续独立文档提交。复用原 `node_modules` junction，没有启动服务、占用新端口或重启集成端服务。
- 集成人下一步：对上述 base/head 做只读复核；按已核验的人类授权串行集成代码与本交接，维护登记及 CHANGELOG，核对 zh/en 开发页面可启动。相同代码状态的定向检查结果可复用。
- 建议版本说明：数位积木右侧工具按视角、教学、显示与历史分组；摆数、表示、比较和观察使用对应图标；拆单位在观察面板操作，原 3D 布局与对象旁入口保留。
- 产品验收入口：`/[locale]/tools/place-value`。状态为定向机器检查通过、全库类型检查存在已知基线错误、待集成与人工视觉/交互验收。
- 生产操作与 Gate：不涉及。
- 接收确认：待集成人复核后记录。
