# 画板版本列读取权限热修复 · 2026-09-27

状态：**开发与生产修复均已应用，机器检查通过，待用户实际新建和使用画板验收**。本记录不关闭 R1-Live 阶段或 Gate。

## 故障与修复

用户本次要求热修生产及开发端的 `permission denied for table whiteboards`。两端只读核对均确认：画板使用列级 SELECT 隐藏 `invite_code`，后续加入乐观锁 `version` 时遗漏对应读取授权。创建后的详情查询同时读取 `version`，在 `getWhiteboard` 抛错。

- 迁移：`20260927000100_whiteboard_version_select`，仅授予 `authenticated` 对 `public.whiteboards.version` 的 SELECT。
- 候选提交：`47af7594f57ea45946c39688478c504f3fc65298`，已推送 `codex/whiteboard-permission-hotfix`。
- 归一化 SHA-256：`e0f9d9fa6ae9adbbb81e8a22a953883eed1272f32493be517352ee7da113691f`；从 Git archive 上传的 LF 文件摘要一致。
- 保留邀请码专属 RPC、成员 RLS、快照写入 RPC、版本冲突检查和所有者权限。没有应用构建、发布切换或服务重启。

验收入口：[开发画板](http://192.168.5.213:3130/zh/whiteboard)、[生产画板](https://mathin.club/zh/whiteboard)。刷新后新建画板、绘制、返回列表再打开，检查画面保存。

## 开发验证

已核对 Windows 本机、实际 Supabase loopback origin、Docker 网关及 Next 监听进程、隔离网络和登记的数据库指纹。新增 SQL 回归接入 `p4e:db-audit`，本次仅执行画板定向断言。

1. 修复前同一断言以缺少 `version` SELECT 失败，复现遗漏。
2. 在事务中应用候选，使用既有固定教师、学生、管理员身份，以真实 `authenticated` / `anon` 数据库角色验证创建后返回、详情读取、重命名、保存后版本及内容再读、旧版本冲突、所有者删除与成员级联。
3. 验证只读成员可读不可写、编辑成员可保存不可删除、非成员不可读写、伪造所有者创建被拒、错误邀请码无效、成员不可读取或修改邀请码、匿名读写被拒。
4. 完整事务回滚后以独立连接核对列 ACL、迁移账本、画板及成员内容摘要均恢复。保存 schema 备份后应用迁移，原有画板及成员内容摘要保持不变。
5. 受影响脚本语法及 ESLint 检查通过；暂存内容与推送时的仓库／历史隐私扫描通过。

复现入口：`node scripts/whiteboard-permissions-local.mjs --preflight`；未应用迁移的隔离开发库依次使用 `--check` / `--apply`。SQL 回归位于 `supabase/tests/whiteboard_permissions_assertions.sql`，全部业务夹具均回滚。

## 生产执行与保护

- 本次用户的生产热修请求为授权来源。SSH 主机、运行进程实际 Supabase origin、进程工作目录、loopback 监听与登记的生产指纹均核对一致。
- 写前备份：`mathin-db-prechange-20260927T144508Z-whiteboard-permission`；PostgreSQL custom dump 为 357,874,242 字节，目录检查包含 Auth 用户和画板数据。
- dump SHA-256：`965ae364945ba8a0a7397e2fb9c9ad8e3239297ee23ce6a56c13fa7f2349eadb`。备份及候选 manifest、SQL、执行器、检查摘要保存在生产受控备份目录，保留至至少 2026-12-27，仅运维角色可访问；本次没有整库恢复演练。
- 同一候选先在 SERIALIZABLE 事务中执行授权、账本登记与权限／所有者查询检查后回滚。独立连接确认账本、列 ACL、其他表列权限、RLS 策略、相关函数和业务摘要零残留，再正式提交并通知 PostgREST 刷新 schema cache。
- 账本：445 → 446；head：`20260927000100_whiteboard_version_select`。独立连接复核迁移摘要、权限和原失败查询均通过。
- 现有画板 4、成员关系 4，内容摘要保持不变；41 个 Auth 用户、41 个档案、34 个班级、429 个课次、63 条考勤、3,774 个课件 release、126,542 个 Storage 对象数量保持不变。
- 应用继续运行 `aaed7e5400bea4bc76974b4bde8f8ebbf40b8373`，current / previous 为 `20260925-053117` / `20260925-020701`，进程保持原样。loopback 与公网 `/api/health` 均返回 200。

生产没有创建测试账号或写入画板业务数据。正负写入行为在开发隔离事务验证；生产检查仅读取既有画板并输出脱敏结论。若需要回退本授权，精确撤销新增的 `version` 列 SELECT 即可恢复原 ACL，但会重新触发本次故障；业务数据不需要恢复。后续回退仍核对目标并按当次授权执行。
