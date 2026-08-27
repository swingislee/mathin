# 爱学习 projection v31 多难度课程导入

## 1. 固定范围

默认来源仓库是 Mathin 同级目录 `../2026-07_mofaxiao_courseware`。构建器只读该仓库，产物写入 Mathin 的 `.tmp/aixuexi-import/<package-key>`。

| package key | 难度/版本 | 年级 | 课程 | 讲次 | 页面 | 来源显式第 7/15 讲占位 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `2026-gplus-sujiao-math` | G+ / 苏教版 | 3～6 | 4 | 56 | 1641 | 三、四年级共 4 讲 |
| `2026-xplus-sujiao-math` | X+ / 苏教版 | 1～6 | 6 | 84 | 2767 | 一、三、四年级共 6 讲 |
| `2026-aplus-quanguo-math` | A+ / 全国版 | 1～2 | 2 | 30 | 1034 | 无缺口 |
| 合计 |  |  | 12 | 170 | 5442 | 10 讲由教学计划补充占位 |

源包没有提供的第 7/15 讲不导入课件；合并后的课程包在数据库教学计划中补充 10 条占位讲次。占位讲次不创建 release，课件准备状态保持“未发布”。

开发库另可导入暑期增量包 `2026-summer-aplus-quanguo-math`。该包当前只包含一年级 A+ 全国版第 1 讲《一个萝卜一个坑》和第 8 讲《逃家的小羊》，合计 2 讲、66 页；数据库课程保留完整 15 讲教学计划，其余 13 讲只建空 `courseware_template`、无 release 的占位讲次，不补造课件或来源记录。这个开发增量不改变上表 Production 1.0 秋季基线。

## 2. 页面与 4:3 合同

爱学习页面保存为 projection v31 的 `aixuexi-page-doc-v1`，不转换成 E 系列 `page-doc-v1`。课程族、课程、讲次、CAS、revision/release、双轨 head 和课次冻结继续复用 P6 数据层。

普通源母版是 1200×900。源播放器则用 1920×1080 外层承载背景和 `slideClass`，把 1200×900 内层居中并放大 1.2 倍，再以 0.625 呈现为 1200×675。分类器按页面结构选择 4:3 策略：

| 模式 | 判定 | adapted 4:3 |
| --- | --- | --- |
| `source-master` | 1200×900 且没有源动画、embedded H5 或 1920×1080 原生游戏 | 直接铺满 1200×900；共 5020 页 |
| `source-player-compat` | 有动画、embedded H5，或画布/原生游戏为 1920×1080 | 保持源 1200×675 交互比例置于上部，底部 225 逻辑像素为课堂兼容区；共 422 页 |

422 页来自 X+ 381 页和 A+ 41 页；G+ 1641 页全部直接复用。分类不得编码成 package、年级、讲次或页面白名单。

运行时必须消费来源包的 `slide-runtime.css`、captured player 图片模块、完整 transform/transform-origin、动画 step/group/effect/phase/duration/delay、embedded H5、TrueOrFalse 和 TopicClassification。旧手工小图放大、xmind 偏移和近似游戏实现不得恢复。

## 3. 前置条件

1. `.env.local` 指向开发 Supabase，并具备导入所需 server key；凭据不得写入日志或仓库。
2. 开发库已应用并登记 `20260814000300_p6_six_classroom_cleanup.sql`；爱学习必须收敛为一个课程族、12 门课程、180 条教学计划讲次，其中 170 条有源站课件、10 条为第 7/15 讲计划补充占位；难度顺序为 X+ < G+ < A+。
3. 三包的 `site/manifest.json`、catalog、projection v31、slide/player runtime 和逐讲 offline verification 都存在，且 remote/missing/fatal 为 0。
4. 本流程只允许开发库导入。R1-15/R1-18 的生产清理与 release-1 重建需要独立授权。

## 4. 构建与预检

每个 package 分别执行：

```powershell
pnpm cw:aixuexi:build -- --package-key 2026-gplus-sujiao-math
pnpm cw:aixuexi:build -- --package-key 2026-xplus-sujiao-math
pnpm cw:aixuexi:build -- --package-key 2026-aplus-quanguo-math
pnpm cw:aixuexi:build -- --package-key 2026-summer-aplus-quanguo-math

pnpm cw:aixuexi:import -- --package-key 2026-gplus-sujiao-math --dry-run
pnpm cw:aixuexi:import -- --package-key 2026-xplus-sujiao-math --dry-run
pnpm cw:aixuexi:import -- --package-key 2026-aplus-quanguo-math --dry-run
pnpm cw:aixuexi:import -- --package-key 2026-summer-aplus-quanguo-math --dry-run
```

只校验合同而不复制 H5 文件时，在 build 命令末尾加 `--metadata-only`。当前完整构建结果：

| package | 讲次/页面 | usages | CAS 对象 | H5 包/包内文件 |
| --- | ---: | ---: | ---: | ---: |
| G+ | 56/1641 | 6981 | 838 | 59/2484 |
| X+ | 84/2767 | 14889 | 2424 | 70/3021 |
| A+ | 30/1034 | 5671 | 1335 | 87/4864 |
| A+ 暑期开发增量 | 2/66 | 350 | 105 | 7/312 |

范围漂移、projection 版本错误、离线验证不完整、外部 URL、缺失资源、hash/字节数不符或不安全标记都必须非零退出。

## 5. 导入与幂等重跑

```powershell
pnpm cw:aixuexi:import -- --package-key 2026-gplus-sujiao-math
pnpm cw:aixuexi:import -- --package-key 2026-xplus-sujiao-math
pnpm cw:aixuexi:import -- --package-key 2026-aplus-quanguo-math
pnpm cw:aixuexi:import -- --package-key 2026-summer-aplus-quanguo-math
```

可追加 `--start-at <1-based-index> --limit <count>` 分批运行；索引按 `lectures.ndjson` 稳定顺序，不是讲号。每讲先上传内容寻址对象，再用单个数据库事务写来源映射、页面、revision、两轨 binding/release/head。中断后从失败项重跑；`conflicts`、`baselineDrift` 必须为 0，已存在对象和行只报告 existing。

## 6. 重导入安全边界

来源语义或 projection 版本变化时，旧文档不会被覆盖。先只读确认以下外部引用均为 0：annotations、replacement items/batches、lesson notes、solution records、learning checks、preparations、review cycles、派生背景和外部 asset binding。

随后在单事务内清除旧爱学习 page data、两轨 release/head 和 source mapping，保留 `courses`、`course_lectures` 以及内容寻址的 CAS/Storage 对象和元数据。事务内再次断言外部引用；任一非 0 整笔回滚。开发库本轮先完成了 1525 页旧 G+ 数据的回滚试验，再提交清理；没有执行生产清理。

## 7. 验收

```powershell
pnpm exec vitest run tests/aixuexi-courseware.test.ts tests/cw-import.test.ts tests/cw-h5-shim.test.ts
pnpm typecheck
pnpm lint
pnpm messages:check
pnpm build
```

Production 1.0 秋季基线必须精确满足：3 个 imported source package、12 门课程、180 条教学计划讲次（170 条 source-backed、10 条未发布占位）、5442 页且全部 projection v31；两轨各 170 release/head、5442 页面 head、27541 binding；8 个原生游戏、9 个 embedded H5；runtime binding 缺失=0；重复导入零新增/零 drift。

导入暑期开发增量后，开发库爱学习目录合计为 4 个 imported source package、13 门课程、195 条教学计划讲次（172 条 source-backed、23 条未发布占位）、5508 页。暑期目标课程必须精确为 15 讲；第 1、8 讲分别为 34/32 页并各有两轨 release/head，两轨各新增 350 个 binding；其余 13 讲保持空模板、0 页面、0 release。重复导入必须 Storage 零上传、数据库零 conflict/零 drift。

浏览器至少抽查：G+ `source-master` 4:3；A+ 动画兼容页逐步揭示；X+ embedded H5 的 opaque-origin sandbox；TrueOrFalse 和 TopicClassification 的源样式与交互；显式第 7/15 讲占位；zh/en Studio 标签。H5 不得添加 `allow-same-origin`，原生游戏 shadow root 必须可在 React Strict Mode 重挂载。

支持证据见 [R1-9 爱学习 v31 证据](../evidence/r1/r1-9-aixuexi-courseware.md)。
