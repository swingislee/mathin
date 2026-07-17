# Sakura FRP（待人工切换）

需要在 Sakura 面板和两台主机的 frpc 配置中完成，Agent 不猜测节点地址或 DNS 记录值。

| 隧道 | 域名 | 本地目标 | 必需项 |
| --- | --- | --- | --- |
| Caddy 公网入口 | `mathin.club`、`supabase.mathin.club` | xiaomi `127.0.0.1:443`，原始 TCP/TLS | **透传，不在 Sakura 终止 HTTPS**；两个域名都使用 Caddy 已签发的证书 |

切换步骤：

1. 停用指向 Windows `127.0.0.1:3131` 的前端隧道，避免 Sakura 自签名证书和 Windows 进程退出导致的 502/连接拒绝。
2. 创建或复用**原始 TCP/TLS 透传**隧道，目标精确为 xiaomi 本机 `127.0.0.1:443`（不是 `433`，也不是 Linux LAN IP）。
3. 让 `mathin.club` 和 `supabase.mathin.club` 的公网记录都指向该隧道提供的公网端点；若 Sakura 支持一条隧道承载多个 SNI 域名，应复用同一条 Caddy 入口。
4. 不要配置 Sakura 的 HTTPS 证书终止或自签名证书；TLS 由 Caddy 按 SNI 分别为两个域名提供。
5. 切换后通知 Agent，由 Agent 继续验证公网 TLS、Auth、Realtime、Storage 和 TUS。
