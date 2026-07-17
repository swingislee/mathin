# 已实施变更

- `next.config.ts`：启用 `output: "standalone"`，未覆盖现有 next-intl、headers 或 CSP 配置。
- 新增 `GET /api/health`：只返回服务状态、服务名与运行环境，响应禁止缓存，不返回配置或密钥。
- Linux 生产入口已迁至 Xiaomi：`mathin.service` 在 `127.0.0.1:3131` 运行 immutable standalone release，由 Caddy 以 HTTPS 暴露 `mathin.club`。
- `scripts/ops/deploy-mathin-linux.sh`：在 Linux 构建独立 release、原子切换 `current`、成功后记录 `previous`、验活失败时自动恢复上个 release，并以锁阻止并发部署。
- `scripts/ops/publish-mathin-xiaomi.ps1`：检查本地 commit、将 Git archive 传到 Xiaomi、在交互 shell 中运行 `proxy_on` 后构建和发布；支持状态检查与回滚。
- `scripts/ops/switch-supabase-route.ps1`：供根目录 `Supabase路由切换.cmd` 调用，在 LAN 直连与完整公网链路之间切换 Supabase 路由。
- 根目录仅保留两个双击入口：`Supabase路由切换.cmd` 与 `发布到生产.cmd`。部署报告整理在 `docs/runbooks/public-deployment-2026-07-17/`。
- Kong 的宿主机 `8000/8443` 映射已收紧为 `127.0.0.1`；Caddy 是 Supabase 的唯一 HTTP(S) 入口。变更前 Compose 备份位于 Xiaomi 的 `deployment-backups/20260717-192022-kong-loopback-hardening/`。
