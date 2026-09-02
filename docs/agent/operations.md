# 验证、Git 与环境运维规则

> 读取条件：任务需要运行验证、提交 Git、登记证据、操作本地 Supabase，或涉及部署和生产环境。

## 环境边界

- 本地开发主机是 `192.168.5.213`；Next 开发入口为 `http://localhost:3130` / `http://192.168.5.213:3130`，`.env.local` 应指向本机 Docker Supabase `http://127.0.0.1:35421`。
- SSH alias `xiaomi`（`192.168.5.183`）、`https://mathin.club` 和 `https://supabase.mathin.club` 是同一套 R1-Live 生产系统。任何 `ssh xiaomi "docker exec ..."` 都按生产写操作处理。
- 本地与 Xiaomi 使用相同容器名。写数据库、Storage 或服务前必须核对执行主机、应用实际 Supabase origin、监听进程和目标环境；任一不明确即停止。
- 生产写入先执行 [`../runbooks/r1-write-target-policy.md`](../runbooks/r1-write-target-policy.md) 的只读 preflight，并取得针对本次动作的明确授权。开发通过、获准部署、已部署待验收和生产通过分别记录。
- 新建 SSH shell 访问国际网络前先 `proxy_on`；在同一会加载该函数的 shell 会话中执行后续 `curl`、`git`、`apt` 或 Docker 拉取。内网与本地服务不走代理。

## 验证分级

- 先运行覆盖变更风险的最窄检查；共享核心、数据库/API、鉴权或权限变更再增加集成、RLS、安全或构建检查。
- 全量回归、完整构建、跨浏览器、恢复/回退演练和发布 Gate 只在仓库硬门、合并/发布收口、共享核心风险或产品负责人明确要求时运行。
- 相同代码与输入已有可信通过结果时复用；只有代码、输入、环境变化或失败诊断需要时重跑。
- 预计收尾超过 15 分钟时优先改为定向检查、并行/后台检查或批次 Gate；低风险小改动不因重复验证阻塞人工验收。
- `pnpm ci:checks` 的 checks job 不 fail-fast；需要推送前全量工程门禁时运行一次即可，不要逐项重复。

常用入口以 [`../../package.json`](../../package.json) 为准：

| 目的 | 命令 |
| --- | --- |
| 开发服务 | `pnpm dev` |
| 静态检查 | `pnpm lint`、`pnpm typecheck` |
| 相关/全量单测 | `pnpm test -- <pattern>`、`pnpm test` |
| 构建 | `pnpm build` |
| 当前 R1-Live 合同 | `pnpm r1:live:test` |
| 历史 R1 诊断 | `pnpm r1:regression` |
| 本地/发布 E2E | `pnpm e2e`、`pnpm e2e:release` |
| 规划审计 | `pnpm plan:audit` |
| 工程门禁 | `pnpm ci:checks` |
| secret 检查 | `pnpm secrets:check`、`pnpm secrets:history` |

发布 E2E 只允许明确的非生产 target attestation；复用固定开发账号，不注册临时账号。

## Git、证据与汇报

- 开始与提交前都检查 `git status --short`。只暂存本任务文件；不得覆盖、回滚或夹带用户和其他任务的改动。
- 每个已通过相应验证的独立增量立即提交。提交前用 `git diff --check` 检查文本问题，并查看 staged diff。
- 机器结果只描述其覆盖的合同。汇报时区分“机器检查通过”“开发端可验收”“获准部署”“已部署待验收”“用户已验收”“正式 Gate 已收口”。
- R1 证据从 `docs/evidence/r1/README.md` 索引。仓库只保存无 secret/PII 的小摘要和索引；大日志、截图、视频进入 CI artifact 或受控对象存储，并登记规范化 SHA-256、保留期和访问角色。
- 阶段关闭时同步实现证据、专题状态头、doc 04、doc 25 和证据 README，再运行 `pnpm plan:audit`。普通实现不因惯性改写阶段状态。
