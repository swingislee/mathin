# 课堂体验升级 · M5 本地集成候选

> **结果**：`PASS / LOCAL INTEGRATION CANDIDATE`
>
> **日期**：2026-08-25
>
> **产品验收基线**：`95ed9f1`
>
> **生产候选**：`8c303a2`
>
> **生产状态**：只读 preflight 已完成；migration、应用发布、服务重载和开关启用均未获授权、未执行

## 本地 Gate

| 对象 | 结果 | 证据边界 |
| --- | --- | --- |
| 工程 Gate | `pnpm ci:checks` 16/16；Vitest 100 个文件、689 项通过、1 项条件跳过；Next 16.2.11 production build 通过 | 证明候选源码、类型、双语、secret、规划和构建合同；不替代课堂人工体验 |
| 数据库 Gate | 明确标记、仅绑定 `127.0.0.1:35432` 的一次性 PostgreSQL 15 从零重放 200 个 SQL 文件；migration ledger、P4E/P6/SML/P4H/R1 数据库审计均通过 | 一次性库与本机开发库、Xiaomi 生产库隔离；断言事务均回滚 |
| 课堂专项 SQL | `m2_classroom_board_checkpoint_assertions.sql` 与 `m4a_classroom_roster_star_v2_assertions.sql` 通过 | 覆盖 checkpoint/RLS、稳定名单 revision、星星 v2 的乱序/重复/撤销合同 |
| 浏览器 Gate | 固定教师课堂入口 1 项、R1-Live 本机 Golden Path 1 项、登录边界 3 项通过 | Golden Path 完成测试班创建、报名、候课点名、数据库持久化和课后再读；夹具清理后测试班残留为 0，未创建账号 |

Gate 同步修复了三类发布测试漂移：统一登录框由 `#email` 改为 `#identifier`，运营学期的可见名称不再包含数据库名称中的“学年”，H5 runtime、课堂控制轨和白板 checkpoint 源码断言改为跟随当前合同。CI bootstrap 补齐了 Supabase Storage 的 `foldername()` / `extension()` 等价实现；已发布 migration 文件及其 checksum 没有被改写。

## Xiaomi 只读 preflight

2026-08-25 只读核查确认执行主机为 `xiaomi`，应用 origin 为 `https://mathin.club`，Supabase origin 为 `https://supabase.mathin.club`，Next 监听进程与 `supabase-db` / `supabase-rest` 容器均正常。应用 current/previous 为：

- current：`20260825-072801` / `72d812727121c112ceaa3ab3fd935016473e48ad`；
- previous：`20260825-041101` / `8ec0ba01ef74d503ff89138cd05da395b096228e`；
- loopback、Caddy health 均为 production `ok`；
- 数据库指纹：`10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`。

数据库 ledger 为 192 条、head=`20260825000800_account_center_profile`。课堂 bulk migration `20260825000700_classroom_learning_fill_bulk` 尚未登记，规范化 SHA-256 为 `b6ffca69ffeb99f4001f120af3bf8b60fec43ff7fe69209c765939400f184e3d`；对应四参 RPC 也不存在。此前已进入生产的名单/星星 RPC 存在，四个课堂开关均只有 version 1 且有效值全部为 `false`：

- `teaching.classroom_board_checkpoint_v2`
- `teaching.classroom_input_v2`
- `teaching.classroom_layout_v2`
- `teaching.classroom_h5_pointer_v1`

匿名计数为 auth/profile/student/classroom/session/enrollment/attendance=`14/14/5/3/16/1/0`；checkpoint version/chunk/head、star v2 event、learning result 均为 0，roster revision/entry=`1/0`。Storage object=`123602`，operational error=`1949`，最近错误仍为 `2026-08-22T15:53:09.807Z`。最近已核验备份仍是 `mathin-20260822T093529Z`；它早于手机号与账号中心两次授权发布，因此只能作为既有 Gate 1 证据，不能冒充本候选的新鲜 pre-change 备份。

## 待授权发布分段

1. **Stage A · 可直接回退的暗发布**：生成并核验新的 PostgreSQL pre-change 备份；对 migration `20260825000700` 先做完整事务回滚演练，再正式登记；发布 `8c303a2` 并保持四个开关全部关闭。此阶段不产生课堂 v2 数据，应用可原子切回 `72d8127`，新增 RPC 保留为向后兼容 schema。
2. **Stage B · 受控启用**：按 board checkpoint/input → layout → H5 pointer 分段启用并在每段后由产品负责人审核一个真实教师课堂对象。开关是组织/校区级，不是 user 级；当前“单老师”边界依赖唯一获批教师/课次的运营控制，启用窗口内不得让其他班级开始使用新课堂。
3. **启用后的回退限制**：一旦产生 v2 checkpoint、roster/star event，不能把应用直接切回不认识 v2 数据的 `72d8127`。回退动作是先关闭对应 writer/UI 开关并继续运行当前双读 bundle；只有证明没有新 v2 写入时，才允许应用级 previous 切换。

本记录不授权上述任何生产动作，也不表示 M5 或 R1-Live Gate 2 已通过。
