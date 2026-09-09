# 员工桌面 Web Push 生产暗部署与员工测试入口

> **适用工作项**：`DEV-WEB-PUSH-1 / PUSH-P5`
>
> **暗部署目标**：生产拥有 additive schema、应用 UI、通知专用 Service Worker、Worker 运行文件和聚合监控，但 `notifications.web_push=false`、`integration_channels.web_push.status=disabled`、`secret_ref=null`、rollout 空、subscription/delivery/job=0，`mathin-jobs.service` 未激活。
>
> **员工测试状态**：`AUTHORIZED / ACTIVATION PREPARATION PENDING`。产品负责人于 2026-09-09 已明确授权直接面向全部在职员工开放，沿用该授权。生产启用仍需专题 §11 的技术检查及本手册的受控发布与 postflight；本次准备结果见[检查点](../evidence/r1/employee-web-push-activation-preparation-20260909.md)。§2～5 是已完成 P5 的历史执行配方，后续候选只执行尚未应用的增量。

## 1. 暗部署硬门

出现任一情况立即停止对应生产写入或发布，保留现状并记录 `P5-HARD-BLOCK`：

- 执行主机、SSH 目标、数据库 fingerprint、production current/previous、migration head 或写前备份无法精确核对。
- 候选工作树不干净、候选 commit 不可重现、migration checksum 与 ledger/发布 manifest 不一致。
- migration 回滚后 ledger、函数/ACL、表、业务计数或错误基线有残留。
- feature、integration、cohort 任一层 fail-open，或出现 subscription、Web Push delivery/job、endpoint/key 明文。
- 旧站内通知、Auth、课堂/课件、Storage、正式身份或现有业务数据发生本批未授权变化。

员工名单、具体测试日期、最终保留期、独立告警出口、生产 Push 网络与 Windows Edge 真机结果属于 `G5-BLOCK / DEV-CONTINUE`；它们不阻断关闭态 P5，但阻断 Worker 激活、secret 配置、cohort 写入和真实 Push。

## 2. 候选冻结与发布内容

1. 从生产 `current/release.json` 的完整 commit 创建独立候选，只投影本工作项文件；不得从包含其他未验收提交的脏工作树直接发布。
2. 记录完整 candidate commit，以及以下 migration 的规范化 SHA-256：
   - `20260903000750_employee_web_push_dark_runtime.sql`
   - `20260903000760_employee_web_push_dark_monitoring.sql`
3. 候选必须通过受影响 ESLint、TypeScript、双语键、定向 Vitest、SQL assertions、暗态 Playwright 和 production build。发布器会再运行一次全量 lint/typecheck/build；不重复伪造通过结论。
4. immutable app release 必须包含：`public/notification-sw.js`、`scripts/r1-job-worker.mjs`、两个 Web Push runtime 模块、`@supabase/supabase-js` 与锁定的 `web-push` 依赖。`mathin-jobs.service` 模板进入仓库，但 P5 不复制到 active user unit，也不启动 Worker。

## 3. 生产只读 preflight

按 [`r1-write-target-policy.md`](r1-write-target-policy.md) 与 [`r1-production-deployment-preflight.md`](r1-production-deployment-preflight.md) 执行，只输出无 secret/PII 汇总：

- 执行主机、`ssh xiaomi`、应用 `https://mathin.club`、Supabase `https://supabase.mathin.club` 和登记的生产数据库 fingerprint 完全一致。
- `current`、`previous` 都解析到 `/home/swing/services/mathin/releases/<release-id>`，release metadata 可读，`mathin.service` active，loopback/Caddy/public health 正常。
- deploy/backup lock 空闲，service 与 backup 磁盘容量满足门槛，最近恢复点可读；不得把旧备份当作本候选写前备份。
- ledger head、row count、`00750/00760` 未应用；现有业务/Storage/`operational_errors` 汇总和未来两小时课次冻结为本轮基线。
- 生产 `feature_flag_versions` 中没有已启用的 `notifications.web_push`；不存在 `web_push` integration、rollout、subscription、delivery/job 等候选半应用状态。
- `systemctl --user is-enabled/is-active mathin-jobs.service` 预期为 `not-found|disabled` / `inactive`；发现正在运行的通用 Worker 时先确认其版本、职责和 Job 队列，不得让本批无意接管现有 Job。

## 4. 新鲜备份与 migration rehearsal

1. 最终候选冻结后创建 PostgreSQL custom dump，保存 TOC、聚合计数、candidate commit、两条 migration hash、manifest 与 `SHA256SUMS`；备份目录先写 `.partial`，完成校验后原子改名。迁移不写 Storage，本批不创建 Storage 副本，但 postflight 必须证明 Storage 汇总不变。
2. 使用 Git archive 的 LF 原文，以真实 schema owner 在 `SERIALIZABLE` 事务执行两条 migration、ledger insert 和 `supabase/tests/web_push_assertions.sql`，然后 `ROLLBACK`。
3. 新连接确认候选 ledger=0、head/row count恢复、候选表/列/函数均无残留、原函数/ACL和所有冻结计数不变。
4. 只有零残留检查通过，候选才可进入应用原子发布；formal 使用同一原文、同一 checksum 和同一断言，但在 §5 的兼容应用已经健康后提交。

## 5. 应用原子发布、schema formal 与暗态 postflight

使用干净候选运行 `publish-mathin-xiaomi.ps1 -Action Publish`。发布器应完成本地与 Xiaomi production build、immutable release、`current/previous` 原子切换、`mathin.service` 重启和 loopback health；不手工在 `current` 内构建。候选应用必须兼容 schema 前状态：系统健康页把缺失的 `webPush` snapshot 显式归一为 feature off/全 0，账户控件遇到缺 RPC 时保持禁用，因此应用可以先安全切换且不注册设备。

应用 loopback/Caddy/public health、zh/en 登录和匿名保护路由通过后，再正式提交两条 additive migration、ledger 与 SQL assertions，并刷新 PostgREST schema cache。schema formal postflight 必须得到：feature=false、integration=`disabled` 且 secret 未配置、rollout/subscription/web_push delivery/web_push job=0；`get_platform_operations_snapshot` 在通道关闭时返回 `workerStale=false`。

发布后独立核对：

- current commit=候选，previous 仍为发布前已知稳定 release；服务 active/running、`NRestarts=0`、`ExecMainStatus=0`，发布后 journal error 无新增。
- loopback、Caddy、公网 health，zh/en login，匿名保护路由，Auth/Supabase gateway 和现有站内铃铛读路径正常。
- `/notification-sw.js` 为同源 JavaScript，含 `push`/`notificationclick`，不含 `fetch`/cache/remote import；未主动开启时 permission request=0、SW registration=0。
- 固定 staff/admin 在账户页看到关闭态且开启按钮禁用；系统健康页 feature off、8 项计数为 0、Worker 异常=0、integration disabled。
- release 内 Worker 文件与 `web-push@3.6.7` 可解析，但 `mathin-jobs.service` 仍 `not-found|disabled` / `inactive`；不得运行 `jobs:worker` 作为 P5 烟测。
- ledger checksum、业务/Storage/错误汇总与写前基线一致；新的 Web Push subscription/delivery/job 和 endpoint/key 明文命中均为 0；最终备份再次 `sha256sum -c`。

## 6. Kill switch、回退与恢复

三层停止顺序固定为 feature flag off → integration disabled → 停止 Web Push Worker。P5 三层本来就是关闭态；任何意外开启都先恢复三层关闭，再调查来源。

- 应用异常：将 `current` 原子切回已核对的 `previous`，新增 schema 保留并 forward-fix；验证 health、登录、站内铃铛和匿名保护路由。
- schema 异常：在无 subscription/delivery/job 的 P5 暗态优先 forward-fix。只有确认数据破坏、事故负责人选择明确恢复点并再次批准后，才使用本轮 custom dump 进入独立数据库恢复流程。
- Service Worker：它无 `fetch` handler。应用回退后残留安装不会拦截页面请求；通道关闭且无新 Push 时保持静默，后续兼容版本负责升级或注销。
- Worker：P5 未激活。启用后的停止顺序保持 feature flag off → integration disabled → 停止推送专用 unit；保留 job/delivery 审计用于调查。

## 7. `PUSH-G5` 后的共享电脑与员工测试 SOP

产品批准已于 2026-09-09 取得；完成 G5 技术检查后执行：

1. 启用时查询 `role in ('staff','admin') AND is_active AND account_status='active'` 的全部员工，并把 UUID 快照保存到生产 owner-only manifest；仓库证据只保存人数与摘要。新增账号不自动加入本次快照。优先为每位员工使用独立 Windows/Edge profile。
2. 配置 owner-only VAPID、订阅加密、fingerprint、origin allowlist 和 key version；先启动受监管 Worker并验证独立告警，再启用 integration/feature，最后加入 tester cohort。
3. 员工必须在自己的会话中点击“在这台电脑开启”；系统默认共享电脑，租期 8 小时。管理员不能代替员工静默注册。
4. 共享电脑必测：A 开启并收一条通用测试通知 → A 登出并撤销 → B 登录；B 不收到 A 的新投递，也不能解析 A 的旧 delivery。员工停用、rollout 移除、租期到期和 404/410 均须停止发送并清除密文。
5. 观察窗口采用宽泛排期，但退出证据至少覆盖 5 个有效工作日、Windows Edge、一个共享电脑旅程和 50 个 device-level target；日历到期不会自动通过。

### 7.1 专用 Worker 与独立邮件监控部署合同

- `20260909009000_employee_web_push_activation_safety.sql` 必须先在已核验非生产目标通过行为/回滚断言，再按生产写前备份、同文件 rehearsal/零残留/formal 流程执行。它保持现有 feature、integration 和 rollout 原值。
- immutable release 同时打包 `web-push-worker-cycle.mjs`、`web-push-support.mjs` 与 `web-push-monitor.py`。推送 unit 固定 `R1_JOB_SCOPE=web_push`，只调用 `claim_web_push_jobs`；心跳版本 `r1-7.3-web-push-scoped` 不由通用 worker 使用。激活前后核对其他 kind 的 job/effect 未被本 unit 领取或维护。
- 应用与 worker 共用 owner-only VAPID、加密和 fingerprint 配置。首轮仅接受 Windows Edge 设备和已登记的 Microsoft WNS HTTPS origin，直连投递；本轮不使用 Google FCM 或 Push 代理。激活前验证 WNS 的 TLS 可达与实际 provider 201。
- `mathin-web-push-monitor.timer` 每分钟运行独立 Python monitor；通过只读 aggregate RPC 检测超过 120 秒未更新的专用 worker 心跳、provider auth/degraded、dead/failure、持续 5 分钟的超 60 秒积压。故障变化与恢复各发一次，同一故障最多每小时补报一次。
- `.env.web-push-alerts` 权限 `0600`，保存 `MATHIN_WEB_PUSH_SMTP_HOST/PORT/USER/PASSWORD/FROM` 与受控的 `MATHIN_WEB_PUSH_ALERT_TO`；SMTP 使用 465 TLS 或 587 STARTTLS。复用现有已验证 SMTP 时只在生产内存或 owner-only 文件中转存，凭据不进入 release/Git/日志。
- monitor 状态文件仅记录故障类别、时间和聚合量，目录 `0700`、文件 `0600`；邮件成功后才原子更新去重状态。恢复邮件不自动重启 worker、重放 job 或修改开关。
- G5 前完成真实告警与恢复邮件演练，再安装启用 unit/timer。密钥仅在目标主机生成；各层开启前后独立核对，发现异常使用 §6 停止顺序。

## 8. 重试、监控与告警

| 结果 | 处理 |
| --- | --- |
| 2xx | delivery=`sent`，记录无 PII 成功时间 |
| 400/413 | terminal failed，不重试 |
| 401/403 | terminal + integration degraded，立即独立告警 |
| 404/410 | subscription=`gone`、清密文、delivery suppressed，不重试 |
| 429 | 尊重 `Retry-After`，上限 4 小时，再使用 full jitter |
| 5xx/DNS/TLS/timeout | full-jitter 指数退避，达到 max attempts 进入 dead letter |
| TTL 到期 | suppressed，不补发陈旧提醒 |

监控只展示 rollout、active/shared/gone、queued/sent/suppressed/failed、oldest due、Worker heartbeat 和集成状态，不展示员工、endpoint、key、正文或 deep link。员工测试前必须使用独立于 Web Push 的出口完成一次 Worker 失联和 provider auth 错误的告警—确认—恢复演练；只看 Dashboard 不满足 G5。

## 9. 证据与状态更新

P5 证据记录 candidate/full commit、两条 migration hash、production current/previous、ledger、备份路径及摘要、起止时间、actor/approver、无 PII 数据汇总、失败票据和实际 postflight。只有真实生产 postflight 完成后，才能把专题状态改为 `PUSH-P5 COMPLETE / EMPLOYEE TEST NOT AUTHORIZED`。

P5 不更新为 `EMPLOYEE TEST ACTIVE`。员工测试入口仍是专题 §11：技术项通过、全部在职员工 manifest 与值守完成，并执行生产启用 postflight；产品批准沿用 2026-09-09 的全员授权。
