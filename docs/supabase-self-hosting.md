# 自托管 Supabase 运维与 Mathin 接入

## 当前拓扑

- Supabase Docker 主机：`xiaomi` / `192.168.5.183`
- Compose 目录：`/home/swing/services/supabase-project`
- 应用使用的 Supabase 地址：`https://supabase.mathin.club`
- 局域网入口：`https://192.168.5.183:443`（保留域名作为 Host/SNI；由 Caddy 转发至 Kong）
- Kong 内部入口：`http://127.0.0.1:8000`；`8000/8443` 仅绑定 Xiaomi loopback，不得从其他设备直连
- Mathin 开发入口：`http://192.168.5.213:3130`

开发机需要局域网直连时，双击仓库根目录的 `Supabase路由切换.cmd` 并选择 `LAN direct`；它只为 `supabase.mathin.club` 写入 `192.168.5.183` 的 hosts 覆盖，并将该域名与 IP 写入用户 `NO_PROXY`，HTTPS 仍使用正式域名和 Caddy 证书。切换后重新打开终端。选择 `Public Internet` 会删除这两类仅由 Mathin 管理的覆盖，便于测试完整 Sakura 公网链路。

自托管 Supabase 的系统更新、密钥轮换、备份、监控和灾难恢复由部署者负责。

## 安全修改流程

```bash
ssh xiaomi
proxy_on # 在此 SSH shell 中使用 curl、git、apt 等联网命令前执行
cd /home/swing/services/supabase-project
stamp=$(date +%Y%m%d-%H%M%S)
cp -p .env ".env.${stamp}.backup"
cp -p docker-compose.yml "docker-compose.yml.${stamp}.backup"
```

`.env` 的开发期关键项：

```dotenv
SUPABASE_PUBLIC_URL=https://supabase.mathin.club
API_EXTERNAL_URL=https://supabase.mathin.club/auth/v1
SITE_URL=https://mathin.club
ADDITIONAL_REDIRECT_URLS=http://192.168.5.213:3130/**,http://localhost:3130/**,https://mathin.club/**
DISABLE_SIGNUP=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
```

应用配置并检查：

```bash
docker compose up -d --force-recreate auth kong
docker compose ps
docker compose logs --tail=100 auth kong
curl -sS -o /dev/null -w '%{http_code}\n' \
  --resolve supabase.mathin.club:443:127.0.0.1 \
  https://supabase.mathin.club/auth/v1/
```

最后一条无 API key 时应返回 `401`，表示 Caddy 已能到达 Kong；不要为获得 `200` 而暴露 Kong 的宿主机端口。

若新配置失败，恢复相同时间戳的两个备份后重新执行 `docker compose up -d --force-recreate auth kong`。确认成功后可将备份移动到仅管理员可读的离线目录；不要复制进本仓库。

## 数据库迁移

- 所有建表与 RLS 以 SQL 文件形式提交在仓库 `supabase/migrations/`，文件名前缀为时间戳，按文件名顺序各执行一次。
- 执行方式：由 agent 通过 SSH 直接应用（用户无需手动跑）：

  ```bash
  (echo "begin;"; cat supabase/migrations/<file>.sql; echo "commit;") \
    | ssh xiaomi "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1"
  ```

  执行前先查 `pg_policies` / `information_schema` 确认未重复应用，执行后验证关键对象生效。
- 迁移文件只追加、不修改历史文件；需要变更结构时新增一个迁移文件。
- 没有 RLS 策略的表不得合并（docs/plan/03-3）。

## Realtime

- 版本：`supabase/realtime:v2.102.3`，支持 Realtime Authorization（私有频道）：`realtime.messages` 表存在，P3 已建 `notes_broadcast_receive_own` / `notes_broadcast_send_own` 两条策略验证过该机制可用。P4 的 `wb:*` / `session:*` 策略随各自 migration 增加。
- **租户限额**存于 `_realtime.tenants`（修改需 `supabase_admin`，普通 `postgres` 无权限），改后需 `docker restart realtime-dev.supabase-realtime` 生效。2026-07-07 已从默认值调高（P4-0，白板笔画流需要）：

  | 参数 | 默认 | 现值 |
  | --- | --- | --- |
  | `max_events_per_second` | 100 | 1000 |
  | `max_bytes_per_second` | 100000 | 5000000 |
  | `max_concurrent_users` | 200 | 500 |
  | `max_joins_per_second` | 100 | 200 |

  查询/修改示例：`ssh xiaomi "docker exec -i supabase-db psql -U supabase_admin -d postgres"`，`update _realtime.tenants set ... where external_id = 'realtime-dev';`
- 注意：限额是**全租户共享**（整个实例一份），不是每频道；broadcast 为 at-most-once，超限静默丢弃。

## 密钥

- `SUPABASE_PUBLISHABLE_KEY`：允许放入前端 `.env.local`，仍应避免无必要传播。
- `SUPABASE_SECRET_KEY` / `SERVICE_ROLE_KEY`：绕过普通 RLS，仅允许可信服务器使用。自 P2 起 Next 服务端需要它（`.env.local` 中的 `SUPABASE_SECRET_KEY`，游戏成绩经服务端校验后落库），仍绝不进入浏览器与 Git。
- `JWT_SECRET`、`POSTGRES_PASSWORD`：绝不进入前端、日志、截图或 Git。
- `.env.local` 被 Git 忽略；提交前使用 `git grep` 和 staged diff 检查密钥。

## 公网部署状态

2026-07-18 已完成 Caddy DNS-01 自动证书、Sakura 443 透传、Supabase 公共 URL 切换，以及 Kong loopback 收口。公网 `mathin.club` 与 `supabase.mathin.club` 均已可达；前端不再从 Windows 运行，而是由 Xiaomi 的 `mathin.service` 在 loopback `3131` 运行。

仍需在真实浏览器会话中完成：登录/刷新/退出、Storage 小文件与 10–20 MiB TUS、Realtime、Studio、Cookie 行为，以及 SMTP/邮件模板配置后关闭 `ENABLE_EMAIL_AUTOCONFIRM`。这些验收完成前，不得将 Kong `8000/8443` 重新暴露到局域网或公网。

## Mathin 日常发布

开发机不再承担生产进程。完成开发后，双击仓库根目录的 `发布到生产.cmd`：

1. `CHECK`：要求工作区和暂存区均无改动，再执行 `pnpm lint`、`pnpm typecheck`、`pnpm build`。
2. `PUBLISH`：先执行同一套本地检查；通过后将**当前已提交的 Git commit**以 `git archive` 传到 Xiaomi，在 Linux 上安装依赖、构建 standalone release、原子切换 `current`、重启 `mathin.service`，并检查 loopback 与 Caddy health。
3. `STATUS`：只读显示当前/上一 release、其 commit 元数据、`mathin.service`、loopback health 和 Caddy health。
4. `ROLLBACK`：需要输入 `ROLLBACK` 确认；将 `current` 与 `previous` 两个 release 指针互换并验活。

生产环境变量始终只从 Xiaomi 的 `/home/swing/services/mathin/config/.env.production.local` 读取，绝不从开发机 `.env.local` 复制。发布器在 Xiaomi 的交互 shell 中先运行 `proxy_on`，再执行 `pnpm install`；这样联网依赖安装遵守服务器代理约定，而其本机 health 检查明确绕过代理。

发布器只接受已经提交的代码，但不会代替开发者创建 commit 或 push。推荐顺序是：本地开发与浏览器验收 → `git commit` / `git push` → 双击发布器选择 `PUBLISH` → 浏览器复测本次功能。不要从 Windows 复制 `.next` 或 `node_modules` 到 Linux；Linux 必须自行构建。数据库迁移仍应作为独立的、先向后兼容后发布应用的步骤处理。

首次使用前，先将发布器及其 Linux release 脚本提交到 Git。第一次成功发布会以当前运行版本建立 `previous` 指针；此前 Xiaomi 只有一个 release，因此不能回滚。

## 备份与更新

- 定期执行 PostgreSQL 逻辑备份，并在独立主机上做恢复演练；只有“可恢复”的备份才有效。
- 更新前阅读 Supabase 自托管 changelog，固定镜像版本，备份数据库、`.env`、Compose 和 Storage 数据。
- 更新后检查所有容器健康、Auth、REST、Storage、Realtime 和 Studio；不要自动使用 `latest` 镜像。

## 官方参考

- [Docker 自托管](https://supabase.com/docs/guides/self-hosting/docker)
- [Auth 自托管配置](https://supabase.com/docs/guides/self-hosting/auth/config)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Next.js SSR 客户端](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
