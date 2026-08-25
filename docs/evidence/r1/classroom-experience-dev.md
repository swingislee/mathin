# 课堂体验升级 · 开发端 M0–M4 验收摘要

> **结果**：`PASS / DEVELOPMENT ONLY`
>
> **验收日期**：2026-08-25
>
> **产品验收基线**：`95ed9f1`
>
> **课堂 migration 尾项**：`20260825000700_classroom_learning_fill_bulk`；本机开发库允许包含更晚的无关 migration
>
> **生产状态**：未部署本轮完整应用、未启用课堂输入/布局/H5 开关；本记录不构成 Xiaomi 写入或发布授权

## 验收结论

产品负责人在本机开发课堂与试讲路径逐步验收 M0–M4，并于 2026-08-25 确认“课堂这一部分整体验收通过”。最终范围包括：

- Smart 输入所有权、原生 renderer capability provider、未知能力交互锁与兼容/不兼容 H5 bridge；
- 主/副板书分块 checkpoint、即时本机日志、刷新恢复和 500 笔后恢复；
- 稳定学生身份、开课冻结名单、确认刷新 revision、星星 v2 award/revoke 及星/月亮/太阳展示；
- 40px 教师课程信息薄条、A「贴底分区轨」、4 列 × 5 行学生简卡及 21–30 人内部滚动；
- 全屏逐题学情与课堂简卡共享座次、出勤 LED、P16/I6 图标、“补齐未登记”原子写入和单步撤销；
- 补齐与撤销成功回执位于顶部，不遮挡右侧撤销按钮。

各增量在独立提交前运行了与变更风险对应的定向测试、类型或静态检查；最后一项 Toast 避让修复通过 `pnpm typecheck`、`pnpm lint` 和 `tests/r1-classroom-continuity.test.ts` 18/18。上述机器结果与产品负责人的开发端验收互补，不替代 M5 fresh build、迁移/RLS、发布 Smoke、生产 postflight 或真实课堂证据。

## M5 入口

`95ed9f1` 是 M5 的已验收应用基线。M5 先执行一次覆盖发布风险的集成 Gate，并登记精确候选 commit、migration、默认关闭的开关和可执行回退点；生产 preflight、迁移、应用发布、服务重载和开关启用均须另有明确授权。
