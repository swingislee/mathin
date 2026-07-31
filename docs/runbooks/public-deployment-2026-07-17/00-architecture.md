# Mathin 公网部署架构

生成时间：2026-07-18（Asia/Shanghai）。

```text
公网 https://mathin.club、https://supabase.mathin.club
  └─ Sakura FRP（待人工配置：原始 TCP/TLS 透传）→ xiaomi 127.0.0.1:443
       └─ Linux Caddy :443（Let’s Encrypt DNS-01 自动证书与续签已启用）
            ├─ mathin.club → Mathin Next.js 16.2.10 standalone :3131
            │                （user systemd、仅监听 127.0.0.1）
            └─ supabase.mathin.club → Kong 127.0.0.1:8000
                                        └─ Supabase
```

端口 `3130` 保留给 Windows 内网开发。生产 Mathin 仅在 `xiaomi` 的 `127.0.0.1:3131` 监听，并由 `mathin.service` 的 `Restart=always` 守护；公开配置存于 Git 外的 `/home/swing/services/mathin/config/.env.production.local`。Linux Caddy 位于 `/home/swing/services/caddy-supabase`，代理前端与 Supabase，且不会暴露 3131 或 Kong 作为公网入口。
