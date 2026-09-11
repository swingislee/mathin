# 课堂学情登记提醒 · 2026-09-11 发布记录

状态：**已部署，机器上线后检查通过，待任课教师人工课堂验收**。本次用户指令“将本次课程升级推送至生产”授权了生产切换与应用服务重启；没有执行数据库迁移、业务写入或 Storage 写入。R1-Live-2 与现有 Gate 状态沿用。

## 功能范围

本次生产版本包含方案 C 的玫瑰红课件外缘细框、同色页边书签，以及试讲空配置误提醒修复，见[开发交付记录](classroom-learning-reminder-edge-development-20260911.md)。

- 采用方案 C：翻到本节课已保存的学情检查页时，课件外缘显示站点玫瑰红细框和同色页边书签，现有登记入口显示月亮黄胶囊与已保存人数。
- 部分登记继续提醒；保存期间显示保存状态，成功保存后才计入完成进度；失败保持原有已保存计数，全部登记后显示安静的“本页已记录”。完成表示登记完成。
- 点击书签或登记入口打开本页逐题学情；普通页保持原入口。缺席、请假学生沿用补登记排除口径；试讲未设置或取消全部检查页时保留不绑定页面的“课堂观察”和点名入口，页边提醒只匹配已保存检查页。常规课堂、专注模式共用提醒，独立学生展示端沿用控制端隔离。

复用现有学情和考勤接口，本次没有修改数据库、Server Action、鉴权、RLS、依赖或生成类型。生产过程没有执行迁移、业务写入或 Storage 写入。

## 固定候选与检查

生产候选为 `aed8fec48ddb15e24049e6afa01b197d432674ba`，基于实际原生产 `7855bab6551dfb3ce9ab70856ccaf4ec36a9fca3`，仅增加本任务 13 个课堂提醒运行时、双语文案与回归文件；未带入主分支其他开发功能。

- 5 个定向测试文件、44 项测试通过：页级提醒、空配置试讲、窄屏课堂、课堂连续性、交互同步和缺失原生 UUID 的合同。
- 完整 lint 通过，0 错误，保留原有构建脚本的 2 项未使用变量警告；生产候选双语文案检查通过，每种语言 9,249 个键。本地 main 合并后额外完成提醒双语检查。
- Linux 构建及 Worker 依赖打包通过。发布包为 `/home/swing/services/mathin/releases/20260911-153257`，commit 与候选一致；构建后检查 2,885 个源码文件及 4,822 个运行时文件，secret 扫描及环境文件隔离通过。

## 生产目标与回退准备

2026-09-11T15:32:38Z 只读 preflight 核对 SSH 主机 xiaomi、配置与运行时 Supabase origin `https://supabase.mathin.club`、站点 `https://mathin.club`、loopback 3131 监听进程及 current 工作目录，配置权限为 0600。

原 current 为 `20260911-031503 / 7855bab6551dfb3ce9ab70856ccaf4ec36a9fca3`，previous 为 `20260911-015309 / 046ba7f1c7039e37ccd968d5ffbdcf7d0bab4c59`。数据库指纹为 `10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`，账本 376 条，head `20260911002000_base_activity_source_links`，摘要 `67d3d562f32e639cd2416e2455e727b1`。

本轮基线计数为：身份 41、班级 34、课次 429、冻结课件 release 3,774、页面文档 77,282、Storage 对象 126,535，operational_errors 2,017。已登记恢复点 `/home/swing/services/mathin/backups/mathin-db-prechange-20260911T032929Z-base-review-7855bab6551d` 的 dump、TOC、manifest 与摘要文件存在；应用改动沿用现有恢复点与原 release。

原子切换于 `2026-09-11T15:35:52Z` 开始，`2026-09-11T15:35:54Z` 完成。current → `/home/swing/services/mathin/releases/20260911-153257`（`aed8fec48ddb15e24049e6afa01b197d432674ba`）；previous → `/home/swing/services/mathin/releases/20260911-031503`（`7855bab6551dfb3ce9ab70856ccaf4ec36a9fca3`）。健康失败自动恢复原 current/previous；应用与 Jobs 均 active/running，重启次数为 0，工作目录与 current 一致。

## 证据与验收

上线后检查于 `2026-09-11T15:36:10Z` 全部通过：loopback 与公网 health 200；zh/en 登录页 200；受保护 dashboard、班级与课堂路由按预期 307 到登录；Supabase 未认证接口 401；通知 Service Worker 200；包含 `data-classroom-learning-reminder` 的客户端资源已从公网返回并与 release 摘要一致；push monitor active；服务 journal 错误数为 0。

数据库业务计数与 preflight 一致：users 41、classrooms 34、sessions 429、courseware releases 3,774、page docs 77,282、Storage objects 126,535；operational_errors 2,017 且无增量，migration ledger 未变化。

冻结源码与 Git bundle 已在受控目录 `/home/swing/services/mathin/staging/classroom-learning-reminder-aed8fec48ddb-20260911` 完成上传与摘要核对：

- source.tar SHA-256：`f726319034d796376711f154e618733ed604dd6617f12277771adbbecefc3f83`，50,432,000 bytes。
- candidate.bundle SHA-256：`1bff2c5273bcfba8ee728274f703c6c5d9f3b8f2ded046a2348d3c6acab49620`，11,327 bytes。
- 完整 preflight、构建、切换、postflight 和摘要已归档至 `/home/swing/services/mathin/staging/classroom-learning-reminder-aed8fec48ddb-20260911/evidence.tar`，归档 SHA-256 `8e6a6b958250205bc38b48908c8c18aed903a02f6fc4dee93ba72963bde5112b`，结果 `EVIDENCE_VERIFIED`；访问角色为生产运维维护者，至少保留至 v1.0.0 后 365 天。

生产入口：[mathin.club](https://mathin.club)。老师在课前标记页面后进入正式课堂，翻到标记页、部分登记、保存完成、返回普通页，并在常规与专注模式观察提醒。实际课堂视觉与交互待人工验收；自动化结果只覆盖列出的合同。
