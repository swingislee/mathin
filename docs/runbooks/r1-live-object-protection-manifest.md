# R1-Live 正式对象保护 manifest

## 当前状态

迁移 `20260815000100_r1_live_object_protection_manifest.sql` 已于 2026-08-15 部署到 Xiaomi，并与 `20260815000200_r1_profile_role_update_guard.sql` 在同一事务登记。随后根据 R1-Live 当前 Gate 的既定步骤生成 protected-only artifact，经完整激活事务回滚演练后正式激活。独立新连接 postflight 确认 manifest=1、entry=4、active=1：保护 1 个正式管理员的 `auth_user`/`profile` 和 2 个现有 production `course_family` 根，`purge_allowed=0`，两个 purge 候选列表均为 0；账号和业务匿名计数无变化，也没有执行清理。

精确 artifact 保存在 Xiaomi `/home/swing/services/mathin/evidence/r1/r1-live-protected-only-manifest-3cd327ac685f81182fad403519bf1bbf7075f1feb434638d8ae71bd1e06e0102.json`，文件 mode `600`、owner/group `swing`、规范化 SHA-256 `3cd327ac685f81182fad403519bf1bbf7075f1feb434638d8ae71bd1e06e0102`；条目集 SHA-256 为 `e62d27094fa63c91d5fa57669e1a06a006b733fb3478cd276266c8553b582514`。仓库只登记去标识化摘要，不保存原始 UUID。

本合同只覆盖现有两个永久清理 RPC：`purge_test_classroom` 与 `purge_test_course_family`。R1-15/R1-18 的全库清理与 release 重建仍保持不可执行，直到它们也读取同一目标、保护对象和准删对象集合，并在隔离副本完成验收。

## 三重门

每次永久清理在同一事务中读取三类事实：

1. `r1_current_database_fingerprint()` 对当前 PostgreSQL cluster 的 `system_identifier` 取 SHA-256；active manifest 必须精确绑定该值。把生产库 dump 恢复到另一个 cluster 后，原 active manifest 不会授权新目标。
2. `classification='protected'` 明确登记正式 auth/profile UUID、班级、成员、课次、学生、考勤、release、snapshot 与对象 hash。删除闭包命中任一保护条目即停止。
3. `classification='purge_allowed'` 只允许 `classroom` 或 `course_family` 根，必须保存精确 UUID、显示名和影响计数。`purpose='test'`、软删除状态、手输名称和引用检查仍须同时通过。

`entries_sha256` 是全部条目的确定性数据库摘要。manifest 激活和每次 purge 都复算条目数与摘要；实际课程/班级影响计数也在删除前复算。任一差异都不会产生领域事件或删除。

## 数据表与访问边界

| 对象 | 用途 | API 访问 |
| --- | --- | --- |
| `r1_object_protection_manifests` | 环境、数据库指纹、外部 artifact hash、条目 hash/计数、审批和状态 | `anon`、`authenticated`、`service_role` 均无表权限 |
| `r1_object_protection_entries` | `protected` / `purge_allowed` 的明确对象键、内容 hash、预期名称/计数和非 PII 元数据 | `anon`、`authenticated`、`service_role` 均无表权限 |
| 内部 fingerprint/hash/footprint/helper 函数 | trigger、候选预览和 purge 的 SECURITY DEFINER 内部调用 | 不授予 API 角色执行权限 |

manifest 只能通过受评审 migration 或受控运维数据库连接创建；应用、浏览器和 service key 不能直接读取、改写或激活它。active 条目不可更新或删除；active header 只允许原字段不变地转为 `retired`。

## 对象键格式

- 单 UUID 对象使用小写 UUID 文本，例如 `auth_user`、`profile`、`student`、`classroom`、`class_session`、`course_family`、`course`、`course_lecture`、`cw_lecture_release`。
- 复合对象使用 `父 UUID/子 UUID[/限定符]`，例如 `classroom_member`、`classroom_staff_assignment`、`session_attendance`。
- Storage 对象使用 `bucket/path`，并把实际对象 SHA-256 写入 `content_sha256`。
- `cw_lecture_release`、`session_courseware_snapshot`、`cw_asset_object` 和 `storage_object` 的 protected 条目必须有 `content_sha256`。
- `auth_user` 的 `metadata` 至少保存 `role` 与 `status`；恰好一个 active admin 还必须保存不含凭据/PII 的 `recoveryOwnerRef`。每个 protected `auth_user` 必须真实存在、与当前 profile 的角色/启用状态一致，并有同 UUID 的 protected `profile`。

真实姓名、邮箱、手机号、邀请码、恢复凭据和其他 PII 不进入表内 metadata、Git 或聊天证据。显示名只允许用于 `purge_allowed` 测试根的二次确认。

## R1-Live 与后续清理

R1-Live Gate 1/3 禁止批量清理。因此首次生产 manifest 应只有 protected 条目，`purge_entry_count=0`；部署后候选列表返回空，直接调用 purge 返回 `PURGE_MANIFEST_TARGET_NOT_ALLOWED`。

R1-15 只在生产快照的隔离副本创建替代 manifest，并明确加入已核对的 `purge_allowed` 根。隔离目标的数据库指纹、外部 artifact hash、条目 hash、预期计数和非执行者复核都通过后，才能形成 R1-18 的候选变更；不得把隔离 manifest 复制为生产授权。

## Fail-closed 错误

| 错误 | 含义 |
| --- | --- |
| `PROTECTION_MANIFEST_REQUIRED` | 当前数据库没有可用 active manifest |
| `PROTECTION_MANIFEST_TARGET_MISMATCH` | active manifest 属于另一 PostgreSQL cluster |
| `PROTECTION_MANIFEST_COUNT_MISMATCH` / `PROTECTION_MANIFEST_HASH_MISMATCH` | manifest 条目集合漂移 |
| `PURGE_MANIFEST_TARGET_NOT_ALLOWED` | 目标没有明确准删条目 |
| `PURGE_MANIFEST_LABEL_MISMATCH` | 目标显示名与审核 artifact 不同 |
| `PURGE_MANIFEST_COUNT_MISMATCH` | 当前删除影响与审核时计数不同 |
| `PROTECTED_OBJECT_IN_PURGE_SET` | 删除根或其关键子对象命中 protected 条目 |

所有错误都发生在领域事件和物理删除之前。数据库事务继续保证后续外键/触发器错误不会留下部分删除。

## 验证与授权边界

仓库验证使用一次性 PostgreSQL 15 从零重放全部 migrations，再运行 `supabase/tests/r1_live_object_protection_assertions.sql`；断言包在 `BEGIN/ROLLBACK` 中。它覆盖无 manifest、错误目标、错误 hash、计数漂移、active 不可变、受保护子课次和精确准删对象。

当前 Gate 已计划且不扩张范围的只读核查、manifest 维护和可逆验证，按 doc 04 的 standing execution direction 由 Agent 在每轮目标/写态/漂移自检后直接推进，不再拆成重复确认。需要产品负责人提供真实身份/班级信息、执行人工验收，或加入任何 `purge_allowed` 条目、执行 purge、扩大目标或进行不可逆动作时必须停下；仓库合同通过本身不构成这些计划外生产动作的完成证据。
