# 员工 Windows Edge 桌面提醒 · 生产启用 · 2026-09-09

状态：`EMPLOYEE TEST ACTIVE / PENDING USER ACCEPTANCE`。产品负责人本次明确指令“启用生产”，范围为全部当前在职 staff/admin、Windows Edge 自主开启。P6 员工观察已开始；不将机器检查记为人工 Windows 验收，不关闭完整 PUSH-G5/P7、R1-Live Gate 2 或 Production 1.0。

## 发布与受控目标

- 生产目标：Xiaomi、`https://mathin.club`、`https://supabase.mathin.club`；数据库 fingerprint `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`。
- 独立候选从实际生产 `c63a47b5b0d5031ea3c34cd934fbf6307abd37b0` 创建，保留同日已经上线的学服业务。已部署 commit：`c7009ec054d3397b235cb5acda96e82f6a9fbbcc`，分支 `codex/web-push-production-20260909`。
- current：`20260909-074028`；previous：`20260909-042441 / c63a47b5…`。应用原子切换，原版本保留可回退。
- 唯一新增迁移：`20260909009000_employee_web_push_activation_safety`；规范化 SHA-256 `44e3be268a19c8eda10abbfa0ec102da395b8271c05a3b53cce1bfc405b8d45b`。正式提交后 ledger 为 366 条。
- 最终写前备份：`/home/swing/services/mathin/backups/mathin-db-prechange-20260909T073507Z-web-push-c7009ec054d3`；custom dump 337,317,224 字节，SHA-256 `85ea7da6938cb303755b4326a2148f93857ebef591a9cdd34bcf089873216253`。TOC、校验、同文件事务 rehearsal、独立零残留与 formal postflight 通过。备份为生产本机副本，不宣称异机恢复门已完成。
- 生产受控记录目录：`/home/swing/services/mathin/staging/web-push-c7009ec054d3`。员工 UUID 仅保存在该目录的 owner-only manifest；仓库保留聚合人数和摘要。

## 已完成的机器与运行验证

| 检查 | 结果与边界 |
| --- | --- |
| 安全与队列 | PASS：同源/身份、Windows Edge/WNS 范围、DNS/socket 公网与重绑定防护、逐账号并发锁、密钥版本、跨账号拒绝、员工失效/到期清密文、响应/重试/TTL/租约矩阵；本机固定账号数据库事务与独立回滚通过 |
| 容量合同 | PASS：500 个目标、50 并发的受控队列/provider 隔离测试；不是 500 条真实 Windows 展示记录 |
| Auth 与关闭态页面 | PASS：既有退出登录错误修复，定向单元与固定开发员工退出→保护页重鉴权通过；zh/en 关闭态 E2E、类型、lint、双语键与本地发布检查通过 |
| 生产构建 | PASS：373 个页面生成；worker 26 个依赖包独立打包并实际加载。构建第一次触及默认 2 GB 堆上限，仅将本次构建进程改为 3 GB 后通过，未改变应用 service 内存配置 |
| 实际生产 Push 出站 | PASS：Xiaomi 通过 release 内实际网络防护直连 `https://wns2-sg2p.notify.windows.com`，返回 201；独立 Windows Edge 测试配置在标签关闭后取得通知对象，重复投递仍为 1 条；临时订阅随后注销，没有写入生产账号/订阅表 |
| 独立告警 | PASS：实际聚合 RPC → 同一 Python monitor → SMTP；worker 心跳缺失/恢复，以及明确标记的模拟 provider 401 降级/恢复，共四封演练邮件获 SMTP 接收。原验证邮件已由负责人确认收到；四封演练的人工收件确认不预填 |
| 生产页面 | PASS：公开与内部健康、zh/en 登录、匿名保护页转登录、通知专用 Service Worker 可读；未替员工触发通知权限或注册 |

生产脚本诊断过程中补齐了两个问题：独立 worker 的间接依赖原先未完整打包；远程临时诊断模块需要显式 file URL。后者仅为本机运行的诊断脚本修复，不影响已部署业务 runtime，也不因此重建生产应用。

## 启用后事实

核对时间：2026-09-09 15:49（Asia/Shanghai）。

- `notifications.web_push=true`，integration=`enabled`，专用 `mathin-jobs.service` active/enabled，实际 `R1_JOB_SCOPE=web_push`；独立 `mathin-web-push-monitor.timer` active/enabled，每分钟检查。
- `role in ('staff','admin') AND is_active AND account_status='active'` 的当前快照共 36 个账号，全部进入 `employee_test`；合格数 36，范围外成员 0。新账号不自动加入这份快照。
- 员工 manifest 的 UUID 列表摘要：`004dd4082f7b357297575f027755f2763a88bf5b5974f8e7464b1d40eedf0d1e`。VAPID、加密和 fingerprint 密钥在生产生成；运行配置、告警配置和监控状态文件均为 `0600`。
- 开启时 subscription / Web Push job / Web Push delivery 均为 0，符合逐员工、逐设备主动授权；没有创建测试身份或虚假学生/班级/财务事实。
- 原 3 个非推送 Job 的完整摘要不变；身份、员工资料、学生、教室、课次、考勤与 Storage 的冻结计数/适用摘要不变。
- 应用与 worker `NRestarts=0 / ExecMainStatus=0`；监控无告警，worker 心跳年龄不足 1 秒，dead/failed/queued=0；发布后 `operational_errors` 增量为 0。

## 员工操作、观察与回退

员工在 Windows Edge 登录 [Mathin 账号安全](https://mathin.club/zh/dashboard/account-security)，选择“桌面通知”，点击在当前电脑开启并允许浏览器通知，再发送通用测试提醒。默认共享电脑租期为 8 小时；个人电脑由员工明确选择。站内铃铛继续保持原行为。

待人工观察：Windows 横幅与锁屏文案、全部浏览器窗口关闭时后台接收、共享电脑完整 UI 旅程、实际员工反馈与 5 个有效工作日/至少 50 个 device-level target。最终保留期/清理任务、支持与安全签收、完整容量/SLO、14 天观察仍按专题保留，不冒充正式验收。

停止顺序保持 feature flag off → integration disabled → 停止推送 worker；应用可切回上述 previous，additive schema 保留。停止或回退均保留投递审计，按[运维手册](../../runbooks/employee-web-push-dark-deployment.md)执行。
