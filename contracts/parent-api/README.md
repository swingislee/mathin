# 家长端接口规范

当前接口版本为 `0.7.0`。可调用能力以 [OpenAPI](openapi.json) 的 paths 为准，业务 DTO 维护在 [portal.ts](portal.ts)。微信、iOS 和 Android 使用同一份 HTTP 合同，各端按自己的页面接入已实现能力。

## 接入方式

微信、iOS 和 Android 共用现有 Mathin 服务及 Supabase 业务主体。各端页面独立实现。账号识别沿用 `auth.users.id`，亲子关系和业务授权在服务端及 RLS 中校验。

家长业务接口使用 `/api/v1/parent/...`。客户端不依赖 Server Action 的内部调用协议和网页 Cookie；受保护请求使用 `Authorization: Bearer <accessToken>`。服务端调用 `auth.getUser()`，并检查账号状态、必要同意与参与人权限。

接口按已实现行为更新 OpenAPI，包括入参、响应、鉴权、分页与错误码。原生 DTO 应与同一规范对齐；TypeScript 类型不作为 Swift/Kotlin 的运行时依赖。

## 已实现接口

| 接口 | 用途 | 登录要求 |
| --- | --- | --- |
| `GET /api/health` | 服务存活；不连接数据库 | 无 |
| `POST /api/v1/parent/auth` | `login` / `refresh` / `logout` | 退出须 Bearer |
| `GET /api/v1/parent/auth/wechat` | 小程序微信配置可用性与本人绑定状态 | 读取本人状态须 Bearer |
| `POST /api/v1/parent/auth/wechat` | `wx.login` code 登录、明确绑定现有账号 | `bind` 须 Bearer、原密码和确认 |
| `GET /api/v1/parent/portal?resource=form&form=welcome` | 当前登记字段、选项、版本和信息使用说明 | 无 |
| `GET /api/v1/parent/portal?resource=activities` | 已公开的未来活动、时间、地点及剩余名额 | 无 |
| `GET /api/v1/parent/portal?resource=account` | 当前账号与已关联参与人 | 必须 |
| `GET /api/v1/parent/portal?resource=bookings` | 本人可见的预约 | 必须 |
| `GET /api/v1/parent/portal?resource=reports` | 已发送测评及已发布课后反馈 | 必须 |
| `GET /api/v1/parent/portal?resource=practices` | 当前参与人可提交的练习 | 必须 |
| `GET /api/v1/parent/portal?resource=submission&id=...&participant=...` | 最新一次提交；未提交为 `null` | 必须 |
| `GET /api/v1/parent/courses` | 主动展示的长期班、短期班及活动，沿用既有 HTTP 路径 | 免登录 |
| `GET /api/v1/parent/courses?resource=applications` | 当前账号提交且仍有孩子权限的预报名及历史申请 | 必须 |
| `POST /api/v1/parent/courses` | `apply` 提交班级／活动预报名；`cancel` 撤回本人待联系预报名 | 必须 |
| `GET /api/v1/parent/advisors` | 按年级公开已启用的学辅二维码及手机号 | 免登录 |
| `GET /api/v1/parent/advisors/qr?path=...` | 同源读取公开的学辅二维码图片 | 免登录 |
| `GET /api/v1/parent/learning?participant=...` | 一个孩子的课表、考勤、学习摘要、请假进度、报告及当前账号通知 | 必须 |
| `POST /api/v1/parent/learning` | `leave` 提交请假申请；`readNotification` 标记本人通知已读 | 必须 |
| `GET /api/v1/parent/assessments?participant=...` | 一个孩子的 1 对 1 测评申请、资格和有限范围教师 | 必须 |
| `GET /api/v1/parent/assessment-slots?participant=...&subjects=math,english&grade=3` | 按孩子、科目、年级读取未来两周已发布测评时段 | 必须 |
| `POST /api/v1/parent/assessments` | `book` 预约发布时段；`request` / `confirm` 保留旧协调流程 | 必须 |
| `POST /api/v1/parent/portal` | `intake` / `cancel` 既有预约 / `submit`；旧活动 `book` 已停用 | `intake` 免登录，其余必须 |
| `POST /api/v1/parent/media` | multipart `file` 上传，附练习与参与人两个请求头 | 必须 |
| `GET /api/v1/parent/media?id=...` | 获取 5 分钟有效的私有预览地址 | 必须 |
| `GET /api/v1/parent/media?download=...&token=...` | 流式读取签名附件，支持 Range | 临时签名 |

账号登录使用已有手机号或邮箱及密码。微信小程序登录与绑定遵循下节合同；配置与真实平台往返单独验收。微信 AppSecret、Supabase service role 等服务端密钥保留在服务端，客户端只持有自己的会话令牌。

登记按后端字段 ID 和选项 ID 校验，保存配置快照及同意时间。`requestId` / 提交 `id` 用于重试去重，相同请求号更换内容会返回 `CONFLICT`。既有活动预约保持可读与按原规则取消，新的公开报名统一使用预报名接口。

公开目录由具体班级或活动的“对外展示 / 预报名”设置控制；课程产品用于教研。`CourseOffer.kind=class` 时 `id` 是班级 ID，`classes` 提供该班的真实资料，短期班的课程或学期关联可以为空；`kind=activity` 时 `id` 是活动 ID、`classes=[]`，`activity` 提供年级范围、地点和时间。未分类的活动不推断科目。新公开对象 `priceCents=null`，家长线下缴费。

申请命令为 `{action:"apply",id,kind,publicationId,revision,classroomId,participantId}`；班级的 `classroomId=publicationId`，活动的 `classroomId=null`。请求保存对象快照，检查真实展示版本、亲子关系及重复请求。状态为 `pending/contacted/declined/cancelled`；旧 `confirmed` 只表示既有正式报名历史。工作人员联系处理不会创建正式报名、分班、活动参与名单或缴费。家长可撤回待联系预报名，正式业务由线下办理。

学辅联系人按精确年级配置，公开接口只返回已启用记录；没有设置的年级为空。二维码 URL 使用当前 API origin，手机号用于平台拨号。二维码上传和设置需要 `organization.profile.manage`，家长端没有聊天、支付或退款入口。

照片上限 12 MiB、视频 64 MiB，每次提交 1～9 个附件，单账号预留空间上限 1 GiB。根据文件签名识别 JPEG/PNG/WebP/HEIC/MP4/MOV，视频额外核验 `video` 权限。附件只存入私有 `miniapp-practice` bucket；签名 URL 经同一 API origin 代理，手机无需访问 Supabase 内网地址。失败重试会复用客户端已完成的上传；未确认上传响应时可能留下预留文件，目前保留供后台核对，没有新增自动清理任务。

列表上限：活动、预约、练习各 100 条，结果合计 200 条；课后反馈范围为最近 366 天。业务结果按原始发布语言展示。错误体统一为 `{ "code": "..." }`，含 `FORM_CHANGED`、`ACTIVITY_FULL`、`ACCOUNT_SECURITY` 等可处理原因。JSON 请求最多 32 KiB；登录/刷新、匿名登记和上传有数据库计数限流。正式反向代理须覆盖客户端传入的 `X-Forwarded-For`，使来源限流使用可信地址。

## 微信小程序登录与绑定合同

`GET /api/v1/parent/auth/wechat` 返回 `{ available, linked, canBind }`。`available` 仅表示服务端配置就绪，不表示真实微信登录已验收。匿名请求的 `linked=null`、`canBind=false`；携带 Bearer 时验证当前账号，按原生 `auth.identities` 返回绑定状态。`canBind` 表示配置、账号现有登录方式与 MFA 等已知条件允许发起绑定，最终操作仍重新校验。

`POST /api/v1/parent/auth/wechat` 接受 JSON（最多 32 KiB），使用 `wx.login()` 新取得的临时 `code`：

- `{ action: "login", code }`：已绑定微信返回 `{ state: "authenticated", session }`，`session` 与密码登录合同一致；未知微信返回 `{ state: "binding_required" }`，没有会话、身份标识或临时游客账号。客户端引导登录现有账号，然后重新取得微信 code 进行绑定。
- `{ action: "bind", code, password, confirm: true }`：必须携带当前 Bearer。服务端从当前账号选择真实邮箱/手机号，复核原密码、账号状态及 MFA，检查微信归属与账号唯一绑定后使用 Supabase 原生手动绑定。成功返回 `{ state: "bound" }`，客户端保留当前会话。密码不保存；不能用任意号码、姓名或微信昵称自动合并账号。

两种成功都返回 HTTP 200。微信 code 使用一次；过期、失败或结果不明时先刷新绑定状态，再由用户重新发起 `wx.login()`，不自动重放 POST。服务端使用小程序 AppID/AppSecret 调用 `code2Session`，不使用网站扫码 OAuth code。`session_key`、OpenID、UnionID、上游原始错误和认证 URL 均不返回客户端或写入日志。

身份继续使用同一开放平台命名空间和真实 UnionID（`namespace:unionid`）对应 `custom:wechat`。小程序须绑定与网站相同的开放平台，且真实响应须包含 UnionID；缺失时返回明确错误，不以 OpenID 或客户端提交字段替代。未知微信不会创建 Auth 用户、资料、学生或亲子关系。AppSecret 未配置时能力关闭；完成受控配置与原生 Auth 联调后再开放。

错误返回 `{ code, reason? }`。`code` 沿用公共错误码；`reason` 为小程序微信专用、可供界面翻译的稳定原因：

| HTTP / code | reason | 客户端处理 |
| --- | --- | --- |
| 503 / `UNAVAILABLE` | `WECHAT_NOT_CONFIGURED` | 当前未开放，继续使用账号密码 |
| 401 / `UNAUTHENTICATED` | `WECHAT_CODE_INVALID` | 重新发起微信登录 |
| 503 / `UNAVAILABLE` | `WECHAT_UNIONID_REQUIRED` | 请管理员完成同开放平台关联后重试 |
| 401 / `UNAUTHENTICATED` | `WECHAT_CREDENTIALS_INVALID` | 核对当前账号的原密码 |
| 403 / `ACCOUNT_SECURITY` | `WECHAT_MFA_REQUIRED` | 完成现有账号的二次验证后再绑定 |
| 503 / `UNAVAILABLE` | `WECHAT_PHONE_LINKING_UNAVAILABLE` | 当前纯手机号绑定兼容性尚未开放 |
| 409 / `CONFLICT` | 省略 | 微信或当前账号已有其他绑定，刷新状态；不披露另一账号 |

其他校验、过大请求、角色/账号限制、限流、平台故障沿用公共 `VALIDATION`、`TOO_LARGE`、`FORBIDDEN`、`ACCOUNT_SECURITY`、`RATE_LIMIT`、`UNAVAILABLE`。所有响应不缓存；微信上游错误仅映射固定码。服务端固定目标主机、超时和响应上限，凭据使用不记录 query 的受控传输。

协议依据：[微信官方 API 类型中的 wx.login](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)、[code2Session](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)。官方类型将 code 定义为五分钟临时凭证，并要求服务端兑换；实际平台响应和同开放平台 UnionID 下发仍需配置后验收。

### 服务端配置与启用

本增量交付时（2026-10-02）用户确认 AppSecret 尚未配置，入口保持关闭。配置写入部署目标的受控环境或已忽略私有文件，客户端配置只保留其 API origin；共享文件和日志不保存真实 AppID、AppSecret 或 broker 密钥。

1. 为服务端设置 `WECHAT_MINIPROGRAM_APP_ID`、`WECHAT_MINIPROGRAM_APP_SECRET`，确认小程序和网站绑定同一开放平台；`WECHAT_OPEN_PLATFORM_NAMESPACE` 使用既有稳定值。
2. 设置 `WECHAT_SITE_ORIGIN`、`WECHAT_SUPABASE_PUBLIC_ORIGIN` 和独立高熵 `WECHAT_BROKER_CLIENT_SECRET`。Auth origin 必须与 `NEXT_PUBLIC_SUPABASE_URL` 完全一致；同时需要既有 publishable key 与 `SUPABASE_SECRET_KEY`。生产 origin 使用 HTTPS；非生产可使用已登记的 `http://192.168.5.213:3130` 与本机 `http://127.0.0.1:35421`。
3. 复用已有 `custom:wechat` OAuth2 provider 与 `mathin-wechat` client：authorization、token、userinfo URL 分别为站点 origin 下的 `/zh/auth/wechat/authorize`、`/zh/auth/wechat/token`、`/zh/auth/wechat/userinfo`，保持 `email_optional=true`、`pkce_enabled=true`、`scopes=[]`。给 Auth 的严格 redirect allowlist 增加站点 origin 下的 `/api/v1/parent/auth/wechat`；启用受控 manual linking，保持未知 OAuth 用户禁止自行注册。使用已有票据表、身份唯一约束和审计，维持过期票据清理。
4. 在已授权开发目标验证邮箱/纯手机号的原 UUID、两段 PKCE、未知微信、冲突、会话切换、停用、MFA、原密码与解绑兼容后，按现有 runbook 设置 `WECHAT_AUTH_COMPATIBILITY_VERIFIED=true`；纯手机号兼容验证通过才设置 `WECHAT_PHONE_LINKING_VERIFIED=true`。再设置 `WECHAT_MINIPROGRAM_ENABLED=true` 并启用对应 provider。网站扫码入口仍单独由 `WECHAT_OAUTH_ENABLED` 控制。
5. 真实微信往返核对 code 单次消费、同开放平台 UnionID 和既有账号绑定；由用户验收。当前代码的协议替身与 SDK 测试不表示真实微信往返、目标 Auth 配置或生产部署已通过。

小程序 proof 在一次服务端请求内使用。外层 SDK verifier 保存在该请求的内存，内层复用原 broker 的 60 秒单次 grant/access 票据；固定校验 Auth、provider、最终返回 origin/path 与随机关联参数。客户端不接触 OAuth 跳转、Cookie 或 broker 票据。绑定完成只清除独立产生的验证/OAuth 会话，保留发起绑定的 session_id。小程序没有获取昵称/头像，本次不覆写网页微信资料快照，也不把空资料声明写入用户展示字段。

来源限流使用代理覆盖的 `X-Real-IP`；没有可信来源时共用 `direct` 桶。绑定密码验证按账号计数，不随客户端 IP 变化；只存 HMAC。代理和服务日志只记录路径，不记录认证 query、请求体、Authorization、Cookie 或原始上游错误。

## 学习视图与现有业务复用

`learning` 使用调用者的 Bearer Supabase client，先核验 `get_my_students` 中的孩子 ID，再读取现有 `get_my_schedule`、`get_my_attendance`、`get_my_learning_summary`、`list_my_session_leave_requests` 和已发布报告；不建立 App 专用业务表。每个孩子的课表、考勤、报告和申请按稳定 `student_id` 切片，同名孩子保持独立。

`participant` 必填。可选 `from` / `to` 接受含时区的 ISO 时间，默认当前时刻前 30 天至后 90 天，左闭右开，跨度最多 366 天。这个窗口只约束课表及考勤；报告沿用原接口的查询窗口。`courses` 是窗口中有课次的班级投影，`sessionCount` 是窗口内课次数。它不代表已购买课程目录或剩余课时，窗口之外的班级可通过调整窗口读取。摘要只返回年级、下一课时间、本周课次数和星星数；未输出原 RPC 中的财务及最近作业成绩字段。

`notifications` 是账号本人最新 100 条未归档通知，含已读及未读，覆盖所有孩子；不随当前孩子筛选。只返回通知键、时间、已读状态、安全的本站工作区相对路径，以及孩子/班级/课次的白名单文字字段。`type` 不是封闭枚举，客户端为未知类型提供通用通知标题。通知只在 `mark_notification_read` 成功后显示已读。

请假使用 `{ action: "leave", participantId, sessionId, reason }`，复用 `submit_session_leave_request`，成功返回 HTTP 201 和申请 ID。原 RPC 检查当前亲子关系、在读报名和未来未结束的课次。成功表示申请已提交，审批及补课进度从 `leaveRequests` 读取。请假期间保持提交按钮忙碌，网络结果不明时先刷新申请列表再由用户核对，避免自动重复 POST；原 RPC 没有请求幂等键。已开始或结束的课次返回 `CONFLICT`，目标不存在返回 `NOT_FOUND`，未报名返回 `FORBIDDEN`。

`capabilities` 明确列出可执行能力：当前支持请假申请与通知已读；聊天、家长自行调课、错题、资料编辑和支付为 `false`。空列表表示本次授权查询没有可见数据；所需查询失败返回错误，不以空列表掩盖服务不可用。错题目前没有可供家长读取的权威 RPC；课堂学习表现检查是学生端合同，不能改名为家长错题。

### 报告字段兼容

`Report.participantId` 为新增的可空字段。课后反馈直接使用原 RPC 的 `student_id`；测评依赖 `20261001000100_parent_report_participant_identity.sql` 为原 `miniapp_assessment_reports` JSON 增加 `students.id`，保持同签名、发送状态和 `grades` 权限。该增量已在本机隔离开发库安装，并随[v0.3.0](../../archive/2026-10-04/docs/evidence/r1/release-v030-20261002.md)于 2026-10-03 发布生产；其他目标仍按各自版本核对。客户端与真实家庭验收见[当前状态](../../docs/current.md)。

未升级数据库的测评仍可通过原 `portal?resource=reports` 读取，其 `participantId` 为 `null`。`learning` 不按姓名猜测归属，只返回 ID 与所选孩子一致的报告，并通过 `unassignedReportCount` 告知当前账号存在无法归属的历史报告。原账号、预约、练习、提交及媒体接口的请求和已有字段保持兼容，微信 DTO 副本同步生成。

## 1 对 1 测评稳定合同

2026-10-05 新增老师主动发布排班：`20261005000100_assessment_published_slots.sql`、`20261005000200_assessment_slot_closure.sql`、`20261005000300_assessment_slot_booking_status.sql` 已应用于本机隔离开发库，未部署生产。新增 `assessment_slots` 存发布安排，预约仍写入原有邀约。教职员入口是 `/zh/dashboard/assessments/availability`，`review.write` 老师自管，`followup.write` / `schedule.manage` 工作人员全管；已约历史的主体内容不可修改，关闭发布保留预约事实。

`GET /api/v1/parent/assessment-slots` 必填 `participant`、逗号分隔的 `subjects`（`math`、`english`，可多选）和 `grade`（-1 幼中班、0 幼大班、1～12 年级）。`parent_assessment_availability` 以调用者身份验证孩子范围，返回上海日期今天至今天+13 的 `{ participantId, timeZone, from, to, teachers, campuses, slots }`。时段含 `{ id, teacherId, campusId, startsAt, endsAt, available }`，只展示主动发布并符合全部所选科目和年级的安排；`available=false` 表示占用，未发布时间不补造记录。发布老师可以不是孩子原任课教师，输出不含其他家长或预约信息。

预约命令为 `{ action: "book", id, participantId, slotId, subjects, grade, mode: "campus" }`，调用 `book_parent_assessment_slot`。数据库锁定请求、学生及老师，核验发布状态、科目、年级、当前资格和时间占用后生成 `confirmed` 邀约，HTTP 返回 201。重试同 ID、同输入返回当前状态，包括已完成或已取消；变更输入或已占用返回 `CONFLICT`。结果的可选 `booking` 含时段、科目、年级、方式、校区及结束时间；旧协调记录可为 null 或省略。新预约可从既有邀约沟通明细完成或取消，取消后重新开放仍有效的发布时段。

`/api/v1/parent/assessments` 的 HTTP 实现和 OpenAPI 已接入本节合同。GET 必填 `participant`；UUID 接受大小写输入并统一以小写传递和返回。POST 的 `request`（含同 ID 幂等恢复）返回 HTTP 201，`confirm` 返回 HTTP 200。代码交付不表示数据库 RPC 已安装或预约业务已可运行；数据库尚未升级时返回 `UNAVAILABLE`，目标环境升级按各自授权流程执行。

2026-10-03 核对：`20261001000200_parent_assessment_requests.sql` 已完成本机事务／鉴权检查，并随[v0.3.0 发布生产](../../archive/2026-10-04/docs/evidence/r1/release-v030-20261002.md)。10 月 2 日已装载固定开发样例，一名孩子可新申请，另一名可查看教师回复并确认，实际 HTTP 与模拟器读取通过，见[开发集成记录](../../archive/2026-10-04/.ai/tasks/DEV-PARENT-PREVIEW-20261002-INTEGRATION.md)。10 月 1 日 `NO_LINKED_LEAD` 是装载前样例的历史结果；用户后续操作以实际状态为准。完整申请→教师回复→家长确认仍待人工验收，生产接口检查不代替该业务闭环。

独立测评复用已有 `lead_invitation_threads(kind=assessment_1v1)`，通过 `parent_assessment_overview`、`request_parent_assessment` 和 `confirm_parent_assessment` 读取和推进同一条邀约。HTTP 使用调用者的 Bearer Supabase client，数据库实时核验 `miniapp_can_participate(student, 'grades')`；学生 UUID 经现有 `leads.student_id` 对应业务线索。没有唯一可用线索时保留已有邀约读取和确认，新申请由 `eligibility` 说明限制。

`ParentAssessmentOverview` 返回所选 `participantId`、固定时区 `Asia/Shanghai`、`eligibility`、`teachers` 和 `requests`。其中 `teachers` 保留旧协调入口的当前任课教师或负责人，核验账号及 `review.write`；字段只有 `id`、`displayName`，按名称、ID 排序，邀约按更新时间、ID 倒序，各最多 100 条。主动发布老师由独立 `assessment-slots` 接口返回，因此概览允许 `canRequest=true` 且旧 `teachers=[]`。已有邀约的老师随该条记录返回。

`eligibility.canRequest` 为 `true` 时 `reason=null`；否则 `reason` 为 `NO_LINKED_LEAD`、`AMBIGUOUS_LINKED_LEAD`、`LEAD_UNAVAILABLE`、`ACTIVE_INVITATION` 或 `NO_ELIGIBLE_TEACHER`。空数组表示授权查询的真实结果；查询失败返回错误，不降级为空列表。

旧协调流程的时间意向 token 使用 `YYYY-MM-DD@时段`，有效时段为 `09:50`、`10:00`、`14:00`、`16:00`、`17:00`、`17:30`、`19:20`、`after_school`，每组最多 84 项且唯一。`parentTimeOptions` 和 `teacherTimeOptions` 保留双方候选；`sharedTimeOptions` 只返回双方交集中未来可确认的精确时段，排除 `after_school` 和过期项。新发布时段预约的这些数组为空，以 `booking` 和 `scheduledAt` 表示实际安排；数据库也阻止旧协调预约与已约发布时段重叠。

`coordinating_time`、`awaiting_teacher` 和 `awaiting_parent` 都表示待确认；其 `scheduledAt=null`。`proposedStartsAt` 仅在 `awaiting_parent` 表示已提出的预约时刻，允许为 `null`。`scheduledAt` 仅在 `confirmed` / `completed` 表示实际预约时刻；它不是确认操作发生时间。`cancelled` 的两项时间均为 `null`。`canConfirm` 只在等待家长、线索和教师仍有效且存在未来精确交集时为 `true`，最终写入仍重新核验这些事实。

`completed` 表示邀约流程已结束，可能是老师刚进入测评登记；客户端可显示“已进入测评”，不据此显示测评结果已完成或报告已发出。结果是否可读继续以已发送报告的原接口为准。

申请命令为 `{ action: "request", id, participantId, teacherId, parentTimeOptions }`。客户端提交稳定 UUID `id`，它成功后成为邀约 ID；Web 端使用 `@/lib/uuid` 的 `newId()`，原生端使用平台 UUID 能力。数据库把初始调用者和规范化输入保留在既有邀约行的不可变 metadata 中：同一调用者使用相同 ID 和相同输入重试会返回同一邀约的当前投影，即使学服已修改其安排；相同 ID 改变输入返回 `CONFLICT`。新申请只提交家长意向和真实教师，状态由数据库确定。

确认命令为 `{ action: "confirm", id, participantId, timeOption, expectedUpdatedAt }`，其中 `id` 为邀约 UUID、`expectedUpdatedAt` 原样使用最近读取的值。数据库锁定邀约并重新检查版本、教师及双边未来精确交集；`after_school` 继续保留为意向，不能确定预约。已确认同一时段的重试返回同一邀约，即使当前时刻已超过预约时间；变更时段或过期版本返回 `CONFLICT`。申请和确认都返回单个 `ParentAssessmentRequest`，不代表测评已完成或报告已发出。

错误沿用 `{ "code": "..." }`：输入无效为 `VALIDATION` / 400，登录缺失为 `UNAUTHENTICATED` / 401，账号安全门或参与人授权失败为 `ACCOUNT_SECURITY` / `FORBIDDEN` / 403，不存在或不可见的邀约为 `NOT_FOUND` / 404。申请资格变化、时段变化、版本冲突和 `IDEMPOTENCY_CONFLICT` 对外统一为 `CONFLICT` / 409；RPC 缺失或不可用为 `UNAVAILABLE` / 503。冲突或网络结果不明时先刷新 overview 核对当前事实，保留原申请 ID；重试沿用原始输入，不换 ID 自动重复提交。

OpenAPI 使用相对 server URL，各端本地配置选择 origin。`node scripts/sync-parent-contract.mjs` 生成微信 DTO 副本；接口变化时同步实际使用的 DTO。后端配置与本机验收步骤见[小程序业务配置说明](../../apps/parent-wechat/docs/portal.md)。
