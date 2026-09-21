# 家长端接口规范

本轮工程基础为 `0.1.0`。可调用能力以 [OpenAPI](openapi.json) 的 paths 为准；当前只登记已存在的 `GET /api/health`，它返回服务存活信息，不连接 Supabase。

## 接入方式

微信、iOS 和 Android 共用现有 Mathin 服务及 Supabase 业务主体。各端页面独立实现。账号识别沿用 `auth.users.id`，亲子关系和业务授权在服务端及 RLS 中校验。

后续家长业务接口使用 `/api/v1/parent/...`。网页 Server Actions 可与 HTTP 接口复用领域逻辑；客户端不依赖 Server Action 的内部调用协议和网页 Cookie。

接口按已实现行为更新 OpenAPI，包括入参、响应、鉴权、分页与错误码。原生 DTO 应与同一规范对齐；TypeScript 类型不作为 Swift/Kotlin 的运行时依赖。

## 后续接入顺序

1. 家长登录、令牌刷新、已有账号绑定及亲子关系读取。
2. 课程查看。
3. 作业列表、详情、附件上传与提交。
4. 错题及解析。

这些业务接口尚未实现。微信登录兑换在服务端进行；微信 AppSecret、Supabase service role 等服务端密钥不进入客户端。附件存储继续复用现有 Storage，具体授权和上传协议在作业增量中定义。

OpenAPI 使用相对 server URL，各端本地配置选择 origin。根目录 `pnpm parents:check` 会核对健康接口响应与工程边界。
