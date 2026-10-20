# 微信登录配置

本页维护现行接入方法，启用与人工验收事实见 [当前状态](../current.md)。修改生产配置、Auth 或服务前，按 [数据操作](data-operations.md) 完成本次授权和只读目标识别；部署方法见 [发布](deployment.md)。真实 AppID、密钥与 Token 使用私有环境配置。

## 身份与开户规则

登录只确认“这是哪个账号”。工作台、我的孩子等入口在登录后按账号已有的关系显示，同一账号可以同时拥有；登录前不询问也不推断员工、家长或学生身份。

| 入口 | 能证明 | 结果 |
| --- | --- | --- |
| 网站扫码、手机微信内网页 | 微信身份（UnionID），不含手机号 | 已关联直接进入；未关联进入“未关联微信”页 |
| 账号密码 | 原账号归属 | 进入账号，可在“账号安全”关联微信 |
| 小程序 | 微信身份，以及用户主动授权、由微信验证的手机号 | 已关联直接进入；新家长授权手机号后开户 |

- 开户只在小程序进行，包括推广码。微信验证的手机号承担防批量注册的验证；网页不开放注册，接入短信验证码后再评估。
- 员工账号只由管理员建立，扫码不会产生员工账号。员工首次用账号密码（及必要的 MFA）关联微信，之后网站、公众号和小程序都按同一 UnionID 直接登录。
- 家长不存在预先建立的账号，只有开户和关联孩子两步。孩子档案的关联在登录之后办理，登录前不展示姓名、孩子或角色候选。
- 小程序先浏览；只有用户主动点击登录或登记，才进入手机号授权与家长登记。
- 未关联的微信仍是游客，可以浏览公开内容。“未关联微信”页提供三项：小程序码接力开户、员工账号密码登录后关联、先浏览。

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
4. 按本次授权部署并加载配置后开启公众号开关，完成手机微信内中英文登录与原账号主动绑定；电脑扫码继续可用。同一微信通过两条渠道回到同一 UUID，未关联的微信进入“未关联微信”页。

单独关闭公众号可将 `WECHAT_OFFICIAL_ACCOUNT_ENABLED=false` 后按已授权流程加载配置，网站扫码与密码登录继续使用。小程序使用独立凭据和自身接入流程，不把网站或公众号 AppID 当作小程序 AppID。

## 启用检查、清理与关闭

启用或更换 Auth、回调及代理配置属于身份安全变更，按实际变更核对两段 PKCE、Cookie、精确回调地址、原账号 UUID、密码登录、MFA、锁定和冲突处理；已有可信且版本匹配的结果可复用。纯手机号无邮箱绑定保持原 UUID、密码与手机号，微信再次登录回到原账号。真实扫码及绑定由获准的本人完成，机器检查不代替人工验收。

未知微信只获得短期游客证明，已有账号通过密码复核和必要的 MFA 明确绑定；微信身份不自动创建正式账号、合并账号或赋予学校权限。网站和公众号按稳定的 `<命名空间>:<UnionID>` 关联身份，缺少 UnionID 时拒绝登录。

管理员通过已绑定微信完成网站扫码或公众号授权后，当前会话可直接进入后台，无需再次输入 MFA。服务端回调核对本次微信身份、账号归属及原生会话后，将限定站点与会话的签名证明保存在 `wechat_trusted_sessions`；后台只读取本人当前会话的证明，同时核对签名、会话存活与微信仍然绑定。关闭微信后恢复同一登录会话时，可从服务端恢复证明。证明最长 30 天，不改变原生 AAL 或 MFA 因子；密码重登、退出、解绑、证明到期或密钥轮换后不能沿用。首次绑定仍按原有密码和 MFA 条件核验；密码登录的管理员仍须 MFA。

部署时先应用 `20261021002000_wechat_trusted_sessions.sql`，再更新应用。旧版本签发的有效 Cookie 经完整校验后迁移到服务端，沿用原到期时间；证明已经丢失的旧会话需重新完成一次微信登录。新版本仍签发兼容 Cookie，应用可回退到旧版本，新表可保留；迁移不修改已有 Auth 会话、MFA 因子或账号资料。

网站登录页和浮窗直接显示手机号／邮箱密码表单；微信登录在表单下方同屏提供，不需要切换登录方式页签。“未关联微信”页按[身份与开户规则](#身份与开户规则)提供三项：启用家庭开户时展示进入小程序“我的”的小程序码（`WECHAT_MINIPROGRAM_ENTRY_CODE_ENV` 选择 release／trial／develop，默认 release；生成失败时改为文字说明），家长在小程序开户后点击“已完成，重新微信登录”回到同一账号；员工的“账号密码登录”登录后进入“账号安全”关联微信；以及先浏览。页面显示的微信昵称不代表已识别出任何身份。网站扫码不提供手机号，也不按同手机号自动认领账号；原手机号或邮箱加密码用于验证账号归属。账号安全中的每次绑定都重新发起微信授权（电脑端扫码），不复用之前的游客证明；回调继续验证当前会话、账号 UUID 和本次微信身份。

在已授权的部署目标选择 `pg_cron` 或专用 Worker 清理过期票据。使用 Worker 时设置 `R1_JOB_SCOPE=wechat_oauth` 与稳定的 `R1_JOB_WORKER_ID`，运行 `node scripts/r1-job-worker.mjs`；仅需要一次检查时设置 `R1_JOB_ONCE=1`。该 scope 每分钟清理过期票据与限流记录，保留账号、绑定快照和审计；核对失败重启及心跳监测。调用前同样识别实际目标与写入范围。

关闭新授权时先关闭 `WECHAT_OAUTH_ENABLED` 与 provider；需要回切应用或 Auth 时按本次问题选择 previous，并核对兼容性。保留已绑定 identity、原账号、业务事实、审计与过期清理，原有密码登录继续可用。备份与恢复措施按 [操作规则](../agent/operations.md) 的具体风险决定。

## 小程序家庭开户与推广码

已绑定微信的账号通过真实微信 code 兑换、身份归属与账号状态核对后，可直接登录小程序并完成首次登记，无需重复输入账号的 MFA 验证码。沿用原生 Auth 会话的实际 assurance level，不修改 MFA 因子或伪造 AAL2。首次绑定、临时开户绑定、账号锁定与归属冲突继续校验；网站后台的 MFA 策略单独执行。

首次进入为微信登录、主动授权手机号、填写家庭与孩子信息、建立正式家长账号，然后进入发现。用户选择年级后预设发现页阶段；兴趣、学校、监护关系、性别和本次获准的 GCJ-02 定位保存在登记记录。拒绝定位保留明确状态。手机号只接受微信服务端兑换结果，短期开户凭据只放内存，不通过 URL 或本地缓存传递。

后台 `/zh/dashboard/promotions` 使用 `registration.invite.manage` 权限建立兼职专属小程序码。按已验证家庭手机号核对系统及历史获客；首次归属固定，换孩子姓名、再次扫码或换兼职均不重新计为新增。已有账号需要完成安全绑定；历史学生资料由工作人员核对，开户不自动合并历史学员。

本流程复用 `miniapp_forms` 和 `miniapp_intakes`，迁移为 `20261008110000_miniapp_family_onboarding.sql`。新家长只获得自己新登记孩子的活动权限。后续学习与其他权限继续通过现有明确授权流程办理。清理过期 OAuth 票据不清理正式家庭、学生、获客或推广来源记录。

启用前在私有环境核对：

1. 小程序使用自己的 `WECHAT_MINIPROGRAM_APP_ID` / `WECHAT_MINIPROGRAM_APP_SECRET`，绑定到与网站应用一致的微信开放平台身份体系，保持 namespace 不变。
2. 按上文完成 Supabase `custom:wechat`、原生身份绑定及纯手机号登录兼容联调，再启用 `WECHAT_MINIPROGRAM_ENABLED`、`WECHAT_AUTH_COMPATIBILITY_VERIFIED`、`WECHAT_PHONE_LINKING_VERIFIED`。服务端出口需要访问微信接口。
3. 在小程序管理平台核对认证状态、手机号能力与位置接口使用声明、隐私保护指引、HTTPS 服务器合法域名；管局备案通过并不能代替这些接入条件。能力资格和额度以该账号后台显示为准。
4. 开启 `WECHAT_FAMILY_ONBOARDING_ENABLED` 前在体验版真实手机核对首次开户、定位拒绝、已有账号登录、不同兼职重复扫码及发现页阶段。后台可选择开发版、体验版、正式版小程序码；真实码从微信接口生成。
5. 按本次授权部署服务端和迁移，再上传小程序、提交平台审核、发布。生产写入和正式发布另按具体任务授权办理。

停用新增开户时只关闭 `WECHAT_FAMILY_ONBOARDING_ENABLED`；保留已建账号及重复获客记录。某兼职停用时，在推广面板停用其码；历史统计继续保留。
