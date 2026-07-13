# P4E 数据库恢复演练记录（2026-07-13）

## 结论

在 `xiaomi` 的 Supabase PostgreSQL 容器中，将当前 `postgres` 业务库的 custom-format dump 恢复到隔离库 `mathin_p4e_restore_drill`，关键表计数与源库一致，迁移账本完整。核验后已删除隔离库和临时 dump，未修改业务库。

- 结果：通过
- 恢复与核验耗时：4 秒
- dump SHA-256：`029c5354dd311dc140ec87d5ffc3de7c15c7a29c4480eb21dae9f296d6d94d6b`
- RPO：本次即时快照为 0；生产 RPO 仍取决于尚未配置的异机定时备份频率
- RTO：本次小数据量隔离恢复为 4 秒；不代表包含大体积 Storage 文件复制的生产 RTO
- 执行人：Codex（用户授权的计划 13 施工）

## 一致性核对

| 数据集 | 源库 | 恢复库 |
| --- | ---: | ---: |
| students | 1 | 1 |
| orders | 1 | 1 |
| payments | 1 | 1 |
| domain_events | 1 | 1 |
| schema_migrations | 48 | 48 |
| storage.objects | 42 | 42 |

`schema_migrations` 中空 checksum 数量为 0。Storage 实体卷另行盘点为 42 个文件、35,820,482 字节，与元数据对象数一致；本次演练没有把实体文件复制到异机，因此 Storage 异机备份仍未验收。

## 演练发现

首次以普通 `postgres` 角色执行 `pg_restore --exit-on-error` 时失败：该角色不是 superuser，无法恢复 `realtime.list_changes` 函数上的 `SET log_min_messages`。改用部署内的集群恢复管理员 `supabase_admin` 后完整恢复成功。

这意味着恢复手册不能假设名为 `postgres` 的角色天然拥有完整恢复权限；自动化必须显式使用受控的恢复管理员，并保持 `--exit-on-error`，不能忽略部分 schema 恢复失败。

## 尚未通过的生产项

- `xiaomi` 未发现数据库/Storage 异机定时备份任务。
- 未发现磁盘 75%/85% 阈值告警服务；演练时根分区使用率为 11%。
- 未配置短信 provider/hook。
- 未接入可验证的错误看板。

这些项目需要备份目标、告警接收端、短信供应商凭据和错误看板 DSN，不能由仓库代码替代。

## 自动化脚本复验

同日新增的 `p4e-backup.sh` 已在 `xiaomi` 以明确允许的 `/tmp` 演练目录实际执行。2 秒内生成 database dump、Storage archive、数据库计数和 Storage 文件清单；四个文件的 `SHA256SUMS` 校验全部通过，Storage 仍为 42 个文件、35,820,482 字节。临时产物随后删除。`p4e-disk-check.sh` 的磁盘去重与备份新鲜度正常路径也已在主机执行通过。

该复验只证明自动化可执行；systemd timer 必须等真实异机挂载点和告警 webhook 确定后才能安装启用。
