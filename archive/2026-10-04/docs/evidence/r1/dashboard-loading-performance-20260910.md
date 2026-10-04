# 首页大屏加载提速 · 2026-09-10

状态：**已于 2026-09-11 部署生产，机器检查通过，待人工使用验收**。本页保留开发阶段测量与验证记录；发布范围、生产检查和备份见[本轮生产发布](read-performance-production-20260911.md)。R1-Live-2 和 Gate 状态保持。

## 原因与改动

大屏读取约 20 类业务数据。原先每页 200 行，管理员打开一次总览发出 105 个数据库请求；业务视图和 RLS 随分页重复执行。每条事实的日期计算还反复创建 `Intl.DateTimeFormat`，CPU 采样显示时区拆分累计约 1,686 ms。

- `staff-overview-read.ts` 将每页调整为 1000 行，与已核对的本机 REST 上限一致。稳定排序、每组最多四页、10,000 行完整性门及错误处理保持。
- `schedule.ts` 按时区复用最多 16 个格式化器。每次仍计算输入日期，不缓存业务数据、统计结果或身份权限。CPU 采样中的时区拆分降至约 159 ms。

没有修改首联、学生档案、鉴权、RLS 或页面视觉。生产当前 release 的这两个源文件与本次优化前基线一致，可以作为独立应用补丁发布；生产最终耗时需发布后复测。

## 同数据对比

目标已核对为 Windows 本机开发服务和隔离 Supabase。复用固定开发管理员、教师账号；每组顺序测量，业务读取只读。固定统计截止时间为 `2026-09-10T12:00:00Z`。

| 数据读取场景 | 优化前 | 优化后 | 数据库请求数 |
| --- | --- | --- | --- |
| 管理员，2026 年 9 月 | 8,720 ms | 2,460 ms | 105 → 45 |
| 教师，2026 年 9 月 | 9,891 ms | 2,841 ms | 80 → 32 |
| 管理员，2026 年 8 月 | 7,959 ms | 2,127 ms | 105 → 45 |

三组返回结果逐字段深度比较一致，覆盖总量、趋势、人员归属、容量及不可用来源标记。教师原有受限来源状态继续保留。读取仍返回同一批事实；管理员数据库响应合计约 8.53 MB，本次改善来自减少重复查询和 CPU 工作。

开发首页完整 HTTP 响应在页面预热后，管理员由 8,109 ms 降至 2,877 ms；优化后的教师首页为 3,208 ms。均为 200 并包含大屏正文。该数值包含服务端渲染和响应传输，不是浏览器绘制或生产延迟保证。修改代码后的首次开发编译仍观察到约 7.8 秒额外等待，未混入上述预热对比。

## 机器检查与交付边界

- 分页、来源投影、统计和明细范围、课表与时区的 8 个定向测试文件通过。覆盖分页乱序、失败、上限、DST、不同日期/时区和格式化器复用。
- 本次四个代码/测试文件 ESLint、项目 `tsc --noEmit --incremental` 与 `git diff --check` 通过。
- 未使用浏览器自动化替代人工验收，未运行全量发布 Gate。
- 生产仅只读确认 current 为 `20260910-102012`，对应 `92334d4a0cc20dbdebe9dbc7cf57af2e01fc701b`；没有生产切换、重启或迁移。

定向验证可运行：`pnpm exec vitest run tests/staff-overview-read.test.ts tests/staff-overview-data.test.ts tests/staff-overview-contract.test.ts tests/schedule-location-timezone.test.ts tests/classroom-schedule.test.ts tests/staff-overview-acquisition-read.test.ts tests/staff-overview-acquisition-contract.test.ts tests/staff-overview-drilldown-contract.test.ts`。

计时和 CPU 采样留在本机系统临时目录用于本轮诊断，不作为正式发布 Gate artifact。本摘要不含身份、学生资料或凭据，随 Git 历史保留，访问角色为仓库读权限持有者。
