# 微信登录基础功能与统一登录卡 · 2026-09-25

状态：**生产已部署，机器发布检查通过；微信入口关闭，真实扫码与界面人工验收待完成**。本记录不关闭 R1-Live Gate。

## 范围与入口

- 产品负责人本次明确要求“下一步，并部署生产”。从实际生产基线建立独立候选，只合入微信桥接、已有账号绑定、统一登录卡和浮窗、邮箱分体输入及自定义域名修复、必要的部署支持。
- 登录入口：[中文](https://mathin.club/zh/login)、[英文](https://mathin.club/en/login)。本次未发布开发分支中的课后学情、作业题库、学生跟进或表格新改动。
- 开放平台授权回调域：`mathin.club`。微信回调：`https://mathin.club/zh/auth/wechat/callback`。该路由现已上线；入口关闭时返回 303 至登录页的未启用状态。
- 网站应用已由用户提交审核，服务器尚无网站应用 AppID/AppSecret。应用三个启用／验证开关均为 false，Supabase `custom:wechat` provider 为 disabled，直接调用 provider 入口也被拒绝。
- 首次授权的游客、原账号双向绑定及管理员邀请角色边界保留原设计。本次部署没有对正式账号执行扫码、绑定、解绑或角色变更。

## 发布版本

| 项目 | 值 |
| --- | --- |
| 原生产提交 | `a42036228bde5c0c187e8dfdeee869fd031abde3` |
| 最终生产提交 | `2a0b12bacdf15e0af65534e714373e40629fcda7` |
| current / previous | `20260925-020701` / `20260924-141258` |
| 切换时间 | 2026-09-25 10:11（Asia/Shanghai） |
| ledger | 436 → 437 |
| migration | `20260925001000_wechat_oauth_tickets` |
| migration SHA-256 | `22bcc8fb619984b5e731ff3f4d1edee73f4cfce29735fc14f7858c4729ca3d7c` |
| Auth 镜像 | `mathin/gotrue:v2.189.0-wechat.1` |
| Auth 版本 | `v2.189.0-mathin.wechat.1` |
| Auth image ID | `sha256:ebfeb6b7bd417f293ea722129608d99da6ab8fbe85b5a758401f0fc181c1f680` |
| previous Auth image ID | `sha256:385184459f57569c54c25209f51f3b2be99ddd7c4ce9e3555b5d3eea8447b7cf` |

迁移与写前备份先绑定候选 `bf1dce241f8b635eb551aa64fc3cd7a3ae05f8b9`。生产构建后的 HTTP 检查发现全局 Referrer-Policy 覆盖授权路由的 no-referrer；最终候选只追加 Next 响应头配置和对应回归测试两个文件。迁移文件摘要保持不变，迁移证据与最终应用证据分别归档。第一版应用未接收生产流量。

## 备份、迁移与数据保护

- 只读核对 SSH 执行主机、应用实际 Supabase origin、进程目录、loopback 监听及数据库指纹。正式切换前最近六小时启动且未结束的有效课次为 0。
- 写前备份：`mathin-db-prechange-20260925T015642Z-wechat-oauth`，357,050,267 字节；SHA-256：`cd1e06c0db4573ae38d0e1a1de8764cf91a40292b39f4f40130640f0f21c5ff9`。PostgreSQL custom dump 目录检查通过，含 Auth 与业务数据。保留至至少 2026-12-25，仅生产运维角色可访问；本轮未执行整库恢复演练。
- 首次演练因目录视图按生产 search_path 将 `auth.uid()` 显示为 `uid()` 而触发断言；事务回滚后独立连接确认零残留。校验连接使用空 search_path 后，SERIALIZABLE 演练及零残留检查通过；冻结的迁移文件未改动。
- 正式事务复核新增表 RLS、API 角色 ACL、service role 最小授权、不可变审计、函数 owner／search_path、身份唯一索引、三个触发器和两个本人读取策略。PostgREST schema cache 的空表读取返回 200。
- 原账号、档案及身份记录摘要不变。41 个 Auth 用户、41 个档案、43 个 identity、34 个班级、429 个课次、39 条考勤、3,774 个课件 release、126,542 个 Storage 对象数量保持不变。
- 发布后四张微信表及微信 identity 均为 0。本次没有创建账号、消费邀请、填写课程数据或修改角色。

## 运行配置与检查

- 复用候选已通过的 96 项定向合同检查；新增授权响应头 3 项回归及相关 lint 通过。最终生产构建通过，保留旧版全部 431 个 Server Action 与加密配置；发布文件凭据扫描通过。
- 候选／previous 临时 loopback 启动、健康、双语登录、匿名保护路由和指针往返演练通过。正式原子切换及原有 Web Push Worker 重启后，公网检查通过，检查窗口内新增应用／原有 Worker 错误为 0。
- 中文、英文微信 authorize/callback 在关闭状态返回 303；token/userinfo 返回 400，均保留 no-store 与 no-referrer。普通 Auth callback 的错误分支正确返回登录页。没有游客证明时，游客页重定向回登录页，未展示课程数据。
- 服务端私有配置生成独立桥接密钥，通过 Auth 管理 API 注册禁用 provider；PKCE 与 email_optional 为 true。原 Auth 环境、公开端口和邀请注册配置保持不变，manual linking 仍关闭。
- Auth 在保留原镜像与 Compose 备份的条件下切换到同版本最小补丁，容器及公网健康检查通过；失败恢复分支已备妥。本轮没有在正式账号上验证密码登录或真实微信绑定，复用此前隔离目标的原生 Auth／SDK 验证。
- Caddy 配置先校验再热加载，应用上游覆盖 X-Real-IP。依照 [Caddy 日志过滤文档](https://caddyserver.com/docs/caddyfile/directives/log#filter)，两个域名的访问日志去掉 query 和请求／响应头；用无凭据诊断参数实测过滤生效。反向代理链中的真实访客 IP 和 Auth／Kong 全链路日志仍须在开放前联调核对。
- 无 pg_cron，已启用 `mathin-wechat-maintenance.service`，scope 固定 `wechat_oauth`。Worker 固定到本次不可变 release，应用回切 previous 后仍可运行；每分钟清除过期票据与限流行，并检查超期游客资料计数。连续心跳及多轮清理成功，未领取业务任务。
- `mathin-wechat-maintenance-monitor.timer` 每分钟检查进程、专用心跳（最长 180 秒）、版本及未领取业务任务的状态。检查失败以 systemd 失败状态和固定错误码记录；本次没有发送测试邮件或外部通知。

## 开放与回退边界

审核通过后，将真实网站应用凭据写入服务端私有配置，完成完整代理／日志链、精确回调 allowlist、邀请注册边界及获准正式身份的真实扫码验收，再有序开启 manual linking、provider 和应用验证开关。邮箱与纯手机号都需覆盖绑定原 UUID、再次微信登录、冲突、MFA 和解绑；不创建一次性生产测试账号。网站 OAuth 本身不返回手机号。

回退时保持微信入口与 provider 关闭，应用回切 `20260924-141258`，Auth 使用备份 Compose 和原镜像恢复，按需要恢复原代理配置。新增 schema 与审计保留；微信清理服务继续使用本次固定 release。备份、冻结源码、29 份发布／配置证据及摘要保存在生产受控备份目录，私有配置与原始日志不进入仓库。
