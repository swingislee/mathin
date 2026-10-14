# 嵌套行展开变慢定位

- 任务：定位所有表格新增的展开等待。2026-10-14 在开发端 `http://192.168.5.213:3130`、本机隔离数据库只读计时；本轮未修改产品代码或数据库。
- 回归来源：`50f614481535e1e302129f921ce9cf6a64ab99e2` 同时引入共享基础信息入口与当前年级推算。

## 已确认的问题

1. `src/features/school/StudentBasicProfileBar.tsx` 在展开时挂载 `next/dynamic` 的完整 `SchoolSupportProfile`。`dashboard-page/DashboardInlineEntry.tsx` 将它置于 `DashboardInlineDetailBoundary` 外；当前 Next 默认 dynamic 无独立 Suspense 边界，冷模块等待会到达页面边界。
   - 隔离复现使用真实共用容器与 Next App Router dynamic 行为，仅延迟编辑器模块。关闭基础信息入口时页面、现成表单正常显示；启用时触发页面 loading，断言稳定失败。
   - `SchoolSupportProfileButton` 的资料读取只在 `open=true` 时发生；单纯展开并未额外请求基础资料。新增等待首先来自模块加载边界。
   - 该模块加载完成后会缓存，因此此项主要影响冷加载/首次展开；不能解释为每行都重新下载编辑器。
2. `supabase/migrations/20261014003000_subject_current_grades.sql` 把 `school_apply_current_grades` 加到完整学生详情读取，后者执行 `school_current_subject_grades`。
   - 三个来源线索、每个两次只读 SQL：新增年级推算 142.88–182.22ms；完整详情 316.02–369.83ms，年级部分约占四成至一半。
   - 单人年级查询计划：来源路径中间节点处理 4,925 行，最终返回 1 行，执行 158.46ms；历史来源与当前版本的联接未先缩小到目标主体的相关记录。

## 请求层观察与局限

- 固定开发主管身份，三条可写沟通记录：直接详情 RPC 316–395ms；开发端详情 HTTP 首次 2355ms，随后 527–618ms。
- 首次额外耗时未进一步拆分开发编译与鉴权初始化，不能全部归因于数据库；以上数据也不是浏览器端到端点击时间。
- 现有 communication-inline-loading 用例先受 jsdom 缺少 document.fonts.ready 阻塞；另建隔离复现绕开无关页头并证实加载边界问题。未运行浏览器验收或全量回归。
- 临时复现、分段计时与脱敏查询计划摘要保存在忽略目录 `.tmp/nested-row-latency-20261014/`；凭据和业务资料未进入提交。

## 修复顺序

1. 基础信息入口使用同步轻按钮；点击该按钮时才独立加载编辑弹窗，并给编辑器自己的加载边界，保持行内业务表单立即可用。
2. 单人年级读取先限定主体及相关来源 ID，再解析历史年级；保留现有年级优先级、学年边界与人工更正语义。
3. 定向验证冷模块、详情请求和连续换行，分别报告首读与预热耗时。
