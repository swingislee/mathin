# 部署前审计

## Windows / Mathin

- 主机：Windows，仓库位于 `D:\code\2026\2026-07_mathin`。
- Node.js `v22.16.0`；pnpm `11.10.0`；Git `2.50.0.windows.1`。
- 依赖：Next.js `16.2.10`、React `19.2.4`、React DOM `19.2.4`。
- 初始 commit：`20e1b3df6a34231b37a391c08cfb59492635bd19`（`main`）。
- 初始无 `D:\services\mathin` release，也无 `Mathin Production` 计划任务。
- `.env.local` 变量名已核对但其值未记录或输出；原开发 Supabase URL 是内网 Kong 地址。

## Linux / Supabase

- 主机：`xiaomi` / Ubuntu 26.04，内网地址 `192.168.5.183`；Docker `29.6.1`、Docker Compose `v5.3.0`。
- Supabase 项目：`/home/swing/services/supabase-project`；服务均健康，Kong 当前对全网卡发布 `8000/8443`，Pooler 当前对全网卡发布 `5432/6543`。
- 当前公共 URL 均为内网地址：`SUPABASE_PUBLIC_URL=http://192.168.5.183:8000`、`API_EXTERNAL_URL=http://192.168.5.183:8000`、`SITE_URL=http://192.168.5.213:3130`。Storage 已有 `STORAGE_PUBLIC_URL=${SUPABASE_PUBLIC_URL}`、`REQUEST_ALLOW_X_FORWARDED_PATH=true`、50 MiB 上限，未设置 `TUS_URL_PATH`。
- 权威 NS 为 `scales.dnspod.net` 与 `gnat.dnspod.net`；即使域名注册在阿里云，DNS-01 凭据必须能操作 DNSPod/Tencent Cloud 的当前解析区。
- 已创建并校验受限权限备份：`deployment-backups/20260717-152135`（Compose、环境、卷配置、约 1.3 MiB `pg_dumpall`、约 253 MiB 卷配置归档；SHA-256 通过）。
