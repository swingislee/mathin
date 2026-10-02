# 微信生产启用 · 2026-10-02

状态：**生产微信登录已开启，中英文入口均可生成微信二维码；已部署，待真实扫码与绑定验收。** 开放平台授权回调域已由用户修正为 `mathin.club`；机器检查通过不代替用户验收，当前记录不关闭 R1-Live Gate。

## 授权与范围

- 产品负责人确认已在生产私有配置填写网站应用凭据，并明确要求“在生产端开启”。凭据始终保留在生产受控文件与内存中，命令、共享证据和 Git 不包含真实 AppID、AppSecret、Token 或 Cookie。
- 本次沿用应用 `aaed7e5400bea4bc76974b4bde8f8ebbf40b8373`，current / previous 为 `20260925-053117` / `20260925-020701`。没有发布开发分支、构建新应用、迁移数据库、创建账号或变更正式身份。
- 2026-10-02 21:44（Asia/Shanghai）曾开启应用、Auth manual linking 和 `custom:wechat` provider；随后发现微信平台拒绝回调地址，于 21:57 关闭应用新授权入口及 provider，保留已验证配置。用户于 22:08 确认已将授权回调域从完整路径改为 `mathin.club`；22:11 微信二维码与生产只读 preflight 通过，22:14 重新开启两个入口并完成 postflight。

## 当前有效配置

应用配置由 `mathin.service` 从生产主机的 `/home/swing/services/mathin/config/.env.production.local` 加载。网站应用凭据已存在且经过进程加载确认；桥接密钥与 Auth provider 一致。

| 配置 | 当前状态 |
| --- | --- |
| `WECHAT_OAUTH_ENABLED` | `true`，应用进程已加载 |
| `WECHAT_AUTH_COMPATIBILITY_VERIFIED` | `true`，沿用相同 OAuth 源码和原生 Auth 已通过的兼容证据 |
| `WECHAT_PHONE_LINKING_VERIFIED` | `true`，沿用相同手机号兼容镜像及隔离真实 Auth 检查 |
| Auth `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED` | `true` |
| `custom:wechat.enabled` | `true`，中英文授权链路均通过 |
| 中英文应用回调 | 精确条目已加入既有 allowlist，其它既有规则保持 |
| Kong 访问日志 | 使用 `mathin_privacy` 格式，记录时间、方法、路径、状态、耗时 |
| 微信临时票据清理与心跳监测 | 原有专用服务和 timer 持续运行 |

Auth 镜像保持 `mathin/gotrue:v2.189.0-wechat.1`，image ID `sha256:ebfeb6b7bd417f293ea722129608d99da6ab8fbe85b5a758401f0fc181c1f680`。本次仅让同一 Auth/Kong 镜像和应用服务加载新的配置。

## 核对与验证

- 只读 preflight 核对执行主机、应用 origin、实际进程目录、loopback 监听、生产数据库指纹、既有微信迁移、身份审计触发器、专用清理以及当前无进行中课堂。数据库 ledger 保持 `446 / 20260927000100_whiteboard_version_select`。
- 复用 2026-09-24 原生 Auth 与实际 Next HTTPS 的邮箱/纯手机号、原 UUID、PKCE、Cookie、重放、会话切换和回滚通过记录。生产应用的微信协议实现与原已验证发布之间没有变化，Auth 镜像也一致；本次没有重复执行全量回归。
- 候选 Compose 的结构化差异仅包含 manual linking、两个明确回调条目和 Kong 日志格式。先用同一网关镜像的独立临时容器核对实际环境变量和 Nginx 语法，随后切换。
- 中文和英文均实际提交匿名微信登录表单，通过本站 → Supabase Auth → 本站桥接 → 微信授权页；两段 PKCE、准确的 `redirect_uri`、Secure/HttpOnly/SameSite Cookie 和 no-store/no-referrer 响应头通过。未完成微信扫码，也没有以正式账号执行密码验证、绑定或解绑。
- Caddy 已有日志过滤；本次补齐 Kong 的路径日志格式，依据 [Kong 自定义日志配置](https://developer.konghq.com/how-to/add-correlation-ids-to-gateway-logs/)。无效 callback 与健康请求使用无敏感值的探针验证：Caddy/Kong/Auth/应用检查窗口内未出现探针 query、真实 AppID/secret 或本次流程的 state/Cookie 值。首次检查包含 871 条新格式 Kong 记录；重新启用后再次核对 42 条记录及本次新流程敏感值，均通过。
- 生产现有代理向应用提供受信 loopback 来源，应用继续覆盖客户端自报 IP；当前访客共享启动限流桶。独立公网访客 IP 尚未透传，本次没有改变代理网络结构，也未将此项记为独立访客 IP 验证通过。

## 回调域修正与待验收项

原授权回调域误填为 `mathin.club/zh/auth/wechat/callback`，导致微信返回 HTTP 200 的错误页，实际文本为 `redirect_uri 参数错误`。用户已改为仅域名 `mathin.club`；程序实际回调继续使用 `https://mathin.club/zh/auth/wechat/callback`。

重新启用前再次只读核对主机、origin、监听、镜像、数据库指纹和业务计数，确认没有进行中课堂。复用本次已有数据库备份，并另外快照关闭入口时的配置。只更新 provider 的 enabled 与应用 `WECHAT_OAUTH_ENABLED`，重启应用加载配置；Auth、Kong、Compose 和应用 release 均保持。失败路径会恢复本次关闭入口的配置。

22:14 的中英文真实匿名表单分别通过双段 PKCE、受保护 Cookie、固定回调和微信 HTTP 200 **且含二维码** 的检查。Caddy/Kong/Auth/应用日志与业务计数复核通过。二维码证明授权起始链可用；AppSecret 的真实 code 交换、扫码回站、已有邮箱/手机号账号绑定、再次登录原账号及界面体验仍待用户验收。

生产验收入口为 [中文登录](https://mathin.club/zh/login) 和 [英文登录](https://mathin.club/en/login)。首次扫码按既有合同进入游客流程，不创建新 Auth 用户；用户可登录原账号后完成绑定。

## 备份、保留与业务事实

- 生产受控备份：`mathin-wechat-enable-20261002T134030Z`，数据库 custom dump 357,951,595 字节，SHA-256 `6d5e186d85b4fc996ebed629a1952c03cc96afd3690d7cf6f509c123de0d5058`，目录清单包含 Auth 用户及 custom provider；保留至至少 2027-01-02。应用配置、Compose、Caddy 与 provider 元数据同时备份，访问限生产运维角色。
- 配置回退路径已准备；先前关闭新授权和本次重新启用均未恢复数据库或删除已有身份。恢复启用前另存关闭入口时的配置快照，Auth/Kong 不重复重建。匿名诊断只产生可过期的流程数据，继续由原清理服务处理。
- 首次启用、关闭入口及回调域修正后重新启用的检查中，41 个 Auth 用户、41 个档案、43 个身份、34 个班级、429 个课次、63 条考勤、3,774 个课件 release、126,550 个 Storage 对象保持不变。微信 identity 为 0。
- 原始操作脚本、配置候选、短期流程诊断及日志只留在生产受控 staging/backup 和已忽略的本机 `.tmp/`；本文件只保存脱敏结论。真实扫码、人工验收及正式 Gate 均未完成。
