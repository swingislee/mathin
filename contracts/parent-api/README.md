# 家长端接口规范

当前接口版本为 `0.2.0`。可调用能力以 [OpenAPI](openapi.json) 的 paths 为准，业务 DTO 维护在 [portal.ts](portal.ts)。微信小程序已接入下列能力；iOS、Android 保留工程基础，可复用此 HTTP 合同。

## 接入方式

微信、iOS 和 Android 共用现有 Mathin 服务及 Supabase 业务主体。各端页面独立实现。账号识别沿用 `auth.users.id`，亲子关系和业务授权在服务端及 RLS 中校验。

家长业务接口使用 `/api/v1/parent/...`。客户端不依赖 Server Action 的内部调用协议和网页 Cookie；受保护请求使用 `Authorization: Bearer <accessToken>`。服务端调用 `auth.getUser()`，并检查账号状态、必要同意与参与人权限。

接口按已实现行为更新 OpenAPI，包括入参、响应、鉴权、分页与错误码。原生 DTO 应与同一规范对齐；TypeScript 类型不作为 Swift/Kotlin 的运行时依赖。

## 已实现接口

| 接口 | 用途 | 登录要求 |
| --- | --- | --- |
| `GET /api/health` | 服务存活；不连接数据库 | 无 |
| `POST /api/v1/parent/auth` | `login` / `refresh` / `logout` | 退出须 Bearer |
| `GET /api/v1/parent/portal?resource=form&form=welcome` | 当前登记字段、选项、版本和信息使用说明 | 无 |
| `GET /api/v1/parent/portal?resource=activities` | 已公开的未来活动、时间、地点及剩余名额 | 无 |
| `GET /api/v1/parent/portal?resource=account` | 当前账号与已关联参与人 | 必须 |
| `GET /api/v1/parent/portal?resource=bookings` | 本人可见的预约 | 必须 |
| `GET /api/v1/parent/portal?resource=reports` | 已发送测评及已发布课后反馈 | 必须 |
| `GET /api/v1/parent/portal?resource=practices` | 当前参与人可提交的练习 | 必须 |
| `GET /api/v1/parent/portal?resource=submission&id=...&participant=...` | 最新一次提交；未提交为 `null` | 必须 |
| `POST /api/v1/parent/portal` | `intake` / `book` / `cancel` / `submit` | `intake` 免登录，其余必须 |
| `POST /api/v1/parent/media` | multipart `file` 上传，附练习与参与人两个请求头 | 必须 |
| `GET /api/v1/parent/media?id=...` | 获取 5 分钟有效的私有预览地址 | 必须 |
| `GET /api/v1/parent/media?download=...&token=...` | 流式读取签名附件，支持 Range | 临时签名 |

账号登录使用已有手机号或邮箱及密码。微信登录兑换尚未接入。微信 AppSecret、Supabase service role 等服务端密钥保留在服务端，客户端只持有自己的会话令牌。

登记按后端字段 ID 和选项 ID 校验，保存配置快照及同意时间。`requestId` / 提交 `id` 用于重试去重，相同请求号更换内容会返回 `CONFLICT`。预约在数据库内锁定活动并检查实时名额，使用原有 `activity_registrations`。

照片上限 12 MiB、视频 64 MiB，每次提交 1～9 个附件，单账号预留空间上限 1 GiB。根据文件签名识别 JPEG/PNG/WebP/HEIC/MP4/MOV，视频额外核验 `video` 权限。附件只存入私有 `miniapp-practice` bucket；签名 URL 经同一 API origin 代理，手机无需访问 Supabase 内网地址。失败重试会复用客户端已完成的上传；未确认上传响应时可能留下预留文件，目前保留供后台核对，没有新增自动清理任务。

列表上限：活动、预约、练习各 100 条，结果合计 200 条；课后反馈范围为最近 366 天。业务结果按原始发布语言展示。错误体统一为 `{ "code": "..." }`，含 `FORM_CHANGED`、`ACTIVITY_FULL`、`ACCOUNT_SECURITY` 等可处理原因。JSON 请求最多 32 KiB；登录/刷新、匿名登记和上传有数据库计数限流。正式反向代理须覆盖客户端传入的 `X-Forwarded-For`，使来源限流使用可信地址。

OpenAPI 使用相对 server URL，各端本地配置选择 origin。`node scripts/sync-parent-contract.mjs` 生成微信 DTO 副本；`pnpm parents:check` 核对副本、工程边界和受影响测试。后端配置与本机验收步骤见[小程序业务配置说明](../../apps/parent-wechat/docs/portal.md)。
