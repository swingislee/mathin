# P4E（计划 13）逐项完成度审计（2026-07-13）

本表按 `docs/plan/13-foundations-and-hardening.md` §9 的任务逐项核验。“代码完成”不等同于“生产验收”；需要外部账号、凭据、接收端或行政办理的项目单独标记，禁止用占位配置冒充完成。

| 任务 | 状态 | 核验依据 |
| --- | --- | --- |
| P4E-S1 备份灾备/恢复/磁盘告警 | **当前范围完成；异机部分由用户暂缓** | 2026-07-13 隔离恢复成功并核对关键计数；数据库+Storage 原子备份、校验和、保留策略脚本已实跑通过；磁盘检查每 15 分钟运行，warning/critical 写入错误看板。用户明确暂不考虑异机备份，因此异机副本和备份 timer 不作为本轮阻断项。 |
| P4E-S2 绑码加固 | **完成** | migration 011：失败节流、一次性学生码、独立家长邀请、长随机码；P4E 静态审计覆盖。 |
| P4E-S3 双 topic + 白板快照 RPC | **完成** | migration 011 与课堂 transport：教师权威 topic、成员 client topic、快照校验/大小上限/乐观锁；真实 RLS 断言证明学生权威广播被拒。 |
| P4E-F1 领域事件/审计 | **完成** | migration 012：append-only `domain_events`、财务/评分/权限落桩、读取权限；真实数据库断言校验不可 update/delete。 |
| P4E-F2 学期轴 | **完成** | migrations 012/021：学期、年级历史、业务表 term_id、当前学期唯一激活与管理 UI。 |
| P4E-F3 内容稳定 UID | **完成** | 71 个概念 UID、slug alias 表/种子、`verify-content-uids.mjs`；双语与唯一性审计通过。 |
| P4E-F4 状态机/迁移账本 | **完成** | migrations 012、020、099：非法跃迁守卫、48 条远端迁移账本均有 checksum。 |
| P4E-V1 RLS 断言网 | **完成当前最低验收集** | `p4e_security_assertions.sql` 在真实开发库通过：跨学生范围、财务直读、权威广播、Storage 跨路径及结构权限。 |
| P4E-V2 数据库类型生成 | **完成** | 官方 pg-meta 生成 `database.types.ts`，server/browser client 均绑定 `Database`；类型新鲜度、tsc、构建通过。 |
| P4E-V3 可观测/课堂降级 | **部分完成，仅现场断网待验收** | 服务端错误会写入只读内建看板，也可选投递外部 HTTPS 接收端；受控 500 路由已端到端证明 `onRequestError` 入库。课堂已有 IndexedDB outbox、BroadcastChannel、WebRTC 和恢复回传，离线持久化/重启续号/双窗传输已纳入自动化。尚未完成 10 分钟整机断网现场演练。 |
| P4E-W1 课消/请假补课/查重合并 | **完成** | migrations 013/017/018 与后台 UI：规则化课消、冲正、病假到补课闭环、软查重和合并留痕。 |
| P4E-W2 权威状态对账 | **完成** | 教师事件经 RPC/持久事件落库，断线重连从库/事件流重建；权威广播仅作实时提速。 |
| P4E-C1 私有视频与 signed URL | **完成** | 私有 `session-videos` 桶、服务端归属校验签发、1 小时有效期和签发审计；跨路径 RLS 断言通过。 |
| P4E-C2 未成年人合规 | **部分完成，生产阻断** | 同意记录、视频/数据 scope、注销/导出申请、隐私与儿童规则页、平台 UGC 审核均已实现；ICP/公安备案须由运营主体办理。 |
| P4E-C3 手机验证码登录 | **部分完成，生产阻断** | 手机 OTP 双轨界面、教师代建手机号账号已实现；GoTrue 未配置国内 SMS provider/hook，尚不能完成“真实手机收到验证码”验收。 |
| P4E-O1 员工/代课/监护人 | **完成** | migrations 015/016/022 与 UI：员工停用交接、未来课次改派、按次代课、主监护人调整费用/视频/成绩 scope。 |

## 2026-07-13 发布门禁结果

- `pnpm lint`：通过
- `pnpm typecheck`：通过
- `pnpm p4d:audit`：14 组通过
- `pnpm p4e:audit`：24 项控制及 71 个内容 UID 通过
- `pnpm db:types:check`：通过
- 真实远端 `p4e_security_assertions.sql`：通过
- `pnpm build`：Next.js 16.2.10 生产构建通过，281 个页面完成生成；仅有既有 KaTeX 中文数学模式 warning

## 完成计划 13 仍需的外部输入

1. 国内短信供应商或 SMS hook 的选择、凭据、签名与模板（用户明确暂缓，只保留接口）。
2. 可登录的课堂演练账号/时段，用于 10 分钟真实断网现场演练。
3. 运营主体的 ICP/公安备案信息与实际办理结果（用户明确暂缓，只保留接口与页面）。
