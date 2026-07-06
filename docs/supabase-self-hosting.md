# 自托管 Supabase 运维与 Mathin 接入

## 当前拓扑

- Supabase Docker 主机：`xiaomi` / `192.168.5.183`
- Compose 目录：`/home/swing/services/supabase-project`
- Kong 局域网入口：`http://192.168.5.183:8000`
- Mathin 开发入口：`http://192.168.5.213:3130`

自托管 Supabase 的系统更新、密钥轮换、备份、监控和灾难恢复由部署者负责。

## 安全修改流程

```bash
ssh xiaomi
cd /home/swing/services/supabase-project
stamp=$(date +%Y%m%d-%H%M%S)
cp -p .env ".env.${stamp}.backup"
cp -p docker-compose.yml "docker-compose.yml.${stamp}.backup"
```

`.env` 的开发期关键项：

```dotenv
SUPABASE_PUBLIC_URL=http://192.168.5.183:8000
API_EXTERNAL_URL=http://192.168.5.183:8000
SITE_URL=http://192.168.5.213:3130
ADDITIONAL_REDIRECT_URLS=http://192.168.5.213:3130,http://192.168.5.213:3130/zh/auth/callback,http://192.168.5.213:3130/en/auth/callback
DISABLE_SIGNUP=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
```

应用配置并检查：

```bash
docker compose up -d --force-recreate auth kong
docker compose ps
docker compose logs --tail=100 auth kong
curl -fsS http://127.0.0.1:8000/auth/v1/health
```

若新配置失败，恢复相同时间戳的两个备份后重新执行 `docker compose up -d --force-recreate auth kong`。确认成功后可将备份移动到仅管理员可读的离线目录；不要复制进本仓库。

## 数据库迁移

- 所有建表与 RLS 以 SQL 文件形式提交在仓库 `supabase/migrations/`，文件名前缀为时间戳，按文件名顺序在 Studio 的 SQL Editor（或宿主机 psql）中手动执行一次。
- 迁移文件只追加、不修改历史文件；需要变更结构时新增一个迁移文件。
- 没有 RLS 策略的表不得合并（docs/plan/03-3）。

## 密钥

- `SUPABASE_PUBLISHABLE_KEY`：允许放入前端 `.env.local`，仍应避免无必要传播。
- `SUPABASE_SECRET_KEY` / `SERVICE_ROLE_KEY`：绕过普通 RLS，仅允许可信服务器使用。本项目当前不需要。
- `JWT_SECRET`、`POSTGRES_PASSWORD`：绝不进入前端、日志、截图或 Git。
- `.env.local` 被 Git 忽略；提交前使用 `git grep` 和 staged diff 检查密钥。

## 从开发切换到生产

当前不配置公网入口。启用 SakuraFRP 前必须完成：

1. 为 Supabase 选择独立域名并通过 SakuraFRP 建立 HTTPS 入口，只转发反向代理的 443。
2. 不直接暴露 5432、6543、8000；Studio 仍需额外身份保护。
3. 将 `SUPABASE_PUBLIC_URL`、`API_EXTERNAL_URL` 改为 Supabase HTTPS 域名。
4. 将 `SITE_URL` 改为 `https://mathin.club`，回调白名单改成精确的生产回调。
5. 前端生产环境使用 HTTPS Supabase URL，禁止回退到局域网 IP。
6. 配置 SMTP 和邮件模板，再将 `ENABLE_EMAIL_AUTOCONFIRM=false`。
7. 验证注册确认、登录、刷新、退出、Storage、Realtime WebSocket、Cookie Secure 属性和跨网络访问。

## 备份与更新

- 定期执行 PostgreSQL 逻辑备份，并在独立主机上做恢复演练；只有“可恢复”的备份才有效。
- 更新前阅读 Supabase 自托管 changelog，固定镜像版本，备份数据库、`.env`、Compose 和 Storage 数据。
- 更新后检查所有容器健康、Auth、REST、Storage、Realtime 和 Studio；不要自动使用 `latest` 镜像。

## 官方参考

- [Docker 自托管](https://supabase.com/docs/guides/self-hosting/docker)
- [Auth 自托管配置](https://supabase.com/docs/guides/self-hosting/auth/config)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Next.js SSR 客户端](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
