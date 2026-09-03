# Mathin 员工桌面 Web Push 生产化规划

> **规划状态**：`active`
>
> **工作项**：`DEV-WEB-PUSH-1`
>
> **当前状态**：`IMPLEMENTATION IN PROGRESS / LOCAL DARK RUNTIME VERIFIED / PUSH-P5 PENDING / EMPLOYEE TEST NOT AUTHORIZED`
>
> **当前施工目标**：连续推进 `PUSH-P0`～`PUSH-P5`，以生产三层开关全部关闭、无订阅、无 Web Push 投递的暗部署完成为本轮终点。普通产品裁决、测试排期和外部告警出口等未决项进入 §10.1 问题账本，不阻断代码开发；会造成越权、泄密、误投递、旧业务回归或生产目标不明的硬问题仍必须 fail-closed。
>
> **员工测试入口**：只有本文 §11 的 `PUSH-G5 · EMPLOYEE-TEST-ENTRY` 全部为 `PASS`，产品负责人登记首批员工与设备范围并明确确认“进入员工测试”后，状态才可改为 `EMPLOYEE TEST ACTIVE`。开发完成、机器检查通过、生产暗部署或通知在单台开发机弹出，均不能提前进入员工测试。
>
> **阶段关系**：本工作项属于 doc 04 §5.2 的独立开发轨，不改变 `R1-Live-2` 当前施工阶段，也不替代 Gate 2 的正式教师点名、持久再读和权限对照。功能在生产默认关闭；未通过本专题 Gate 时，既有站内铃铛继续作为唯一已承诺的通知入口。
>
> **核对日期**：2026-09-03；依据当前 `notifications` / `notification_deliveries`、durable job、`ChangeBell`、平台运行面板、生产运维合同，以及 Push API、Service Worker、Web Push 和 Edge 企业策略官方文档。

## 1. 目标、首发范围与产品边界

### 1.1 生产结果

Mathin 为主动开启该能力的员工设备提供桌面 Web Push：员工可以关闭 Mathin 标签页或浏览器窗口；只要浏览器用户代理仍可在系统后台接收 Push、设备联网且操作系统允许通知，新的角色定向通知会显示为 Windows 系统通知。员工点击后回到 Mathin，经当前登录身份重新鉴权，再打开该通知所属业务对象。

首发范围固定为：

- 主体仅限 active `staff` 与 `admin`；学生和家长继续只使用站内通知，后续如需外推必须重新完成未成年人隐私与内容分级裁决。
- 设备以公司使用的 Windows 桌面环境为首要目标；生产验收覆盖 Edge 与 Chrome 最新两个主版本，员工测试至少覆盖当前稳定版 Edge 和 Chrome。
- 站内 `notifications` 仍是通知事实和已读状态权威；Web Push 是可关闭的投递渠道，发送失败不能回滚领域事务，也不能删除或篡改站内通知。
- 系统通知只显示通用内容，例如“Mathin 有一条新的工作提醒”；锁屏、通知中心和 Push payload 均不出现学生姓名、手机号、班级、财务、课评正文或业务 deep link。
- 点击通知后由服务端按当前身份解析目标；当前账号不是接收人、会话过期或权限已撤销时，只进入登录/无权限状态，不泄露通知内容或目标地址。

### 1.2 能力边界

| 场景 | 产品承诺 |
| --- | --- |
| Mathin 标签页在前台、后台或最小化 | 站内通知正常；已开启桌面提醒的设备可收到系统通知 |
| Mathin 标签页关闭，浏览器仍允许后台运行 | Web Push 唤醒通知专用 Service Worker，并尝试显示系统通知 |
| 浏览器窗口全部关闭，但浏览器后台服务仍运行 | 纳入真实设备验收；通过后属于支持场景 |
| 浏览器被任务管理器结束、后台能力被企业策略关闭、系统关机/休眠、断网或勿扰模式开启 | 不承诺即时显示；在 TTL 内恢复时允许延迟送达，超过 TTL 自动抑制 |
| Windows 弹窗位置、声音、持续时间与锁屏展示 | 由操作系统和浏览器控制，站点不承诺固定右下角、强制声音或绕过勿扰模式 |
| Push 服务已接受消息 | 只记为 `sent`；Web Push 没有可靠的设备展示回执，运行面板不得将其称为“已展示”或“员工已看到” |

### 1.3 本工作项不包含

- 不开发 Electron、Windows 原生托盘程序或“浏览器进程被彻底结束后仍保证弹出”的常驻客户端。
- 不引入离线 app shell、页面预缓存或课堂离线 PWA。Service Worker 只处理 `push`、`notificationclick` 和订阅变更，不注册 `fetch` 缓存逻辑。
- 不用桌面通知替代站内铃铛、工作项、邮件、SMS 或微信；邮件、SMS、微信和 Webhook 仍按 doc 25 的现有安全关闭合同处理。
- 不自动向所有员工索要浏览器权限，也不把 Edge/Chrome 企业允许策略等同于员工在 Mathin 内主动启用。
- 不通过 Push payload 传递完整业务文案、凭据、访问令牌、可直接访问的私有 URL 或第三方跳转地址。

## 2. 当前基线与缺口

| 层 | 当前事实 | 本工作项缺口 |
| --- | --- | --- |
| 事件与站内通知 | `domain_events` 已事务化生成 `notifications`；接收人、幂等键、payload、deep link、已读与归档均已存在 | 需要按合格订阅生成设备级 Web Push 投递，但不能改变站内通知语义 |
| 前端铃铛 | [`ChangeBell.tsx`](../../src/features/events/ChangeBell.tsx) 已按用户订阅 Supabase Realtime、刷新未读列表并支持点击已读/跳转 | 没有权限引导、设备订阅、系统通知、设备管理或多标签页去重 |
| durable job | `jobs`、租约、超时恢复、指数退避、dead-letter、人工重放和 effect 幂等已落地 | `notification.*` 在 [`r1-job-worker.mjs`](../../scripts/r1-job-worker.mjs) 中仍显式 fail-closed，没有任何外部通知发送器 |
| 投递账本 | `notification_deliveries` 支持渠道、job、状态、错误和时间 | 渠道枚举没有 `web_push`，也没有每台设备/订阅的投递目标 |
| 集成治理 | `integration_channels` 已有 provider、secret ref、失败阈值和 15 分钟降级合同 | 没有 Web Push provider/VAPID 配置、浏览器 Push 服务网络 preflight 或专用 kill switch |
| 运维界面 | `/dashboard/system-health` 已展示 job、通知投递、Worker 与集成摘要 | 没有 Web Push 订阅、队列时延、失效订阅、Push 服务接受率和独立告警 |
| 浏览器运行时 | 仓库没有 Service Worker、Push subscription、VAPID 或 Web App Manifest | 需要通知专用 Service Worker；Manifest/PWA 安装不是 Web Push 前置条件 |
| 环境 | 生产 `https://mathin.club` 是安全上下文；局域网开发入口为 HTTP | Service Worker/Push 的开发与 E2E 必须使用 `localhost` 安全上下文或独立 HTTPS 预生产域名，不能用局域网 HTTP 结果冒充验证 |

R1-2 的 M3 证据继续有效，但只证明站内通知、队列合同和外部渠道关闭。本文从 `M0 计划` 开始记录 Web Push 子能力；不能继承 R1-2 的关闭状态后直接宣称生产就绪。

## 3. 员工与设备旅程

### 3.1 开启

1. 员工登录 Mathin，在铃铛或账号中心看到“在这台电脑开启桌面提醒”。页面先显示能力检测结果、隐私说明和设备类型。
2. 设备类型默认选择“共享电脑”；员工只有明确选择“个人专用电脑”后才获得较长订阅租期。
3. 员工点击开启后，页面在该用户手势内申请浏览器通知权限；`default`、`granted`、`denied` 分别显示明确状态，不在页面加载时自动请求。
4. 权限为 `granted` 时注册通知专用 Service Worker，创建受 VAPID public key 限制的 `PushSubscription`，再经受保护的同源服务端入口绑定当前账号。
5. 服务端完成 CSRF/Origin、当前用户、员工状态、rollout cohort、设备上限、endpoint 安全与加密校验后激活订阅，并允许员工发送一条通用测试通知。

### 3.2 收到与点击

1. 领域事务继续先提交事实、领域事件和站内通知。
2. 只有 Web Push 总开关、integration channel、测试/发布 cohort、员工偏好、订阅状态和租期同时有效时，才为每个订阅创建独立投递行和 job。
3. Worker 向浏览器 Push 服务发送仅含版本、delivery ID、locale、tag 和过期时间的加密小 payload。
4. Service Worker 先用本地短期去重账本核对 opaque delivery ID，再使用固定同源图标、通用文案和 `tag=delivery ID` 显示系统通知；账本只保留 delivery ID 与过期时间，不保存通知正文或账号信息。
5. 点击后只打开 Mathin 同源通知解析入口。服务端按当前 `auth.users.id` 校验 delivery/notification 所有权和当前 RLS，再标记站内通知已读并跳转到最终 deep link。

### 3.3 关闭、登出与账号切换

- 员工可以单独关闭某台设备或关闭自己的全部桌面设备；服务端立即停止新投递，并清除该订阅的 endpoint/key 密文。
- 正常登出先尽力撤销当前浏览器绑定并调用浏览器 `unsubscribe()`，随后继续完成登出；撤销失败不阻止账号退出，下一次登录的 reconciliation 必须先使旧绑定失效。
- 页面每次建立已登录会话时对当前浏览器已有 `PushSubscription` 做所有权协调。发现 endpoint 仍绑定其他账号时，先停用旧绑定，不自动为新账号开启；新账号必须再次点击开启。
- 员工停用、账号锁定、staff/admin 身份失效或 rollout 移除时，订阅立即失去投递资格；历史投递审计保留，敏感密文按 §6.5 清除。

## 4. 目标架构与信任边界

```text
领域 RPC / Server Action
  → domain_events（业务事务内）
  → notifications + in_app delivery（既有权威）
  → 每个合格订阅一条 web_push delivery + durable job
  → production job worker
  → 浏览器厂商 Push Service
  → 通知专用 Service Worker
  → Windows 系统通知
  → 点击后回到同源解析入口并重新鉴权
```

### 4.1 分层责任

| 层 | 责任 | 不承担 |
| --- | --- | --- |
| 领域事务 | 产生业务事实、目标用户、事件类型和站内通知 | 不同步调用外部 Push 服务 |
| 数据库投递 staging | 计算渠道/订阅资格，创建幂等 delivery/job | 不读取订阅明文，不渲染敏感通知正文 |
| Next.js 受保护入口 | 创建/撤销/协调订阅，完成应用层加密与当前用户校验 | 不接受任意外部跳转，不把 VAPID private key 下发浏览器 |
| Job Worker | 解密订阅、验证出站目标、发送 Web Push、更新投递与集成状态 | 不信任 job payload 中的 endpoint；不记录 endpoint/key/payload 明文 |
| Service Worker | 显示通用系统通知并处理同源点击 | 不缓存页面、不读取业务数据、不持有账号凭据或 deep link |
| 站内通知 | 保存完整可操作通知与已读状态 | 不依赖 Web Push 成功才能成立 |

### 4.2 通知专用 Service Worker

- 使用稳定同源路径和根 scope；脚本随应用版本发布，不从 CDN `importScripts`，不执行远程代码。
- 只注册 `push`、`notificationclick`、`pushsubscriptionchange` 与必要生命周期事件；显式不注册 `fetch` handler，避免改变任何认证页面、课堂、课件和静态资源的缓存语义。
- 解析 versioned payload schema；未知版本、超限、缺字段或包含非同源 URL 时 fail-closed，不显示可点击的业务内容，并记录最小客户端诊断。
- 使用 IndexedDB 或等价的 Service Worker 本地存储保存短期去重键 `delivery_id + expires_at`；先写入/确认去重键再显示通知，TTL 到期后清理。该账本不缓存页面、账号、endpoint、正文或 deep link，注销 Service Worker 时一并清理。
- 点击只使用常量同源入口和 opaque delivery ID；优先聚焦现有 Mathin 窗口，否则 `openWindow()`。
- 回退旧应用前先关闭服务端渠道。已安装的无 `fetch` Service Worker 可以暂时留存但收不到新消息；后续用兼容 tombstone 版本统一注销，不能依赖把脚本直接变成 404 完成即时回收。

## 5. 数据合同与状态机

具体 migration 名在实施时按当日账本顺序确定。所有表启用 RLS，直接表写权限默认关闭；用户只通过受保护 RPC/Server Action 获取自己设备的非敏感元数据。

### 5.1 `web_push_subscriptions`

| 字段组 | 合同 |
| --- | --- |
| 身份 | `id`、`recipient_id`、`status=active|revoked|expired|gone`；接收人只允许 active staff/admin |
| endpoint 识别 | `endpoint_fingerprint` 使用独立应用 secret 做 HMAC-SHA-256；同一 endpoint 同时最多绑定一个 active recipient |
| 密文 | endpoint、`p256dh`、`auth` 作为一个 versioned envelope 由应用层加密；保存 `ciphertext` 与 `encryption_key_version`，数据库、普通用户和运维 UI 不返回明文 |
| VAPID | 保存创建订阅时使用的 public key version；private key 只存在于生产 Worker secret 环境 |
| 设备元数据 | 用户提供的可编辑 `device_label`、`device_mode=shared|personal`、粗粒度 `browser_family/platform_family` 和 locale；不保存完整 User-Agent 作为长期设备指纹 |
| 租期 | `last_confirmed_at`、`lease_expires_at`、`revoked_at/reason`；共享设备租期最多 8 小时，个人设备最多 30 天，员工再次登录时按当前资格续期 |
| 运行结果 | `last_success_at`、`last_failure_at`、`last_error_code`；不得保存通知正文或业务对象详情 |

每名员工最多 5 个 active 订阅；注册/协调入口按账号和来源 IP 做限流。达到上限时要求员工先撤销旧设备，不静默覆盖未知设备。

### 5.2 `notification_push_rollout_members`

保存 `recipient_id`、`cohort=employee_test|limited|general`、`status`、生效/失效时间、操作者和原因。只有 `system.operations.manage` 可通过审计 RPC 修改。员工测试期间，未列入 `employee_test` manifest 的账号即使浏览器已授予权限也不能建立 active 投递资格。

一般开放后可将资格规则提升为全部 active staff/admin，但仍保留用户逐设备 opt-in。学生/家长不能通过修改客户端请求加入 cohort。

### 5.3 `notification_deliveries` 扩展

- 渠道枚举增加 `web_push`；每台订阅各有一条 delivery，增加不可空的 `subscription_id` 或等价目标引用。
- 幂等键固定为 `notification:<notification_id>:web_push:<subscription_id>`；同一通知、同一订阅重复 staging 的新增数必须为 0。
- job payload 只保存 `deliveryId`，Worker 在 service-role 边界读取当前 delivery 和订阅密文；不把 endpoint、密钥、姓名、deep link 或通知 payload 复制进 job。
- `in_app` 继续保持每个通知一条，其他外部渠道保持原合同；Web Push migration 必须是向前兼容加法，previous 应用读取既有通知不受影响。

### 5.4 状态机

```text
subscription: active → revoked | expired | gone
                         ↑ 重新显式开启时创建/激活新一代绑定

delivery: queued → sending → sent
                     ├→ queued（可重试失败）
                     ├→ suppressed（过期、撤销、404/410 等预期终止）
                     ├→ failed（不可重试的消息/配置错误）
                     └→ dead（达到最大尝试次数）
```

`sent` 只表示 Push 服务接受请求。`delivered` 在 Web Push 没有真实设备回执时保持不用，避免运行面板制造错误结论。

### 5.5 服务端入口

计划提供下列窄接口，名称可在实现前按现有 Action/RPC 命名规范调整：

- `register_my_web_push_subscription`：当前用户、rollout、设备上限、密文 envelope、endpoint fingerprint 与租期校验后注册。
- `reconcile_my_web_push_subscription`：账号切换时先撤销同 endpoint 的旧 recipient；只协调所有权，不替新账号开启。
- `list_my_web_push_devices`：只返回 label、mode、浏览器/平台族、状态、最近确认/成功和到期时间。
- `revoke_my_web_push_subscription` / `revoke_all_my_web_push_subscriptions`：本人撤销并清除密文。
- `send_my_web_push_test`：只对当前 active 订阅创建固定通用测试通知，限流并写审计；不能指定 recipient、endpoint、正文或 URL。
- 管理端 rollout 与 dead-letter 重放继续要求 `system.operations.manage`，每次记录原因。

## 6. 安全、隐私与共享电脑

### 6.1 威胁与控制

| 风险 | 生产控制 | Gate 证据 |
| --- | --- | --- |
| Push endpoint 是 capability URL，泄露后可被滥用 | endpoint/key 应用层加密；HMAC fingerprint；表无直接读取；日志、错误、E2E artifact 和运维 UI统一脱敏 | 数据库角色负向读取、日志扫描、备份样本检查均为 0 明文 |
| 伪造订阅造成 SSRF | 受保护同源入口；HTTPS only；拒绝 IP literal、localhost、私网/保留地址、重定向和非批准 Push 服务 origin；DNS/连接阶段继续校验目标 | 伪造内网、回环、重定向、DNS rebinding 和任意域名请求全部拒绝 |
| CSRF 把攻击者 endpoint 绑定到员工 | 当前用户使用 `getUser()`；Origin/Host/CSRF 断言；注册与撤销限流；不接受 GET 写入 | 跨站表单/fetch、过期会话和缺 Origin 请求拒绝 |
| 共享浏览器把 A 的通知发给 B | active endpoint 全局唯一；登录 reconciliation；登出撤销；共享模式 8 小时租期；账号切换不自动转移 opt-in | A→登出→B、A 会话过期→B、B 点击 A 旧通知三条旅程均无泄露 |
| 锁屏或旁观者看到学生/财务信息 | Push payload、title/body、tag、icon 全部使用通用内容；真实文案只在登录后的站内页面读取 | payload snapshot、Windows 锁屏截图人工复核无 PII |
| 恶意 deep link 或跨站跳转 | Service Worker 只打开常量同源解析入口；服务端按 delivery owner 取现有 deep link 并复用站内相对路径约束 | 外部 URL、`//host`、编码绕过和非 owner delivery 均拒绝 |
| VAPID/private encryption key 泄露 | 两套用途分离的 production secret；owner-only 环境文件；不入数据库/日志/仓库；版本化轮换 runbook | secret scan、文件权限、轮换演练与旧 key 失效证据 |
| Service Worker 扩大供应链/缓存面 | 同源静态脚本、无远程 import、无 `fetch` 缓存、版本化 payload、CSP/response headers 核对 | 认证页面、课堂和课件网络请求在安装前后行为不变 |
| 通知轰炸或重复可见 | 每用户设备上限、测试通知限流、事件/订阅幂等键、Service Worker 短期去重账本、稳定 notification tag、TTL 和 rollout cohort | 重复 staging、Worker 超时重试和多标签页下可见弹窗不重复 |

### 6.2 共享电脑合同

1. 开启界面默认设备类型为“共享电脑”，并解释通知可能出现在 Windows 通知中心。
2. 共享设备只显示通用文案，租期最多 8 小时；页面打开且当前员工仍合格时才续期，登出或账号切换立即撤销。
3. 个人设备租期最多 30 天；员工再次登录并保持 opt-in 时续期。超过租期后 delivery 记为 `suppressed`，不能自动恢复。
4. 同一 endpoint 同时只能属于一个账号。新账号登录时先停用旧 owner；只有新账号再次点击开启才建立新绑定。
5. 共享电脑 SOP 推荐每位员工使用独立 Windows/Edge profile。站点租期和协调是纵深防御，不替代公司设备管理。
6. 无法证明安全登出、浏览器 profile 隔离或租期执行的设备不能进入员工测试 manifest。

### 6.3 消息最小化

加密 Web Push payload 仍会向浏览器 Push 服务暴露时间、频率和大小等元数据。因此 payload 固定为小型 versioned envelope，不按角色/业务类型改变明显大小，不发送正文和 deep link。首版不实现通知按钮式业务操作，避免在锁屏直接执行“同意、发布、退款、点名”等领域写入。

### 6.4 权限与企业策略

- 浏览器权限只在员工明确点击后请求；权限为 `denied` 时停止重复询问并给出 Edge/Chrome 与 Windows 设置路径。
- IT 可以使用 Edge `NotificationsAllowedForUrls` 等企业策略允许 `https://mathin.club` 显示通知，但 Mathin 内的设备 opt-in、rollout cohort 和共享电脑合同仍须成立。
- 企业策略、浏览器权限、Windows 系统通知、Mathin 用户偏好是四个独立状态；运维页面分别描述可观测范围，不把客户端上报当作不可伪造安全事实。

### 6.5 撤销与保留

- 用户撤销、404/410、租期到期、员工停用或管理员移出 rollout 后，endpoint/key 密文在同一领域动作内清空；保留不可逆 HMAC fingerprint、粗粒度设备元数据和状态用于防重复与审计。
- subscription 元数据与 delivery/job 审计暂定保留 90 天；P0 威胁建模阶段由隐私/运维负责人确认。未确认保留期时 `PUSH-G5` 不能通过。
- 证据只保存 delivery/job UUID、粗粒度浏览器族、状态计数和时间，不保存 endpoint、密钥、真实姓名、业务正文或 Windows 含 PII 截图。

## 7. 发送、重试、幂等与熔断

### 7.1 发送策略

- 使用经过依赖审计并锁定版本的标准 Web Push 实现完成 RFC 8291 加密和 RFC 8292 VAPID，不自写密码学协议。
- 默认 TTL 为 4 小时；delivery 另存 `expires_at`。job 取得租约时已过期、订阅已撤销或通知已归档时直接 `suppressed`，不发送陈旧弹窗。
- 首版每个 delivery 使用现有 `max_attempts=5`、`backoff_base_seconds=30`，在指数退避上加入 full jitter，并遵守合法 `Retry-After`，总延迟不得越过 delivery TTL。
- Web Push 是网络意义上的 at-least-once。响应丢失时不能证明 Push 服务是否已接受，因此不承诺发送 exactly-once；通过稳定 delivery ID、Service Worker 短期去重账本、notification tag 和 TTL，把重复可见通知降到 0 的验收目标。

### 7.2 响应分类

| 结果 | delivery/job 处理 | integration channel 处理 |
| --- | --- | --- |
| Push 服务 2xx | delivery=`sent`，job/effect 完成 | 清零连续失败，记录 `last_success_at` |
| 404 / 410 | subscription=`gone`、清除密文，delivery=`suppressed`，job 成功终止 | 作为正常生命周期计数，不触发 provider 熔断 |
| 400 / 413 | delivery=`failed`，不可重试；记录 payload/contract 错误码但不记正文 | 触发工程告警；同版本重复错误时关闭渠道 |
| 401 / 403 | delivery=`failed`，不可重试 | 视为 VAPID/配置安全错误，立即 `degraded` 并停止新发送 |
| 429 | delivery 回到 `queued`，按 `Retry-After` + jitter 重试 | 记录限流率；连续阈值后进入 15 分钟降级 |
| 5xx、DNS、TLS、连接超时 | 可重试；达到 5 次后 delivery/job=`dead` | 复用 `record_integration_outcome` 累计失败并熔断 |
| job lease 超时/Worker 崩溃 | 复用现有 lease recovery；未完成 effect 可重试 | 监控 Worker 心跳、queue age 和重复可见结果 |

### 7.3 人工重放

只有 `system.operations.manage` 可以对 dead job 输入原因后重放。重放前重新检查 recipient、rollout、订阅状态、TTL 和 notification 归档状态；任一不再有效则生成 `suppressed` 结果，不向旧 endpoint 发送。重放继续复用原 delivery tag，不能通过新 delivery ID 绕过客户端去重。

## 8. 监控、SLO 与告警

### 8.1 指标

运行面板按 `web_push` 渠道增加：

- active/revoked/expired/gone 订阅数，按浏览器族和 shared/personal 聚合；小样本不展示可识别个人的切片。
- queued/sending/sent/suppressed/failed/dead delivery 数及 24 小时、7 天趋势。
- queue age p50/p95/max、到期前剩余时间、attempt 分布和 Push 服务响应码类别。
- Push 服务接受率、最终成功/预期抑制率、404/410 失效率、429/5xx/网络失败率。
- Worker 版本、心跳、领取时间、处理/失败数、当前 circuit-breaker 状态。
- employee-test cohort 的订阅人数和设备数；不在面板展示 endpoint、密钥、完整 User-Agent、通知正文或员工姓名。

### 8.2 生产门槛

| ID | 指标 | 门槛 |
| --- | --- | --- |
| `PUSH-REL-01` | Job 领取 | 95% 到期 job 在 60 秒内取得租约，沿用 doc 25 `PERF-05` |
| `PUSH-REL-02` | 最终结果 | 非用户撤销/过期/404/410的 delivery 在 SLA 内 `sent` ≥99%；样本不足 100 时继续观察，不提前宣称达标 |
| `PUSH-REL-03` | Dead letter | 员工测试入口与正式扩围时未处置 web_push dead job=0 |
| `PUSH-REL-04` | 重复可见 | 同一 delivery 在同一设备的重复可见系统通知=0 |
| `PUSH-SEC-01` | 跨账号/PII | 跨账号投递、点击泄露、锁屏敏感内容、endpoint/key 日志泄露均=0 |
| `PUSH-OPS-01` | Worker | 计划运行窗口外，生产 Worker 心跳陈旧超过 2 分钟=0 |
| `PUSH-OPS-02` | 失效清理 | 404/410 在同次尝试中停用订阅并清除密文=100% |

### 8.3 告警

- 任一 401/403、dead job、endpoint/key 明文命中、跨账号拒绝异常或 Worker 心跳超过 2 分钟，立即进入需要人工处理的告警。
- `oldest due > 60s` 持续 5 分钟、样本不少于 20 时 15 分钟失败率 ≥5%、或连续失败达到 integration threshold，进入 channel degraded；新 delivery 停留在站内，不继续盲发。
- 404/410 率在 24 小时超过 10% 时建立订阅生命周期调查，但不把正常失效计作 provider 故障。
- 员工测试前必须选定一个不依赖 Web Push 本身的运维告警出口，并完成一次真实告警—确认—恢复演练。只在 Dashboard 留红点不能满足本门。

## 9. UI、双语与可访问性

### 9.1 页面位置

- 铃铛通知面板提供当前设备的简短状态与“开启/发送测试/关闭”动作，继续复用现有工作区 Popover/Tabs，不增加自动权限弹窗。
- 账号中心提供“桌面通知设备”列表，显示设备名、shared/personal、浏览器/平台族、最近确认、到期与状态；支持单台撤销和全部撤销。
- 系统运行页提供 Web Push 聚合、Worker、失败类别、kill switch 和授权重放入口；查看要求 `audit.view`，修改要求 `system.operations.manage`。

### 9.2 状态文案

必须同时提供 zh/en：不支持、安全上下文缺失、尚未询问、已允许、浏览器拒绝、Windows 关闭、Mathin 未开启、共享设备即将到期、订阅失效、测试发送中/已由 Push 服务接受/失败、后台运行说明和勿扰模式说明。

文案明确区分“Push 服务已接受”和“设备已显示”；不承诺浏览器/系统无法提供的展示回执。

### 9.3 可访问性

- 开启/关闭由可聚焦按钮触发，状态变化进入合适的 `aria-live`，不移动当前焦点。
- 权限拒绝后的帮助不重复触发浏览器 prompt；设备列表、状态、错误和撤销确认可用键盘与读屏完成。
- 通知图标使用已批准的同源资产；Windows 高对比、light/dark 和 125%/150% 缩放下保持辨识。
- 浏览器能力缺失时站内通知完整可用，页面不出现阻断登录或业务操作的错误。

## 10. 分阶段施工

| 阶段 | 产物 | 退出条件 | 员工测试状态 |
| --- | --- | --- | --- |
| `PUSH-P0` 合同与威胁建模 | 事件范围、通用文案、浏览器矩阵、Push 服务 origin/网络、保留期、告警出口、secret owner 和 threat model | 产品/安全/运维裁决齐全；开发/预生产/生产边界明确 | `NOT AUTHORIZED` |
| `PUSH-P1` 数据与服务端边界 | additive migration、RLS/RPC、订阅密文、rollout cohort、device-level delivery、feature flag | 空库重放、旧库升级/回滚、RLS/CSRF/SSRF/幂等/共享 owner 断言通过 | `NOT AUTHORIZED` |
| `PUSH-P2` 浏览器能力与 UX | 通知专用 SW、显式权限、设备设置、测试通知、点击鉴权、zh/en | localhost/HTTPS 的 Edge+Chrome 页面开/关、权限允许/拒绝、点击与账号切换旅程通过 | `NOT AUTHORIZED` |
| `PUSH-P3` Worker、重试与监控 | Web Push handler、VAPID、响应分类、TTL/jitter、熔断、dashboard、独立告警与 runbook | 故障注入、负载、Worker 崩溃/恢复、dead replay、secret/log 扫描和告警演练通过 | `NOT AUTHORIZED` |
| `PUSH-P4` 预生产完整验证 | 固定非生产目标、真实 Edge/Chrome Push endpoint、共享电脑、网络/防火墙、回退演练和完整 E2/E3 证据 | §13 所有 employee-test 前置项通过，无 Sev0/Sev1/未接受 Sev2 | `NOT AUTHORIZED` |
| `PUSH-P5` 生产暗部署 | schema/app/Worker 发布，`notifications.web_push=false`、integration disabled、cohort 空；生产 postflight | 备份/current/previous/ledger、Worker 停用态、旧站内通知、业务/Storage/错误不变量通过 | `NOT AUTHORIZED` |
| `PUSH-G5` 员工测试入口 Gate | §11 checklist、首批人员/设备 manifest、明确人工批准 | 全项 `PASS`，产品负责人明确确认“进入员工测试” | 改为 `AUTHORIZED` |
| `PUSH-P6` 小范围员工测试 | 3～5 名员工、至少 1 个共享电脑场景、5 个工作日、≥50 个 delivery target | §12 退出条件通过；失败则 kill switch 并回到对应阶段 | `EMPLOYEE TEST ACTIVE` |
| `PUSH-P7` 分批扩围与生产验收 | 25%→50%→100% 合格员工逐批 opt-in；14 天/≥100 target 观察 | §8 SLO、REL-03、共享设备、安全与支持记录通过，产品/运维/安全签收 | `PRODUCTION ACCEPTED` |

本轮不设置固定完成日期，也不把测试起止日作为代码施工前置。`PUSH-P0`～`PUSH-P5` 按可验证增量连续推进；遇到不影响暗部署 fail-closed 状态的问题时登记责任人、影响阶段和验证办法后继续。完成 `PUSH-P5` 只代表生产中已有关闭态代码与可回退底座，仍需 `PUSH-G5` 条件和人工确认才能确定员工测试窗口。

### 10.1 问题分级与非阻断账本

| 分级 | 处理规则 | 示例 |
| --- | --- | --- |
| `P5-HARD-BLOCK` | 立即停止对应生产写入或发布，保留已完成的开发增量；修复并重新验证后继续 | 生产目标/备份不明，migration 不可回滚，RLS/CSRF/SSRF 越权，endpoint/key 明文泄露，任一开关 fail-open，旧站内通知或领域事务回归 |
| `G5-BLOCK / DEV-CONTINUE` | 显式登记为 `BLOCKED` 或 `UNKNOWN`，允许继续实现、定向验证和关闭态暗部署；不得加入 tester、启用渠道或发送真实 Push | 员工名单与具体日期、最终告警出口、员工设备/浏览器清单、Push 服务生产网络、Windows/企业策略、人工文案验收、最终保留期签收 |
| `FOLLOW-UP` | 记录 owner 与期望结果，按正常增量处理，不改变 P5/G5 状态 | Dashboard 分组、设备标签措辞、支持材料排版、测试反馈字段 |

首批问题账本如下；状态随实现证据更新，不用等待全部产品答案才开始编码：

| ID | 当前状态 | 分级 | 暂定合同与继续方式 | 关闭条件 |
| --- | --- | --- | --- | --- |
| `PUSH-ISSUE-01` 员工测试窗口 | `OPEN` | `G5-BLOCK / DEV-CONTINUE` | 只登记周级或月级意向窗口；代码、预生产和 P5 不绑定具体日期 | `PUSH-G5` 前登记 3～5 名员工、设备范围和实际启动窗口 |
| `PUSH-ISSUE-02` 外部告警出口 | `OPEN` | `G5-BLOCK / DEV-CONTINUE` | 先实现告警事件、阈值、Dashboard 和可替换 adapter；P5 保持 Web Push handler disabled | 选定独立出口并完成一次告警—确认—恢复演练 |
| `PUSH-ISSUE-03` 保留期 | `OPEN` | `G5-BLOCK / DEV-CONTINUE` | 以可配置、默认不超过 90 天实现；撤销后立即清密文 | 隐私/运维负责人签收最终天数并验证清理 job |
| `PUSH-ISSUE-04` Push 服务与企业网络 | `OPEN` | `G5-BLOCK / DEV-CONTINUE` | origin allowlist 外置配置、默认空且 fail-closed；本地/预生产使用固定非生产目标 | 登记实际 endpoint origin，完成网络 preflight 与 Edge/Chrome 真机验证 |
| `PUSH-ISSUE-05` 首批通知文案 | `OPEN` | `FOLLOW-UP` | 代码只接受无变量的 zh/en 通用模板，不等待最终润色 | 产品负责人签收锁屏样本与双语文案 |
| `PUSH-ISSUE-06` 本机 Vitest 子进程权限 | `CLOSED` | `G5-BLOCK / DEV-CONTINUE` | 沙箱内 `spawn EPERM` 仍是 runner 限制；2026-09-03 已在获批的沙箱外 runner 直接运行定向文件 | `tests/web-push-production.test.ts` 9/9 通过；后续代码变化按受影响范围重跑 |
| `PUSH-ISSUE-07` Web Push 发送库锁定 | `CLOSED` | `G5-BLOCK / DEV-CONTINUE` | 初次安装受 pnpm store/审批服务影响；不手工伪造 lockfile，Worker 保持动态加载和关闭态 | 2026-09-03 已锁定 `web-push@3.6.7`，`package.json` 与 `pnpm-lock.yaml` 同步，定向合同通过 |
| `PUSH-ISSUE-08` 生成数据库类型 | `OPEN` | `G5-BLOCK / DEV-CONTINUE` | `src/lib/database.types.ts` 正由其他工作项修改，本地 schema 也含尚未冻结的后续 migration；当前 Web Push 代码使用窄化 RPC 边界，不覆盖并发改动 | 并发工作项收口后从完整候选 schema 重新生成，`pnpm db:types:check` 通过且无非本批漂移 |

### 10.2 当前实现与证据检查点

| 阶段 | 当前结果 | 仍需完成 | 员工测试状态 |
| --- | --- | --- | --- |
| `PUSH-P0` | 安全、共享电脑、三层开关、通用 payload、重试、监控、回退和人工 Gate 合同已写入本文 | 外部告警出口、最终保留期、生产 Push 网络与首批设备仍在 §10.1 账本 | `NOT AUTHORIZED` |
| `PUSH-P1` | `00750/00760` additive migration 已在本机明确 loopback 目标完成 rollback/零残留/formal；flag=false、integration disabled、cohort/subscription/delivery/job 均为 0，checksum 已入 ledger | 完整空库重放、生成类型与员工测试前安全负向矩阵 | `NOT AUTHORIZED` |
| `PUSH-P2` | 通知专用 SW、显式权限、逐设备 UI、登出撤销、点击再鉴权和 zh/en 已实现；固定员工账号暗态 Playwright 证明 permission request=0、SW registration=0、开启按钮禁用 | HTTPS 真机允许/拒绝/撤销、标签关闭与账号切换旅程 | `NOT AUTHORIZED` |
| `PUSH-P3` | Worker sender、加密/HMAC、响应分类、Retry-After/full jitter、TTL、404/410 清密文、熔断和聚合 Dashboard 已实现；`web-push@3.6.7` 已锁定，Vitest 9/9、暗态 Playwright 2/2 通过 | provider 故障注入、容量、独立告警演练和生产 Worker 激活前检查 | `NOT AUTHORIZED` |
| `PUSH-P4` | 尚未建立固定 HTTPS 非生产 Push 目标 | 完整 E2/E3、Edge/Chrome 真机、共享电脑与回退演练 | `NOT AUTHORIZED` |
| `PUSH-P5` | 发布 runbook 与不可变 release 的 Worker 打包合同已落地；生产仍未变更 | 冻结干净候选，生产只读 preflight/备份/rehearsal/formal/app 暗发布/postflight | `NOT AUTHORIZED` |

## 11. `PUSH-G5 · EMPLOYEE-TEST-ENTRY`

以下每项只能使用 `PASS / BLOCKED / UNKNOWN / NOT REQUIRED`。存在任一 `BLOCKED` 或 `UNKNOWN` 时，状态保持 `EMPLOYEE TEST NOT AUTHORIZED`。

### 11.1 产品与范围

- [ ] 首批 3～5 名员工、账号 UUID、设备类型、浏览器族和周级/月级意向窗口进入受控 manifest；实际开始时间可以在 Gate 通过后确定，仓库证据不保存姓名或联系方式。
- [ ] Web Push 只对 active staff/admin 生效；学生/家长和未列员工的订阅/投递负向用例通过。
- [ ] 通知 title/body、Push payload 和 Windows 锁屏样本均为通用内容，无 PII、业务 deep link 或动作按钮。
- [ ] 产品负责人完成开启、拒绝、关闭、测试通知、点击、到期和错误状态的 zh/en 人工初验。

### 11.2 安全与共享电脑

- [ ] subscription endpoint/key 的数据库、API、日志、错误、备份样本和 artifact 明文命中为 0；生产 secret 权限与版本登记完成。
- [ ] CSRF、SSRF、任意 endpoint、私网/回环、重定向、越权设备读取、跨账号 delivery 点击均被拒绝。
- [ ] A 开启→关闭页面收到通用通知→登出→B 登录的共享电脑旅程通过；B 不收到 A 的新投递，也不能解析 A 的旧 delivery。
- [ ] 正常登出、账号锁定、员工停用、rollout 移除、租期到期和 404/410 均会停止新发送并清除密文。
- [ ] Service Worker 无 `fetch` handler、无远程 import；安装前后登录、课堂、课件和静态资源请求行为一致。

### 11.3 重试、监控与恢复

- [ ] 2xx、400/413、401/403、404/410、429+`Retry-After`、5xx、DNS/TLS/timeout 和 lease timeout 故障矩阵通过。
- [ ] 重复 staging 新增 0；响应丢失重试时同一设备重复可见通知为 0；TTL 过期后不补发陈旧提醒。
- [ ] Worker 心跳、queue age、状态/错误类别、circuit breaker、订阅失效和 rollout cohort 在运行面板可见且无 endpoint/PII。
- [ ] 独立于 Web Push 的告警出口已选定；真实执行 Worker 失联和 provider auth 错误告警，记录确认人与恢复时间。
- [ ] kill switch 演练通过：关闭 feature flag/integration 后不再创建或发送 web_push，站内铃铛和领域事务继续正常。
- [ ] previous 应用回退与 additive schema 兼容；回退后已安装 SW 不影响页面网络，且因服务端关闭不再收到新 Push。

### 11.4 环境与完整验证

- [ ] 固定 HTTPS 预生产环境的 Edge/Chrome 当前稳定版真实 Push 通过；实际 endpoint origin 已脱敏登记，Xiaomi/公司网络出站和浏览器入站可达。
- [ ] Edge/Chrome 至少各完成：页面打开、标签页关闭、全部窗口关闭且后台允许、离线后 TTL 内恢复、权限拒绝、Windows 勿扰说明。
- [ ] 预生产 500 个 device-level delivery、50 并发目标的负载通过；95% job 在 60 秒内领取，最终未处置 dead=0。
- [ ] migration 空库重放、旧库升级、事务回滚/零残留、生成类型、定向测试、lint、typecheck、messages、production build 和 R1-Live 共享通知/auth smoke 通过。
- [ ] 生产暗部署完成：功能开关关闭、integration disabled、cohort 空、订阅/Push delivery=0；健康、错误增量和旧站内通知 postflight 通过。

### 11.5 人工授权

- [ ] 产品负责人核对本 Gate 证据后明确记录“进入员工测试”。
- [ ] 运维/安全负责人确认告警值守、kill switch 操作者、测试期支持入口和停止条件。
- [ ] 只有完成上述确认后，才为 manifest 中的员工加入 `employee_test` cohort，并按设备逐一主动开启。

## 12. 员工测试与扩围

### 12.1 首批员工测试

员工测试采用宽泛观察窗口，不预先锁死具体日期；实际开始由 `PUSH-G5` 人工确认触发。退出证据至少覆盖一个完整工作周中的 5 个有效工作日、3～5 名员工、Edge 与 Chrome、至少 1 次共享电脑账号切换和至少 50 个 device-level delivery；节假日、员工缺席或样本不足时顺延，不因日历到期自动通过。可以使用明确标记的通用测试通知补足边界验证；不得制造学生、班级、财务或其他虚假正式业务记录。

每台设备至少完成：

1. 主动开启、发送测试通知、关闭标签页后收到并点击正确回站。
2. 浏览器窗口全部关闭但后台允许时收到；任务管理器结束浏览器时明确展示“不保证”的产品边界。
3. 同一通知在多标签页、Worker 重试和重新聚焦后只出现一个可见系统通知。
4. 断网后在 TTL 内恢复收到一次；超过 TTL 的通知不再显示。
5. 关闭设备通知后不再产生新 Push delivery；站内铃铛仍出现同一业务通知。
6. 共享电脑完成 A→登出→B，通知中心和点击路径不暴露 A 的业务内容。
7. 权限拒绝、Windows 通知关闭和勿扰模式都有可操作说明，不阻断其他业务。

测试期间每日查看 Worker 心跳、queue age、失败分类、dead letter、404/410、重复报告和支持记录。员工反馈只记录设备/浏览器族、delivery ID、时间和现象，不收集完整通知截图或个人资料。

### 12.2 立即停止条件

出现下列任一项时立即关闭 `notifications.web_push` 和 integration channel，保留站内通知并进入事件处理：

- 任一跨账号投递、跨账号点击解析或敏感信息出现在 Push payload/锁屏/日志。
- VAPID private key、subscription endpoint、`p256dh/auth` 或应用层加密 key 泄露。
- Worker 失联超过 5 分钟且无法在值守窗口恢复，或出现未处置 dead job。
- 重复可见通知持续出现、队列无界增长、Push 发送拖慢领域事务或旧站内通知回归。
- provider 网络/企业防火墙使目标浏览器族无法达到员工测试基本旅程。

### 12.3 首批测试退出条件

- Sev0=0、Sev1=0、未接受 Sev2=0；跨账号/PII/secret 事件=0。
- ≥50 个 target 中，排除主动撤销、TTL 过期和 404/410 后的最终 `sent` ≥99%；未处置 dead=0。
- Edge、Chrome和共享电脑旅程全部通过；员工能理解开启、关闭、浏览器后台与“已接受≠已显示”状态。
- 同一设备重复可见通知=0；正常登出/账号切换后的错误接收=0。
- 产品、运维、安全负责人分别签收体验、值守/恢复和安全边界。

通过后按 25%→50%→100% 合格员工逐批扩围，每批至少观察 1 个工作日。任一批次未达到 §8 门槛即停止扩围并回到上一 cohort。Production 1.0 的 M4 仍需 doc 25 的 14 天 RC、REL-03、完整恢复与发布审批；首批员工测试通过不能替代这些门。

## 13. 完整验证矩阵

| 层 | 必测合同 | 证据等级 |
| --- | --- | --- |
| 纯函数/contract | payload schema、通用文案、URL/endpoint 校验、响应分类、Retry-After、jitter/TTL、状态机、tag | E2 |
| 数据库 | 空库/旧库、RLS、角色资格、rollout、active endpoint 唯一、设备上限、共享 owner 协调、幂等 staging、撤销/到期、delivery/job 一致性 | E2 |
| API/Auth | user gesture 后注册、`getUser`、Origin/CSRF、限流、密文/HMAC、越权设备列表、账号切换、停用员工 | E2/E3 |
| Service Worker | 安装/升级、未知 payload、push、短期去重账本、过期清理、click、existing client focus、openWindow、无 fetch/cache、tombstone 回退 | E2/E3 |
| Worker | 2xx/4xx/5xx/网络故障、lease recovery、max attempts、dead/replay、404/410 清理、熔断、日志脱敏 | E2/E3 |
| 浏览器/系统 | Edge/Chrome、权限三态、标签页关闭、窗口关闭、离线/恢复、勿扰、Windows 锁屏、个人/共享设备 | E3/E4 |
| 性能/容量 | 500 delivery、50 并发、领取时延、Worker CPU/内存、队列清空、provider 限流 | E3 |
| 安全 | CSRF、SSRF/DNS rebinding、endpoint/key 泄露、跨账号、相对路径/open redirect、员工停用、secret rotation | E2/E3 |
| 发布/回退 | target preflight、备份、migration rollback/正式应用、app current/previous、feature flag off/on/off、SW 持久化、旧站内通知 | E3 |
| 员工测试/RC | 首批 5 个工作日、分批扩围、支持/告警、14 天与 REL-03 | E4 |

当前窄命令入口为 `pnpm web-push:db-audit`、`tests/web-push-production.test.ts` 与 `e2e/web-push-dark.spec.ts`；生产暗发布执行 [`employee-web-push-dark-deployment.md`](../runbooks/employee-web-push-dark-deployment.md)。同一代码与目标已有可信结果时复用，员工测试前执行一次完整 Gate，不在每个小补丁重复跑全量矩阵。

## 14. 发布、kill switch 与回退

### 14.1 三层开关

1. `notifications.web_push` feature flag：控制是否为新通知 staging Web Push。
2. `integration_channels.web_push.status`：控制 Worker 是否允许向 Push 服务发送，并承载 provider 熔断。
3. rollout cohort + 用户设备 opt-in：控制具体接收人和设备。

任一层关闭都 fail-closed。紧急停止顺序为 feature flag off → integration disabled → 暂停 Worker 的 `notification.web_push` handler；站内通知、其他 job 和领域写入继续运行。

### 14.2 生产发布顺序

1. 按生产写目标 runbook 完成只读 preflight、当前备份、ledger/current/previous、网络与 secret 位置核对。
2. 先发布 additive schema/RLS/RPC，保持 flag off、integration disabled、cohort 空；核对旧应用兼容。
3. 发布应用与通知专用 SW；验证未主动开启时没有订阅、permission prompt 或页面网络变化。
4. 部署独立受监管的 production job Worker，先以 Web Push handler disabled 运行并验证 heartbeat/告警。
5. 完成暗部署 postflight 和 `PUSH-G5` 后，只加入批准 tester；按设备主动开启。

### 14.3 回退

- 行为回退优先使用三层开关，不删除订阅/投递审计、不恢复数据库。
- 应用 previous 必须能在新增 schema 存在时继续运行；migration 以 forward-fix 为默认，只有暗部署期间且无正式订阅/投递时才演练事务 rollback。
- 回退应用前先停止 Web Push staging/发送。残留 Service Worker 因无 `fetch` handler且无新 Push，不影响站点；恢复后由兼容脚本重新管理。
- VAPID key 轮换会使旧 subscription 需要重新订阅；轮换 runbook 先并行识别 key version，再分批要求员工重开，不能静默使用未知 key。

## 15. 产物、证据与责任

### 15.1 预期产物

- additive database migration、生成类型和 SQL/RLS/升级/回滚断言。
- 通知专用 Service Worker、订阅 client-safe contract、受保护 server module/API、铃铛与账号中心设备 UI。
- Web Push Worker handler、provider 出站校验、VAPID/密文 key version、重试/熔断与运维指标。
- `docs/runbooks/` 下的配置、secret 轮换、浏览器/Windows、共享电脑、告警、kill switch、发布和回退手册。
- `docs/evidence/r1/` 下的无 PII 小摘要，以及受控 artifact 的 URL/path、规范化 SHA-256、保留期和访问角色。

### 15.2 责任边界

| 责任 | 人工确认 |
| --- | --- |
| 产品 | 通用文案、首批员工、设备模式、进入员工测试、扩围与最终体验签收 |
| 安全/隐私 | threat model、endpoint/key 保护、共享电脑、保留期、锁屏内容和 secret rotation |
| 运维 | Push 服务网络、Worker、独立告警、kill switch、发布/回退和值守 |
| QA/发布 | 固定环境矩阵、故障注入、浏览器/系统证据、Gate 状态与 RC 汇总 |
| Agent/自动化 | 获授权的实现、机器验证和证据整理；不替代员工测试者、产品批准人或生产高风险动作确认 |

### 15.3 状态更新

- 本文是 Web Push 范围、阶段、员工测试入口和退出条件的权威专题。
- doc 04 只登记当前开发轨状态与本文链接；doc 25 只登记 Production 1.0 成熟度、风险和 REL-03 关系。
- 每个独立可验收增量提交本任务文件；开发可验收、生产暗部署、员工测试 active、员工测试通过和 Production 1.0 M4 分别记录。
- 只有对应 Gate 真实关闭时才同步专题状态头、doc 04、doc 25 和证据索引，并运行 `pnpm plan:audit`。

## 16. 官方技术依据

- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)：Push 可在应用不处于前台或未加载时由 Service Worker 接收；subscription endpoint 是需要保密的 capability URL，并提示订阅接口需要 CSRF 防护。
- [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)：Service Worker 只在 HTTPS 安全上下文可用，`localhost` 是开发例外。
- [W3C Push API](https://www.w3.org/TR/push-api/)：订阅、权限、刷新、加密 key、Push 服务元数据和生命周期规范。
- [RFC 8291 · Web Push Encryption](https://www.rfc-editor.org/rfc/rfc8291.html) 与 [RFC 8292 · VAPID](https://www.rfc-editor.org/rfc/rfc8292.html)：消息加密、应用服务器身份与订阅限制。
- [Microsoft Edge `NotificationsAllowedForUrls`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/notificationsallowedforurls)：公司设备可按 URL pattern 管理允许显示通知的站点；该策略不替代 Mathin 内的用户 opt-in 与共享电脑控制。
