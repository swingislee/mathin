# Mathin 整体规划 · 16 P6 课件资产平台（魔法校迁移 / 4:3 适配 / 教研中台与版本管理）

> 本文是 P6 的权威执行计划，地位等同 `08-p4-classroom-whiteboard.md` 之于 P4。前置阅读：`00-overview.md`、`04-roadmap.md`、`10-school-backend.md` §4.3（模板/覆盖层/冻结）、`08-p4-classroom-whiteboard.md` §3.4/§3.6（课堂离线栈与课件页模型）。
>
> **源项目**：`D:\code\2026\2026-07_mofaxiao_courseware`（下称「镜像项目」）——一套已基本竣工的课件资源镜像系统，其权威约束见该仓库 `AGENTS.md` 与 `README.md`。**凡在镜像项目内执行的任务，必须遵守镜像项目自己的工程约束**（原始输入只读、CAS 不可变、集合对账、测试纪律），本文不复述、不覆盖。
>
> P6 三大目标（用户 2026-07-17 提出）：
> ① 全量课件资源迁入 mathin 数据后端，绑定到既有 865 讲课程体系，前端**严格按原 JSON 布局**加载（资源/H5/动画全部正常）；
> ② 16:9 → 4:3 整体适配（原课件大量保留 4:3 痕迹，部分可批量转化，原生 16:9 页需迁移方案与预案）；
> ③ 教研中台：教研可视化调整课件（改文字/挪图/加元素/调页），迭代跨 1–2 年，必须有版本管理。

---

## 1. 范围与非目标

**做**：

1. 镜像项目 → mathin 的可移植发布包 v2（页面文档 + 全类型资产 + H5 包 + 讲次映射）。
2. mathin 侧课件资产层：CAS 对象、公共资源、资源版本、页面绑定（按镜像项目 `docs/discussion/公共资源与课件资源替换机制讨论稿.md` 的模型，下称「讨论稿」）。
3. 原布局渲染器：把镜像 Viewer 的实装渲染 + 交互执行器移植为 mathin React 组件，接入课堂（备课/候课/上课/试讲）。
4. 4:3 适配（双轨，§6）：「16:9 顶置」兼容模式打底（渲染层，零数据改动）＋可选真 4:3 流水线（页面自动分类 → 批量派生 → 人工审校队列，按讲灰度）。
5. 教研中台：课程 → 讲 → 页导航、页面编辑、公共资源批量替换、revision/release 版本管理。

**不做**（除非用户重启议题）：

- 不重写镜像项目管线；镜像项目继续负责「源事实」（源 JSON、CAS、H5 patch、渲染模型生成）。mathin 只消费发布包，**不直读镜像 SQLite**。
- 不做 H5 内容的二次开发；`development_pending` / `online_only` / `auth_required` 等非 offline 终态 H5 在 mathin 以占位卡呈现，与镜像 Viewer 同语义。
- 第一期公共资源批量替换只覆盖**图片**（讨论稿 §18-7 的建议）；视频/音频/H5 有正式版本体系但不做批量替换 UI。
- 不做课件内容双语化：课件是中文教学资产，仅中台 UI 文案走 next-intl。
- 不做资源垃圾回收（revision 永久保留，GC 政策留待数据量成为问题时议）。

---

## 2. 两侧现状盘点（2026-07-17 已核实）

### 2.1 镜像项目（供给侧）

| 资产 | 规模/位置 | 状态 |
| --- | --- | --- |
| 课程体系 | 72 产品（年级×季节×班型，MFHK 编码）、865 讲、55,110 页 | 全量管线验收过 |
| 普通资源 CAS | 58,013 对象，实体 22GB，`store/objects/sha256/` | SHA-256 内容寻址，不可变 |
| H5 包 | 19GB，`store/h5/packages/*/patched/` | offline 终态可离线 iframe；其余为明确终态 |
| 页面渲染模型 | 每页 `page.render.json`（`page-render-v1`，zod schema 在 `src/render/model.ts`） | 全量生成；398 页视觉验证 0 failed |
| 渲染器参考实现 | `src/viewer/viewer-app.ts` 的 `renderedNodeHtmlV2` + WAAPI 交互调度器（`runAuto`/`runClick`/`frames`） | 覆盖全部已审计节点与 `auto/click/same/follow` × `enter/exit/emphasize/path` 交互 |
| 稳定键导出 | Stage 23 `export mathin-assets`：`usageKey`/`candidateKey`、NDJSON 发布包 | **只覆盖 kind=image**；v2 需扩展 |
| 文本审校覆盖 | Stage 24 `text_layout_overrides`（节点级排版覆盖） | 工具链完成；迁移时应转为 mathin 页 revision |

节点分布（`docs/阶段22_页面Schema审计.md`）：richText 105,718、img 31,345、group 4,923、h5Link 4,378、svg 4,086、video 3,627、svgShape 329、table 198、mathVertical 8。**视频清一色 4:3（960×720 居左）**，画布 1280×720。

### 2.2 mathin（接收侧）

- `courses` 72 行（`product_code` = MFHK 编码）、`course_lectures` **865** 行（2026-07-17 P6-0 对账完成：原缺 MFHK01863 第 15 讲《共角三角形》，seed 文件本有该行、库漏应用，已补齐，现与镜像 865 讲全对齐）、`courseware_template` 全部为空 `[]`。**对账发现的映射别名**：镜像 library 中 `1年级/暑期/A` 的产品目录名为 `class_d8f534b70b9d9f3d7952`（源站缺 MFHK 编码），即 mathin 的 `MFHK00621`（E系列数学一年级暑期A[全国版]，10 讲逐一对上）——P6-1 讲次映射清单必须包含这条别名。
- 课件机制已闭环：`course_lectures.courseware_template`（页数组，1MB check）→ 教师覆盖层 `class_sessions.courseware_overlay`（ref/page 排列，禁删禁改模板页）→ 开课冻结写 `class_sessions.courseware`（10-§4.3）。**P6 不改这套机制，只新增页型**。
- 课堂页型 `CoursewarePage`（`src/features/classroom/types.ts`）：`image | video | game | board`；上课页 `LiveShell.tsx` 按 type 分发舞台；候课预载走 IndexedDB blob（`sync/idb.ts`）。
- Storage 桶：`note-assets`、`courseware`、`course-assets`、`session-videos`（均私有）。
- RBAC：`has_perm` + `PERMISSION_KEYS` 常量；教研角色 `research` 已有 `courseware.template.edit`。
- 部署：自托管 Supabase 于 xiaomi（192.168.5.183，Docker）。**迁移前必须核查宿主机磁盘余量 ≥ 60GB**（42GB 资产 + 冗余）。

---

## 3. 架构决策（D1–D8，执行 agent 不得自行推翻）

### D1 页面权威格式 = `page-doc-v1`（由 `page-render-v1` 衍生，不是源 JSON）

mathin 存储与渲染的页面文档基于镜像的**渲染模型**而非魔法校源 JSON。理由：源 JSON schema 杂乱（字段别名、隐式默认、历史图元），镜像项目已花 20+ 个阶段把它规范化成经全库审计的 render model；mathin 复用这份成果，不再解析源格式。

`page-doc-v1` = `page-render-v1` 去掉本地环境字段（`libraryPath`、`availableLocally`、`resourceRefId` 本地自增 id），资源引用一律改为 **`bindingKey`**（= Stage 23 的 `usageKey`，跨库稳定）：

```jsonc
// 节点内资源引用（对比 render-v1 的 resources[]）
{ "bindingKey": "sha256…", "role": "source", "kind": "video" }
// 交互内音频引用同理：audioBindingKey
```

溯源字段保留：`sourceCoursewareId`、`sourcePageId`、`sourcePageDatabaseId`、`sourceSnapshotId`、`sourceContentHash`（D8 ⑥；以冻结的 `schema.ts` 为准）。canvas、transform、style、content、interactions 结构原样继承 render-v1（含 sanitized HTML/SVG——导入时 mathin 服务端**再消毒一遍**，不信任外部包）。schema 冻结为 `page-doc-v1` 并配 zod（放 `src/features/courseware-doc/schema.ts`），此后只能带版本号演进。

### D2 资源三层模型（按讨论稿 §七，全类型建正式表）

```
页面节点 → page_asset_bindings → shared_assets → asset_revisions → asset_objects(SHA-256)
```

- `asset_objects`：不可变 CAS 事实，覆盖 image/video/audio/h5/svg 全 kind。
- `shared_assets`：教研语义单元，初始由 `candidateKey`（hash+kind+role）自动生成，**允许后续人工合并/拆分/更名**（讨论稿 §十五-7）。
- `asset_revisions`：版本链，`variant ∈ {source, mathin-4x3, manual-edit}`，`derived_from_revision_id` 记派生关系。4:3 图**永远是新 hash 新 revision**，绝不覆盖旧对象（讨论稿 §六）。
- `page_asset_bindings`：页 doc 里的 `bindingKey` → shared_asset（+ 可选 `pinned_revision_id`）。
- 运行时解析链：`bindingKey → shared_asset → published_revision → object → Storage URL`。批量替换 = 推版本指针或建分支重绑，**不重写页面 JSON**（讨论稿 §九/§十五-4）。

### D3 存储布局与 H5 服务方式（2026-07-17 用户拍板，见 §10）

- 新私有桶 `cw-objects`：CAS 路径 `sha256/<前2位>/<完整hash>`，上传时带正确 MIME。**读范围收紧（拍板第 4 项）**：不采用 authenticated 全开。storage 读策略 = staff（中台/备课直读）；学生**不直读桶**——候课时由 Server Action 校验教室成员身份后，按该课次 `courseware_resolved` 的对象清单**批量签发 signed URL**（服务端 secret key 签发，沿 P2 排名服务的 `SUPABASE_SECRET_KEY` 环境先例；有效期覆盖候课窗口，建议 6 小时——blob 一旦落 IndexedDB，URL 过期无影响；补拉失败则重新请求批签）。insert/delete = 仅 service key（导入脚本）与 `courseware.asset.manage` 权限的 RPC。**staff「直读」的落地方式**：浏览器 `<img>`/`<video>` 标签无法携带 Authorization 头，故 staff 直读 = 用**用户自己的 token 调 `createSignedUrl`**（RLS select 策略即签名授权）或 fetch→blob，不是裸 URL；教师候课预载**不另开路径**，与学生统一走 `getSessionAssetUrls`（教师同为教室成员），中台/备课浏览才用 staff 自签。
- 新桶 `cw-h5`：**public 桶（拍板第 1 项）+ mathin HTML 垫片（spike 结论）**。H5 patched 包**整目录结构上传**，路径 `packages/<packageHash>/<包内相对路径>`。拍板理由：iframe 子资源请求无法携带鉴权（签名 URL 覆盖不了包内成百上千个子请求），private 桶技术上不可行；路径含 packageHash 不可枚举。**性能顾虑与候课预载咬合**：P6-5 在候课阶段对本课 H5 包做 HTTP 缓存预热（按包文件清单逐文件 fetch，暖浏览器缓存）——只是加速，不构成离线保障，候课单仍按 D4 黄灯语义。
- **P6-0 ③ spike 已完成（2026-07-17，真实包 `0012489b…` 15 文件实测）**：css/js/svg/png/mp4/json 均按上传 metadata 正确直出；**唯 `text/html` 被 storage-api（v1.60.4）有意降级为 `text/plain`**（防钓鱼设计，自托管无开关，官方讨论 [#2557](https://github.com/orgs/supabase/discussions/2557)/[#7377](https://github.com/orgs/supabase/discussions/7377)/[#39110](https://github.com/orgs/supabase/discussions/39110)）。**定案：不引 nginx**，mathin 加 Route Handler 薄垫片 `/api/cw-h5/[...path]`——`.html`/`.htm` 路径服务端 fetch 后以 `text/html` 直出（内容寻址路径，`Cache-Control: immutable` 长缓存）；其余扩展名 302 到 storage public URL（浏览器对子资源自动跟随，MIME 由 storage 供给）。iframe src 指向垫片路径，包内相对引用沿垫片路由自然解析。**后果一：iframe 变同源**——sandbox 属性必须不含 `allow-same-origin`（保持 opaque origin 隔离），P6-4 落实。**后果二：TLS 自动跟随站点协议**，nginx 备选正式关闭。导入 CLI 上传时设 `cacheControl: 31536000`（内容寻址永不变）。
- **垫片实现细节（2026-07-17 评审补充；实现归属 P6-4）**：①`src/proxy.ts` 的 matcher 已排除 `/api`（已核实），垫片路由不需要改 proxy。②子资源重定向用**可缓存的 308**（响应带 `Cache-Control: public, max-age=31536000, immutable`）——内容寻址路径永不变，让浏览器把重定向本身也缓存住，二次加载不再穿透 mathin 服务器；`.html`/`.htm` 之外的扩展名一律重定向。③安全：只接受 `packages/` 前缀，拒绝含 `..` 的路径段。④iframe src 用包 manifest 的 `entryPath`，不硬编码 `index.html`。
- **H5 包 manifest（2026-07-17 实查修正，P6-1 已落地）**：镜像包自带的 `package.json` 描述的是 **original 捕获内容**，而 `patched/` 含补丁新增文件（`__h5_vendor__` 等）——不能直接复用。v2 导出（P6-1 `export mathin-package`）**按 patched 目录实际内容现场生成** `h5-manifests/<hash>.json`（`mathin-h5-manifest-v1`：`entryPath` + `files[]` 的 `packagePath`/`sha256`/`byteCount`/`mime`，mime 优先取 original 清单、缺失退化扩展名推断）。导入 CLI 把该 manifest 上传为 `packages/<hash>/__mathin_manifest.json`。它一物三用：①上传 contentType 以 manifest 的 `mime` 为权威；②候课 H5 预热的文件清单来源（P6-5 从公开桶 fetch manifest 再逐文件预热）；③逐文件 sha256 供对账/完整性核对。

### D4 与课堂机制的接缝：新增页型，机制零改动

`CoursewarePage` union 新增：

```ts
| { id: string; type: "doc"; docId: string; title: string }
```

- `course_lectures.courseware_template` = 该讲全部 doc 页引用的有序数组（导入自动生成）。引用极小，1MB check 无压力；页面正文在独立表（§4）。
- 覆盖层/resolve/冻结逻辑**一行不改**——doc 页对 overlay 来说就是一种模板页。
- **冻结增强**（唯一改动点）：开课冻结事务在写 `class_sessions.courseware` 时，同步把每个 doc 页的 bindings 解析结果（bindingKey → revision_id → objectHash）物化进 `class_sessions.courseware_resolved jsonb`。已开课/已结课永远用冻结时的资源版本（讨论稿 §十二）；教研后续发布不影响历史课。
- 候课预载：枚举 doc 页 resolved bindings → 经批签 signed URL（D3）逐对象下载 blob 入 IndexedDB（复用现有 `sync/idb.ts` 管道）；本课 H5 包同时做 HTTP 缓存预热（D3）。**H5 页无法 blob 预载**（多文件包），候课单上 H5 页单列「需在线」黄灯——含 H5 的课离线保障降级，这是已知边界，不糊弄成绿灯（预热只改善在线首开速度，不改变黄灯语义）。

### D5 渲染器 = 移植 Viewer 实装渲染 + 交互执行器为 React 组件

新 feature 目录 `src/features/courseware-doc/`：

```
schema.ts        # page-doc-v1 zod schema（服务端导入校验 + 客户端类型）
resolve.ts       # bindingKey → URL/blob 的解析接口（可注入：在线 signed URL / 课堂 IndexedDB blob）
DocStage.tsx     # "use client"：节点树渲染（对齐 renderedNodeHtmlV2 语义：transform/crop/裁切窗口/
                 #   richText/shape SVG 图元/table/mathVertical/video/audio/h5 iframe/unknown fallback）
interactions.ts  # WAAPI 交互调度（runAuto/runClick/same/follow 步骤组、enter/exit/emphasize/path、audioConfig）
```

- 语义以镜像 `viewer-app.ts` 为**行为基准**：同一 doc 在 mathin 与镜像 Viewer 渲染结果应视觉一致。验收用 Playwright 对样本课逐页截图比对（allow 抗锯齿容差）。
- 遵守本仓客户端边界铁律：`DocStage` 是交互体可以整体 client，但必须 `next/dynamic` 懒加载（参照 `games/boards.tsx` 模式），页面壳保持 Server Component；动手前后跑 `pnpm bundle:report`。
- 舞台图片视频沿 08-§3.6 豁免：原生 `<img>`/`<video>` + blob URL，不用 `next/image`。
- richText 字体：不做全库字体替换（镜像 Stage 24 结论）；镜像侧已保存的 `text_layout_overrides` 在导入时合并进对应页的 doc（作为导入基线的一部分），后续排版修正走教研中台页编辑。

### D6 版本管理：页 revision（append-only）+ 讲 release + 课次冻结 pin

三层互不混淆，支撑「单讲改一周、整体迭代 1–2 年」：

```
cw_page_docs        页身份（讲内稳定，一页一行）
cw_page_revisions   页内容版本：每次教研保存 = 新 revision（doc jsonb 全量快照，append-only，不可改写）
cw_lecture_releases 讲发布：一次发布 = 冻结「页 → revision」映射的快照；模板 resolve 永远读“当前 release”
class_sessions      课次冻结：开课时 pin 到当时 release 的解析结果（D4）
```

- 教研日常编辑产生 **draft revision**（`cw_page_docs.draft_revision_id`），预览可看草稿；「发布本讲」把全部草稿收进新 release 并推 `current_release_id`。未发布的草稿不影响任何班级。
- 回滚 = 发一个指向旧 revision 集的新 release（永远向前，不删历史）。
- 导入基线 = 每页 revision 1（`origin='import'`），不可编辑不可删，任何时候可 diff/回退到基线。
- 资源版本（D2 的 asset_revisions）与页版本正交：页 revision 记录的是布局/内容，资源替换走 shared_asset 版本指针。release 快照两者都 pin（页 revision id + 当时各 binding 的 published revision id），保证 release 可精确复现。

### D7 4:3 适配 = 「16:9 顶置」兼容模式打底 + 派生 revision 按讲灰度增强（2026-07-17 用户拍板，见 §10）

详见 §6。双轨：**轨道一（默认，零数据改动）**——课堂舞台保持 4:3，16:9 页等比缩放后**顶端对齐**渲染，下方约 25% 舞台高度成为教师板书带，画板/批注层仍覆盖整幅 4:3；全部 55,110 页开箱即用，4:3 迁移不再阻塞任何任务。**轨道二（可选增强，按讲灰度）**——对值得投入的讲做真 4:3 版：每页一条 `origin='adapt-4x3'` 的 draft revision（画布 960×720 + 变换后的节点/交互坐标）+ 派生资产 revision（4:3 背景等，新 hash、`derived_from` 指向源）；16:9 基线 revision 与源资产永不修改，哪一版生效由讲 release 决定。

### D8 导入管道 = 镜像 v2 发布包 → mathin 幂等导入 CLI，全程集合对账

- 镜像侧（在镜像仓库执行，遵守其 AGENTS.md）：新增 `export mathin-package`（v2）——在 Stage 23 基础上扩展：①全 kind 资产（image/video/audio/svg + H5 包清单）；②每页 `page-doc-v1` 文档（含 text_layout_overrides 合并、bindingKey 替换）；③讲次映射清单（MFHK 产品码 + 讲次号 + 源 coursewareId + 页序）；④exclusions 有因计数；⑤manifest + schema + 逐项 hash，独立 audit 命令；⑥**每页记录源快照内容 hash（`sourceContentHash`：对该页源 JSON 做规范化序列化——键递归排序、无空白、UTF-8——后取 sha256；规范化函数在镜像仓库实现并配测试，未来 diff 工具必须能逐字节复现）**——这是「不做增量导出」拍板（§10 第 5 项）的低成本反悔钩子：将来若魔法校源更新需要增量对接，凭此 hash 即可 diff 出变更页，不必重建导出体系。
- mathin 侧：`scripts/cw-import.mjs`（Node CLI，读发布包目录，经 Supabase service key 直传 Storage + 经 SSH psql 批量入库）。**幂等**：对象按 hash 跳过已存在；页/绑定按稳定键 upsert-if-absent；**绝不覆盖 origin≠'import' 的 revision**（教研已改的页，重导入只报告差异不动数据）。每讲导入后输出对账：包内对象数/usage 数/页数 = 库内新增+已存在+跳过（含原因），不平即失败退出。
- 分阶段执行：先样本讲（101001827《迷宫连线》B 版，镜像项目的固定回归样本）→ 一个年级 → 全量。

---

## 4. 数据模型（migrations，经 SSH 执行，流程同 CLAUDE.md）

全部 `public` schema、全开 RLS。列级草案（执行时保持列名）：

```sql
-- D2 资源三层
cw_asset_objects (
  id uuid pk default gen_random_uuid(),
  sha256 text unique not null, mime text not null, byte_count bigint not null,
  width int, height int,                    -- 图片/视频有值
  kind text not null check (kind in ('image','video','audio','svg','h5')),
  storage_path text not null,               -- cw-objects 桶内路径；h5 为 cw-h5 包根
  source_url text,                          -- 溯源，仅审计
  created_at timestamptz not null default now()
)
cw_shared_assets (
  id uuid pk, name text not null default '',            -- 初始空，教研可命名
  kind text not null, role text not null,
  candidate_key text unique,                             -- 导入稳定键；人工拆分出的新资源为 null
  draft_revision_id uuid, published_revision_id uuid,    -- 后补 FK
  created_by uuid references profiles, created_at, updated_at
)
cw_asset_revisions (
  id uuid pk, shared_asset_id uuid not null references cw_shared_assets on delete cascade,
  revision_no int not null, object_id uuid not null references cw_asset_objects,
  derived_from_revision_id uuid references cw_asset_revisions,
  variant text not null default 'source',                -- source|mathin-4x3|manual-edit
  note text not null default '', created_by uuid, created_at,
  unique (shared_asset_id, revision_no)
)
cw_page_asset_bindings (
  id uuid pk, page_doc_id uuid not null references cw_page_docs on delete cascade,
  binding_key text not null,                              -- = 导出包 usageKey
  role text not null, kind text not null,
  shared_asset_id uuid not null references cw_shared_assets,
  pinned_revision_id uuid references cw_asset_revisions,  -- null=跟随 published
  launch_query jsonb,                                     -- 仅 h5：{query, coursewareIdParam}，渲染 iframe 时拼回（P6-1 发现：
                                                          -- 多页共享同一 H5 包、按 query 区分关卡，丢 query = 全部变第一关）
  unique (page_doc_id, binding_key)
)

-- D6 页与版本
cw_page_docs (
  id uuid pk, lecture_id uuid not null references course_lectures on delete cascade,
  page_no int not null,                                   -- 讲内序
  title text not null default '',
  source_courseware_id text, source_page_id text,         -- 溯源
  aspect text not null default '16:9' check (aspect in ('16:9','4:3')),  -- 当前发布版画布形态（冗余展示用）
  draft_revision_id uuid, current_revision_id uuid,       -- current = 最新 release 中的版本
  deleted_at timestamptz,                                 -- 软删（教研删页）
  unique (lecture_id, page_no) deferrable initially deferred   -- 排序重排需要
)
cw_page_revisions (
  id uuid pk, page_doc_id uuid not null references cw_page_docs on delete cascade,
  revision_no int not null, doc jsonb not null,           -- page-doc-v1，1MB check 同款
  origin text not null check (origin in ('import','edit','adapt-4x3','revert')),
  base_revision_id uuid references cw_page_revisions,
  note text not null default '', created_by uuid, created_at,
  unique (page_doc_id, revision_no)
)
cw_lecture_releases (
  id uuid pk, lecture_id uuid not null references course_lectures on delete cascade,
  release_no int not null, note text not null default '',
  snapshot jsonb not null,     -- [{pageDocId, revisionId, bindings:[{bindingKey, assetRevisionId, launchQuery?}]}]；H5 query 随 release 固定，1MB 超限时拆子表
  published_by uuid, published_at timestamptz not null default now(),
  unique (lecture_id, release_no)
)
alter table course_lectures add column current_release_id uuid references cw_lecture_releases;

-- D8 批量替换审计（P6-8 期落地，随讨论稿 §7.5/7.6）
cw_replacement_batches ( id, source_shared_asset_id, target_shared_asset_id, new_revision_id,
                         mode check in ('publish_pointer','branch_rebind'), selected_usage_count,
                         status, created_by, created_at )
cw_replacement_items   ( batch_id, binding_id, before/after shared_asset_id + revision_id, lecture_id, page_doc_id )

-- 冻结物化（D4）
alter table class_sessions add column courseware_resolved jsonb;
```

`cw_asset_objects` 的 h5 行约定（导入 CLI 遵守，避免临场发挥）：`sha256` = packageHash、`mime` = `application/x-mathin-h5-package`、`byte_count` = 包总字节（manifest `byteCount`）、`storage_path` = `packages/<packageHash>`、`width`/`height` = null。

RLS 基线：全部表 select = `is_staff`（学生/家长不直读——学生只经冻结后的 `class_sessions.courseware`+`courseware_resolved` 取数，沿既有 classroom RLS）；写 = 新权限键（§7.1）经 Server Action/RPC，表级不授 insert/update/delete 的直写（跨页批量与版本指针推进走 SECURITY DEFINER RPC，同 10-§4.5 纪律）。

新权限键（加入 `PERMISSION_KEYS` 常量 + 内置 research 角色默认画像）：`courseware.page.edit`、`courseware.asset.manage`、`courseware.release.publish`。`courseware.template.edit` 保留原义（模板页数组的排布）。

---

## 5. P6 前端架构

```
src/features/courseware-doc/     # D5 渲染器（schema/resolve/DocStage/interactions）
src/features/courseware-studio/  # 教研中台（§7）：导航树、页编辑器、资源面板、版本时间线
src/app/[locale]/dashboard/courseware/                    # 中台路由（requirePerm 分键校验）
  page.tsx                       # 课程网格（复用 school 课程查询）
  [courseId]/page.tsx            # 讲次列表 + release 状态
  [courseId]/[lectureId]/page.tsx        # 页缩略图墙 + 页编辑入口 + 发布面板
  [courseId]/[lectureId]/[pageId]/page.tsx  # 页编辑器（DocStage 预览 + 属性面板）
scripts/cw-import.mjs            # D8 导入 CLI
```

- 中台全部页面 Server Component 壳 + 叶子交互（编辑器画布是交互体，整体 client + dynamic）。
- 双语：中台 UI 文案 `messages/{zh,en}.json` 新增 `coursewareStudio.*`；课件内容本身不译。
- Suspense 就绪纪律照 AGENTS.md：每个读请求期数据的子树包 `<Suspense>` 或配 `loading.tsx`。

---

## 6. 4:3 适配整体方案（2026-07-17 拍板：双轨制）

### 6.0 拍板结论与逻辑

用户 2026-07-17 拍板：**「16:9 顶置」兼容模式为默认打底，真 4:3 转换降级为可选增强轨、按讲灰度**。逻辑：16:9 内容进 4:3 画幅的唯一实质损失是页面文字变小，但把 16:9 页固定在 4:3 页面**顶端**、下方留出整条空白带之后，这个损失换来的是**教师板书空间变大**——对课堂是净收益。由此全量课件不经任何数据转换即可在 4:3 课堂使用，4:3 迁移从「阻塞性工程」变为「质量增强」，D 类（需人工重排）页不再构成排期木桶。

### 6.1 轨道一：16:9 顶置兼容模式（渲染层行为，零数据改动）

- 课堂舞台维持 4:3（08-§2.1 不变），**画板/批注层覆盖整幅 4:3**——白板 op 坐标系与现状完全一致。
- doc 页 canvas 为 1280×720 时，DocStage 以舞台宽度等比缩放并**顶端对齐**：内容占舞台上部 75% 高度（(720/1280)÷(3/4)=0.75），下方 25% 为板书带。板书带底色实现时定（取页背景主色延伸或中性色，保证与内容区不割裂）。
- 交互点击命中、path 动画、richText 排版全部包在「等比缩放 + 顶对齐」这一个统一仿射里完成——**纯渲染变换，doc 数据一个字不改**。
- canvas 为 960×720（轨道二真 4:3 revision 生效的页）时满幅渲染、无板书带；两种画幅可在同一讲混存（灰度期间）。
- 落点：这是 **P6-4 渲染器 / P6-5 课堂接入的内建行为**，不是独立任务，验收断言写进 P6-4。

### 6.2 轨道二：页面自动分类（在镜像项目执行，只读分析）

事实基础：原课件 1280×720（16:9），目标 960×720（4:3）。有利事实：视频全部原生 4:3（960 宽居左）；大量页面内容集中在左侧 960px（源课件本就是 4:3 迁 16:9 的产物）；背景是独立 role，可整批换。不利事实：仍有原生 16:9 满铺页（大图、满版动画、16:9 H5），且**各类占比未知——先审计再排产能，禁止拍脑袋估工作量**。轨道一打底后，本轨道**无排期压力**：分类审计照做（成本低、为投产决策提供数字），转换按教研判断的价值排序逐讲推进。

新增分析命令：对每页 render model 计算**可见非背景节点的联合包围盒**与越界成分，输出每页分类：

| 类别 | 判定 | 处置 | 预期自动化程度 |
| --- | --- | --- | --- |
| A 纯左置 | 包围盒 ⊆ [0,960]×[0,720]，右侧仅背景 | 裁画布 + 换 4:3 背景，坐标不动 | 全自动 |
| B 轻越界 | 越界节点均为装饰（无交互、无资源绑定或仅背景性质），或整体平移 ≤64px 可收纳 | 自动平移/收纳 + 换背景 | 自动 + 抽检 |
| C 满铺可缩 | 内容满铺但同构（单图/单视频/单 H5 满版） | 等比缩放 letterbox（上下留边或 shell 内居中） | 全自动 |
| D 需重排 | 多节点分布依赖 16:9 构图（左右双栏、横向流程图、path 动画横穿全屏） | 进人工审校队列，教研中台逐页改 | 人工 |
| E H5 特殊 | h5Link 节点尺寸 >960 宽 | 节点等比缩入 4:3（H5 内部运行时不改），交互命中区同步 | 全自动 + 抽检 |

分类报告（NDJSON + 汇总表）进发布包，mathin 导入为页的 `adapt_class` 标注，驱动审校队列排序。**交互坐标随节点变换**：平移/缩放页时 `interactions[].path.points` 与节点 transform 同一仿射变换，脚本统一处理，禁止只挪节点不挪动画路径。

### 6.3 资产派生

- 背景：按 shared_asset 维度批量处理。源 16:9 背景 → 派生 4:3 版（居左裁切 320px 为默认策略；纯色/纹理背景可直接重心裁切），新 hash 入 CAS，`asset_revisions.variant='mathin-4x3'`、`derived_from` 指源。派生自动执行、**人工确认后才发布**（讨论稿 §18-3 取推荐项）。
- 内容图：A/B 类不动原图；C 类不裁图（靠节点缩放）；确需裁切的进教研手工流程（导出工作副本 → 编辑 → 上传新 revision，讨论稿 §六流程，**严禁触碰镜像 hardlink**）。
- 视频：零处理——4:3 页内视频节点天然满窗。

### 6.4 生效与灰度

4:3 版 = 每页一条 `origin='adapt-4x3'` 的 draft revision。**按讲发布、按讲回滚（拍板第 2 项：灰度粒度 = 讲）**：某讲的 4:3 draft 全部人工过目后发 release，该讲即切 4:3；未发布讲继续用 16:9 基线（经轨道一顶置渲染，始终可用）。上课舞台已按页 doc 的 canvas 宽高自适应，16:9/4:3 页混存也能渲染，但同一讲内应保持一致（发布校验：release 内 aspect 混杂时警告）。

教务约定（不需要代码，靠冻结机制 + 排课纪律执行）：已开课班级全程保持开班时的画幅（冻结天然保证）；建议整门课全部讲次都有 4:3 release 后再让新班以 4:3 起步，避免一个班中途变画幅。轨道一的存在让「暂不切 4:3」永远是可用状态，教研没有清空 D 类队列的排期义务。

### 6.5 预案表（执行中触发即按此处置，不停工等决策）

| 风险 | 触发信号 | 预案 |
| --- | --- | --- |
| 分类脚本误判 A/B（右侧其实有教学元素） | 抽检发现 / 教师反馈 | 该页降级 D 进人工队列；分类规则加特征回归，重跑只影响未发布讲 |
| 字体度量差导致 richText 换行错位 | 视觉比对 diff 超阈值 | 不批量替换字体；单页走中台节点级排版覆盖（继承镜像 Stage 24 方法论） |
| path 动画变换后越界/穿帮 | 交互回放抽检 | path 点随仿射变换仍越界的页强制归 D 类 |
| 4:3 背景裁切截断关键画面 | 背景确认队列人工检出 | 该 shared_asset 改人工重制；确认队列本身就是闸门，未确认不发布 |
| 某讲 4:3 后教学效果差 | 教研否决 | release 回滚到 16:9 基线（发新 release 指旧 revision 集，分钟级） |
| H5 缩放后触控目标过小（平板） | 试课反馈 | 该页 H5 改「全屏弹层」模式打开（DocStage 支持 h5 节点放大到舞台满幅） |
| 某页真 4:3 转换收益不明显 / 成本过高 | 分类为 D 且教研评估不值得 | 保持 16:9 顶置（轨道一）即可——D 类队列**非必须清空**，顶置是永久合法终态 |
| 顶置模式下个别页文字过小影响可读性 | 试课反馈 | 该页优先进轨道二转真 4:3；短期可用上课舞台既有的局部放大交互顶住 |

---

## 7. 教研中台与版本管理

### 7.1 角色与入口

`/dashboard/courseware`，`requirePerm(locale,'courseware.page.edit')` 起步；发布按钮再校验 `courseware.release.publish`；资源库操作校验 `courseware.asset.manage`。内置 research 角色默认三键全有；admin 恒过。磁贴工作台加「课件工作台」磁贴（进行中的草稿讲、待确认 4:3 队列、最近 release）。

### 7.2 页编辑器能力分期

第一期（P6-7，覆盖用户列举的教研动作）：

- **选中即改**：点击 DocStage 节点 → 右侧属性面板（文本/HTML、x/y/宽高、字体字号行高、旋转、透明度、层级、显隐）。改动实时预览，保存 = 新 draft revision（整页 doc 快照）。
- **图片替换**：点图 → 展示所属 shared_asset 与使用范围计数 → 「仅本页替换」（binding 切到新 shared_asset 分支）或跳转资源库做批量（P6-8）。上传经 staging 校验（格式/解码/宽高/服务端 hash，讨论稿 §八-3）。
- **加入新元素**：新增 img/richText/svgShape/video 节点。第一期表单 = 结构化 JSON 编辑（zod 即时校验 + 预览），用户已确认教研可写规范 JSON；可视化拖拽放置作为增强不阻塞。
- **页管理**：讲内页排序、插页（空白/复制现有页）、软删页、跨讲复制页。
- **版本时间线**：页级 revision 列表（who/when/note/diff 摘要）、任意版本预览、一键回退（产生 `origin='revert'` 新 revision）；讲级 release 历史与整讲回滚。

第二期（挂起待用户重启）：拖拽改布局、多选对齐、动画编辑器、题库元数据编辑。

### 7.3 编辑与课堂的隔离

草稿只在中台可见；`resolve(template, overlay)` 与候课读的都是 `current_release_id` 的快照；开课冻结后连 release 更新也不影响该课次（D4 物化）。即「教研单讲改一周」期间，所有班级照常用上一个 release 上课——这正是版本管理必须存在的理由。

### 7.4 公共资源批量替换（P6-8，按讨论稿 §八/§九/§十）

资源库页：shared_asset 列表（按 kind/role/使用量筛选）→ 详情页（全部使用位置树：课程→讲→页，默认全选，可按层级取消，标注已冻结课次与已独立修改页）→ 上传新图（staging 两阶段）→ 确认页（新旧对比、影响面计数）→ 单 RPC 执行：全选 = 推 published 指针；部分 = 建分支批量重绑；写 batches/items 审计；一键回滚。**禁止前端循环逐页更新**（讨论稿 §十五-5）。

---

## 8. 任务拆分（每条 = 一次独立提交/PR；跨仓任务标明执行仓库）

- **P6-0 地基核查（✅ 2026-07-17 全部完成）**：①磁盘 ✅ xiaomi 可用 196G（需 60G）。②对账 ✅ 补齐 MFHK01863 第 15 讲《共角三角形》（seed 文件本有该行、库漏应用，幂等 insert 已执行），库现 72 课程/865 讲与镜像全对齐；镜像侧 `class_d8f534b70b9d9f3d7952` = `MFHK00621` 别名记入 §2.2，P6-1 映射清单必须携带。③H5 spike ✅ 结论与 HTML 垫片方案见 D3。④`page-doc-v1` 冻结 ✅ `src/features/courseware-doc/schema.ts`（含 `collectBindingKeys` 遍历工具；P6-1 导出的页文档必须整体过此 schema）。⑤建桶 ✅ `supabase/migrations/20260717000100_p6_courseware_buckets.sql` 已执行——cw-objects 私有、200MB 限额（镜像最大对象实测 145MB）、staff 读策略；cw-h5 public、200MB。⑥五项决策拍板 ✅ 见 §10。
- **P6-1 镜像侧 v2 导出**（镜像仓库，遵守其 AGENTS.md/测试纪律）：`export mathin-package` 实现 D8 ①–⑥；先对样本讲 101001827 产包并 audit 全绿，再全量产包。验收：样本讲包内 69 页、全部 kind 资产与 H5 清单对账平；全量包 exclusions 全部有因；每页 `sourceContentHash` 非空。完成后镜像项目**转维护模式**（只修 bug 不加阶段，§10 第 5 项）。**进展（2026-07-17）**：实现完成（镜像 `src/export/mathin-package.ts` + audit + migration 0030 + 测试，阶段文档《阶段25》；合同副本 `src/export/page-doc-contract.ts` 与 mathin 冻结 schema 逐字段一致）；样本讲 ✅ 69 页 usages 230 audit 全绿、69 页 doc 过 mathin 冻结 schema 0 失败。**导出期四项数据面发现（导入/渲染侧必须知道）**：①页背景与页缩略图在源数据经**课程文档**发现（`source_document_kind='course'` 但 `course_page_id` 指向页）——是页资产，排除规则只看 `course_page_id IS NULL`；页缩略图入 usage 并记在页行 `thumbnailBindingKey`（中台缩略图墙直接可用）。②**多页共享同一 H5 包、靠 launch query 区分关卡**（样本讲 14 入口→1 包）：h5 usage 行带 `launchQuery`/`coursewareIdParam`，P6-4 渲染 iframe 必须拼回 query（§4 `cw_page_asset_bindings.launch_query`）。③richText 内嵌 data URI（全库 473 个、最大 82 字节的 1px gif 类）无 CAS 对象：导出时还原回 html 保持自包含，按 `INLINE_OBJECT_NOT_STORED` 排除。④别名产品 key 的库内真实形态是 `class:d8f534b70b9d9f3d7952`（冒号；目录名下划线是路径消毒产物）。**全量产包 ✅（exportId `2490b13a-44cc-4b34-a68f-e45df77c5c45`，757MB）**：865 讲 / 55,101 页（= 55,110 − 9 条镜像阶段 21 既有页排除，对账相符）/ 对象 57,130 / usages 160,647 / 候选 58,370 / H5 包 1,240，audit 全绿；exclusions 24,271 全部有因（题库元数据 22,976、课程级 863、内嵌 data URI 192、未引用 62、不可渲染 15；H5_NOT_OFFLINE=0，非离线 H5 页阶段 21 已排）。**P6-1 完成，镜像项目自此转维护模式**。P6-3 导入以该 exportId 为准。
- **P6-2 mathin 数据层（✅ 2026-07-17 完成）**（mathin）：§4 全部 migration（replacement 两表除外）+ RLS + 权限键 + RPC 骨架（`publish_lecture_release`、`save_page_draft`、冻结事务扩展、候课批签 signed URL 的 Server Action `getSessionAssetUrls`——校验教室成员后按 `courseware_resolved` 清单签发，D3）。新增 `p6_courseware_security_assertions.sql` 已在开发库通过：学生/家长直读新表与 `cw-objects` 桶均被拒；成员仅能解析本课冻结对象、非成员被拒；冻结的三字段、草稿与 release 的 revision/binding pin 均通过事务回归；P6-1 新发现的 H5 `launchQuery` / `coursewareIdParam` 只允许写在 H5 binding，并随 release 快照固定，避免同包多关卡串关。批签 Action 的 6 小时 URL 与非法/未登录拒绝也有 Vitest 回归。验收：RLS 断言脚本覆盖新表（沿 P4E 的断言基建）；学生/家长直读新表与 `cw-objects` 桶均被拒；教室成员经批签 action 能取到 URL，非成员被拒。
- **P6-3 导入 CLI + 样本讲导入（✅ 2026-07-18 完成；审核阻塞项已修复并重导）**（mathin）：`scripts/cw-import.mjs` 校验导出 manifest/page-doc/H5 manifest 后，按内容寻址上传对象与 patched H5 包，再以单个 SSH psql 事务写入 docs/revisions/bindings/shared assets、`courseware_template` 和 release 1。样本 `101001827` 已导入为 69 页 / 69 revisions / 230 bindings / 170 shared assets / 1 release / 180 H5 文件（14 个 H5 launch query 保留）；重复执行 Storage 零上传、数据库零新增。手工构造并清理的一条 `origin='edit'` 草稿在重导入中报告 `protected: 1`，未被覆盖。大文件以 6 MiB TUS 分片上传验证通过；Storage 全局上限已与两个 bucket 对齐为 200 MB（镜像最大对象 145 MB）。本地开发若 API 走 SSH/LAN 隧道，可用 `CW_STORAGE_RESUMABLE_URL` 和 `CW_STORAGE_RESUMABLE_REWRITE_ORIGIN=1` 让 CLI 的 TUS PATCH 跟随该本地入口；浏览器仍使用 `SUPABASE_PUBLIC_URL` 的公开 HTTPS 地址。**2026-07-18 审核结论**：管道机制（包校验/幂等/TUS/单事务/对账/release/protected 保护）实证通过——库内 69/69/230/170/1 与 release 快照全解析均复核相符。**审核曾发现一项阻塞并已修复（2026-07-18）**：初版导入期 `sanitizePageDoc` 用正白名单静默改写 html/svg 后入库，白名单窄于镜像端实际标记（镜像是保留呈现属性的黑名单消毒、doc 带 `sanitized: true`）——样本 7 个 SVG 被剥呈现属性，全量包尺度还会毁 `table/td/tr`（1.1 万+）、`sup/sub`（206 处数学上下标）、`foreignObject` 等。**修复**：sanitize 降级为「无损门禁」——文档一律原样入库，消毒若会丢任何标签/非空属性即响亮失败（白名单按全量包标签/属性清单补齐；空值属性丢弃与 style 重排是 sanitize-html 归一化噪声，不算损失）；对账 `conflicts`/`baselineDrift` 非零改为非零退出码。样本讲已清除重导：69 页 verbatim（幂等复跑零新增、`baselineDrift: 0` 即库内 doc 与包内 jsonb 相等），SVG 呈现属性抽查在库。**两项遗留已处理（2026-07-18）**：①包内 3 处 `<y` 实为属性值内的未转义 `<`（`data-latex="10<y<20"`，LaTeX 公式原文，HTML 解析器本就正确处理），此前门禁用正则直扫原文误当标签——已改为「两侧先过放行一切的恒等消毒再比对清单」，序列化噪声（属性值转义、实体差异）两侧同时归一，只有真实白名单丢弃才触发；**全包预检 865 讲 / 55,101 页零失败**，P6-7 全量导入无门禁障碍。②cw-h5 孤包 `0012489b…` 15 对象已经 Storage API 删除（删前复核 hash 不在 `cw_asset_objects`），桶内剩 181 对象＝样本讲正式导入内容，账目吻合。
- **P6-4 渲染器移植**（mathin）：`courseware-doc/` 四件套 + 中台只读预览路由（先于编辑器，用于验收）；含 §6.1 顶置兼容模式；**含 D3 的 HTML 垫片 Route Handler `/api/cw-h5/[...path]`**（proxy matcher 已排除 `/api`，无需改 proxy）。**进展（2026-07-18，实现完成，验收硬化未做）**：四件套落地（schema 已有；`resolve.ts` bindingKey→URL 注入接口 + H5 垫片 URL 拼回 launch_query；`interactions.ts` WAAPI 调度器纯 TS 移植；`DocStage.tsx` 按 renderedNodeHtmlV2 语义渲染，natural/board43 双舞台，h5 iframe `sandbox="allow-scripts"`）；垫片路由实测通过（HTML 200 text/html + immutable、子资源 308、`..`/非法前缀 404）；只读预览三级路由（课程网格→讲次→页预览，翻页与舞台切换走 searchParams、每次只下发当前页 doc）+ `coursewareStudio.*` 双语 + loading 骨架；单测 20 项全绿（enter 初始隐藏/click 步进/path 落位/launch_query 拼装/垫片守卫）；真实账号 E2E：admin 打开样本讲页 11 且载荷含 staff 自签 URL，student 被弹回且响应零课件数据；`bundle:report` 预览路由 253 kB 与 dashboard 壳持平（DocStage 懒加载生效）。**接缝修复（2026-07-18，7deb651）**：D4 的 doc 页型此前只写了库、没进前端 union——school `CoursewareTemplatePage` 与 classroom `CoursewarePage` 已补 `{id,type:"doc",docId,title}` 变体，三个模板/覆盖层编辑器补图标与 `type_doc` 文案（此前打开样本讲模板页会 React 崩溃、保存会被 zod 拒绝）；LiveShell 对 doc 页现走白板兜底，真渲染接入归 P6-5。**用户实测审校修复（2026-07-18，c30f841 + 65dc1d5）**：①换页整页位移事故——交互 WAAPI `fill:both` 终帧挂元素上永不取消，而各页节点 `nodePath` key 相同，React 复用元素把上一页残留 transform 带进后续每页（样本讲第 8 页 slideInLeft 后第 9 页起全员下移 275px、硬刷新才消失）；修复＝舞台按 `sourceCoursewareId:sourcePageDatabaseId` remount + 运行时 `dispose()`（cancel 动画/停音频/冻结调度），Playwright 复现路径（1→12 连续翻页）回归通过。②挂已发布讲次的课次开课必炸（freeze RPC `RELEASE_MISMATCH`，UI 报「开课失败」被误读为网络问题）——`startClassSession` 现按 `current_release_id` 物化 `{releaseId, bindings[objectHash]}`（`materializeSessionResolved`，E2E：69 页冻结、230 绑定/170 对象、`list_session_resolved_assets` 出 169 个非 h5 对象），P6-5 预载可直接消费该清单。③试讲/候课「本课次还没有课件页」——未冻结讲次课次 live 页现用模板+覆盖层同一套 resolve 先展示（与冻结结果一致）；随带发现课堂教师读讲次模板依赖学校端 `course.view`（本班教师为 sales 时 RLS 读 0 行），新增策略 `lectures_select_classroom_teacher`（migration 20260718000100 已应用）：本班课次挂该讲的班级 teacher 成员可读。试讲页 doc 页在 P6-5 前仍以空白板呈现。**待验收（下一步）**：样本讲 69 页 Playwright 截图与镜像 Viewer 双渲染比对达标；交互页（迷宫连线 page 11 点击显示、page 15694 点击退出序列）行为一致；**4:3 舞台断言：16:9 页顶端对齐、内容占上部 75%、下部为板书带且点击命中区仿射正确**；**H5 沙箱实测：≥3 种代表性引擎包（CreateJS / Three.js / 旧式嵌套 iframe）在 `sandbox="allow-scripts"` 下正常运行**（§9 沙箱条目；破损即启用垫片注入 storage polyfill 预案）；`pnpm bundle:report` 确认懒加载未拖累其他路由。
- **P6-5 课堂接入**（mathin）：doc 页型进 `CoursewarePage`/LiveShell/候课预载/冻结物化（D4）；预载改走批签 signed URL（D3，教师与学生统一走 `getSessionAssetUrls`）；H5 包候课 HTTP 缓存预热（清单取公开桶内 `__mathin_manifest.json`，D3）+ 候课黄灯语义。验收：用样本讲开一堂真实结构模拟课（1 教师 + 2 学生）：翻页/加星/视频同步/H5 页在线加载/动画自动播全通过；断网课（无 H5 页）完整走完；**16:9 页在 4:3 课堂舞台顶置呈现、画板可在板书带书写**；学生端拿不到批签之外的对象 URL；**H5 页二次打开经 DevTools 确认子资源命中 HTTP 缓存（预热与 308 缓存生效）**。
- **P6-6 4:3 增强轨：审计与批量流水线**（分类脚本在镜像仓库；派生与导入在 mathin。**非阻塞任务**——轨道一已在 P6-4/5 打底，本任务按价值排期，不卡 P6-7/9）：§6.2 分类命令 + 报告；§6.3 背景批量派生 + 确认队列页（中台内）；A/B/C/E 类自动产 4:3 draft revision（样本讲 + 一个年级）。验收：分类报告数字对账平；样本讲 4:3 版发布后模拟课全流程 4:3 满幅呈现；16:9 回滚可用。
- **P6-7 教研中台第一期**（mathin）：§7.2 全部第一期能力。验收：教研账号完成「改文字→挪图→加元素→插页→发布 release→旧班冻结课不受影响→新开课取新版」全链路；无权限者各写路径被拒。
- **P6-8 公共资源批量替换**（mathin）：replacement 两表 + §7.4 资源库 UI + RPC + 回滚。验收：跨 ≥3 讲共用背景做一次部分替换（分支重绑）与一次全量替换（推指针），审计行完整，一键回滚复原。
- **P6-9 全量迁移与总验收**(两仓)：全量包导入（分年级分批，每批对账）；随机抽样 ≥60 页视觉比对（顶置模式下）；性能检查（页 doc 加载、Storage 出流、批签 action 延迟）；roadmap/memory 收尾。**不依赖 P6-6 完成**——全量以 16:9 顶置形态验收，4:3 增强按 §6.4 节奏后续推进。验收：865 讲全部可在中台浏览、可开课；对账零 silent missing。

排序理由：垂直切片优先——P6-1→P6-5 用同一条样本讲打穿「导出→导入→渲染→上课」，任何格式/存储问题在 1 讲规模暴露，而不是 55,110 页返工；**P6-1（镜像仓）与 P6-2（mathin 数据层）无相互依赖，可并行推进**；4:3 增强轨（P6-6）与中台（P6-7）都依赖渲染器与版本层，且互不阻塞可并行；全量导入放最后，因为幂等 CLI 让「早导入」没有收益、只有返工风险。

---

## 9. 隐含坑清单（执行 agent 必读）

- **两仓纪律不同**：镜像仓库要求每改动配测试与迁移脚本、禁止触碰原始快照与 CAS；mathin 仓库要求 lint/typecheck/build + 设计 token + next-intl。跨仓任务各遵各的，不得把 mathin 的习惯带进镜像仓（反之亦然）。
- **jsonb 1MB check**：`cw_page_revisions.doc` 沿用 1MB 上限。全库最大页先在 P6-1 导出时统计，若有超限页（富文本巨页/svgdata），预案 = 该页 doc 拆 `content_overflow` 子表存大字段，不放宽全局上限。
- **Storage 与 DB 无共同事务**（讨论稿 §十）：一律「先对象后行」两阶段；导入中断后重跑靠 hash/稳定键幂等收敛，禁止手工清库重来。
- **服务端再消毒**：发布包里的 HTML/SVG 已消毒过，但 mathin 导入时必须按镜像同规则再跑一遍（`safeRichText`/`safeSvg` 移植为服务端纯函数）——不信任任何外部输入，哪怕是自家管线。
- **`interactions` 与节点变换耦合**（§6.2）：任何改 transform 的代码路径（4:3 脚本、中台挪图）都要问一句「这个节点是不是 path 动画目标/触发器」。
- **enter 目标初始隐藏**：render model 语义里 enter 交互的目标节点初始 `display:none`（`enterTargets`），移植渲染器时漏掉这条会导致「答案先露出来」——教学事故级 bug，Playwright 断言必须覆盖。
- **富文本内嵌图**：richText 的 html 里有 `asset://resource/<id>` 占位（镜像格式），page-doc-v1 需改为 `asset://binding/<bindingKey>`，渲染时经 resolve 注入 URL。一个 richText 可含多张图（Stage 23 已踩过：bindingPath 才唯一）。
- **视频 poster 与本体是两个 binding**（role=source / thumbnail），候课预载两个都要拉。
- **H5 iframe 沙箱**：**必须不含 `allow-same-origin`**——D3 的 HTML 垫片让 iframe URL 与 mathin 同源，只有 opaque origin 才能隔离 H5 脚本与站点 cookie/storage。**事实修正（2026-07-17 复核）**：镜像 Viewer 的 h5 iframe 其实**没有任何 sandbox 属性**，不存在「同款收紧」的参照——H5 包从未在沙箱下验证过。opaque origin 下访问 `localStorage`/`sessionStorage` 会抛 SecurityError，部分引擎（如 CreateJS 音量记忆）可能中招。P6-4 必须用代表性引擎包实测 `sandbox="allow-scripts"`；若发现破损，预案 = 垫片直出 HTML 时在 `<head>` 首部注入内存版 storage polyfill（mathin 侧一处修复，不动镜像包、不放宽 sandbox）。
- **课堂离线含 H5 的边界**（D4）：候课单绿灯逻辑不得把 H5 页算进「已预载」；文案明示「本课含 N 个互动页需保持在线」。
- **教研并发编辑**：页 draft 保存沿 P3 乐观锁模式（携带 base revision_no，冲突返回 409 语义的 ActionResult），双人同页后保存者收冲突提示，不静默覆盖。
- **导入期间的库负载**：55,110 页 × 多行 insert 走批量（每批 ≤500 行 multi-values / COPY），避免逐行 RPC；在业务低峰跑，导入脚本带限速参数。Storage 上传（CAS 58,013 对象 + H5 数万文件）必须带**并发参数**（幂等跳过已存在即天然断点续传）——逐文件串行会拖到天级。
- **Server Action 入参**：中台全部 action 过 zod（AGENTS.md 铁律），页 doc 保存复用 `page-doc-v1` schema 整体校验。
- **秘钥纪律**：service key 只进导入脚本运行环境变量，不进仓库；SSH/psql 流程同 CLAUDE.md。

---

## 10. 拍板记录（2026-07-17 用户全部拍板，开放决策关闭；执行 agent 不得重开）

1. **`cw-h5` = public 桶**。性能顾虑与候课预载机制咬合解决（H5 包候课 HTTP 缓存预热，D3）。spike 实测补充（2026-07-17）：storage-api 有意把 `text/html` 降级为 `text/plain`（其余 MIME 正常），故加 mathin Route Handler 垫片直出 HTML、子资源 302 回 storage——public 桶决策不变，nginx 备选关闭，细节见 D3。
2. **4:3 = 按讲灰度，且新增「16:9 顶置」兼容模式为默认打底**（§6.0/§6.1，D7）：16:9 课件固定在 4:3 页面顶端，画板仍是整幅 4:3，下方成为教师板书带——「页面文字变小」的代价换「老师书写空间变大」。真 4:3 转换降级为可选增强轨。
3. **页级预览分享链接：不做**。外部人看草稿走窄权限 staff 账号顶；将来要做是纯增量（token 表 + 公开路由），不留架构欠账。
4. **`cw_asset_objects` 读范围：收紧**。桶私有，staff 直读；学生仅经候课批签 signed URL 取本课次资源（D3/D4，P6-2 的 `getSessionAssetUrls`）。注意 `cw-h5` 因技术不可行（iframe 子请求无法鉴权）例外地保持 public——两桶策略不一致是**已知且接受**的，不是疏漏。
5. **镜像项目转维护模式，不做增量导出**。反悔路径低成本保留：P6-1 导出包每页带 `sourceContentHash`（D8 ⑥），将来若需对接源站更新，只补 diff 工具即可，不必重建导出体系。届时的合并原则预登记：源更新页若在 mathin 已被教研编辑（origin≠'import'），一律走「新基线 revision + 人工调和」，管线永不覆盖教研判断。
