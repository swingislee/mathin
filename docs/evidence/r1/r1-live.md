# R1-Live · 真实教师首个可用闭环差距表

## 结论

截至 2026-08-14，`mathin.club` / `supabase.mathin.club` 的应用、数据库、Storage、compose 和部署 commit 已完成只读指纹登记，仓库级写入口保险丝也已把 Xiaomi 固定为当前生产目标；测试造数/重建不能写入它，课程内容写入默认拒绝并使用独立受控通道。正式身份和业务对象尚未与现有数据分类，数据库 purge 尚未读取保护 manifest；目标机也没有可核验的数据库/Storage 最近备份，应用与数据库相差 73 条迁移，因此 R1-Live 当前状态仍为 Gate 0 `PASS`、Gate 1 `BLOCKED`、Gate 2 `BLOCKED`、Gate 3 `BLOCKED`、Gate 4 `BLOCKED`。

本文件是 E0/E1 差距审阅，不是生产验收。2026-08-14 的目标 E1/E3 运行事实见 [`r1-live-target-audit.md`](r1-live-target-audit.md)；用户提供的 `docs/plan/mathin-R1-Live-讨论稿.md` 为产品裁决输入，现行施工顺序以 doc 04 为准。

## Gate 状态表

| Gate | 当前状态 | 已完成证据 | 缺失项 | 是否阻塞 | 最小修复范围 |
| --- | --- | --- | --- | --- | --- |
| Gate 0 · 上线范围冻结 | `PASS` | doc 04 已冻结“正式教师整班点名”为首个闭环，并将旧 R1-9～18 重新分类 | 无 | 否 | 范围改变只接受产品负责人显式裁决 |
| Gate 1 · 正式身份与真实数据 | `BLOCKED` | 组合目标指纹 `799d…63e39`、部署 commit、Storage 摘要、身份/业务对象匿名基线已登记；仓库 fixture/rebuild/import 已接入公共 target policy；员工邀请、staff role/RLS、production/test purpose、学生/分班/课次 UI/RPC 已实现 | 本机无隔离开发写目标；数据库 purge 缺正式对象 manifest；现有身份和 `purpose=production` 对象未分正式/测试；无正式教师/真实闭环对象 manifest；未登记首个课次 release/snapshot/object | 是 | 先建立受保护 manifest 并隔离开发写入口，再使用正式 UI/RPC 建立或认领最小身份和数据 |
| Gate 2 · 真实工作闭环 | `BLOCKED` | `AttendanceDrawer`、`saveAttendanceAction`、`session_attendance`、`can_mark_attendance`/`can_view_attendance`、开课前 `ATTENDANCE_REQUIRED`；`tests/r1-classroom-continuity.test.ts` 有静态合同 | 无正式目标写态运行；无保存→刷新→重登→再读、管理员可见、无权限拒绝的单条 Golden Path | 是 | 补一条聚焦 Playwright 等价链，并在正式账号/真实数据下人工完整执行一次 |
| Gate 3 · 最小生产保险丝 | `BLOCKED` | current/previous release 结构、回退脚本、当前 commit、服务健康和 `operational_errors` 查询位置已确认 | 没有 backup timer 或可校验的数据备份；current 应用源码时代比数据库少 73 条迁移，previous commit 未知；全部 1,946 条错误缺 release；未做恢复抽查、兼容回退或受控错误 | 是 | 先建立数据库+Storage 备份并抽查恢复，再对齐应用/数据库、验证 rollback、注入 release 标识并在另行授权下定位一次受控错误 |
| Gate 4 · 真实教师独立验收 | `BLOCKED` | 无 E4 | 未选择首名教师；未进行无指导观察；P0/P1 未形成关闭记录 | 是 | 选 1 名真实教师独立执行 Gate 2，清零 P0/核心 P1，P2 入池 |

状态只允许 `PASS`、`BLOCKED`、`UNKNOWN`、`NOT REQUIRED`。Gate 3 已完成目标运行核查并得到明确失败事实，因此从 `UNKNOWN` 改为 `BLOCKED`，不能再用仓库脚本或历史演练替代当前备份与回退证据。

## 首个真实闭环选择

选择整班点名，原因如下：

1. 它是教师真实课堂的第一项持久动作，业务价值明确。
2. 写入合同小：每名学生一条 `(session_id, student_id)` 事实，四态枚举，重复保存走 upsert。
3. 权限边界已明确编码：教师需 `attendance.mark` 且本人任教或有全校范围；admin 恒可；其他主体受 RLS 拒绝。
4. 开课逻辑已经把完整点名作为服务端门，不依赖前端按钮隐藏。
5. 它不要求先完成整个备课、课程发布、成果、家长、公开内容或 3D 链路。

### 完整运行步骤

1. 正式教师从 `/zh/login` 登录。
2. 从 `/zh/dashboard/classes` 找到分配给自己的 `purpose=production` 班级。
3. 从班级页打开真实课次，进入 `/zh/classroom/{classId}/session/{sessionId}/live`。
4. 打开点名对话框，为全部在册学生选择 `present / absent / late / leave` 并保存。
5. 刷新页面，重新打开点名对话框，核对每条记录仍标记为已登记。
6. 退出并重新登录，再次打开同一课次并核对记录。
7. 正式管理员打开同一课次或对应学生学习记录，核对可见。
8. 退出登录后直接访问，页面/查询必须拒绝；若目标已有未分配 staff、其他班教师、学生或家长，再对该现有主体验证拒绝，不为负向测试临时创建正式账号。

### 代码、数据和权限位置

| 范围 | 位置 | 当前判断 |
| --- | --- | --- |
| 正式员工注册 | `src/features/account/AccountSupportPanel.tsx`、`src/features/account/actions.ts`、`src/app/[locale]/(auth)/actions.ts`、迁移 `20260728000400_r1_account_security.sql` | 当前一次性代码只绑定邮箱；注册后身份为 `staff`，仍需分配 teacher role。邮箱/手机号/password、验证码与微信/QQ 的唯一账号合同见 [`r1-live-auth-identities.md`](../../plan/r1-live-auth-identities.md) |
| 教师入口 | `src/app/[locale]/dashboard/classes/**`、`src/app/[locale]/dashboard/sessions/[sessionId]/page.tsx`、课堂 live route | 路由存在；现有 Playwright 只证明固定 teacher 能打开班级门户，没有点名写态 |
| 点名 UI/action | `src/features/school/AttendanceDrawer.tsx`、`src/features/school/actions/attendance.ts` | 读取失败显示 action failed；写入使用 zod 和 upsert；缺真实目标 E3 |
| 点名事实 | `public.session_attendance` | 主键防重复；触发器写 `marked_by/marked_at`；note 最长 500 字符由 action 限制 |
| RLS | 迁移 `20260709000700_school_attendance.sql` | admin、授权本班教师/全校 staff 可读写；可访问学生档案的员工可读；学生/家长只经裁剪 RPC 读本人/孩子 |
| 开课门 | `src/features/classroom/actions.ts`、课堂 live page、`src/features/classroom/live/LiveShell.tsx` | 在册人数大于点名记录数时服务端抛 `ATTENDANCE_REQUIRED` |
| 当前自动化 | `tests/r1-classroom-continuity.test.ts`、`e2e/school-portals.spec.ts` | 前者是源码合同，后者只到班级门户；均不能证明目标环境写态闭环 |

## 真实正式账号与数据路径

1. 先记录目标的前端域名、Supabase project/database 指纹、Storage namespace、部署 commit 和环境责任人。
2. 正式管理员从 `/dashboard/account-support` 为首名真实教师邮箱生成一次性员工邀请码，通过受控渠道交付；手机号邀请需等待兼容迁移和非生产验证。
3. 教师在 `/signup` 自行注册并完成 password 登录/恢复核对；管理员在 `/dashboard/staff` 分配内置 teacher staff role。邮箱、手机号、微信和 QQ 最终都绑定同一 `auth.users.id`，不得为登录方式复制 profile。
4. 管理员使用 `/dashboard/students` 创建/导入真实花名册；原始 CSV 和可识别信息不进入 Git/聊天证据。
5. 管理员使用 `/dashboard/classes/new` 创建 `purpose=production` 班级，选择一门当前 release 可读的课程、正式教师、学期和课次；再从班级花名册完成分班。记录该课次冻结/引用的 release ID、snapshot hash 和依赖对象 hash，并纳入正式保护 manifest。
6. 固定开发账号继续只用于开发验证；正式教师只分配 production 班级。任何 reset、seed、rebuild 或 testdata purge 在命中目标指纹或受保护对象 manifest 时必须拒绝。

当前代码允许 free 班级不带课程，但 class builder 不会为 free 班级自动创建课次。因此最小正式路径应选择一门当前已完整发布的课程并生成至少 1 个课次；不得用一次性 SQL 补造课次。

## 当前上线阻塞项

| ID | 等级 | 原因 | 最小修复 | 人工操作 | 验收 |
| --- | --- | --- | --- | --- | --- |
| LIVE-P1-01 | 核心 P1 | 仓库级 target policy 已阻断私网 DNS 误判，fixture/rebuild 拒绝 Xiaomi，课程导入默认拒绝并要求精确生产指纹与双重人工确认；但本机无隔离开发写目标，数据库 purge 尚未读取正式对象 manifest | 建立正式身份、业务对象及课次内容保护 manifest，让 `purge_test_*` fail-closed；另行登记隔离开发目标后才恢复开发造数 | manifest 和隔离配置不需要生产业务写入；迁移/部署需另行授权 | fixture/reset/seed/rebuild 在 Xiaomi 拒绝；课程生产写通道缺任一控制即拒绝；正式对象及内容依赖不进入 purge 集合 |
| LIVE-P1-02 | 核心 P1 | 目标已有 12 个账号、6 个 production 班级等对象，但尚未分正式/测试；没有经 manifest 确认的正式管理员、教师和最小真实业务数据 | 先分类保护现有对象，再走员工邀请、角色分配、学生、production 班级、课次和分班正式 UI/RPC | 提供真实教师邮箱、班级/课次和花名册，并另行授权写入 | 教师登录后只看到自己的真实班级；账号恢复可用；现有对象无误认/误清 |
| LIVE-P1-03 | 核心 P1 | 点名只在开发合同层有证据，没有目标环境 Golden Path | 增加单条聚焦 Smoke；正式教师人工执行保存/刷新/重登/再读，管理员与无权限角色作对照 | 教师和管理员各执行对应步骤 | 写入恰好一行/学生；重新读取一致；越权查询 0 泄露 |
| LIVE-P1-04 | 核心 P1 | 当前没有数据库/Storage 数据备份；应用/数据库漂移 73 条迁移使旧 release 回退兼容性未知；错误可查但 release 全空 | 安装并执行备份、校验和隔离恢复抽查；对齐部署与 migration head；验证 previous；配置 `MATHIN_RELEASE`；经授权定位一次受控错误 | 备份/恢复、部署/回退和制造错误均需另行授权 | 有最近可恢复备份；回退兼容；错误可按 time/route/release/digest 定位；证据不含 secret/PII |
| LIVE-P1-05 | 核心 P1 | 没有真实教师独立验收 | 选 1 名教师无逐步指导完成闭环 | 产品负责人选择并观察 | P0=0、影响闭环的 P1=0；P2 已登记 |

仓库审阅没有发现一个已证实的开放 P0；这不等于生产 P0=0，因为 Gate 1～3 尚未在目标环境执行。

## 上线后待办池

- 原 R1-9 的 1305 讲全量来源 inventory、Storage/H5 审计、Terms 内容/关系/SEO。
- Story 完整章节、Games/Minds/Tools/Notebook 全量发布与越权旅程。
- 104 份小王子视觉矩阵、全站 WCAG/CWV/浏览器签收。
- 全量 Playwright 写态、zh/en、跨浏览器、连续无 flaky、文件/并发/竞争矩阵。
- 全量指标、容量、监控、数据库/Storage RPO/RTO 和恢复演练。
- 14 天/5 节真实使用观察；观察从 R1-Live 开放当天开始，不作为开放前等待。
- Spatial Math / 3D 增强、长期重构、财务/活动深化和更多内容。

## 下一次状态变化

- Gate 1 只有在正式目标、身份、production 班级/课次/花名册、课次内容依赖保护和防误清证据全部成立后才能改为 `PASS`。
- Gate 2 只有在同一目标完成正式教师写态、持久再读、管理员可见和越权拒绝后才能改为 `PASS`。
- Gate 3 已由 `UNKNOWN` 变为 `BLOCKED`；只有最近可恢复备份、兼容回退、release 关联错误定位和危险入口指纹拒绝全部成立后才能改为 `PASS`。
- Gate 4 需要真实教师 E4，Agent、固定测试账号和产品负责人代操作都不能替代。
