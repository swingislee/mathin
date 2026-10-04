# Linux / Supabase（已部署，功能验收待完成）

执行主体：可 SSH 登录 `192.168.5.183`、拥有 Supabase Compose 与 DNS API 最小权限 Token 的管理员。

截至 2026-07-18：备份与 Compose 审计已完成；专用 Caddy 项目运行于 `/home/swing/services/caddy-supabase`，使用 Caddy v2.11.4 和 `dns.providers.tencentcloud`。Caddy 已配置 HTTP(S) 出站代理，且 loopback/LAN Supabase 上游在 `NO_PROXY` 中直连。CAM 凭据已验证可用，Let’s Encrypt DNS-01 已自动签发 `supabase.mathin.club` 证书（有效至 2026-10-15）；证书数据持久化在 Caddy `/data`，将自动续签。Supabase 公开 URL 和 redirect allowlist 已更新，计划列出的六个服务已定向重建并健康。2026-07-18 已将 Kong 的 `8000/8443` 宿主机映射收紧为 `127.0.0.1`，并经 Caddy 回归为预期的 Auth `401`；变更前备份位于 `/home/swing/services/supabase-project/deployment-backups/20260717-192022-kong-loopback-hardening/`。

1. 依计划 §2.1 审计 Docker、Compose、监听端口和当前 `.env`，只保存脱敏输出。
2. 依计划 §3 备份 `.env`、Compose、卷配置与 PostgreSQL；未完成备份前不得重建容器。
3. 使用当前权威 DNSPod 对应的 `caddy-dns/tencentcloud` DNS-01 provider；在 `/home/swing/services/caddy-supabase/.env` 填入只授予 `mathin.club` DNS 记录操作权限的 CAM `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`，并保持 600。不要把凭据发送进聊天、报告或 Git。
4. Caddy 已通过 DNS-01 自动申请证书；以 `curl --resolve supabase.mathin.club:443:192.168.5.183` 验证 TLS 后，已修改 Supabase 公共 URL。
5. 仅合并这些目标项：
   - `SUPABASE_PUBLIC_URL=https://supabase.mathin.club`
   - `API_EXTERNAL_URL=https://supabase.mathin.club/auth/v1`
   - `SITE_URL=https://mathin.club`
   - 受控 redirect allowlist（含 `http://192.168.5.213:3130/**` 与 `https://mathin.club/**`）
   - Storage：`STORAGE_PUBLIC_URL=${SUPABASE_PUBLIC_URL}`、`REQUEST_ALLOW_X_FORWARDED_PATH=true`、`FILE_SIZE_LIMIT=52428800`
6. 对比 `compose.effective.before.yml` / `after.yml` 后，只重建 `kong auth storage realtime rest studio`；不得删数据库 volume。
7. 尚待完成：使用真实角色完成 Auth、REST、Realtime、Storage 小文件、TUS 大文件和 Studio 验收，记录响应及 TUS `Location`。

不要人为增加 `TUS_URL_PATH`；仅在现有错误覆盖为 `/storage/v1/upload/resumable` 时移除该覆盖。只有实际 TUS 响应仍带 `:8000` 才评估 `KONG_PORT_MAPS`。
