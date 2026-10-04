# 0.1.4 生产发布 · 2026-09-14

状态：**已部署生产，机器 postflight 通过，待实际设备与业务人工验收**。用户本次授权“将最近的修改同步到生产端，进行生产端修复，并生成新的小版本更新”。北京时间 2026-09-14 00:06 完成切换；R1-Live-2 与 Gate 2 状态保持。

## 范围与候选

- 应用候选：`3d9892bb87c2361e6662e685b606ac77a3e82e29`，版本 `0.1.4`。包含截至 `b3ed47b8` 的课堂自然笔迹、时间压力、局部重绘、掌擦与触摸拖动，教学工作台、教师入口记忆、名单跟进、学生协作和历史线索接续。团队操作见 [CHANGELOG.md](../../../CHANGELOG.md)。
- 修复发布检查发现的测试空值类型错误、研究脚本保留变量命名问题，并从已核对的本机数据库重新生成类型，补齐此前未同步的协作、来源资料和读取函数合同。
- 生产原版本为 `20260911-153257 / aed8fec48ddb15e24049e6afa01b197d432674ba`。本次同步主分支完整候选，未重导 Base 资料或课程资源。
- `20260910002000_school_source_record_review` 曾有独立生产适配版，其生产 checksum=`300b97c422ac2820c73ec788b0a36e8d7ee4e1425cad538cecf5513b44bd1af9`。保留该账本，使用新增 alignment 迁移接入协作查看函数，并保留已上线的 API 权限边界；未把开发版旧迁移重新执行。

六条正式迁移及归一化 SHA-256：

| 版本 | SHA-256 |
| --- | --- |
| `20260910001000_school_subject_collaboration` | `93b1f26f5af77f13cb55e9d0b91fb05e4dc67e86b0aa2ea84de1dd951aff1c3d` |
| `20260910001100_school_collaboration_workspaces` | `ac53595e5033f3c5b539ccc7b098294aeca2b2f690cdde1808d3f624fea99559` |
| `20260910001200_school_collaboration_projection` | `2ce72e6c4346690b7fc0a9ddea35a081bc0b85cd783593e6e440cba5e831513b` |
| `20260911003000_teaching_workbench` | `7a64e3332bdb71d96592ba92edec94c7cdc2a2657b55046977f7ef7d0bd7790c` |
| `20260913000100_lead_profile_continuation` | `62d6bffe7154afd52975ec9f16be5d7036d8caf07f327ac83c16b4a72d64178d` |
| `20260913000200_school_source_collaboration_alignment` | `7344ee429b798f4b8283ae28a1c90dbfe5c55e3c90830ad70fbd590e540c4bc6` |

## 目标、备份与迁移

只读 preflight 核对 SSH 主机 `xiaomi`、配置与进程 Supabase origin `https://supabase.mathin.club`、站点 `https://mathin.club`、`127.0.0.1:3131` 监听 PID 和 current 工作目录。配置权限为 0600；数据库指纹=`10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`。

写前账本为 `376 / 20260911002000_base_activity_source_links`。候选构建及密钥检查完成后创建备份：

- `/home/swing/services/mathin/backups/mathin-db-prechange-20260913T160244Z-version-0.1.4-3d9892bb87c2`
- PostgreSQL custom dump：345,748,088 bytes；TOC 6,383 行；dump、TOC、候选绑定 manifest 和 SHA256SUMS 校验通过。
- dump SHA-256：`e495f41516b07619f7d495ecaf9184b4bc86f532cbd58c0898027b4f6736b293`。

完整候选在 `SERIALIZABLE` 事务中执行，检查新表 RLS、API 权限、视图调用者权限和既有角色读取后回滚。首轮读取误选尚待首次改密的员工，数据库按预期拒绝；独立连接确认函数／ACL、表／策略／索引／触发器、账本和业务摘要恢复。改用已完成改密的既有管理员与教师后，教学工作台、本人／团队范围、学生列表、来源资料、线索档案和匿名拒绝检查通过。57 个变更函数的最终定义与开发数据库一致。

正式事务执行同一候选和合同，账本变为 `382 / 20260913000200_school_source_collaboration_alignment`。新增三个业务组、9,677 条参与经历投影和 7,498 条来源分组关联，均由既有业务和来源关系归集。员工业务角色与组员配置保持为空；未按此前私有名单调整真实岗位，未批量补建历史学生身份。23 张原有业务表逐行摘要与四项课程／Storage 计数在迁移前后及发布后保持一致。

## 构建、切换与 postflight

- 定向回归 31 文件／240 项通过；全库类型检查、生成类型摘要、中英文键检查通过。Git 跟踪文件 lint 的一处错误修复后定向复查通过，保留原有构建脚本两条未使用变量警告。
- 本机隔离目标完成协作权限、历史线索接续、alignment 与回滚合同；沿用固定开发身份，夹具均回滚。未使用生产测试账号或测试业务对象。
- Linux 生产构建和 Worker 26 个依赖包打包通过。构建后的 4,868 个运行时文件和 2,961 个仓库文件完成密钥扫描；release 与 source 均没有生产环境文件残留。
- 2026-09-13T16:05:58Z 开始原子切换，16:06:00Z 完成。current=`20260913-155934 / 3d9892bb87c2361e6662e685b606ac77a3e82e29`；previous=`20260911-153257 / aed8fec48ddb15e24049e6afa01b197d432674ba`。应用与 Jobs 工作目录均指向 current，状态 active/running，NRestarts=0，ExecMainStatus=0。
- loopback、Caddy 与公网 health 为 200；zh/en 登录为 200；教学工作台、学生、分组、分班、班级和课堂等受保护入口匿名访问按预期 307 到登录；Supabase 未认证接口 401，通知 Service Worker 200。
- 公网返回的八个 `freehand-v3` 客户端资源与 immutable release 的 SHA-256 一致。推送监控定时器 active；应用／Jobs 的切换后 error journal 为 0；operational_errors 仍为 2,017，无增量。
- 身份 41、班级 34、课次 429、课件 release 3,774、页面文档 77,282、Storage 对象 126,535，与发布前一致。

## 回退与证据

激活脚本在健康失败时恢复原 current/previous 并复核健康。本次成功上线，未实际切回旧应用；事务回滚核查只证明迁移演练零残留，不代表执行过全库恢复。六条迁移可随旧应用保留。新笔迹包含笔刷和压力字段，旧应用读取可沿用坐标，但旧保存逻辑可能丢弃新增字段；发生新笔迹业务写入后，应优先前向修复，必要回退须保留新笔迹读取／保存合同。稳定学生身份及正式业务记录继续保留。

受控证据目录：`/home/swing/services/mathin/staging/version-0.1.4-3d9892bb87c2-20260913`。源码、Git bundle 与上传摘要已核对；`evidence.tar` 包含 35 个构建、备份、迁移、回滚、切换和 postflight 文件，共 7,975,936 bytes，SHA-256=`8fa10a19c238523d22eca3deb0bda8205f27596041ba07431032ff590dccbb9e`。文本文件另有归一化 SHA-256 manifest。访问角色为生产运维维护者和获准复核人，至少保留至 v1.0.0 后 365 天。

当前为已部署、待使用者验收。请在 [生产入口](https://mathin.club/zh/dashboard) 刷新页面；大屏在课前重新打开课堂，核对中文书写、掌擦、尺规拖动、翻页和重放。教学工作台、班级跟进、协作与历史线索补入按真实业务操作验收。机器检查不替代设备手感或产品验收，也不关闭 Gate 2。
