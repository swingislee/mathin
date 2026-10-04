# DEV-MOTION-20261001 · Codex 标尺拖拽修复交接

- 关联任务：[Motion Lab 交互](../tasks/DEV-MOTION-20261001.md)。
- 目的：交付用户反馈的标尺拖动误选数字修复；由本会话完成独立分支检查和开发端集成。
- 代码 base：`7b3535239d9ed7b22489c96aaf6c8bffe1889be1`；代码 head：`a3501cb9c304a9c1d5cc672404b8687590dc2cb1`。
- 分支 / worktree：`codex/motion-ruler-codex` / `.worktrees/motion-ruler-codex`。
- 变更：`RulerOverlay.tsx` 在标尺范围禁用文字选择，刻度 SVG 让指针事件交给拖动带，主指针按下时阻止浏览器默认选词。`CHANGELOG.md` 增加对应操作说明。
- 保留合同：标尺上下拖动、刻度与间距读数，以及人物和菜单的操作保持原有语义；场景结构与保存合同没有变化。
- 验证：在本 worktree 复用仓库已安装依赖，`eslint src/features/tools/motion-lab/RulerOverlay.tsx` 通过；`vitest run tests/motion-lab-interactions.test.ts` 的 7 项既有交互回归通过；实际暂存对象隐私检查通过。
- 局限：上述自动化覆盖既有交互合同，浏览器实际文字选区与拖动手感继续由用户验收；没有新增浏览器自动化、构建或阶段 Gate。
- 共享资源：没有新启开发服务，没有数据库或生产操作。仅使用本任务 Git index，代码提交后工作树干净。
- 集成动作：主 checkout 核对工作树和范围后合入提交，复用开发入口；在 `/zh/tools/motion-lab` 的刻度数字上按下并上下拖动，应移动标尺且不出现文字选区。
- 交付状态：机器检查通过；产品人工验收待确认；生产与正式 Gate 不涉及。集成检查点以 `main` 的任务登记为准。
