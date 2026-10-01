# DEV-PARENT-IOS-NEXT-20261001 · Codex 第 1 次交接

- 发出方 / 接收方：Next.js 子 agent → iOS 集成人；Supabase 子 agent 负责权限互审。
- 目的：实现交付，供集成到同一 iOS 批次。
- 关联任务卡：[DEV-PARENT-IOS-NEXT-20261001](../tasks/DEV-PARENT-IOS-NEXT-20261001.md)。
- 代码 base / head：`8d016fdbf299779d40e4d56c55009d00850c41db` / `54c3aa5ad93183a46fb3ee2f1ae1c8daaa97909c`。
- 分支 / worktree：`codex/parent-ios-next-codex` / `.worktrees/parent-ios-next-codex`。

## 已交付行为

- `GET /api/v1/parent/learning?participant=<UUID>` 使用调用者 Bearer、`auth.getUser()`、现有账号安全门及 `get_my_students` 核验，复用课表、考勤、学习摘要、请假进度、报告 RPC 和本人通知 RLS；全部孩子视图按稳定 ID 切片。
- 课程来自时间窗口中的班级与课次投影，字段表达实际课次统计。摘要只出年级、下一课、本周课次和星星，不暴露原摘要中的财务及最近作业成绩。
- `POST /api/v1/parent/learning` 的 `leave` / `readNotification` 复用现有业务 RPC。请假成功表示申请已提交；通知只有本人 RPC 成功后标记已读。没有测试数据库写入。
- `Report.participantId` 向后兼容增加为可空字段，反馈直接取 `student_id`。旧 assessment RPC 无该字段时返回 `null`；聚合只展示确切归属报告，另返 `unassignedReportCount`，同名孩子不会串数据。
- DTO、OpenAPI `0.3.0`、说明和微信生成副本同步。原网页直接消费的学校领域 RPC 不变；原家长 HTTP 请求与已有字段保留。未新增业务表。
- 聊天、自行调课、错题、资料编辑、支付能力明确为 `false`，不创建虚构结果。

实际变更为 `src/features/parent-portal/` 的学习模块及共用报告读取、`src/app/api/v1/parent/learning/route.ts`、`contracts/parent-api/`、微信 DTO 副本和 `tests/parent-ios-learning.test.ts`，全部位于本任务登记范围。

## 合同与兼容边界

- `participant` 必填；可选含时区的 ISO `from` / `to`，默认前 30 天至后 90 天，跨度最多 366 天。窗口只影响课表和考勤。完整字段以 [portal.ts](../../contracts/parent-api/portal.ts) 和 [OpenAPI](../../contracts/parent-api/openapi.json) 为准。
- 通知是账号级的最新 100 条未归档通知，包含所有孩子；只有 `studentId`、`studentName`、`classroomName`、`sessionTitle` 白名单载荷进入 DTO。`type` 是开放字符串，未知类型显示通用通知。
- Supabase lane 的 `369a9729bde1f6f4cf9cb8e4dc9b5cb20088b5be` 为原测评 RPC 增加 ID。SQL 源码未在本机或生产执行；未升级目标继续使用 nullable 兼容路径。
- 原请假 RPC 没有请求幂等键。iOS 已告知在提交中禁重；网络结果不明先刷新申请列表，由用户核对后决定后续操作。`SESSION_NOT_LEAVABLE` → `CONFLICT`，不存在 → `NOT_FOUND`，未报名 → `FORBIDDEN`。

## 机器验证与互审

Node.js `22.16.0`、TypeScript `5.9.3`、Vitest `4.1.10`。

- `node node_modules/vitest/vitest.mjs run tests/parent-ios-learning.test.ts tests/parent-portal.test.ts tests/parent-foundation.test.ts tests/parent-portal-client.test.ts`：4 文件、28 项通过。使用 mock 执行 HTTP handler，覆盖 Bearer / getUser、账号门、未关联孩子提前拒绝、同名隔离、通知本人过滤、旧报告兼容、查询失败、请假业务错误及已读权限返回。没有连接 Supabase。
- 受影响 TypeScript 检查通过：临时配置继承根 `tsconfig.json`，仅包含 `src/features/parent-portal/**/*.ts`、新 route、共用 DTO 和本次测试，关闭 incremental；其依赖一并检查。
- 全仓 `tsc --noEmit --incremental false` 检出原有 `tests/agent-coordination.test.ts` 第 97、105、106、117 行 `taskId` 参数类型错误；本任务范围没有新增类型错误，未改其他任务文件。
- 定向 ESLint、微信 `tsc -p apps/parent-wechat/tsconfig.json --noEmit`、`check-parent-foundation.mjs`、DTO 同步核对、`git diff --cached --check` 和暂存隐私扫描通过。测试首次受沙箱子进程权限限制，获准后在同一 worktree 正常完成；没有修改锁文件或安装依赖。
- Supabase 子 agent 对代码 head `54c3aa5ad93183a46fb3ee2f1ae1c8daaa97909c` 完成只读权限复核，无阻断项：真实用户 client、当前关系、稳定 ID、已发送/发布及 grades scope、通知本人 RLS 保留；没有 service-role 学习读取。
- Next.js 子 agent 对 Supabase head `369a9729bde1f6f4cf9cb8e4dc9b5cb20088b5be` 完成只读复核，无阻断项：迁移仅向原 JSON 加 `s.id`，其余查询和授权保持一致。

真实目标数据库/RLS 运行、开发服务器联调、原生 Xcode 构建和产品人工验收未由本 lane 执行；机器合同检查不替代这些状态。

## 交接状态

- 已提交代码；交接单单独提交。没有持续运行的进程或数据库、端口占用。忽略的 `node_modules` junction 复用主 checkout 依赖，微信本地示例配置及临时类型检查配置留在忽略范围。
- 接收方下一步：按本批次顺序集成 API 与 Supabase 源码提交，使用 DTO 实现 iOS，保留目标数据库未升级的明确兼容状态；数据库执行按目标授权流程单独处理。
- 产品人工验收 / 部署 / Gate：均未改变。本增量为机器检查通过、待集成及开发端联调；不表示已部署或用户已验收。
- 接收确认：待集成人接收；Supabase lane 已在当前授权协作消息中确认权限复核。
