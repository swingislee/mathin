# P4E 生产存续运行手册

本文件记录必须在真实基础设施上执行、不能靠仓库代码伪造完成的步骤。所有文本按 UTF-8 处理。

## 每日备份

1. 使用只读备份账号执行 `pg_dump --format=custom --no-owner --file <异机目录>/mathin-YYYYMMDD.dump "$DATABASE_URL"`。
2. 将 `session-videos`、`courseware`、`note-assets` 对象同步到不同物理设备或对象存储；备份端启用版本保留和静态加密。
3. 备份完成后计算 SHA-256，记录数据库行数摘要与 Storage 对象数/总字节数。
4. 监控数据库卷、Storage 卷和备份目标；任一磁盘使用率达到 75% 告警、85% 升级。

## 每月恢复演练

在隔离实例创建空库，用 `pg_restore --clean --if-exists --no-owner` 恢复最近备份；随后应用 `pnpm migrations:ledger` 生成的账本断言和 `supabase/tests/p4e_security_assertions.sql`。核对学生、订单、支付、事件、视频对象数及抽样哈希。演练记录必须包含耗时、RPO、RTO、失败点和负责人。

## 短信登录

手机号界面已接入 Supabase Phone OTP；上线前必须在自托管 GoTrue 配置国内短信 provider/hook、签名模板、发送频控和失败告警。未完成 provider 配置时保留邮箱登录，不把手机号入口宣传为可用能力。

## 错误与课堂降级

`src/instrumentation.ts` 将服务端请求错误输出为结构化 JSON。生产日志采集器应把 `event=request.error` 推送到错误看板并按 route/digest 聚合。课堂仍以本地事件日志和 P2P 为可靠路径，Realtime 只提速；每季度执行一次断网 10 分钟、恢复后补同步演练。

## 发布门禁

依次运行 `pnpm lint`、`pnpm typecheck`、`pnpm p4d:audit`、`pnpm p4e:audit`、`pnpm build`，再在测试库执行 RLS SQL。任何 migration 应用后都重新生成数据库类型和 migration 账本。
