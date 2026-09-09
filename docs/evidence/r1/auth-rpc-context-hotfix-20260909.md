# 退出登录与课次 RPC 上下文修复

状态：**本地四处修复及定向验证完成；退出修复已随同日桌面提醒发布进入生产，点名与开课三处修复仍待部署**。本页保留下方原故障定位及验证记录。

2026-09-09 版本对账：生产 current 已只读核对为 `20260909-074028 / c7009ec054d3397b235cb5acda96e82f6a9fbbcc`。该版本中的退出实现与本地修复等效，见[桌面提醒生产启用记录](employee-web-push-production-activation-20260909.md)。点名抽屉、教师今日课次点名统计和选定微课正式开课冻结的三处修复仍只在本地；本次对账没有再次部署。

## 故障依据

- 故障定位时生产 current 为 `20260909-042441` / `c63a47b5b0d5031ea3c34cd934fbf6307abd37b0`；服务 active，`NRestarts=0`，健康接口正常。
- 2026-09-09 `07:03:53Z`、`07:05:10Z` 等首页 POST 日志记录 `Cannot read properties of undefined (reading 'rest')`，digest `3905596644`。同一异常也出现在其他页面的退出 Action 中。
- `logout` 把 `supabase.rpc` 提取为裸函数，调用时丢失客户端 `this`，在 `signOut` 前抛错。随后调用的 `.catch()` 也不符合真实 PostgREST builder 的 PromiseLike 接口；仅修复绑定仍会阻断退出。
- 同类裸函数调用还存在于点名抽屉读取、教师今日课次的点名统计、选定微课的正式开课冻结路径。四个源文件在本任务起始 HEAD 与上述生产 commit 之间无差异。
- 归档任务「修复仪表盘加载报错」记录的是总览页打不开，用户确认强制刷新后恢复；当时没有对应的新总览服务端错误，缓存原因仅为推测。该记录不构成本次 RPC 故障与昨日问题同源的证据。

## 修复范围

四处调用均改为直接使用有生成类型约束的 `supabase.rpc(...)`。退出的通知清理使用 `try / await / catch`，处理同步及异步异常后继续原有 `auth.signOut()` 和 locale 首页重定向。点名、课堂原有登录、权限、输入校验和业务 RPC 保持。

本次没有数据库迁移、身份或业务数据写入、Storage 操作、生产重启或发布。

## 验证

- 新增 `tests/supabase-rpc-context.test.ts` 使用真实 Supabase SDK 与真实 PostgREST builder，HTTP 由内存 transport 响应，不连接数据库。修复前 9 项中 8 项失败，复现 `rest`、`.catch is not a function` 及点名 `UNKNOWN`；最终 10 项通过，覆盖 zh/en 退出、通知失败容错、会话退出错误保留、三条课次路径及点名权限/输入拒绝。
- TypeScript `tsc --noEmit` 与全部受影响文件 ESLint 通过。
- 7 个相关既有测试文件合计 72 项通过、2 项失败。失败均为未修改文件中的既有源码/规划断言：`web-push-production.test.ts` 仍要求旧 `PUSH-P0`～`PUSH-P5` 规划文案；`classroom-roster-stars-v2.test.ts` 仍要求旧课堂样例默认表达式 `: "m4b"`。相关被断言文件与测试文件均无本任务修改；本次不将扩展检查登记为全绿。
- 开发端 health、zh/en 首页 HTTP 200，首页响应未发现 RSC digest 错误标记。浏览器退出、实际点名与开课交互待人工验收；未用自动化结果替代用户验收。

开发验收：[中文首页](http://192.168.5.213:3130/zh) · [英文首页](http://192.168.5.213:3130/en)。生产晋级按本次明确授权及对应只读 preflight、可回退应用发布与 postflight 单独执行，R1-Live 阶段和 Gate 保持。
