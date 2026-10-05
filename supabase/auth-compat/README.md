# 微信绑定的 Auth 兼容层

本目录保留已使用的纯手机号绑定补丁、原生验证源和固定镜像构建说明。微信网页登录与绑定的启用事实见 [当前状态](../../docs/current.md)；连接参数、开关和身份边界由 [微信登录配置](../../docs/ops/wechat-oauth.md) 维护。

## 固定版本与修复范围

- 上游版本为 `v2.189.0`，源码 commit 为 `4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a`。
- [补丁](v2.189.0-phone-only.patch) 使无邮箱的手机号账号完成原生 identity 绑定；只有实际存在邮箱时才发送确认邮件或标记邮箱已确认。
- 原 `identity.go` 的 SHA-256 为 `651a202d5a9713637d1d0344eabb1a1ee9c637a57cc1f4fddbf7df8c7f9153ff`。补丁采用零上下文格式；应用前核对源码版本与摘要，再使用 `git apply --unidiff-zero`。
- [Dockerfile](Dockerfile) 固定原版运行层，仅替换由相同源码和补丁构建的 Auth 二进制。升级 Auth 时重新核对上游行为与所需补丁。

## 可复用的验证源

[原生绑定用例](mathin_phone_link_test.go) 覆盖无邮箱、已验证或未验证邮箱、既有身份、重复绑定，以及 UUID、密码和手机号保持。[SDK HTTP 夹具](mathin_sdk_http_test.go) 提供事务内的真实 Auth handler、身份冲突和会话场景。它们供明确的 Auth 兼容验证使用，需按实际目标准备隔离环境。

2026-09-25 的历史结果：原版两条无邮箱路径失败，其余三项通过；应用补丁后五项通过，固定身份数据在检查后恢复。该记录只证明当时的版本和范围。应用层另有 `tests/wechat-session.test.ts`、`tests/wechat-broker.test.ts`、`tests/wechat-callback.test.ts` 等定向用例，按本次实际风险选择。

再次验证或升级前，先按 [数据操作](../../docs/ops/data-operations.md) 识别真实目标和授权范围。事务回滚中的造数同样属于写入。核对原账号 UUID、原密码登录、MFA、锁定、冲突及解绑行为；真实扫码与绑定由获准的本人完成。

## 历史复现资料

当时的本机源码准备、SDK 联调、镜像构建及独立 Next 验证步骤保存在 [原说明](../../archive/2026-10-05-followup/supabase/auth-compat/README.md)，配套脚本已归入 [2026-10-04 历史脚本](../../archive/2026-10-04/scripts/)。重现旧问题时按该时点的源码和依赖读取，现行操作从本次目标及上述入口确定。
