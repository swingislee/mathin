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
