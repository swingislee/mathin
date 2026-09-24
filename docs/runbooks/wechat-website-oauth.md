# 微信网站应用 OAuth 与已有账号绑定

> 2026-09-24 开发实现。用户已确认：首次扫码为游客，只浏览公开内容并绑定已有账号；游客不创建独立 Auth 用户，不保存笔记或成绩。本文件不表示生产已启用。

> **2026-09-25 当前检查结果**：定向源码测试、TypeScript、受影响文件 ESLint、双语消息一致性已通过；zh/en 登录页可访问，微信入口保持关闭。Docker 已恢复，SQL 的权限、RLS、绑定唯一性、审计与完整事务回滚检查通过。微信迁移已在本机持久应用并生成增量类型。原生兼容补丁回归，以及 Supabase SDK 的邮箱／纯手机号绑定、再次登录原账号、冲突、停用、MFA、解绑和未知身份拒绝注册通过；候选 Auth 镜像与 previous 镜像的临时只读启动检查通过。实际 Next.js HTTPS 路由与原生 Auth 的隔离联调通过，REST 和微信上游使用协议替身。仍待选定部署环境的完整配置联调及真实微信扫码验收。开发端 UI 待人工验收，没有生产写入。

> **类型状态**：`20260925001000_wechat_oauth_tickets.sql` 已进入正式迁移目录，并在本机隔离库登记账本。四张表、四个 RPC 的类型从该数据库实际生成，通过定向合并保留其它功能定义；`db:types:check` 与 TypeScript 通过。全量生成器还会改变既有统计 view 的关系及可写类型，这部分漂移保留给原功能处理，本次只合并微信新增项。

> **2026-09-24 登录界面更新**：密码与微信入口共用一张登录卡。邮箱、手机号用页签选择；微信只显示按钮，尚未满足启用条件时保留禁用状态。站内主动登录通过统一 `LoginLink` 打开 Dialog，失败留在卡片内，成功刷新原页面或进入显式绑定目标；直接访问及受限路由跳转仍使用完整登录页。微信 OAuth 本身继续通过外部授权回调完成，同源 Cookie、账号绑定和角色规则保持原合同。此更新不表示微信已开放。开发验收入口为 `/zh/` 导航菜单的「登录」与 `/zh/login`（英文对应 `/en/`、`/en/login`）。

## 开放平台填写项

| 项目 | 值 |
| --- | --- |
| 截图中的授权回调域 | `mathin.club`，填写域名，不填写协议、端口或路径 |
| 微信网站应用 redirect_uri | `https://mathin.club/zh/auth/wechat/callback` |
| Supabase 完成会话后的应用回调 | `https://mathin.club/zh/auth/callback?wechat=1`、`https://mathin.club/en/auth/callback?wechat=1` |
| 微信 scope | `snsapi_login` |
| Supabase provider | `custom:wechat` |

上述微信回调由 Next.js 处理微信 code，随后桥接到 Supabase。微信 code 与 Supabase code 属于不同协议步骤，分别消费。开放平台填写 `mathin.club`，不是 `supabase.mathin.club`。正式回调只有在本增量获准部署、配置和联调后才可用；现有域名不代表新路由已上线。

2026-09-25 用户已提交网站应用审核，提交成功页提示审核后取得 AppID/AppSecret；服务端尚未配置凭据。只读 HTTP 核查：生产首页跳转至中文页，`/zh/login` 返回 200，微信 callback 路由返回 404。因此当前是“已有可访问网站、网站应用审核中、微信后端尚未部署”。可以在审核期间先准备并部署保持入口关闭的回调版本，获得凭据后完成授权联调再开放按钮；该部署仍须按生产流程单独验收和授权。提交成功本身不代表审核通过。

开发页面仍使用 `http://192.168.5.213:3130/zh/login`。局域网 HTTP 不承接真实微信回调：本实现的 OAuth 凭据 Cookie 使用 Secure。开发扫码需要另行登记的 HTTPS 开发域、独立应用/授权域和与之匹配的隔离 Supabase；同一浏览器的开始、微信回调和应用回调需同源。开发域不能连接生产 Auth 或数据库。

## 用户与业务身份

1. **已有绑定的微信登录**：微信确认 → 服务端校验身份 → Supabase 正常 OAuth + PKCE → 原 UUID → 原有改密、同意、MFA、锁定与 RLS 门禁。
2. **首次微信登录**：微信确认 → 短期游客凭据 → 游客页。页面只提供公开浏览、登录已有账号和退出；不读取课程、班级、课表、家庭、员工或学生数据，不生成 Supabase 会话。
3. **游客绑定原账号**：输入原邮箱/手机号和密码登录 → 账号中心「登录方式」→ 核对待绑定微信 → 再次验证密码并明确确认。原账号已启用 MFA 时继续要求 AAL2。14 分钟内复用同一浏览器的微信证明，过期后重新扫码。
4. **原账号主动绑定**：先登录原账号 → 账号中心「登录方式」→ 验证密码、确认绑定 → 扫码。回调同时校验发起用户和发起 Supabase session_id，切换账号/会话后旧流程失败。
5. **解绑**：证明原账号密码、满足 MFA、保留真实 email/phone identity 后，通过 Supabase 原生 API 解绑。清除微信资料快照，并撤销其他设备的刷新会话；已签发 access token 仍受现有到期时间和 RLS 约束。

游客是授权流程中的访问状态，不是新增的业务角色。`student | parent | staff | admin` 与 staff 岗位保持现有合同。新游客无法自行选择角色，也无法凭昵称或微信资料获得课程权限；管理员通过现有建档和邀请流程建立账号及员工、监护人或学生关系，再由本人登录绑定微信。原来已获准使用的账号保留原岗位和家庭关系，绑定微信不会重复发放权限。

同一员工也可能是家长，继续使用已有的 staff/family/learning 环境切换。微信身份只回答“是谁”，环境和 RLS 决定“能看什么”。家长绑定自己的微信，不把家长和孩子混成一个账号；多子女来自监护关系，多位监护人各有自己的账号。

## 微信实际提供的资料

2026-09-24 直接核对官方当前页面：

- [网站应用登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)：网站应用及微信登录权限需审核通过；网页请求 `snsapi_login`。code 一次性、10 分钟有效。支持扫码，也支持符合版本条件的 Windows/Mac 微信本机确认。
- [用户资料与 UnionID](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Authorized_Interface_Calling_UnionID.html)：返回 OpenID、UnionID、昵称、头像等；**没有手机号字段**。该页明确说明性别和地区已停止返回，旧 JSON 示例中的相关字段不构成可用性保证。
- [小程序手机号](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)：手机号授权是另一项能力，需要相应主体、认证和接口权限。以后接入时使用独立的手机号 code、主动同意和同一绑定事务；它不是网站 OAuth 的参数，也不能当作按号码自动合并账号的依据。

身份主键固定为 `<开放平台命名空间>:<UnionID>`，缺失 UnionID 时失败重试，不回退 OpenID。网站与将来的小程序使用同一开放平台和命名空间；跨不同开放平台的标识不相互等价，迁移需单列映射方案。

保存授权来源需要的 OpenID、UnionID、昵称、头像 URL 和授权时间；不保存微信 access_token/refresh_token、密码、性别或地区。已登录账号的快照仅本人和受信服务端可读。昵称/头像用于展示微信登录方式，不覆盖自己编辑的个人资料、员工姓名或学生档案。

头像只接受两个官方头像域的 HTTPS URL，使用受限 Next Image 代理。每次登录刷新微信快照；微信头像 URL 可能失效，不能当作永久头像素材。将来提供“采用微信头像”时应单独确认并经过现有上传、格式处理和私有信息清除流程。

## 服务端组成与安全边界

- `src/features/wechat/provider.ts`：固定微信主机、超时、响应大小、OpenID/UnionID 一致性、最小 claims。微信接口要求 query 中带凭据，因此实际请求使用 `node:https`，不经过 Next fetch URL 调试输出。
- `src/features/wechat/broker.ts`：授权、微信回调、token、userinfo；固定 client 与回调地址，S256 PKCE、浏览器关联和单次消费。
- `src/features/wechat/actions.ts`：登录/绑定/解绑。Server Action 同源保护、密码复核、MFA 和受控 redirect。
- `src/app/[locale]/auth/callback/route.ts`：检查 Supabase code 交换结果、最终 UUID 和微信 subject。其他原有邮箱/恢复回调继续工作，失败时不再假装登录成功。
- `wechat_oauth_tickets`：service-role-only，凭据只存 SHA-256；一般 10 分钟、游客 14 分钟、grant/access 60 秒、完成回执 3 分钟。数据库 `DELETE ... RETURNING` 保证原子单次消费，重启或多实例仍有效。
- `wechat_oauth_rate_limits`：每来源 10 分钟最多 20 次开始、每账号 8 次敏感密码验证；只存 HMAC，不保存原始 IP，过期清理。
- `auth.identities`：绑定关系权威。部分唯一索引防止并发给同一账号绑定多个微信；微信已属于另一 UUID 时拒绝，保留双方资料。
- `wechat_binding_audits`：与原生 identity 插入/删除同事务记录不可变审计，冲突由受信服务端记录；不存原始微信标识。
- `wechat_profile_snapshots`：展示快照。写入前锁住对应 identity，与解绑串行化，避免旧回调重新写入已解绑资料。

未知微信不会到达 Supabase 创建用户分支；即使直接调用 Auth provider 入口，也需要本应用发起的短期流程和 Cookie。没有 `createUser()`、假邮箱、自动账号合并、直接写入 auth identity 或自行签发 Supabase JWT 的旁路。保留现有邀请注册触发器与关闭自助 OAuth 新用户的边界。

## 接入配置

应用服务端变量见 `.env.example`：

- `WECHAT_WEB_APP_ID` / `WECHAT_WEB_APP_SECRET`：网站应用凭据，不使用小程序 AppID。
- `WECHAT_OPEN_PLATFORM_NAMESPACE=mathin`：固定跨应用身份命名空间，启用后保持稳定。
- `WECHAT_SITE_ORIGIN=https://mathin.club`。
- `NEXT_PUBLIC_SITE_URL` 与 `WECHAT_SITE_ORIGIN` 使用同一公开站点源，避免最终回调跳到不同域。
- `WECHAT_SUPABASE_PUBLIC_ORIGIN=https://supabase.mathin.club`：必须与 SDK 使用的公开 Auth 源一致。
- `WECHAT_BROKER_CLIENT_SECRET`：独立高熵随机值，与 Supabase provider 配置相同。
- `WECHAT_OAUTH_ENABLED`：默认 false。
- `WECHAT_AUTH_COMPATIBILITY_VERIFIED`：默认 false；只有当前版本完整两段 PKCE、原 UUID 绑定、回调、MFA 等验证通过后才开启。
- `WECHAT_PHONE_LINKING_VERIFIED`：默认 false；纯手机号兼容修复实测后才开启。

Supabase custom OAuth2 provider 参数：

| 参数 | 值 |
| --- | --- |
| identifier / provider_type | `custom:wechat` / `oauth2` |
| client_id | `mathin-wechat` |
| client_secret | 环境中的 `WECHAT_BROKER_CLIENT_SECRET` |
| authorization_url | `https://mathin.club/zh/auth/wechat/authorize` |
| token_url | `https://mathin.club/zh/auth/wechat/token` |
| userinfo_url | `https://mathin.club/zh/auth/wechat/userinfo` |
| scopes | `[]` |
| email_optional | `true` |
| pkce_enabled | `true` |
| enabled | 配置时先 false；按验证次序启用 |

Auth 需要 `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true`，应用回调加入严格 redirect allowlist。不为微信打开公众自由注册。不要将微信官方三个 URL 直接填入 custom provider：微信的 token 参数、GET 方法和 userinfo OpenID 与标准接口不同，需要这里的桥接。

代理需覆盖 `X-Real-IP`，应用端口只接受受信代理的连接；不能把客户端自报 IP 当真实来源。授权相关路径的访问日志只记录不含 query 的路径，不记录 Authorization、Cookie、请求体或 provider 完整 URL。服务端和代理都返回/保留 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`。

迁移在存在 pg_cron 时注册每分钟清理任务；没有 pg_cron 时，使用现有 Worker 的专用 scope：在受控服务配置中设置 `R1_JOB_SCOPE=wechat_oauth`，运行 `node scripts/r1-job-worker.mjs`。它每分钟调用 `prune_wechat_oauth_tickets()`，同时清除过期票据和限流记录，仅用 HEAD 计数检查超期两分钟的游客资料是否残留，并记录 Worker 心跳。该 scope 不领取业务队列、不清除账号、绑定快照或审计；`all` 和 `web_push` 的处理范围保持原样。

成功日志仅含 `wechat_oauth.maintenance_ok`；RPC、监测失败或超期残留会以固定错误码退出。部署时为服务设置稳定的 `R1_JOB_WORKER_ID`、失败重启策略，并将进程退出与心跳超过三分钟纳入监测。一次性检查设置 `R1_JOB_ONCE=1`，运行前仍须核对目标与对应写入授权。选择 pg_cron 或专用 Worker 作为清理调度者，部署后核查连续运行与心跳；关闭微信入口回退时继续保留清理任务。本机已完成代码和事务检查，尚未启动常驻清理 Worker。微信域名及 Supabase API 回调等正常 OAuth URL 会包含短期 code/state，应纳入日志脱敏和访问控制。

## 纯手机号兼容门

本机此前审查的 GoTrue 为 `v2.189.0`。2026-09-24 核对 [upstream PR #2645](https://github.com/supabase/auth/pull/2645)，仍为 Open。当前无邮箱手动绑定可能错误进入邮件确认路径；不能把该 PR 视为已发布修复。

候选修复位置：[v2.189.0 identity.go](https://github.com/supabase/auth/blob/v2.189.0/internal/api/identity.go)。`UpdateUserEmailFromIdentities()` 之后，只有 `targetUser.GetEmail() != ""` 时才执行邮箱确认及 `Confirm()`。保留原来的匿名转正和 provider 更新逻辑。可采用包含相同修复的正式 Auth 版本，或在固定版本上应用可追溯的最小补丁；变更 Auth 镜像单独验证和保留 previous。

2026-09-25 已将候选保存为 [`v2.189.0-phone-only.patch`](../../supabase/auth-compat/v2.189.0-phone-only.patch)，固定到上游 commit `4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a`。本机真实数据库事务中，原版复现两条无邮箱路径失败；补丁版五项通过，包括原 UUID／密码／手机号保持、identity 归属、重复绑定和邮箱确认语义。每个用例全部回滚，固定身份记录指纹恢复；没有更换正在运行的 Auth 镜像。复现步骤与验证边界见 [Auth 兼容说明](../../supabase/auth-compat/README.md)。

随后使用仓库 Supabase SDK 与真实 Auth HTTPS handler 完成邮箱和 +86 纯手机号的绑定／登录／解绑闭环，并验证两段 PKCE、回调重放、跨账号冲突、停用与未知身份注册拒绝，MFA factor 和 AAL2 要求保留。SDK fixture 的所有数据库请求位于回滚事务，结束后账号内容及会话／身份计数恢复。候选镜像 `mathin/gotrue:v2.189.0-wechat.1` 已构建并进行候选／previous 启动检查；这些检查仍不替代实际站点 Cookie、代理、微信上游及真实身份的最终验收。

`node scripts/wechat-next-local.mjs` 在 loopback HTTPS 上运行实际 Next.js 路由和 SSR SDK，连接原生 Auth 的回滚事务。已覆盖中文邮箱／英文手机号两条游客扫码→原密码登录→复用游客证明绑定→微信再次登录原 UUID，以及 Secure／HttpOnly／SameSite Cookie、代理回调源、两段 PKCE、跨浏览器拒绝、会话切换拒绝、完成回执重放拒绝、资料快照和临时 Cookie 清除。独立 Next 应用只复制当前任务源文件，不改主开发服务配置；测试结束关闭两个临时服务并核对账号内容与会话计数恢复。微信上游和票据 REST 是隔离替身，数据库权限与清理由 SQL 事务检查单独覆盖；尚不代表真实微信扫码或部署环境验收。记录及私有日志保存在 `.tmp/wechat-next/`。

纯手机号账号必须实测：无伪造邮箱、绑定前后 user/profile 数量与 UUID 不变、phone/password 仍可登录、微信再次登录回到原 UUID、冲突不留残余 identity、原有验证码/邮箱确认语义不变。通过后才将 `WECHAT_PHONE_LINKING_VERIFIED` 设为 true。未通过时页面明确提示该限制。

## 验证、上线与回退

定向源码测试覆盖微信协议、最小资料、PKCE、未知微信游客、单次消费、会话切换、身份冲突、锁定、密码/MFA 门、最后登录方式保护和两段回调。

数据库迁移为 `supabase/migrations/20260925001000_wechat_oauth_tickets.sql`，已在本机隔离数据库持久应用并进入 ledger；生产未应用。SQL 断言位于 `supabase/tests/wechat_oauth_assertions.sql`。2026-09-25 在核对主机、实际 origin、监听、隔离网络和指纹后，已完成 `BEGIN → 候选 SQL → assertions → ROLLBACK`：权限、RLS、单次消费、过期、限流、身份唯一性、快照归属及解绑清除、不可变审计均通过，原函数／relation 权限与账号计数恢复。实测发现并修复了数据库默认权限赋予 `service_role` 多余权限的问题：四张新表先撤销默认权限，再逐项授予所需操作。事务验证后另行保存 schema 备份并应用加法迁移，四张新表为空，已有 user／profile／identity 计数保持不变。

数据库检查可通过 `node scripts/wechat-oauth-local.mjs --preflight` 与 `--check` 复现；`--apply` 只接受同一目标、相同文件摘要且一小时内的成功检查，写前保存 schema 备份。应用后使用 `node scripts/wechat-oauth-types.mjs` 生成微信类型。输出只含状态与摘要，原始日志保留在 `.tmp/wechat-oauth-local/`。本机迁移与类型已完成，后续继续固定账号的 Auth 集成与回退验证；生产部署另行记录。

开发检查入口：

```text
pnpm test -- tests/wechat-provider.test.ts tests/wechat-broker.test.ts tests/wechat-actions.test.ts tests/wechat-callback.test.ts tests/auth-return-origin.test.ts tests/auth-safe-redirect.test.ts tests/r1-live-auth-identities.test.ts tests/r1-account-security.test.ts
pnpm typecheck
pnpm messages:check
```

上线前仍需：

1. 网站应用及登录权限审核通过；真实凭据通过服务端私有配置交付，不写进任务消息或 Git。
2. 对照 `r1-write-target-policy.md` 完成生产只读 preflight、当前备份和本次精确部署授权。
3. 在开发目标用固定账号和 mock provider 验证邮箱/纯手机号/MFA/锁定/冲突/回放/并发/双语回调/原密码登录，验证生产未知微信不会创建 auth user/profile。
4. 部署迁移及 Auth 兼容修复、注册 provider，核对两段 PKCE、精确 callback allowlist、代理 IP 和日志脱敏、定时清理。入口保持关闭直到联调通过。
5. 使用获准的正式身份完成真实微信扫码与绑定人工验收，不创建一次性生产测试账号。只有本次明确部署授权后才能修改生产。

回退顺序：先关闭 `WECHAT_OAUTH_ENABLED` 与 custom provider 的新授权，再回切应用/Auth previous。已绑定的微信 identity、原账号和审计保留；邮箱/手机号密码仍可使用。关闭新授权不删除任何 identity，不回退已发生的业务事实。加法迁移可留在库内，过期清理继续运行。具体 Auth 镜像回退兼容性在启用前验证。

后续产品问题按独立增量处理：微信授权撤销后的通知/会话策略、真正的短信/邮箱验证、经用户同意采用微信头像、具名的一次性角色邀请、管理员辅助恢复和手机号回收、跨开放平台迁移。每一项保持双重归属证明、最小资料和管理员业务授权边界。
