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

`pnpm dev` 为开发服务设置 4096 MiB JavaScript 老生代堆上限，与 `next.config.ts` 中的 Turbopack 预算分别生效。出现持续增长时，按[开发服务内存诊断](../runbooks/local-development-memory.md)区分物理内存、JavaScript 堆与回收后保留量。

## Git、证据与汇报

### 脚本与隐私边界

- 可提交脚本只包含逻辑、环境变量名和完整占位值；凭据从运行环境或已忽略的本机配置读取。需要生产凭据的脚本在生产主机读取受控配置，仅返回脱敏状态、计数和耗时。
- 账号、密码、AppSecret、Token、Cookie、认证 URL、请求头和业务个人数据保留在受控环境。临时脚本及原始 HAR、浏览器登录状态、数据库日志放在已忽略的 `.tmp/`，共享证据只保留脱敏摘要；`.gitignore` 不能替代内容审查。
- 本仓库通过 `git config --local core.hooksPath .githooks` 启用本机检查。设置前先检查现有 hooksPath；已有自定义 hooks 时保留并集成。新克隆需主动启用，Git 不会自动安装 hook。
- `pre-commit` 扫描 Git 暂存对象，并阻止私有配置、HAR、登录状态和真实小程序 AppID 入库；修改工作副本无法遮住已暂存的内容。`pre-push` 扫描当前仓库和可达历史，CI 继续运行当前内容及历史密钥扫描。扫描只报告位置与规则，值不回显。
- Agent 提交和推送时保持这些检查启用，不能用 `--no-verify` 绕过。扫描失败先修复源文件并重新暂存；发现真实凭据公开时先撤销或轮换，再评估历史清理。自动扫描不能保证识别所有个人数据，提交前仍逐项审查文件范围和日志内容。

### 提交与交付

- 开始与提交前都检查 `git status --short`。只暂存本任务文件；不得覆盖、回滚或夹带用户和其他任务的改动。
- 每个已通过相应验证的独立增量立即提交。提交前用 `git diff --check` 检查文本问题，并查看 staged diff。
- 机器结果只描述其覆盖的合同。汇报时区分“机器检查通过”“开发端可验收”“获准部署”“已部署待验收”“用户已验收”“正式 Gate 已收口”。
- 团队版本说明维护在 `CHANGELOG.md`，按新增功能、操作方法和故障修复组织。用页面名称、按钮名称、动作和结果说明变化，去掉副词修饰；release 编号、提交、测试和部署细节放入发布证据。
- R1 证据从 `docs/evidence/r1/README.md` 索引。仓库只保存无 secret/PII 的小摘要和索引；大日志、截图、视频进入 CI artifact 或受控对象存储，并登记规范化 SHA-256、保留期和访问角色。
- 阶段关闭时同步实现证据、专题状态头、doc 04、doc 25 和证据 README，再运行 `pnpm plan:audit`。普通实现不因惯性改写阶段状态。
