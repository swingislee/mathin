# Mathin 学校系统人工功能验收清单

> **用途**：在继续 R1-9 公共内容发布施工前，对当前学校系统进行一次按真实角色、真实对象和完整状态流转的人工审阅。
>
> **适用基线**：`main`，R1-1～R1-8 已关闭；填写执行记录时必须补充实际 commit、migration head、环境和数据集。
>
> **证据边界**：本清单补充人工可用性、流程和跨角色接缝证据，不能替代 RLS/Auth/Storage 负向断言、并发测试、性能测试、恢复演练或 R1-14 正式 Playwright。
>
> **范围**：账号与安全、员工后台、学生与家庭门户、课程研发、课件 Studio、班级、课次、课堂、课后成果、通知、平台运维、数据治理、白板，以及财务安全关闭。
>
> **不在本轮**：Terms/Story/Minds/Notebook 的新公共内容发布后台与公开站内容质量；它们属于 R1-9～R1-12。课程课件发布属于学校教学链，仍在本清单内。

## 0. 使用规则

### 0.1 结果记法

只有满足预期后才把 `- [ ]` 改成 `- [x]`。未通过的项目保持未勾选，并在行尾补充以下结果之一：

- `FAIL · BUG-编号`：实际结果与预期不符。
- `BLOCKED · 原因`：账号、数据、供应商或环境条件不足。
- `N/A · 原因`：经产品确认当前环境不适用。
- `SKIP · 原因`：本轮主动未测；不能计入通过率。

严重度：

- `Sev0`：安全、数据不可恢复损坏、跨家庭/跨学生泄露、全站不可用。
- `Sev1`：核心角色主链无法完成，或发布/撤回/审核状态错误。
- `Sev2`：有绕行办法，但明显影响实际运营或造成高概率误操作。
- `Sev3`：文案、布局、轻微反馈问题，不阻断任务。

### 0.2 每次执行记录

| 字段 | 填写值 |
| --- | --- |
| 执行日期/时区 | 2026-08-03 12:00 |
| 测试人 | 李成浩 |
| commit SHA | `d801c16`（基线 `56c18ae`＋BUG-R1M-001 修复 `db9e14e`＋§1.2 数据集 `a214f03`＋BUG-R1M-002/003 门禁修复 `d801c16`；后者只改断言脚本，不改产品代码） |
| migration head | `20260803000100_r1_fix_submission_notification_ambiguity`；157 个 migration，集合 digest `0966126c59a470a03e911aca6fcb0535b2afa470ddeca09b7a080763399801da` |
| 环境与应用地址 | 本地 |
| 浏览器/版本/设备 | chrome |
| 数据集标识 | `QA-20260803-school-manual`（`pnpm r1:manual-dataset` 幂等重建，见 §1.2） |
| 开始/结束时间 | 2026-08-03 12:00 |
| 通过/失败/阻塞/跳过 |  |
| 证据目录或链接 |  |

#### 本次补测记录（4.4 / 5.1 / 5.2）

本次补测于 2026-08-03 14:52–15:05（Asia/Shanghai）在本地 `http://localhost:3130` 使用 Codex In-app Browser（Chromium，1280×720）完成，当前代码为 `556ddf79ca2df5b687b4d937d6ece12e5d09e4e6`。使用已登记的 `sales`、`principal`、`research` 开发账号，沿用 `QA-20260803-school-manual` 数据集；未创建活动，未触碰 E 系列 release、账号、班级或订单基线。

- 4.4 写入了带 `QA-20260803-manual-` 前缀的跟进记录，并验证了流失学生回流；下次跟进日期未写入，详见 `BUG-R1M-006`。
- 5.1 新建测试课程产品族 `830665bc-03ec-407f-88e6-29a94349635a`，并创建版本 `c378693a-d936-4ca3-874e-004bfd0d64b9` 与 `8df90a37-8b82-400d-94eb-44ef5e7f6b85`；创建活动失败，因此没有活动对象可登记。
- 5.2 使用 E 系列既有讲次验证了 16:9/4:3 轨道与讲次工作区入口；新建产品的新增讲次可以在编辑态暂存，但批量保存失败，详见 `BUG-R1M-009`。
- 本轮无截图、日志或请求 ID 作为外部证据；缺陷记录只保留本地 route、测试对象 ID 和无敏感信息的复现结果。

#### 本次继续补测记录（5.2 / 5.3 / 5.4）

本次继续补测于 2026-08-03 15:07–15:28（Asia/Shanghai）在本地 `http://localhost:3130` 使用同一 Codex In-app Browser（Chromium，1280×720）完成，当前代码为 `556ddf79ca2df5b687b4d937d6ece12e5d09e4e6`。沿用 `research` 开发账号和 `QA-20260803-school-manual` 数据集；未上传素材，未修改 E 系列页面、分类、release、替换关系或审校状态。

- 5.2 复核了 QA 讲次的 Studio 空态、E 系列讲次的 Studio 入口与 native/adapted 页目录；QA 讲次的使用班级链接进入通用错误页，登记 `BUG-R1M-014`。
- 5.3 在 E 系列既有讲次上只读验证了 58 页目录、页属性、revision/release 信息、轨道切换、页版本预览和页切换；没有执行写入型页面编辑、校对、发布、回滚或媒体上传。
- 5.4 验证了适配校对五个 tab、课程/讲次/分类筛选、分页、资源库类型筛选、资源详情使用树与双轨预览；适配队列缺少关键词搜索和批量处理，资源 query 搜索失败，分别登记 `BUG-R1M-011`～`BUG-R1M-013`。
- 本轮无截图、日志或请求 ID 作为外部证据；缺陷记录只保留本地 route、测试对象 ID、队列数量和无敏感信息的复现结果。


#### 本轮继续补测记录（6）

本轮第 6 节补测于 2026-08-03 15:30–15:53（Asia/Shanghai）在本地 `http://localhost:3130` 使用同一 Codex In-app Browser（Chromium，1280×720）完成，当前代码为 `556ddf79ca2df5b687b4d937d6ece12e5d09e4e6`。复用 principal、teacher、sales、parent、student 和 registrar 固定开发账号及 `QA-20260803-school-manual` 数据集；未新建账号，未创建新班，未写入 E 系列基线。

- 6.1/6.2 验证了 all/teaching/support/test scope、班级筛选、建班四步向导、课程版本准备度、班级对象四个 tab、教学准备和启用前课件风险确认。
- 6.3/6.4 验证了教师/学辅/主管范围、花名册入口、周课表切换、教师筛选、课次快速抽屉、QA 课次取消并恢复；QA 课次 3 已恢复到原“未开始”状态。
- 6.5 使用 parent 提交 QA 课次 5 的未来请假，teacher 在课前页批准；该 QA 请假审批事件作为验收数据保留。点名与补登记仅打开表单，未保存出勤状态。
- 本轮无截图、日志或请求 ID 作为外部证据；缺陷记录只保留本地 route、测试对象 ID、角色范围、页面可见结果和无敏感信息的复现步骤。

#### 本轮继续补测记录（7）

本轮第 7 节补测于 2026-08-03 15:55–16:18（Asia/Shanghai）在本地 `http://localhost:3130` 使用同一 Codex In-app Browser（Chromium，1280×720）完成，当前代码为 `556ddf79ca2df5b687b4d937d6ece12e5d09e4e6`。复用 `test-teacher`、`test-student`、`test-parent` 固定开发账号及 `QA-20260803-school-manual` / P6-5 既有课次；未上传文件，未发布作业/视频/课评，未保存点名、板书或课后任务状态。

- 7.1 复核了课前三步生产流程、研读/教案/磨课切换、右侧课件目录与 4:3 预览常驻、内部滚动、审校人候选及课件翻页；通过“下一页/上一页 + PageDown”验证了同一翻页状态。
- 7.2 以教师打开未开始课堂，确认点名是主动作、开始上课在未完成点名时禁用；以学生打开同一课堂，默认只见本人并按需展开同学名单，未显示内部评价。点名人数不一致问题 `BUG-R1M-019` 仍可复现，未重复登记。
- 7.3 复核了已结束课次的知识总结、作业发布、视频任务三个独立面板，以及逐生课评/跟进/作业审阅/视频审核区域；未执行发布、评分、上传、完成课次或撤回等持久写入动作。
- 本轮无截图、日志或请求 ID 作为外部证据；缺陷记录只保留本地 route、测试对象 ID、角色范围、页面可见结果和无敏感信息的复现步骤。

#### 本轮继续补测记录（8）

本轮第 8 节补测于 2026-08-03 16:20–16:42（Asia/Shanghai）在本地 `http://localhost:3130` 使用同一 Codex In-app Browser（Chromium，1280×720）完成，当前代码为 `556ddf79ca2df5b687b4d937d6ece12e5d09e4e6`。复用 `test-teacher` 固定开发账号以及 `QA-20260803-在读测试班`、现有课表和 QA 讲次；仅导航、筛选和日期切换，未写入业务数据、未上传文件。

- 8.1 从 QA 班级的课次链接实际进入 `QA-20260803-在读课次1·生命周期主线`，URL 携带 `returnTo`；点击“返回班级工作区”后回到原班级的 `?tab=sessions`，补充 `COURSE-06` 证据。
- 8.2 通过班级列表的等价 GET 筛选路由覆盖关键词、年级、主讲、学辅、学期、运营状态、用途和准备状态；结果数依次为 `2/3/5/3/5/1/2/3`，并与既有清空筛选验证合并记录。
- 8.3 在周课表实际选择 `QA-20260803-在读测试班`、`测试-教师`、`QA-A102` 三项筛选，筛选后仅保留匹配课次；随后恢复为“全部”筛选。学生/家长仅本人/孩子范围的既有证据未改变。
- 8.4 从 2026-08-03 周连续点击“下一周”至 2027-01-04 周，确认跨月、跨年日期标题和时间线无跳周；该周显示“这一周没有排课”，随后点击“回今天”恢复到 8/3–8/9。
- 本轮无截图、日志或请求 ID 作为外部证据；缺陷记录只保留本地 route、测试对象 ID、角色范围和无敏感信息的复现结果。

#### 本轮继续补测记录（9）

本轮第 9 节补测于 2026-08-03 18:25–18:38（Asia/Shanghai）在本地 `http://localhost:3130` 使用同一 Codex In-app Browser（Chromium）完成，当前代码为 `556ddf79ca2df5b687b4d937d6ece12e5d09e4e6`。复用 `test-teacher` 固定开发账号、现有 E 系列课次 `突破进退位加减法` 和当前课表；只读翻页与临时视口检查，未写入业务数据、未上传文件，结束时已恢复默认 1280×720 视口。

- 9.1 在 55 页既有课件课前页验证上一页/下一页、ArrowRight/ArrowLeft、PageDown/PageUp、空格均可在第 1 页与第 2 页之间切换，随后恢复到第 1 页。
- 9.2 在 `/zh/dashboard/schedule` 依次设置 390、768、1024、1440px 宽（高度 720px）；四个尺寸的 document 均无横向溢出，窄视口课表容器保留 820px 内容宽度并可内部横向滚动，四个尺寸均检测到 sticky 元素；1440px 下无需横向滚动且不产生 window 双滚动。
- 本轮无截图、日志或请求 ID 作为外部证据；缺陷记录只保留本地 route、测试对象 ID、角色范围和无敏感信息的复现结果。

#### 本轮继续补测记录（10）

本轮第 10 节补测于 2026-08-03（Asia/Shanghai）在本地 `http://localhost:3130` 使用同一 Codex In-app Browser 完成，复用 `test-teacher` 固定开发账号及既有 E 系列备课审核产物、QA 课次；未上传文件、未提交审核/发布动作、未修改课件或课堂事实。另在既有 P4 课后页点击“使用模板”观察自动保存，内容未改变且未发布；视口测试结束后恢复 1280×720。

- 10.1 进入 `/zh/dashboard/courseware/preparation-review`，打开既有“需修改”解析记录；审核页展示审校人、产物状态、解析 revision、课件页列表和并排预览，并通过“定位此页编辑”进入带稳定 `prepPage` UUID 的课前编辑路由，补充 `PREP-11` 证据。
- 10.2 在 QA 课次试讲路由 `/zh/classroom/5e0897eb-6c7d-4b8f-bc0f-30dd96b09804/session/ebfd615a-e772-4b09-9d48-bfbfd70332f5/live?mode=rehearsal` 验证 1280×720、1024×768、768×1024、1194×834、834×1194；无 document 横向溢出，但 1024×768 与 1194×834 的底部课堂控件被内层布局裁切，记录 `BUG-R1M-021`，未执行课堂写入。
- 10.3 在已结束 P4 课次课后页点击“使用模板”，知识总结编辑器保留默认模板内容，状态由“正在自动保存”回到“草稿已自动保存”；当时未填写标题、未编辑正文、未发布，模板标识与刷新后的持久值留待第 11 节复核。
- 本轮未保存截图、日志或请求 ID；截图仅用于当场视觉复核，缺陷记录不含 secret、token 或真实 PII。

#### 本轮继续补测记录（11）

本轮第 11 节补测于 2026-08-03 18:48–19:07（Asia/Shanghai）在本地 `http://localhost:3130` 使用 Codex In-app Browser 完成。先用主管固定账号做建班向导只读回退，再明确重新登录 `test-teacher` 复核课前教案，避免多标签共享登录会话造成角色误判；未提交建班、未切换机构时区、未提交备课审核或发布动作。

- 11.1 建班向导选择 QA 测试课程版本后填写临时班级信息，完整推进到确认页；从排课返回班级信息、从班级信息返回课程步骤均保留已填数据，确认页仍显示测试用途、测试-教师、2 条课次及“未发现主讲教师时间冲突”。结束时离开确认页，未点击“创建班级”，无新对象写入，补充 `CLASS-03`。
- 11.2 教师重新登录后打开 QA 在读课次课前页的“教案设计”，页面显示标准教案、BlockNote 默认结构、“草稿”“教案已保存”；读取标题提示得到 `模板 mathin-teaching-plan-v1`。页面未呈现 revision 数值，因此 `PREP-07` 仍保留 SKIP。
- 11.3 重新打开 P4 课后页验证前轮模板操作结果：默认三段知识总结仍在，状态为“草稿已自动保存”；结合前轮“使用模板”后的自动保存观察，补充 `POST-02` 通过证据。未填写标题或正文，未发布知识总结。
- 11.4 主管只读查看机构设置，机构时区为 `Asia/Shanghai`，默认校区时区为空并继承机构；未切换时区，因此 `SCHED-01` 的时区边界仍未通过。
- 本轮未保存截图、日志或请求 ID；建班向导仅保留客户端临时状态，证据不含 secret、token 或真实 PII。

#### 本轮继续补测记录（12）

本轮第 12 节补测于 2026-08-03（Asia/Shanghai）在本地 `http://localhost:3130` 使用主管固定开发账号完成。针对 `CLASS-06` 只使用测试班临时状态和错误回退路径，未创建班级、未写入数据库。

- 12.1 在 QA 测试课程建班向导填写班名 `QA-20260803-仅边界不创建`、主讲教师 `测试-教师`、教室 `QA-A102`、容量 `0`，选择 `2026 春季学期 · 当前`、周二并推进到确认页；确认页保留课程、测试用途、教师、2 条课次和无教师冲突提示。
- 12.2 点击“创建班级”后停留在确认页并出现“创建失败，请检查填写内容后重试。”；未产生新班级。记录显示前端步骤没有在容量为 0 时提前阻断，最终动作由服务端校验拒绝，因此 `CLASS-06` 仍未通过全量字段/边界覆盖。
- 本轮未保存截图、日志或请求 ID；不含 secret、token 或真实 PII。
### 0.3 安全与数据纪律

- [x] `SAFE-01` 只使用 `.claude/test-accounts.local.md` 已登记的固定开发账号；不新建账号。
- [x] `SAFE-02` 只在开发/RC 环境执行；地址、项目标识和数据库标识已经人工确认，不是正式生产。
- [ ] `SAFE-03` 新建业务对象统一使用 `QA-日期-用途` 前缀，并优先标记为测试用途。
- [ ] `SAFE-04` 学生、家庭、电话、视频、附件只使用虚构测试资料，不上传真实未成年人 PII。
- [ ] `SAFE-05` 不启用财务 Feature Flag；不通过数据库或接口绕开 R1-8 关闭门。
- [ ] `SAFE-06` 不删除或重建 E 系列 865×2 源资源、release、账号、班级或订单基线。
- [ ] `SAFE-07` 删除类测试只操作本轮创建且已核对 ID 的测试对象；优先验证归档、撤回、作废和恢复。
- [x] `SAFE-08` 不移除唯一管理员的最后一个 MFA 因子，不封禁最后一个有效管理员。
- [ ] `SAFE-09` 永久清理、测试数据 purge、账号停用和学生合并前，先记录目标、影响数量和可恢复边界。
- [ ] `SAFE-10` 截图、日志和缺陷记录不包含密码、OTP、TOTP secret、邀请/绑定码、token、签名 URL、完整手机号或可识别未成年人信息。

### 0.4 自动化配套基线

人工开始前先确认相同 commit 的自动化基线，避免把已知工程失败混进人工体验缺陷。数据库命令由能确认目标环境的人执行。

- [x] `AUTO-01` `pnpm ci:checks` 通过，记录 checks 数量与 build 页面数量。
  ✓ Generating static pages using 31 workers (314/314) in 1012ms
  === CI checks 汇总：14/14 通过 ===
  数据集提交 `db9e14e`（含 BUG-R1M-001 修复、重新生成的 `database.types.ts` 与更新后的初始化 manifest）重跑：14/14 通过。
  门禁修复提交 `d801c16` 重跑：14/14 通过；`pnpm build` 预渲染 314 个静态页面、路由表 80 条。
- [x] `AUTO-02` `pnpm r1:test` 通过，记录测试文件数和断言数。
   Test Files  15 passed (15)
      Tests  98 passed (98)
   Start at  12:08:09
   Duration  434ms (transform 832ms, setup 0ms, import 1.19s, tests 272ms, environment 1ms)
   `db9e14e` 重跑：15 files / 98 tests 全部通过。
   `d801c16` 重跑：15 files / 98 tests 全部通过。
- [x] `AUTO-03` `pnpm r1:db-audit` 在明确的开发/一次性数据库通过；测试事务已回滚，未连接正式生产。
  $ node scripts/run-r1-db-audit.mjs
    DATABASE_URL is required for r1:db-audit
    [ELIFECYCLE] Command failed with exit code 2.
  BUG-R1M-002（Sev2，工程门禁，已修复 `d801c16`）：四个 db-audit 脚本只支持 `DATABASE_URL`＋本机 psql，本机既无该变量也未安装 psql（自托管库在 `xiaomi` 的 `supabase-db` 容器内），门禁无法执行。已抽出 `scripts/lib/db-audit-runner.mjs` 并新增 `SUPABASE_DB_SSH` 通道（与 `db:types` 的 `SUPABASE_META_SSH` 同构），CI 的 `DATABASE_URL` 通道不变。
  BUG-R1M-003（Sev1，断言假通过，已修复 `d801c16`）：`r1_export_artifacts_assertions.sql` 硬编码 `supabase/ci/10_fixtures.sql` 的夹具身份 UUID，只能在 CI 夹具库执行；且取不到 artifact 时 `payload` 为 NULL，其后 4 条 `payload not like '%…%'` 泄漏检查全部静默为真——用户权利导出的越权/内部字段泄漏门在什么都没检查的情况下会显示通过。已改为经事务级 GUC 传入 `\gset` 得到的身份与 artifact id，并在 artifact 缺失时立即失败。
  $ SUPABASE_DB_SSH=xiaomi pnpm r1:db-audit
    R1-1/R1-2/R1-3/R1-6/R1-7E/R1-4/R1-8 assertions passed（其余 5 个文件无 `\echo`，以 exit=0 判定）
    12/12 通过，exit=0
  目标环境：自托管**开发库**（非一次性 CI 库，非生产；当前尚无生产环境）。12 个断言文件均以 `rollback` 结尾，执行后无写入残留。一次性库通道由 CI `database` job（`ci:db-rebuild` → migration 账本 → p4e/p6/p4h/r1 断言）覆盖，推送后引用其 run URL 作为 E2 证据。
- [x] `AUTO-04` 权限结论引用对应 RLS/Auth/Storage 负向断言；没有把“按钮不可见”记作安全通过。
  同 commit 负向断言基线全部通过：`p4e:db-audit`（RLS 越权）、`p6:db-audit`（课件资产 5 个文件）、`p4h:db-audit`（教学运营生命周期）、`r1:db-audit`（12 个文件）。本轮任何权限结论必须引用其中的具体断言，UI 不可见只作为体验观察记录。
- [x] `AUTO-05` 当前仍没有正式 Playwright 发布套件；本轮浏览器结果明确标记为人工 E3 候选证据，R1-14 再固化为可重复 E2E。
  已核对：仓库无 Playwright 配置文件，无 `e2e/` 目录。
- [x] `AUTO-06` `pnpm plan:audit` 通过；本清单没有擅自改变 doc 04 当前施工阶段。
  规划治理审计通过：00～26 状态、唯一阶段、索引与 1.0 契约一致。doc 04 当前施工阶段仍为 R1-9。

## 1. 账号与测试数据准备

### 1.1 角色账号矩阵

从 `.claude/test-accounts.local.md` 选择已存在的账号，不在本文件抄录凭据和 UUID。

- [x] `DATA-01` admin：系统管理员，可验证管理员 MFA 门与兜底权限。
- [x] `DATA-02` principal：主管/校长，可验证全校范围、委派、员工、配置和审计。
- [x] `DATA-03` registrar：教务，可验证课程、班级、排课、考勤和异常处理。
- [x] `DATA-04` research：教研，可验证课程研发、制作、校对与发布。
- [x] `DATA-05` teacher：教师，可验证备课、课堂、作业、课评和成果发布。
- [x] `DATA-06` sales：学辅/前台，可验证线索、家庭、通知、请假、补课和跟进。
- [x] `DATA-07` hybrid：至少一个双岗位员工，验证同一账号多岗位权限并集。
- [x] `DATA-08` student A：有账号、有在读班级、有课次和任务。
- [x] `DATA-09` student B：属于不同家庭或班级，用于越权负向验证。
- [x] `DATA-10` parent A：与 student A 有有效监护关系。
- [x] `DATA-11` unbound parent：未绑定任何学生，用于空状态与越权验证。
- [x] `DATA-12` 如现有数据允许，准备一个多子女家长；若没有，标记 `BLOCKED`，不要擅自创建账号。

### 1.2 最小业务数据集

数据集标识 `QA-20260803-school-manual`，由 `R1_DEV_TEST_FIXTURES=1 pnpm r1:manual-dataset`（`scripts/ensure-r1-manual-test-dataset.mjs`）幂等重建。脚本执行前断言 `finance.enabled` 关闭、email/sms/wechat/webhook 四个外部渠道均为 `disabled`，并拒绝非私网目标；只复用 `.claude/test-accounts.local.md` 的固定账号，不新建 auth 用户，不改动 E 系列生产课程、release 与既有班级。连续运行两次对象数量不变（1 课程族 / 1 版本 / 2 讲次 / 2 班 / 8 课次 / 2 学生 / 4 报名 / 1 作业 / 2 提交 / 1 视频任务 / 1 待审视频 / 1 work item / 1 审批 / 1 通知）。完整对象清单以脚本 stdout 的 JSON manifest 为准，本节只登记入口对象。

- [x] `DATA-13` 一个可只读抽样的正式用途课程产品、版本、讲次和 native/adapted release。
  产品族 `E 系列小学数学`（`xueersi-e-primary-math-cn`），版本 `E系列数学一年级暑期A[全国版]`（product code `MFHK00621`），第 1 讲「数的组成和比较」；native-16x9 与 adapted-4x3 各有 `release_no=1`，native track head 已指向对应 release。脚本只读校验，不写入。
- [x] `DATA-14` 一个本轮可修改的测试课程产品，至少包含一个版本和两个讲次。
  `QA-20260803-人工验收课程`（purpose=test）→ 版本 `QA-20260803-人工验收课程·一年级暑期A`（product code `QA-20260803-A`，purpose=test）→ 讲次 `QA-20260803-第1讲 数与运算基础`、`QA-20260803-第2讲 图形认识入门`。两讲**均无 release**，用于 `CLASS-04`／`CLASS-21`／`CLASS-22` 的课件风险分支。责任人：教研 owner、教师 editor、主管 reviewer。
- [x] `DATA-15` 一个 planning 测试班和一个 active 测试班；均有主讲、学辅、学期、教室和课次。
  `QA-20260803-筹备测试班`（planning，教室 `QA-A101`，2 节课次）与 `QA-20260803-在读测试班`（active，教室 `QA-A102`，6 节课次）；两班均 purpose=test、绑定 QA 课程版本与当前学期「2026 春季学期」，主讲 `test-teacher`、学辅 `test-sales`（`is_primary`）。
- [x] `DATA-16` 至少两名测试学生，分别覆盖有账号/无账号、有监护人/无监护人、在读/历史报名。
  有账号＋有监护人＋在读：`测试学生`；有账号＋在读：`测试学生2`；无账号＋无监护人＋在读：`QA-20260803-学员甲·无账号无监护人`；无账号＋无监护人＋历史报名：`QA-20260803-学员乙·历史报名`（`enrollments.status=completed`、`left_at` 已置，学生 `status=alumni`）。四人报名均落在 `QA-20260803-在读测试班`。
- [x] `DATA-17` 课次状态可覆盖 scheduled、ready、live/ended、post_pending、completed、cancelled 或 voided；不足状态通过同一测试课次线性推进，不伪造数据库行。
  脚本只写 `scheduled`：在读测试班 6 节课次按用途预留——`课次1·生命周期主线`（备课→行课→课后→完成）、`课次2·调课代课`、`课次3·取消恢复`、`课次4·作废`、`课次5·请假补课`、`课次6·备用`；筹备测试班 2 节。`started_at`／`ended_at`／`cancelled_by`／`voided_at`／`postwork_completed_at` 全部为空，ready 及之后的状态由 §6.4、§7 的真实动作推进。既有 `E系列数学一年级暑期S班[全国版]` 另有 6 节已结束课次可作只读对照。
- [x] `DATA-18` 一个已发布作业、一个未提交学生、一个已提交未批改学生、一个已批改学生。
  作业 `QA-20260803-作业·提交三态样本`（在读测试班，7 天后截止）：`测试学生` 已提交且已批改（88 分＋反馈），`测试学生2` 已提交未批改，`QA-20260803-学员甲` 未提交。**建立此项时命中 `BUG-R1M-001`：`insert into public.submissions` 必然被触发器拒绝，学生提交作业整条链路不可用；已修复（migration `20260803000100`）并回归，详见 §13.1。**
- [x] `DATA-19` 一个视频任务和一个待审视频；附件仅用无敏感信息的小型测试文件。
  视频任务 `QA-20260803-视频任务·待审样本` 挂在已结束课次「数方」（`E系列数学一年级暑期S班[全国版]`，`测试学生` 在读、`test-teacher` 主讲），选已结束课次是为了当轮就能走通「待审→审核」。待审视频 `note=QA-20260803-待审视频样本`，`reviewed_at` 为空；字节由既有 1.1 MB 测试上传在 `session-videos` 桶内复制，不引入新素材、不含真实人物。
- [x] `DATA-20` 一个知识总结、逐生课评、视频复盘和阶段报告链路可用的数据周期。
  对象学生 `测试学生`，周期取当前学期 2026-02-01～2026-08-31。已发布 head 覆盖 `knowledge_summary`（2 条，课次「突破进退位加减法」「排列中的枚举」）、`session_review`、`session_result`、`video_review`、`stage_report`（period 与学期一致），`missingKinds` 为空。只读盘点，脚本不新增成果。
- [x] `DATA-21` 一个可验证通知、work item、审批和 deep link 的跨角色事件。
  同一 deep link `/dashboard/classes/{在读测试班}` 上：work item `QA-20260803-跨角色事件·在读测试班待确认`（主管创建 → 教师 assignee，open）、审批 `QA-20260803-跨角色审批·测试班课次调整`（教师 requester → 主管 approver，pending）、站内通知 `classroom.staff.assigned`（收件人教师）。通知由插入 `domain_events` 后经 `stage_notification_for_domain_event()` 触发器生成，不直接写 `notifications`；`payload.datasetId` 用作幂等键。
- [x] `DATA-22` 如存在历史修复计划，仅将其作为审计样本；财务关闭期间不制造订单异常，也不执行订单修复。
  库内 2 条 `data_repair_plans`，同为 `order_status_recompute` v1、`target_object_type=order`、`impact_count=1`，状态分别 `executed` 与 `rolled_back`。本轮只读引用，脚本执行前已断言 `finance.enabled=false`，未新建、未执行、未 rollback 任何修复计划。

## 2. 第一轮：入口、认证、环境和路由

### 2.1 未登录、登录、注册与找回

- [x] `AUTH-01` 未登录访问 `/zh/dashboard`，跳转到 `/zh/login?next=...`；登录后返回原站内路径。
- [x] `AUTH-02` 未登录访问 classroom、whiteboard、studio 的深层路径，同样进入对应语言登录页，不泄露页面数据。
- [x] `AUTH-03` 正确邮箱和密码可登录；错误密码显示明确错误且不暴露账号是否存在。
- [x] `AUTH-04` `next` 使用站内路径时有效；外部 URL、协议相对 URL 和畸形值不能形成开放重定向。
      两个消费点各测一轮，共 21 例全部符合预期。登录 Server Action（`(auth)/actions.ts`，走无 JS 表单 POST）11 例：`/zh/dashboard/students`、`/zh/dashboard/students?status=on` 保留原值并保留 query；`https://example.com/`、`//example.com/`、`///example.com/`、`javascript:alert(1)`、`/en/dashboard`、`/zh`、`/dashboard`、`/zhang/dashboard`、无 `next` 字段共 9 例全部回落 `/zh/dashboard`，且 `Location` 一律是相对路径，无跨域跳转。回调路由（`auth/callback/route.ts`）10 例结论一致，另含 `/%2f%2fexample.com/` 编码绕过被拒；`/en/auth/callback` 侧对称验证 `/zh/dashboard` 回落到 `/en/dashboard`。
      附带确认：`?next=` 的值原样进入登录表单隐藏域（攻击链路真实存在，本项非空测），XSS payload `"><img src=x onerror=alert(1)>` 被 React 转义为实体，无 HTML 注入。
      跨 locale 的 `next` 一律回落是 `resolveSafeReturnTo` 按 locale 前缀比对的设计结果，不记缺陷。
      门禁补强：本项此前无任何自动化覆盖，已补 `tests/auth-safe-redirect.test.ts`（17 例，含「白名单通过的 `/zh//example.com/` 解析后仍同源」断言），后续回归不再依赖人工。
- [x] `AUTH-05` 登出后受保护页不可通过后退按钮或刷新继续读取；再次访问要求登录。
- [x] `AUTH-06` `/zh` 与 `/en` 登录、错误、忘记密码页面语言一致，URL 始终保留 locale。
- [x] `AUTH-07` 忘记密码提交后显示不枚举账号的成功态；恢复链接回到正确环境和语言。
      **成功态不枚举：通过。** 存在账号（`test-student`／`test-admin`）、不存在账号（`no-such-user-20260803@mathin.local`／`definitely-not-here@example.org`）四组提交的响应完全一致：`303`＋`Location: /zh/forgot-password?sent=1`＋body 1794 字符，无任何可区分内容。
      **恢复链接落点：`localhost` 与生产域名正常，局域网 IP 环境失效。** GoTrue（`gotrue:v2.189.0`）`URI_ALLOW_LIST` 实测：`https://mathin.club/**` 生效且完整保留深层路径与 `?next=`，`https://evil.example.com/` 被正确拒绝，`localhost`／`127.0.0.1` 经内建本地例外放行；但同在白名单里的 `http://192.168.5.213:3130/**` **不匹配**，一律回落到 `GOTRUE_SITE_URL=https://mathin.club`。因 `NEXT_PUBLIC_SITE_URL=http://192.168.5.213:3130`，本机验收时恢复链接会跳到生产站并丢失 `next`。验收此项请临时将 `NEXT_PUBLIC_SITE_URL` 设为 `http://localhost:3130`。生产侧 GoTrue 已验证接受 `https://mathin.club/{locale}/auth/callback?next=...`，上线后需实测复验一次。
      `Sev2` `requestPasswordRecovery`（`(auth)/actions.ts:88`）完全忽略 `resetPasswordForEmail` 的返回错误。实测 29 次请求中 12 次被 GoTrue 以 `429 over_email_send_rate_limit` 拒绝，页面仍每次显示"已发送"，合法用户会永远等不到邮件且无任何提示。向用户隐藏"该邮箱不存在"是刻意的反枚举设计，但限流与账号是否存在无关，应可安全地提示"请求过于频繁，请稍后重试"。
      `Sev3` 存在账号的响应耗时稳定高于不存在账号（交错取样 16 次零重叠：114–198ms vs 38–87ms），构成单请求即可分类的账号枚举时间旁路。根因在 GoTrue（不存在的账号直接返回、不进入发信路径），应用侧无法消除，缓解手段是接入层限流。
      `Sev3` `if (siteUrl)` 使 `NEXT_PUBLIC_SITE_URL` 缺失时静默跳过发信但仍显示成功态，找回密码会全线静默失效。应在启动期断言该变量，或至少纳入上线检查表。
      运维注意：固定测试账号使用不可投递的 `@mathin.local` 域名，触发邮件类操作会向 `mathinclub@qq.com` 产生退信，累积会损害发信信誉。验收邮件链路请改用真实可投递地址，或避免对测试账号触发发信。
      `Sev2`发送邮件后，应该重定向进入code输入页面，方便直接输入。
      `Sev3`忘记密码默认邮件语言未跟随 中英文切换
- [ ] `AUTH-08` 手机登录在服务可用时完成 OTP 请求与验证；未配置时显示具体不可用状态，不无限 loading 或假成功。
      `Sev3`手机号登录错误提示面板文案改成："抱歉，我们暂时还未配置手机号验证码登录功能，请使用邮箱验证注册。"
      `Sev1`手机号验证码登录页面无返回邮箱登录页面入口，且手机号验证码登录、账号密码登录应该是一个登录页面form中的可切换的两张登录卡。
- [ ] `AUTH-09` 注册邀请码关闭时不能注册；错误、过期或停用邀请码被拒绝。
      `Sev3`邀请码对应的所有提示删除"主管"相关描述。
      `Sev2`注册密码加入一个强制确认：二次输入密码和一次输入密码相同。      
- [x] `AUTH-10` 注册必须同时确认隐私政策与儿童个人信息保护政策；缺任一同意不能提交。
- [ ] `AUTH-11` 注册成功、邮箱确认和重复邮箱行为符合页面提示。此项需要新账号授权；未授权时记录 `BLOCKED`。
      `Sev2` 当前supabase未开启注册邮箱确认邮件，但预期也并没有做中英文切换模板。
- [ ] `AUTH-12` 锁定账号登录时看到“账号受限”状态和恢复入口，不进入普通 Dashboard。
      `Sev3` 账号受限提示不明显，受限用户很容易看不清下一步动作

### 2.2 使用环境与侧栏

- [x] `ENV-01` staff 账号进入 `/dashboard` 显示“今日工作”，不是学生/家长磁贴首页。
- [x] `ENV-02` student 账号进入 `/dashboard` 显示学习首页及学习侧栏。
- [x] `ENV-03` parent 账号进入 `/dashboard` 显示家庭首页及家庭侧栏。
      `Sev3`家长首页的磁贴"学生卡"显示内容不完整
- [x] `ENV-04` 未绑定家长只看到明确的绑定空状态，不显示空白页面或其他家庭数据。
- [x] `ENV-05` 双环境账号可在 staff/family 间切换；切换只改变工作环境，不改变岗位和数据库角色。
      `Sev3`双环境账号的使用环境将"工作台"改为"工作"，避免和仪表盘语义冲突。
- [x] `ENV-06` 切换环境后首页、侧栏、页面标题和数据范围同步刷新，不残留上一环境的 RSC/浏览器缓存内容。
- [x] `ENV-07` 手工提交账号不具备的目标环境时回到安全首页，不进入目标页面。
      绕过 UI 直接向 `setActiveEnvironmentAction` 提交伪造表单（`test-student` 可用环境仅 `learning`，`test-teacher` 仅 `staff`/`family`）：`student→staff`、`student→family`、`teacher→learning`，以及非法枚举值 `env=admin`、`env=` 空值，共 7 次提交全部 `303 → /{locale}/dashboard`，无一进入目标环境。连续 4 次越权提交后 `profiles.last_active_environment` 保持 `learning` 不变——**拒绝路径不写库**，前端隐藏按钮之外确有服务端复核（`environment-actions.ts:35`）。合法对照：`teacher→family` 与 `teacher→staff` 均成功并正确落库。`locale=en` 时回落目标同步变为 `/en/dashboard`。
      观察（非缺陷）：`envSchema` 的 `returnTo` 实测恒不生效，手工提交任何合法站内 `returnTo` 都仍落在 `/{locale}/dashboard`；`utility-sheet.tsx:113` 的真实表单也只发送 `locale` 与 `env`、从不发送 `returnTo`。即该字段目前是死代码，对本项而言结果只会更保守。
      数据变动说明：`test-student` 的 `last_active_environment` 原为历史遗留的无效值 `staff`（学生不具备该环境，读取侧由 `pickActiveEnvironment` 兜底），验证过程中被合法切换改为正确值 `learning`，未回填无效值；`test-teacher` 已复位为 `staff`。
- [x] `ENV-08` 桌面侧栏只显示当前权限允许的入口；移除权限并刷新后入口立即消失。
- [x] `ENV-09` 直接输入无权限页面 URL 时仍被拒绝或安全跳转；隐藏侧栏不是唯一权限控制。
      5 个角色 × 14 条权限门控路由（students／students/import／followups／classes／courses／courseware／courseware-assets／finance／staff／access-control／organization-settings／account-support／registration-settings／system-health）逐一直接请求：
      · `student`、`parent`：14/14 全部被拒并跳 `/zh/dashboard`，零渗透。
      · `sales`：students、students/import、followups、classes、courses 放行，其余 9 条被拒——与 sales 权限集一致。
      · `teacher`：students、followups、classes、courses 放行，`students/import`（需 `student.import`）与全部管理页被拒——与 teacher 权限集一致。
      · `admin`：14/14 全部跳 `/zh/dashboard/account-security?required=mfa`。经查 `auth.mfa_factors`，`test-admin` 已有 `totp/verified` 因子，因此这不是"未注册 MFA"，而是**密码会话只到 AAL1、未完成二次验证的管理员无法进入任何管理页**，属正确的强制升级门。
      · 未登录基线：`307 → /zh/login?next=%2Fzh%2Fdashboard%2Fstaff`（`proxy.ts` 乐观跳转）。
      方法说明：本项不能以 HTTP 状态码判定。页面壳先流式输出，权限 `redirect()` 发生在 Suspense 子树内，因此**被拒页面同样返回 `200`**；真实判据是响应体内的 `<meta http-equiv="refresh" content="1;url=...">` 跳转目标。后续回归请沿用此判据，勿用状态码。
- [x] `ENV-10` 任一页面只有一个侧栏项高亮；课程课件子路由、课次对象路由不会双重高亮或全灭。
- [x] `ENV-11` 手机侧栏可打开、滚动、点击并自动收起；所有可见入口均可达。
- [x] `ENV-12` 页面刷新、复制深链到新标签页、从通知进入时，当前对象和环境保持正确。

### 2.3 当前路由逐页烟测

下列路径均补 `/zh` 或 `/en` 前缀。动态 ID 必须从列表页点击取得，不手抄未知 UUID。

#### 员工与通用 Dashboard

- [x] `ROUTE-01` `/dashboard`：按当前环境显示正确首页。
- [x] `ROUTE-02` `/dashboard/coordination`：员工协同历史可打开。
- [x] `ROUTE-03` `/dashboard/schedule`：课表可打开，当前用户只能看到允许范围。
- [x] `ROUTE-04` `/dashboard/followups`：跟进队列可打开。
- [x] `ROUTE-05` `/dashboard/students`：学生集合可打开。
- [x] `ROUTE-06` `/dashboard/students/import`：导入工作流可打开。
- [x] `ROUTE-07` `/dashboard/students/{studentId}`：学生对象页可打开。
- [x] `ROUTE-08` `/dashboard/activities`：活动管理可打开。
- [x] `ROUTE-09` `/dashboard/classes`：班级集合可打开。
- [x] `ROUTE-10` `/dashboard/classes/new`：建班向导可打开。
- [x] `ROUTE-11` `/dashboard/classes/{classId}`：班级对象页可打开。
- [x] `ROUTE-12` `/dashboard/sessions/{sessionId}`：课次工作区可打开且自身页面不产生 window 滚动冲突。
- [x] `ROUTE-13` `/dashboard/courses`：课程产品库可打开。
- [x] `ROUTE-14` `/dashboard/courses/new`：课程产品向导可打开。
- [x] `ROUTE-15` `/dashboard/courses/{courseFamilyId}`：产品/版本工作区可打开。
- [x] `ROUTE-16` `/dashboard/courseware`：研发任务队列可打开。
- [x] `ROUTE-17` `/dashboard/courseware/review`：适配校对队列可打开。
- [x] `ROUTE-18` `/dashboard/courseware/preparation-review`：备课产物审核队列可打开。
- [x] `ROUTE-19` `/dashboard/courseware/lectures/{lectureId}`：讲次工作区可打开。
- [x] `ROUTE-20` `/studio/courseware/{lectureId}`：课件 Studio 可打开。
- [x] `ROUTE-21` `/dashboard/courseware-assets`：共享素材库可打开。
- [x] `ROUTE-22` `/dashboard/courseware-assets/{assetId}`：素材替换工作区可打开。
- [x] `ROUTE-23` `/dashboard/organization-settings`：机构设置可打开。
- [x] `ROUTE-24` `/dashboard/staff`：员工管理可打开。
- [x] `ROUTE-25` `/dashboard/access-control`：岗位权限矩阵可打开。
- [x] `ROUTE-26` `/dashboard/registration-settings`：注册邀请设置可打开。
- [x] `ROUTE-27` `/dashboard/account-security`：本人账号安全可打开。
- [x] `ROUTE-28` `/dashboard/account-support`：管理员支持可打开。
- [x] `ROUTE-29` `/dashboard/system-health`：系统运行状态可打开。
- [x] `ROUTE-30` `/dashboard/data-maintenance`：数据质量、修复和测试数据治理可打开。

#### 学生、家长与课堂

- [x] `ROUTE-31` `/dashboard/children`：家庭子女工作区可打开。
- [x] `ROUTE-32` `/dashboard/learning/classes`：学生班级集合可打开。
- [x] `ROUTE-33` `/dashboard/learning/classes/{classId}`：学生班级详情可打开。
- [x] `ROUTE-34` `/dashboard/coursework`：学生课务、考勤和请假可打开。
- [x] `ROUTE-35` `/dashboard/assignments`：学生/家庭任务列表可打开。
- [x] `ROUTE-36` `/dashboard/assignments/{assignmentId}`：任务详情与提交状态可打开。
- [x] `ROUTE-37` `/dashboard/progress`：学生成果与逐题学情可打开。
- [x] `ROUTE-38` `/classroom`：staff 兼容跳转到班级后台，student 跳到学习班级入口。
- [x] `ROUTE-39` `/classroom/{classId}`：教师与学生分别跳到自己的 canonical 班级页。
- [x] `ROUTE-40` `/classroom/{classId}/session/{sessionId}`：教师进入课次工作区，学生进入 live。
- [x] `ROUTE-41` `/classroom/{classId}/session/{sessionId}/live`：授权课堂成员可进入实时课堂。
- [x] `ROUTE-42` `/classroom/{classId}/session/{sessionId}/report`：授权成员可读取对应课堂报告。
- [x] `ROUTE-43` `/classroom/{classId}/assignment/{assignmentId}`：授权学生/教师可读取对应作业。
- [x] `ROUTE-44` `/whiteboard`：白板列表可打开。
- [x] `ROUTE-45` `/whiteboard/{boardId}`：白板对象可打开并按成员权限进入编辑/只读。

#### 关闭与历史地址

- [ ] `ROUTE-46` `/dashboard/finance` 不在任何侧栏；直接访问安全返回 Dashboard，页面不下发财务数据。
- [ ] `ROUTE-47` 旧地址 `/dashboard/work`、`/dashboard/videos`、`/dashboard/staff/roles`、`/dashboard/registration`、`/dashboard/operations`、`/dashboard/operations/testdata`、`/dashboard/adapt-review`、`/dashboard/curriculum/products`、`/dashboard/curriculum/lectures/{lectureId}`、`/dashboard/shared-assets` 返回 404，不静默落入错误页面。
- [ ] `ROUTE-48` 禁止的机械地址返回 404：`/dashboard/students/new`、`/dashboard/activities/new`、`/dashboard/staff/new`、`/dashboard/staff/add`、`/dashboard/access-control/new`、`/dashboard/sessions/new`、`/dashboard/courseware/lectures/new`、`/dashboard/courseware-assets/new`、`/dashboard/courseware-assets/upload`、`/dashboard/followups/new`、`/dashboard/children/new`、`/dashboard/assignments/new`、`/dashboard/finance/new`、`/dashboard/registration-settings/new`。
- [ ] `ROUTE-49` 动态路由使用畸形 UUID、其他班级的 session ID 或不匹配的 class/session 组合时返回 404/拒绝，不泄露对象是否存在。

## 3. 第二轮：今日工作、协同、通知与审批

### 3.1 今日工作

- [x] `WORK-01` “现在”只包含进行中、30 分钟内授课、24 小时内阻断教学或需要立即决定的事项，最多三个对象组。
      `Sev2`总览部分现在整个页面利用率、信息密度很低，需要大范围重构
- [x] `WORK-02` “我的工作”包含本人 owner/editor/校对人、主讲/助教/学辅、学生跟进人和审批责任项。
- [x] `WORK-03` “今天的安排”只显示时间事件，不重复普通截止任务。
- [x] `WORK-04` 有管理范围的账号看到无负责人、排课冲突、花名册异常、未来课件风险和久未推进委派项；普通教师不看到全校风险。
- [x] `WORK-05` now、overdue、today、upcoming、backlog 分桶符合时间，桶内显示可解释原因而非不可解释分数。
- [x] `WORK-06` 点击领域 work item 进入对应对象与操作位置；完成必须走领域动作，不能在通用层假完成。
- [x] `WORK-07` 标记已读只改变个人阅读状态，不改变领域状态。
- [x] `WORK-08` 稍后处理 6 小时/1/3/7/14 天后，真实 due date 不变；到期后重新出现。
- [x] `WORK-09` 置顶只改变同一紧急桶内顺序；取消置顶恢复稳定排序。
- [x] `WORK-10` 关注/取消关注、确认已知、刷新和跨标签页后的个人状态一致。

### 3.2 持久协同与轻审批

- [x] `COORD-01` 创建持久协同项时标题、描述、领域、来源、负责人、截止时间、优先级和原因均被保存。
- [x] `COORD-02` 相同幂等键重试不生成第二条协同项。
- [x] `COORD-03` 指派后接收人得到 direct 项，管理者看到 delegated/历史记录。
- [x] `COORD-04` 关闭协同项必须填写原因；关闭后不可再次当作未完成项出现。
- [x] `COORD-05` 请求审批后审批人看到申请，申请人看到等待状态。
- [x] `COORD-06` 审批人批准/拒绝必须保存决定与原因；重复决定被拒绝且原决定不变。
- [x] `COORD-07` 无审批权限或非指定审批人不能决定。
- [x] `COORD-08` 协同历史按对象展示创建、分派、决定和关闭顺序，操作者与时间正确。

### 3.3 站内通知与 deep link

- [x] `NOTICE-01` 通知铃显示未读数量、通知列表和任务入口；空状态明确。
- [x] `NOTICE-02` 点击单条通知后立即标记已读并进入正确 locale、对象、tab/stage 和锚点。
- [x] `NOTICE-03` “全部已读”只处理当前用户可见通知，不影响其他账号。
- [x] `NOTICE-04` 同一领域事件重试不产生重复通知。
- [x] `NOTICE-05` 提交审核通知审核人；退回通知作者；批准/发布/撤回通知对应角色。
- [x] `NOTICE-06` 作业、视频任务、知识总结、逐生课评和阶段报告通知使用具体标题，不显示笼统“系统状态已更新”。
- [x] `NOTICE-07` 学生和有效监护人收到发布/撤回/修订事件；失效监护关系不再收到。
- [x] `NOTICE-08` deep link 指向已撤回内容时显示明确失效状态，不展示旧正文或死链接。
- [x] `NOTICE-09` Realtime 正常时第二个已登录窗口无需整页刷新收到通知；断线恢复后可补齐。
- [x] `NOTICE-10` 通知投递失败不回滚已提交的领域事实，并能在 job/系统运行页追踪。

## 4. 第三轮：学员服务、家庭关系与活动

### 4.1 学生集合与学生对象页

- [ ] `STU-01` 学生列表搜索姓名/手机号片段、状态、跟进状态和更多筛选，清空筛选可恢复列表。
     `Sev2`学生列表无法使用手机号片段搜索
- [x] `STU-02` “我的学生”与“全部学生”范围符合 assigned/all 权限；教师/学辅不能通过 query 切到全量。
- [ ] `STU-03` 新建学生只创建最小线索档案；必填、长度、非法日期/枚举有中文和英文校验。
      `Sev2`现在新建学生没有必填项。
      `Sev2`电话长度没有做校验（第一版只考虑校验中国大陆地区手机号）
- [ ] `STU-04` 疑似重复时显示候选和判定依据；取消不创建，确认“仍然创建”只创建一次。
      `Sev2`点击候选后，返回，刚刚所填所有信息全部清空，如果不是重复会导致用户第二遍输入所有信息。
- [x] `STU-05` 学生对象页稳定显示基本资料、班级/账号摘要、下一次跟进，并能进入学习、跟进和视频数据。
- [ ] `STU-06` 编辑姓名、电话、生日、年级、学校、地区、来源、家长资料、备注后刷新仍一致。
      `Sev2`修改时应该实时保存，而不是点击保存资料后再保存
- [x] `STU-07` 未持有 `student.edit` 的账号看不到编辑动作，直接提交也被拒绝。
- [x] `STU-08` 分配负责人后新负责人可在 assigned 范围看到学生，旧负责人按权限失去或保留范围。
- [x] `STU-09` 状态变化符合允许转换；非法跳转、重复提交和过期页面提交给出明确结果。
- [x] `STU-10` 软删除有在读报名时被阻止；允许删除时列表消失，恢复后原稳定 ID 和历史回归。
- [x] `STU-11` 手机账号认领/绑定只针对当前学生；已绑定、非法手机号和重复请求有明确状态。
- [x] `STU-12` 丢失学生恢复和普通 restore 入口只对相应状态出现，不重复创建学生。

### 4.2 CSV 导入、重复与合并

> 本节证据：RPC 断言在自托管开发库以单事务执行后 `rollback`（`preview_student_import`／`apply_student_import`／`merge_students`，身份经 `set local role authenticated` ＋ `request.jwt.claim.sub` 模拟 admin/teacher/student），13 条断言全绿；客户端 CSV 生成与解析对 `ImportStudentsPanel.tsx` 中 `splitLine`／`parseInput`／`csvCell` 的函数原文求值实测。全程未在开发库落库。

- [x] `IMPORT-01` 模板下载包含版本和要求字段，中文 Excel 打开无乱码。
      模板首 3 字节 `EF BB BF`（UTF-8 BOM），Excel 不乱码；6 个字段齐全。
      `Sev3`版本只在文件名 `mathin-students-v1.csv` 与页面文案里，文件内容只有一行 `name,phone,grade,region,source,remark`：无版本行、无必填标注、无示例行，且表头是英文标识符而界面为中文。文件离开浏览器后无法自证版本。
- [x] `IMPORT-02` dry-run 展示总行数、有效、重复和错误数，不创建学生。
      11 行样本：`status=validated total=11 valid=1 dup=2 error=8 inserted=0`，学生数 5→5。
- [x] `IMPORT-03` 行号、字段和标准错误原因能定位空值、非法日期、超长文本、重复手机号等问题。
      逐行：`#1 EMPTY_NAME` `#2/#3 INVALID_GRADE` `#4 NAME_TOO_LONG` `#5 REMARK_TOO_LONG` `#6 PHONE_TOO_LONG` `#7 REGION_TOO_LONG+SOURCE_TOO_LONG` `#8 valid` `#9 DUPLICATE_PHONE`（批内 `139-0000-0106` 与 `13900000106` 归一化后同号）`#10 DUPLICATE_PHONE`（与库内既有学生同号）`#11 MALFORMED_ROW`。模板无日期字段，非法日期串 `2026-13-40` 落在 grade 列并按 `INVALID_GRADE` 报出。
- [x] `IMPORT-04` 只要存在错误，apply 写入 0 行；修复后重新 dry-run 才能应用。
      对含 8 个错误行的批次 apply 抛 `BATCH_HAS_ERRORS`，学生数 5→5，批次停在 `validated`，`inserted` 行 0。前端在文本框内容变化时重置 `idempotencyKey` 并清空批次，因此修改后只能重新 dry-run。
- [x] `IMPORT-05` 错误 CSV 可下载、UTF-8 正确且不包含密码/token。
      带 BOM；含逗号字段被引号包裹、内嵌双引号转义为 `""`；中文完整往返；字段仅 `line,status,error_codes` ＋ 6 个业务列，无密码/token/绑定码。
      `Sev3`该文件不能直接粘回文本框修复回流：表头首格是 `line` 不在 `HEADER_NAMES` 内，不会被当表头跳过，且前 3 列使所有业务列右移一位（`name` 读到行号、`phone` 读到状态）。另外 `parseInput` 先按换行切行再解析引号，备注里的引号内换行会被拆成两行。
- [x] `IMPORT-06` 相同 idempotency key + 相同内容返回同一批次；相同 key + 不同内容明确冲突。
      同 key 同内容返回同一 `batchId` 且批次实例数保持 1；同 key 异内容、同 key 异 `input_hash` 均抛 `IDEMPOTENCY_CONFLICT`；`templateVersion` 非 `mathin-students-v1` 抛 `INVALID_TEMPLATE`。
- [x] `IMPORT-07` 成功批次重复应用新增 0；页面显示创建/匹配/跳过统计。
      3 行干净批次首次 apply `inserted=2 dup=1`，学生数 5→7；重复 apply 返回 `status=completed inserted=2`，学生数仍 7（已完成批次直接返回快照，不再进入写循环）。统计经 `importSummary`/`importDryRunCounts` 展示，zh/en 均有文案。apply 完成即把 `data_import_rows.payload` 清空。
- [x] `IMPORT-08` 过期批次不能应用；原始行保留边界有明确提示。
      把批次时间线整体前移至过期后 apply 抛 `BATCH_EXPIRED`，学生数不变，批次仍为 `validated`；`purge_expired_data_import_payloads` 清空过期批次残留 payload（清后 0 行）。默认保留期 30 天写在 `expires_at` 默认值，前端文案 `importBatchExpired` 明确提示需重新验证。
- [x] `MERGE-01` 合并前列出疑似重复对象，并明确“保留当前学生”。
      同名同号候选 1 条、无关学生 0 条（判定依据为手机号去非数字后相等，或姓名 trim/lower 相等）；`mergeKeepsCurrent`／`mergeStudentConfirm` 明示保留当前档案且候选将变为不可用留痕。
- [x] `MERGE-02` 合并预览/确认只作用于选定两个 ID；取消不写入。
      合并期间旁观学生跟进 1→1、`deleted_at` 仍为 null、未进入 `student_merges`；确认走 `ConfirmDialog`，取消不触发 action。
- [x] `MERGE-03` 合并后报名、跟进、监护关系和历史归于保留 ID，来源学生不可继续作为独立对象使用。
      保留档案：跟进 1、报名 1、监护 1、余额 100/课时 8（来源账户合并后删除）；来源档案：监护 0、账户 0、`deleted_at` 已写入，且不再出现在重复候选中；`student_merges` 留痕 1 条并记录 `operated_by`。
- [ ] `MERGE-04` 无合并权限、跨范围目标和并发变化时拒绝，不能留下半合并状态。
      前两类正确拒绝：无权限学生账号 `FORBIDDEN`、无范围教师 `FORBIDDEN`、同一 ID `SAME_STUDENT`，被拒后来源档案 `deleted_at` 仍为 null、保留档案未收到任何迁移数据、无留痕。
      `Sev2 · BUG-R1M-004`并发变化不拒绝。两名员工分别停在 A、B 的学生页时，甲把 B 合并进 A 成功；乙的过期页面再把 A 合并进 B（B 已软删）**同样成功且不报错**，结果 A、B 同时 `deleted_at` 非空、两份数据全部堆到墓碑档案 B 上，正常列表里两个学生一起消失。`merge_students` 对 `p_kept_id`／`p_merged_id` 都不校验 `deleted_at`，`can_access_student` 也不过滤软删。详见 §13.1。

### 4.3 监护关系与范围

- [x] `GUARD-01` 员工为学生签发监护邀请时，可选择关系和允许范围；生成码不进入日志/截图。
- [ ] `GUARD-02` 家长使用有效绑定码并同意后绑定正确学生；无效、过期、已使用码被拒绝。
      `Sev1`现在生成新的邀请码无法让家长绑定孩子。会出现错误提示。
- [ ] `GUARD-03` 多子女家长切换使用稳定 student ID；刷新、通知 deep link 后仍显示目标孩子。
      `Sev2`多子女家长应该能稳定收到所有孩子的通知，而不仅是目标孩子
- [x] `GUARD-04` 可见范围分别控制课表、考勤、作业、成果等；未授权范围有明确状态，不泄露字段。
- [ ] `GUARD-05` 设为主要监护人和普通监护人的显示一致；更改范围写入操作者和时间。
- [x] `GUARD-06` 家长主动撤销关系需二次确认；撤销后立即失去孩子数据和后续通知。
- [x] `GUARD-07` parent A 直接访问 student B 的对象、作业、成果和通知 deep link 均被拒绝。
- [x] `GUARD-08` 未绑定家长可看到绑定入口，不能通过 query/旧缓存看到任何学生摘要。

### 4.4 跟进与活动

- [x] `FOLLOW-01` 跟进队列按状态/紧急桶分组，逾期天数和最新记录正确。
      销售账号看到逾期、今日、本周、未安排、今日试听、待续费、流失池 7 个桶；流失池可单独进入，流失学生显示“历史已流失 0 天”，各状态分组和空分组均有反馈。
- [ ] `FOLLOW-02` 搜索、展开/收起、全部展开和空分组行为稳定。
      `FAIL · BUG-R1M-005` `/zh/dashboard/followups` 未呈现搜索框、展开/收起或全部展开控件；本轮只能验证时间桶、状态分组和空分组文案。
- [ ] `FOLLOW-03` 新增电话/微信/到访等跟进，内容、下次跟进和状态变化保存到正确学生。
      `FAIL · BUG-R1M-006` 对“测试学生2”分别提交电话跟进和状态改为“跟进中”的记录，内容、类型和状态均持久化；填写 `2026-08-10T10:00`、`2026-08-11T09:30` 后，列表和学生详情均显示没有下次跟进时间。
- [x] `FOLLOW-04` “保持状态”不意外覆盖当前状态；指定状态后列表分桶同步变化。
      “状态不变”保存后未覆盖原状态；第二条记录指定“跟进中”后，学生详情显示 `跟进状态：跟进中`，跟进记录带 `→ 跟进中`。
- [x] `FOLLOW-05` 流失学生恢复需明确动作，恢复后历史跟进保留。
      对流失池中的 QA 学员先新增历史记录，再执行“回流”；学生从流失池回到“跟进中”，列表仍保留最近跟进内容。
- [ ] `FOLLOW-06` 教师只能看关系范围，学辅只能看分配范围，主管可看管理范围。
      `BLOCKED · 本次只完成销售账号的分配范围观察，未完成 teacher / all 三角色对照；当前证据不足以判定完整权限矩阵`。
- [ ] `ACT-01` 活动列表区分即将开始和历史，搜索/空状态正确。
      `SKIP · 本轮验证了即将开始/历史空状态以及销售无新建入口，但没有活动记录可实际验证搜索`。
- [ ] `ACT-02` 新建和编辑活动的标题、类型、时间、时长、地点、容量和备注校验正确。
      `FAIL · BUG-R1M-007` 主管可打开新建活动对话框并填写类型、标题、时长、地点、容量和备注；`datetime-local` 时间字段的显示值未提交到受控状态，失焦后清空，保存按钮持续禁用，因此未创建活动。
- [ ] `ACT-03` 给学生报名活动后人数更新；满员时拒绝超额报名。
      `BLOCKED · ACT-02 未创建活动，缺少可报名对象`。
- [ ] `ACT-04` 标记参加/未到和结果备注后刷新保留，重复操作不重复计数。
      `BLOCKED · ACT-02 未创建活动，缺少可登记对象`。
- [ ] `ACT-05` 只有 activity.manage 可编辑/删除，只有 activity.register 可登记；无权限动作被拒绝。
      `BLOCKED · 没有活动对象可验证登记、编辑和删除；仅观察到主管有“新建活动”，销售无该入口，尚不足以替代后端权限证据`。

## 5. 第四轮：课程产品、讲次、课件与素材

### 5.1 课程产品和版本

- [ ] `COURSE-01` 课程产品库按关键词、用途、年级、准备度筛选；结果数量和清空筛选正确。
      `FAIL · BUG-R1M-008` 在课程库搜索 `QA-20260803` 后点击“筛选”，即使 QA 课程产品存在，仍显示“没有匹配的课程产品”；清除筛选可恢复 2 个课程产品。现有的子课程筛选缺陷仍需产品化处理。
- [x] `COURSE-02` 新建产品向导保存标题、学科、学段、出版社、版次、说明、用途和 owner。
      三步向导保存了产品名、出版社、学段“小学”、学科“数学”、教材版本、说明、用途“测试”和 owner“测试-教研”；产品族 ID 为 `830665bc-03ec-407f-88e6-29a94349635a`。
- [ ] `COURSE-03` 可选择同时创建第一个版本；不创建版本时产品总览不擅自选择数据库第一条版本。
      `SKIP · 已验证勾选“顺便创建第一个课程版本”后首个版本与产品一并创建并打开；本轮未走不创建版本分支，不能确认总览不擅自选择第一条版本`。
- [x] `COURSE-04` product code、年级×季节×班型重复时明确拒绝，不生成半成品。
      对既有一年级暑期 A 版本尝试创建重复 code `QA-20260803-A`，页面提示“这个年级、季节与班型的组合已存在版本。”，未生成新版本。
- [x] `COURSE-05` 产品总览显示版本矩阵、准备度、风险和正在/曾经使用班级。
      新产品总览显示版本矩阵、准备度 `0/0` 和“尚无教学计划”风险；既有 QA 产品显示 2 个讲次、`0/2`、2 个使用班级及责任信息。
- [x] `COURSE-06` 从班级或任务携带版本进入时打开对应版本；返回保持原筛选和 returnTo。
      从 QA 班级 `?tab=sessions` 的课次链接进入对应 QA 讲次，地址携带 `returnTo`；点击“返回班级工作区”后回到原班级并保留 `?tab=sessions`。
- [x] `COURSE-07` 创建新版本的年级、季节、班型、标题和 code 校验正确。
      在新产品中创建一年级秋季 A 版本，名称和 code `QA-20260803-M02-AUT` 均按输入落库；版本 ID 为 `8df90a37-8b82-400d-94eb-44ef5e7f6b85`。
- [ ] `COURSE-08` 分配 owner/editor/reviewer 后责任来源和历史正确；移除责任不覆盖历史事实。
      `SKIP · 已观察测试产品 owner 与既有 QA 版本的责任信息；本轮未执行移除责任动作，不能确认历史事实不被覆盖`。
- [ ] `COURSE-09` 产品/版本生命周期动作只显示当前允许转换；非法/过期转换被拒绝。
      `SKIP · 已观察已启用版本的可用操作；本轮未提交非法或过期转换，不能确认拒绝行为`。
- [ ] `COURSE-10` 测试用途课程有清晰标记，不进入正式建班候选或生产统计。
      `SKIP · 已验证产品和版本显示“测试”用途/标记；本轮未打开建班候选或生产统计页`。

### 5.2 教学计划和讲次工作区

- [ ] `LECTURE-01` 浏览态教学计划无输入框、排序和逐行保存；“编辑教学计划”进入显式编辑态。
      `FAIL · BUG-R1M-010` 既有 QA 课程版本处于使用中时只显示浏览态教学计划，没有“编辑教学计划”入口；新建的空白测试产品可以进入编辑态，说明入口受上下文/状态影响。
- [ ] `LECTURE-02` 新增、改名、目标、上下移动和批量保存作为一次事务生效；刷新顺序稳定。
      `FAIL · BUG-R1M-009` 新产品编辑态可新增两讲、改名、填写目标并上下移动，但点击“保存更改”提示“操作失败，请重试”，未能完成批量保存；本轮取消对话框后刷新，新增讲次未持久化。
- [ ] `LECTURE-03` 页面过期后保存返回 stale/冲突提示，不覆盖另一窗口的新版本。
      `SKIP · 新讲次批量保存已失败，本轮未继续制造双窗口冲突`。
- [ ] `LECTURE-04` 归档讲次前展示对班级/课次的影响；停止新排课但保留历史使用。
      `BLOCKED · 既有使用中版本未提供教学计划编辑/归档入口；本轮未执行归档`。
- [ ] `LECTURE-05` 恢复讲次后重新进入可用列表，稳定 lecture ID 不变。
      `BLOCKED · 本轮未能先完成可保存的新讲次，也未执行归档`。
- [x] `LECTURE-06` 讲次工作区显示目标、owner、native/adapted 状态、当前校对轮次、release、使用班级和历史。
      E 系列讲次工作区显示讲次标题、教学目标、16:9/4:3 轨道、58 页、release 预览与页目录；课程版本页显示 owner/editor/reviewer、使用班级和历史状态。
- [x] `LECTURE-07` native/adapted 轨切换后预览、页数、release 和工作流均切到同一轨，不串轨。
      在第 1 讲预览中从 `16:9` 切到 `4:3`，URL 的 `track` 变为 `adapted-4x3`，页目录链接均切换到 adapted 轨，页数仍为 `1/58`。
- [ ] `LECTURE-08` 从课程产品、任务队列、班级和 Studio 返回时回到正确来源和上下文。
      `FAIL · BUG-R1M-014` 课程产品→任务队列→讲次工作区→Studio 的返回链接和轨道上下文可达；但讲次工作区“使用情况”中的 QA 班级链接进入 `/zh/dashboard/classes/5e0897eb-6c7d-4b8f-bc0f-30dd96b09804` 后显示“这里暂时出了点问题”，不能完成班级来源链路。
### 5.3 Studio 页面编辑与不可变 release

- [x] `STUDIO-01` 打开 Studio 后页面目录、画布、属性和发布信息可达；首屏无整页滚动冲突。
      在 E 系列第 1 讲的 `native-16x9` 与 `adapted-4x3` Studio 均看到 58 页目录、页级属性、页修订与讲 release；切换第 2/3 页后 URL 保留当前 track 与 page。1280×720 下 body 的滚动宽高均为 1280×720，无整页横向/纵向溢出。QA 测试讲次为 0 页时明确显示“还没有课件页，无法打开制作舞台”。
- [ ] `STUDIO-02` 新建空白页、复制页、跨讲复制、删除页、排序均作用于选定 lecture+track。
      `SKIP · QA 讲次没有可进入的制作舞台；E 系列为既有共享验收数据，本轮未执行写入型新增、复制、删除或排序`。
- [ ] `STUDIO-03` 正式模板页标题不可误改；教师/编辑者新建页按合同允许重命名。
      `SKIP · 只读打开页面目录和属性，未提交标题重命名`。
- [ ] `STUDIO-04` 文本/HTML、图层、位置、透明度、字体、字号、行高、背景等保存为新 draft revision。
      `SKIP · 本轮未修改 E 系列页面或创建可安全写入的 QA 页面`。
- [ ] `STUDIO-05` 无效 JSON、空选择、超长字段和并发 revision 显示明确错误，不损坏上个可用草稿。
      `SKIP · 未执行非法 JSON、超长字段或并发 revision 写入`。
- [ ] `STUDIO-06` 页面 revision 历史可预览；回退创建新草稿，不修改历史 revision。
      `SKIP · 当前页可预览 r1 修订，但没有制造第二个 revision，未执行回退`。
- [ ] `STUDIO-07` “需逐生检查”标记保存到页级草稿；未发布提示明确，发布后进入 release snapshot。
      `SKIP · 未修改检查标记或发布状态`。
- [ ] `STUDIO-08` 发布前有未保存内容时阻止或先要求保存；双击发布只产生一个 release。
      `SKIP · 未执行发布写入`。
- [ ] `STUDIO-09` 提交校对冻结当前页面 revision、binding、track、校验结果和说明。
      `SKIP · 未提交校对`。
- [ ] `STUDIO-10` 校对中普通编辑不能静默改变已提交快照；作者撤回后恢复编辑。
      `SKIP · 未创建校对中的可写测试快照`。
- [ ] `STUDIO-11` 校对人通过/退回并填写意见；退回页和总体意见在作者侧可见。
      `SKIP · 未执行通过/退回写入`。
- [ ] `STUDIO-12` 禁止自校时作者不能批准；允许自校时明确标记并保存审计。
      `SKIP · 未执行校对人权限分支`。
- [ ] `STUDIO-13` 完成要求轮次后进入待发布；没有发布权限的账号不能发布。
      `SKIP · 未完成校对轮次或发布权限负向测试`。
- [ ] `STUDIO-14` 紧急发布要求专有权限、原因和二次确认，并产生待跟踪风险。
      `SKIP · 未执行紧急发布`。
- [ ] `STUDIO-15` 正常发布生成下一不可变 release，track head 更新；旧 release 内容和 hash 不变。
      `SKIP · 未执行正常发布`。
- [ ] `STUDIO-16` rollback 生成受控状态变化，不删除历史 release；当前 head 指向预期版本。
      `SKIP · 回滚按钮在当前最新 revision 上不可用，本轮未执行整讲回滚`。
- [ ] `STUDIO-17` 已冻结/已开课/历史课次继续读取原 release，新发布不回写其快照。
      `SKIP · 未建立冻结/开课后的对照快照`。
- [ ] `STUDIO-18` H5、图片、音频、视频和公式抽样预览成功；H5 launch query 与资源路径保留。
      `SKIP · 本轮只验证页面目录、轨道和 revision 预览，未抽样各媒体类型`。
- [ ] `STUDIO-19` 16:9/native 和 4:3/adapted 同一讲独立发布，不共享错误的 current release。
      `SKIP · 观察到两条独立轨道入口和 release 信息，但未执行双轨发布`。
### 5.4 适配校对与共享素材

- [x] `ADAPT-01` 适配校对队列的待审、页面分类、release、返工和历史 tab 可切换。
      已验证“背景确认”“退回待修”“页面分类与编辑”“待发布讲次”“历史审计”五个 tab；背景/退回/待发布有明确空状态，历史 tab 显示只读审计记录。
- [ ] `ADAPT-02` 搜索、课程/讲次/分类筛选、分页和选择仅作用于当前结果集。
      `FAIL · BUG-R1M-011` 课程、讲次、A–F 分类筛选和分页可用，选择课程后结果从全量缩小为 186 项，再选讲次缩小为 14 项；但页面没有关键词搜索输入，无法完成清单要求的搜索动作。
- [ ] `ADAPT-03` 批量批准前显示目标数量；过期选项返回 stale，不部分误批其他页。
      `FAIL · BUG-R1M-012` 页面分类队列有结果（全量 34,584 项），但 DOM 中没有 checkbox、批量选择、批准或 stale 操作入口，无法进行批量批准。
- [ ] `ADAPT-04` 批量退回必须填写原因/说明，作者在返工队列可见。
      `FAIL · BUG-R1M-012` 同一队列没有批量退回按钮或原因输入，无法验证返工回写。
- [ ] `ADAPT-05` 页面分类变化后进入正确队列，native fallback 和视觉编辑路径正确。
      `SKIP · 观察到 D/A 分类与 adapted Studio 链接对应，但本轮未提交分类变化，也未验证 native fallback`。
- [ ] `ADAPT-06` 背景返工的 crop、输出尺寸、说明和新对象写入历史；原对象不被覆盖。
      `SKIP · 退回待修队列为空，未执行背景返工`。
- [ ] `ADAPT-07` adapted release 只允许发布全部就绪的讲次；阻断原因可定位到页。
      `SKIP · 待发布讲次为空，未制造未就绪讲次进行发布门测试`。
- [ ] `ASSET-01` 素材库按 query、类型、角色、轨道和最小使用量筛选，空状态正确。
      `FAIL · BUG-R1M-013` 类型、资源角色、画幅轨道和最少引用筛选控件均可见，类型筛选能改变结果；但输入可见资源名称“未命名资源”或首行哈希片段 `3beb04c9d455` 后均显示“没有符合条件的共享资源”，query 搜索不可用。
- [x] `ASSET-02` 素材详情展示使用树、冻结课次、当前预览和可选使用数量。
      资源详情显示当前发布图片、16:9/4:3 轨道、使用课程/讲次/页面树和“已选 1000/1000”；切到 4:3 后使用点呈“已独立固定”，预览哈希随轨道变化。
- [ ] `ASSET-03` 上传替换对象后先进入 staged，取消 staged 不改使用关系。
      `SKIP · 未上传替换文件`。
- [ ] `ASSET-04` 应用替换前显示新旧预览、影响数量和 release 隔离说明。
      `SKIP · 未创建 staged 替换`。
- [ ] `ASSET-05` 应用只替换选定轨道/使用点，不改历史 release 和冻结课次。
      `SKIP · 未应用替换`。
- [ ] `ASSET-06` rollback 恢复替换前 binding，并保留两次审计记录。
      `SKIP · 未创建替换审计`。
## 6. 第五轮：建班、花名册、排课与课次生命周期

### 6.1 建班与班级集合

- [x] `CLASS-01` 班级列表按 teaching/support/all/test scope 返回正确集合；不可用 scope 不能靠 query 获得。
      principal 的 all 视角显示 8 个班级；teacher 的 teaching 视角显示 5 个已分配任教/助教班；sales 的 support 视角显示 3 个责任班。sales 强行访问 `?scope=all` 仍只返回 1 个默认可见班，未扩大范围。
- [x] `CLASS-02` 关键词、用途、学期、年级、主讲、学辅、准备度、运营状态筛选和清空正确。
      通过班级列表等价 GET 筛选路由覆盖全部 8 项筛选：关键词 `q=QA-20260803` 共 2、年级 `grade=1` 共 3、主讲 `teacherId=b2c20fa8-cefd-42e0-a47c-8b493ad270d0` 共 5、学辅 `supportId=b892e3e4-9db1-487e-85cb-04f2f5033148` 共 3、当前学期 `schoolTermId=65fa0084-f7f3-470c-a941-bf1006f7897b` 共 5、运营状态 `planning` 共 1、用途 `test` 共 2、准备状态 `ready` 共 3；每次直接加载均只展示匹配班级，清空筛选沿用前轮已验证结果。
- [x] `CLASS-03` 建班向导按课程→信息→排课→确认推进，返回上一步不丢失已填数据。
      主管在未提交创建的测试班向导中填写临时班名、测试-教师、测试-学辅、容量 10、QA-A102、当前学期和周二排课；从排课返回班级信息、从班级信息返回课程步骤后，课程、测试用途、教师、学辅、容量、教室和排课规则均保留；再次推进到确认页，课程、教师、2 条课次、测试用途和冲突结果一致。
- [x] `CLASS-04` 选择课程版本后显示讲次数、ready/incomplete 数和生产准备度。
      测试用途选择 QA 课程版本后显示 `0/2` 课件已发布、两条讲次及每讲“未发布”，版本状态为“待完善”。
- [ ] `CLASS-05` 正式班必须有课程版本；自由班可以按明确合同创建，不伪装成正式课程班。
      `SKIP · 向导区分“正式班/测试班/自由建班”，既有自由班也显示“自由班（无课程）”；本轮未提交正式班或自由班创建`
- [ ] `CLASS-06` 名称、用途、容量、主讲、学辅、学期、教室、时长、开始日、星期和时间校验正确。
      `SKIP · 前轮编辑班级容量为 0 时提示“输入有误，请检查后重试”；本轮在未提交的测试班向导中使用 QA 测试课程、临时班名、测试-教师、教室 QA-A102、当前学期和周二排课，容量为 0 可推进到确认页，但最终创建动作被服务端校验拒绝并显示“创建失败，请检查填写内容后重试”；名称回退、学辅、时长、开始日、时间及其余非法边界未完成全量覆盖`
- [ ] `CLASS-07` 冲突预览能识别教师/教室时间重叠；返回冲突对象和时段。
      `FAIL · BUG-R1M-020` 建班预览使用 QA 班主讲测试-教师、教室 QA-A102、2026-08-04 周二 12:27、90 分钟；该时段已有 QA 课次 1（同一教师/教室），确认页仍显示“未发现主讲教师时间冲突”，也没有教室冲突对象。
- [x] `CLASS-08` 测试班不能误激活为正式班；风险提示和确认边界明确。
      测试班在确认页持续显示“测试”，并提示“测试班可带未完成课件启用；请确认这是隔离测试用途”；未勾选“创建后立即启用”不会改变用途。
- [ ] `CLASS-09` 重复点击创建只生成一个班和一组课次；失败不留下半个班。
      `SKIP · 本轮没有提交创建动作`
- [ ] `CLASS-10` 新建后进入班级对象页，课程、教师、学辅、学期、课次数量一致。
      `SKIP · 未提交新建班级`
- [ ] `CLASS-11` 测试班批量归档显示选中数量；只处理测试 scope，部分失败逐行报告。
      `SKIP · 未执行批量归档`
- [ ] `CLASS-12` 批量取消归档恢复选定班级，不影响未选中或正式班。
      `SKIP · 未执行批量恢复`

### 6.2 班级对象与生命周期

- [x] `CLASS-13` 顶部显示班名、生命周期、课程版本、主讲、学辅、人数、下一课和唯一主动作。
      P4 班对象页显示班名“测试班-P4”、进行中、课程版本、主讲/学辅、在读人数 `2/10`、下一课和“设置”主动作。
- [x] `CLASS-14` 课次、学生、教学准备、运营记录四个稳定区域可切换，刷新保留 query/tab。
      P4 班的 `sessions/students/readiness/records` 四个 query tab 均可直接打开，刷新后仍保留当前 tab。
- [x] `CLASS-15` 课次按下一课、需处理、未来、已结束、已取消分组；主体进入完整课次，行尾只做快速管理。
      QA 在读班显示“下一课/需要处理/未来课次”；P4 显示“下一课/已结束”；QA 课次 3 取消后进入“已取消（1）”，每行同时提供完整课次链接和“快速管理”链接。
- [x] `CLASS-16` 学生行始终进入学生对象页，不因角色不同跳到其他系统。
      teacher 与 sales 的花名册中，测试学生和测试学生2均链接到 `/zh/dashboard/students/{studentId}`，returnTo 保留班级 tab。
- [x] `CLASS-17` 教学准备显示默认轨道、后续讲次 release、教师备课和未发布/退回风险。
      P4 准备状态显示全班默认 `16:9 原生版`、下一讲“备课中/已发布”；QA 筹备班显示两讲未发布风险。
- [ ] `CLASS-18` 修改班名、容量、教室等基础信息后刷新一致，非法值被拒绝。
      `SKIP · 已验证容量 0 被拒绝且原值未写入；未提交合法修改并刷新对账`
- [ ] `CLASS-19` 分配/移除主讲、助教、学辅后班级范围、今日工作和通知同步更新。
      `SKIP · 责任分工弹窗显示主讲/助教/学辅及添加/移除控件；未提交责任变更`
- [ ] `CLASS-20` planning→active 前检查课程版本、主讲、学期、未来课次和合法时间。
      `SKIP · 筹备班设置页可进入“启用班级”，但未实际确认状态转换`
- [ ] `CLASS-21` 缺 4:3 release 不阻止使用 native 默认轨；缺 native release 显示强风险。
      `SKIP · 只读观察默认轨道切换，未制造缺轨 release 数据`
- [ ] `CLASS-22` 有课件风险时允许经确认激活，并生成研发 alert；不能静默忽略。
      `SKIP · QA 筹备班确认前明确提示“2 讲存在未发布的课件修改”，但本轮取消确认，未验证确认后的 alert`
- [ ] `CLASS-23` active→completed→archived 只走允许转换；历史报名、课次和成果保留。
      `SKIP · 未提交班级结束/归档`
- [ ] `CLASS-24` 未使用 planning 班可移到回收站并恢复；有历史/在读关系时危险动作被阻止或明确提示。
      `SKIP · 只观察到筹备班的回收站入口，未执行移入或恢复`
- [ ] `CLASS-25` 班级默认 native/adapted 轨可切换；课次级 override 可设置/清除，且只影响该课次，不回写课程或其他课次。
      `SKIP · 已观察班级默认轨道下拉框与课次冻结说明，未提交班级或课次级轨道变更`

### 6.3 花名册与学生变动

- [ ] `ROSTER-01` 搜索学生后入班，年级、账号、欠费摘要、考勤、请假、提交等信号显示正确。
      `FAIL · BUG-R1M-015` P4 花名册实际只显示学生姓名及“未进教室”（teacher 还显示转班/退班按钮），没有年级、账号、欠费、考勤、请假或提交摘要。
- [ ] `ROSTER-02` 重复入班、超过容量、无权限、已退班和不匹配课程等情况有明确结果。
      `FAIL · BUG-R1M-016` 在报名弹窗搜索已在班的测试学生并再次点击“报名”，只收到通用“操作失败，请重试”，没有明确“已在班/重复报名”结果。
- [ ] `ROSTER-03` 转班选择目标后，原班历史保留、未来归属按业务规则转移，目标班花名册更新。
      `SKIP · 未提交转班`
- [ ] `ROSTER-04` 退班保留报名历史；不能从历史课次、成果和审计中消失。
      `SKIP · 未提交退班`
- [ ] `ROSTER-05` 花名册异常/复合异常在班级和今日工作可见；修复后消失。
      `SKIP · 已观察班级列表/课次分组中的异常与待处理数量，未完成一次异常修复后的消失对账`
- [x] `ROSTER-06` 教师只见所教班，学辅只见责任班，主管/教务按权限见全量。
      teacher 的 teaching 视角为 5 个班，sales 的 support 视角为 3 个责任班，principal 的 all 视角为 8 个班；sales 通过 `scope=all` 仍未越权扩大集合。

### 6.4 学期、课表和课次快速管理

- [ ] `SCHED-01` 周课表上一周、今天、下一周正确；跨月、跨年和机构时区无日期偏移。
      `SKIP · 已补测本周 8/3–8/9、跨月周和跨年周 2027/1/4–1/10，日期标题与空周恢复正常；当前环境未切换机构时区，时区边界仍未取得证据`
- [x] `SCHED-02` staff 可按班级、教师、教室筛选；学生/家长只读本人/孩子范围。
      staff 周课表实际选择班级 `QA-20260803-在读测试班`、教师 `测试-教师`、教室 `QA-A102` 后均只保留匹配课次，并恢复为“全部”；student/parent 既有验证仍仅显示本人/孩子课次且无内部筛选。
- [x] `SCHED-03` 当前时间线、重叠冲突和自由班标记正确；无课程明确显示空状态。
      既有周课表已观察时间线、19:00 重叠展示和自由班课次；本轮连续切换至 2027/1/4 周，明确显示“这一周没有排课”并保留日期时间线，随后恢复今天。
- [x] `SCHED-04` 390/768/1024/1440px 下日历内部可滚动、表头 sticky，window 不产生双滚动。
      依次使用 390/768/1024/1440px 宽（720px 高）复核：四个尺寸 document 均无横向溢出；390/768/1024px 的课表内部保留 820px 内容宽度并可横向滚动，1440px 下内容适配无需横向滚动；四个尺寸均存在 sticky 表头/列元素，未出现 window 双滚动。
- [ ] `SCHED-05` 学期创建的名称、学年、学期、起止日校验；激活后全站当前学期一致。
      `SKIP · 只观察建班向导使用“2026 春季学期 · 当前”，未创建或激活新学期`
- [ ] `SCHED-06` 点击课次打开快速抽屉，抽屉只包含时间地点、代课、调课、取消/恢复/作废和完整课次入口。
      `FAIL · BUG-R1M-018` 课表/班级快速抽屉的“打开完整课次”对既有 QA 家庭学习旅程课次 `661dedc1-553e-4b8b-9218-a744b2db3a72` 进入通用错误页；同一抽屉的时间地点、取消/恢复等控件可见。
- [ ] `SCHED-07` 调课前显示教师/教室冲突；保存后课表、班级页、课次页和通知一致。
      `SKIP · 未提交调课`
- [ ] `SCHED-08` 选择代课教师并填写原因；教师范围和今日任务切换到代课人，历史主讲不被覆盖。
      `SKIP · 主管代课弹窗显示教师单选列表和原因字段，未提交保存`
- [x] `SCHED-09` 未开始课次可取消并填写原因；恢复后重新进入正确分组。
      QA 课次 3 提交原因“R1 手测取消恢复验证”后 toast 显示“课次已取消”，课次进入“已取消（1）”；点击恢复后 toast 显示“课次已恢复”，重新回到未来课次。
- [ ] `SCHED-10` 未开始课次删除只在允许条件出现；开始后不能物理删除。
      `SKIP · 快速管理只观察到取消/恢复/作废，不足以证明删除边界`
- [ ] `SCHED-11` 作废要求专有权限和原因；作废后事实保留，不当作已完成课次统计。
      `BLOCKED · principal/teacher 的“作废”按钮均为 disabled；registrar 账号因必要同意缺失被拦在账户与安全页，未能取得专有权限路径`
- [ ] `SCHED-12` 取消、恢复、作废和调课的重复点击/旧页面提交不产生重复事件。
      `SKIP · 已观察首个取消请求提交后按钮暂时 disabled，未制造旧页面或重复提交`

### 6.5 请假、补课和考勤

- [ ] `LEAVE-01` 学生/家长从允许的未来课次提交请假；过晚、已开始、无关系时被拒绝。
      `SKIP · parent 为 QA 课次 5 提交未来请假并成功；未覆盖过晚、已开始和无关系拒绝`
- [x] `LEAVE-02` 教务/学辅收到具体通知和 work item，可批准、拒绝并填写意见。
      teacher 在课次 5 课前页看到测试学生的原因“R1 手测请假审批验证”及“批准/驳回”，点击批准后显示“已处理请假请求”。
- [ ] `LEAVE-03` 批准请假后原课次状态和考勤视图一致；拒绝不生成补课。
      `SKIP · 已完成批准分支，未执行拒绝分支及原课次/考勤/补课的完整对账`
- [ ] `LEAVE-04` 跨班补课只可选择符合条件的未来课次；保存后双方课次和家庭门户一致。
      `SKIP · 家庭门户显示既有补课已安排，未在本轮新建跨班补课`
- [ ] `LEAVE-05` parent A 不能为 student B 请假或选择不属于授权范围的补课。
      `SKIP · 未执行本轮浏览器越权操作`
- [ ] `ATT-01` 点名默认名单完整，出勤状态和备注可保存；未点名时课堂控制受限。
      `FAIL · BUG-R1M-019` QA 课次 1 候课页提示名单“2 人”，打开点名却列出 3 人（含“QA-20260803-学员甲·无账号无监护人”）；点名状态按钮、备注和未完成时“开始上课” disabled 均可见。
- [ ] `ATT-02` 补登记考勤要求操作者、原因和时间；旧记录不被无痕覆盖。
      `FAIL · BUG-R1M-017` P4 已结束课次打开“补登记出勤”后只有每名学生的状态按钮和可选“备注”，没有必填原因字段；页面说明会记录操作者和时间，但不能证明原因被强制留存。
## 7. 第六轮：备课、行课与课后闭环

### 7.1 课前工作区与备课档案

- [x] `PREP-01` 进入课次课前阶段即显示三步生产流程，不出现多余“开始备课”决策页。 — QA 课次直接显示“研读试做/教案设计/磨课定稿”。
- [x] `PREP-02` 左侧研读试做/教案设计/磨课定稿切换只替换生产表单；右侧目录和 4:3 预览常驻。 — 切换到教案设计、磨课定稿后右侧目录与预览仍在。
- [x] `PREP-03` 主区固定在视口剩余高度，左栏和长目录各自内部滚动；标题、工具、预览和翻页始终可达。 — 1280×720 下左侧表单、课件目录和预览均可见并有独立滚动区。
- [x] `PREP-04` 上一页/下一页按钮、方向键、PageUp/PageDown、空格调用同一翻页结果。 — 在 55 页既有课件第 1/2 页之间逐项验证上一页/下一页、ArrowRight/ArrowLeft、PageDown/PageUp、空格，均切换到同一下一页/上一页状态。
- [ ] `PREP-05` 上传照片/PDF 解析记录时客户端压缩、大小/MIME 错误、进度、失败和重试反馈正确。 SKIP · 未上传文件。
- [ ] `PREP-06` 上传解析或标准教案后自动保存并进入 pending 审核，审核人实时收到具体通知。 SKIP · 未提交审核产物或触发通知。
- [ ] `PREP-07` BlockNote 标准教案按 `mathin-teaching-plan-v1` 模板创建，自动保存图标和 revision 正确。 SKIP · 已核对页面标题提示中的 `mathin-teaching-plan-v1`、模板内容和自动保存提示；页面未呈现 revision，未完成刷新后的 revision 持久值对账。
- [ ] `PREP-08` 教案显式提交审核；待审核时作者可撤回并恢复草稿。 SKIP · 未改变固定课次审核状态。
- [ ] `PREP-09` 磨课网盘链接合法性校验正确；删除链接不留下虚假完成状态。 SKIP · 未写入磨课链接。
- [ ] `PREP-10` 第一阶段教师可按课次选择审校人并允许本人；选择和流程切换在同一上下文。 SKIP · 仅查看候选人，未保存选择。
- [x] `PREP-11` 审核人从专用队列打开产物，与真实课件并排审阅，并可按稳定 page_doc_id 直达页。 — 备课审核队列打开既有“需修改”解析记录，页面同时展示课件页列表、解析 revision 与导出预览；“定位此页编辑”进入带 `prepPage=c0edcab2-b4e5-4c0a-a12c-05a2e7d44997` 的课前编辑路由。
- [ ] `PREP-12` 审核通过/要求修改保留 revision、审核人、时间和意见；修改再保存生成下一 revision。 SKIP · 未执行审核状态流转。
- [ ] `PREP-13` 课件页板书保存 Vector Stroke，刷新后位置、颜色、粗细和对象层不漂移。 SKIP · 未新增或刷新保存板书。
- [ ] `PREP-14` 板书生成解析记录；4:3 合成预览与导出的 1920×1440 WebP 内容一致。 SKIP · 未生成解析或导出 WebP。
- [ ] `PREP-15` 上传来源解析可下载原件；板书来源解析导出 WebP；两者来源标记不混淆。 SKIP · 未上传或下载解析产物。
- [ ] `PREP-16` 备课页可直接切换本课逐生检查页，点击即自动保存。 SKIP · 未保存逐生检查页切换。
- [ ] `PREP-17` 取消默认检查页、增加空白课件页后标记、恢复正式默认和一次撤销均正确。 SKIP · 未改动课件页清单。
- [ ] `PREP-18` 明确保存空清单后刷新仍为空，不偷偷重新继承 release 默认。 SKIP · 未保存空清单。
- [ ] `PREP-19` 复制同讲次历史备课生成独立 session-local 快照；release 不同时展示差异。 SKIP · 未复制备课。
- [ ] `PREP-20` 完成备课前检查解析、教案、磨课审核和至少一个检查项；缺项时指出具体阻断。 SKIP · 只观察到未点名/未准备的课堂阻断，未完成完整备课检查。
- [ ] `PREP-21` 完成备课固定 release、track、页面顺序、binding 和检查清单；新 release 不自动替换。 SKIP · 未完成备课冻结。
- [ ] `PREP-22` 无 release 走临时空白课堂时必须填写原因，生成异常且不回写正式课程。 SKIP · 未进入无 release 临时课堂。
- [ ] `PREP-23` 冻结/开课/结束后课前档案仍完整只读，不被一行提示替代。 SKIP · 既有 P6-5 课次显示补改提示，未做组织开关对照。
- [ ] `PREP-24` 打开“课后可补改备课档案”组织开关时，只允许任课教师改当前课次快照；关闭后立即恢复只读。 SKIP · 未切换组织开关或角色写入。
- [ ] `PREP-25` 补改课次快照产生追加事件，不改正式 release、PageDoc 和课次审校人。 SKIP · 未执行补改。
- [ ] `PREP-26` 板书 WebP 下载前记录同一 Blob 的 hash、字节数、资源和操作者；重复下载只增加下载审计，不改解析内容。 SKIP · 未下载板书 WebP。

### 7.2 实时课堂

- [x] `LIVE-01` 未点名/未准备/未开始时进入课堂显示对应限制和主动作，不假装上课中。 — 教师页显示“第一步：完成点名”，点名为主动作，“开始上课”禁用；候课人数差异复用 `BUG-R1M-019`。
- [ ] `LIVE-02` 教师开课后学生端可进入；非成员、主管、教务、学辅不能因此加入实时频道。 SKIP · 教师未开课，未执行开课后跨角色频道边界。
- [ ] `LIVE-03` 教师翻页后学生端同步；断线短时重连后收敛到最新页，不重复领域事件。 SKIP · 未开课或执行断线恢复。
- [ ] `LIVE-04` native/adapted、doc、白板、图片、视频、H5、游戏页面均可切换且无跨页动画残留。 SKIP · 未进入可执行的完整实时课堂。
- [ ] `LIVE-05` 教师端显示页面目录、主课件、副板书、学生列和工具；折叠面板停靠右侧。 SKIP · 仅观察候课/学生端，未在开课态核对教师控制器。
- [x] `LIVE-06` 学生端默认只显示本人学情；按需展开同学不泄露内部评价。 — 学生端默认显示“测试学生”，展开后只增加同学姓名，不显示内部评价。
- [ ] `LIVE-07` 教师控制视频/H5 时学生端隐藏原生控制并防误触；声音启用提示明确。 SKIP · 未进入视频/H5 实时页。
- [ ] `LIVE-08` 副板书跟随教师；学生暂停跟随后可平移/缩放，再恢复到教师最后落笔区域。 SKIP · 未执行跨端板书跟随操作。
- [ ] `LIVE-09` 插入临时白板、媒体或游戏不回写正式课件 release；本课会话中顺序一致。 SKIP · 未插入课堂临时页。
- [ ] `LIVE-10` 主/副板书的笔、橡皮、颜色、粗细、清空和撤销只作用于目标画布。 SKIP · 未操作双画布。
- [ ] `LIVE-11` 举手/放下、题目打开/关闭、选择和 tally 在对应角色同步，未采集事件不显示为 0。 SKIP · 未执行跨角色互动。
- [ ] `LIVE-12` Realtime 不可用时显示 offline/local 状态，教师操作进入离线队列并可恢复补发。 SKIP · 观察到“本地/离线/局域网待配对”状态，但未执行离线队列恢复。
- [ ] `LIVE-13` 同一离线事件重放不产生重复点名、星数或课次事件。 SKIP · 未执行离线事件重放。
- [ ] `LIVE-14` 已标记课件页自动切到对应检查项；未标记页、媒体页和白板页保持当前检查项。 SKIP · 未建立实时逐生检查项。
- [ ] `LIVE-15` 逐生检查状态覆盖 explained/independent/prompted/imitated/incomplete/unchecked，默认 unchecked。 SKIP · 未进入实时逐生检查。
- [ ] `LIVE-16` 批量登记、清空和退出批量模式只作用于已选学生/检查项。 SKIP · 未进入批量登记。
- [ ] `LIVE-17` 20 座位在横屏 5×4、竖屏 4×5；不足人数显示空座，不把学生卡异常放大。 SKIP · 未进入 20 座位布局。
- [ ] `LIVE-18` 拖动学生到空座并保存后跨课次保持；名单变化时旧布局保存被整体拒绝并提示重新打开。 SKIP · 未保存座位布局。
- [ ] `LIVE-19` 键盘和触控均可登记，状态有颜色之外的文本/无障碍名称，触控目标至少可用。 SKIP · 观察到“出勤/缺勤/迟到/请假”文字按钮，未完成键盘与触控双路径。
- [ ] `LIVE-20` 1280×720、1024×768、768×1024 和常用 iPad 横竖屏无横向页面溢出、遮挡和不可达操作。 `FAIL · BUG-R1M-021` 试讲课堂壳在 1280×720、1024×768、768×1024、1194×834、834×1194 均无 document 横向溢出；但 1024×768 与 1194×834 时，课件底部控制条（上一页/下一页/页面列表/更多）落在视口底部之外，内层滚动容器有 `scrollHeight > clientHeight` 却未被 PageDown/页面滚动推进，视觉上出现底部控件被裁切。
- [ ] `LIVE-21` 结束课堂需二次确认；结束后教师进入同课次课后阶段，学生不能继续写课堂事实。 SKIP · 未结束或重开固定课次。
- [ ] `LIVE-22` 教师给单个学生加星、撤销星数后，教师端、学生本人和课后汇总一致；撤销不能减成负数。 SKIP · 未修改星数。
- [ ] `LIVE-23` 教师打开独立展示窗后，展示窗只跟随课堂状态，不获得控制器动作或内部学生操作。 SKIP · 未打开展示窗。
- [ ] `LIVE-24` 误结束后仅授权教师可重新打开课堂；重开不重置页、星数、答题、学情和已保存事件。 SKIP · 未执行误结束与重开。
- [ ] `LIVE-25` 课堂报告只把点名、星数和教师检查项当正式事实；举手/电子作答未采集时显示“未采集”，不显示 0。 SKIP · 未生成新的课堂报告。

### 7.3 课后发布、作业、视频和逐生卡

- [x] `POST-01` 课后顶部先显示知识总结、正式作业、视频任务三个独立面板，互不依赖。 — 已结束 P4 课次页面同时显示三个独立面板，作业/视频未发布不影响知识总结区。
- [x] `POST-02` 知识总结从版本化模板新建或复制历史 note，BlockNote 编辑和自动保存正常。 — 既有 P4 课后页点击“使用模板”后状态由“正在自动保存”回到“草稿已自动保存”；重新打开同一课后路由仍保留三段默认 BlockNote 内容，未发布。模板契约为 `mathin-knowledge-summary-v1`。
- [ ] `POST-03` 知识总结未填写逐生课评也可保存和发布；发布不触发作业或视频任务。 SKIP · 未保存或发布知识总结。
- [ ] `POST-04` 正式作业标题、说明和截止时间校验后发布；刷新后发布数量和状态正确。 SKIP · 未发布作业。
- [ ] `POST-05` 视频任务可先保存草稿再独立发布；重发不产生重复任务。 SKIP · 未保存或发布视频任务。
- [ ] `POST-06` 学生卡同时展示出勤、星数、逐题学情、课评和跟进，不重复整页通用任务面板。 SKIP · 观察到学生卡、出勤/星数、课评和跟进入口，未核对逐题学情与完整刷新结果。
- [ ] `POST-07` 逐生课评逐卡输入并自动保存；刷新、切换学生和快速连续输入不丢最后内容。 SKIP · 未输入或保存逐生课评。
- [ ] `POST-08` 逐生课评可独立发布/重发，不依赖知识总结。 SKIP · 未发布逐生课评。
- [ ] `POST-09` 跟进记录可提交或按允许规则跳过，正确指派给教师/学辅。 SKIP · 仅观察到逐生跟进输入、“提交跟进”和“本课无需跟进”，未保存。
- [ ] `POST-10` 作业提交列表区分未提交、已提交、已批改；教师只能批改本班。 SKIP · 未打开提交列表或批改。
- [ ] `POST-11` 学生提交文本、照片/PDF附件；数量、类型、大小、压缩、失败和重试符合提示。 SKIP · 未执行学生提交。
- [ ] `POST-12` 学生再次提交时明确显示 resubmit，不产生多个当前提交。 SKIP · 未执行二次提交。
- [ ] `POST-13` 教师评分和反馈保存后学生/家长可见；内部备注不进入客户端投影。 SKIP · 未评分或跨端复核。
- [ ] `POST-14` 视频上传显示进度并校验 MIME/大小；断点/失败可重试，不产生孤儿可见记录。 SKIP · 未上传视频。
- [ ] `POST-15` 视频审核保存分数和意见；未审视频不能发布 video_review。 SKIP · 观察到视频审核“标记完成/跳过”入口，未上传或审核视频。
- [ ] `POST-16` 删除视频需要授权并同步状态；历史审核/事件按合同保留。 SKIP · 未删除视频。
- [ ] `POST-17` 每项课后任务的 required、assigned_to、status、completed_by、completed_at 正确。 SKIP · 仅观察到 P4 课次 4 项待完成提示，未完成任务或核对审计字段。
- [ ] `POST-18` 全部 required 完成前不能“完成本次课”；完成后进入 completed。 SKIP · 未点击固定课次“完成本次课”以避免改变持久状态。
- [ ] `POST-19` 重新打开课后只恢复必要任务，不重复创建作业、通知或成果。 SKIP · 未完成后重开课后。
- [ ] `POST-20` 已完成课次重新打开课后后回到 post_pending，既有课评、作业、成果和完成历史保留。 SKIP · 未执行完成后重开。
- [ ] `POST-21` 家庭通知/回访接收人按 pending→sent→confirmed 或 failed/waived 合法转换；非法逆转和重复确认被拒绝。 SKIP · 未触发通知或回访状态机。

## 8. 第七轮：学习成果、阶段报告和客户门户

### 8.1 成果状态机

- [ ] `RESULT-01` 知识总结、逐生课评、视频复盘和阶段报告各有独立 head/revision，不互相阻塞。
- [ ] `RESULT-02` draft 自动保存但 student/parent 不可读；员工列表显示正确状态。
- [ ] `RESULT-03` 需要审核的成果提交后进入 review，并通知可处理审核人。
- [ ] `RESULT-04` 审核退回恢复 draft，作者看到具体意见；修改再提交产生下一 revision。
- [ ] `RESULT-05` 发布后 student/parent 立即可读且收到具体通知；发布失败不显示假成功。
- [ ] `RESULT-06` 撤回必须填写原因，立即从 student/parent 投影消失，通知 deep link 显示撤回状态。
- [ ] `RESULT-07` 编辑已发布来源后进入 revised 并立即退出对外投影；旧 revision 仍可审计。
- [ ] `RESULT-08` 重新发布创建新 revision；旧通知不错误展示新内容。
- [ ] `RESULT-09` 双窗口同时编辑时 revision 冲突被识别，后提交者不能静默覆盖。
- [ ] `RESULT-10` 自动保存 pending 时点击提交/发布会先冲刷最新内容。

### 8.2 阶段报告证据工作台

- [ ] `REPORT-01` 学生学习页默认展示日期范围内的已上课学情、作业和视频证据，而非报名/未来课次等非核心信息。
- [ ] `REPORT-02` 未选择/新建报告时编辑器不常开；点击新建或编辑后打开双栏工作区。
- [ ] `REPORT-03` 左栏编辑，右栏查看证据；关闭编辑器回到报告列表且草稿不丢。
- [ ] `REPORT-04` 日期范围变化后课评、作业、视频统计和明细同步更新；边界日按机构/校区时区。
- [ ] `REPORT-05` 证据区区分未采集、未批改、待审和真实 0；不把缺数据当成零。
- [ ] `REPORT-06` 标题、总结、教师评语自动保存；保存中/已保存/失败/重试反馈准确。
- [ ] `REPORT-07` 指标 ID `mathin-learning-report-v1` 在中文/英文界面显示本地化名称。
- [ ] `REPORT-08` revision 固定保存 metric_version、data_cutoff_at、timezone、周期和生成数据集快照。
- [ ] `REPORT-09` 发布后新增源数据不改历史报告；新 revision 才能使用新数据。
- [ ] `REPORT-10` 草稿→审核中→退回→修改→再提交→发布→撤回→修订→再发布全链状态正确。
- [ ] `REPORT-11` 提交审核和退回均产生具体通知并指向正确报告；无重复通知。

### 8.3 学生门户

- [ ] `LEARN-01` 首页显示下一课、待办作业、学习记录入口，不显示员工内部对象。
- [ ] `LEARN-02` 学生班级入口使用 `/dashboard/learning/classes`，旧 `/classroom` 只做兼容跳转。
- [ ] `LEARN-03` 班级页展示教师、近期/历史课次、已发布任务和逐题学情；草稿不可见。
- [ ] `LEARN-04` 课务页展示本人课表、考勤、请假/补课状态；其他学生数据不可见。
- [ ] `LEARN-05` 作业/视频任务列表和详情可完成动作，完成后状态在首页、列表和通知一致。
- [ ] `LEARN-06` 学习记录展示已发布知识总结、逐生课评、视频复盘、阶段报告和逐题检查。
- [ ] `LEARN-07` 已撤回、revised 未重发和其他学生成果均不可见。
- [ ] `LEARN-08` 学生直接访问 student B 的 assignment/result/class/session 被拒绝且不泄露标题。
- [ ] `LEARN-09` 学生打开本人已审视频使用受控签名访问；其他学生、过期链接和撤回内容不可播放。

### 8.4 家庭门户

- [ ] `FAMILY-01` 首页和子女页显示当前选择的孩子、下一课、考勤、请假/补课、作业和成果入口。
- [ ] `FAMILY-02` 切换孩子后所有卡片、URL 参数、deep link 和通知聚焦一致，不串孩子。
- [ ] `FAMILY-03` 家长可查看允许范围内的课表、考勤、作业状态和已发布成果。
- [ ] `FAMILY-04` 家长不能替学生提交作业或视频，除非产品界面明确提供被授权动作。
- [ ] `FAMILY-05` 家庭摘要不含草稿、内部评语、审校意见、其他家庭联系方式或不必要 PII。
- [ ] `FAMILY-06` 监护关系变为 pending/撤回/过期时有独立状态，不显示空列表假装没有数据。
- [ ] `FAMILY-07` 财务关闭时家庭侧栏无财务，旧账单 deep link 安全回首页且不下发数据。

## 9. 第八轮：机构、员工、权限、账号支持与平台

### 9.1 机构、校区和规则

- [ ] `ORG-01` 机构名称、默认时区等基础资料保存后刷新一致，并记录操作者。
- [ ] `ORG-02` 新建/编辑校区，启用状态和校区时区生效；非法时区或空名称被拒绝。
- [ ] `ORG-03` 校区教室新建、停用和恢复后，建班/课表候选同步变化；历史课次仍显示原教室。
- [ ] `ORG-04` 节假日创建、归档后排课预览使用生效版本；历史日历不被无痕改写。
- [ ] `ORG-05` 校区学期创建、激活和日期边界正确；同一 scope 的当前学期唯一。
- [ ] `ORG-06` calendar、lesson、scheduling、notification、finance、public_publishing 六个规则域可创建未来生效版本。
- [ ] `ORG-07` 规则历史显示 version、生效时间、原因和操作者；rollback 创建新版本，不删除历史。
- [ ] `ORG-08` Feature Flag 历史、未来生效和 rollback 正确；未启用能力 fail-closed。
- [ ] `ORG-09` email/sms/wechat 未配置供应商时保持关闭；不能仅打开 flag 造成假成功。
- [ ] `ORG-10` `teaching.preparation_archive_edit` 打开/关闭只影响课后备课档案补改能力。
- [ ] `ORG-11` `finance.enabled` 控件禁用并明确“1.0 安全关闭”；创建/回滚版本都不能开启。
- [ ] `ORG-12` 没有 organization.settings.manage 的员工看不到页面且直接 action 被拒绝。

### 9.2 员工、岗位与权限

- [ ] `STAFF-01` 员工列表显示姓名、邮箱、身份、岗位和启用状态；不显示密码/token。
- [ ] `STAFF-02` 精确邮箱查找已有账号；不存在时不暴露更多账号信息。
- [ ] `STAFF-03` admin 可将已有账号提升为 staff 并授予岗位；非 admin 的限制明确。
- [ ] `STAFF-04` 给员工增加/移除多个岗位后，权限并集和侧栏立即生效。
- [ ] `STAFF-05` 系统岗位不可删除；自定义岗位可新建、重命名和在无人使用时删除。
- [ ] `STAFF-06` 权限矩阵保存 57 个当前权限键的选择，不接受未知权限键。
- [ ] `STAFF-07` `permission.configure` 等高危权限只由允许主体配置，不能通过自助提权。
- [ ] `STAFF-08` 停用员工前展示学生、未来代课、班级和工作项交接数量。
- [ ] `STAFF-09` 选择替代员工后停用，未来责任转移、历史负责人保留、现有会话撤销。
- [ ] `STAFF-10` 不指定替代人时有未交接责任则阻止或形成明确异常，不静默丢任务。
- [ ] `STAFF-11` 最后有效管理员不能被停用；操作者不能通过普通入口破坏自己的必要管理能力。

### 9.3 注册邀请、本人安全和管理员支持

- [ ] `SEC-01` 注册邀请码的 code/active 保存后 signup 页同步；非法 code 被校验。
- [ ] `SEC-02` 本人修改密码要求两次一致和最低规则；旧密码会话行为符合 Supabase 配置。
- [ ] `SEC-03` 撤销其他会话后其他浏览器失效，当前会话保留。
- [ ] `SEC-04` TOTP 注册显示二维码/secret 并完成 6 位验证；错误码不通过。
- [ ] `SEC-05` 管理员未达到 AAL2 时被引导到账号安全页，不能进入高权页面。
- [ ] `SEC-06` 管理员不能移除最后一个已验证 MFA；普通用户移除后状态刷新正确。
- [ ] `SEC-07` 隐私/儿童政策显示版本和 granted/withdrawn/missing；同意变化追加记录。
- [ ] `SEC-08` 用户可发起 access/correct/export/restrict/delete 权利请求；同类未结请求去重。
- [ ] `SEC-09` 支持人员按精确邮箱查找目标，必须填写原因才能撤销会话、发送恢复或封禁/恢复。
- [ ] `SEC-10` 封禁/恢复、恢复邮件、会话撤销均进入支持审计；无 reason 时写入 0。
- [ ] `SEC-11` 员工邀请一次性、带到期时间；撤销后不可认领，重复待处理邀请被拒绝。
- [ ] `SEC-12` 用户权利请求必须先身份核验，再批准/处理；非导出请求完成要求证据 hash。
- [ ] `SEC-13` export 请求批准后才能生成 artifact；主体本人下载，支持人员只看元数据。
- [ ] `SEC-14` 导出到期或清理后不可下载；下载次数、hash、字节数和审计同步更新。
- [ ] `SEC-15` 学生导出只含本人允许范围；家长导出不含孩子联系方式、生日和学习明细；员工只含本人岗位。

### 9.4 系统运行、文件和数据治理

- [ ] `OPS-01` 系统运行页显示 jobs pending/running/dead、失败通知、待清理文件和 roster mismatch。
- [ ] `OPS-02` dead-letter 展示 kind、尝试次数和失败原因；人工重放要求权限并产生审计。
- [ ] `OPS-03` 同一 dead job 重放不会重复领域副作用；成功后状态和 worker 统计更新。
- [ ] `OPS-04` email/sms/wechat/webhook 渠道显示 provider 未选择/disabled，不显示可用假象。
- [ ] `OPS-05` 文件策略显示 bucket、访问级别、TUS/协议、最大尺寸和保留期。
- [ ] `OPS-06` worker last_seen、处理/失败数可理解；没有 worker 时显示明确空状态。
- [ ] `DQ-01` audit.view 可看最近质量扫描；无 system.operations.manage 时不能触发扫描。
- [ ] `DQ-02` 扫描结果显示规则集版本、快照时间、rules/findings hash、总数和严重度。
- [ ] `DQ-03` 0 finding 显示 clean；超过 200 条显示截断，不假装全量。
- [ ] `DQ-04` 同一数据快照重复扫描结果稳定；扫描不自动修改业务数据或产生通知噪音。
- [ ] `REPAIR-01` 历史修复计划只显示必要审计元数据：能力、恢复边界、影响数量、hash、状态和事件；不泄露已关闭财务正文。
- [ ] `REPAIR-02` 财务关闭期间不能新建、执行或 rollback 订单状态修复；旧页面、旧请求和直接 action 均被关闭门拒绝。
- [ ] `REPAIR-03` 学生合并、课件替换 rollback 和测试数据清理分别从对应领域 UI 操作，不出现可任意写表的通用修复入口。
- [ ] `REPAIR-04` 无 system.operations.manage 的账号只能查看允许的审计元数据，不能通过构造 plan ID 执行或回滚。
- [ ] `PURGE-01` 零引用课件报告只显示授权范围和真实使用计数。
- [ ] `PURGE-02` testdata purge 只列出测试对象；确认时再次显示精确对象和影响范围。
- [ ] `PURGE-03` 无 testdata.purge 权限不能执行永久清理；普通 audit.view 只能查看。
- [ ] `PURGE-04` 本轮若执行 purge，只处理本轮 QA 对象，并验证无法误选正式课程/班级。

### 9.5 财务 1.0 安全关闭

- [ ] `FIN-CLOSE-01` staff、admin、sales 和 parent 侧栏均无财务入口。
- [ ] `FIN-CLOSE-02` 直接访问 `/dashboard/finance` 安全返回首页且浏览器响应不含订单/支付/账户正文。
- [ ] `FIN-CLOSE-03` 机构设置的财务开关禁用，创建版本和 rollback 都不能开启。
- [ ] `FIN-CLOSE-04` 今日工作、协同、审批和通知中无可操作 finance 项。
- [ ] `FIN-CLOSE-05` 系统运行页无可新建/领取 finance job；历史 finance 事件仅按审计权限存在。
- [ ] `FIN-CLOSE-06` 学生对象页和家庭门户不显示余额、订单、欠费操作或财务导出。
- [ ] `FIN-CLOSE-07` 历史 finance deep link 不泄露数据，不出现“开关关闭但表格已加载”的闪烁。
- [ ] `FIN-CLOSE-08` 数据维护页不能通过订单质量 finding 进入预览、执行或 rollback 财务修复；审计元数据与可操作入口明确分离。

## 10. 第九轮：白板、跨设备和失败恢复

### 10.1 白板

- [ ] `WB-01` 新建白板后列表出现，标题可编辑，刷新后保留。
- [ ] `WB-02` 笔、橡皮、颜色、粗细、指针、形状、填充、直尺、圆规、量角器可操作。
- [ ] `WB-03` 选择、移动、复制、删除对象，撤销顺序正确；对象层与笔迹层不串。
- [ ] `WB-04` 清空明确提示目标范围并二次确认；取消不写入。
- [ ] `WB-05` 导出 PNG 尺寸和内容正确，透明/背景符合界面说明。
- [ ] `WB-06` 启用邀请、复制链接、关闭邀请后，新访客访问状态立即变化。
- [ ] `WB-07` owner 可把成员切为编辑/只读并移除；普通成员不能管理权限。
- [ ] `WB-08` 只读成员看得到内容但不能落笔、清空、邀请或保存快照。
- [ ] `WB-09` 两个账号同时打开时笔迹、对象和远程光标同步；断线重连后最终快照一致。
- [ ] `WB-10` 非成员直接访问 board ID 被拒绝；删除后旧链接不可继续读取。

### 10.2 网络失败、重复与并发抽样

- [ ] `FAIL-01` 每个领域至少抽一个写操作，在离线/超时下不显示假成功，恢复后可明确重试。
- [ ] `FAIL-02` 每个核心发布动作抽样双击：课程 release、作业、视频任务、成果、通知均只产生一次事实。
- [ ] `FAIL-03` 两窗口编辑同一课程、课次教案、课评和阶段报告时，冲突有明确提示。
- [ ] `FAIL-04` 上传中刷新/离开页面，已完成对象可恢复，未完成对象不变成公开孤儿。
- [ ] `FAIL-05` Server Action 返回 validation/forbidden/conflict/stale 时，中文和英文都有可行动提示。
- [ ] `FAIL-06` 浏览器后退、前进和刷新不会重复 POST，也不会把已完成状态恢复为旧 UI。
- [ ] `FAIL-07` 通知/job 外部副作用失败时，领域事务保持成功并能最终重放。

## 11. 第十轮：双语、布局、键盘与可访问性

### 11.1 双语

- [ ] `I18N-01` `ROUTE-01`～`ROUTE-46` 在 `/zh` 和 `/en` 均可打开，标题、导航、空状态和操作不硬编码单语。
- [ ] `I18N-02` 日期、时间、金额、数字和状态在两种语言下本地化；稳定 ID 不直接当用户文案。
- [ ] `I18N-03` 每类写操作至少触发一次成功和一次失败；toast、dialog 和错误页均有两种语言。
- [ ] `I18N-04` 从 `/en` 页面执行保存、取消、返回和 deep link 后仍停留 `/en`，不会回落 `/zh`。
- [ ] `I18N-05` 指标版本、六个学情状态、成果状态、课次状态、课程校对轮次均有中英文可读名称。

### 11.2 断点与滚动

- [ ] `UI-01` 390、768、1024、1280、1440、1920px 抽样关键页，无阻断横向溢出、遮挡或不可达操作。
- [ ] `UI-02` 普通 Dashboard 页面由 main 单区滚动；schedule/session/lecture/asset 等 panel 工作区只在内部区域滚动。
- [ ] `UI-03` 对象栏、tab、命令面板、返回和主动作在滚动后仍保持正确层级，不互相遮挡。
- [ ] `UI-04` Dialog、Sheet、Drawer 在手机上可滚动到最后操作；关闭后焦点回到触发元素。
- [ ] `UI-05` 长中文/英文标题、长学生名、长课程名、空值和 20/30 人名单不撑破布局。
- [ ] `UI-06` light/dark 下表格、输入、状态色、课件、4:3 板书区和错误文字对比清晰。
- [ ] `UI-07` 工作区保留纸色/星夜/字体/线宽和单个品牌锚点；表格、表单、实时控制内无叙事装饰干扰。

### 11.3 键盘与无障碍

- [ ] `A11Y-01` 登录→侧栏→列表→对象→Dialog→保存的核心路径可只用键盘完成。
- [ ] `A11Y-02` 图标按钮、通知铃、状态键、拖拽手柄、翻页和移动端菜单有可读 accessible name。
- [ ] `A11Y-03` 表单错误与字段关联，toast 之外页面内也能理解失败原因。
- [ ] `A11Y-04` Dialog/AlertDialog/Sheet 焦点被约束，Esc 行为正确，背景不可误操作。
- [ ] `A11Y-05` 当前侧栏、tab、选中状态、展开状态和学情状态不只依赖颜色。
- [ ] `A11Y-06` `prefers-reduced-motion` 下非必要动画停用；课堂和课件操作仍完整。
- [ ] `A11Y-07` 关键页面运行 axe 抽查，serious/critical 问题为 0；问题记录具体 route 和 DOM 证据。

## 12. 最终跨角色连续旅程

这些旅程必须使用同一组对象贯穿，不能把不同页面各自的 happy path 拼成“已闭环”。

- [ ] `JOURNEY-01` 主管：今日工作→发现无负责人/风险→进入对象→分配责任→接收人获得任务→主管保留委派观察→对象推进后关闭。
- [ ] `JOURNEY-02` 教研：课程产品→版本教学计划→讲次 Studio→制作→提交 1 校→通过/退回→发布 native/adapted→旧 release 不变。
- [ ] `JOURNEY-03` 教务：创建/选择课程→建 planning 班→分配教师/学辅→排课冲突检查→入班→激活→调课/代课→历史可查。
- [ ] `JOURNEY-04` 教师：今日工作→下一课→三步备课→产物审核→检查项→完成并冻结→点名→行课→结束→课后闭环→完成课次。
- [ ] `JOURNEY-05` 学辅：学生/家庭上下文→课前通知→请假处理→跨班补课→缺勤/服务任务→回访记录→领域动作关闭。
- [ ] `JOURNEY-06` 学生：登录→下一课→进入课堂→查看知识总结/课评→完成作业→上传视频→查看反馈和阶段报告。
- [ ] `JOURNEY-07` 家长：安全绑定/切换孩子→查看课表/考勤→提交请假→收到补课/成果通知→打开具体 deep link→撤回后立即失效。
- [ ] `JOURNEY-08` 管理员：AAL2→机构配置→邀请/权限→账号支持→系统运行→数据质量→审计，所有高危动作有原因与记录。
- [ ] `JOURNEY-09` 越权：student B、parent B/unbound parent、无关 teacher、sales 分别尝试读取本旅程对象，正文数据返回 0。
- [ ] `JOURNEY-10` 失败恢复：在一次上传、一次自动保存、一次通知和一次课堂实时操作中制造短暂失败，恢复后无数据丢失和重复副作用。

## 13. 缺陷记录模板

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 |  |
| 对应检查项 |  |
| 角色/环境/locale |  |
| route 与对象类型 |  |
| 前置数据 |  |
| 最短复现步骤 |  |
| 期望结果 |  |
| 实际结果 |  |
| 是否可稳定复现 |  |
| 数据是否已写入 |  |
| 是否存在越权/泄露 |  |
| 截图/视频/请求 ID |  |
| 处理决定/owner |  |

### 13.1 本轮已记录缺陷

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-001` / `Sev1` |
| 对应检查项 | 建立 `DATA-18` 时命中；影响面覆盖 `POST-10`～`POST-13`、`LEARN-05`、`NOTICE-06`、`JOURNEY-06` |
| 角色/环境/locale | student（提交）与 staff（收通知）；自托管开发库；与 locale 无关 |
| route 与对象类型 | `/dashboard/assignments/{assignmentId}`、`/classroom/{classId}/assignment/{assignmentId}`；`public.submissions` |
| 前置数据 | 任一已发布作业 ＋ 任一有账号的在读学生 |
| 最短复现步骤 | 学生打开作业详情提交内容（`submitAssignment` → RPC `submit_assignment` → `submit_assignment_for_student` → `insert into public.submissions`） |
| 期望结果 | 提交写入，教师端出现 `assignment.submitted` 通知 |
| 实际结果 | 数据库抛 `column reference "classroom_id" is ambiguous`，插入回滚，提交永远失败 |
| 是否可稳定复现 | 是，100%；直接 `insert into public.submissions` 即可复现，与 RLS、角色无关 |
| 数据是否已写入 | 否，整个事务回滚 |
| 是否存在越权/泄露 | 否 |
| 截图/视频/请求 ID | 复现与修复后验证均为 psql 事务（`begin; insert …; rollback;`），无截图 |
| 根因 | `notify_family_learning_change()` 的 submissions 分支把 `classroom_id`／`student_id` 同时用作 plpgsql 变量名与被查询表（`classroom_members`、`student_guardians`）的列名；PostgreSQL 默认 `variable_conflict=error`，触发器在计划阶段即报错。assignments 分支因为全部用 `new.` 限定而未受影响，所以「发布作业」正常、「提交作业」必失败 |
| 处理决定/owner | 已修复并合入 `db9e14e`（migration `20260803000100_r1_fix_submission_notification_ambiguity`）：局部变量改 `v_` 前缀消歧，收件人、事件类型、payload 与 deep link 不变；同批删除带同一歧义且已被 `notify_leave_request_roles_r1()` 取代的 `notify_leave_request_change()`。回归：插入成功且产生 `assignment.submitted` 事件；`pnpm ci:checks` 14/14、`pnpm r1:test` 98/98 通过。R1-14 需补一条覆盖「学生提交作业」的自动化断言，防止同类触发器歧义再次只在人工阶段暴露 |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-002` / `Sev2`（工程门禁不可执行，非产品缺陷） |
| 对应检查项 | `AUTO-03` |
| 角色/环境/locale | 执行者本机（Windows）＋ 自托管开发库；与角色、locale 无关 |
| route 与对象类型 | 无路由；`scripts/run-{r1,p4e,p4h,p6}-db-audit.mjs` |
| 前置数据 | 无 |
| 最短复现步骤 | 在开发机执行 `pnpm r1:db-audit` |
| 期望结果 | 12 个 R1 SQL 断言在明确的开发/一次性库执行并给出结论 |
| 实际结果 | `DATABASE_URL is required for r1:db-audit`，exit 2；门禁一次都跑不了 |
| 是否可稳定复现 | 是。四个脚本只读 `process.env.DATABASE_URL`（不加载 `.env.local`）并调用本机 `psql -f`；开发机无该变量、`which psql` 亦为 not found，自托管库运行在 `xiaomi` 的 `supabase-db` 容器内 |
| 数据是否已写入 | 否，未执行任何 SQL |
| 是否存在越权/泄露 | 否 |
| 截图/视频/请求 ID | 终端输出见 §0.4 `AUTO-03` |
| 根因 | 脚本只实现了 CI 的 `DATABASE_URL`＋本机 psql 一条通道。R1-5/R1-7/R1-8 证据记录的「通过 SSH/psql 执行断言」是手工绕过脚本完成的，这条断层从未补进脚本 |
| 处理决定/owner | 已修复并合入 `d801c16`：抽出 `scripts/lib/db-audit-runner.mjs`，新增 `SUPABASE_DB_SSH` 通道（与 `db:types` 的 `SUPABASE_META_SSH` 同构），断言文件从 stdin 透传给容器内 psql；CI 的 `DATABASE_URL` 通道不变，psql 非零退出码经 ssh 原样返回（已用 `select 1/0` 实测 exit=3），并输出失败文件名。四个 db-audit 均已在开发库通过 |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-003` / `Sev1`（安全门禁静默假通过，非产品缺陷） |
| 对应检查项 | `AUTO-03`、`AUTO-04` |
| 角色/环境/locale | 断言内模拟 student/parent/admin；任意库；与 locale 无关 |
| route 与对象类型 | 无路由；`supabase/tests/r1_export_artifacts_assertions.sql`（R1-7E 用户权利导出泄漏门） |
| 前置数据 | 任何非 `ci:db-rebuild` 夹具库 |
| 最短复现步骤 | 对开发库执行该断言文件 |
| 期望结果 | 逐条校验导出内容不含其他学生数据、不含内部字段，或明确报告无法校验 |
| 实际结果 | 报 `R1_EXPORT_EXCLUSION_MANIFEST_MISSING`；而在此之前的 4 条泄漏检查已经全部「通过」——它们并没有检查任何东西 |
| 是否可稳定复现 | 是 |
| 数据是否已写入 | 否，文件以 `rollback` 结尾 |
| 是否存在越权/泄露 | 未发现真实泄露；风险在于该门禁在 artifact 缺失时会把「未检查」报告成「已通过」 |
| 截图/视频/请求 ID | 终端输出见 §0.4 `AUTO-03` |
| 根因 | 两处环境耦合叠加：①文件硬编码 `supabase/ci/10_fixtures.sql` 的夹具身份 UUID（`…0004`/`…0005`），开发库中 `测试-学生` 为随机 UUID，取不到 artifact；②取不到时 `payload` 为 NULL，其后 `payload not like '%…%'` 全部求值为 NULL 而非真，`if` 不成立，四条泄漏断言静默放行。另有两处按 `user_id` 的全量计数（`R1_SUBJECT_DOWNLOAD_NOT_AUDITED` 期望恰好 1 条）会把开发库既有的历史导出记录误判为失败 |
| 处理决定/owner | 已修复并合入 `d801c16`：身份与 artifact id 改经事务级 GUC 传入（psql 变量不会插值进 dollar-quoted 的 DO 体，只能走 `set_config`/`current_setting`）；artifact 缺失时立即 `raise`；两处计数收敛到本次事务产生的 artifact。CI 夹具使用同一批 `测试-*` display_name，`\gset` 解析结果不变，CI 行为不受影响——该结论需下次推送由 CI `database` job 实测确认。R1-14 应把「断言在目标对象缺失时必须失败而不是静默通过」纳入门禁自检 |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-004` / `Sev2` |
| 对应检查项 | `MERGE-04`；影响面波及 `MERGE-03`、`STU-10`、`STU-12`（恢复入口） |
| 角色/环境/locale | 任意持 `student.edit` 且对两个学生都在范围内的 staff/admin；自托管开发库；与 locale 无关 |
| route 与对象类型 | `/dashboard/students/{studentId}` 的 `StudentMergePanel` → `mergeStudentsAction` → RPC `merge_students`；`public.students` |
| 前置数据 | 两个互为疑似重复的在读/线索学生 A、B（同手机号或同姓名） |
| 最短复现步骤 | 员工甲在 A 的学生页把 B 合并进 A；员工乙的浏览器停留在 B 的学生页（候选列表已在挂载时取好，不会重取），点击“合并到当前档案”，即发出 `merge_students(kept=B, merged=A)` |
| 期望结果 | 第二次合并被拒绝（来源或保留档案已软删／已被合并），提示对方档案已变化并要求刷新 |
| 实际结果 | 第二次合并成功返回，无任何错误。A 被软删，A 的跟进、报名、监护、账户余额全部迁移到已软删的 B；实测 A、B `deleted_at` 均非空，B 上聚合了两份跟进与 500 元余额，而两个学生都从正常列表消失 |
| 是否可稳定复现 | 是，100%。直接 `select public.merge_students(B, A)`（B 已软删）即可复现，与 RLS、角色无关 |
| 数据是否已写入 | 是（复现在 `begin; … rollback;` 事务内，开发库未落库）。数据未物理删除，可经恢复入口找回，但需要人工判断哪份档案才是应保留的 |
| 是否存在越权/泄露 | 否。两侧都要求 `has_perm('student.edit')` ＋ `can_access_student` |
| 截图/视频/请求 ID | psql 事务输出：`stale_result=NO_ERROR a_deleted=t b_deleted=t a_followups=0 b_followups=2 b_balance=500.00` |
| 根因 | `merge_students` 只校验 `p_kept_id <> p_merged_id`、`student.edit` 与 `can_access_student`，两侧都不检查 `deleted_at is null`；`can_access_student` 同样不过滤软删。反向重复合并因 `student_merges.merged_id` 唯一约束才会被拦（且报的是原始唯一约束报错文本，前端只能显示通用 `actionFailed`），而“保留档案已是墓碑”这条方向完全没有防线。客户端候选列表在 `useEffect` 挂载时取一次，之后不再校验新鲜度 |
| 处理决定/owner | 待定。建议在 `merge_students` 开头加 `deleted_at is null` 双侧校验并抛领域码（如 `STUDENT_DELETED`／`ALREADY_MERGED`），由 `mergeStudentsAction` 映射成明确文案；R1-14 补一条「对已软删档案的正反向合并都必须拒绝」的自动化断言 |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-005` / `Sev2` |
| 对应检查项 | `FOLLOW-02` |
| 角色/环境/locale | sales；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/followups`；跟进队列 |
| 前置数据 | `QA-20260803-school-manual` 中已有待跟进、已签约和流失学生 |
| 最短复现步骤 | 登录销售账号，打开跟进队列并检查页面控件 |
| 期望结果 | 可搜索学生，可展开/收起分组，并可全部展开 |
| 实际结果 | 页面只有时间桶、状态分组、学生行和空分组文案，没有搜索、展开/收起或全部展开控件 |
| 是否可稳定复现 | 是；刷新后仍一致 |
| 数据是否已写入 | 否 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无；浏览器快照结果已写入本节 |
| 根因 | 跟进队列未渲染对应交互控件，当前无法继续验证其交互契约 |
| 处理决定/owner | 待定；产品/学校后台 owner |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-006` / `Sev2` |
| 对应检查项 | `FOLLOW-03` |
| 角色/环境/locale | sales；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/followups`、`/zh/dashboard/students/d413bc9d-5943-497e-9999-71c124c9fe0c?tab=followups`；`student_follow_ups` |
| 前置数据 | 学生“测试学生2” |
| 最短复现步骤 | 打开“记跟进”，填写内容、类型和 `datetime-local` 下次时间，保存；再在学生详情重复一次并指定“跟进中” |
| 期望结果 | 内容、类型、下次跟进时间和状态均保存，并在列表与详情一致显示 |
| 实际结果 | 内容、类型和状态持久化；`2026-08-10T10:00` 与 `2026-08-11T09:30` 均未持久化，列表和详情显示没有下次跟进时间 |
| 是否可稳定复现 | 是；两次提交均复现 |
| 数据是否已写入 | 是，测试跟进记录已写入；下次跟进时间未写入 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无 |
| 根因 | 待定；需核对 `datetime-local` 控件、Server Action 入参和 `next_follow_up_at` 写入链路 |
| 处理决定/owner | 待定；学校后台 owner |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-007` / `Sev1` |
| 对应检查项 | `ACT-02`～`ACT-05` |
| 角色/环境/locale | principal；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/activities`；活动表单 |
| 前置数据 | 活动列表为空 |
| 最短复现步骤 | 点击“新建活动”，填写讲座、标题、时长、地点、容量、备注和有效时间 |
| 期望结果 | 所有字段进入表单状态，保存按钮可用并创建活动 |
| 实际结果 | 时间字段在浏览器原生控件中短暂显示值，但未进入受控状态，失焦后清空；保存按钮持续禁用，活动未创建 |
| 是否可稳定复现 | 是；本次多种浏览器输入方式均未能提交时间字段 |
| 数据是否已写入 | 否 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无 |
| 根因 | 待定；疑似 `datetime-local` 输入与受控 React 状态同步失败 |
| 处理决定/owner | 待定；活动模块 owner |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-008` / `Sev2` |
| 对应检查项 | `COURSE-01` |
| 角色/环境/locale | research；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/courses?q=QA-20260803&grade=__all__&courseSeason=__all__&classType=__all__&familyStatus=__all__&variantStatus=__all__&purpose=__all__&readiness=__all__`；课程产品库 |
| 前置数据 | 已存在 QA 课程产品；页面默认筛选参数均为 `__all__` |
| 最短复现步骤 | 在课程库搜索框输入 `QA-20260803`，按 Enter 后点击“筛选” |
| 期望结果 | 返回匹配的 QA 课程产品，并可清空筛选恢复完整列表 |
| 实际结果 | 显示“没有匹配的课程产品”；点击“清除筛选”可恢复 2 个产品 |
| 是否可稳定复现 | 是；本轮复现一次，清空筛选可恢复 |
| 数据是否已写入 | 否 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无 |
| 根因 | 待定；需核对搜索关键词与默认 `__all__` 查询参数的解析/拼接 |
| 处理决定/owner | 待定；课程产品库 owner |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-009` / `Sev1` |
| 对应检查项 | `LECTURE-02` |
| 角色/环境/locale | research；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/courses/830665bc-03ec-407f-88e6-29a94349635a?variant=8df90a37-8b82-400d-94eb-44ef5e7f6b85`；教学计划讲次 |
| 前置数据 | 本轮新建的测试产品与一年级秋季 A 草稿版本 |
| 最短复现步骤 | 进入“编辑教学计划”，新增两讲，填写名称和目标，上移第二讲，点击“保存更改” |
| 期望结果 | 新增、改名、目标和顺序一次事务保存，刷新后顺序稳定 |
| 实际结果 | 保存提示“操作失败，请重试”；取消编辑后刷新，新讲次没有持久化 |
| 是否可稳定复现 | 是；本轮保存动作稳定失败 |
| 数据是否已写入 | 否；产品和版本已写入，新增讲次未写入 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无 |
| 根因 | 待定；代码路径显示新讲次使用客户端生成 ID，保存时直接提交到讲次 RPC，需核对服务端是否要求已存在 lecture ID |
| 处理决定/owner | 待定；课程教学计划 owner |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-010` / `Sev1` |
| 对应检查项 | `LECTURE-01` |
| 角色/环境/locale | research；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/courses/430e0c6f-2fe0-4268-a8e0-c30d5477cc26?variant=767b1756-423e-402c-a5da-19cc213b0ef1`；既有 QA 课程版本 |
| 前置数据 | 已启用、已被 2 个班级使用且已有 2 个讲次的 QA 版本 |
| 最短复现步骤 | 以教研账号打开该版本详情并查看教学计划操作区 |
| 期望结果 | 浏览态无输入框，并有明确“编辑教学计划”入口进入编辑态 |
| 实际结果 | 只显示浏览态教学计划表，没有“编辑教学计划”入口；新建空白测试产品则有该入口 |
| 是否可稳定复现 | 是；该既有版本每次打开均无入口 |
| 数据是否已写入 | 否 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无 |
| 根因 | 待定；入口显然受版本状态、使用班级或权限上下文影响，需明确产品合同 |
| 处理决定/owner | 待定；课程教学计划 owner |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-011` / `Sev2` |
| 对应检查项 | `ADAPT-02` |
| 角色/环境/locale | research；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/courseware/review?tab=pages&class=D`；4:3 适配校对队列 |
| 前置数据 | E 系列适配页面待确认队列（全量 34,584 项） |
| 最短复现步骤 | 打开页面分类队列，检查审校范围搜索区及课程、讲次、分类筛选 |
| 期望结果 | 可按关键词搜索，并在当前结果集内叠加课程/讲次/分类筛选与分页 |
| 实际结果 | 课程、讲次、A–F 分类筛选及分页可用，但搜索区没有关键词输入；无法按名称、MFHK 编码或页面键快速定位 |
| 是否可稳定复现 | 是；刷新后仍无搜索输入 |
| 数据是否已写入 | 否 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无 |
| 根因 | 待定；适配校对页面当前只渲染结构化筛选，没有实现清单要求的关键词搜索 |
| 处理决定/owner | 待定；课件适配校对 owner |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-012` / `Sev1` |
| 对应检查项 | `ADAPT-03`、`ADAPT-04` |
| 角色/环境/locale | research；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/courseware/review?tab=pages&class=D&course=af22cf30-403d-4d00-b974-d3bf84dd16fc&lecture=e0fca4a5-4d87-47ac-bd72-0d07056f3142`；适配页面队列 |
| 前置数据 | 选定 E 系列课程、第 1 讲、D 分类后仍有 14 项待确认；未筛选全量显示 34,584 项 |
| 最短复现步骤 | 进入页面分类队列，检查列表项、选择控件和批量动作 |
| 期望结果 | 可选择当前页目标，批量批准前显示数量；批量退回要求原因并处理 stale |
| 实际结果 | 页面有分类下拉和“可视化编辑”链接，但没有 checkbox、批量选择、批准、退回或原因输入；无法推进队列 |
| 是否可稳定复现 | 是；不同课程/讲次筛选后仍无批量动作 |
| 数据是否已写入 | 否 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无 |
| 根因 | 待定；页面列表未渲染批量审校动作及其选择状态 |
| 处理决定/owner | 待定；课件适配校对 owner |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-013` / `Sev2` |
| 对应检查项 | `ASSET-01` |
| 角色/环境/locale | research；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/courseware-assets`；公共资源库 |
| 前置数据 | 首行资源展示名称“未命名资源”、哈希片段 `3beb04c9d455…` |
| 最短复现步骤 | 在资源库 query 输入“未命名资源”或 `3beb04c9d455`，点击“筛选” |
| 期望结果 | 返回列表中对应的共享资源；清除后恢复完整列表 |
| 实际结果 | 两种 query 均显示“没有符合条件的共享资源”；类型、角色、画幅轨道和最少引用筛选仍可见，类型筛选可改变结果 |
| 是否可稳定复现 | 是；两种 query 均复现 |
| 数据是否已写入 | 否 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无 |
| 根因 | 待定；资源列表展示值与 query 搜索字段未正确匹配，或名称/哈希搜索未接入查询条件 |
| 处理决定/owner | 待定；公共资源库 owner |

| 字段 | 内容 |
| --- | --- |
| BUG ID / 严重度 | `BUG-R1M-014` / `Sev2` |
| 对应检查项 | `LECTURE-08` |
| 角色/环境/locale | research；本地开发环境；zh |
| route 与对象类型 | `/zh/dashboard/courseware/lectures/55e4f79c-71a5-4164-b499-3df0e04f99e7?track=native-16x9` → `/zh/dashboard/classes/5e0897eb-6c7d-4b8f-bc0f-30dd96b09804`；讲次使用班级链接 |
| 前置数据 | QA 讲次工作区“使用情况”有 QA 在读测试班链接 |
| 最短复现步骤 | 打开讲次工作区，点击“使用情况”中的“QA-20260803-在读测试班” |
| 期望结果 | 打开可用班级详情，并保留返回到讲次/课程版本的来源上下文 |
| 实际结果 | 进入班级 route 后显示通用错误页“这里暂时出了点问题”，没有班级详情或来源返回入口 |
| 是否可稳定复现 | 是；本次点击稳定进入错误页 |
| 数据是否已写入 | 否 |
| 是否存在越权/泄露 | 未发现 |
| 截图/视频/请求 ID | 无 |
| 根因 | 待定；需核对班级详情 route 的数据读取与讲次使用关系兼容性 |
| 处理决定/owner | 待定；班级详情/课程研发 owner |

### 13.2 本轮第 6 节新增缺陷

| BUG ID / 严重度 | 对应检查项与角色 | route / 最短复现步骤 | 期望结果 / 实际结果 | 稳定性、数据与证据 |
| --- | --- | --- | --- | --- |
| `BUG-R1M-015` / `Sev2` | `ROSTER-01`；teacher/sales；zh；QA/P4 班级 | `/zh/dashboard/classes/92028e9e-e349-4c04-88ff-79a23702185d?tab=students` → 查看花名册 | 期望每行显示年级、账号、欠费、考勤、请假和提交等运营信号；实际只显示姓名与“未进教室”，teacher 另有转班/退班按钮。 | 稳定复现；无数据写入；无越权/泄露；无截图、日志或请求 ID。 |
| `BUG-R1M-016` / `Sev2` | `ROSTER-02`；principal；zh；P4 班级 | 花名册 → 报名 → 搜索已在班的“测试学生” → 再次点击“报名” | 期望明确返回“已在班/重复报名”并保持名单不变；实际只出现通用 toast“操作失败，请重试”。 | 稳定复现；未生成第二条报名；无截图、日志或请求 ID。 |
| `BUG-R1M-017` / `Sev2` | `ATT-02`；teacher；zh；已结束 P4 课次 | `/zh/dashboard/sessions/38ca35a4-63f8-4600-a4f5-cc8701a352b6?stage=post` → 补登记出勤 | 期望补登记要求操作者、必填原因和时间并保留旧记录；实际表单只有每名学生的状态按钮和可选“备注”，没有必填原因字段。 | 稳定复现；未确认保存；无截图、日志或请求 ID。 |
| `BUG-R1M-018` / `Sev2` | `SCHED-06`；principal；zh；QA/P4 课次 | 课表或班级快速抽屉 → 打开完整课次 `661dedc1-553e-4b8b-9218-a744b2db3a72` | 期望进入完整课次工作区；实际进入“这里暂时出了点问题”通用错误页。 | 该 QA 课次稳定复现；未写入；同类其他课次可打开；无截图、日志或请求 ID。 |
| `BUG-R1M-019` / `Sev2` | `ATT-01`；teacher；zh；QA 课次 1 | `/zh/classroom/5e0897eb-6c7d-4b8f-bc0f-30dd96b09804/session/ebfd615a-e772-4b09-9d48-bfbfd70332f5/live` → 点名 | 期望候课页人数与点名名单一致；实际候课页显示“学生名单已就绪（2 人）”，点名弹窗列出 3 人，包含无账号无监护人的 QA 学员。 | 稳定复现；未保存点名；无截图、日志或请求 ID。 |
| `BUG-R1M-020` / `Sev1` | `CLASS-07`；principal；zh；建班向导 | 新建测试班，选测试-教师、QA-A102、2026-08-04 周二 12:27、90 分钟；确认预览与既有 QA 课次 1 同教师/同教室/同时段 | 期望返回教师与教室冲突对象及时间段；实际显示“未发现主讲教师时间冲突”，且没有教室冲突结果，仍允许继续创建。 | 稳定复现；未点击创建；无截图、日志或请求 ID。 |

以上缺陷均未涉及 secret、token、真实未成年人资料或 E 系列源资源；owner、截止日和修复决定待产品/研发分派。


### 13.3 本轮第 7 节新增缺陷

第 7 节未登记新的缺陷。`BUG-R1M-019` 在 `LIVE-01` / `ATT-01` 复核时再次出现，沿用 §13.2 原记录，不重复编号；其余页面只完成只读观察，未有可稳定确认的新增失败。

### 13.4 本轮第 10 节新增缺陷

| BUG ID / 严重度 | 对应检查项与角色 | route / 最短复现步骤 | 期望结果 / 实际结果 | 稳定性、数据与证据 |
| --- | --- | --- | --- | --- |
| `BUG-R1M-021` / `Sev2` | `LIVE-20`；teacher；zh；试讲课堂 | `/zh/classroom/5e0897eb-6c7d-4b8f-bc0f-30dd96b09804/session/ebfd615a-e772-4b09-9d48-bfbfd70332f5/live?mode=rehearsal`；将视口设为 1024×768 或 1194×834 | 期望课堂控件在常用桌面/iPad 视口内无遮挡且可达；实际 document 无横向溢出，但内层布局的上一页/下一页/页面列表/更多控制条 bottom 坐标分别超过视口底部（1024×768 时约至 y=782，1194×834 时约至 y=848），截图中出现底部裁切，PageDown/页面滚动未推进该内层区域。 | 两个窄高度尺寸稳定复现；仅试讲壳、未写入课堂事实；无越权/泄露；截图未保存为仓库证据，缺陷记录无 secret、token 或真实 PII。 |

## 14. 本轮退出条件

- [ ] `EXIT-01` `SAFE-*`、`AUTH-*`、`ENV-*`、`ROUTE-*`、`JOURNEY-*` 全部通过，无 SKIP。
- [ ] `EXIT-02` 教师主链 `PREP-*`、`LIVE-*`、`POST-*` 和成果主链 `RESULT-*`、`REPORT-*` 全部通过。
- [ ] `EXIT-03` student/parent 越权、无关 staff 越权和财务关闭用例全部通过；任何失败均为 No-Go。
- [ ] `EXIT-04` Sev0=0、Sev1=0、未接受 Sev2=0；接受 Sev2 有 owner、截止日、影响和缓解措施。
- [ ] `EXIT-05` 所有 `BLOCKED` 已判断为环境缺口、数据缺口或产品缺口，并建立后续任务；没有用 N/A 掩盖缺陷。
- [ ] `EXIT-06` 至少完成 zh/en、light/dark、desktop/mobile 的关键旅程抽样，截图不含 secret/PII。
- [ ] `EXIT-07` 测试产生的对象、通知、邀请、artifact、文件和异常均已登记；需要保留到 R1-15 的数据有 manifest。
- [ ] `EXIT-08` 人工结果与当前自动化证据分开记录；没有用“页面看起来正常”替代权限、并发、性能和恢复证据。
- [ ] `EXIT-09` 对所有失败完成修复和针对性回归后，再决定继续 R1-9；未通过时不把 R1-9 标成学校后台已验收。

## 15. 建议执行顺序

为减少反复造数据，按下面顺序线性执行：

1. `SAFE/DATA/AUTH/ENV/ROUTE`：冻结环境、账号和入口事实。
2. `ORG/STAFF/SEC`：先确认规则、权限和账号状态，避免后续结果被错误配置污染。
3. `STU/IMPORT/GUARD/FOLLOW/ACT`：建立学生与家庭上下文。
4. `COURSE/LECTURE/STUDIO/ADAPT/ASSET`：准备课程与不可变 release。
5. `CLASS/ROSTER/SCHED/LEAVE/ATT`：建立班级、排课和课次。
6. `PREP/LIVE/POST`：用同一课次完成一次真实教学链。
7. `RESULT/REPORT/LEARN/FAMILY/NOTICE`：跨教师、学生、家长验证发布、撤回和 deep link。
8. `WORK/COORD/OPS/DQ/REPAIR/PURGE/FIN-CLOSE/WB`：验证横切平台和安全关闭。
9. `FAIL/I18N/UI/A11Y/JOURNEY/EXIT`：完成失败恢复、双语、多断点和最终签收。

若只做第一轮阻断审阅，至少完成：`AUTH`、`ENV`、`ROUTE`、`JOURNEY-02～09`、`FIN-CLOSE` 和 `EXIT-01～04`。其余未测项必须保留为 `SKIP`，不能写“学校后台人工验收通过”。
