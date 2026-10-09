# 线索与沟通月份筛选收紧

- 目标与范围：线索、沟通页不再平铺所有获取月份；收为显示当前选择的紧凑下拉，展开后仍能选择全部月份、具体月份及月份未填。
- 分支及负责文件：`main`；`src/features/school/source-worklist/SourceLayoutFilters.tsx`、`Workspace.tsx` 与本任务卡；共享登记为 `.ai/registry.json`。
- 当前状态：开发端已实现；沿用现有月份筛选、人数及分组切换逻辑，已停课无月份筛选时保持原样。共享组件的测评页面继续使用原有月份栏。
- 交付入口：`http://192.168.5.213:3130/zh/dashboard/leads`、`http://192.168.5.213:3130/zh/dashboard/communication`。
- 实际检查与待确认：两个受影响组件的 ESLint 及差异检查通过；现有 3130 开发服务健康读取为 200。月份选择的密度和操作待产品负责人使用确认；本轮未发布生产。
