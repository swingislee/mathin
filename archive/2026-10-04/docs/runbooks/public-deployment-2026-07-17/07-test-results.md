# 已完成测试

测试时间：2026-07-17，网络：Windows 本机。

| 项目 | 结果 |
| --- | --- |
| `pnpm lint` | 通过；仅既有 `scripts/cw-import.mjs` 未使用导入 warning |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；Next.js 16.2.10 生成 284 个路由 |
| standalone 健康检查 | 通过：`http://127.0.0.1:3131/api/health` → `ok/mathin/production` |
| 3131 绑定范围 | 通过：测试时监听 `127.0.0.1`；测试结束后无残留监听 |
| release 依赖独立性 | 通过：5 个 pnpm junction 均在 release 内，0 个链回工作区 |
| 生产环境 ACL | 通过：仅管理员、Administrators、SYSTEM |
| Linux Compose/Storage 审计 | 通过：服务健康；Storage 公开 URL/forwarded path/50 MiB 与计划一致；无 TUS 路径覆盖 |
| Linux 备份 | 通过：`pg_dumpall` 与卷配置归档 SHA-256 验证成功 |
| Caddy DNS provider | 通过：Caddy v2.11.4 官方自定义二进制及本地 scratch 镜像均含 `dns.providers.tencentcloud` |
| DNSPod CAM / API 连通性 | 通过：凭据变量非空，`xiaomi → dnspod.tencentcloudapi.com` 返回 HTTP 200 |
| Caddy 自动 TLS / 续签 | 通过：Let’s Encrypt DNS-01 已签发 `supabase.mathin.club`，TLS 1.3 验证通过；证书有效至 2026-10-15，Caddy `/data` 持久化自动续签状态 |
| Supabase 公开 URL 切换 | 通过：`API_EXTERNAL_URL`、`SITE_URL`、redirect allowlist、`PROXY_DOMAIN` 已按计划更新；`kong/auth/storage/realtime/rest/studio` 均健康 |
| Caddy → Supabase | 通过：Auth 请求被正确转发，REST 无 key 返回预期 401，Storage 根路径返回上游 404 |
| Linux Mathin build | 通过：Node v22.23.1、pnpm 11.10.0、Next 16.2.10 在 xiaomi 构建 284 个路由，生成独立 standalone release |
| Linux Mathin service | 通过：`mathin.service` 已启用、仅监听 `127.0.0.1:3131`，健康检查返回 `ok/mathin/production`，常驻内存约 52 MiB |
| Linux Mathin 自动恢复 | 通过：受控 SIGTERM 后 systemd 5 秒内自动重启，PID `3268360 → 3283631`，健康检查恢复 |
| Caddy → Mathin | 通过：Let’s Encrypt 已签发 `mathin.club`（有效至 2026-10-15）；经 Caddy 首页返回预期 307 → `/zh` |
| 公网入口（Sakura） | 通过：Windows 经正式域名 `https://mathin.club/api/health` 返回 `200`，`https://supabase.mathin.club/auth/v1/` 返回预期 `401`；两者均经 Caddy 响应 |
| Kong 端口收口 | 通过：Kong `8000/8443` 仅监听 Xiaomi `127.0.0.1`；Windows 对 `192.168.5.183:8000`、`:8443` 的 TCP 连通测试均为 `False`；Caddy 转发仍正常 |

尚未测试：已认证的 Supabase Auth/REST/Realtime/Storage、Studio、10–20 MiB TUS 及其 `Location`、浏览器中的内网绕过 FRP、Linux 主机重启恢复。这些依赖真实浏览器会话、用户凭据或设备重启窗口，见各专项报告。
