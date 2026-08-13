# R1-9 · P6-AIX-2 爱学习 projection v31 多难度证据

## 状态

P6-AIX-2 已于 2026-08-13 关闭：G+/X+/A+ 三包已按源站真实运行逻辑重建开发库，旧手工放大逻辑退出，结构化 4:3、动画、embedded H5 和两类原生游戏通过验证。本记录不关闭 R1-9，也不证明生产数据已经清理或签收。

| 字段 | 值 |
| --- | --- |
| `gate_id` | `R1-9-P6-AIX-2-V31-20260813` |
| `domain` | projection v31、G+/X+/A+、源 CSS/player/动画/H5/原生游戏、16:9/4:3 双轨、开发库重导入、zh/en Studio |
| `result` | `passed`（P6-AIX-2 子门） |
| `measured_value` | 12 门/170 讲/5442 页；`source-master` 5020 页、`source-player-compat` 422 页；两轨各 170 release/head、5442 页面 head、27541 binding；8 原生游戏、9 embedded H5；conflict/drift/runtime missing=0 |
| `threshold` | 三个固定 package 全量 projection v31；逐讲 remote/missing/fatal=0；只保留 catalog 明确讲次；源运行时保真；两轨集合相等；幂等重跑零新增；代表性 zh/en 浏览器旅程无应用错误 |
| `commit_sha` | 规划 `08f28eb`；实现 `ce07671`；原生游戏 Strict Mode 修复 `e8573b4` |
| `migration_head` | `20260813000500_p6_aixuexi_v31_levels.sql`；标准化 SHA-256 `ea8e81b8d9cdb3cdca3b7fe2a3831bb38bb9340f5b382a36bef51a79cef37e91` |
| `environment` | Windows / Node.js 22 / Next.js 16.2.11；自托管开发 Supabase；Codex 应用内 Chromium；非生产 |
| `dataset_manifest` | 只读来源 `../2026-07_mofaxiao_courseware/exports/packages/{2026-gplus-sujiao-math,2026-xplus-sujiao-math,2026-aplus-quanguo-math}`；无 secret/PII |
| `started_at` | `2026-08-13` |
| `finished_at` | `2026-08-13` |
| `actor` | Codex desktop agent |
| `approver` | `swingislee`（以本轮重新导入、升级 X+/A+ 和 4:3 适配指令授权开发子门；生产动作仍需 R1-15/R1-18 独立批准） |
| `command_or_runbook` | [爱学习 projection v31 多难度课程导入](../../runbooks/aixuexi-courseware-import.md) |
| `artifact_url_or_path` | `not_applicable`（本页保存无 secret/PII 的小摘要；真实生产 inventory 与大对象审计仍待受控 artifact） |
| `artifact_hash` | `not_applicable` |
| `retention` | 小摘要随 Git 历史永久保存；开发数据不替代生产证据 |
| `access_roles` | 仓库读权限与开发 Supabase 权限持有者 |
| `failure_ticket` | R1-9 仍缺真实 1305 行生产来源 inventory、`cw-objects`/`cw-h5` 审计和非执行者复核；R1-15/18 均未执行 |

## 来源与范围对账

| package | 课程 | 讲次 | 页面 | direct 4:3 | compat 4:3 | 显式复习占位 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| G+ 苏教版 | 4 | 56 | 1641 | 1641 | 0 | 4 |
| X+ 苏教版 | 6 | 84 | 2767 | 2386 | 381 | 6 |
| A+ 全国版 | 2 | 30 | 1034 | 993 | 41 | 4 |
| 合计 | 12 | 170 | 5442 | 5020 | 422 | 14 |

显式占位为：G+ 三/四年级、X+ 一/三/四年级、A+ 一/二年级的第 7 与第 15 讲。G+ 五/六年级和 X+ 二/五/六年级没有对应来源资源，roster 保持讲号缺口。所有导入讲次的 offline verification 均为 complete，三项远程/缺失/fatal 计数为 0。

## 实现结论

- 来源普通页固定 1200×900 母版；Mathin 不再用旧 `coordinateScaleY`、xmind 偏移或小图 2 倍放大补偿。
- 5020 个普通页直接使用 `source-master`。422 个动画/H5/1920×1080 原生游戏页保持源 1200×675 播放器比例，上置于 4:3 并保留 225 逻辑像素兼容区。
- 源 CSS、captured player 图片模块、transform/origin、动画 step/group/effect/phase/timing、reveal steps、ITV、embedded H5 与原生游戏模型进入内容寻址资源；不是 Mathin 的视觉近似复制。
- TrueOrFalse 与 TopicClassification 使用来源模型和本地化源样式。浏览器发现 React Strict Mode 重挂载会二次 `attachShadow()`，`e8573b4` 改为复用 shadow root 并幂等替换子树，随后 8/8 原生游戏页批量通过。

## 数据库与幂等证据

- 迁移先做 rollback trial，再提交 G+/X+/A+ 3 个课程族、12 门课程和 170 讲 roster；migration ledger 使用标准化文本摘要登记。
- 清理前旧 G+ 1525 页的 annotations、notes、solutions、learning checks、preparations、review cycles、replacement、派生背景和外部 asset binding 全为 0。第一次含 CAS 删除的尝试超时并确认事务回滚；最终只清理 page/release/source mapping，保留内容寻址对象和元数据。
- G+/X+/A+ 导入结果分别为 56/1641/6981、84/2767/14889、30/1034/5671（讲/页/binding），全程 conflict=0、baselineDrift=0。
- X+ 首讲幂等重跑的对象、页面、binding、revision 和 release 新增数均为 0。

## 浏览器矩阵

| 样本 | 结果 |
| --- | --- |
| G+ 普通 4:3 | `source-master`；1200×900 源舞台铺满 4:3，无兼容带、无运行时错误 |
| A+ 动画 4:3 | `source-player-compat`；7 个动画节点，点击后隐藏节点 5→3、剩余步骤 2→1，URL 不跳转 |
| X+ embedded H5 | 本地 `/api/cw-h5/packages/.../index.html` 加载“左右关系”；sandbox 无 `allow-same-origin` |
| X+ TrueOrFalse | shadow root、7 份本地化源样式、3 个等级；启动后出现 10 个选项和活动题面 |
| X+ TopicClassification | shadow root、源样式、10 个分类项/8 个可拖动选项；无 style/runtime error |
| A+ 第 7 讲占位 | 26 页完整加载；Studio 显示 `A+`，不是旧硬编码 G+ |
| `/en` 同一占位 | Studio 导航/只读提示/4:3 标签为英文，课程标题显式回退中文 |
| 8 个原生游戏批量复核 | 3 个 TrueOrFalse、5 个 TopicClassification 均有 shadow root、源样式和交互控件；应用错误为 0 |

## 自动化结果

```text
target Vitest: 3 files / 22 tests passed
pnpm typecheck: passed
pnpm lint: passed
pnpm messages:check: 4043 keys × 2 locales passed
pnpm build: Next.js 16.2.11 / 314 routes passed
production/source manifest contract: 2 files / 15 tests passed
```

旧 2026-08-03/05 的 G+ v11 证据保留在 Git 历史中，用于解释曾经的错误画布和手工补偿；本记录完整取代其现行范围、计数和适配结论。
