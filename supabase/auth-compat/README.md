# 微信绑定的 Auth 兼容补丁

本目录保存自托管 Supabase Auth 的最小候选补丁与原生回归。它不修改正在运行的 Auth 服务，也不表示微信已经启用。

## 固定版本与修复范围

- 上游：[`v2.189.0`](https://github.com/supabase/auth/tree/4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a)，commit `4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a`。
- 补丁：`v2.189.0-phone-only.patch`。手动绑定后，只有账号实际存在邮箱时才发送确认邮件或标记邮箱已确认；无邮箱的手机号账号继续完成原生 identity 绑定。
- 原 `identity.go` 的规范化 SHA-256：`651a202d5a9713637d1d0344eabb1a1ee9c637a57cc1f4fddbf7df8c7f9153ff`。脚本核对该值后才改动临时源码。
- 补丁使用零上下文格式，供固定源码使用；手工应用时先核对上述摘要，再使用 `git apply --unidiff-zero`。
- 构建工具：上游 Dockerfile 对应的 Go 1.25.8 Alpine 3.23，镜像固定为 `golang@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa`。

2026-09-25 本机检查：原版稳定复现两条无邮箱路径失败，其余三项通过；应用补丁后五项全部通过，固定账号的 user、identities、profile 指纹均在测试后恢复。原生用例覆盖无邮箱两种 verified claim、提供已验证／未验证邮箱、已有邮箱账号，并检查原 UUID、密码散列、手机号、identity 归属及重复绑定。

## 本机复现

从仓库根目录准备固定源码；已有源码和缓存可复用：

```powershell
$authCompatRoot = Join-Path (Get-Location) '.tmp/wechat-auth-compat'
New-Item -ItemType Directory -Force -Path $authCompatRoot | Out-Null
Invoke-WebRequest -Uri 'https://codeload.github.com/supabase/auth/zip/4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a' -OutFile (Join-Path $authCompatRoot 'source.zip')
Expand-Archive -LiteralPath (Join-Path $authCompatRoot 'source.zip') -DestinationPath $authCompatRoot
docker.exe --context desktop-linux pull golang@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa
node scripts/wechat-auth-compat-local.mjs --baseline
node scripts/wechat-auth-compat-local.mjs --patched
```

两种模式均核对 Windows 主机、应用实际 Supabase origin、Docker endpoint、端口监听、隔离网络和数据库指纹，再读取私有固定开发身份清单。数据库连接信息只在进程环境中传入临时容器；终端只输出结果、用例状态及源码摘要。源码、编译缓存与原始日志保存在已忽略的 `.tmp/wechat-auth-compat/`。

`--baseline` 仅在精确出现预期的两项失败、三项成功时退出 0，并记录内部 Go 测试的 `exitCode: 1`；编译失败、缺失用例或不同失败都会使脚本失败。`--patched` 要求五项全部通过，随后生成本目录的补丁。两种模式都会检查账号回滚指纹，临时 helper 超时后会先被终止。

回归直接运行真实 `linkIdentityToUser()` 与本机数据库。它复用清单中的固定教师 UUID，仅在外层回滚事务中模拟手机号／邮箱 identity；邮件使用 mock。每个分支返回普通 rollback 哨兵，包括 Auth 的 `CommitWithError` 路径，防止测试意外提交。不创建新用户或 profile，不调用会清表的 upstream 测试初始化器；仅运行 `TestMathinPhoneOnlyIdentityLinkRollback`。

## SDK 联调与候选镜像

2026-09-25 继续完成以下本机检查：

- `node scripts/wechat-auth-sdk-local.mjs`：仓库实际安装的 Supabase JS SDK 调用真实 Auth HTTPS handler。邮箱与 +86 纯手机号均完成密码登录、`linkIdentity`、两段 S256 PKCE、回调、微信重新登录原 UUID、跨账号冲突拒绝、Auth 停用拒绝、解绑后原密码登录，以及未知 OAuth 身份拒绝注册。已验证的 TOTP MFA 在绑定后保留，客户端仍识别 AAL2 要求。
- SDK fixture 使用固定教师／学生身份，所有请求共享外层数据库回滚事务，场景之间使用 savepoint；Auth 内部嵌套事务不会提交外层事务。邮件为 mock，外部微信由符合桥接协议的临时 provider 替代，监听只映射至本机 loopback。自签名证书只在该 fixture 中信任；Next.js 与正式 Auth 的 TLS 配置保持原样。
- SDK 结束后，用户、身份、profile 内容指纹与 session、refresh token、MFA、OAuth flow、provider、微信审计计数均恢复。临时容器被移除，检查结果及私有日志位于 `.tmp/wechat-auth-compat/sdk-http.json` / `sdk-http.log`。
- `node scripts/wechat-auth-image-local.mjs`：从固定 commit 压缩包另行解压构建源，核对并应用最小补丁。依赖使用 `go.mod` / `go.sum`，编译及镜像组装关闭网络。运行层固定到原版镜像 digest，仅替换 Auth 二进制，生成本机 `mathin/gotrue:v2.189.0-wechat.1`，版本为 `v2.189.0-mathin.wechat.1`。
- `node scripts/wechat-auth-image-smoke-local.mjs`：候选镜像及固定 previous 镜像分别运行临时实例，连接强制 `default_transaction_read_only=on`，健康与版本检查通过。原 `supabase-auth` 服务未重启、替换或改配置。构建摘要与检查记录保留在 `.tmp/wechat-auth-compat/image/`。

上述 SDK 检查覆盖原生 Auth 协议与数据库集成。应用的浏览器 Cookie／会话关联、MFA 与原密码门另由 `tests/wechat-session.test.ts` 和现有 broker／callback 测试覆盖；它们不代替真实 HTTPS 站点和微信扫码验收。临时镜像的启动检查也不表示已切换开发或生产服务。

## 启用前仍需完成

在选定 HTTPS 站点接通实际 Next.js 桥接、候选 Auth 镜像及 provider 配置，验证同一浏览器 Cookie、回调来源、代理／日志设置与过期票据清理。网站应用审核通过并配置服务端私有凭据后，完成真实扫码、原账号绑定及微信再次登录验收。完成这些条件前保持 `WECHAT_AUTH_COMPATIBILITY_VERIFIED`、`WECHAT_PHONE_LINKING_VERIFIED` 和 `WECHAT_OAUTH_ENABLED` 关闭。

生产 Auth 升级与数据库迁移另按[写入目标规则](../../docs/runbooks/r1-write-target-policy.md)完成只读 preflight 和本次授权。本目录的检查脚本只接受既定的本机隔离目标。
