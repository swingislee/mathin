# 活动页超长查询热修复 · 2026-09-08

状态：**已部署 / 定向机器检查通过 / 待用户实际验收**。用户本轮明确要求生产活动页热修复；本批不关闭阶段或 Gate。

- 故障：生产 `/zh/dashboard/activities` 日志记录 `URI too long`。全部报名 UUID 一次进入两个 PostgREST `in` 查询，超过网关 URI 上限。
- 修复提交：`6b3943df5f98e0ee62bc2211b594b73ee0c28870`。两个关联查询按每批 100 个报名 ID 读取并合并，保留错误传播、原字段和权限客户端。相对生产基线，应用源码仅修改 `src/features/school/activities.ts`。
- 发布时间：2026-09-08 15:58（Asia/Shanghai）。current=`20260908-075611`；previous=`20260908-053849` / `3dca80786ed25956d0750181ca957b81867d07ce`。使用现有 Linux 原子发布脚本，保留健康失败自动回退。
- 目标 preflight：`xiaomi`；应用 Supabase origin=`https://supabase.mathin.club`；监听 `127.0.0.1:3131`；数据库指纹=`10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`；磁盘使用 48%，部署锁可获取。核对既有 20260904 PostgreSQL 备份及摘要文件；本批没有数据库、Storage 写入或新备份。未来两小时有 1 个课次，发布前十分钟课堂事件为 0。
- 定向验证：3 项测试通过，覆盖 1,205 条报名跨批次关联完整性、空列表、后续批次错误；受影响文件 ESLint、本机 typecheck、生产 Next.js build 和仓库密钥扫描通过。全库 lint 运行数分钟后主动停止，未记录为通过；采用定向 lint 和一次生产构建完成热修复。
- 生产聚合只读 REST 探针：929 条报名的原单次 HEAD 查询均返回 HTTP 414；每批 100 个 ID 后，两个表各 10 批全部成功，测评结果共 653 条、去向 0 条。探针只输出状态码及数量，未返回个人字段。该检查使用服务上下文，不能替代真实用户页面与 RLS 验收。
- 自动审批拒绝过读取完整关联字段的探针；该探针未执行，后改为获准的仅 ID 与 HEAD 计数探针。
- Postflight：loopback 与 Caddy health 均为 ok；服务 active/running，NRestarts=0；活动页匿名请求 HTTP 307；新进程日志无应用错误。发布前后 ledger=356、活动=932、报名=929、学生=1464、课次=64、Storage=126534，均相同。旧进程退出 143 属本次服务切换。
- 受控构建源包保留于生产 `staging/activities-hotfix-6b3943df`，供运维角色复核；未执行清理。实际登录页面仍待用户验收。
