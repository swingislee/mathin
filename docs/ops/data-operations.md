# 数据操作与目标识别

此入口适用于本地或生产数据库写入、迁移、导入、删除与清理。先识别真正连接的环境，再执行已授权的对象范围。

## 只读识别

核对执行主机、实际 Supabase origin、数据库连接目标、监听端口与进程、数据环境标识。`xiaomi`、`192.168.5.183`、`mathin.club` 和 `supabase.mathin.club` 均为生产；容器名称或“开发机”称呼不能证明隔离。

读取计划影响对象的 ID、数量、现有引用与版本，输出脱敏摘要。连接信息只从环境变量或私有配置读取。任一关键目标不明确时先解决识别问题。

写入脚本复用 `scripts/lib/r1-write-target-policy.mjs` 的实际目标校验。其环境声明与允许目标值必须对应真实连接；为通过检查伪装目标会破坏保护边界。

## 按动作确定措施

- **普通可修订写入：** 在授权范围内保存，检查实际结果和关联事实。
- **迁移：** 新增 migration，识别数据与读取兼容影响。已执行历史保持可追溯。
- **导入或更正：** 保留来源和稳定对象身份，先看影响范围，再执行对应批次；疑义由相关岗位确认。
- **删除、purge、不可逆迁移、破坏性重建：** 明确精确对象、依赖闭包和可恢复来源。恢复来源不足或长期缺少有效备份时补齐；恢复方法确有不确定性时再演练。
- **安全 SQL 或测试身份：** 使用已识别的隔离环境。事务回滚中的造数同样属于写入，正式对象不作为夹具清理。

正式身份、学生、班级、课次、考勤、冻结 release/snapshot 和受保护课程资源不得被当作测试数据删除。生产写入和服务变更需要本次任务明确授权；授权在本次任务已说明的范围内有效。

## 可用工具

### 已授权的生产课程写入

`cw:import` 与 `cw:adapt-4x3` 提供受控生产通道。先完成上面的只读识别，核对本次课程、版本、操作范围及必要的恢复来源；按 [课程导入](courseware-import.md) 查看计划。此通道不用于 fixture、测试造数或全库重建。

在实际连接与只读结果一致的前提下，准备以下目标声明：

- `MATHIN_WRITE_TARGET_ENVIRONMENT=production`。
- 实际 Supabase 与每个 Storage 入口的 origin 均为 `https://supabase.mathin.club`；`MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN`（或多入口的 `MATHIN_WRITE_ALLOWED_SUPABASE_ORIGINS`）精确匹配它们。使用 `CW_STORAGE_RESUMABLE_URL` 时也核对其 origin。
- 实际 SSH 目标及 `MATHIN_WRITE_ALLOWED_SSH_TARGET` 均为 `xiaomi`。这条通道通过 SSH 执行数据库操作，不接收直连数据库目标。
- `MATHIN_WRITE_TARGET_FINGERPRINT` 与只读核对的稳定数据库指纹一致，并匹配 `scripts/lib/r1-write-target-policy.mjs` 中登记的 `productionTargetFingerprint`。声明值不能代替实际目标核对。

执行前在**当前 Shell** 设置 `MATHIN_PRODUCTION_WRITE_CONFIRMATION=<操作名>:<目标指纹前 16 位>`，再为对应命令显式添加 `--allow-production-target`：

```powershell
# 将占位符替换为本次只读核对结果；操作名必须与接下来执行的命令相同。
$env:MATHIN_PRODUCTION_WRITE_CONFIRMATION = 'cw:import:<目标指纹前16位>'
```

`pnpm cw:import -- … --ssh-host xiaomi --allow-production-target` 执行导入；适配写入使用 `pnpm cw:adapt-4x3 -- … --apply --ssh-host xiaomi --allow-production-target`，确认串的操作名相应改为 `cw:adapt-4x3`。省略号代表本批次已核对的资源与课程参数。确认串只从当前进程环境读取，写入 `.env.local` 不会生效；本次操作结束后清除该变量。

源运行时升级需在本次授权中明确升级范围，并额外使用 `--upgrade-source-runtime --allow-production-source-runtime-upgrade`，在当前 Shell 设置 `MATHIN_PRODUCTION_SOURCE_RUNTIME_UPGRADE_CONFIRMATION=cw:import:source-runtime-upgrade:<目标指纹前16位>`；普通导入不带这组升级参数。检查拒绝时核对实际目标、操作名和本次授权，不修改保护代码来放行。

### 其他工具

`pnpm db:types` 生成相关数据库类型；`pnpm migrations:ledger` 生成账本 SQL。两者使用前读取脚本参数，明确是否连接数据库、是否输出文件或执行写入。

`pnpm db:rebuild` 只用于明确要求的隔离空库重建，包含破坏性动作；其环境声明与目标白名单由 `scripts/ci-rebuild-db.mjs` 验证。重建历史使用的 seed 保留为迁移依赖。

安全 SQL 位于 `supabase/tests/`，按实际风险选择文件。运行方式与目标设置读取 `scripts/lib/db-audit-runner.mjs`；调用前完成上面的识别。普通开发与发布不会自动触发这些操作。
