# 员工 Web Push 启用准备检查点 · 2026-09-09

状态：`EMPLOYEE TEST AUTHORIZED / ACTIVATION PREPARATION PENDING`。这是定向开发证据与交接，不关闭 PUSH-G5、R1-Live 或 Production 1.0 Gate。

## 范围与候选

- 产品负责人已授权向启用时全部在职 staff/admin 开放测试，员工逐设备自主开启；不再采用 3～5 人或比例梯度。授权以[专题状态头](../../plan/employee-desktop-web-push.md)为准，继续工作时沿用。
- 独立分支 `codex/web-push-employee-test-20260909` 从生产当时的完整 commit `28ae40e6c59446ebc6033ce7a28c4e15d1e667fe` 创建；没有把主工作树的其他业务增量带入候选。
- 增量包含专用推送队列领取/租约恢复、有效员工校验与即时撤销、到期密文清除、显式 Push 代理、独立 SMTP 聚合告警、systemd 模板与复用断言。
- 新迁移 `20260909009000_employee_web_push_activation_safety.sql` 尚未应用生产；应用/worker/monitor 尚未发布或启动。

## 机器结果

| 检查 | 结果与边界 |
| --- | --- |
| 实际 sender 与 provider 隔离测试 | PASS，21 项；覆盖通用 payload、显式代理、撤销/过期/不合格/关闭/归档/已发送、HTTP 400/401/403/404/410/413/429/500/503、DNS/TLS/timeout、最终 dead；provider 为测试替身 |
| Worker cycle 与现有生产合同 | PASS，4+9 项；只调用专用 RPC、批内并行、异常 fail-closed、无跨 kind handler；保留既有加密/同源/payload/部署合同 |
| 真实本机数据库事务 | PASS；先核对 Docker Desktop 监听进程、loopback gateway 与非生产数据库指纹，再加载候选迁移；只复用固定开发管理员/教师，不创建身份 |
| 数据库行为 | PASS；共享 8 小时/个人 30 天、同 endpoint 换 owner 清旧密文、跨账号设备/撤销/点击拒绝、测试通知限流、员工停用即时撤销、到期清密文、专用领取不碰 file.verify、最终租约超时转 dead、feature kill switch、仅 service-role 的聚合 monitor RPC |
| 独立回滚核对 | PASS；新连接核对 profiles/rollout/feature/integration 摘要、订阅/job/event/delivery 数量、原 eligibility 定义及新增 RPC 均与写前相同 |
| 邮件 monitor 单元测试 | PASS，6 项；去重与恢复、Worker/provider auth/read failure、关闭态静默、积压持续阈值、畸形数据/私有字段过滤、邮件失败不记作成功 |
| TypeScript / 定向 ESLint | PASS；没有运行本批尚未进入的正式发布 build/Gate |
| Edge 真实 provider | PASS：`https://wns2-sg2p.notify.windows.com` 返回 201；关闭测试标签页后通知对象出现，同 delivery 重发后仍为 1 条 |
| Chrome 真实 provider | PASS：`https://fcm.googleapis.com` 经显式代理返回 201；关闭测试标签页、重复通知去重通过。之前一次临时订阅返回 410，下一独立新订阅成功；未将失效订阅继续重试 |

浏览器测试使用已安装浏览器的独立临时配置、真实 Push 服务与仓库 Service Worker，结束后注销订阅并清理临时配置。它验证浏览器通知对象，不等于负责人已人工看到 Windows 横幅，也不覆盖全部窗口关闭、勿扰、离线恢复和完整共享电脑 UI 旅程。按 verify 配方复用锁定浏览器依赖与固定开发账号，未创建一次性账号。

## 网络、邮箱与生产状态

- 只读核对时生产 current 为 `20260909-032243`，应用健康、worker inactive。feature off、integration disabled/secret null、cohort/subscription/web_push job/delivery 全为 0；现有其他 kind 的 pending job 没有被本任务执行。
- Xiaomi 直连 WNS 的 TLS/HTTP 探针得到预期 404（服务根路径）；直连 FCM 失败。既有代理可连接两家服务，但代理运行在开发电脑，尚未登记为可独立长期使用的生产出口。这不是生产实际投递 201 的证据。
- 既有 SMTP 的 TLS 登录与发送验证通过，负责人确认收到发往其指定邮箱的验证邮件。收件地址与凭据只在受控位置，不写仓库；此验证不等于 Worker 失联/provider auth 的整链告警恢复演练已完成。
- 本次生产外部动作只有授权的验证邮件；没有修改生产 secret、服务、schema、开关、员工 cohort 或正式业务数据。

## 后续启用步骤

1. 确定生产长期可用的 Chrome/FCM 出口；若产品调整首轮浏览器支持范围，明确记录该范围。全员人数授权持续有效，不再次索要同一授权。
2. 补齐实际 DNS/连接阶段的私网与 DNS rebinding 防护及负向测试、注册/测试通知并发限流、密钥版本/轮换检查、共享电脑完整浏览器旅程、容量与真实告警恢复；未完成项保持 UNKNOWN，不按机器测试总数判 G5 通过。
3. 对最终候选执行对应生成类型/构建和发布前门；保留本检查点已通过且输入不变的结果，不重复相同回归。保留期、Windows 样本及值守签收分别如实登记。
4. 重新只读核对最新生产 commit/ledger/指纹并冻结候选；新鲜备份、同文件 migration rehearsal、独立零残留后 formal，按[runbook](../../runbooks/employee-web-push-dark-deployment.md)发布专用 worker 和独立 monitor。
5. 将当时全部在职员工 UUID 快照写入 owner-only manifest，沿用已授权范围启用三层开关与 cohort；员工自行开启，postflight 后才报告“已部署待员工验收”。

截至本检查点，生产尚未开放员工推送；机器检查通过与生产启用、用户验收、正式 Gate 关闭保持分开。
