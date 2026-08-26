# 课堂体验升级 · M5 生产分段启用

> **结果**：`STAGE B3 REMEDIATION DEPLOYED / H5 FLAG FALSE / PENDING USER ACCEPTANCE`
>
> **日期**：2026-08-25～26
>
> **产品验收基线**：`95ed9f1`
>
> **生产候选**：`964ca5e`
>
> **生产状态**：Stage A、B1 与 B2 已通过；Stage B3 修复底座已由隔离提交 `964ca5e` 部署，H5 pointer 保持 version 3 / false，等待生产人工验收与逐包档案登记

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

## 生产执行

1. **Stage A · 已完成**：Xiaomi 目标、数据库指纹、current/previous、业务计数和四个 false 开关无漂移。新建 PostgreSQL-only pre-change 备份 `mathin-db-prechange-20260825T085233Z-classroom-m5-8c303a2`，dump=`249637390 bytes`、TOC=`3761`、SHA-256=`5654c1ecc7812dc7c93798fba361f76e400037f6299352ee8eb1504c44c431e8`；未归档 Storage、未清理旧备份。
2. **migration 与暗发布 · 已完成**：`20260825000700_classroom_learning_fill_bulk` 以既有 RPC owner `supabase_admin` 完整执行并回滚，独立核查零残留后正式登记；ledger=`193`、head 仍为较晚的 `20260825000800_account_center_profile`，checksum=`b6ffca69…84e3d`。PostgREST schema cache 已可见四参 RPC。应用候选 `8c303a2` 发布为 `20260825-085754`，previous=`20260825-072801` / `72d8127…`；应用服务、双层 health、zh/en login 和匿名 classroom 重定向通过。
3. **Stage B1 · 人工通过**：组织级 `teaching.classroom_board_checkpoint_v2` 与 `teaching.classroom_input_v2` 为 version 2 / true。产品负责人确认主板书刷新恢复与 Smart 输入通过；随后只读复核观测到 checkpoint version/chunk/head=`1/1/1`，错误仍为 `1949`，证明验收动作实际经过 v2 持久化链路。第一次启用因 `clock_timestamp()` 晚于事务求值时间而被提交前断言拦截，独立核查零残留；改用同一事务时间后一次提交。
4. **Stage B2 · 人工通过**：`teaching.classroom_layout_v2` 为 version 2 / true。产品负责人确认生产课堂整体布局通过；随后的 B3 preflight 观测到 checkpoint version/chunk/head=`2/2/2`，说明 B2 验收又完成了一次真实板书保存。此时 H5 仍为 version 1 / false，domain event=`596`。
5. **Stage B3 · 已停止并回退**：最初只为 `teaching.classroom_h5_pointer_v1` 追加 version 2 / true，domain event=`597`。准备生产验收对象时的只读全量核对发现，现有 production 课次/发布引用含 399 条 H5-kind 页面记录、409 条 binding，全部属于 `aixuexi-page-doc-v1`，而候选只把 pointer bridge 传入通用 `page-doc-v1` 舞台；因此没有可代表实际生产类型的 tap/takeover/reload 对象。这里的 399/409 是绑定记录量，不是实际嵌入 iframe 数。按 fail-closed 规则立即追加 version 3 / false，domain event=`598`；board/input/layout 继续 version 2 / true。独立 postflight 确认 checkpoint=`2/2/2`、账号、业务、Storage object 与错误计数无漂移，且没有进行中的 production 课堂。
6. **启用后的回退限制**：当前已经产生 v2 checkpoint，不能把应用直接切回不认识 v2 数据的 `72d8127`。回退动作是先关闭对应 writer/UI 开关并继续运行当前双读 bundle；只有证明没有新 v2 写入时，才允许应用级 previous 切换。

## Stage B3 开发修复候选

| 对象 | 开发结果 | 证据边界 |
| --- | --- | --- |
| 共同能力合同 | `f1f8d98` 新增按 package SHA-256 的版本化 active 能力档案；通用魔法校 `DocStage` 与爱学习 `AixuexiStage` 复用同一 iframe 注册和 pointer bridge。`e2ff273` 把一级三模式选择收敛为单一 Smart 开关，由当前指针/绘图工具派生回退锁；`c03c382` 将入口改为 `112×44px` 横向滑动条，`aa6b75b` 再以强调色小型 SVG 与滑轨表达开启态并移除外围边框/圆角底板 | 包内 provider 声明在 delivery 时剥离，只信任 registry；缺档案、查询失败、档案不匹配或握手失败时 Smart fail closed，但教师仍可用指针操作 H5，或用笔/颜色直接批注 |
| 数据库 | `20260826000100_classroom_h5_input_profiles` 已以规范化 checksum `8709c55c…80e1` 登记生产；`cw_h5_input_profiles` 为空、RLS 开启，anon/authenticated 仅可读取 active 档案的指定列，PostgREST 返回 200/`[]` | 未写 profile、未改四个开关；H5 继续 fail closed |
| 课程审计 | 全量 revision 只读审计：`aixuexi-page-doc-v1` 5442 页/9 个 `embedded_h5`，`page-doc-v1` 97349 页/13258 个 H5；本地发布包审计：魔法校 baseline 55101 页、H5 4367、页面互动 3305、混合 102，2026 包 16451 页、H5 2316、页面互动 1075、混合 78 | revision 与本地发布包计数不证明当前 production 课次可达量；700 个现有魔法校 package（677 non-cocos、23 cocos2）尚无权威输入档案，未被批量猜测为 `click` |
| 机器 Gate | `f1f8d98` 相关 Vitest 5 个文件：36 项通过、1 项条件跳过，`pnpm typecheck`、`pnpm lint`、Next production build 通过；`e2ff273` 追加 3 个定向文件 15/15、typecheck/受影响 lint 和统一 Playwright 1/1 通过；`c03c382`/`aa6b75b` 追加实际 `112×44px`、单 SVG、零边框/圆角和开关行为断言，typecheck、受影响 lint、统一 Playwright 1/1 通过 | E2E 只覆盖 Smart 单开关、魔法校混合页、爱学习嵌入页和未登记页的工具派生回退，不替代产品手感与生产 iPad |

## Stage B3 修复生产部署

2026-08-26，产品负责人要求把对应改动推送生产。执行者没有发布包含教师微课提交的 `main`，而是从 production current `8c303a2` 隔离拣选 `f1f8d98`、`e2ff273`、`c03c382`、`aa6b75b`，生成精确发布提交 `964ca5e6975d94b75591201aa13698a288f4ae70`。

- preflight 确认 Xiaomi、`mathin.club` / `supabase.mathin.club`、数据库指纹 `10e3…1a0c`、current/previous、ledger=`193`、业务/Storage/错误计数与四开关状态。唯一未结束课次已开始约 46 小时，最近 60 分钟事件为 0；未修改其状态。
- 新建 PostgreSQL-only 备份 `mathin-db-prechange-20260826T124534Z-classroom-b3-964ca5e`：dump=`249650397 bytes`、TOC=`3778`、SHA-256=`aa0b5888a3e67e7ae7f411a21ab9166789fb0a1f0680314f9d672d9acf7536bf`。未归档 Storage、未清理旧备份。
- migration 完整回滚演练创建表/索引/RLS/策略/授权后回滚；独立连接确认表 absent、ledger=`193`、业务计数零漂移。正式事务登记 `20260826000100_classroom_h5_input_profiles` 后，ledger=`194`，PostgREST schema cache 返回 200/`[]`。
- 隔离候选通过 typecheck、受影响 ESLint、6 个定向 Vitest 文件 39 项通过/1 项条件跳过，以及发布器的全库 lint、typecheck、本地与 Xiaomi production build。应用原子切换为 `20260826-125052` / `964ca5e…`，previous=`20260825-085754` / `8c303a2…`。
- 独立 postflight：loopback/public health=`ok`，zh/en login=`200/200`，匿名课堂=`307` 到 locale login，Smart/H5 profile 编译产物存在，服务 journal error=`0`；账号/profile/学生/班级/课次/报名/点名/Storage object/错误=`14/14/5/3/16/1/0/123602/1949`，checkpoint=`2/2/2`。board/input/layout=`v2/true`，H5=`v3/false`。

本记录证明 Stage B3 修复底座与单一 Smart UI 已部署且机器 postflight 通过。生产 `cw_h5_input_profiles` 仍为空、H5 开关仍为 false，因此不能记为 H5 pointer、M5 或 R1-Live Gate 2 已通过；下一人工对象只是生产课堂中的 Smart 开关外观与工具派生回退，H5 另需先登记经审计 package 再分段启用。
