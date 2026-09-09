# 0.1.2 生产发布 · 2026-09-09

状态：**生产发布完成，机器检查通过，待团队使用确认**。产品负责人本次授权“推送生产并更新 0.1.2 版本文件”，并补充要求合并主分支、检查冲突和删除功能分支。发布范围为应用代码与版本说明。

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
- ESLint 按 Git 提交的 1823 个源码文件运行，0 错误、2 条原有未使用变量警告；全项目 TypeScript、Windows 生产构建和仓库密钥扫描通过，构建生成 373 个页面。
- 发布器首次运行的 `eslint .` 包含 `.worktrees`、`.rc-worktrees`、`.codex` 下的历史工作副本，导致扫描范围扩大。确认这些副本未被 ESLint 排除后，停止本任务的该进程，以 Git 提交文件列表运行同一套规则；未调整业务代码或检查规则。

## 合并、发布与回退

- 本地 `main` 原为 `12dd4cf0`，远端 `origin/main` 原为 `cddc7c7b`；两者都是候选 `5540c1cb` 的祖先。执行快进合并，没有文件冲突，合并后的源码与通过检查的候选一致。
- `main` 推送至 GitHub 仓库 `swingislee/mathin`。本地与远端 `codex/principal-dashboard-v1` 删除前核对其提交均包含于 `main`；远端删除使用提交租约检查并发变化，删除后查询只返回 `main`。
- 源码归档 SHA-256：`8b0aa9e5e0b744b85d0c19389b30c3d428ec13a2d62a792cd0a660497bbaf9c1`，上传后校验一致。
- Linux 发布使用仓库 `scripts/ops/deploy-mathin-linux.sh`。本次构建进程设置 `NODE_OPTIONS=--max-old-space-size=3072`，沿用同日通过的构建内存设置；应用服务内存配置保持。Linux 构建生成 373 个页面，Worker 的 26 个依赖包打包检查通过。
- current：`20260909-122848 / 5540c1cb609678acaad54fc25c9acd8c8bcdb64f`，`package.json` 版本为 `0.1.2`；构建时间 `2026-09-09T12:30:58Z`，应用切换时间 `2026-09-09T12:30:59Z`，即北京时间 20:30:59。
- previous：`20260909-074028 / c7009ec054d3397b235cb5acda96e82f6a9fbbcc`。回退使用 `scripts/ops/publish-mathin-xiaomi.ps1 -Action Rollback`，本批未执行回退演练。发布 staging 清理完成。

## 发布后核对

- 应用 PID 3031522、推送 Worker PID 3031524 的工作目录均指向新 release；两项服务为 `active/running`、`NRestarts=0`、`ExecMainStatus=0`。监控定时器为 active，告警状态为空。
- loopback、Caddy 和公网 health 返回 `ok / production`；zh/en 首页、登录页和 `/notification-sw.js` 返回 200；匿名访问 zh/en 班级页及账号安全页返回 307，并转到带来源路径的登录页。
- `12:32:52Z` 只读事务核对数据库指纹、366 条迁移账本与发布前一致；上列 11 项业务与资源计数一致。`operational_errors` 保持 2017 条，最新时间保持 `2026-09-09T09:10:56.133Z`；应用和 Worker 切换后的错误日志匹配数为 0。
- 桌面提醒开关为 true，integration 为 enabled，Worker 心跳年龄为 0.18 秒，dead/failed24h/queued 为 0。本轮没有发送通知测试或操作生产业务数据。
- 文档收尾更新发布状态和团队写法要求；应用源码保持本次发布候选内容。点名、开课和设备提醒待团队操作确认，R1-Live 阶段及 Gate 状态保持。
