# 学科运营手机连续记录排列

用户于 2026-10-02 要求优化学科运营各子页的手机表格，并明确包含首联、仅调整手机排列。变更位于 `codex/school-ops-mobile-codex`，按用户直接集成授权进入开发端。

## 实现与验收入口

- `Table` 新增 `stacked` 手机排列：摘要置顶、字段纵排、操作换行，使用同一行及输入状态。桌面规则保持原样，原 `records` 嵌套外观继续保留。
- 已接入线索、沟通和首联、测评、活动及其登记／测评／回顾表、续班及专业信号／转介绍／回流表。财务现有列表自然换行，无额外表格改造。
- 可从 [沟通](http://192.168.5.213:3130/zh/dashboard/communication)、[线索](http://192.168.5.213:3130/zh/dashboard/leads)、[测评](http://192.168.5.213:3130/zh/dashboard/assessments)、[活动](http://192.168.5.213:3130/zh/dashboard/activities)、[续班](http://192.168.5.213:3130/zh/dashboard/renewals) 验收。重点查看手机筛选、勾选、展开、输入和保存区的实际手感。

## 机器检查

- 共享表格排列、嵌套轮廓、沟通渲染、线索交互、学生阶段、测评阶段、续班、公开课、行下补入与活动列表的定向检查通过；受影响 TSX 与新增测试 ESLint 通过。
- 无账号、无业务数据的浏览器 CSS 样例覆盖 320×740、390×844、844×390、820×1180、1440×900：窄屏无表格横向溢出，摘要与字段位置正确，表头控件可达，内层表宽度正确，窗口变化保留同一输入与草稿；桌面移除手机元数据前后几何与样式一致。
- `school-ops-table-header-controls.test.ts` 的一个旧源码断言失败：仍要求在 InvitationCoordinationWorkbench 中找到 `group: tableT("fieldName")`，但当前基线已将字段定义迁出；本批未改动该逻辑。
- 全库类型检查仍报既有测试错误：`agent-coordination.test.ts` 的四处 `taskId` 参数，以及 `parent-assessment-fixtures.test.ts` 的 `admin` 属性。未发现本批实现文件类型错误。保留这些问题，不扩大本批修改范围。

机器检查不替代手机视觉与交互验收。状态为 **DEVELOPMENT READY / AWAITING USER ACCEPTANCE**；无数据库写入、生产发布或正式 Gate 关闭。
