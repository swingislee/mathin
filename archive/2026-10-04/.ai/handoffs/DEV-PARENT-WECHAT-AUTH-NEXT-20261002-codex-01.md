# 微信小程序登录与已有账号绑定：Next.js 交接

- 任务：`DEV-PARENT-WECHAT-AUTH-NEXT-20261002`
- 实现者：Codex Next.js 子 agent；集成与目标环境操作由 root 负责。
- 分支：`codex/parent-wechat-auth-next-codex`
- 基线：`b0fcf6b8`；共享合同：`8756dba586e276a5081f9b1a0602be4202b052b8`。
- 实现 head：`a54a0f7fe0e238aadef310507ca996b3df84d485`；补充测试 head：`b9a1d817a32feeaad3da404ebf378ce27c0a0ad7`。
- 当前状态：源码与定向机器检查通过；独立只读复核通过；待 root 集成开发端。用户确认 AppSecret 尚未配置，真实微信往返及用户验收待完成。

## 已交付合同

`GET /api/v1/parent/auth/wechat` 返回 `{ available, linked, canBind }`。匿名时 `linked=null`；带 Bearer 时验证当前账号并读原生 identity。`available` 表示本地受控配置就绪，不代表目标 provider 或真实微信已经通过验收。

`POST` 的 `login` 使用新的 `wx.login` code；已有微信身份回到原 UUID 并返回普通 Session，未知身份只返回 `binding_required`。客户端先登录既有账号，再以 Bearer、原密码、`confirm:true` 和新的微信 code 执行 `bind`；成功返回 `bound`，保留原会话。

共享接口版本 `0.5.0`。微信 DTO 由脚本生成；OpenAPI 包含完整输入、输出、状态码与六个可翻译 `reason`。详细启用步骤在 `contracts/parent-api/README.md` 的“微信小程序登录与绑定合同 / 服务端配置与启用”。

## 实现边界

- 服务端固定调用官方 `code2Session`，使用独立小程序 AppID/AppSecret。真实 UnionID 对应现有 `namespace:UnionID` / `custom:wechat`，缺 UnionID 明确失败；没有 OpenID 回退、假邮箱、JWT 自签、自动创建账号/学生/家庭关系。
- 复用 Supabase 原生 OAuth/手动绑定及两段 PKCE。外层 verifier 保存在单次请求内存；内层复用已有 60 秒、单次消费的 grant/access 票据。Auth、provider、最终返回 origin/path 和随机关联参数均固定校验。
- 绑定核验当前 Bearer、原密码、原 user/session_id、账号状态与 MFA，归属冲突写入既有不可变审计。另行密码验证及独立 OAuth 会话撤销；原 session_id 保留。
- 未知微信不获得 Supabase 会话。已登录身份还要通过原家长角色、账号安全、必要同意与 RLS；不满足时撤销刚签发的会话。
- `session_key` 在兑换函数内丢弃，不进票据、响应或日志。本次不覆写网页微信资料快照；原有昵称/头像保留，空资料不进入 userinfo claims。
- 仅 token/userinfo broker 接受小程序配置；网站扫码入口仍由 `WECHAT_OAUTH_ENABLED` 单独关闭。私有 HTTP 传输不经过 Next 的认证 URL 调试跟踪。
- 未新增表、迁移或直接 identity 写入。未执行数据库、真实微信、生产、Auth provider 配置或服务重启操作。

## 机器检查

1. 新增及受影响测试共 93 项通过：HTTP 18 项、miniapp provider/config 21 项、真实 Supabase JS SDK + 协议替身 17 项、既有网站微信 37 项。最后新增的配置缺失/独立开关检查在 provider/config 文件定向复跑 21 项通过；其余未受影响结果复用。
2. 覆盖缺 AppSecret/admin key/开关、UnionID 缺失、无效/已消费 code、频率限制、原始错误脱敏、未知身份、角色/同意拒绝、密码/MFA、会话变更、跨账号冲突、身份重查、双 PKCE、票据重放、受控重定向和临时会话清理。
3. 受影响 13 个 TypeScript 根文件及传递依赖检查通过；受影响源文件与新增测试 ESLint 通过；共享 DTO 同步和独立类型检查通过。
4. 全库 TypeScript 仍被既有 `tests/agent-coordination.test.ts:97/105/106/117` 的 `taskId` 选项类型不匹配阻塞；本任务未修改该文件或其实现。该结果不当作本任务类型失败，也不声称全库检查通过。
5. `git diff --check` 与提交暂存隐私扫描通过；本任务只提交已登记文件。

测试使用实际 Supabase JS SDK 和受控协议替身检查 PKCE/用户合同，未运行真实 GoTrue 新路径或真实微信往返。既有 Auth 兼容性结果不能替代此新入口在目标环境的启用验证；`WECHAT_AUTH_COMPATIBILITY_VERIFIED` 及 miniapp enable 门需按 README 的目标验证后再设置。

## 复核与集成

- Supabase 子 agent 对实现 head `a54a0f7f` 完成独立只读复核，身份权威、票据、归属、会话/MFA、冲突审计与资料边界无阻断发现；未重复执行测试或数据库写入。`b9a1d817` 仅新增独立配置开关断言。
- 本任务对 UI head `b927e8ae0b742adaf2a8915924be5567ed3af033` 只读复核路径、DTO、`reason`、首次绑定、原会话保留和失配响应保护，无阻断发现；未写 UI 文件。
- 本任务对开发数据 head `856aeaee` 的固定身份、家庭权限、执行目标、事务回滚与幂等保留规则只读复核，无阻断发现；实际数据库检查由 root 负责。
- root 接收合同、实现、补充测试及本交接后，在集成开发服务核对匿名 GET 的关闭状态、有效格式 POST 的 `503 / WECHAT_NOT_CONFIGURED`、认证读取与原密码登录；无需为当前缺凭据状态构造微信身份。

## 配置交付

`.env.example` 新增空的 `WECHAT_MINIPROGRAM_APP_ID` / `WECHAT_MINIPROGRAM_APP_SECRET` 与默认 false 的 `WECHAT_MINIPROGRAM_ENABLED`。共用 namespace、origin、broker key、Auth/纯手机号兼容门；仍使用既有 `SUPABASE_SECRET_KEY` 命名。小程序 AppID 的现有客户端私有配置不等于服务端配置已完成。

只读确认本机 `.env.local` 与进程未设置本次所需微信配置键，未输出值。用户已确认 AppSecret 未配置。正常开发入口继续使用登记的局域网 HTTP；生产必须 HTTPS，并按对应授权与 runbook 单独部署。详细配置、provider 与 redirect allowlist 见合同 README；不在本交接中记录真实凭据或身份资料。
