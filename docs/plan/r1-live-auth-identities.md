# R1-Live · 单账号多登录身份合同

> **规划状态**：`reference`
>
> **当前用途**：冻结邮箱、手机号、验证码、微信和 QQ 的账号边界与分阶段接口；当前施工顺序仍由 doc 04 决定。
>
> **当前实现状态**：2026-08-25 产品负责人把“手机号或邮箱 + password”提升为内部使用 P0。本机隔离目标完成通用 identifier 表单、手机号绑定员工邀请、provider-unverified 保障记录、手机号/password Auth 开关和数据库断言后，migration `20260825000600`、Auth phone provider 与热修 `8ec0ba0` 已部署 Xiaomi；`SMS_AUTOCONFIRM=false`，没有创建手机号账号或邀请。真实教师注册/login 尚待人工验收；验证码、微信、QQ 和已有账号新增标识绑定仍未启用。
>
> **最后核对**：2026-08-25；运行事实见 [`r1-live-target-audit.md`](../evidence/r1/r1-live-target-audit.md)。

## 1. 产品裁决

1. 一个人只有一个 Mathin 账号，主键始终是 `auth.users.id`，业务表只引用该 UUID。
2. 邮箱、手机号、微信和 QQ 是登录身份（identity），可以绑定到同一个账号；不得为同一人各建一个 `profiles` 行。
3. 密码属于账号，不属于某个邮箱或手机号。账号同时绑定邮箱和手机号后，两个标识使用同一密码登录并得到同一 `auth.users.id`。
4. 注册支持邮箱或手机号；注册表单必须输入密码和重复密码，服务端再次校验两者一致。
5. 登录最终支持密码和验证码两种方式。验证码登录必须是 login-only，禁止因为输入一个新邮箱/手机号而静默注册账号。
6. 初期没有邮件/SMS 验证服务时，不伪造验证码成功状态，不展示可用的验证码入口。全局邀请码继续作为注册资格门；正式员工优先使用绑定具体邮箱或手机号的一次性邀请。
7. 微信/QQ 首次出现时只能绑定到已登录账号，或先完成现有账号恢复/凭据证明；未绑定的 OAuth 身份不得静默创建第二个账号。
8. 顶层角色继续只有 `student | parent | staff | admin`；教师是 staff role，不因登录方式增加新的顶层角色。

## 2. 2026-08-14 当前基线

| 层 | 事实 | 影响 |
| --- | --- | --- |
| GoTrue | `EXTERNAL_EMAIL_ENABLED=true`、`MAILER_AUTOCONFIRM=true`、`DISABLE_SIGNUP=false` | 邮箱/password 注册可用，但当前 auto-confirm 不能证明真实邮箱所有权 |
| GoTrue | `EXTERNAL_PHONE_ENABLED=false`、`SMS_AUTOCONFIRM=false`；未配置 SMS provider | 手机号注册、短信验证码登录都不可用 |
| 身份 | 12 个 auth user 均只有 email identity；phone/OAuth identity 为 0 | 不需要合并现有手机号/OAuth 账户 |
| 注册 | `/signup` 仅接收邮箱、密码、全局/员工邀请码和同意项 | 缺手机号、重复密码和通用 identifier 合同 |
| 登录 | `/login` 仅支持邮箱/password | 缺手机号/password；现有 action 还需统一 zod 入参校验 |
| 手机页 | `/login/phone` 直接调用 `signInWithOtp`，但生产没有 provider；调用未显式设置 `shouldCreateUser:false` | 当前入口应隐藏/返回“尚未启用”；未来作为登录入口时必须禁止自动注册 |
| 员工邀请 | `staff_invitations` 只绑定小写邮箱 | 需迁移为 `email | phone` 类型加规范化标识；旧邮箱邀请无损回填 |
| 新用户触发器 | `handle_new_user` 校验邀请与同意，然后创建唯一 profile | 可继续作为 fail-closed 门；需支持手机号邀请匹配和无邮箱 display name 回退 |

## 3. 账号与身份模型

```text
auth.users.id（唯一账号 / 唯一业务主体）
├─ email identity（0 或 1）
├─ phone identity（0 或 1，E.164）
├─ custom:wechat identity（0 或 1）
└─ custom:qq identity（0 或 1）
   └─ public.profiles.id = auth.users.id
      └─ staff_role_members / classroom / attendance / Notebook 等业务事实
```

约束：

- 邮箱规范化为去首尾空白后的小写；手机号在服务端规范化为 E.164，界面可默认中国区号 `+86`，数据库和 Auth API 不保存本地展示格式。
- 同一种登录标识全局唯一。若待绑定标识已经属于另一个 UUID，返回冲突并进入账号恢复/人工支持，不自动搬迁业务数据。
- `auth.identities` 是认证身份权威；业务代码不自行维护另一套可登录密码表。应用若需要展示绑定状态，通过最小 security-definer RPC 返回 provider、掩码标识和验证状态，不直接开放 auth schema。
- 当前关闭验证码时，邀请只证明“获准注册”，不自动证明邮箱/手机号所有权。正式员工的一次性邀请应绑定具体标识并通过独立受控渠道交付；全局邀请码注册产生的联系方式在真实 OTP 完成前不得用于密码恢复、敏感通知或自动账号合并。
- 如果为了无短信试用而临时启用 GoTrue phone auto-confirm，必须另存“provider 未验证”状态并明确记录风险；在该状态模型落地前，不在正式目标开放全局手机号注册。

## 4. 预留服务端接口

页面不直接拼接 Supabase 参数；所有入口先走同一规范化和能力开关。

```ts
type LoginIdentifier =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }; // 服务端规范为 E.164

type AuthCapabilities = {
  password: { email: boolean; phone: boolean };
  otp: { email: boolean; phone: boolean };
  oauth: { wechat: boolean; qq: boolean };
};

registerWithPassword(input: {
  identifier: LoginIdentifier;
  password: string;
  passwordConfirm: string;
  inviteCode: string;
  displayName: string;
  privacyConsent: true;
  childrenPrivacyConsent: true;
}): Promise<AuthActionResult>;

loginWithPassword(input: {
  identifier: LoginIdentifier;
  password: string;
}): Promise<AuthActionResult>;

requestLoginCode(input: {
  identifier: LoginIdentifier;
}): Promise<AuthActionResult>;

verifyLoginCode(input: {
  identifier: LoginIdentifier;
  code: string;
}): Promise<AuthActionResult>;

beginIdentityLink(input: {
  provider: "wechat" | "qq";
  returnTo: string;
}): Promise<AuthActionResult>;
```

接口规则：

- `registerWithPassword` 先用 zod 校验 identifier、密码强度、重复密码、邀请码和同意项；重复密码不写 Auth metadata。
- `loginWithPassword` 根据 identifier kind 调用 `signInWithPassword({email,password})` 或 `signInWithPassword({phone,password})`。
- `requestLoginCode` 在 provider/功能关闭时返回 `AUTH_METHOD_UNAVAILABLE`。启用后调用 `signInWithOtp` 时必须传 `shouldCreateUser:false`，所以验证码登录永远不会注册新账号。
- 注册验证码与登录验证码使用不同 intent；未来启用注册验证码时，只有验证成功且邀请码仍有效才创建账号。
- `beginIdentityLink` 必须要求现有 AAL1 会话；敏感账号可要求 AAL2。回调校验 state/PKCE，把 provider identity 链接到当前 UUID。
- OAuth 登录页只展示已启用的 provider。未绑定 provider 的回调以 `IDENTITY_NOT_LINKED` 失败，不使用 OAuth 返回的昵称、手机号或邮箱猜测账号。

稳定错误码至少包括：`VALIDATION`、`INVALID_INVITE`、`IDENTIFIER_EXISTS`、`INVALID_CREDENTIALS`、`AUTH_METHOD_UNAVAILABLE`、`CODE_INVALID_OR_EXPIRED`、`IDENTITY_NOT_LINKED`、`IDENTITY_CONFLICT`、`ACCOUNT_LOCKED`。zh/en 只映射这些稳定码，不透传 GoTrue 原始错误。

## 5. 员工邀请迁移合同

`staff_invitations` 采用兼容迁移，不在生产手工改表：

| 字段/约束 | 目标 |
| --- | --- |
| `identifier_type` | `email | phone`；历史行回填 `email` |
| `identifier_normalized` | 小写邮箱或 E.164；不在日志/证据输出原值 |
| pending 唯一性 | `(identifier_type, identifier_normalized) where status='pending'` |
| 邀请码 | 继续只保存 hash，保持 pending/accepted/revoked/expired 生命周期 |
| issue RPC | 管理员显式选择邮箱或手机号；zod/RPC 双重规范化 |
| validate/trigger | 同时匹配 type、规范化值、code hash、pending 和有效期 |
| accepted identity | `accepted_by` 仍指向唯一 `profiles.id`；同一邀请只能消费一次 |

迁移完成前，正式手机号员工注册不可用；现有邮箱邀请路径继续工作。正式员工账号创建后仍由管理员分配 teacher staff role，邀请本身不改变权限模型。

## 6. 分阶段启用

### A. R1-Live 最短路径

1. 先完成当前 Gate 1 的生产目标误写保护与当前 PostgreSQL+Storage 同批次备份；认证改造不得先于这两个保险丝修改生产配置。
2. 首名真实教师可继续使用现有“邮箱绑定一次性邀请 + password”路径，避免手机号/验证码/OAuth 延迟第一次真实点名。
3. 登录/注册表单使用通用 identifier，注册要求重复密码；原手机号 OTP 页面回到统一登录页，当前不展示或调用 OTP。
4. 2026-08-25 P0 候选已在本机完成：员工邀请泛化为 email/phone，手机号只接受绑定具体号码的一次性员工邀请；通用全局邀请码仍不能创建手机号账号。

### B. 无验证码的内部手机号/password

1. 只对绑定具体手机号的一次性员工邀请开放；全局邀请码手机号注册仍关闭。
2. 邀请通过已确认的独立渠道交付，账号标记为“invite-attested / provider-unverified”；手机号不能用于找回或敏感通知。
3. 不启用 `SMS_AUTOCONFIRM`。服务端在验证手机号绑定员工邀请后，通过受信 Admin API 创建 `phone_confirm=true` 的 password 账号，并在 `account_identifier_assurances` 另存 `staff_invite + provider_unverified`；随后仍由普通 `signInWithPassword({phone,password})` 建立会话。
4. GoTrue 只打开 phone provider 以接受 password 登录，不配置 SMS provider；直接 OTP 请求不会成为产品入口。经备份、部署和回退预检后才修改生产 Auth 配置，生产验收使用真实受邀教师，不创建一次性生产测试账号。

### C. 邮件/SMS 验证码

1. 选择邮件和短信 provider，配置速率限制、验证码有效期、发送审计和隐私保留期。
2. 开放邮箱/手机号注册验证与 login-only 验证码登录；完成验证码后把 contact 状态升级为 provider-verified。
3. 既有 invite-attested 账号在下次敏感操作前补验证，不新建账号。

### D. 微信/QQ

1. Supabase 内建 provider 列表不直接包含微信/QQ；优先验证 self-hosted custom OAuth/OIDC provider 与当前 GoTrue `v2.189.0` 的兼容性，不兼容时先单列升级或使用受控 broker。
2. provider key 固定为 `custom:wechat`、`custom:qq`（最终名称在兼容验证时冻结），subject 使用提供方稳定唯一 ID；不得把昵称作为身份键。
3. 第一阶段只在“账号设置 → 绑定登录方式”中调用 manual identity linking。登录页仅允许已经绑定的微信/QQ 返回原 UUID；新 provider subject 不创建账号。
4. 解绑前要求至少保留一种可用登录方式；最后一种身份不可删除。绑定、冲突、解绑和支持恢复写不可变审计。

### E. R1-Live 后统一账号中心（`POST-LIVE-AUTH-01`）

2026-08-25 代码复核修正了早期判断：student、parent、staff 导航和全局工具菜单已经提供 `/dashboard/account-security` 入口，当前缺口是页面仍以安全工具集合为主，不能完成个人资料、登录 identity 和恢复状态管理。产品负责人确认统一账号中心采用传统网站个人设置页：桌面为左侧设置导航、右侧线性表单/列表，移动端把导航移到内容上方；不用 Dashboard 卡片网格组织个人信息。该项在 R1-Live Gate 0～4 全部通过后施工，不阻塞当前首个真实点名闭环。

现有 `/dashboard/account-security` 升级为统一账号中心，保留当前入口和书签兼容。一级信息架构固定为：

1. **个人资料**：允许修改头像、全站显示名称和界面语言。头像和显示名称可能出现在课堂、Notebook 或公开互动中，保存前明确展示范围；头像只接受受限图片类型/大小并移除 EXIF。
2. **登录方式**：按 identity 展示掩码邮箱、手机号及未来微信/QQ，并分别标记“可否登录、provider 是否验证、可否自助恢复”。未启用能力显示真实状态且不发起 Auth 请求。
3. **安全与恢复**：承接现有密码、TOTP MFA、活动会话、退出单个/其他会话与恢复方式；手机号 password P0 在 SMS 接入前明确显示“可密码登录、短信未验证、不可短信找回”。
4. **隐私与数据**：承接现有同意记录、数据导出及更正、限制处理、删除等权利请求，不另建重复页面。

账号资料边界：

- 账号级只维护头像、全站显示名称、界面语言和登录/安全信息。
- 学生真实姓名、生日、性别、年级、学校留在学生档案；员工真实姓名、岗位、权限和教学安排留在员工/学校业务档案；监护关系留在家庭档案。
- 账号中心只读显示已关联业务身份并链接到有权访问的业务档案，不复制编辑字段，不以账号资料覆盖业务事实。
- 微信、QQ、邮箱和手机号绑定复用本文件的单 UUID 合同；绑定、冲突、解绑、恢复不得新建第二个 profile。最后一种可用登录方式不可解绑，identity 已属于另一 UUID 时拒绝并进入支持流程，不自动合并。

分阶段交付：

1. 先完成不依赖验证码 provider 的页面重组、头像/显示名称/语言、只读 identity 快照、现有安全与隐私能力迁入。
2. 接入真实邮件/SMS provider 后开放邮箱/手机号验证、绑定、更换、解绑与恢复；不提供假验证码或前端伪验证。
3. 验证 self-hosted GoTrue custom OAuth/OIDC 兼容性后接入微信/QQ；第一阶段只允许用户登录原账号后手动绑定，未绑定 provider 不创建新账号。

所有页面和错误状态维护 zh/en，支持键盘与移动布局；敏感变更要求近期凭据或 AAL2 并写入最小审计，不向客户端暴露 auth schema、完整标识、token 或恢复材料。

退出条件：四种顶层身份各至少 1 条入口可达旅程；可用环境切换后入口一致；桌面与移动均保持左侧/顶部导航加线性表单的信息层级；账号资料、密码、MFA、会话和身份绑定按实际能力工作；业务档案字段不能从账号中心修改；跨账号读取/修改为 0；绑定前后 `auth.users.id` 与 `profiles.id` 不变；禁用能力不会发起 Auth 请求。

## 7. 防止四账号分裂的验收矩阵

| 场景 | 必须结果 |
| --- | --- |
| 邮箱/password 注册 | 创建 1 个 auth user、1 个 profile、1 个 email identity |
| 手机号/password 注册 | 创建 1 个 auth user、1 个 profile、1 个 phone identity |
| 已有邮箱账号绑定手机号 | auth user/profile 数不变；新增 phone identity；两种 password 登录的 `user.id` 相同 |
| 已有账号绑定微信和 QQ | auth user/profile 数不变；四种登录方式均返回同一 UUID |
| 未绑定微信/QQ直接登录 | 明确拒绝；auth user/profile 数不变 |
| 验证码登录输入新标识 | 明确拒绝或保持 generic response；auth user/profile 数不变 |
| 待绑定手机号/邮箱已属于另一 UUID | `IDENTITY_CONFLICT`；两边业务事实不移动、不合并、不删除 |
| password 与重复 password 不同 | 服务端 `VALIDATION`；不调用 Auth 注册 API |
| 邀请无效/过期/已消费 | 注册失败；不留下 auth user 或 profile |
| OAuth 回调缺 state/PKCE 或会话 | 拒绝；不绑定身份 |

这些用例先在隔离/开发目标以固定账号执行；生产验收复用已批准正式账号，只验证登录和身份列表，不为测试新建一次性账号。

## 8. 资料与实现边界

- Supabase 支持 email/phone password 注册与登录，但手机号会被运营商回收，后续应配 MFA 和恢复策略：[Password-based Auth](https://supabase.com/docs/guides/auth/passwords)。
- 一个 user 可以拥有多个 identity；manual linking 要求用户已登录：[Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)、[User Identities](https://supabase.com/docs/guides/auth/identities)。
- 手机验证码需要实际 SMS provider；self-hosted 配置不能用“未配置但假装发送”代替：[Self-hosted Phone Auth/MFA](https://supabase.com/docs/guides/self-hosting/self-hosted-phone-mfa)。
- 微信/QQ 不在内建 social provider 清单；custom OAuth/OIDC 是候选适配层，但启用前必须验证当前 self-hosted 版本：[Social Login](https://supabase.com/docs/guides/auth/social-login)、[Custom OAuth/OIDC Providers](https://supabase.com/docs/guides/auth/custom-oauth-providers)、[Self-hosted OAuth](https://supabase.com/docs/guides/self-hosting/self-hosted-oauth)。
