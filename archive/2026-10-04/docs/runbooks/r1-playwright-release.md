# R1-14 Playwright 非生产发布门

## 边界

`pnpm e2e` 是本地诊断入口。缺少固定开发账号或 LAN 目标时允许显式 skip，因此它的成功结果不构成 R1-14 发布证据。

`pnpm e2e:release` 是固定账号的非生产 release runner。它不注册账号、不执行产品写态旅程，也不允许目标为生产环境。正式生产账号不得作为输入，带凭据的 E2E 暂不接入 CI。

## 必需配置

- `MATHIN_E2E_BASE_URL`：明确的 HTTP(S) origin；不得包含凭据、路径、查询或 fragment。
- `MATHIN_E2E_ALLOWED_ORIGIN`：必须与最终 target origin 完全相等。
- `MATHIN_E2E_TARGET_FINGERPRINT`：目标环境经复核的 64 位小写十六进制指纹。
- `MATHIN_E2E_FIXED_ACCOUNT_ENVIRONMENT`：只允许 `development`、`test`、`staging`、`release-candidate` 或 `isolated-rc`。
- `MATHIN_E2E_NO_WEBSERVER=1`：release runner 只连接已独立启动并复核的非生产目标。
- `MATHIN_E2E_LAN_BASE_URL`：loopback 或 RFC1918 origin，用于非安全上下文验证。
- 固定 `teacher`、`student`、`parent` 邮箱及共享密码：来自环境变量或 gitignored 的 `.claude/test-accounts.local.md`。

任一必需角色缺失、任一用例 skip、测试数不是 9、出现 unexpected/flaky、目标为 `mathin.club` 或任一 target attestation 不匹配时，runner 失败。

## Artifact

固定账号项目的 `trace`、`screenshot`、`video` 永久为 `off`；测试启动前再次核对最终 Playwright project 配置，因此命令行覆盖会在读取凭据前失败。匿名项目可保留失败调试 artifact。

## 仍为 pending

- 写态/竞争旅程仍待使用专用可重置数据集设计，本门不授权写现有开发或生产数据。
- Firefox、WebKit 与移动浏览器矩阵 pending。
- `/en` 正式角色旅程 pending。
