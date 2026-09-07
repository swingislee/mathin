# 月度新增报名目标

入口为 `/zh/dashboard/targets?month=2026-09`，经营概览的月视图提供“修改月度目标”链接。中英页面使用同一份目标。

## 目标与来源

- 目标表示当月新增报名人数，按老师 × 年级求和。明细空白表示尚未分配，显式 `0` 表示该格没有新增目标。
- 保存时数据库重新求和，不接收客户端计算的报名合计。全部明细为空时保留 Base 原定报名目标；有任意已填写明细时使用明细合计。
- 到访、诺访分别填写，不从报名目标推导倍数。
- Base 聚合快照保存在 `school_monthly_targets.source_snapshot`，编辑目标不会修改它，也不会更新报名、学生或在读记录。
- 老师和年级轴来自源表名单及9月报名记录。老师署名作为计划标签，不创建账号或授予岗位；年级沿用源表标签。
- 2026-09-07 Base 报名参考为8条，其中1条缺老师、1条缺报名日期；全月报名参考目标58人。源表没有老师 × 年级的目标分配，首次打开的明细保持未分配。
- 首页完成量继续按业务事实的实际日期计算。Base 按月份筛选的快照可以包含缺日期记录，两者在页面中分别说明。

## 数据与权限

`school_monthly_targets` 一个月一行，使用 `revision` 防止并发覆盖。RLS 读取和两个写入 RPC 均要求 `organization.settings.manage`；客户端只有表读取权限。初始化只接受不存在的月份，保存会记录修改前后目标、版本和修改人到领域事件。

首次初始化9月参考时，先运行只读提取：

```powershell
node --experimental-strip-types scripts/import-school-monthly-targets.mjs 'docs/test_material/2026-09-07【思维】用户与产品运营表.base'
```

添加 `--apply` 后，脚本核对本机 Windows、loopback Supabase origin、实际监听进程及已登记数据库指纹，再使用固定开发管理员调用初始化 RPC。已有月份会停止并保留原目标。这个工具只支持已登记的本机开发库；生产操作沿用写入目标 runbook 和当次授权。

## 定向验证

- `tests/monthly-targets-contract.test.ts`：老师和年级合计、空值与零、目标进度。
- `tests/monthly-targets-action.test.ts`：输入校验、权限和版本冲突。
- `tests/staff-overview-data.test.ts`：当前可见班级、主讲、在读人数及未知数据。
- `supabase/tests/school_monthly_targets_assertions.sql`：在事务中使用已有9月计划与固定管理员/家长身份，验证数据库求和、不可变来源、审计、并发和权限；执行器设置 `test.monthly_target_admin` / `test.monthly_target_parent` 后运行并回滚。

开发页面由产品负责人验收视觉和交互。上述检查不关闭阶段或发布 Gate。
