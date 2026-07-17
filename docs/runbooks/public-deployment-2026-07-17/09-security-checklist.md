# 安全检查

- [x] 3130 未被本次部署用于生产；生产脚本明确使用 `127.0.0.1:3131`。
- [x] `NEXT_PUBLIC_*` 与 `SUPABASE_SECRET_KEY` 分离；没有输出或提交任何值。
- [x] Git 外生产环境文件已限制 ACL。
- [x] health endpoint 不返回密钥、URL、数据库连接或完整环境变量。
- [x] release 不依赖工作区的 pnpm junction。
- [x] Linux 的部署前 Compose、环境、数据库逻辑导出和卷配置已备份，并以 owner-only 权限与 SHA-256 清单保存。
- [x] Caddy 自定义二进制来自 Caddy 官方下载端点；因 Docker Hub 代理失效，不使用第三方镜像加速源。
- [x] Caddy 的 ACME/DNSPod 出站请求已配置 HTTP(S) 代理；loopback 与 LAN Supabase 上游通过 `NO_PROXY` 直连。
- [x] Linux Mathin 生产 `.env` 为 owner-only（600）；Node、pnpm 与 systemd 服务均位于 `swing` 用户范围。
- [x] Mathin 仅监听 Linux loopback；Caddy 是唯一的 TLS/HTTP 公网入口，服务有 `Restart=always` 与 Node 768 MiB 堆上限。
- [x] Kong `8000/8443` 已收紧至 `127.0.0.1`；Windows 侧 TCP 连通验证均被拒绝；PostgreSQL 5432 未通过 Sakura 暴露。
- [ ] Caddy DNS Token 采用最小权限并持久化 `/data`、`/config`。
- [ ] Sakura 不暴露 3130，后端隧道强制 HTTPS/WebSocket/方法与体积限制。
- [ ] Supabase redirect allowlist、bucket 公开性、Storage RLS、MIME/扩展名/大小限制复核。
- [ ] Linux 主机重启恢复演练，以及实际回滚演练。
