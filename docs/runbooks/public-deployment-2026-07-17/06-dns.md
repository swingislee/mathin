# DNS（实施中）

当前权威 NS 为 DNSPod（`scales.dnspod.net`、`gnat.dnspod.net`），因此不要将阿里云 AccessKey 用于当前 DNS-01；它无法修改 DNSPod 托管的 `_acme-challenge` TXT 记录。

1. DNSPod/Tencent Cloud 最小权限 CAM 凭据已写入 `xiaomi:/home/swing/services/caddy-supabase/.env` 并用于 Caddy DNS-01 自动签证书；不要把凭据发送进聊天、报告或 Git。
2. 当前不需要添加专用 `_acme-challenge` CNAME；保留既有 `supabase.mathin.club` 记录，Caddy 已直接完成自动 DNS-01 签发和续签配置。
3. 从 Sakura 面板读取两条隧道要求的 CNAME/A 目标，再创建或更新公网记录；不要复用同一隧道。
4. 在内网 DNS（优先路由器重写，其次 AdGuard/Pi-hole/hosts）配置：

```text
supabase.mathin.club → 192.168.5.183
```

Windows 开发机可双击项目根目录的 `Supabase路由切换.cmd`（实际实现位于 `scripts/ops/switch-supabase-route.ps1`）替代全局 DNS 重写：默认执行将写入受标记的 hosts 规则并启用 LAN；`-Mode Public` 删除**仅该标记规则**以回到公网验证；`-Mode Status` 可无管理员权限查看状态。修改 hosts 需要“以管理员身份运行”的 PowerShell。

5. Windows 内网验证：

```powershell
ipconfig /flushdns
Resolve-DnsName supabase.mathin.club
curl.exe -I --resolve supabase.mathin.club:443:192.168.5.183 https://supabase.mathin.club/auth/v1/
```

6. 公网验收后再恢复正常 TTL。内网不需要为 `mathin.club` 配置 DNS；开发仍直接访问 `http://192.168.5.213:3130`。
