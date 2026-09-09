# 员工 Web Push 启用准备检查点 · 2026-09-09

历史准备状态：`EMPLOYEE TEST AUTHORIZED / ACTIVATION PREPARATION PENDING`。本页保留启用前定向开发证据；同日后续已完成生产启用，当前事实见[独立生产启用记录](employee-web-push-production-activation-20260909.md)。不关闭完整 PUSH-G5、R1-Live 或 Production 1.0 Gate。

## 范围与候选

- 产品负责人已授权向启用时全部在职 staff/admin 开放测试，员工逐设备自主开启；不再采用 3～5 人或比例梯度。授权以[专题状态头](../../plan/employee-desktop-web-push.md)为准，继续工作时沿用。
- 独立分支 `codex/web-push-employee-test-20260909` 从生产当时的完整 commit `28ae40e6c59446ebc6033ce7a28c4e15d1e667fe` 创建；没有把主工作树的其他业务增量带入候选。
- 增量包含专用推送队列领取/租约恢复、有效员工校验与即时撤销、到期密文清除、独立 SMTP 聚合告警、systemd 模板与复用断言。随后按同日产品裁决收敛为 Windows Edge / Microsoft WNS 直连，移除 Push 代理。
- 新迁移 `20260909009000_employee_web_push_activation_safety.sql` 尚未应用生产；应用/worker/monitor 尚未发布或启动。

## 机器结果

| 检查 | 结果与边界 |
| --- | --- |
| 实际 sender 与 provider 隔离测试 | PASS，25 项；覆盖通用 payload、Windows Edge 范围、拒绝 FCM、忽略旧代理环境变量、撤销/过期/不合格/关闭/归档/已发送、HTTP 400/401/403/404/410/413/429/500/503、DNS/TLS/timeout、最终 dead；provider 为测试替身 |
| Windows Edge 范围合同 | PASS，17 项；浏览器识别、Windows 范围、WNS 严格 origin、伪装域名/非标准端口拒绝、同源已认证加密注册及不支持的浏览器拒绝 |
| Worker cycle 与现有生产合同 | PASS，4+9 项；只调用专用 RPC、批内并行、异常 fail-closed、无跨 kind handler；保留既有加密/同源/payload/部署合同 |
| 真实本机数据库事务 | PASS；先核对 Docker Desktop 监听进程、loopback gateway 与非生产数据库指纹，再加载候选迁移；只复用固定开发管理员/教师，不创建身份 |
| 数据库行为 | PASS；共享 8 小时/个人 30 天、同 endpoint 换 owner 清旧密文、跨账号设备/撤销/点击拒绝、测试通知限流、员工停用即时撤销、到期清密文、专用领取不碰 file.verify、最终租约超时转 dead、feature kill switch、仅 service-role 的聚合 monitor RPC |
| 独立回滚核对 | PASS；新连接核对 profiles/rollout/feature/integration 摘要、订阅/job/event/delivery 数量、原 eligibility 定义及新增 RPC 均与写前相同 |
| 邮件 monitor 单元测试 | PASS，6 项；去重与恢复、Worker/provider auth/read failure、关闭态静默、积压持续阈值、畸形数据/私有字段过滤、邮件失败不记作成功 |
| TypeScript / 定向 ESLint | PASS；没有运行本批尚未进入的正式发布 build/Gate |
| Edge 真实 provider | PASS：`https://wns2-sg2p.notify.windows.com` 返回 201；关闭测试标签页后通知对象出现，同 delivery 重发后仍为 1 条 |
| Chrome 历史探索（已移出本轮范围） | 曾验证 `https://fcm.googleapis.com` 经显式代理返回 201，关闭测试标签页、重复通知去重通过；之前一次临时订阅返回 410，下一独立新订阅成功。该记录仅保留历史，不构成本轮要求或生产支持承诺 |

浏览器测试使用已安装浏览器的独立临时配置、真实 Push 服务与仓库 Service Worker，结束后注销订阅并清理临时配置。它验证浏览器通知对象，不等于负责人已人工看到 Windows 横幅，也不覆盖全部窗口关闭、勿扰、离线恢复和完整共享电脑 UI 旅程。按 verify 配方复用锁定浏览器依赖与固定开发账号，未创建一次性账号。

## 网络、邮箱与生产状态

- 只读核对时生产 current 为 `20260909-032243`，应用健康、worker inactive。feature off、integration disabled/secret null、cohort/subscription/web_push job/delivery 全为 0；现有其他 kind 的 pending job 没有被本任务执行。
- Xiaomi 直连 WNS 的 TLS/HTTP 探针得到预期 404（服务根路径），不是生产实际投递 201 的证据。历史探索中直连 FCM 失败、经开发电脑代理可达；产品负责人已将 FCM 与代理移出本轮范围，此差异不再阻断本轮。
- 既有 SMTP 的 TLS 登录与发送验证通过，负责人确认收到发往其指定邮箱的验证邮件。收件地址与凭据只在受控位置，不写仓库；此验证不等于 Worker 失联/provider auth 的整链告警恢复演练已完成。
- 本次生产外部动作只有授权的验证邮件；没有修改生产 secret、服务、schema、开关、员工 cohort 或正式业务数据。

## 后续启用步骤

1. 沿用已确定的 Windows Edge / Microsoft WNS 直连范围，生产激活前核验实际 WNS 投递 201。Chrome/FCM 与代理出口不再是前置项；全员人数授权持续有效，不再次索要同一授权。
2. DNS/socket 私网防护、逐账号串行限流、密钥版本检查与退出登录回归已在下方增量补齐；继续完成生产 WNS 实际投递、真实告警恢复和员工 Windows 体验验收。各证据保持实际覆盖范围，不按机器测试总数判 G5 通过。
3. 对最终候选执行对应生成类型/构建和发布前门；保留本检查点已通过且输入不变的结果，不重复相同回归。保留期、Windows 样本及值守签收分别如实登记。
4. 重新只读核对最新生产 commit/ledger/指纹并冻结候选；新鲜备份、同文件 migration rehearsal、独立零残留后 formal，按[runbook](../../runbooks/employee-web-push-dark-deployment.md)发布专用 worker 和独立 monitor。
5. 将当时全部在职员工 UUID 快照写入 owner-only manifest，沿用已授权范围启用三层开关与 cohort；员工自行开启，postflight 后才报告“已部署待员工验收”。

截至本检查点，生产尚未开放员工推送；机器检查通过与生产启用、用户验收、正式 Gate 关闭保持分开。

## 同日 Edge-only 增量

- 页面在非 Windows Edge 浏览器中给出双语支持范围说明，保持开启按钮禁用；不请求通知权限或注册 Service Worker，站内铃铛照常。
- 同源 Server Action 同时核对实际 User-Agent 与设备元数据；Worker 再核对设备范围，并仅向已登记的 Microsoft WNS HTTPS origin 投递。UA 是支持范围判断，不替代身份与权限检查。
- 移除 sender 与真实浏览器检查脚本的 Push 代理配置；复用已取得的 Edge 实际 provider 201 结果。本增量的 3 份定向 Vitest 共 51 项、TypeScript、受影响 ESLint 和双语键检查通过；没有重复数据库事务或全量回归，也没有新增人工视觉验收结论。
- 本增量未修改生产配置、数据库或服务。继续启用时从最新生产 commit 重新冻结候选，避免回退同日其他已发布业务。

## 生产启用指令后的安全增量

产品负责人继续明确要求“启用生产”。候选从当时最新生产 `c63a47b5b0d5031ea3c34cd934fbf6307abd37b0` 重建，完整保留已上线的学服分班调整；实际在职 staff/admin 为 36 个账号，沿用全员授权。

- 新增 HTTPS socket lookup 防护：仅连接精确登记的 WNS origin，全部解析地址均须为公网地址；实际连接直接复用已检查结果，不再二次解析。地址、混合公网/私网与重绑定负向测试通过。
- 登记设备和通用测试提醒使用同一逐账号事务锁，数据库同时限制 Windows Edge；发送前核对加密和 VAPID 版本。更新后的数据库行为事务、独立回滚及函数/ACL 摘要核对通过。
- 通过现有 pg-meta 的单连接事务生成实际候选类型，完成后回滚并独立核对；没有持久修改本机 schema。生成结果包含新增 RPC 以及生产已存在的分班预览重载。
- Worker 的 500 目标 / 50 并发受控队列测试通过；这是 provider 隔离测试，不宣称发送了 500 条真实 Windows 通知。
- 现网只读诊断定位到旧暗部署的退出错误：把 `supabase.rpc` 脱离实例后调用，并误用 `.catch()`。已改为保留实例调用及 `try/await`，同步/异步失败合同和固定开发员工真实退出→受保护页重鉴权通过。
- 双语关闭态、管理员聚合页、无自动权限请求和无 SW 登记的定向 E2E 通过。Windows 横幅、全部窗口关闭及员工体验继续记录为待人工验收。

本段是发布前记录；生产迁移、开启、真实 provider 与告警结果以独立启用证据为准，不在这里预填通过。
