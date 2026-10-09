# 线索与沟通顶部整理

- 目标：接续紧凑月份筛选，将阶段、搜索筛选和页面操作按同一页头编排，减少分散横栏。
- 范围：`src/features/school/source-worklist/SourceLayoutFilters.tsx` 的工具栏布局，以及 `Workspace.tsx` 的页头 JSX 与图标导入。与学服负责人任务共用 `Workspace.tsx`，保留其负责人和待分配筛选逻辑。
- 实现：月份、小组接入既有命令面板筛选槽；页面操作集中在右侧，说明收进提示。阶段与小组的既有切换、查询、草稿和列表登记保持连续。
- 交付：开发端 `/zh/dashboard/leads`、`/zh/dashboard/communication`；复用用户已运行的 3130 服务。
- 当前状态：开发端已实现；两个受影响组件的 ESLint 与差异检查通过。复用现有开发服务；顶部密度、换行和操作待产品负责人实际验收，生产未发布。
