# DEV-WEB-PUSH-1 · PUSH-P5 生产暗部署写前证据

> **结论**：`READY FOR EXPLICITLY AUTHORIZED EXECUTION / PRODUCTION UNCHANGED / EMPLOYEE TEST NOT AUTHORIZED`。2026-09-03～2026-09-04 已完成最终候选冻结、Xiaomi 生产只读 preflight、新鲜 PostgreSQL 写前备份、两条 additive migration 的完整回滚与独立零残留检查。实际 app 原子发布、schema formal 和联合 postflight 尚未执行；当前生产仍运行原 release，Web Push feature/integration/cohort/subscription/delivery/job 均未建立或启用。

| 字段 | 值 |
| --- | --- |
| `gate_id`, `domain`, `result` | `DEV-WEB-PUSH-1 / PUSH-P5`；员工桌面 Web Push 关闭态生产底座；`READY FOR EXPLICITLY AUTHORIZED EXECUTION / PRODUCTION UNCHANGED` |
| `candidate_commit`, `production_current`, `production_previous` | candidate=`f5cd95e08a68b35e36d4dfedc67ba54ac2e4430b`；current=`8c50b48a8c4d69c6bad3fb3858bfd008dfa5b800` / release `20260903-115645`；previous=`750bd607918cefbb744e92a94a0485a39facc628` / release `20260903-100016` |
| `migration_hashes` | `20260903000750_employee_web_push_dark_runtime`=`c2154485d4af9621bd2cbb70a600b0a8ad415a69dc6763287b3cd1fd7be521ab`；`20260903000760_employee_web_push_dark_monitoring`=`eb4a0e6e6863efaf23db38604d1ea92a01cbd2f49b761caa69cddc59550ce29c` |
| `production_target` | Xiaomi / `mathin.club` / `supabase.mathin.club`；database fingerprint=`10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c`；受影响对象 owner=`supabase_admin` |
| `preflight` | deploy/backup lock=`free/free`；service/backup disk=`47%/27%`；`mathin.service=active`，loopback/Caddy health=`ok`；`mathin-jobs.service=not-found/inactive`；未来两小时课次=`0`；active other DB connections=`0` |
| `database_baseline` | ledger=`242`，head=`20260903000700_courseware_page_insertions`，candidate rows=`0`；profiles/students/classrooms/sessions=`14/10/5/38`；notifications/deliveries/jobs=`193/193/3`；3 个 pending job 均为 `file.verify`，running/dead=`0/0`；Storage objects/bytes=`126428/51632996423`；operational errors=`1959`，latest=`2026-09-02T08:25:03.669Z` |
| `dark_invariants` | `notifications.web_push=false`；integration row=`0`；候选 subscription/rollout 表与注册 RPC 均不存在；web_push delivery=`0`。P5 不启动 Worker，避免领取已有 `file.verify` job |
| `backup` | `/mnt/openlist-disk/Backups/Mathin/mathin-db-prechange-20260903T155605Z-employee-web-push-f5cd95e08a68/`；dump bytes=`313074987`；TOC lines=`4571`；dump SHA-256=`770374abea0256b8305d134ccaf48c3d541dd007904517c41f4295847ec729e5`；`SHA256SUMS` SHA-256=`d87214f681f7513a55824b7620c96271c712329df75d4264d394419141601600`；2026-09-04 复核 `sha256sum -c` 通过 |
| `rollback_rehearsal` | 以 Git archive LF 原文和 `supabase_admin` 在 `SERIALIZABLE` 事务执行两条 migration、ledger insert、`web_push_assertions.sql` 与业务/Storage 不变量后 rollback；新连接确认 ledger/head=`242/00700`、candidate row=`0`、候选对象/集成=`0`、所有冻结计数及错误基线不变 |
| `candidate_validation` | 冻结 lockfile 安装通过；Bash syntax、受影响 ESLint、TypeScript、双语键、定向 Vitest 9/9、固定员工/管理员暗态 Playwright 2/2、两次 production build 通过。Playwright 证明 permission request=`0`、Service Worker registration=`0`、开启按钮禁用、8 项 Web Push 指标=`0`、integration disabled |
| `failure_ticket` | 首次 migration archive staging 因 PowerShell 对远端变量转义错误，在远端目录/上传前失败；只读检查确认零残留，随后改用 UTF-8 base64 远端脚本并成功上传。首次生产 app publish 调用被执行安全门拒绝，理由是需要用户再次明确批准真实生产重启与切换；未绕过、未执行 app/schema 写入 |

## 已登记但不阻断关闭态 P5 的问题

- `PUSH-ISSUE-01～05/08`：员工测试窗口、外部告警出口、最终保留期、Push 企业网络、文案人工签收与生成数据库类型仍属 `G5-BLOCK / DEV-CONTINUE` 或 follow-up；它们阻断员工测试，不阻断三层关闭的生产暗部署。
- `PUSH-ISSUE-09`：production current 自身缺少 `school.nav.adaptReview`、`school.nav.preparationReview` 的 zh/en 消息键。候选页面与暗态 E2E 可用，但开发日志会记录既有 `MISSING_MESSAGE`；本批不夹带无关导航修复。
- `web-push@3.6.7` 已冻结并随 Worker runtime 打包；P5 只交付运行文件，`mathin-jobs.service` 保持未安装/未启动。

## 获得明确授权后的固定顺序

1. 再次核对 candidate/current/backup/checksum/锁无漂移。
2. 用 schema 向后兼容候选原子发布 app；验证 current/previous、服务、HTTP、release 内 Worker runtime 和 Worker inactive。
3. 以 rehearsal 同一 Git archive、checksum、owner 和 assertions 正式提交两条 migration，刷新 PostgREST schema cache。
4. 联合 postflight 必须得到 feature=false、integration disabled/secret null、cohort/subscription/web_push delivery/job=`0`、workerStale=false，业务/Storage/错误不变量无本批新增。
5. 清理唯一 migration staging；保留本轮备份。状态只更新为 `PUSH-P5 COMPLETE / EMPLOYEE TEST NOT AUTHORIZED`，不进入员工测试。
