# Mathin + 自部署 Supabase 公网部署实施计划

> 文档用途：交给自动化 Agent 按阶段实施、验证和回滚  
> 编制日期：2026-07-17  
> 目标环境：
>
> - Windows 前端主机：`192.168.5.213`
> - Linux / Supabase 主机：`192.168.5.183`
> - 当前 Next.js 开发端口：`3130`
> - 当前 Supabase Kong HTTP 入口：`8000`
> - 公网前端域名：`https://mathin.club`
> - 公网 Supabase 域名：`https://supabase.mathin.club`
> - 公网入口：Sakura FRP
> - 内网开发：直接走局域网，不消耗 FRP 流量
> - Supabase 大文件上传：必须支持大于 6 MB 的 TUS resumable upload

> 实施更新（2026-07-18）：生产 Mathin 已迁至 Xiaomi 的 Linux `mathin.service`，Windows 仅保留开发用途。本计划中 Windows 生产运行与任务计划程序章节是原始方案记录，不得用于后续发布；以 `docs/supabase-self-hosting.md`、`scripts/ops/` 和 `docs/runbooks/public-deployment-2026-07-17/` 为当前运行手册。

---

## 0. 最终目标与不可变约束

### 0.1 最终访问关系

| 场景 | 前端地址 | Supabase 地址 | 实际流量 |
|---|---|---|---|
| 内网开发 | `http://192.168.5.213:3130` | `https://supabase.mathin.club` | 前端直连 Windows；Supabase 经内网 DNS 直连 Linux |
| 公网测试/生产 | `https://mathin.club` | `https://supabase.mathin.club` | 两个域名分别经 Sakura FRP |
| Supabase Studio/管理 | `https://supabase.mathin.club` 下的现有网关路径 | 同上 | 内网 DNS 或 Sakura FRP |

### 0.2 端口职责

| 主机 | 端口 | 用途 | 是否公网穿透 |
|---|---:|---|---|
| Windows `192.168.5.213` | `3130` | Next.js 开发实例，运行 `pnpm dev` | **否** |
| Windows `192.168.5.213` | `3131` | Next.js 生产构建实例 | **是** |
| Linux `192.168.5.183` | `443` | Caddy HTTPS 入口，代理 Supabase Kong | 内网直连；公网优先也经过此入口 |
| Linux `192.168.5.183` | `8000` | Kong 内部 HTTP 入口 | 不直接暴露给公网浏览器 |
| Supabase Storage 容器 | `5000` | Storage API 容器内部端口 | 否 |

### 0.3 Agent 必须遵守

1. **禁止把 `next dev` 直接暴露到公网。**
2. 不得在未备份 `.env`、Compose 文件和数据库的情况下重建 Supabase 容器。
3. 不得重新生成或替换现有 `JWT_SECRET`、`ANON_KEY`、`SERVICE_ROLE_KEY`、数据库密码。
4. 不得提交 `.env`、DNS API Token、证书私钥到 Git。
5. 所有配置变更必须先生成 diff，记录原值和新值。
6. 每个阶段必须完成验收后再进入下一阶段。
7. 出现错误时优先回滚本阶段，不得连续修改多个层级后再一起排查。
8. Sakura FRP 的公网域名必须拆分：
   - `mathin.club` → Mathin 前端
   - `supabase.mathin.club` → Supabase 后端
9. Supabase 的规范公共地址始终为：

```text
https://supabase.mathin.club
```

10. Storage 生成的 TUS `Location` 地址不得包含：

```text
localhost
192.168.5.183
:8000
http://supabase.mathin.club
```

---

# 1. 推荐架构

## 1.1 内网开发链路

```text
浏览器
  │
  ├─ http://192.168.5.213:3130
  │       └─ Next.js 开发实例
  │
  └─ https://supabase.mathin.club
          │
          └─ 内网 DNS / hosts
                  └─ 192.168.5.183:443
                          └─ Caddy
                                  └─ 127.0.0.1:8000
                                          └─ Kong
                                                  └─ Auth / REST / Storage / Realtime
```

## 1.2 公网链路

```text
https://mathin.club
  └─ Sakura FRP
      └─ Windows 127.0.0.1:3131
          └─ Next.js standalone 生产实例

https://supabase.mathin.club
  └─ Sakura FRP
      └─ Linux HTTPS 入口 192.168.5.183:443
          └─ Caddy
              └─ Kong 127.0.0.1:8000
                  └─ Supabase 服务
```

## 1.3 证书职责

| 域名 | 公网证书 | 内网证书 |
|---|---|---|
| `mathin.club` | Sakura FRP 自动 HTTPS | 内网开发直接使用 `http://192.168.5.213:3130`，不要求证书 |
| `supabase.mathin.club` | Sakura FRP HTTPS 或透传到 Caddy | Linux Caddy 使用 ACME DNS-01 自动签发和续签 |

该方案不要求在 Windows 上手工部署证书。

---

# 2. 实施前审计

## 2.1 Linux / Supabase 审计

通过 SSH 登录 `192.168.5.183`，仅收集信息，不修改配置。

```bash
hostnamectl
ip addr
docker version
docker compose version
docker compose ps
docker compose images
```

定位 Supabase 项目目录：

```bash
find /opt /srv /home -maxdepth 4 \
  \( -name docker-compose.yml -o -name compose.yml \) \
  2>/dev/null | grep -i supabase
```

进入实际目录后：

```bash
pwd
docker compose config > compose.effective.before.yml
docker compose ps > compose.ps.before.txt
docker compose images > compose.images.before.txt
```

检查当前关键配置，输出时必须脱敏：

```bash
grep -E \
'^(SUPABASE_PUBLIC_URL|API_EXTERNAL_URL|SITE_URL|ADDITIONAL_REDIRECT_URLS|KONG_HTTP_PORT|KONG_HTTPS_PORT|PROXY_DOMAIN)=' \
.env
```

检查 Storage 配置：

```bash
docker compose config | grep -n -E \
'STORAGE_PUBLIC_URL|REQUEST_ALLOW_X_FORWARDED_PATH|FILE_SIZE_LIMIT|TUS_URL_PATH|KONG_PORT_MAPS'
```

检查当前监听：

```bash
sudo ss -lntp | grep -E ':(80|443|8000|8443)\b'
```

### 审计输出要求

Agent 生成：

```text
deployment-audit/
├─ linux-host.txt
├─ compose.effective.before.yml
├─ compose.ps.before.txt
├─ compose.images.before.txt
├─ env-summary.redacted.txt
└─ listening-ports.before.txt
```

## 2.2 Windows / Mathin 审计

在 PowerShell 中：

```powershell
Get-ComputerInfo |
  Select-Object WindowsProductName, WindowsVersion, OsArchitecture

node --version
pnpm --version
git --version

Get-NetTCPConnection -State Listen |
  Where-Object LocalPort -in 3130,3131 |
  Format-Table -AutoSize
```

进入 Mathin 仓库：

```powershell
Set-Location '<MATHIN_REPOSITORY>'
git status
git branch --show-current
git rev-parse HEAD
git remote -v
pnpm list next react react-dom --depth 0
```

检查现有脚本和环境文件：

```powershell
Get-Content package.json -Encoding UTF8
Get-ChildItem -Force .env*
```

不得直接输出密钥值，只确认变量名称是否存在：

```powershell
Get-Content .env.local -Encoding UTF8 |
  Where-Object { $_ -match '^[A-Z0-9_]+=' } |
  ForEach-Object { ($_ -split '=', 2)[0] }
```

---

# 3. 备份与回滚基线

## 3.1 Supabase 配置备份

在 Linux Supabase 目录执行：

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$PWD/deployment-backups/$STAMP"
mkdir -p "$BACKUP_DIR"

cp -a .env "$BACKUP_DIR/.env"
cp -a docker-compose.yml "$BACKUP_DIR/docker-compose.yml"

[ -f docker-compose.caddy.yml ] && \
  cp -a docker-compose.caddy.yml "$BACKUP_DIR/"

[ -d volumes ] && \
  tar --exclude='volumes/db/data' \
      -czf "$BACKUP_DIR/volumes-config.tar.gz" volumes
```

执行数据库逻辑备份。Agent 应先读取 `.env` 获得容器名和数据库信息，不得把密码写入命令历史或日志。

建议使用容器内 `pg_dumpall` 或项目已有备份脚本：

```bash
docker compose exec -T db \
  pg_dumpall -U postgres \
  > "$BACKUP_DIR/postgres-all.sql"
```

如数据库较大，应至少完成：

- 数据库 schema 备份；
- Auth 用户表和业务 schema 备份；
- Storage 元数据表备份；
- 当前 Docker volume 列表记录。

```bash
docker volume ls > "$BACKUP_DIR/docker-volumes.txt"
```

## 3.2 Windows 构建备份

```powershell
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = "D:\services\mathin\backups\$Stamp"
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

git status | Out-File "$BackupRoot\git-status.txt" -Encoding utf8
git rev-parse HEAD | Out-File "$BackupRoot\git-commit.txt" -Encoding ascii
```

如已有生产目录：

```powershell
if (Test-Path 'D:\services\mathin\current') {
    robocopy 'D:\services\mathin\current' $BackupRoot /MIR /R:2 /W:1
}
```

---

# 4. DNS 规划

## 4.1 公网 DNS

最终需要：

| 记录 | 类型 | 指向 |
|---|---|---|
| `mathin.club` | 按 Sakura FRP 面板要求配置 CNAME/A | Mathin 前端隧道节点 |
| `supabase.mathin.club` | 按 Sakura FRP 面板要求配置 CNAME/A | Supabase 隧道节点 |

实施前将 DNS TTL 临时降低至 `300` 秒。

Agent 不得猜测 Sakura 节点记录值，必须读取隧道面板提供的目标域名或节点地址。

## 4.2 内网 DNS 分流

内网只强制分流 Supabase：

```text
supabase.mathin.club → 192.168.5.183
```

推荐按优先级选择：

1. 路由器本地 DNS 重写；
2. AdGuard Home / Pi-hole；
3. 开发电脑 `hosts`；
4. 临时 `Resolve-DnsName` + `curl --resolve` 测试。

Windows 临时 hosts：

```text
C:\Windows\System32\drivers\etc\hosts
```

追加：

```text
192.168.5.183    supabase.mathin.club
```

刷新：

```powershell
ipconfig /flushdns
Resolve-DnsName supabase.mathin.club
```

验收结果必须指向：

```text
192.168.5.183
```

内网开发前端继续直接使用：

```text
http://192.168.5.213:3130
```

因此暂不需要为 `mathin.club` 设置内网 DNS，也不需要在 Windows 上部署本地 HTTPS。

---

# 5. Linux：为 Supabase 配置 Caddy 自动证书

## 5.1 为什么使用 DNS-01

Linux 主机没有直接公网入口，公网 DNS 指向 Sakura FRP 节点，因此不应依赖直接开放 80/443 的 HTTP-01 或 TLS-ALPN-01。

使用 DNS-01 的优点：

- 不要求 Linux 服务器直接拥有公网 IP；
- 不要求公网 80/443 直接到达 Caddy；
- 适配内外 DNS 分流；
- 可自动签发和续签；
- 证书仍是浏览器信任的公开证书。

## 5.2 Agent 的前置判断

Agent 必须先确认 `mathin.club` 的权威 DNS 服务商：

```bash
dig NS mathin.club +short
```

然后确认：

1. 该 DNS 服务商是否提供 DNS API；
2. Caddy 是否有对应 `caddy-dns` provider；
3. 是否可以创建仅允许修改 `mathin.club` DNS 记录的最小权限 Token；
4. Token 是否会过期。

如果当前 DNS 服务商没有可用插件，使用下面之一：

- 将 `_acme-challenge.supabase.mathin.club` CNAME 委托给支持 API 的 DNS 区域；
- 改用 `acme.sh` 的 DNS API 插件签发证书；
- 不得退回每年手工购买和替换证书。

## 5.3 使用独立 Caddy Docker 项目

建议目录：

```text
/opt/caddy-supabase/
├─ Dockerfile
├─ compose.yml
├─ Caddyfile
├─ .env
├─ data/
└─ config/
```

### Dockerfile

将 `<provider-module>` 替换为实际插件。例如插件地址必须来自对应 Caddy DNS provider 官方仓库。

```dockerfile
FROM caddy:2-builder AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/<provider-module>

FROM caddy:2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

### compose.yml

```yaml
services:
  caddy:
    build:
      context: .
    container_name: caddy-supabase
    restart: unless-stopped
    network_mode: host

    environment:
      DNS_API_TOKEN: ${DNS_API_TOKEN}

    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./data:/data
      - ./config:/config
```

### `.env`

```env
DNS_API_TOKEN=<仅允许修改本域名DNS记录的最小权限Token>
```

权限：

```bash
chmod 600 /opt/caddy-supabase/.env
chmod 700 /opt/caddy-supabase/data
chmod 700 /opt/caddy-supabase/config
```

### Caddyfile

将 `<provider>` 替换为插件在 Caddyfile 中要求的 provider 名称。

```caddyfile
{
    email admin@mathin.club
}

supabase.mathin.club {
    tls {
        dns <provider> {env.DNS_API_TOKEN}
    }

    encode zstd gzip

    reverse_proxy 127.0.0.1:8000 {
        header_up Host {host}
        header_up X-Forwarded-Host {host}
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Port 443
    }

    log {
        output file /data/access.log {
            roll_size 20MiB
            roll_keep 10
            roll_keep_for 720h
        }
    }
}
```

Caddy 默认支持 WebSocket 代理，因此 Supabase Realtime 不需要单独配置升级规则。

## 5.4 启动和验证证书

```bash
cd /opt/caddy-supabase
docker compose build --pull
docker compose up -d
docker compose logs --tail=200 -f
```

确认插件被正确编译：

```bash
docker compose exec caddy caddy list-modules | grep dns
```

确认证书：

```bash
openssl s_client \
  -connect 192.168.5.183:443 \
  -servername supabase.mathin.club \
  </dev/null 2>/dev/null |
openssl x509 -noout -subject -issuer -dates
```

使用强制解析测试：

```bash
curl -I \
  --resolve supabase.mathin.club:443:192.168.5.183 \
  https://supabase.mathin.club/auth/v1/
```

预期：

- TLS 无证书错误；
- HTTP 返回 `401`、`404` 或 Auth 的正常网关响应均可；
- 不能是连接失败或 TLS 错误。

---

# 6. Linux：更新 Supabase 公共 URL 与 Storage 配置

## 6.1 `.env` 目标值

在现有 `.env` 中修改，不得覆盖其他密钥：

```env
SUPABASE_PUBLIC_URL=https://supabase.mathin.club
API_EXTERNAL_URL=https://supabase.mathin.club/auth/v1
SITE_URL=https://mathin.club

ADDITIONAL_REDIRECT_URLS=http://192.168.5.213:3130/**,http://localhost:3130/**,https://mathin.club/**

PROXY_DOMAIN=supabase.mathin.club

KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443
```

说明：

- `SUPABASE_PUBLIC_URL` 是 Supabase API、Storage、Realtime 的规范外部地址；
- `API_EXTERNAL_URL` 必须包含 `/auth/v1`；
- `SITE_URL` 是 Mathin 前端，不是 Supabase 地址；
- 本地开发登录回调通过 `ADDITIONAL_REDIRECT_URLS` 放行；
- 不使用 `https://mathin.club:8000`；
- 不使用 `http://192.168.5.183:8000` 作为公共 URL。

## 6.2 Storage 服务目标配置

在当前 `docker-compose.yml` 的 Storage 服务下确认存在：

```yaml
storage:
  environment:
    STORAGE_PUBLIC_URL: ${SUPABASE_PUBLIC_URL}
    REQUEST_ALLOW_X_FORWARDED_PATH: "true"
    FILE_SIZE_LIMIT: 52428800
```

`52428800` 为 50 MiB。只有产品确实需要更大文件时才提高，例如 500 MiB：

```yaml
FILE_SIZE_LIMIT: 524288000
```

Agent 必须同时检查：

- Bucket 本身是否设置了更小的 `file_size_limit`；
- 应用是否在客户端限制了文件大小；
- 反向代理或 Sakura 节点是否有请求体限制。

## 6.3 TUS 路径规则

当前推荐：

```text
容器内部：/upload/resumable
公网入口：/storage/v1/upload/resumable
```

处理规则：

1. 如果没有配置 `TUS_URL_PATH`，保持默认，不新增。
2. 如果当前配置为：

```yaml
TUS_URL_PATH: /upload/resumable
```

可以保留。
3. 如果当前配置为：

```yaml
TUS_URL_PATH: /storage/v1/upload/resumable
```

先记录旧值，然后删除该覆盖项，使用最新默认行为。
4. 不得同时在 Kong 路径和 Storage 路径中重复加入 `/storage/v1`。

## 6.4 Kong 暴露范围

优先将 Kong 的宿主机端口限制在本机：

```yaml
kong:
  ports:
    - "127.0.0.1:${KONG_HTTP_PORT}:8000/tcp"
```

前提：

- Caddy 与 Sakura frpc 均运行在 Linux 本机；
- 不再需要其他局域网设备直接访问 `192.168.5.183:8000`。

如果当前部署结构要求局域网访问 8000，可暂时保留原绑定，待公网验收后再收紧。

## 6.5 重建相关容器

先验证 Compose：

```bash
docker compose config > compose.effective.after.yml
diff -u compose.effective.before.yml compose.effective.after.yml || true
```

使用项目当前支持的方式重建：

```bash
sh run.sh recreate
```

如果旧部署没有 `run.sh`：

```bash
docker compose up -d --force-recreate \
  kong auth storage realtime rest studio
```

不要重建或删除数据库 volume。

检查：

```bash
docker compose ps
docker compose logs --tail=200 kong storage auth realtime
```

检查容器实际环境：

```bash
docker compose exec storage printenv |
  grep -E \
'STORAGE_PUBLIC_URL|REQUEST_ALLOW_X_FORWARDED_PATH|FILE_SIZE_LIMIT|TUS_URL_PATH'
```

预期至少包含：

```text
STORAGE_PUBLIC_URL=https://supabase.mathin.club
REQUEST_ALLOW_X_FORWARDED_PATH=true
FILE_SIZE_LIMIT=52428800
```

---

# 7. Windows：分离开发实例与公网生产实例

## 7.1 不再穿透 3130

现有端口：

```text
3130 = pnpm dev = 内网开发
```

新增端口：

```text
3131 = production build = Sakura FRP 公网入口
```

原因：

- `next dev` 不是生产服务器；
- 开发热更新、调试端点和错误堆栈不应暴露公网；
- 开发实例重启会直接影响公网；
- 生产构建和开发构建的缓存、环境变量与行为不同。

## 7.2 Next.js 配置

在 `next.config.ts` 或 `next.config.js` 中增加：

```ts
const nextConfig = {
  output: 'standalone',
}

export default nextConfig
```

如项目使用 CommonJS：

```js
module.exports = {
  output: 'standalone',
}
```

Agent 必须合并现有配置，不得覆盖现有 `images`、`i18n`、`headers`、`rewrites` 等设置。

## 7.3 环境变量

### `.env.local`：内网开发

```env
NEXT_PUBLIC_SUPABASE_URL=https://supabase.mathin.club
NEXT_PUBLIC_SUPABASE_ANON_KEY=<现有ANON_KEY>
NEXT_PUBLIC_SITE_URL=http://192.168.5.213:3130
```

### `.env.production.local`：生产构建

```env
NEXT_PUBLIC_SUPABASE_URL=https://supabase.mathin.club
NEXT_PUBLIC_SUPABASE_ANON_KEY=<现有ANON_KEY>
NEXT_PUBLIC_SITE_URL=https://mathin.club
```

重要规则：

1. `NEXT_PUBLIC_*` 会在 `pnpm build` 时写入前端 bundle；
2. 修改 `.env.production.local` 后必须重新构建；
3. `SERVICE_ROLE_KEY` 不得带 `NEXT_PUBLIC_` 前缀；
4. 不得在浏览器端使用 `SERVICE_ROLE_KEY`；
5. 如果存在服务端专用 Supabase 客户端，密钥只放在服务器环境变量中。

## 7.4 构建命令

```powershell
Set-Location '<MATHIN_REPOSITORY>'

pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
```

复制 standalone 缺少的静态目录：

```powershell
robocopy public .next\standalone\public /E /R:2 /W:1

New-Item -ItemType Directory `
  -Force `
  -Path .next\standalone\.next\static |
  Out-Null

robocopy .next\static .next\standalone\.next\static /E /R:2 /W:1
```

注意：`robocopy` 返回码 `0–7` 通常不代表失败，Agent 必须正确处理返回码。

## 7.5 部署目录

推荐：

```text
D:\services\mathin\
├─ releases\
│  ├─ 20260717-xxxxxx\
│  └─ ...
├─ current\
├─ scripts\
│  ├─ start-mathin-prod.ps1
│  └─ deploy-mathin-prod.ps1
└─ logs\
```

每次部署先复制到新的 release，再切换 `current`，不得直接在运行目录内执行 `pnpm build`。

最低可接受实现：

```powershell
$Release = "D:\services\mathin\releases\$(Get-Date -Format yyyyMMdd-HHmmss)"

New-Item -ItemType Directory -Force $Release | Out-Null

robocopy `
  '<MATHIN_REPOSITORY>\.next\standalone' `
  $Release `
  /MIR /R:2 /W:1
```

## 7.6 启动脚本

`D:\services\mathin\scripts\start-mathin-prod.ps1`：

```powershell
$ErrorActionPreference = 'Stop'

$env:NODE_ENV = 'production'
$env:PORT = '3131'

# Sakura frpc 运行在同一台 Windows 主机时，只绑定回环地址。
$env:HOSTNAME = '127.0.0.1'

Set-Location 'D:\services\mathin\current'

$LogDir = 'D:\services\mathin\logs'
New-Item -ItemType Directory -Force $LogDir | Out-Null

node .\server.js `
  1>> "$LogDir\stdout.log" `
  2>> "$LogDir\stderr.log"
```

## 7.7 注册开机任务

优先使用 Windows 任务计划程序，避免额外服务管理软件。

```powershell
$Action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "D:\services\mathin\scripts\start-mathin-prod.ps1"'

$Trigger = New-ScheduledTaskTrigger -AtStartup

$Settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName 'Mathin Production' `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -RunLevel Highest `
  -User 'SYSTEM'
```

启动：

```powershell
Start-ScheduledTask -TaskName 'Mathin Production'
```

确认：

```powershell
Get-ScheduledTask -TaskName 'Mathin Production'
Get-NetTCPConnection -LocalPort 3131 -State Listen
Invoke-WebRequest http://127.0.0.1:3131 -UseBasicParsing
```

## 7.8 健康检查

如果项目还没有健康端点，新增：

```text
GET /api/health
```

返回示例：

```json
{
  "status": "ok",
  "service": "mathin",
  "environment": "production"
}
```

不得在健康接口返回密钥、数据库连接或完整环境变量。

---

# 8. Sakura FRP 配置

## 8.1 前端隧道

目标：

```text
https://mathin.club
→ Windows 127.0.0.1:3131
```

建议参数：

| 参数 | 值 |
|---|---|
| 绑定域名 | `mathin.club` |
| 本地 IP | `127.0.0.1` |
| 本地端口 | `3131` |
| 本地协议 | HTTP |
| 公网 HTTPS | 启用 Sakura 自动 HTTPS |
| HTTP 跳转 HTTPS | 启用，使用 301 或 308 |
| 访问认证 | 生产环境关闭 |
| 压缩 | 按节点能力测试 |
| Host | 必须保留 `mathin.club` |

如 Sakura 面板要求 TCP 隧道才能对本地 HTTP 服务启用自动 HTTPS，则按照当前面板创建 TCP + 自动 HTTPS + 域名绑定，不得改为直接穿透开发端口。

## 8.2 Supabase 隧道：优先方案

目标：

```text
https://supabase.mathin.club
→ Linux Caddy 443
→ Kong 8000
```

推荐参数：

| 参数 | 值 |
|---|---|
| 绑定域名 | `supabase.mathin.club` |
| 本地协议 | HTTPS |
| 本地目标 | `supabase.mathin.club:443` 或 `127.0.0.1:443` |
| 公网 HTTPS | 启用 |
| HTTP 跳转 HTTPS | 启用 |
| WebSocket | 必须支持 |
| 请求方法 | 必须允许 `OPTIONS`、`POST`、`HEAD`、`PATCH`、`DELETE` |
| 上传超时 | 尽可能提高 |
| 请求体限制 | 不得小于 Supabase 的 `FILE_SIZE_LIMIT` |

如果 frpc 运行在 Linux 本机，建议在 Linux `/etc/hosts` 中加入：

```text
127.0.0.1    supabase.mathin.club
```

这样隧道连接本地 HTTPS 时，主机名和证书名称一致。

## 8.3 Supabase 隧道：兼容回退方案

如果 Sakura HTTPS 隧道无法稳定代理本地 HTTPS，可回退为：

```text
公网 Sakura 自动 HTTPS
→ 本地 HTTP 127.0.0.1:8000
```

此模式下必须额外验证：

- `X-Forwarded-Proto` 最终为 `https`；
- `Host` 为 `supabase.mathin.club`；
- TUS `Location` 使用 `https://supabase.mathin.club`；
- Realtime WebSocket 正常；
- 不出现 `:8000`。

只有在测试发现 TUS Location 仍包含 `:8000` 时，才评估在 Kong 环境增加：

```yaml
KONG_PORT_MAPS: "443:8000"
```

不得把该项作为未经验证的默认修复。

---

# 9. 上线顺序

## 阶段 A：内部 HTTPS 与 Supabase 配置

1. 完成 Supabase 备份。
2. 建立 Linux Caddy DNS-01 自动证书。
3. 使用 `curl --resolve` 验证 `supabase.mathin.club` 内网 HTTPS。
4. 配置内网 DNS/hosts。
5. 更新 Supabase `.env`。
6. 更新 Storage 环境变量。
7. 重建 Supabase 相关容器。
8. 验证 Auth、REST、Realtime 和 Storage。

通过后才进入阶段 B。

## 阶段 B：Windows 生产构建

1. 保留 3130 开发实例。
2. 增加 `output: 'standalone'`。
3. 创建 `.env.production.local`。
4. 构建并复制 standalone 目录。
5. 在 3131 启动生产实例。
6. 完成本机健康检查。
7. 注册开机任务。
8. 验证重启后自动恢复。

通过后才进入阶段 C。

## 阶段 C：Sakura FRP

1. 创建 `mathin.club` 前端隧道，目标 3131。
2. 创建 `supabase.mathin.club` 后端隧道。
3. 先用 Sakura 提供的临时连接方式测试。
4. 配置公网 DNS。
5. 等待 DNS 生效。
6. 测试 HTTPS、WebSocket、Auth 和大文件上传。
7. 将 DNS TTL 从 300 调回正常值。

---

# 10. 验收清单

## 10.1 域名与 TLS

```powershell
Resolve-DnsName mathin.club
Resolve-DnsName supabase.mathin.club
```

公网：

```powershell
curl.exe -I https://mathin.club
curl.exe -I https://supabase.mathin.club/auth/v1/
```

内网强制验证 Supabase：

```powershell
curl.exe -I `
  --resolve supabase.mathin.club:443:192.168.5.183 `
  https://supabase.mathin.club/auth/v1/
```

验收标准：

- 两个域名证书均有效；
- 无混合内容错误；
- Supabase 内网解析不经过 FRP；
- `mathin.club` 返回 Next.js 页面；
- Auth 路径能够到达网关。

## 10.2 Next.js

- 首页可打开；
- 中英文路由正常；
- SSR 页面正常；
- `next/image` 正常；
- 登录/退出正常；
- Cookie 域、Secure 和 SameSite 行为正常；
- Server Actions 不出现 origin mismatch；
- 刷新动态路由不返回 404；
- WebSocket 或 SSE 功能不被缓冲；
- 3130 开发实例不影响 3131 生产实例。

## 10.3 Supabase

验证：

```text
/auth/v1/
/rest/v1/
/storage/v1/
/realtime/v1/
```

至少完成：

- 邮箱密码登录；
- 刷新 token；
- 数据库查询；
- Storage 小文件上传；
- Storage 大文件 TUS 上传；
- 公共对象访问；
- 签名 URL；
- Realtime 订阅；
- Studio 登录。

## 10.4 大于 6 MB 上传专项测试

准备一个 10–20 MB 文件。

浏览器 DevTools Network 中应看到类似：

```text
POST  https://supabase.mathin.club/storage/v1/upload/resumable
PATCH https://supabase.mathin.club/storage/v1/upload/resumable/...
HEAD  https://supabase.mathin.club/storage/v1/upload/resumable/...
```

重点检查首次创建上传的响应头：

```text
Location: https://supabase.mathin.club/storage/v1/upload/resumable/...
```

禁止出现：

```text
http://localhost/...
http://192.168.5.183:8000/...
https://supabase.mathin.club:8000/...
https://mathin.club:8000/...
```

建议状态码：

| 请求 | 典型状态 |
|---|---:|
| 创建上传 `POST` | `201` |
| 上传分片 `PATCH` | `204` |
| 查询偏移 `HEAD` | `200` 或协议规定的正常状态 |

修改 TUS 公共地址后，应清除浏览器该站点的本地存储和旧上传 fingerprint，再重新测试。

## 10.5 内网不走 FRP 的验证

在内网 Windows 上：

```powershell
Resolve-DnsName supabase.mathin.club
tracert supabase.mathin.club
```

应指向：

```text
192.168.5.183
```

同时观察 Sakura 流量统计。内网上传大文件时，Supabase 隧道流量不应显著增长。

---

# 11. 安全收口

## 11.1 Linux

- Kong 8000 优先只绑定 `127.0.0.1`；
- PostgreSQL 5432 不得通过 Sakura 暴露；
- Studio 不额外创建独立公网端口；
- Caddy DNS Token 使用最小权限；
- `.env` 权限设为 `600`；
- Caddy `/data` 和 `/config` 必须持久化；
- 定期检查 Caddy 续签日志；
- Docker socket 不挂载给无关容器；
- 只允许 SSH 密钥登录；
- 禁止 root 密码公网登录。

## 11.2 Windows

- 3131 只绑定 `127.0.0.1`；
- 3130 仅允许可信局域网；
- 不把 `.env.production.local` 提交到 Git；
- 任务计划程序使用最小必要权限；
- 部署脚本不得输出密钥；
- 日志启用轮转，避免磁盘占满；
- Sakura 启动器/服务配置开机自启；
- Windows 更新重启后自动恢复生产实例和隧道。

## 11.3 Supabase

- `SERVICE_ROLE_KEY` 仅服务器端使用；
- 检查 Storage RLS；
- 检查公开 bucket 是否确实需要公开；
- 检查 Auth redirect allowlist；
- 不使用通配符放行不受控公网域名；
- 对上传文件执行 MIME、扩展名和大小校验；
- 不依赖前端校验作为唯一安全措施。

---

# 12. 监控与自动检查

## 12.1 Linux 健康检查脚本

建议创建：

```text
/usr/local/bin/check-supabase-public.sh
```

检查：

```bash
#!/usr/bin/env bash
set -euo pipefail

curl -fsS \
  --max-time 15 \
  https://supabase.mathin.club/auth/v1/ \
  >/dev/null || true

echo | openssl s_client \
  -connect supabase.mathin.club:443 \
  -servername supabase.mathin.club \
  2>/dev/null |
openssl x509 -noout -checkend $((14 * 24 * 3600))
```

说明：Auth 根路径可能正常返回 401，因此实际脚本应按项目的健康端点调整，不能简单把所有非 2xx 都视为离线。

## 12.2 Windows 健康检查

```powershell
Invoke-WebRequest `
  http://127.0.0.1:3131/api/health `
  -TimeoutSec 10 `
  -UseBasicParsing
```

建议每 5 分钟检查一次，并在失败时：

1. 重启 `Mathin Production` 任务；
2. 记录日志；
3. 不自动执行 `git pull` 或重建。

---

# 13. 更新流程

## 13.1 Mathin 发布

```text
git fetch
→ 检查工作区
→ pnpm install --frozen-lockfile
→ lint/test
→ production build
→ 创建新 release
→ 本机 3132 临时冒烟测试
→ 切换 current
→ 重启 3131 服务
→ 公网健康检查
→ 保留上一版本用于回滚
```

不要直接在运行中的 `current` 目录内构建。

## 13.2 Supabase 更新

Supabase 自部署更新必须：

1. 阅读当前版本 Release Notes；
2. 备份数据库；
3. 保存现有 Compose 与 `.env`；
4. 对比最新官方 Compose；
5. 逐项合并，不直接覆盖；
6. 重点保留：
   - `STORAGE_PUBLIC_URL`
   - `REQUEST_ALLOW_X_FORWARDED_PATH`
   - Caddy 配置
   - Auth URL
   - 自定义数据库设置
7. 更新后重新执行大文件上传验收。

---

# 14. 回滚方案

## 14.1 Windows 回滚

1. 停止 `Mathin Production` 任务；
2. 将 `current` 恢复为上一 release；
3. 重新启动任务；
4. 验证 `127.0.0.1:3131`；
5. 验证公网 `mathin.club`。

开发实例 3130 不参与生产回滚。

## 14.2 Supabase 配置回滚

1. 停止新 Caddy 或临时禁用 Sakura 后端隧道；
2. 恢复 `.env` 备份；
3. 恢复 `docker-compose.yml`；
4. 执行：

```bash
docker compose config
docker compose up -d --force-recreate \
  kong auth storage realtime rest studio
```

5. 不删除数据库 volume；
6. 如数据库 schema 没有变更，不执行数据库恢复；
7. 只有确认数据库发生破坏性迁移时才使用 SQL 备份恢复。

## 14.3 DNS 回滚

- 恢复旧 DNS 记录；
- 保持低 TTL，直到服务稳定；
- 禁止同时保留两个不同隧道抢占同一域名。

---

# 15. Agent 最终交付物

Agent 完成部署后必须提交以下文件，均需脱敏：

```text
docs/runbooks/public-deployment-2026-07-17/
├─ 00-architecture.md
├─ 01-audit-before.md
├─ 02-changes.md
├─ 03-linux-supabase.md
├─ 05-sakura-frp.md
├─ 06-dns.md
├─ 07-test-results.md
├─ 08-large-upload-test.md
├─ 09-security-checklist.md
├─ 10-rollback.md
├─ compose.diff
├─ env.diff.redacted
└─ screenshots/
```

`07-test-results.md` 至少包含：

- 测试时间；
- 测试网络：内网/公网；
- 域名解析结果；
- TLS 颁发者和有效期；
- Next.js commit；
- Supabase 镜像版本；
- Auth 测试；
- REST 测试；
- Realtime 测试；
- Storage 小文件测试；
- Storage 10–20 MB TUS 测试；
- TUS `Location` 响应头；
- 是否确认内网流量未经过 FRP。

---

# 16. 完成定义

只有同时满足下列条件，任务才算完成：

- [ ] `3130` 只用于内网开发；
- [ ] `3131` 运行 Next.js production standalone；
- [ ] `https://mathin.club` 公网可访问；
- [ ] `https://supabase.mathin.club` 公网可访问；
- [ ] 内网 `supabase.mathin.club` 解析到 `192.168.5.183`；
- [ ] Linux Caddy 证书由 ACME DNS-01 自动管理；
- [ ] Supabase `SUPABASE_PUBLIC_URL` 正确；
- [ ] Supabase `API_EXTERNAL_URL` 正确；
- [ ] `STORAGE_PUBLIC_URL=${SUPABASE_PUBLIC_URL}`；
- [ ] `REQUEST_ALLOW_X_FORWARDED_PATH=true`；
- [ ] 未错误覆盖 TUS 外部路径；
- [ ] 10–20 MB 文件能通过 TUS 完成上传；
- [ ] TUS Location 不含 IP、localhost 或 8000；
- [ ] Realtime WebSocket 正常；
- [ ] Windows 重启后生产服务与 Sakura FRP 自动恢复；
- [ ] Linux 重启后 Supabase、Caddy 与 Sakura FRP 自动恢复；
- [ ] 已完成备份和回滚演练；
- [ ] 所有敏感信息均未进入 Git 或部署报告。

---

# 17. 实施依据

本计划按以下官方资料的当前行为编制：

- Supabase：Self-Hosting with Docker
- Supabase：Configure Reverse Proxy and HTTPS
- Supabase Storage：Resumable Uploads
- Supabase 官方 Docker Compose 当前 Storage 配置
- Next.js：How to self-host your Next.js application
- Next.js：`output: 'standalone'`
- Caddy：Automatic HTTPS 与 DNS challenge
- Sakura FRP：Web 应用穿透、自动 HTTPS、子域绑定

核心依据：

1. Supabase 生产自部署应使用 HTTPS 反向代理；
2. Supabase 公共 URL、Auth 外部 URL、前端 SITE URL 应明确区分；
3. 大于约 6 MB 的文件推荐使用 TUS resumable upload；
4. Storage 在反向代理后需要正确的公共 URL 和 forwarded path；
5. Next.js 公网自部署应运行 production server，而不是开发服务器；
6. `NEXT_PUBLIC_*` 在构建时写入前端 bundle；
7. DNS-01 不要求签发服务器直接暴露公网端口；
8. Sakura FRP 可分别为前端和后端绑定独立域名并提供 HTTPS 能力。
