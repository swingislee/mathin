# 0.1.2 生产发布 · 2026-09-09

状态：发布准备。产品负责人本次授权“推送生产并更新 0.1.2 版本文件”。发布范围为应用代码与版本说明。

## 发布范围

- 在生产 `c7009ec054d3397b235cb5acda96e82f6a9fbbcc` 上加入点名抽屉、教师今日课次统计和选用微课开课的三处 RPC 调用修复。退出登录修复在该生产基线中存在。
- `package.json` 版本从生产的 `0.1.0` 更新为 `0.1.2`。团队说明维护在 [CHANGELOG.md](../../../CHANGELOG.md)，列出功能、操作步骤和故障修复。
- 通知运行代码、依赖锁文件和数据库迁移与生产基线一致。本批不执行数据库迁移、业务写入或 Storage 操作。

## 发布前核对

- 本地：Windows `WHITEHOUSE`，Supabase origin 为回环 `http://127.0.0.1:35421`；网关与开发应用监听进程分别为 23312、42876。本批不写本地数据库。
- 生产：SSH `xiaomi`、用户 `swing`；站点 `https://mathin.club`，Supabase origin `https://supabase.mathin.club`。应用 PID 2147154 在 `127.0.0.1:3131` 监听，进程工作目录与 current release 一致。
- current：`20260909-074028 / c7009ec054d3397b235cb5acda96e82f6a9fbbcc`；previous：`20260909-042441 / c63a47b5b0d5031ea3c34cd934fbf6307abd37b0`。应用、推送 Worker 与监控定时器为 active。
- 数据库指纹：`10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`；只读事务核对 ledger 为 `366 / 20260909009000_employee_web_push_activation_safety`，点名与开课所需 RPC 存在。
- 现有备份：`/home/swing/services/mathin/backups/mathin-db-prechange-20260909T073507Z-web-push-c7009ec054d3`；`database.dump` 为 337,317,224 字节，`sha256sum -c SHA256SUMS` 通过。本批为应用发布，回退使用保留的旧 release。
- 2026-09-09 `12:08:23Z` 聚合基线：auth/users=41、profiles=41、students=1466、classrooms=34、class_sessions=429、session_attendance=1、有效冻结课次=8、cw_page_docs=77282、cw_page_revisions=121792、cw_lecture_releases=3774、storage.objects=126535。`operational_errors` 为 2017 条，最新时间 `2026-09-09T09:10:56.133Z`。

## 验证依据

- 本地版本对账的 8 个定向文件、97 项检查结果复用；业务代码与 [本地版本对账记录](local-version-update-20260909.md) 一致。
- 本轮全库核查覆盖 1821 个代码文件、业务代码及脚本的 469 处 RPC 引用。23 处绑定或方法提取均保留客户端上下文；未发现新增同类故障。修复前四处代码使用真实 Supabase SDK 复现原异常，网络请求数为 0。
- 发布检查与部署结果在完成后补记。业务操作待团队验收，R1-Live 阶段与 Gate 状态保持。
