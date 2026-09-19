# 微信登录与手机号绑定接入审查

> 审查日期：2026-09-18。范围为仓库代码、本机 Auth 只读配置、微信官方文档及开源实现。
> 状态：审查完成，开发者资质认证待完成，功能尚未接入；真实微信授权、身份绑定及手机号写入尚未验证。
> 账号规则继续以 [单账号多登录身份合同](../plan/r1-live-auth-identities.md) 为准。本报告记录发现与实施建议，不改变当前阶段或生产状态。
> 2026-09-19 产品方向补充：小程序优先服务家长，首次核验和原账号绑定应在微信内完成；产品负责人确认实际授课主体尚无办学／培训资质。认证接入准备与真实业务准入分别核对，范围见[小程序业务审查](wechat-miniprogram-business-scope-2026-09-18.md)，不能以技术可用推定业务可以上线。

## 1. 结论

复用现有 Supabase Auth、账号中心和手机号规范化逻辑。微信作为原账号的一种登录身份，绑定前后保持同一个 `auth.users.id`、`profiles.id`，原岗位、家庭关系和业务数据继续引用原 UUID。

接入包含两种不同能力：

- 网站应用微信登录：取得微信身份；官方用户资料返回中没有手机号字段。较新 Windows / Mac 微信客户端还支持本机确认的快速登录，扫码是另一种入口。[网站登录文档](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)、[用户资料接口](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Authorized_Interface_Calling_UnionID.html)
- 小程序手机号授权：用户主动同意后，服务端用手机号专用 code 换取号码。它与 `wx.login` 的 code 不同；手机号 code 有效期为 5 分钟且只能消费一次。用户可以选择绑定号码，也可以添加其他号码，因此不能把结果描述成必定是“微信账号当前绑定的手机号”。[手机号快速验证组件](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)

产品负责人于 2026-09-18 更正：开放平台和小程序目前都只通过了企业主体审核，开发者资质认证尚未完成。此前的“审核通过”不再作为网站应用、微信登录或手机号接口权限已就绪的依据。小程序与开放平台的绑定是否完成也仍待确认；本次未读取 AppSecret。

接入准备分别核对：开放平台的开发者资质认证、网站应用审核与微信登录权限；小程序自身的微信认证与手机号接口权限；两个应用的同一开放平台绑定关系。网站登录官方文档要求网站应用和微信登录申请获批；手机号组件要求非个人主体且小程序已完成认证。具体认证项目及申请入口以对应后台显示为准，不能仅凭企业主体审核状态推定其他权限。[网站登录准备工作](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)、[手机号组件适用条件](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)

认证期间可以继续源码适配、上游修复评估及模拟 provider 的定向检查；真实微信授权和手机号联调在对应认证、应用审核及接口权限就绪后进行。单 UUID、先证明原账号归属再绑定的方案保持一致。

## 2. 接入前需要解决的四个问题

### 2.1 手机号账号绑定无邮箱 OAuth 身份存在上游缺陷

本机容器实际使用 `supabase/gotrue:v2.189.0`。该版本已有 custom OAuth/OIDC、`email_optional` 和 manual linking 的实现，不能以“没有自定义 provider 支持”为由直接升级整套 Supabase。

但该版本 `linkIdentityToUser()` 在目标账号没有邮箱时，更新邮箱后仍会根据 `EmailVerified=false` 进入邮件确认分支。微信不提供邮箱，已有纯手机号账号正好会触及这一分支。这是源码审查结论，本次未对开发账号实际执行绑定。

上游已有完全对应的 [issue #2640](https://github.com/supabase/auth/issues/2640) 和 [PR #2645](https://github.com/supabase/auth/pull/2645)。2026-09-18 经 GitHub API 核对，PR 为 `open`、`merged=false`，head 为 `087d3aeaeea0d77acdd3ef6d6d3ff8d8addf320c`；修改只有无邮箱分支及对应回归测试。

实施时优先复用并验证该修复：先检查是否已有包含修复的正式版本；若仍未合并，评估对固定 Auth 版本应用这一个可追溯补丁。验证纯手机号账号、邮箱账号、身份冲突、失败回滚和原登录方式后，再决定开发 Auth 镜像。不能把尚未合并的 PR 当作已发布能力，也不能以伪造邮箱或邮箱已验证标志绕过。

源码：[v2.189.0 identity.go](https://github.com/supabase/auth/blob/v2.189.0/internal/api/identity.go)、[custom OAuth provider](https://github.com/supabase/auth/blob/v2.189.0/internal/api/provider/custom_oauth.go)。

### 2.2 微信接口需要适配，普通 OAuth URL 配置不够

微信使用 `appid` / `secret`，通过专用 GET 请求换 token，读取用户资料还需要 `openid`。Supabase 通用 custom OAuth 实现使用标准 OAuth token exchange。这意味着不能直接填写三个微信 URL 就宣布兼容。

推荐保持 Supabase 为唯一应用认证主体，在微信与 Supabase 之间复用已有微信连接器／OIDC 身份代理。Supabase 接收标准协议，负责身份关联、会话、刷新和 RLS。微信到适配层的 state 校验，与 Supabase 到应用的 PKCE 都要保留。[Supabase custom OAuth/OIDC](https://supabase.com/docs/guides/auth/custom-oauth-providers)、[Logto 微信适配源码](https://github.com/logto-io/logto/blob/master/packages/connectors/connector-wechat-web/src/index.ts)

### 2.3 跨网站与小程序的身份键需要先统一

小程序绑定到同一开放平台后，按微信官方 UnionID 机制取得跨应用标识。不同 AppID 下的 OpenID 不能直接当成同一用户。[UnionID 官方说明](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/union-id.html)

本项目第一版可要求两个入口都有该开放平台下的 UnionID，生成固定、带开放平台命名空间的 subject；缺失时给出可重试错误。若以后需要兼容 OpenID，必须增加明确的别名迁移方案，不能简单使用 `unionid ?? openid` 后随返回字段变化切换身份键。采用第三方代理时同样核对其输出 `sub` 是否跨网站与小程序稳定。

### 2.4 取得号码不等于可以据此合并原账号

微信官方说明“手机号快速验证”不保证实时验证，另有实时验证组件。当前仓库的员工号码也可能只有邀请担保、尚未经短信验证。首次认领已有账号应使用原账号密码或已建立的恢复凭据；手机号用于经过授权的绑定与展示，不直接承担按号码猜测账号、迁移业务数据的功能。[微信组件说明](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)

## 3. 仓库中可复用和需要关注的文件

| 文件 | 已有实现 | 本次关注点 |
| --- | --- | --- |
| `docs/plan/r1-live-auth-identities.md` | 单 UUID、多 identity、首次手动绑定、冲突与解绑合同 | 继续复用；文档中的 custom provider 兼容待核查项已有本次源码与配置证据 |
| `src/lib/auth-identifier.ts` | 邮箱与 E.164 手机号规范化、zod 校验 | 复用，微信返回号码也进入同一规范化入口 |
| `src/app/[locale]/(auth)/actions.ts` | 邮箱／手机号密码登录、邀请注册 | 新增微信登录 intent；现有 `createUser()` 属于显式邀请注册，不能搬入微信回调 |
| `src/components/auth-form.tsx`、`src/app/[locale]/(auth)/login/page.tsx` | 统一登录表单 | 按真实 provider 能力展示微信入口和稳定错误 |
| `src/app/[locale]/auth/callback/route.ts` | Supabase code 换会话、安全返回路径 | 当前忽略 `exchangeCodeForSession()` 错误且总是跳转；需处理取消、过期、冲突及 login/link intent，不把微信原始 code 直接交给此函数 |
| `src/lib/safe-redirect.ts`、`src/lib/supabase/{client,server,config,admin}.ts` | 安全跳转、SSR Cookie、服务端管理 API | 保持现有会话链路；密钥留在服务端；外部回调地址与局域网验收地址分别配置 |
| `src/lib/auth.ts`、`src/proxy.ts` | 锁定、首次改密、同意、管理员 MFA 与 Cookie 刷新 | 微信会话继续经过同一授权边界，不绕开现有要求 |
| `src/features/account/AccountSecurityPanel.tsx` | 登录方式区、手机号／邮箱状态、禁用的微信／QQ占位 | 改为真实绑定状态与动作，复用现有账号中心 |
| `src/features/account/account-security.ts` | 账号中心快照、号码掩码和验证状态 | 扩展 OAuth identity DTO；读取 assurance 失败时保持未确认，避免按 Auth confirmed 时间误判已验证；号码更换后校对当前号码 hash |
| `src/features/account/actions.ts` | 本人资料与安全操作、支持审计 | 增加绑定流程的本人证明、冲突错误、结果审计；审查管理员与锁定账号边界 |
| `supabase/migrations/20260825000600_r1_live_phone_password_auth.sql` | `account_identifier_assurances`、邀请与手机号规则 | 通过新增兼容 migration 扩展微信手机号验证来源和时间；复用已有表，不另建账号表 |
| `supabase/migrations/20260902001000_staff_direct_provisioning.sql` | 最新 `handle_new_user()`、直接建档与初始密码要求 | 保留注册触发器的邀请与 profile 唯一性；绑定已有账号不应经过新用户触发器 |
| `supabase/migrations/20260728000400_r1_account_security.sql` | 不可变支持审计、安全快照和 RLS | 复用审计模式，按事件语义扩展绑定／解绑／冲突，避免把任意客户端元数据当审计依据 |
| `messages/{zh,en}.json`、`src/lib/database.types.ts` | 双语与版本化数据库类型 | 实施时补稳定状态与错误码；两份消息文件已有其他任务修改，按具体键合并 |
| `tests/r1-live-auth-identities.test.ts`、`tests/r1-account-security.test.ts`、`tests/auth-safe-redirect.test.ts` | 现有账号、登录与跳转合同 | 复用并补绑定与无隐式注册测试，不能只增加按钮快照 |

仓库未找到可运行的微信 OAuth／UnionID／小程序手机号实现，也没有小程序工程。`WechatStatusControl` 和相关业务字段表示学服“是否已加微信”，不是登录身份，不能当作微信认证绑定记录。

## 4. 本机只读核查

- Docker context 确认为本机 Docker Desktop；应用 Supabase origin 与本机映射端口一致。
- Auth 镜像 `v2.189.0`；安装的 `@supabase/auth-js` 为 `2.110.0`，客户端类型已支持 `custom:*` 与原生身份关联 API。
- `/auth/v1/admin/custom-providers` 返回 200，provider 列表为空，证明本机管理接口可读，但尚未配置微信适配器。
- 本机 `GOTRUE_DISABLE_SIGNUP=true`、phone provider 开启、`SMS_AUTOCONFIRM=false`、`MAILER_AUTOCONFIRM=false`。
- 未配置 manual linking 环境变量；该版本源码默认关闭。custom OAuth 开关源码默认开启，与“已有配置好的 provider”是两件事。
- 本机 Auth redirect allowlist 目前只有回环地址；开发授权域名及局域网回跳仍需明确配置。
- 本次没有查询生产运行配置；以上开关不代表生产事实。

OAuth 登录没有可以照搬 OTP 的 `shouldCreateUser:false` 开关。未绑定身份的零新增保证必须由 Auth 服务端落实。本机可复用关闭 signup 的配置；生产实施前需核对原邀请注册需求，必要时增加针对微信 provider 的创建拦截，不能直接照搬全局关闭注册而破坏现有流程。[v2.189.0 OAuth 创建分支](https://github.com/supabase/auth/blob/v2.189.0/internal/api/external.go)

## 5. 社区实现核查与选型

| 方案 | 可复用部分 | 结论 |
| --- | --- | --- |
| [Supabase manual identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking) | 已登录账号关联 identity、冲突处理、正式 Auth 会话 | 作为基础；先解决上游纯手机号兼容缺陷 |
| [Casdoor 微信 provider](https://github.com/casdoor/casdoor/blob/master/idp/wechat.go) 与[小程序示例](https://github.com/casdoor/casdoor-wechat-miniprogram-example) | 已有网站／小程序微信接入，以及标准身份代理能力 | 优先做兼容验证的完整代理候选；需核对跨入口 subject、部署成本和手机号授权接口，不能假定示例已经满足本项目绑定合同 |
| [Logto 微信网页连接器](https://github.com/logto-io/logto/tree/master/packages/connectors/connector-wechat-web) | TypeScript 微信参数、token／userinfo 获取、错误处理 | 网页侧适配参考／代理备选；仍需确认小程序和手机号能力；其连接器不能直接当 Supabase provider 安装 |
| [node-webot/wechat-oauth](https://github.com/node-webot/wechat-oauth) | 微信 OAuth HTTP 封装 | 只解决微信接口调用，不负责 Supabase 原 UUID 绑定与会话；不能当完整登录方案 |
| [vibeunion/supabase-mp-js](https://github.com/vibeunion/supabase-mp-js) | 小程序运行时适配官方 Supabase JS | 其登录示例用 OpenID 拼邮箱并调用 `createUser()`，不适合本项目；以后若小程序直接访问 Supabase，可单独评估运行时适配层 |

选型建议：保留 Supabase Auth，先验证现成身份代理能否用同一个微信 subject 支持网站与小程序，再确定一个适配器。只补 Mathin 的绑定意图、原账号证明、号码授权记录和错误反馈；不另建密码体系、不复制 Supabase SDK、不维护一个宽泛的 GoTrue 微信 fork。上游必要修复单独固定来源与回归证据。

## 6. 建议的实际用户流程

1. 原用户以现有手机号／邮箱密码登录，进入账号中心“登录方式”。
2. 发起“绑定微信”，服务端记录短期、一次性的绑定 intent，关联发起用户、会话和安全返回地址。敏感账号补近期凭据或 MFA。
3. 完成微信身份授权，将标准 provider identity 通过 Supabase manual linking 关联到原 UUID。回调核对结果用户与原 intent，处理重复提交和账号切换。
4. 手机号另由小程序授权取得。手机端确认与网页端完成绑定必须使用同一短期事务；不能把两个端点各自收到的 code 随意拼接。服务端独立消费登录 code／手机号 code，校对 AppID、有效期及本次事务。
5. 未绑定号码可在原账号上增加 phone identity；相同号码补来源与验证时间；不同号码进入显式更换；号码或微信已属于另一 UUID 时返回冲突并保留两边数据。授权号码不得自动覆盖业务档案联系方式。
6. 后续微信快速登录／扫码登录按已绑定 subject 回到原 UUID。陌生微信先显示“登录已有账号并绑定”，不创建 Supabase 用户。

手机号写入必须使用受信的 Auth API，并同步 assurance；普通 `updateUser({phone})` 的短信验证路径不能在未配置 SMS 时假装成功。具体 Admin API 更新、并发冲突和补偿流程需在隔离目标验证后固定，避免直接写 `auth.users`／`auth.identities`。

## 7. 实施顺序与验收

1. 完成并核对相应认证、网站应用审核与微信登录权限、小程序手机号权限，再固定两个 AppID、同一开放平台绑定关系、服务端密钥来源和开发授权域名；代码准备可与认证并行。
2. 对现成代理和 Auth 修复做最小兼容验证，覆盖已有纯手机号用户；满足单 UUID 合同后再定依赖与镜像。
3. 实现账号中心绑定微信、绑定手机号，再接登录页已绑定微信登录；按真实 provider 配置开放入口。
4. 以固定开发账号完成定向集成验收：绑定前后 UUID／profile 数不变，未知微信零新增，微信／号码占用冲突，过期／重放／会话切换拒绝，拒绝手机号授权可重试，原密码登录与刷新会话可用，锁定／MFA／RLS 行为保留。
5. 绑定流程不得将 OAuth code、手机号 code、会话或 AppSecret 写入日志与共享证据。小程序网页关联票据需短期、一次性、限速且绑定发起浏览器，轮询结果只对原事务可见。

本次机器检查：三个现有 Vitest 文件通过，共 27 项。执行命令为 `node node_modules/vitest/vitest.mjs run tests/r1-live-auth-identities.test.ts tests/auth-safe-redirect.test.ts tests/r1-account-security.test.ts`；这只确认现有源码合同，不证明微信功能或上游补丁已经验证。未执行浏览器验收、数据库写入、服务配置变更或生产发布。
