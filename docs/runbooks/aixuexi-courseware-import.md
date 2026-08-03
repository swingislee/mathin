# 爱学习 G+ 秋季课程导入

## 1. 固定范围

当前适配只接受本地离线包 `2026-gplus-sujiao-math`：2026 年、苏教版数学、G+、秋季、三至六年级。每个年级存在第 1～6、8～14 讲，共 13 讲；第 7、15 讲是来源包的明确缺口。不得补造一二年级、其他季节、其他难度或缺失讲次。

默认来源仓库为 Mathin 同级目录 `../2026-07_mofaxiao_courseware`，来源包位于 `exports/packages/2026-gplus-sujiao-math`。导入过程只读来源仓库；构建产物写入 Mathin 的 `.tmp/aixuexi-import/2026-gplus-sujiao-math`。

## 2. 接口边界

爱学习页面不转换成 E 系列 `page-doc-v1`。构建器把来源资源 ID 转为 Mathin binding key，并以独立的 `aixuexi-page-doc-v1` / `aixuexi-page-v1` 保存布局、题目、ITV 与离线 H5 语义。课程族、课程、讲次、CAS、revision、release、双轨 head 和课次冻结继续复用 P6 数据层。

16:9 使用来源语义画布。4:3 不伪造重新排版的来源内容；同一不可变页面 revision 进入 `adapted-4x3` release，在 4:3 舞台顶部显示 16:9 内容，下方保留 25% 板书带。

## 3. 前置条件

1. 从 `.env.example` 配置本地 `.env.local`，只在运行环境保存 Supabase URL 与 secret key。
2. 开发库已应用并登记 `20260803000200_p6_aixuexi_course_system.sql`。迁移 checksum 必须使用 `scripts/lib/text-hash.mjs` 的标准化文本摘要。
3. 来源包的 `site-package-manifest.json`、catalog、layout projection 与 offline verification 均存在，且 verification 中 remote/missing/fatal 都为 0。
4. 不得在本流程中执行 R1-15/R1-18 的生产数据清理或 release 重建。

## 4. 构建与预检

```powershell
pnpm cw:aixuexi:build
pnpm cw:aixuexi:import -- --dry-run
```

构建预期为 52 讲、1525 页、4863 bindings、56 个 H5 包。`--metadata-only` 可验证合同而不复制约 294 MB 的 H5 文件：

```powershell
pnpm cw:aixuexi:build -- --metadata-only
```

构建器遇到范围漂移、来源不完整、外部 URL、缺失资源、hash/字节数不符或不安全标记时必须非零退出，不允许带警告继续写库。

## 5. 分批导入

```powershell
pnpm cw:aixuexi:import -- --start-at 1 --limit 10
pnpm cw:aixuexi:import -- --start-at 11 --limit 10
pnpm cw:aixuexi:import -- --start-at 21 --limit 10
pnpm cw:aixuexi:import -- --start-at 31 --limit 10
pnpm cw:aixuexi:import -- --start-at 41 --limit 12
```

`--start-at` 按 `lectures.ndjson` 的稳定顺序计数，不是讲次编号。每讲先上传内容寻址对象，再在单个数据库事务中写来源映射、页面、revision、两轨 binding、两轨 release 和 head。中断后从失败项重跑；已存在对象和数据库行必须报告为 existing/零新增，`conflicts` 与 `baselineDrift` 必须为 0。

## 6. 验收

```powershell
pnpm exec vitest run tests/aixuexi-courseware.test.ts tests/cw-import.test.ts tests/cw-h5-shim.test.ts
pnpm lint
pnpm messages:check
$env:SUPABASE_META_SSH='xiaomi'; pnpm db:types:check
pnpm build
```

开发库预期：1 个课程族、4 个年级课程、52 讲、1525 页；`native-16x9` 与 `adapted-4x3` 各 52 个 release 和 4863 个 binding；104 个讲次轨道 head；56 个题目互动页、10 个 ITV 页、55 个 ITV 事件。浏览器至少抽查普通题目页、题目 H5 页、ITV 页及两种轨道，确认 4:3 舞台比例为 4/3、内容顶置且板书带为 25%。

## 7. 故障处理

- H5 文件名含中文、冒号或百分号时，逻辑路径保持原名，Storage 物理 key 由 `h5StoragePath` 投影；禁止手工重命名包内引用。
- H5 HTML 保持 opaque-origin sandbox。入口页带 `X-Frame-Options: SAMEORIGIN`，二级 HTML 依靠响应级 CSP sandbox；不得添加 `allow-same-origin`。
- H5 子资源经 Mathin 同源代理读取。代理不得转发上游压缩态 `Content-Length`，否则解压后的脚本会被浏览器截断；Range 请求必须保留 `Content-Range`/`Accept-Ranges`。
- 来源内容更新时重新构建并比较 package/source hash。既有非 import revision 受保护；不得覆盖人工编辑，也不得通过清库绕过 drift。

R1 支持证据见 `docs/evidence/r1/r1-9-aixuexi-courseware.md`。
