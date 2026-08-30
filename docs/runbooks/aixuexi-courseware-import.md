# 爱学习 source-runtime 导入与 projection v31/v32 兼容

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

## 2. 页面、源 Viewer 与 4:3 合同

来源包以 projection v32 保存当前安全投影和离线证据；历史 production baseline 的 projection v31 继续只读兼容。Mathin 的新导入文档统一为 `source-runtime-page-v1`，来源适配器为 `source-runtime-v1`。它不转换成 E 系列 `page-doc-v1`，也不再把来源节点拆成 Mathin 自有 React 组件。纯循环 Lottie 是否派生视频、体积硬门及原生 `<video>` 行为都由来源 Viewer 产生并随 runtime 封装，Mathin 不维护第二套判型或手写元素。课程族、课程、讲次、CAS、revision/release、双轨 head 和课次冻结继续复用 P6 数据层。

每个来源 package 只生成一个内容寻址的 Viewer H5 包。包内直接使用来源仓库维护的 `viewerScript`、`viewerStyles`、`slide-runtime.css`、`itv-runtime.css`、captured player 图片模块、字体及游戏运行时；页文档只携带安全筛选后的来源页面投影、资源 ID 映射和来源路由映射。Mathin 宿主仅负责：

1. 在无 `allow-same-origin` 的外层 sandbox iframe 中启动来源 Viewer；
2. 把内容寻址 binding 解析成短期 URL，并通过 `mathin-source-runtime-v1` 消息协议交给 Viewer；
3. 在 `native-16x9` 使用 1200×675 自然舞台，在 `adapted-4x3` 使用 1200×900 外框，把同一 1200×675 来源舞台顶对齐，底部保留 225 逻辑像素；
4. 转发课堂媒体控制、H5 输入桥和来源 Viewer 明确发出的翻页事件。

来源 DOM、类名、坐标、transform、折叠结构、按钮文案和 CSS 由来源 Viewer 单一拥有。导入 seam 只允许把已捕获的精确源 URL 改写为 `asset://resource/<id>`，以及把已登记 API 路径映射到本地 H5；未知网络 URL、可执行 markup、缺少 binding 或 Viewer 指纹漂移必须硬失败。

### 2.1 已审阅踩坑约束

本接口以同级来源仓库的 `docs/current/aixuexi-localization.md`、`docs/阶段/爱学习/阶段68_源播放器样式表接入与部件呈现批量修复.md`、`docs/阶段/爱学习/阶段74_Viewer自拟样式与字体替换对账闭环.md` 和 `docs/视觉对比/综合审校/审校记录.md` 为输入事实，固定以下禁区：

- 不从截图重画部件，不在 Mathin 复制来源 CSS 规则，也不为 Topic、ITV、TrueOrFalse 等题型各造一套按钮；
- 普通题目入口保留来源 1200×900 坐标 `(434,690,332×90)`、橙色“开始”和 `.aix-shared-interaction-entry`，不能替换成 shadcn `Button` 或“进入互动”；
- 图片尺寸继续由 captured player 模块执行；不恢复小图阈值、xmind 偏移、统一 `object-fit` 或 Viewer 兜底放大；
- H5 只做地址适配，保留真实入口、内在画布、父子页协议和 source sandbox；
- source-runtime 自身是 opaque-origin sandbox；其二级 H5 入口用显式父层标记保留课堂 runtime 注入并移除会拒绝 opaque 父层的 `X-Frame-Options: SAMEORIGIN`，响应 CSP sandbox、内容寻址路径校验和普通顶层 H5 的 SAMEORIGIN 门禁不放宽；
- MathJax v2 的精确 `<script type="math/tex">` 是惰性公式载体，可以原样保留；其他 script 及带属性的伪装形式仍拒绝；
- iframe 的 `ready/rendered/load` 顺序不得假定。渲染状态绑定具体 frame key，父层 `load` 事件不能重新覆盖已经完成的来源页面。

旧 `aixuexi-page-doc-v1` / `aixuexi-page-v1` 仅保留为已发布数据的只读兼容渲染器。新包不得再生成该文档；生产 release 未经 R1-9/15/18 授权不得切换。

## 3. 前置条件

1. `.env.local` 指向开发 Supabase，并具备导入所需 server key；凭据不得写入日志或仓库。
2. 开发库已应用并登记 `20260814000300_p6_six_classroom_cleanup.sql` 与 `20260827000500_courseware_source_runtime_adapter.sql`；爱学习秋季课程必须收敛为一个课程族、12 门课程、180 条教学计划讲次，其中 170 条有源站课件、10 条为第 7/15 讲计划补充占位；难度顺序为 X+ < G+ < A+。
3. 三包的 `site/manifest.json`、catalog、当前 projection、slide/player runtime 和逐讲 offline verification 都存在，且 remote/missing/fatal 为 0。
4. 本流程只允许开发库导入。R1-15/R1-18 的生产清理与 release-1 重建需要独立授权。

## 4. 构建与预检

每个 package 分别执行：

```powershell
pnpm cw:aixuexi:build -- --package-key 2026-gplus-sujiao-math
pnpm cw:aixuexi:build -- --package-key 2026-xplus-sujiao-math
pnpm cw:aixuexi:build -- --package-key 2026-aplus-quanguo-math
pnpm cw:aixuexi:build -- --package-key 2026-summer-aplus-quanguo-math

pnpm cw:aixuexi:import -- --package-key 2026-gplus-sujiao-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL --dry-run
pnpm cw:aixuexi:import -- --package-key 2026-xplus-sujiao-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL --dry-run
pnpm cw:aixuexi:import -- --package-key 2026-aplus-quanguo-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL --dry-run
pnpm cw:aixuexi:import -- --package-key 2026-summer-aplus-quanguo-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL --dry-run
```

只校验合同而不复制 H5 文件时，在 build 命令末尾加 `--metadata-only`。当前完整构建结果：

| package | 讲次/页面 | usages | CAS 对象 | H5 包/包内文件 |
| --- | ---: | ---: | ---: | ---: |
| G+ | 56/1641 | 11132 | 1213 | 59/2551 |
| X+ | 84/2767 | 19729 | 2740 | 70/3086 |
| A+ | 30/1034 | 15591 | 2137 | 87/4931 |
| A+ 暑期开发增量 | 2/66 | 550 | 171 | 7/377 |

`CW_IMPORT_DATABASE_URL` 只登记经 `.env.local` attestation 的本机数据库目标，不能写入仓库或命令日志。即使是 `--dry-run` 也必须显式传 `--local-docker`；省略后导入器会走 SSH 路径，禁止在本流程使用。

范围漂移、projection 版本错误、Viewer seam/指纹漂移、离线验证不完整、未登记外部 URL、缺失资源、hash/字节数不符或不安全标记都必须非零退出。

## 5. 导入与幂等重跑

```powershell
pnpm cw:aixuexi:import -- --package-key 2026-gplus-sujiao-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL
pnpm cw:aixuexi:import -- --package-key 2026-xplus-sujiao-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL
pnpm cw:aixuexi:import -- --package-key 2026-aplus-quanguo-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL
pnpm cw:aixuexi:import -- --package-key 2026-summer-aplus-quanguo-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL
```

可追加 `--start-at <1-based-index> --limit <count>` 分批运行；索引按 `lectures.ndjson` 稳定顺序，不是讲号。每讲先上传内容寻址对象，再用单个数据库事务写来源映射、页面、revision、两轨 binding/release/head。中断后从失败项重跑；`conflicts` 和未解释的 `baselineDrift` 必须为 0，已存在对象和行只报告 existing。

## 6. v31 → source-runtime 版本化升级

已有 `aixuexi-page-doc-v1` 不能覆盖或删除。只在已 attestation 的本机 Docker 开发库显式执行：

```powershell
pnpm cw:aixuexi:import -- --package-key 2026-gplus-sujiao-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL --upgrade-source-runtime
pnpm cw:aixuexi:import -- --package-key 2026-xplus-sujiao-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL --upgrade-source-runtime
pnpm cw:aixuexi:import -- --package-key 2026-aplus-quanguo-math --local-docker --database-url $env:CW_IMPORT_DATABASE_URL --upgrade-source-runtime
```

升级事务逐页断言当前两轨都仍指向导入基线、没有 draft/partial drift，随后新增 `revision_no=2`，为两轨分别新增 `release_no=2` 并切换 current heads；旧 revision/release 和其 snapshot 原样保留。binding 集合按新文档精确对账。`baselineDrift` 中被同一事务完整解释的页面计入 `sourceRuntimeUpgraded`，批量汇总只报告剩余未解释 drift。

默认路径仍只允许本机开发库。远程升级必须同时具备当前产品负责人对这一批生产升级的明确指令、写前只读 preflight、新鲜 PostgreSQL+Storage 备份、精确 current-head 回退 manifest、已部署的兼容应用与 migration，并额外打开第二道一次性保险丝：

```powershell
$env:MATHIN_WRITE_TARGET_ENVIRONMENT = 'production'
$env:MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN = 'https://supabase.mathin.club'
$env:MATHIN_WRITE_ALLOWED_SUPABASE_ORIGINS = 'https://supabase.mathin.club'
$env:MATHIN_WRITE_ALLOWED_SSH_TARGET = 'xiaomi'
$env:MATHIN_WRITE_TARGET_FINGERPRINT = '10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c'
$env:MATHIN_PRODUCTION_WRITE_CONFIRMATION = 'cw:import:10e3f97e32b01840'
$env:MATHIN_PRODUCTION_SOURCE_RUNTIME_UPGRADE_CONFIRMATION = 'cw:import:source-runtime-upgrade:10e3f97e32b01840'

pnpm cw:aixuexi:import -- --package-key 2026-gplus-sujiao-math --ssh-host xiaomi --upgrade-source-runtime --allow-production-target --allow-production-source-runtime-upgrade
```

三个秋季包必须逐包执行并核对 `conflicts=0`、未解释 `baselineDrift=0`。第二道确认只从当前进程环境读取；`.env.local` 中的同名值无效。普通生产导入不能携带 `--allow-production-source-runtime-upgrade`，缺少任一 CLI 开关或确认值时必须在 Storage/SQL 写入前失败。发布完成后立即清除当前 Shell 的全部生产 attestation。

生产回退只按写前 manifest 把 lecture/page current head 恢复到旧 release/revision；旧 revision 1、release 1、snapshot 和对象不得删除或改写。新上传的内容寻址对象保持不可变，不在故障窗口执行 Storage 清理。

暑期 A+ 是生产目录中的新课程，不制造一轮旧适配器历史：先应用版本化目录 migration 建立 15 讲空壳，再以普通受控生产导入通道直接导入 `source-runtime-v1`。第 1、8 讲从 revision/release 1 开始，其余 13 讲保持空模板、0 页面、0 release。

## 7. 验收

```powershell
pnpm test -- tests/aixuexi-courseware.test.ts tests/aixuexi-source-runtime.test.ts tests/cw-import.test.ts tests/cw-h5-shim.test.ts
pnpm typecheck
pnpm lint
pnpm messages:check
pnpm build
```

Production 1.0 当前批准事实仍是：3 个 imported source package、12 门课程、180 条教学计划讲次（170 条 source-backed、10 条未发布占位）、5442 页的 projection v31 release-1；两轨各 170 release/head、5442 页面 head、27541 binding。该数值只描述尚未升级的生产 baseline，不得用本地 source-runtime 结果静默改写。

本机完成三套秋季升级后，170 条 source-backed 讲次的当前两轨头应全部指向 `source-runtime-page-v1` revision 2 / release 2，共 5442 页、46452 个当前文档 binding；旧 v31 revision 1 / release 1 仍可按历史 ID 读取。导入暑期开发增量后，开发库爱学习目录合计为 4 个 imported source package、13 门课程、195 条教学计划讲次（172 条 source-backed、23 条未发布占位）、5508 页，当前 source-runtime 文档共 47002 个 binding。

暑期目标课程必须精确为 15 讲；第 1、8 讲分别为 34/32 页并各有两轨 revision/release 2 current head，其余 13 讲保持空模板、0 页面、0 release。重复导入必须 Storage 零上传、数据库零 conflict/零未解释 drift。

2026-08-27 本机 postflight 已达到该合同：四包均为 `imported/source-runtime-v1`；两轨各 5508 个 current page head、172 个 release-2 lecture head和 47002 个 current release binding；历史 revision 1 与新 revision 2 各 5508 页，current head 缺失和 legacy/native head 不一致均为 0。该证据只覆盖本机 Docker 开发库，不证明生产状态。

浏览器至少抽查：普通题目 4:3 外框内的来源 16:9 舞台；橙色“开始”按钮的源文案、类名和 `(434,690,332×90)` 几何；A+ 动画逐步揭示；X+ embedded H5；ITV、TrueOrFalse 和 TopicClassification 的源样式与交互；显式第 7/15 讲及暑期 13 讲占位；zh/en Studio 标签。加载遮罩必须在来源 `rendered` 后消失，点击“开始”必须打开 `/api/cw-h5/` 本地路由，页面不得出现 Mathin 重造的“进入互动”按钮。外层来源 runtime iframe 不加 `allow-same-origin`；来源 Viewer 内部 H5 按已审计 source sandbox 运行。

支持证据见 [R1-9 爱学习 v31 证据](../evidence/r1/r1-9-aixuexi-courseware.md)。
