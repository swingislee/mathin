# R1-9 支持证据 · 爱学习 G+ 秋季课程

## 状态

本证据关闭爱学习 G+ 秋季课程的来源适配、双轨发布和开发库导入子门，不关闭整个 R1-9。Terms、公共内容发布链以及 E 系列与爱学习两套课程的正式生产 manifest 仍按 doc 25 完成。

## 证据记录

| 字段 | 值 |
| --- | --- |
| `gate_id` | `AIXUEXI-GPLUS-AUTUMN-20260803` |
| `domain` | 来源合同、独立页面适配器、CAS、H5/ITV、Supabase、16:9/4:3 双轨、zh/en 中台 UI |
| `result` | `passed`（仅本子门） |
| `measured_value` | 52 讲、1525 页、4863 bindings、748 CAS 对象、56 个 H5 包；开发库两轨各 52 releases / 4863 bindings，104 个 lecture track heads |
| `threshold` | 只接收 2026 苏教版数学 G+ 秋季三至六年级；来源缺失讲次不补造；每讲同时具备 `native-16x9` 与 `adapted-4x3` release；普通页、H5、ITV 和双轨均经浏览器抽查 |
| `commit_sha` | `a0aebc2f7efd9e08e8755e08b921416113b91763` |
| `migration_head` | `20260803000200_p6_aixuexi_course_system.sql`；标准化 SHA-256 `f5d93b18663ebc5623dbbd529dad7bdcefa1c9f45ff9486e7615063fff333087` |
| `environment` | Windows 本地 Next.js 16.2.11；xiaomi 自托管开发 Supabase；Codex 应用内浏览器 |
| `dataset_manifest` | 只读来源 `../2026-07_mofaxiao_courseware/exports/packages/2026-gplus-sujiao-math`；`source_system=aixuexi_bsk`；无凭据、secret 或 PII |
| `started_at` | `2026-08-03T16:09:20+08:00` |
| `finished_at` | `2026-08-03T17:22:25+08:00` |
| `actor` | Codex（实现、导入与自动化验证） |
| `approver` | `swingislee`（以本次爱学习课程接入指令授权本子门实现；R1-9 总门仍未关闭） |
| `command_or_runbook` | [爱学习 G+ 秋季课程导入](../../runbooks/aixuexi-courseware-import.md) |
| `artifact_url_or_path` | `not_applicable`（本页即无 secret/PII 的 Git 内小摘要；R1-9 总门关闭时另行登记正式 manifest artifact） |
| `artifact_hash` | `not_applicable` |
| `retention` | 小摘要随 Git 历史永久保存；开发库数据在 R1-15/R1-18 按已更新生产基线重建 |
| `access_roles` | 仓库读权限持有者；开发 Supabase 权限持有者 |
| `failure_ticket` | `pnpm typecheck` 仅剩既有 `tests/auth-safe-redirect.test.ts:31` 回调参数数量错误，归 R1-14 历史合同清零；本次目标测试、lint、messages、DB 类型和生产构建均通过 |

## 适配结论

爱学习来源没有转换成 E 系列 `page-doc-v1`。两套来源在页面结构、互动题、ITV、H5 包与布局语义上不等价，强制转换会丢失行为或制造 E 系列并不存在的字段。Mathin 因此新增 `aixuexi-page-doc-v1` 与 React 运行时，只在稳定边界复用 P6 的课程、讲次、CAS、revision、release、双轨 head 和课堂冻结机制。

来源范围固定为三至六年级，每个年级第 1～6、8～14 讲，共 13 讲；第 7、15 讲以及一二年级在来源包中不存在，导入器会拒绝范围漂移，不生成占位课程或伪造讲次。

## 数据库与双轨结果

- 课程体系：1 个爱学习课程族、4 个年级变体、52 讲、1525 页、52 条来源讲次映射。
- 文档版本：1525 页全部为 `aixuexi-page-doc-v1`。
- 原生轨：52 个 `native-16x9` releases、4863 bindings。
- 适配轨：52 个 `adapted-4x3` releases、4863 bindings。
- 交互：56 个题目 H5 页、10 个 ITV 页、55 个 ITV 事件。
- 来源状态：`2026-gplus-sujiao-math` 已标记 imported；每个年级的来源缺口均为第 7、15 讲。

## 浏览器证据

- 16:9 原生舞台实测 `1110 × 624`，比例 `1.778`。
- 4:3 舞台实测 `873 × 655`，比例 `1.333`；来源内容区 `873 × 491` 顶置，底部板书带 `164 px`，占舞台高度 25%。
- 离线题目 H5 通过 Mathin 同源 sandbox 代理启动，并从第 1/7 题推进到第 2/7 题。
- ITV 样本视频时长 `85.717333` 秒；事件 1 跳转到 `7.167` 秒，选择正确答案后出现正确反馈及继续动作。
- 浏览器验收同时发现并修复 4:3 舞台压缩、H5 二级 iframe/CSP、代理压缩长度截断和公式排版问题；最终样本页的 KaTeX、自动换行和板书带均正常。

## 自动化结果

```text
target Vitest: 3 files / 17 tests passed
pnpm lint: passed
pnpm messages:check: 3712 keys × 2 locales passed
pnpm db:types:check: passed
pnpm build: 314 / 314 pages passed
pnpm typecheck: pre-existing auth-safe-redirect callback arity failure only
```

## R1-9 剩余边界

本记录不证明正式生产环境已经重建或签收。R1-9 仍需完成 Terms/公共内容发布链，以及 E 系列 865 讲和爱学习 52 讲的正式 manifest；生产数据库最终应形成 917 讲、1834 条双轨 release，并在 R1-15/R1-18 登记清理、恢复与人工审批证据。

---

## 重导入记录（2026-08-05）：4:3 母版归位

| 字段 | 值 |
| --- | --- |
| `gate_id` | `AIXUEXI-GPLUS-AUTUMN-20260805-REIMPORT` |
| `domain` | 来源合同 v11、4:3 母版画布、源播放器呈现规则移植、双轨语义、开发库重导入 |
| `result` | `passed`（仅本子门；R1-9 总门仍未关闭） |
| `measured_value` | 52 讲、1525 页、4934 bindings/轨、815 CAS 对象、58 个 H5 包（2471 个包内文件）；两轨各 52 release、52 讲头、1525 页头；58 `offline` + 1 `capture_required` 题目页；10 ITV 页 / 55 事件 |
| `threshold` | 页面文档全部 `1200x900 / projectionVersion 11`；两轨 release/binding 计数相等；导入 `conflicts`=0、`baselineDrift`=0；重跑单讲全部 existing |
| `commit_sha` | `c98647c492eb1ad801f1e6bb16ddbde0836c554d` |
| `migration_head` | 无新迁移（本次不改 schema） |
| `environment` | Windows 本地 Next.js 16.2.11；xiaomi 自托管开发 Supabase；Playwright/Chromium |
| `dataset_manifest` | 只读来源 `../2026-07_mofaxiao_courseware/exports/packages/2026-gplus-sujiao-math`（重新本地化后的资源配置）；无凭据、secret 或 PII |
| `actor` | Claude Opus 5（实现、清理、导入与浏览器验证） |
| `approver` | `swingislee`（明确批准清库重建、全量保真移植、以 offline-verification 为准放行 partial 讲次） |
| `command_or_runbook` | [爱学习 G+ 秋季课程导入](../../runbooks/aixuexi-courseware-import.md) §6.1 |
| `retention` | 小摘要随 Git 历史永久保存；开发库数据在 R1-15/R1-18 按生产基线重建 |

### 推翻首批的原因

首批把 1200×900 的内容母版当成 16:9：画布写成 `1200×675 / coordinateScaleY 0.75`，节点坐标仍留在 900 空间。逐页统计确认 **1525 页中 876 页、共 1007 个节点的底部内容被 `overflow:hidden` 裁掉**；同时源播放器的呈现规则几乎未移植。两项叠加即人工复查判定的“效果不好”。上表 2026-08-03 记录的“4:3 内容顶置 + 25% 板书带”是基于该错误前提的结论，已由本次记录取代。

### 清理与重建对账

清理前外部引用全部为 0：`courseware_annotations`、`cw_replacement_items`、`lesson_page_notes`、`solution_records`、`session_learning_checks`、`session_preparations`、`cw_review_cycles`；804 个 shared asset 与 E 系列共享 0、被替换批次引用 0、被派生背景引用 0。

单事务删除量：releases 104、lecture track heads 104、lecture workflows 0、bindings 9726、pages 1525、asset variant heads 1608、asset revisions 804、shared assets 804、asset objects 804、source lectures 52、source packages 1。`courses` 4 门与 `course_lectures` 52 讲保留。事务内二次断言任一外部引用不为 0 即整笔回滚（首次执行确因验证语句报错整笔回滚，无部分删除）。

重建：`pnpm cw:aixuexi:build` → 52/1525/4934/815/58/2471；分 4 批各 13 讲导入，全程 `conflicts`=0、`baselineDrift`=0；单讲重跑报告 pages/objects/bindings/sharedAssets 全部 existing、inserted 0。

### 浏览器证据（Studio，8 页 × 2 轨）

| 断言 | 4:3 轨 | 16:9 轨 |
| --- | --- | --- |
| 画框比例 | `1.3333` | `1.7778` |
| 舞台声明 | `1200px × 900px` | `1200px × 900px` |
| 变换 | `translate(0,0) scale(0.727214)` | `translate(138.75px, 0) scale(0.69375)`；xmind 页 `translate(138.75px, 64.75px)` |
| 渲染尺寸 | `873 × 654`（铺满画框） | `833 × 624`（居中 pillarbox） |
| 背景 | `1920×1080 / object-fit: cover` | 同左 |
| 板书带 | 无 | 无 |

`scale(0.69375) = (1110/1200)×0.75`、`138.75 = 150×(1110/1200)`、`64.75 = 70×0.925`，与 `doc.presentation` 完全吻合。

行为面：折叠开关点击 `display` 由 `none`→`block` 且 `aria-expanded=true`；分步揭示未显形下划线 3→2；分栏滚动区、a44 形状元素、内联小图 2 倍放大（`data-aix-size-scaled`）、KaTeX 均命中；题目 H5 iframe `sandbox="allow-scripts allow-forms allow-pointer-lock allow-modals"`（未放开 `allow-same-origin`）；ITV 播放器 `readyState=4`、时长 123 秒、8 个节点标记、进度/倍速/静音齐全，节点触发后选项命中框 `data-itv-has-state=true` 并换上源站三态素材。`localhost:3130` 与局域网 `192.168.5.213:3130` 两个来源均通过。

Mathin 页面自身零 console error/pageerror；打开题目 H5 后有 4 条来自沙箱 iframe 内部的空消息 error 事件（H5 离线包自身运行时行为，页面未打开 H5 时为 0），以及一条 report-only 的 `frame-ancestors` CSP 记录。

### 实现缺陷与修复（浏览器实测发现）

1. React 在挂载后的重渲染里会重建 `dangerouslySetInnerHTML` 注入的源站子树，把已接线的折叠开关、已放大的内联图和已矫正的坐标一起抹掉（effect 内实测 `aria-expanded=2`，1.8 秒后为 0）。修复：呈现规则整体幂等 + MutationObserver 跟随重建重复施加（重入标志 + 40 次上限），与镜像项目同口径。
2. 折叠开关缺 click/keydown 监听，按钮渲染出来但点了没反应——正是镜像巡检判定的死按钮（`control_inert`，阻断级）。修复：监听在接线时一并挂上，并 `stopPropagation` 以免点开答案顺带翻页。

### 自动化结果

```text
pnpm ci:checks: 14 / 14 passed
target Vitest（aixuexi-courseware / cw-import / cw-h5-shim）: 3 files / 20 tests passed
全量 Vitest: 19 failed / 232 passed —— 失败集合与 HEAD 基线（19 failed / 229 passed）完全一致，净增 3 项本次新增用例，无回归；19 项归 R1-14 清零
pnpm lint / typecheck: passed
pnpm messages:check: 3758 keys × 2 locales passed
pnpm build: passed
```

### 已知取舍

4:3 轨的背景按 `object-fit: cover` 裁掉左右各 12.5%：框架式背景会丢左右木柱与右下角吉祥物，场景式背景只丢边缘植被。换来的是内容面积为“整幅 16:9 内嵌 4:3”方案的 1.78 倍。若后续改判，只需改 `AixuexiStage` 的画框换算，页面 revision 不受影响。
