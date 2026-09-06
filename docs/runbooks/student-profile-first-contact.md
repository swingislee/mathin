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
- `--check` 在事务与保存点中复用固定开发管理员、老师、学辅、学生账号。临时 Lead/Student 夹具回滚，不创建账号，不清理正式对象。
- 断言覆盖四种首联结果、再次保存同一身份、疑似重复保护、继续邀约与改约、提醒保留、负责人转交、普通老师职责范围、越权及匿名拒绝，以及实际历史报名／测评的高阶段标签。整体回滚后核对新函数不存在及学生总数恢复。
- `--apply` 要求同一迁移摘要的通过记录；完成夹具回滚后，为未关闭、已有有效首联且尚未建档的本机 Lead 补建。由固定开发管理员记录补建审计，不模拟负责人本人。已有学生和可能重复的对象不自动合并；原沟通、来源、邀约及提醒均保留。
- 本地报告放在 gitignored `.tmp/student-profile-first-contact/`。共享记录不保存名单、号码、凭据或本机目标地址。

## 交付状态与回退边界

2026-09-06 本机执行结果：事务断言与整体回滚通过；迁移已应用，7 条既有有效首联补建成功，需重复身份复核为 0。示例回读确认档案已关联、标签为待测评，原沟通和邀约仍可读取。生产未修改，开发端待用户验收。

定向单测、类型、局部 lint、中英文键一致性与数据库事务检查通过后交开发端人工验收。自动化只覆盖已列明合同，不代替视觉／业务验收，也不关闭阶段 Gate。

若验收要求暂停自动建档，仅暂停保存流程中的自动建档调用，保留已建立的 Student、Lead 绑定及继续沟通的状态门。稳定学生身份及原始历史不通过删除或解绑定来“回退”。
