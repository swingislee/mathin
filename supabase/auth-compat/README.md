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

## 启用前仍需完成

这些结果验证了原生函数及候选补丁。后续需要构建可追溯的 Auth 镜像，验证镜像回退，并用固定账号完成 SDK／HTTP 两段 PKCE、原密码登录、MFA、冲突、回调与绑定后的微信登录联调。网站应用审核通过、配置真实凭据后再做真实扫码验收。完成这些条件前保持 `WECHAT_AUTH_COMPATIBILITY_VERIFIED`、`WECHAT_PHONE_LINKING_VERIFIED` 和 `WECHAT_OAUTH_ENABLED` 关闭。

生产 Auth 升级与数据库迁移另按[写入目标规则](../../docs/runbooks/r1-write-target-policy.md)完成只读 preflight 和本次授权。本目录的检查脚本只接受既定的本机隔离目标。
