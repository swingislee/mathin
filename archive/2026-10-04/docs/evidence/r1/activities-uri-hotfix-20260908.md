# 活动页超长查询热修复 · 2026-09-08

状态：**已部署 / 定向机器检查通过 / 待用户实际验收**。用户本轮明确要求生产活动页热修复；本批不关闭阶段或 Gate。

## 16:16 活动目录范围修正

用户明确要求 1 对 1 测评不进入活动目录。提交 `0f5fbd942ed66f7c7678d05e0d9d4d3b9a60bbbd` 在目录查询排除 `assessment_1v1`，覆盖当前、历史与全部列表；新建／编辑类型选项同步移除该类型。单独测评读取与原记录保留。

- 定向读取和中英文完整组件渲染共 6 项测试通过；受影响文件 ESLint、typecheck、密钥扫描和生产构建通过。
- 写前复核生产主机、origin、监听、数据库指纹、current/previous、容量与部署锁；近期课堂事件为 0。沿用本轮应用热修边界，无数据库或 Storage 写入。
- current=`20260908-081359`，previous=`20260908-080410`。Caddy health=ok，服务 active、NRestarts=0，新进程日志无应用错误。聚合目录从 929 条收窄至 221 条，报名总数仍为 929、ledger 仍为 356。
- 受控 staging=`activities-directory-0f5fbd94`。状态：已部署，待用户页面验收。

## 16:06 后续日期渲染热修复

用户反馈第一版仍无法打开。08:00 UTC 生产日志确认查询之后的 `ActivitiesManager.filterValues` 抛出 `Invalid time value`，第一版聚合查询验证没有覆盖此渲染错误，不能作为页面恢复结论。

- 只读聚合确认：当前列表 57 条活动均无 `scheduled_at`，47 条有 `occurred_on`；历史 872 条均无排课时间，740 条有发生日期。
- 第二版提交 `df8bc6431bd33ccc8db8e412787da66f3e8d71b6`：日期筛选先验证时间，缺失或无效时使用发生日期，完全缺失归入未知；日期排序使用发生日期回退。保留前一版分批读取。
- 中文、英文完整 ActivitiesManager 服务端渲染覆盖当前／历史／全部列表、仅日期、缺失日期、无效日期及正常排课；与分批读取测试共 5 项通过。受影响文件 ESLint、本机 typecheck、密钥扫描与生产构建通过。没有浏览器登录验收。
- 2026-09-08 16:06（Asia/Shanghai）原子切换成功：current=`20260908-080410`，previous=`20260908-075611`。服务 active/running、NRestarts=0，Caddy health=ok，新进程日志没有应用错误。
- 第二次写前复核主机、origin、监听、数据库指纹、锁和容量；近期课堂事件=0。第二次发布前后业务计数与下文基线一致。本次没有数据库或 Storage 写入。
- 受控 staging=`activities-date-hotfix-df8bc643`。状态仍为已部署、待真实登录页面验收。

## 15:58 首次查询热修复记录

- 故障：生产 `/zh/dashboard/activities` 日志记录 `URI too long`。全部报名 UUID 一次进入两个 PostgREST `in` 查询，超过网关 URI 上限。
- 修复提交：`6b3943df5f98e0ee62bc2211b594b73ee0c28870`。两个关联查询按每批 100 个报名 ID 读取并合并，保留错误传播、原字段和权限客户端。相对生产基线，应用源码仅修改 `src/features/school/activities.ts`。
- 发布时间：2026-09-08 15:58（Asia/Shanghai）。current=`20260908-075611`；previous=`20260908-053849` / `3dca80786ed25956d0750181ca957b81867d07ce`。使用现有 Linux 原子发布脚本，保留健康失败自动回退。
- 目标 preflight：`xiaomi`；应用 Supabase origin=`https://supabase.mathin.club`；监听 `127.0.0.1:3131`；数据库指纹=`10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`；磁盘使用 48%，部署锁可获取。核对既有 20260904 PostgreSQL 备份及摘要文件；本批没有数据库、Storage 写入或新备份。未来两小时有 1 个课次，发布前十分钟课堂事件为 0。
- 定向验证：3 项测试通过，覆盖 1,205 条报名跨批次关联完整性、空列表、后续批次错误；受影响文件 ESLint、本机 typecheck、生产 Next.js build 和仓库密钥扫描通过。全库 lint 运行数分钟后主动停止，未记录为通过；采用定向 lint 和一次生产构建完成热修复。
- 生产聚合只读 REST 探针：929 条报名的原单次 HEAD 查询均返回 HTTP 414；每批 100 个 ID 后，两个表各 10 批全部成功，测评结果共 653 条、去向 0 条。探针只输出状态码及数量，未返回个人字段。该检查使用服务上下文，不能替代真实用户页面与 RLS 验收。
- 自动审批拒绝过读取完整关联字段的探针；该探针未执行，后改为获准的仅 ID 与 HEAD 计数探针。
- Postflight：loopback 与 Caddy health 均为 ok；服务 active/running，NRestarts=0；活动页匿名请求 HTTP 307；新进程日志无应用错误。发布前后 ledger=356、活动=932、报名=929、学生=1464、课次=64、Storage=126534，均相同。旧进程退出 143 属本次服务切换。
- 受控构建源包保留于生产 `staging/activities-hotfix-6b3943df`，供运维角色复核；未执行清理。实际登录页面仍待用户验收。
