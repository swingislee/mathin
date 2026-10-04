# 微信登录配置

本页维护现行接入方法，启用与人工验收事实见 [当前状态](../current.md)。修改生产配置、Auth 或服务前，按 [数据操作](data-operations.md) 完成本次授权和只读目标识别；部署方法见 [发布](deployment.md)。真实 AppID、密钥与 Token 使用私有环境配置。

## 网站扫码与应用环境

1. 在微信开放平台确认网站应用及微信登录权限可用，将授权回调域设为 `mathin.club`，填写域名本身。网站微信回调为 `https://mathin.club/zh/auth/wechat/callback`，scope 使用 `snsapi_login`。
2. 按下表填写应用服务端配置。首次接入先保持相关开关为 `false`，完成当前版本与实际配置的对应验证后再启用。

| 环境变量 | 配置方法 |
| --- | --- |
| `WECHAT_WEB_APP_ID` / `WECHAT_WEB_APP_SECRET` | 网站应用自己的凭据 |
| `WECHAT_OPEN_PLATFORM_NAMESPACE` | 固定命名空间 `mathin`；网站、公众号与小程序共用，已启用身份保持稳定 |
| `WECHAT_SITE_ORIGIN` / `NEXT_PUBLIC_SITE_URL` | 同一站点源 `https://mathin.club` |
| `WECHAT_SUPABASE_PUBLIC_ORIGIN` | `https://supabase.mathin.club`，与 SDK 的公开 Auth 源一致 |
| `WECHAT_BROKER_CLIENT_SECRET` | 独立高熵密钥，与下方 provider 的 `client_secret` 一致，不复用 AppSecret |
| `WECHAT_AUTH_COMPATIBILITY_VERIFIED` | 当前 Auth、两段 PKCE、原 UUID 绑定、回调与 MFA 验证通过后设为 `true` |
| `WECHAT_PHONE_LINKING_VERIFIED` | 纯手机号无邮箱的绑定与再次登录兼容性验证通过后设为 `true` |
| `WECHAT_OAUTH_ENABLED` | 网站微信入口开关；接入条件满足且本次启用获授权后设为 `true` |

变量模板见 [`.env.example`](../../.env.example)。局域网 HTTP 开发页可查看界面；真实 OAuth 使用 Secure Cookie，需要单独登记的 HTTPS 开发域、对应应用凭据与隔离 Supabase，开始、微信回调和应用回调保持同源。开发域不连接生产 Auth 或数据库。

## Supabase Auth 桥接

配置 custom OAuth2 provider，让 Auth 连接本站桥接器；微信上游协议由应用处理。

| 参数 | 值 |
| --- | --- |
| `identifier` / `provider_type` | `custom:wechat` / `oauth2` |
| `client_id` | `mathin-wechat` |
| `client_secret` | 私有环境中的 `WECHAT_BROKER_CLIENT_SECRET` |
| `authorization_url` | `https://mathin.club/zh/auth/wechat/authorize` |
| `token_url` | `https://mathin.club/zh/auth/wechat/token` |
| `userinfo_url` | `https://mathin.club/zh/auth/wechat/userinfo` |
| `scopes` / `email_optional` / `pkce_enabled` | `[]` / `true` / `true` |
| `enabled` | 首次配置为 `false`，验证接通后按本次授权启用 |

Auth 设置 `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true`，严格 redirect allowlist 包含 `https://mathin.club/zh/auth/callback?wechat=1` 与 `https://mathin.club/en/auth/callback?wechat=1`。保持公众自由注册关闭。固定 Auth 版本的纯手机号修复与复现方法见 [Auth 兼容说明](../../supabase/auth-compat/README.md)。

代理覆盖 `X-Real-IP`，应用端口只接受受信代理连接。授权路径日志只保留不含 query 的路径，不记录 Authorization、Cookie、请求体或 provider 完整 URL；应用和代理保留 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`。

## 微信内公众号授权

1. 在公众号后台确认具有网页授权权限 `snsapi_userinfo`，将公众号绑定到网站应用所属的同一开放平台。网站应用权限不代替公众号权限。
2. 在公众号后台将网页授权域名设为 `mathin.club`，按要求在域名根目录提供 `MP_verify_*.txt` 并完成域名验证。微信回调仍为 `https://mathin.club/zh/auth/wechat/callback`。
3. 在私有配置填写公众号自己的 `WECHAT_OFFICIAL_ACCOUNT_APP_ID` / `WECHAT_OFFICIAL_ACCOUNT_APP_SECRET`，核对与网站应用共享的命名空间，先保持 `WECHAT_OFFICIAL_ACCOUNT_ENABLED=false`。
4. 按本次授权部署并加载配置后开启公众号开关，完成手机微信内中英文登录与原账号主动绑定；电脑扫码继续可用。同一微信通过两条渠道回到同一 UUID，未知微信进入游客页。

单独关闭公众号可将 `WECHAT_OFFICIAL_ACCOUNT_ENABLED=false` 后按已授权流程加载配置，网站扫码与密码登录继续使用。小程序使用独立凭据和自身接入流程，不把网站或公众号 AppID 当作小程序 AppID。

## 启用检查、清理与关闭

启用或更换 Auth、回调及代理配置属于身份安全变更，按实际变更核对两段 PKCE、Cookie、精确回调地址、原账号 UUID、密码登录、MFA、锁定和冲突处理；已有可信且版本匹配的结果可复用。纯手机号无邮箱绑定保持原 UUID、密码与手机号，微信再次登录回到原账号。真实扫码及绑定由获准的本人完成，机器检查不代替人工验收。

未知微信只获得短期游客证明，已有账号通过密码复核和必要的 MFA 明确绑定；微信身份不自动创建正式账号、合并账号或赋予学校权限。网站和公众号按稳定的 `<命名空间>:<UnionID>` 关联身份，缺少 UnionID 时拒绝登录。

在已授权的部署目标选择 `pg_cron` 或专用 Worker 清理过期票据。使用 Worker 时设置 `R1_JOB_SCOPE=wechat_oauth` 与稳定的 `R1_JOB_WORKER_ID`，运行 `node scripts/r1-job-worker.mjs`；仅需要一次检查时设置 `R1_JOB_ONCE=1`。该 scope 每分钟清理过期票据与限流记录，保留账号、绑定快照和审计；核对失败重启及心跳监测。调用前同样识别实际目标与写入范围。

关闭新授权时先关闭 `WECHAT_OAUTH_ENABLED` 与 provider；需要回切应用或 Auth 时按本次问题选择 previous，并核对兼容性。保留已绑定 identity、原账号、业务事实、审计与过期清理，原有密码登录继续可用。备份与恢复措施按 [操作规则](../agent/operations.md) 的具体风险决定。
