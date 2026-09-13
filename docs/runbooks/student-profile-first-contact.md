# 有效首联自动建档：本机开发增量

适用迁移：`20260906002200_student_profile_after_first_contact`。产品授权范围见 [首联基线 §10.4](../plan/school-support-followup-panel-contract.md#104-2026-09-06-学生-360-专项变更开发端待验收)。生产写入另走生产目标授权与 preflight，本记录不构成生产发布授权。

## 执行与检查

```powershell
node scripts/student-profile-first-contact.mjs --preflight
node scripts/student-profile-first-contact.mjs --check
node scripts/student-profile-first-contact.mjs --apply
```

- 复用本机隔离目标核对器，检查执行主机、Supabase origin、监听进程、Docker endpoint、网关网络及数据库 system identifier。目标不符即停止；已应用版本不重复执行。
- 使用既有函数所有者执行版本化变更；通用业务权限不变。仅 `record_lead_contact_v4` 在沟通／邀约／提醒成功后调用内部建档函数，内部函数不向 API 账号开放。
- `--check` 在事务与保存点中复用固定开发管理员、老师、学服、学生账号。临时 Lead/Student 夹具回滚，不创建账号，不清理正式对象。
- 断言覆盖四种首联结果、再次保存同一身份、疑似重复保护、继续邀约与改约、提醒保留、负责人转交、普通老师职责范围、越权及匿名拒绝，以及实际历史报名／测评的高阶段标签。整体回滚后核对新函数不存在及学生总数恢复。
- `--apply` 要求同一迁移摘要的通过记录；完成夹具回滚后，为未关闭、已有有效首联且尚未建档的本机 Lead 补建。由固定开发管理员记录补建审计，不模拟负责人本人。已有学生和可能重复的对象不自动合并；原沟通、来源、邀约及提醒均保留。
- 本地报告放在 gitignored `.tmp/student-profile-first-contact/`。共享记录不保存名单、号码、凭据或本机目标地址。

## 交付状态与回退边界

2026-09-06 本机执行结果：事务断言与整体回滚通过；迁移已应用，7 条既有有效首联补建成功，需重复身份复核为 0。示例回读确认档案已关联、标签为待测评，原沟通和邀约仍可读取。生产未修改，开发端待用户验收。

定向单测、类型、局部 lint、中英文键一致性与数据库事务检查通过后交开发端人工验收。自动化只覆盖已列明合同，不代替视觉／业务验收，也不关闭阶段 Gate。

若验收要求暂停自动建档，仅暂停保存流程中的自动建档调用，保留已建立的 Student、Lead 绑定及继续沟通的状态门。稳定学生身份及原始历史不通过删除或解绑定来“回退”。

## 2026-09-13 历史线索接续

增量迁移：`20260913000100_lead_profile_continuation`。补入窗口可选未建档的历史线索；沿用原 Lead 完成建档、资料更正和座位办理。身份及历史工作范围分别维护，建档继承原范围，新业务办理触发原范围的恢复规则。`ensure_lead_student_profile` 使用修订后的有效首联事实，保留已有身份，并将疑似重复返回为 `needs_review`。

本机执行顺序（Node 22.16 使用 TypeScript stripping 读取固定开发账号）：

```powershell
node --experimental-strip-types scripts/lead-profile-continuation.mjs --preflight
node --experimental-strip-types scripts/lead-profile-continuation.mjs --check
node --experimental-strip-types scripts/lead-profile-continuation.mjs --apply
node --experimental-strip-types scripts/lead-profile-continuation.mjs --backfill-preview
node --experimental-strip-types scripts/lead-profile-continuation.mjs --backfill-check
node --experimental-strip-types scripts/lead-profile-continuation.mjs --backfill-apply
```

迁移与补建分别执行；迁移不隐式批量写入业务数据。补建预览生成私有 UUID、版本及有效首联摘要清单，演练回滚后按同一清单应用；版本、联系事实或既有学生身份字段发生变化时重新预览和演练。重复运行只处理尚未建档的记录，原始来源、联系结果和历史报名保持原值。Base 后续导入完成并核对联系事实后，也执行这套预览、演练、补建步骤。

报告位于 gitignored `.tmp/lead-profile-continuation/`。2026-09-13 开发演练候选 2,366 条，其中 2,213 条可建档、153 条需身份或资料核对；同一清单实际补建结果与演练一致，回读确认 2,213 个 Student 都关联原 Lead，且没有登录账号。这些数字只表示本机结果。生产当日只读查到历史线索 3,775 条，尚未建档 3,773 条，其中 2,365 条存在有效首联，实际补建数量须在生产目标的精确清单与冲突复核后确定。

定向检查覆盖历史线索检索与显式身份确认、资料更正后重新确认、同一请求重试、座位占用、未经确认和无权限提交的事务回滚，以及四种首联结果和重复身份保护。开发页面待产品验收；生产发布和补建仍执行本次生产授权、备份、只读 preflight 与 postflight。已创建的稳定身份按上述回退边界保留。
