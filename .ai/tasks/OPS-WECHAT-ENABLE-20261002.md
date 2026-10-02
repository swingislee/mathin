# OPS-WECHAT-ENABLE-20261002 · 开启生产微信登录

## 目标与授权

- 产品负责人确认网站应用 AppID/AppSecret 已填入生产受控配置，并明确要求“在生产端开启”。授权包括本次必要配置、服务加载和定向验证；真实扫码由本人完成。
- 当前阶段为 R1-Live-2；专题依据为 [微信网站应用 OAuth](../../docs/runbooks/wechat-website-oauth.md)。
- 沿用已部署应用和兼容 Auth 镜像，核对目标、备份和回退后启用登录入口；保留原账号、邀请规则、权限和业务数据。

## 已完成

- 生产 preflight、配置/数据库备份、候选语法检查、Auth/provider/应用开关加载及两种语言真实匿名授权起始链通过。
- 补齐 Kong 日志脱敏；通过探针确认 Caddy/Kong/Auth/应用日志不记录本次授权参数和凭据。
- 用户确认原授权回调域包含路径，并已改为 `mathin.club`；微信二维码复查通过，原 `redirect_uri 参数错误` 阻塞解除。
- 2026-10-02 22:14（Asia/Shanghai）沿用本次授权重新开启 `WECHAT_OAUTH_ENABLED` 与 `custom:wechat`，应用已加载配置。Auth/Kong 沿用已验证的运行实例，数据库备份复用。
- 中英文页面均通过本站 → Supabase → 本站桥接 → 微信二维码的真实协议检查；生产服务健康，日志脱敏与受保护数据计数复查通过。

## 证据与验收

- [2026-10-02 生产启用记录](../../docs/evidence/r1/wechat-oauth-activation-20261002.md)。
- 原应用、Auth 镜像以及独立通过记录没有变化，复用兼容证据；本次没有源码发布或数据库迁移。
- 已部署可验收：`https://mathin.club/zh/login`、`https://mathin.club/en/login`。二维码机器检查通过；真实扫码、原账号绑定及再次微信登录由用户验收，正式 Gate 状态保持。

## 2026-10-02 绑定错误修复

- 用户反馈：已登录账号点击绑定后直接出现 `wechatError=expired`，尚未显示二维码。
- 脱敏生产时间线显示 state 已在绑定 POST 返回前生成，随后浏览器 GET 授权端读不到 flow。Next 当前实现会在 Server Action 同源跳转时先发 RSC GET，消费一次性 flow 后再由浏览器导航。
- 本增量在授权端延后 RSC 预读的消费，保留正式导航中的原会话、PKCE、单次消费和冲突校验；补充定向回归及真实 Next Action HTTP 检查。
- 发布候选从当前生产 `aaed7e54` 只追加已验证补丁，沿用本次微信启用与错误修复范围，保留旧 release 回退；不发布 main 的其他开发功能。
