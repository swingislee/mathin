# 分班表退课与按讲次调班

状态：开发端分班交互已用户验收，已完成[生产发布](../evidence/r1/school-placement-production-20260909.md)，机器 postflight 通过，待生产实际交互验收。当前施工阶段仍为 R1-Live-2 / DEV-SCHOOL-OPS-1。

## 操作与结果

- 空位的圆圈「+」在悬浮或键盘聚焦时居中覆盖座位号。
- 选中已报名学生后，顶部显示「退课」。填写原因并确认后，结束本次报名、释放座位，在班级下方保留退课记录。尚未分班的报名也可退课。历史花名册会员直接结束会员关系；已关联正式报名的会员在同一事务中结束报名及有效分班关系。
- 姓名区域可直接拖动，落入班级后顺排空位；悬浮只高亮对应单元格。跨班拖动或选中学生后点击另一班空位，先选择「完全调班」或「临时调班」并确认。同班换位和退回待分班沿用原入口。
- 完全调班使用正式调班流程；临时调班只调整选定讲次的名单。原班长期座位和报名继续保留，其他讲次仍在原班。课程、年级或学期不匹配时先弹窗说明，填写原因并确认插班后才提交；权限、班级范围、容量、座位和课次锁定继续校验。
- 临时讲次先按课程讲次 ID 对应原班；目标课次缺少讲次 ID，或已经明确确认不匹配插班时，使用讲次序号补充对应。对应缺失、重复、已开课、已有该学生考勤或名单锁定时显示具体原因。
- 目标班展示带「临」标记的预约座位，原班学生也显示「临」。点击标记查看或取消安排。退课、完全调班或结束原会员关系时，同步取消未来临时安排；已经开始的课次仍按原历史归属读取。
- 退款继续使用收付款流程，退课不生成或修改资金流水。

## 数据与授权

`session_student_transfers` 保存原会员、学生、来源及目标课次、目标座位、操作者、原因和取消信息。客户端通过受控 RPC 操作，表及内部收据没有客户端写权限。

所有变更要求 `enrollment.manage`，并核对班级管理范围、原会员状态和座位。临时安排提交时重新锁定并核对双方课次及预览版本。请求编号、操作者和完整请求内容组成幂等收据；重复提交复用结果，内容变化使用新编号。

课堂名单、考勤新增权限、点名抽屉及学生／既有监护人课表读取同一讲次归属。临时学生只获得对应目标课次的课堂权限；原班所选讲次移出成员权限。原代课教师权限保持不变。冻结名单和已有考勤记录继续保存原内容，取消安排也保留已开始课次的事实。

后续分班尊重未结束课次的预约座位。其他报名入口自动选位时也会避开预约；班额内没有空位则提示重新安排。档案合并的关系清单包含临时调班记录，沿用原冲突检查与审计。

## 本机验证与应用

执行前核对 [写入目标策略](r1-write-target-policy.md)。本次核对 Windows 主机、loopback Supabase origin、开发服务与 Docker 监听、网络绑定及数据库指纹；未使用 SSH。

```powershell
node scripts/enrollment-session-transfers.mjs --preflight
node --experimental-strip-types scripts/enrollment-session-transfers.mjs --check
node --experimental-strip-types scripts/enrollment-session-transfers.mjs --apply
node scripts/enrollment-seat-reservation-capacity.mjs --preflight
node --experimental-strip-types scripts/enrollment-seat-reservation-capacity.mjs --check
node --experimental-strip-types scripts/enrollment-seat-reservation-capacity.mjs --apply
node --experimental-strip-types scripts/verify-enrollment-placement-changes.mjs <local-dev-url>
```

两项检查都在事务内执行隔离业务夹具，并回滚夹具；`--check` 还回滚 DDL。`--apply` 要求当前迁移内容、断言内容及数据库账本位置与成功检查一致。既有业务表内容摘要、原函数权限及回滚后的函数定义均经过核对。

| 迁移 | SHA-256 |
| --- | --- |
| `20260909000500_enrollment_session_transfers` | `33fc4108f10b0e75eae0eff3a674d2b3cfaf860f29a68fa82df457e55e5f38d9` |
| `20260909000600_enrollment_reserved_seat_capacity` | `881e4d51929d7dcfaf984e37ef07aea905270a1e53b9fe247f199df3f04d0266` |

已通过的机器检查覆盖：所选讲次双向名单、考勤权限与点名抽屉、固定开发学生的课次 RLS 与课表、重复提交、预览过期、完整退课与原子回滚、正式调班、预约座位及容量、冻结名单与原考勤内容保持不变，以及内部写权限隔离。固定账号 HTTP 检查覆盖新 RPC 读取、学生范围隔离和分班页面 zh/en 启动。交互检查覆盖实际 Pointer 跨班拖动先确认、取消不写入、讲次勾选、锁定原因和退课原因。

公共类型从已迁移的本机元数据生成；本次提交的迁移摘要使用已提交迁移及本任务两项迁移组成的独立输入，保持其他任务的未提交迁移独立。原始检查日志保留在本机 `.tmp/enrollment-session-transfers/`、`.tmp/enrollment-seat-reservation-capacity/` 与 `.tmp/enrollment-placement-startup/`，提交中不包含个人信息。

## 人工验收

开发端分班交互已经产品负责人验收。发布后在生产分班页核对圆圈位置、姓名拖拽、单元格高亮、跨班及不匹配插班确认、不同讲次的选择与「临」标记，以及选中学生后的退课流程。机器检查仅证明其覆盖的合同，生产视觉与业务意图以产品负责人实际操作为准。

若需暂停入口，回退应用入口并保留业务记录和审计。已发生实际退课或调班后，按具体学生及讲次做有记录的业务更正；已有冻结名单和考勤依照相应历史更正流程处理。
