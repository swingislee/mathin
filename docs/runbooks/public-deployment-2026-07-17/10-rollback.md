# 回滚

## Linux Mathin

Linux 前端的 release 位于 `/home/swing/services/mathin/releases/`，`current` 是原子 symlink。如新版本不健康：

1. 优先双击仓库根目录 `发布到生产.cmd`，选择 `ROLLBACK` 并输入确认文字。它会将 `current` 与 `previous` 已知可运行 release 互换、重启服务、验证 loopback health。
2. 若发布器不可用，才手工停止 `mathin.service`，选择一个已验证的 release，将 `current` 指向 `releases/<release-id>`，再启动并验证 `http://127.0.0.1:3131/api/health`。
3. 再通过 Caddy 验证 `https://mathin.club`；证书与 Caddy 配置无需回滚。

不得在运行中的 `current` 内构建，也不得删除唯一已知可运行的 release。

## Linux / DNS

按计划 §14：先停用新的 Caddy 或 Supabase 隧道，再恢复已备份的 `.env` 与 Compose，比较后重建指定服务；不删除数据库 volume。只有确认存在破坏性数据库迁移才用 SQL 备份恢复。DNS 回滚为先前记录，低 TTL 保留到稳定。

### Kong 端口收紧的即时回滚

如 Caddy 无法转发 Kong，可先确认 `http://127.0.0.1:8000` 的本机可达性。只有确认需要撤销端口收紧时，才恢复 `/home/swing/services/supabase-project/deployment-backups/20260717-192022-kong-loopback-hardening/docker-compose.yml.before` 为 Compose 文件，并执行 `sh run.sh recreate kong`；这会重新暴露 `8000/8443`，因此仅作为短时故障回退，恢复后应再次收紧。
