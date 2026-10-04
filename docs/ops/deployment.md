# 网站发布

仅在用户已授权本次生产发布时执行。生产为 `xiaomi`（`192.168.5.183`）、`mathin.club` 与 `supabase.mathin.club`。

入口为根目录 `发布到生产.cmd`，对应 `scripts/ops/publish-mathin-xiaomi.ps1`。`Status` 只读当前和 previous、发布元数据与服务状态；`Check` 查看待发布提交和生产状态；`Publish` 发送已提交源码，在 Linux 构建并切换服务。

## 普通增量

1. 确认本次授权范围、实际目标和待发布提交。相关业务迁移单独识别。
2. 从干净的已提交候选生成 Git archive，发送到该服务的独立 staging。
3. Linux 执行交付所需构建，生成独立 release；成功后原子切换 current，保留 previous。
4. 读取服务启动结果和必要健康状态，记录精确源码、版本与实际部署范围。

发布入口不自动执行本机全量 lint、类型检查、测试、数据库重建、备份或恢复演练。构建用于生成实际发布程序。必要定向验证由本次变更风险决定。

服务根当前为 `/home/swing/services/mathin`，网站监听 3131，Caddy 提供域名访问。凭据与环境文件在私有配置中。发布脚本使用 `scripts/ops/deploy-mathin-linux.sh`，保留构建失败不切换、切换失败恢复 previous 的技术能力。

## 数据与恢复

代码发布和数据库迁移分别核对。涉及删除、不可逆 schema 或破坏性重建时，按 [数据操作](data-operations.md) 和 [备份恢复](backup-recovery.md) 确定具体措施。普通增量无需重复一套恢复演练。

`Rollback` 用于确有需要且获准的服务回切；先确认 previous 及其数据库兼容范围。程序回切不等同于数据库恢复。脚本保留实际回切能力，日常部署不触发演练。

最近发布事实见 [当前状态](../current.md)。授权上线、部署成功和用户验收分别记录。
