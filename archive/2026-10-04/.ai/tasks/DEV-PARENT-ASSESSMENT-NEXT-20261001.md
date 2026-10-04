# DEV-PARENT-ASSESSMENT-NEXT-20261001 · 家长1对1测评共用接口合同

## 目标与验收

- 授权与产品依据见 [Supabase lane](DEV-PARENT-ASSESSMENT-SUPABASE-20261001.md) 和 [小程序家长入口](DEV-PARENT-WECHAT-20261001.md)。用户要求复用现有后端并同步各端合同，测评是独立1对1教师预约入口。
- 新增 `GET/POST /api/v1/parent/assessments`，继续使用既有 Bearer 身份检查和私有、不可缓存响应；普通活动预约语义保持独立。
- GET 按 participant 学生 UUID 返回 eligibility、有限范围真实教师与本人孩子邀约；POST request 提交稳定客户端 UUID、teacherId 与家长意向，confirm 提交邀请 ID、交集时间与 expectedUpdatedAt。
- 协调状态保持待确认；`proposedStartsAt` 表示候选预约时刻，`scheduledAt` 只在 confirmed/completed 表示真实预约时间。教师时段来自该条邀约，不作为全局空闲库存。

## 合同与交接

- 复核者：Supabase 子 Agent，集成人补充检查，结论绑定代码 head。
- 先独立提交共享 TypeScript DTO、OpenAPI、合同说明和微信生成副本，随后实现 HTTP、输入验证和 RPC 输出校验。共享类型只有本 lane 写入。
- 使用 Supabase lane 已确定的三个 RPC；请求和确认 RPC 返回单个 request 投影。教师展示字段统一 `displayName`，时区固定 `Asia/Shanghai`，保留 `canConfirm`。
- eligibility.reason：null、NO_LINKED_LEAD、AMBIGUOUS_LINKED_LEAD、LEAD_UNAVAILABLE、ACTIVE_INVITATION、NO_ELIGIBLE_TEACHER。跨孩子/撤销权限直接返回 FORBIDDEN，保持错误信息边界。
- `IDEMPOTENCY_CONFLICT` 对外归一为 HTTP 409 / CONFLICT。网络结果不明时，客户端先 GET 恢复并保留原请求 ID；不在 Next.js 内存中模拟持久幂等。
- 微信 UI 与其 foundation 测试归另一 lane，本卡不改它们；`apps/parent-wechat/miniprogram/lib/api-types.ts` 由本 lane 的生成脚本更新。

## 环境与验证

- 工作目录复用 `.worktrees/parent-ios-next-codex` 的干净 checkout，切到登记的新分支；原分支提交保留。
- 新增定向 HTTP/输入/DTO 测试，检查未登录与越权、缺失参数、RPC 不可用、状态与时间投影、稳定 UUID 和冲突语义；运行受影响的类型/格式检查与生成副本检查。
- 不新建服务、不执行数据库迁移或业务写入，不生产部署；数据库 RPC 未安装时真实返回不可用。
- 代码提交后另写交接，记录 base/head、合同提交、检查与尚待数据库/客户端运行验证的事实。

## 交付状态

- 当前：代码 `4e7f2ffe` 与交接 `95c3727e` 已互审并集成 main；合同、生成副本及 HTTP 使用同一版本。
- 目标：供 iOS/小程序复用的独立测评 API；本卡不改原生 iOS UI，不代替预约和视觉人工验收。
- 复用 29 项定向 HTTP 检查及相关类型、ESLint 结果。集成人的本机局域网检查确认缺少参数 400、匿名 401、绑定家长以大写 UUID 读取 200、未绑定家长 403、原有报告读取 200；没有发起业务预约。
