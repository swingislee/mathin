# Mathin 整体规划 · 16 P6 课件资产平台（魔法校迁移 / 4:3 适配 / 教研中台与版本管理）

> **规划状态**：`partial`
>
> **当前用途**：E 系列与爱学习 G+/X+/A+ 秋季课程研发、16:9/4:3 双轨资源与 release 契约；记录不进入正式基线的暑期开发增量；§14 承载课程产品统一课件工作区的待审规划。
>
> **已落地**：P6-1～P6-8 主体与 P6-10；开发数据已有 E 系列 1135 讲与爱学习 G+/X+/A+ 秋季 170 讲双轨资源，另有一年级 A+ 全国版暑期 2 讲/66 页开发增量和 13 个空占位，P6-5 有课堂集成证据。旧 v11 导入仅作为 §12 历史记录；projection v31 来源事实、生产兼容边界和 source-runtime 开发导入合同见 §13。
>
> **当前施工**：P6-AIX-2 已于 2026-08-13 关闭；当前由 R1-9/P6-9 采集 1305 讲正式来源 inventory、Storage/H5 对象审计与非执行者复核。
>
> **剩余项**：P6-9 全局量化验收和正式生产 release-1 重建见 doc 25 R1-9/15/18；§14 的 `DEV-CW-1` Step 0～2A 已获产品负责人确认。Step 3 单页审计进一步暴露 Mathin `DocStage` 未携带来源 CSS／字体／行为运行时，产品负责人否决按页面或属性追补；当前先审 Step 3A 来源渲染一致性方案，单页写态复审降为 Step 3B。未授权爱学习写入、整讲/批量数据、跨页替换或生产变更，本阶段也未授权任何生产清理。
>
> **最后核对**：2026-08-31；§13 以前的来源与生产基线结论沿用原证据，§14 只依据当前仓库和本机 Docker 开发库只读核对，不代表 Xiaomi/生产事实。

> 本文是 P6 的权威执行计划，地位等同 `08-p4-classroom-whiteboard.md` 之于 P4。前置阅读：`00-overview.md`、`04-roadmap.md`、`10-school-backend.md` §4.3（模板/覆盖层/冻结）、`08-p4-classroom-whiteboard.md` §3.4/§3.6（课堂离线栈与课件页模型）。
>
> **与 P4I 的关系（2026-07-22 追记）**：本文的 CAS/H5/DocStage/revision/release 数据模型与迁移方法论不受 P4I 影响，`19-p4i-final.md` 明确保留（doc19 §21 不变量 9）。本文如涉及"教研中台"入口的具体导航路径/页面归属描述，以 doc 19 §4/§9/§20 的课程研发分组（研发任务/课程产品/适配校对/公共资源 + 讲次工作区 canonical URL）为准。
>
> **与 doc 22 的关系（2026-07-27 追记）**：本文出现的 Dashboard URL 有一部分已被 `22-dashboard-route-information-architecture-refactor.md` 改名或删除（`staff/roles`→`access-control`、`registration`→`registration-settings`、`operations`→`system-health`、`operations/testdata`→`data-maintenance`、`adapt-review`→`courseware/review`、`curriculum/lectures/[id]`→`courseware/lectures/[lectureId]`、`shared-assets`→`courseware-assets`；`/dashboard/work` 与 `/dashboard/videos` 已删除）。**旧地址一律 404，不留重定向**。本文其余结论不受影响；路由的当前真相以 `src/features/school/dashboard-routes.ts` 的路由合同为准。
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

- **2026-07-19 双轨细化**：16:9 原生版与 4:3 适配版不是互相覆盖的临时状态，而是长期并存的两个发布轨。`cw_page_track_heads`、`cw_lecture_track_heads`、`cw_asset_variant_heads` 分别维护每轨页草稿/当前版、讲 release 与资源版本；revision、release、binding 都带 `track`。legacy `cw_page_docs.*_revision_id` / `course_lectures.current_release_id` 只兼容表示 16:9 原生轨。
- 教研日常编辑产生当前轨道的 **draft revision**，预览可看草稿；「发布本讲」只把当前轨的草稿收进新 release 并推进该轨 `current_release_id`。未发布的草稿不影响任何班级。
- 回滚 = 发一个指向旧 revision 集的新 release（永远向前，不删历史）。
- 导入基线 = 每页 revision 1（`origin='import'`），不可编辑不可删，任何时候可 diff/回退到基线。
- 资源版本（D2 的 asset_revisions）与页版本正交：页 revision 记录的是布局/内容，资源替换走 shared_asset 版本指针。release 快照两者都 pin（页 revision id + 当时各 binding 的 published revision id），保证 release 可精确复现。

### D7 4:3 适配 = 「16:9 顶置」兼容模式打底 + 派生 revision 按讲灰度增强（2026-07-17 用户拍板，见 §10）

详见 §6。双轨：**轨道一（默认原生版）**——课堂舞台保持 4:3，16:9 页等比缩放后**顶端对齐**渲染，下方约 25% 舞台高度成为教师板书带，画板/批注层仍覆盖整幅 4:3；全部 55,110 页开箱即用。教师可在此轨做原生页校对。**轨道二（稳定 4:3 版）**——导入 16:9 基线时按 A–F 自动生成初稿，对值得投入的讲人工审校后独立发布：每页一条 `origin='adapt-4x3'` 的 revision（画布 960×720 + 变换后的节点/交互坐标）+ 派生资产 revision；16:9 基线 revision 与源资产永不修改。班级绑定课程后可选默认轨，未开课的单讲可覆盖；开课时把所选轨道的精确 release 与资源 hash 冻结。

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

```text
src/features/courseware-doc/     # D5 渲染器（schema/resolve/DocStage/interactions）
src/features/courseware-studio/  # 教研制作能力（页编辑器、资源面板、版本时间线）
src/app/[locale]/dashboard/courseware/
  page.tsx                       # P4H 后为按讲次任务台，不再复制课程目录
  lectures/[lectureId]/page.tsx  # P4H canonical workbench：preview/edit/page/track 共壳
  assets/...                     # 公共资源工具，可分享子地址
  adapt/page.tsx                 # 适配审核工具，可分享子地址
scripts/cw-import.mjs            # D8 导入 CLI
```

> **2026-07-20 路由修订**：P6-4/7 为垂直打穿先实现的 `/courseware/[courseId]/...` 三级目录已完成其阶段使命，但不再是最终产品信息架构。最终入口与旧路由 308 迁移由 doc 18 P4H-5/6 规定。P4H 只重组壳、导航与返回链路，继续复用本文件冻结的 Viewer/Editor/Action/RPC，不改变 page/revision/release/binding 数据语义。

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
| E H5 特殊 | h5Link 节点尺寸 >960 宽 | 横向压缩外层 16:9 shell 以填满 4:3；H5 内部运行时不改，交互命中区同步 | 全自动 + 抽检 |
| F 中心标题 | 唯一横跨 16:9 的窄标题组，组中心位于页面纵向中线 | 背景从中央裁成 4:3；主元素保留在居中的 16:9 比例内容层，原节点只保留本地坐标，不随 4:3 舞台视觉放大 | 全自动 + 抽检 |

分类报告（NDJSON + 汇总表）进发布包，mathin 导入为页的 `adapt_class` 标注，驱动审校队列排序。**交互坐标随节点变换**：平移/缩放页时 `interactions[].path.points` 与节点 transform 同一仿射变换，脚本统一处理，禁止只挪节点不挪动画路径。

F 类按页面节点的结构特征判定，与页码无关：任意讲次中，只要页面存在唯一横跨 16:9 的窄标题组且组中心位于页面纵向中线，即套用该类。样本讲 `101001827` 的**第 8 页**只是当前命中的实例：背景采用 `(160,0)` 中央裁切铺满 4:3 舞台；标题与 SVG 位于独立的居中 16:9 内容层，保持原始视觉大小和垂直中线，不能随背景同比放大或被裁切。

### 6.3 资产派生

- 背景：按 shared_asset 维度批量处理。源 16:9 背景 → 派生 4:3 版（居左裁切 320px 为默认策略；F 类中心标题页从 `(160,0)` 居中裁切；纯色/纹理背景可直接重心裁切），新 hash 入 CAS，`asset_revisions.variant='mathin-4x3'`、`derived_from` 指源。派生自动执行、**人工确认后才发布**（讨论稿 §18-3 取推荐项）。
- 内容图：A/B 类不动原图；C 类不裁图（靠节点缩放）；确需裁切的进教研手工流程（导出工作副本 → 编辑 → 上传新 revision，讨论稿 §六流程，**严禁触碰镜像 hardlink**）。
- 视频：零处理——4:3 页内视频节点天然满窗。

### 6.3.1 背景审校的“人工退回”与“系统已替代”语义（2026-07-26 核查）

开发库原有 21 条 `status='rejected'` 记录经只读审计确认：备注均为 `P6-6 superseded during deterministic CAS repair`，产生于同一次确定性 CAS 修复；当前 4:3 binding 选中 0 条、当前页面受影响 0 页、历史或当前 adapted release 引用 0 条。它们不是教研人工判定的质量退回，不需要返工、不产生工作项、不阻塞 release。`20260726000300_p6_adapt_background_rework.sql` 已将这 21 条回填为 **系统已替代（superseded）**，只在“历史审计”展示。

| 语义状态 | 工作界面 | 后续动作 | 4:3 发布影响 |
| --- | --- | --- | --- |
| `pending` 待确认 | 背景确认 | 通过或人工退回 | 当前选中时阻塞 |
| 人工退回待修 | 独立“退回待修”队列与讲次工作项 | 重新派生、调整裁切、进入 4:3 可视化编辑、调整 A–F 分类或改用 16:9 顶置终态 | 仅当前 binding 仍选中该候选时阻塞 |
| 修复后待复审 | 背景确认 | 再次通过或退回 | 当前选中时阻塞 |
| `approved` 已通过 | 已通过历史 | 无 | 不阻塞 |
| `superseded` 系统已替代 | 历史审计 | 只读查看来源、原因与替代链 | 永不阻塞、不产生工作项 |

人工退回必须填写结构化原因（裁切错误、主体丢失、比例错误、画质问题、分类错误或其他）并可补充说明；修复不得把原退回记录直接改回 pending，而应新建候选并记录 `supersedes` / `superseded_by` 关系，原记录保持不可变审计。发布闸门只检查 release 快照或当前 binding 实际选中的 `mathin-4x3` revision；未选中的历史退回和系统已替代记录不得阻塞。修复期间 16:9 原生轨仍可用于预览、建班和上课。

**实施状态（✅ 2026-07-26）**：上述合同已落地。`cw_adapt_backgrounds` 支持 `pending / approved / rejected / superseded`，人工退回强制填写六类结构化原因（`other` 另需说明）；已决定记录由数据库 trigger 保护，修复只能创建新的 4:3 CAS object、asset revision 与 `pending` 候选，并以 `supersedes_id / superseded_by_id` 形成替代链。`/dashboard/adapt-review` 已增加“退回待修”和“历史审计”页签：只有当前 binding 仍选中人工退回候选时才进入待修；可在浏览器中调整裁切生成新候选，也可进入 4:3 可视化编辑、A–F 分类或查看 16:9 顶置轨。系统已替代与已有 successor 的退回只读留档。回滚数据库断言已验证“退回→修复新候选→复审通过→发布”，历史退回不阻塞 successor release；实际库当前 `approved=718 / superseded=21 / rejected=0 / pending=0`，待修队列为 0。

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
- **图片替换**：点图 → 展示所属 shared_asset 与**当前画幅轨道**使用范围计数 → 「仅本页替换」（binding 切到新 shared_asset 分支）或「替换本轨全部引用」。批量更新只推进当前轨 binding/variant head，绝不跨 16:9/4:3；已发布 release 与冻结课次不变。资源库仍保留跨课程精细勾选入口（P6-8）。上传经服务端格式/解码/宽高/hash 门禁。
- **加入新元素**：新增 img/richText/svgShape/video 节点。第一期表单 = 结构化 JSON 编辑（zod 即时校验 + 预览），用户已确认教研可写规范 JSON；可视化拖拽放置作为增强不阻塞。
- **页管理**：讲内页排序、插页（空白/复制现有页）、软删页、跨讲复制页。
- **版本时间线**：页级 revision 列表（who/when/note/diff 摘要）、任意版本预览、一键回退（产生 `origin='revert'` 新 revision）；讲级 release 历史与整讲回滚。

第二期（挂起待用户重启）：拖拽改布局、多选对齐、动画编辑器、题库元数据编辑。

### 7.3 编辑与课堂的隔离

草稿只在中台可见；中台编辑/发布/回滚都显式选择 16:9 或 4:3 轨道。班级保存默认轨，单讲覆盖优先于班级默认；`resolve(template, overlay)` 与候课读取最终轨道的 `current_release_id` 快照。开课冻结后连轨道切换和 release 更新也不影响该课次（D4 物化）。

### 7.4 公共资源批量替换（P6-8，按讨论稿 §八/§九/§十）

资源库页：shared_asset 列表（按 kind/role/使用量筛选）→ 详情页（全部使用位置树：课程→讲→页，默认全选，可按层级取消，标注已冻结课次与已独立修改页）→ 上传新图（staging 两阶段）→ 确认页（新旧对比、影响面计数）→ 单 RPC 执行：全选 = 推 published 指针；部分 = 建分支批量重绑；写 batches/items 审计；一键回滚。**禁止前端循环逐页更新**（讨论稿 §十五-5）。

---

## 8. 任务拆分（每条 = 一次独立提交/PR；跨仓任务标明执行仓库）

- **P6-0 地基核查（✅ 2026-07-17 全部完成）**：①磁盘 ✅ xiaomi 可用 196G（需 60G）。②对账 ✅ 补齐 MFHK01863 第 15 讲《共角三角形》（seed 文件本有该行、库漏应用，幂等 insert 已执行），库现 72 课程/865 讲与镜像全对齐；镜像侧 `class_d8f534b70b9d9f3d7952` = `MFHK00621` 别名记入 §2.2，P6-1 映射清单必须携带。③H5 spike ✅ 结论与 HTML 垫片方案见 D3。④`page-doc-v1` 冻结 ✅ `src/features/courseware-doc/schema.ts`（含 `collectBindingKeys` 遍历工具；P6-1 导出的页文档必须整体过此 schema）。⑤建桶 ✅ `supabase/migrations/20260717000100_p6_courseware_buckets.sql` 已执行——cw-objects 私有、200MB 限额（镜像最大对象实测 145MB）、staff 读策略；cw-h5 public、200MB。⑥五项决策拍板 ✅ 见 §10。
- **P6-1 镜像侧 v2 导出**（镜像仓库，遵守其 AGENTS.md/测试纪律）：`export mathin-package` 实现 D8 ①–⑥；先对样本讲 101001827 产包并 audit 全绿，再全量产包。验收：样本讲包内 69 页、全部 kind 资产与 H5 清单对账平；全量包 exclusions 全部有因；每页 `sourceContentHash` 非空。完成后镜像项目**转维护模式**（只修 bug 不加阶段，§10 第 5 项）。**进展（2026-07-17）**：实现完成（镜像 `src/export/mathin-package.ts` + audit + migration 0030 + 测试，阶段文档《阶段25》；合同副本 `src/export/page-doc-contract.ts` 与 mathin 冻结 schema 逐字段一致）；样本讲 ✅ 69 页 usages 230 audit 全绿、69 页 doc 过 mathin 冻结 schema 0 失败。**导出期四项数据面发现（导入/渲染侧必须知道）**：①页背景与页缩略图在源数据经**课程文档**发现（`source_document_kind='course'` 但 `course_page_id` 指向页）——是页资产，排除规则只看 `course_page_id IS NULL`；页缩略图入 usage 并记在页行 `thumbnailBindingKey`（中台缩略图墙直接可用）。②**多页共享同一 H5 包、靠 launch query 区分关卡**（样本讲 14 入口→1 包）：h5 usage 行带 `launchQuery`/`coursewareIdParam`，P6-4 渲染 iframe 必须拼回 query（§4 `cw_page_asset_bindings.launch_query`）。③richText 内嵌 data URI（全库 473 个、最大 82 字节的 1px gif 类）无 CAS 对象：导出时还原回 html 保持自包含，按 `INLINE_OBJECT_NOT_STORED` 排除。④别名产品 key 的库内真实形态是 `class:d8f534b70b9d9f3d7952`（冒号；目录名下划线是路径消毒产物）。**全量产包 ✅（exportId `2490b13a-44cc-4b34-a68f-e45df77c5c45`，757MB）**：865 讲 / 55,101 页（= 55,110 − 9 条镜像阶段 21 既有页排除，对账相符）/ 对象 57,130 / usages 160,647 / 候选 58,370 / H5 包 1,240，audit 全绿；exclusions 24,271 全部有因（题库元数据 22,976、课程级 863、内嵌 data URI 192、未引用 62、不可渲染 15；H5_NOT_OFFLINE=0，非离线 H5 页阶段 21 已排）。**P6-1 完成，镜像项目自此转维护模式**。P6-3 导入以该 exportId 为准。
- **P6-2 mathin 数据层（✅ 2026-07-17 完成）**（mathin）：§4 全部 migration（replacement 两表除外）+ RLS + 权限键 + RPC 骨架（`publish_lecture_release`、`save_page_draft`、冻结事务扩展、候课批签 signed URL 的 Server Action `getSessionAssetUrls`——校验教室成员后按 `courseware_resolved` 清单签发，D3）。新增 `p6_courseware_security_assertions.sql` 已在开发库通过：学生/家长直读新表与 `cw-objects` 桶均被拒；成员仅能解析本课冻结对象、非成员被拒；冻结的三字段、草稿与 release 的 revision/binding pin 均通过事务回归；P6-1 新发现的 H5 `launchQuery` / `coursewareIdParam` 只允许写在 H5 binding，并随 release 快照固定，避免同包多关卡串关。批签 Action 的 6 小时 URL 与非法/未登录拒绝也有 Vitest 回归。验收：RLS 断言脚本覆盖新表（沿 P4E 的断言基建）；学生/家长直读新表与 `cw-objects` 桶均被拒；教室成员经批签 action 能取到 URL，非成员被拒。
- **P6-3 导入 CLI + 样本讲导入（✅ 2026-07-18 完成；审核阻塞项已修复并重导）**（mathin）：`scripts/cw-import.mjs` 校验导出 manifest/page-doc/H5 manifest 后，按内容寻址上传对象与 patched H5 包，再以单个 SSH psql 事务写入 docs/revisions/bindings/shared assets、`courseware_template` 和 release 1。样本 `101001827` 已导入为 69 页 / 69 revisions / 230 bindings / 170 shared assets / 1 release / 180 H5 文件（14 个 H5 launch query 保留）；重复执行 Storage 零上传、数据库零新增。手工构造并清理的一条 `origin='edit'` 草稿在重导入中报告 `protected: 1`，未被覆盖。大文件以 6 MiB TUS 分片上传验证通过；Storage 全局上限已与两个 bucket 对齐为 200 MB（镜像最大对象 145 MB）。本地开发若 API 走 SSH/LAN 隧道，可用 `CW_STORAGE_RESUMABLE_URL` 和 `CW_STORAGE_RESUMABLE_REWRITE_ORIGIN=1` 让 CLI 的 TUS PATCH 跟随该本地入口；浏览器仍使用 `SUPABASE_PUBLIC_URL` 的公开 HTTPS 地址。**2026-07-18 审核结论**：管道机制（包校验/幂等/TUS/单事务/对账/release/protected 保护）实证通过——库内 69/69/230/170/1 与 release 快照全解析均复核相符。**审核曾发现一项阻塞并已修复（2026-07-18）**：初版导入期 `sanitizePageDoc` 用正白名单静默改写 html/svg 后入库，白名单窄于镜像端实际标记（镜像是保留呈现属性的黑名单消毒、doc 带 `sanitized: true`）——样本 7 个 SVG 被剥呈现属性，全量包尺度还会毁 `table/td/tr`（1.1 万+）、`sup/sub`（206 处数学上下标）、`foreignObject` 等。**修复**：sanitize 降级为「无损门禁」——文档一律原样入库，消毒若会丢任何标签/非空属性即响亮失败（白名单按全量包标签/属性清单补齐；空值属性丢弃与 style 重排是 sanitize-html 归一化噪声，不算损失）；对账 `conflicts`/`baselineDrift` 非零改为非零退出码。样本讲已清除重导：69 页 verbatim（幂等复跑零新增、`baselineDrift: 0` 即库内 doc 与包内 jsonb 相等），SVG 呈现属性抽查在库。**两项遗留已处理（2026-07-18）**：①包内 3 处 `<y` 实为属性值内的未转义 `<`（`data-latex="10<y<20"`，LaTeX 公式原文，HTML 解析器本就正确处理），此前门禁用正则直扫原文误当标签——已改为「两侧先过放行一切的恒等消毒再比对清单」，序列化噪声（属性值转义、实体差异）两侧同时归一，只有真实白名单丢弃才触发；**全包预检 865 讲 / 55,101 页零失败**，P6-7 全量导入无门禁障碍。②cw-h5 孤包 `0012489b…` 15 对象已经 Storage API 删除（删前复核 hash 不在 `cw_asset_objects`），桶内剩 181 对象＝样本讲正式导入内容，账目吻合。
- **P6-4 渲染器移植**（mathin）：`courseware-doc/` 四件套 + 中台只读预览路由（先于编辑器，用于验收）；含 §6.1 顶置兼容模式；**含 D3 的 HTML 垫片 Route Handler `/api/cw-h5/[...path]`**（proxy matcher 已排除 `/api`，无需改 proxy）。**进展（2026-07-18，实现完成；同日用户实测验收通过，见段末）**：四件套落地（schema 已有；`resolve.ts` bindingKey→URL 注入接口 + H5 垫片 URL 拼回 launch_query；`interactions.ts` WAAPI 调度器纯 TS 移植；`DocStage.tsx` 按 renderedNodeHtmlV2 语义渲染，natural/board43 双舞台，h5 iframe `sandbox="allow-scripts"`）；垫片路由实测通过（HTML 200 text/html + immutable、子资源 308、`..`/非法前缀 404）；只读预览三级路由（课程网格→讲次→页预览，翻页与舞台切换走 searchParams、每次只下发当前页 doc）+ `coursewareStudio.*` 双语 + loading 骨架；单测 20 项全绿（enter 初始隐藏/click 步进/path 落位/launch_query 拼装/垫片守卫）；真实账号 E2E：admin 打开样本讲页 11 且载荷含 staff 自签 URL，student 被弹回且响应零课件数据；`bundle:report` 预览路由 253 kB 与 dashboard 壳持平（DocStage 懒加载生效）。**接缝修复（2026-07-18，7deb651）**：D4 的 doc 页型此前只写了库、没进前端 union——school `CoursewareTemplatePage` 与 classroom `CoursewarePage` 已补 `{id,type:"doc",docId,title}` 变体，三个模板/覆盖层编辑器补图标与 `type_doc` 文案（此前打开样本讲模板页会 React 崩溃、保存会被 zod 拒绝）；LiveShell 对 doc 页现走白板兜底，真渲染接入归 P6-5。**用户实测审校修复（2026-07-18，c30f841 + 65dc1d5）**：①换页整页位移事故——交互 WAAPI `fill:both` 终帧挂元素上永不取消，而各页节点 `nodePath` key 相同，React 复用元素把上一页残留 transform 带进后续每页（样本讲第 8 页 slideInLeft 后第 9 页起全员下移 275px、硬刷新才消失）；修复＝舞台按 `sourceCoursewareId:sourcePageDatabaseId` remount + 运行时 `dispose()`（cancel 动画/停音频/冻结调度），Playwright 复现路径（1→12 连续翻页）回归通过。②挂已发布讲次的课次开课必炸（freeze RPC `RELEASE_MISMATCH`，UI 报「开课失败」被误读为网络问题）——`startClassSession` 现按 `current_release_id` 物化 `{releaseId, bindings[objectHash]}`（`materializeSessionResolved`，E2E：69 页冻结、230 绑定/170 对象、`list_session_resolved_assets` 出 169 个非 h5 对象），P6-5 预载可直接消费该清单。③试讲/候课「本课次还没有课件页」——未冻结讲次课次 live 页现用模板+覆盖层同一套 resolve 先展示（与冻结结果一致）；随带发现课堂教师读讲次模板依赖学校端 `course.view`（本班教师为 sales 时 RLS 读 0 行），新增策略 `lectures_select_classroom_teacher`（migration 20260718000100 已应用）：本班课次挂该讲的班级 teacher 成员可读。试讲页 doc 页在 P6-5 前仍以空白板呈现。**H5 页加载修复（2026-07-18，用户回测发现）**：H5 iframe 此前从未真正跑起来过（早先"实测通过"只 curl 了 HTML 直出，未做浏览器内嵌验证），四层问题一次修清：①全站 clickjacking 头 `X-Frame-Options: DENY` 盖到 `/api/cw-h5`，iframe 文档被浏览器整个拒绝渲染——next.config 给该路由单列头规则（`SAMEORIGIN` + 仅申明 `frame-ancestors 'self'` 的 report-only CSP，避免包内子资源对默认 CSP 刷无意义报告）；②沙箱 iframe origin 为 `null`，字体/XHR 走 CORS 而 308 这一跳无 ACAO（storage 侧 Kong 本来就返回 `*`）——路由全响应补 CORS，带 Origin 时反射并允许凭据（包内老代码 XHR 带 `withCredentials`，通配符会被凭据模式拒收），并补 OPTIONS 预检；③镜像离线服务器的两个改写目标垫片从未接住：`__h5_noop__/*`（打点）现直接 204，`__h5_backend__/get?courseware_id=X`（关卡配置，游戏拿不到就弹「网络不佳」）现改写为包内 `__h5_fixtures__/get/X.json` 代理直出（语义以镜像 `src/h5/offline-server.ts` 为准）；④用户 dev server 曾陷 `write EPIPE` 僵死致全站 500（子资源全挂而 index.html 因 immutable 缓存幸存，放大了排查噪声）——已重启。E2E：页 17 cocos 迷宫游戏关卡数据/字体/音频全载入、可交互、控制台零 CORS/引用错误。注意：此前访问过预览的浏览器缓存了无 ACAO 的旧 308（immutable），需硬刷新一次。**排版基线修复（2026-07-18，用户回测发现）**：算式/选项/题号中的数字独占整行、一行文案裂成多行——数字实为行内 MathJax SVG（`.mathjax_content` 内 `<svg>`，字形是路径不是字体），被 Tailwind preflight 的 `img,svg,…{display:block}` 顶成块级；镜像查看器的排版基线是「UA 默认 + border-box + Inter/微软雅黑，零重置」。修复＝新增 `courseware-doc/doc-stage.css` 中和层：把 preflight 会命中任意内容元素的每条重置（margin/padding/border 清零、标题/链接/列表/表格/sub/sup/hr 重置、媒体元素 block 化、img/video max-width 100%）在 `[data-doc-stage]` 作用域内逐属性 `revert` 回 UA 默认（与 preflight.css 逐条对应；box-sizing 不还原，镜像同为 border-box；渲染器自身样式全走行内 style 不受影响）；舞台根 div 补镜像的字体栈与 `line-height: normal`（折行位置由字体度量决定，跟随站点字体会漂移）。验证：页 3 算式与选项归行、页 13 题号/网格复位，`.mathjax_content svg` computed display 全部 inline；连续翻页 1→12 回归与此前基线一致；视频页无恙。**补丁（2026-07-18，7da0847，用户回测发现）**：暗色模式下课件文字随站点前景色变浅、在浅色黑板上不可读——`color` 是继承属性，preflight 中和层挡不住主题色从站点祖先渗入舞台（MathJax SVG 字形用 `currentColor` 填充，一并变色）；舞台根现钉死 `color:#000` + `colorScheme:"light"`。Playwright 双配色验证：dark 下站点 body 前景为米白（`rgb(242,237,223)`）而舞台内文字全部 `rgb(0,0,0)`，页 2/4 截图清晰，light 不变。排版基线原则修正为：**镜像查看器基线 = UA 默认 + border-box + Inter/微软雅黑 + UA 默认黑，宿主站的全局重置与继承性样式（字体、颜色、主题）都必须在舞台作用域内被中和/钉死**。**验收通过（2026-07-18，用户拍板）**：经四轮用户真实路径实测审校（换页残留、H5 加载、排版基线、暗色主题）逐项修复后，用户确认 P6-4 验收通过；页 2 黑板下沿的小号答案文字（A.30/B.35/C.37 压木托）经用户比对源站确认为原始内容如此，非渲染缺陷。原「待验收」清单中的批量硬化项去向：交互页行为（page 11 点击显示）已在单测+用户实测覆盖；`bundle:report` 已测 253 kB 持平；**69 页与镜像 Viewer 双渲染抽样比对、4:3 板书带仿射断言、≥3 种引擎 H5 沙箱抽测**分别并入 P6-9 总验收抽样、P6-5 课堂验收（16:9 顶置条目）与 P6-7/9 全量导入后的多引擎抽测（样本讲仅 cocos2，多引擎包需先导入其他讲）。
- **P6-5 课堂接入**（mathin）：doc 页型进 `CoursewarePage`/LiveShell/候课预载/冻结物化（D4）；预载改走批签 signed URL（D3，教师与学生统一走 `getSessionAssetUrls`）；H5 包候课 HTTP 缓存预热（清单取公开桶内 `__mathin_manifest.json`，D3）+ 候课黄灯语义。验收：用样本讲开一堂真实结构模拟课（1 教师 + 2 学生）：翻页/加星/视频同步/H5 页在线加载/动画自动播全通过；断网课（无 H5 页）完整走完；**16:9 页在 4:3 课堂舞台顶置呈现、画板可在板书带书写**；学生端拿不到批签之外的对象 URL；**H5 页二次打开经 DevTools 确认子资源命中 HTTP 缓存（预热与 308 缓存生效）**。
- **P6-6 4:3 增强轨：审计与批量流水线（✅ 2026-07-26 全量适配、人工确认与 865 讲双轨发布完成）**（分类脚本在镜像仓库；派生与导入在 mathin。**非阻塞任务**——轨道一已在 P6-4/5 打底，本任务按价值排期，不卡 P6-7/9）：§6.2 分类命令 + 报告；§6.3 背景批量派生 + 确认队列页（中台内）；A/B/C/E/F 类自动产 4:3 draft revision。镜像包新增 `adaptations.ndjson` 与 audit 对账；mathin 以发布包的原始背景 hash 定位 source revision，固定 PNG 元数据确保 CAS 重跑稳定，节点和 path points 同仿射变换（F 类保留 16:9 比例内容层，节点本身不随 4:3 舞台视觉放大）。样本讲 `101001827` 最终分类 A21/B3/C2/D28/E14/F1，41 页自动 draft、12 份背景人工核验后发布；全屏视频页为 A 原尺寸满幅，E 类 H5 填满 4:3 shell，F 类第 8 页背景居中裁切且标题/SVG 保持原始视觉大小、垂直位置与中线。Release 16 的 4:3 快照为 69 页（41 真 4:3 + 28 D 类合法顶置终态）；浏览器实测背景满铺 4:3、内容层保持 16:9 比例、标题居中。验收：分类报告数字对账平；自动类的 4:3 舞台/H5 呈现、发布闸门、16:9 回滚均已验证；D 类不自动发布，由教研逐页重排。全量年级批处理已在 P6-9 基线导入后复用同一命令完成；最终发布数量及 21 条系统已替代记录的语义见 §6.3.1 与下方 2026-07-26 补充。
- **P6-6 补充（2026-07-23）**：适配校对不应是只显示 revision ID 的盲审列表。`/dashboard/adapt-review` 必须提供两个分页工具：①背景确认队列每页至多 24 项，只签发该页的私有 URL，并排展示原始 16:9、派生 4:3、尺寸与裁切偏移；可逐项或选择当前页多项确认/退回，批量决策经单个原子 RPC 落库，任一项已非 pending 时整批拒绝。②页面分类与编辑队列默认查看 D 类、可筛选 A–F；具备 courseware.page.edit 的教研可切换页面分类，并进入既有 4:3 可视化编辑器调整草稿。分类覆写只更新审校元数据并重新进入待审，**绝不**静默重写 4:3 草稿或已发布 release；背景确认也不等于讲次发布。
- **P6-6 补充（2026-07-26）**：适配校对与 release 路径补齐。开发库实测 718 份背景 approved、pending=0；21 条 CAS 修复技术历史已由 §6.3.1 对应 migration 回填为 superseded，当前 binding/page/release 引用均为 0，不是人工返工项。适配校对页形成“背景确认 / 退回待修 / 页面分类与编辑 / 待发布讲次 / 历史审计”五页签，共享课程→讲次联动筛选；人工退回原因必填，裁切修复创建不可变 successor 并重新送审。待发布讲次支持单讲发布和当前页至多 24 讲的显式选择批量发布，批量 RPC 单事务执行、任一讲失败整批回滚，绝不因背景确认自动发布。唯一课件编辑器同时恢复“发布本讲”入口，存在未保存页面修改时禁止发布。**同日经人工确认后分 36 批发布剩余 864 讲，开发库现为 16:9 当前轨 865/865、4:3 当前轨 865/865、4:3 待发布 0；兼容主指针仍全部指向 16:9，4:3 发布未覆盖原生轨；稳定 release 在“已发布”列表仅展示状态，UI 与数据库 guard 均拒绝无新草稿的重复发布。**
- **P6-7 教研中台第一期（✅ 2026-07-19 实现与数据库验收完成）**（mathin）：§7.2 全部第一期能力。教研编辑页支持节点属性实时预览、结构化 JSON、新增元素、页排序/插入/复制/软删除、页修订预览与前向回退、整讲发布与回滚；图片仅本页替换会新建 shared asset 分支，并在服务端完成格式、解码、尺寸与 hash 校验。**同日双轨补强完成**：16:9/4:3 各自维护页头、讲 release、binding 与资源 variant；编辑器可切轨并在本页直接做轨内批量背景替换；班级可设默认轨、单讲可覆盖，开课冻结选择结果。`p6_courseware_tracks_assertions.sql` 实证双轨 release/资源隔离、班级/单讲优先级与冻结后不可切换；既有 studio/security/replacement 断言复跑通过。
- **P6-8 公共资源批量替换（✅ 2026-07-19 实现与数据库验收完成；2026-07-23 双轨补强）**（mathin）：`cw_replacement_uploads` 两阶段 staging（服务端图片格式/尺寸/hash 门禁 → 不可变 CAS）+ `cw_replacement_batches` / `cw_replacement_items` 审计；资源库提供服务端筛选/分页、图片详情使用树（课程→讲→页）、固定 revision 与冻结课次标记、上传新图对比确认、全量推 published 指针 / 部分新建 semantic branch 批量重绑及冲突安全的一键回滚。**公共资源库同样必须显式切换 16:9 原生版 / 4:3 稳定版：筛选计数、使用树、当前 variant、替换批次与回滚全部带 track；4:3 操作只能改 4:3 variant/binding，绝不推进 16:9 指针（反之亦然）。**`p6_courseware_replacement_assertions.sql` 在事务中实证：学生不能读取/写入；同一背景跨 3 讲的部分替换只改选中两讲、全量替换不重写 binding 且仅推进一个指针；两类批次审计完整且都可回滚。已发布 release 和已冻结课次仍 pin 到原 revision，需在受影响讲次另发 release 才生效。
- **P6-9 全量迁移与总验收**(两仓)：全量包导入（分年级分批，每批对账）；随机抽样 ≥60 页视觉比对（顶置模式下）；性能检查（页 doc 加载、Storage 出流、批签 action 延迟）；roadmap/memory 收尾。**不依赖 P6-6 完成**——全量以 16:9 顶置形态验收，4:3 增强按 §6.4 节奏后续推进。数据导入可在 doc 18 P4H-3 完成后执行；“865 讲可浏览”的 UI 总验收等待 P4H-5/6，统一从课程产品教学计划和 canonical workbench 进入，不再扩写旧 `/courseware/[courseId]/...` 目录。验收：865 讲全部可经新入口浏览、可开课；对账零 silent missing。
- **P6-9 爱学习历史补充（✅ 2026-08-05 v11 重导入；已由 §13 v31 取代）**：该记录只解释旧 G+ 52 讲/1525 页的画布语义和当时修复，不再定义现行范围或运行时。现行 G+/X+/A+ 170 讲合同、导入手册和证据分别见 §13、[`docs/runbooks/aixuexi-courseware-import.md`](../runbooks/aixuexi-courseware-import.md) 与 [`docs/evidence/r1/r1-9-aixuexi-courseware.md`](../evidence/r1/r1-9-aixuexi-courseware.md)。

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

## 11. P6-10 E 系列 2026 秋季接入（✅ 2026-08-04 导入完成）

2026 秋季这一版属于 E 系列同一课程族，但教材年度版本从 2025 换到 2026。E 系列的年度版本此前是按季节分裂的现状：暑期 18 个班型已经是 2026 新版，秋季/寒假/春季 54 个班型仍是 2025 旧版。因此版本既不能记在 `course_families.edition`（它表示「全国版」这类教材地域版本），也不能做成新的课程族。

### 11.1 已完成（2026-08-03）

| 迁移 | 内容 |
| --- | --- |
| `20260803000300_p6_course_catalog_versions` | 新建 `course_catalog_versions`；`courses` 增加 `catalog_version_id`（NOT NULL）与 `superseded_by_course_id`；唯一性收敛为 `(family_id, catalog_version_id, grade, term, class_type)` 与 `(catalog_version_id, product_code)`；回填 E 系列 2025旧版 54 门 / 2026新版 18 门，其余课程族各一条 `default` 版本；`course_families` 插入触发器自动建默认版本，`courses` 插入触发器补齐当前版本，既有写入路径无需改造 |
| `20260803000400_p6_catalog_version_surfaces` | `create_course_variant` 可显式指定版本；`get_course_family_detail` 返回 `catalogVersions` 与逐版本字段；`list_course_families` 支持 `catalogVersion` 筛选并在 `matched_variants` 带版本；`list_class_build_course_variants` 默认排除已被替代的课程并返回版本与 `is_superseded`；`get_class_build_course_detail` 带 `isSuperseded` |

配套改造：`scripts/cw-import.mjs`/`scripts/cw-adapt-4x3.mjs` 的讲次定位新增可选 `catalogVersionSlug`（CLI `--catalog-version`），不带该维度时定位到多行会被既有 `count <> 1` 断言挡下，不会误写；`supabase/seed/teaching-plans.json` 每条增加 `catalogVersion`；R1 正式初始化自然键升为 `catalogVersion+productCode`（`scripts/plan-r1-initialization.mjs`、`schemas/r1-initialization-manifest.schema.json`）；课程库版本筛选与徽标、版本矩阵页签、建班选择器「包含已被替代的历史版本」开关已接入 zh/en。

CI 重放不受影响：`scripts/ci-rebuild-db.mjs` 只回放 `courses.pre-family.seed.sql`，且回放点在 P4H-3 之前，那时 `product_code` 仍是全局唯一且 `family_id` 尚不存在。

### 11.2 导入执行记录（2026-08-04）

来源包 `D:/code/2026/2026-07_mofaxiao_courseware/inputs/mofaxiao-e-math-2026-autumn-2026-08-03`：1—6 年级 A/B/S 共 18 个班型、270 讲、16,451 页；下载、H5 离线、物化与页面模型审计全绿。其中 30 讲（1A、2A 各 15 讲）的 courseware_id 相对旧目录被替换，其余 240 讲入口 URL 未变但已强制重抓。

导入必须按新版独立讲次处理，不得复用旧秋季 270 讲，也不得做成旧讲次的 `release_no=2`：源课件标题里的 `MS2023`/`MS2026` 是命名残留，不能作为版本判断依据；入口 URL 相同也不能证明内容未刷新。

镜像侧导出包 `8a4001a9-2ab7-47a8-ac7b-3c004d427682`（`export mathin-package`，audit 全绿）：270 讲 / 16,451 页 / CAS 对象 16,517 / H5 包 700 / usages 46,035 / exclusions 11,702 全部有因，manifest sha256 `c121399284e6ebfc95ccb3ff6614e065f20429e163c2e5bd31a179df98a099eb`。

执行结果：

| 步骤 | 结果 |
| --- | --- |
| 建课程与讲次 | `teaching-plans.json` 追加 18 门 `catalogVersion=2026`，应用 `courses.seed.sql`：课程 79→97、讲次 919→1189；E 系列 2026新版 36 门 484 讲、2025旧版 54 门 651 讲 |
| 标记被替代 | 旧秋季 18 门写入 `superseded_by_course_id`，全部保持 `enabled` |
| 16:9 导入 | 270/270 讲成功、零失败；页 16,451、绑定 46,035、对象新增 456，`baselineDrift`/`conflicts`/`protected` 均为 0 |
| Storage 上传 | CAS 220 个（17 MB）、H5 包 236 个（5,458 MB，含 16,092 个包内文件）；其余 16,761 个对象按 SHA-256 命中零上传 |
| 4:3 适配 | 270/270 讲成功；自动适配 5,024 页、D 类顶置 11,427 页（合计 16,451）；派生背景 2,386 个，新增待审背景仅 3 条——240 讲与旧秋季共用源背景，其 4:3 派生此前已 approved |
| 发布 | 两条轨道各 270 条 `release_no=1`，轨道头全部就位 |

导入前对账已验证：`download_attempts` 跨批次 35,860 对 sha256 全部一致、零变更，新增对象来自 html adapter 与 H5 采集深度提升而非上游改版；实际上传量 220 CAS + 236 H5 与导入前预测完全一致。

讲次标题按导出包 `lessonName` 归一化（剥离「三秋/六秋」「第 N 讲」「A/B/S 版」「-定稿」「-MS20XX终版」「（创新）」）：257/270 与旧秋季相同，13 条差异中 11 条为措辞，2 条真换主题——`MFHK01913` 第 9 讲「经济与浓度→递推与归纳」、第 10 讲「一般行程→行程综合」。

资源按 SHA-256 全局去重，新旧版本并存不重复存储相同图片、视频与 H5 包。

### 11.3 本批次的两项人工判断

- **4:3 背景未经人工逐张核验即发布**。P6-6 的既定闸门是背景 `approved` 后由人工发布（§6.3「绝不因背景确认自动发布」）。本批次按运营指示跳过该环节：3 条新增待审背景以系统批注一次性确认，270 讲的 `adapted-4x3` 轨道随即批量发布。240 讲与旧秋季共用已核验过的派生背景，实际未经人眼的只有这 3 张，但发布动作本身绕过了闸门，后续如发现裁切问题需走 §6.3 的退回与 successor 流程修复。
- **13 讲共 45 条 `H5_NOT_OFFLINE` 排除**。全部是 `development_pending` 终态（Math3D 模块、xiaohoucode 登录墙），属镜像阶段 18/20/21 已裁决的历史遗留。旧 865 讲此项为 0，是因为那批页面在镜像阶段 21 已由 `library_page_exclusions` 移除；新秋季没有页排除记录，这些页以「只有背景、无互动」的空页形式入库，页文档 `nodes` 为空、无悬空绑定，导出侧双向对账仍平。

## 12. 爱学习双轨语义与 4:3 母版归位（2026-08-05 重导入）

### 12.1 首批为什么要推翻

爱学习的**内容母版是 1200×900，正好 4:3**。2026-08-03 首批把它当成 16:9：文档画布写成 `1200×675 / coordinateScaleY 0.75`，节点坐标却原样留在 900 空间。渲染时舞台按 675 高裁剪，**1525 页里 876 页（1007 个节点）的底部内容被 `overflow:hidden` 吃掉**；同时源播放器的呈现规则几乎没有移植，页面等于裸渲染源 HTML。两项叠加即人工复查判定的“效果不好”。

来源包本身也已重做，合同随之升级到 projection v11：

| 项 | 首批（v5） | 当前（v11） |
| --- | --- | --- |
| `canvas` | 1200×675，`coordinateScaleY 0.75` | 1200×900，坐标 1:1，无缩放字段 |
| `presentation` | 无 | `1200×675 / contentScale 0.75 / offsetX 150 / offsetY 0\|70`（289 页为 70） |
| `behaviors` | 无 | `splitQuestionScroll` 75 页、`singleQuestionScroll` 699 页、`stagedReveal` 187 页、`shapeTextFit` 290 页 |
| ITV | 投影 v1 | 投影 v4，增 `lastFrameBindingKey`、每节点 `pauseFrameBindingKey`、选项 `stateBindingKeys{selected,right,wrong}` |
| 题目互动 | 56 个离线包 | 58 个离线包 + 1 页 `capture_required`（来源 HAR 未捕获，原样带出，不静默丢弃） |
| bindings/轨 | 4863 | 4934 |

`catalog.status` 有 4 讲为 `partial`，那是**目录快照的年级覆盖状态**（`coverage_status`），不描述讲次本身；这 4 讲的 `offline-verification` 均为 `complete` 且 remote/missing/fatal 全 0。因此准入门槛压在每讲 offline-verification 上，catalog status 只作参考。

### 12.2 双轨语义与 E 系列相反

母版是 4:3，16:9 是源播放器 contain 出来的画框。两者的换算完全由 `presentation` 决定，且自洽：`contentScale 0.75 = 675/900`，`offsetX 150 = (1200 − 1200×0.75)/2`。

| 轨道 | 画框 | 内容 | 背景 |
| --- | --- | --- | --- |
| `adapted-4x3`（课堂舞台 / 默认好画质） | 4:3 | 母版 1:1 铺满，比源站大 33% 线性；**无板书带** | 16:9 装饰图 `object-fit: cover` |
| `native-16x9` | 16:9 | 缩 0.75、居中 pillarbox，xmind 页另加 `offsetY` | 同一张图精确贴合 |

**板书带只属于 E 系列**：那是 16:9 内容进 4:3 舞台的补偿（doc 16 §6.1）。爱学习内容本来就是 4:3，加带子只会平白缩小内容。

背景是 1920×1080 的 16:9 装饰图（木框 + 标题牌 + 中央白色内容井）。4:3 画框上 `object-fit: cover` 裁出的中央区域，宽度恰好是原 16:9 画框的中间 900/1200 —— **正是源站放内容的那块**，与背景设计的白色内容井对齐。所以 4:3 不需要任何特例代码，这也是本轮“4:3 适配非常简单”的根据。

**代价（已知并接受）**：cover 裁掉了背景左右各 12.5%，框架式背景的左右木柱与右下角吉祥物会被裁掉，场景式背景只丢边缘植被。替代方案是把整幅 16:9 contain 进 4:3（保住全部装饰，但内容面积只剩 56%），本轮按“课堂可读性优先”取前者。若后续要改判，只需换 `AixuexiStage` 的画框换算，页面 revision 不受影响。

### 12.3 移植过来的源播放器呈现规则

页面 JSON 只描述几何与源 HTML；让页面“长得像源站”的规则相当一部分只存在于播放器运行时。镜像项目阶段 49～61 把它们逐条还原并做过版式巡检，Mathin 侧落点是 `aixuexi-stage.module.css` 与 `aixuexi-presentation.ts`：

- **纯样式**：question-tk 滚动容器与面板展开、question-tk-head 三段式木牌皮肤、tk-summary 对话框、a44 形状文字盒、interact-plus 引导页（ct-131/132/133 含 `data-shadow-text` 描边）、答案/解析 moden25 药丸按钮、内联小图上限。
- **需实测**：a44 形状文字按框收敛字号（下限取 `behaviors.shapeTextFit.minFontSize`）、富文本内联小图 2 倍放大、分步揭示、折叠开关接线。
- **自收敛矫正（阶段 61 口径，只平移不缩放）**：答案面板负边距回收、节点夹回母版、控件让位。口径是**溢出与遮挡即使源站也有，本地化产物也要消掉**。

sanitize 白名单按“移植过来的规则实际选择到的标签/属性”定档，不是按源站原样放行。`<u>` 承载 `stagedReveal` 的填空揭示（416 处），`role` / `data-shadow-text` 是 moden25 按钮与描边文字的 CSS 命中点，删掉任何一个都会静默丢一类呈现；构建器与 `scripts/cw-import.mjs` 的两份白名单必须同步，导入侧的无损断言会挡下漂移。

### 12.4 实现坑（改这块前必读）

- **React 会重建注入的子树**。源站 HTML 经 `dangerouslySetInnerHTML` 注入，挂载后的重渲染会把已接线的折叠开关、已放大的内联图和已矫正的坐标一起抹掉（effect 内实测 `aria-expanded=2`，1.8 秒后为 0）。呈现规则必须整体幂等，并由 MutationObserver 跟随重建重复施加（重入标志 + 40 次上限），与镜像 `scheduleAixuexiLayoutCorrections` 同口径。
- **折叠开关必须自带 click/keydown**，靠舞台冒泡接不住——舞台的点击已经被分步揭示/翻页占用。渲染后没有 `aria-expanded` 的折叠开关会被镜像巡检判为死按钮（`control_inert`，阻断级）。
- **画布语义是数据合同**。`aixuexi-schema.ts` 用字面量把 canvas 钉死在 1200×900、presentation 钉死在 1200×675/0.75/150；`tests/aixuexi-courseware.test.ts` 有一条专门拒绝“把母版压进 16:9 画框”的用例。改这些数字等于改全部 1525 页的语义，必须连同重导入一起做。

### 12.5 重导入执行记录（2026-08-05）

前置对账确认零外部引用：`courseware_annotations` / `cw_replacement_items` / `lesson_page_notes` / `solution_records` / `session_learning_checks` / `session_preparations` / `cw_review_cycles` 均为 0；804 个 shared asset 全部为爱学习独占（与 E 系列共享 0、被替换批次引用 0、被派生背景引用 0）。

单事务清理（`courses` 4 门与 `course_lectures` 52 讲保留，导入器按 `product_code + no` 定位）：releases 104、track heads 104、bindings 9726、pages 1525、asset variant heads 1608、asset revisions 804、shared assets 804、asset objects 804、source lectures 52、source package 1。事务内二次断言任一外部引用不为 0 即整笔回滚。

重建：`pnpm cw:aixuexi:build` 得 52 讲 / 1525 页 / 4934 usages / 815 对象 / 58 个 H5 包 / 2471 个包内文件；分 4 批各 13 讲导入，`conflicts` 与 `baselineDrift` 全程 0，重跑单讲报告全部 existing、inserted 0（幂等）。

库内复核：1525 页文档全部为 `1200x900 / projectionVersion 11`；两轨各 52 release、52 讲头、1525 页头、4934 binding；58 `offline` + 1 `capture_required`；10 个 ITV 页 55 个事件。

## 13. 爱学习 projection v31 来源与 source-runtime 导入（P6-AIX-2）

### 13.1 输入清单与占位边界

2026-08-13 的三个来源包都通过逐讲离线验证，`remoteRequests`、`localMissing`、`fatalConsoleErrors` 均为 0：

| package | 课程 | 源站讲次 | 页面 | 教学计划补充占位 |
| --- | ---: | ---: | ---: | ---: |
| `2026-gplus-sujiao-math` | 4 | 56 | 1641 | 五、六年级各 2 讲，共 4 讲 |
| `2026-xplus-sujiao-math` | 6 | 84 | 2767 | 二、五、六年级各 2 讲，共 6 讲 |
| `2026-aplus-quanguo-math` | 2 | 30 | 1034 | 无 |
| 合计 | 12 | 170 | 5442 | 10 讲 |

来源没有提供的第 7/15 讲不导入课件；合并课程包的教学计划补充 10 条占位，状态为 active、无 release、课件准备状态为“未发布”。导入器只接受 catalog 中真实存在、`offline-verification=complete` 的讲次，不生成课件占位。

### 13.2 v31 取代 v11 的呈现合同

§12 的 v11 结论只解释 2026-08-05 的旧导入，不能继续作为运行时实现依据。v31 固定以下来源事实：

- 普通页内容坐标仍是 1200×900，但源播放器有两级舞台：1920×1080 外层承载 `slideClass`、背景与 padding，1200×900 内层水平居中并 `scale(1.2)`；外层再以 0.625 呈现到 1200×675。Mathin 必须消费 `playerStage` 与 `presentation`，不能把背景作为内容层 `object-fit: cover`，也不能恢复旧 xmind 平移特判。
- 部件保留完整 `transform` / `transformOrigin`；动画保留 step、group、effect、phase、showType、duration、delay；分步揭示读取 `revealStep` 与 `behaviors.widgetReveal.steps`。
- 题目图片尺寸由每讲绑定的 captured player module 执行。`sourceRuntime.questionImageSizing` 同时固定源模块、jQuery、执行包和证据 hash；旧 `aixuexi-presentation.ts` 的手工小图放大必须删除。
- `slide-runtime.css`、ITV runtime、embedded H5、TrueOrFalse 与 TopicClassification 都是来源包合同的一部分。Mathin 可以换宿主和资源寻址方式，不能用手抄 CSS、近似游戏或静态截图代替。

### 13.3 4:3 能力分类

分类器只检查页面结构；同一规则适用于三个 package：

| 模式 | 判定 | 4:3 呈现 |
| --- | --- | --- |
| `source-master` | 1200×900，且没有源动画、embedded H5、1920×1080 原生游戏 | 直接使用 1200×900 内容母版；背景按源外层舞台规则换算到 4:3 |
| `source-player-compat` | 任一节点有动画，或含 embedded H5，或画布/原生游戏为 1920×1080 | 保持源 1200×675 呈现与交互比例，置于 4:3 舞台上部，底部 225 逻辑像素留作课堂兼容区 |

当前来源命中结果：G+ 1641 页全部 `source-master`；X+ 一年级 208/665、二年级 173/517 页进入兼容轨，三至六年级为 0；A+ 一年级 10/497、二年级 31/537 页进入兼容轨。该结果是来源快照审计值，不得编码成 grade/package 白名单。

### 13.4 阶段退出证据

- **已通过**：三包构建器对 package key、课程/页面计数、年级/难度/版本、逐讲离线状态和 v31 文档做 fail-closed 校验。
- **2026-08-13 v31 基线已通过**：当时开发库精确拥有 3 个 source package、12 门爱学习课程、170 个 source lecture、5442 页；双轨各 170 个 release/head、5442 个页面 head 和 27541 个 binding。5020 页为 `source-master`，422 页为 `source-player-compat`。该数值继续描述当前 Production 1.0 release-1 合同，不代表 2026-08-27 开发库的新适配器头。
- **2026-08-27 开发增量**：`2026-summer-aplus-quanguo-math` 新增一年级 A+ 全国版暑期课程，教学计划保留 15 讲；第 1 讲《一个萝卜一个坑》和第 8 讲《逃家的小羊》共 66 页已导入，双轨各 2 个 release/head、66 个页面 head 和 550 个 current release binding，13 个其余讲次保持空模板、无 release。开发库爱学习当前合计 4 个 source package、13 门课程、195 个教学计划讲次（172 个 source-backed、23 个占位）、5508 页；该增量不改变 Production 1.0 的秋季 12 门/170 讲基线。
- **2026-08-13 v31 基线已通过**：构建与重导入 `baselineDrift=0`、`binding conflicts=0`；X+ 首讲重跑只返回 existing，不新增对象、revision 或 release。
- **2026-08-13 v31 基线已通过**：浏览器覆盖普通 G+ 4:3、A+ 动画、X+ embedded H5、TrueOrFalse、TopicClassification、计划第 7/15 讲占位和 `/en` Studio；当时的运行时错误为 0。
- **范围裁决**：G+/X+/A+ 170 条源站讲次进入 1.0；G+ 五/六年级与 X+ 二/五/六年级的第 7/15 讲共 10 条由教学计划补充占位，均无 release、准备状态为“未发布”。正式总基线仍为 1305 讲/2610 条 release-1，执行仍受 R1-9/15/18 约束。

### 13.5 2026-08-27 source-runtime 开发适配器

来源仓库此前已经把源播放器 DOM、源 CSS、captured player 模块、Topic/ITV/原生游戏和 H5 父子页协议收敛到一个 Viewer；Mathin 的旧 `AixuexiStage` 又把投影拆成 React 节点并重画入口，造成“进入互动”按钮、缩放与样式偏差。新导入接口把来源 Viewer 作为内容寻址 H5 原样封装：页文档使用 `source-runtime-page-v1`，只保存安全来源投影、资源/路由 binding 和 `mathin-source-runtime-v1` host 协议。Mathin 只拥有 sandbox、URL 物化、双轨外框和课堂桥，不拥有来源组件外观。

开发升级使用 `--upgrade-source-runtime`，逐页新增 revision 2、逐轨新增 release 2 并切换 current head；revision/release 1 与 snapshot 不覆盖、不删除。该 flag 只接受已 attestation 的本机 Docker，远程或 production 目标在写入前失败。旧 `aixuexi-page-doc-v1` 留作现有发布数据的只读兼容；Production 1.0 仍以批准的 v31 release-1 manifest 为准，未获授权部署。

本机开发库已完成 G+/X+/A+ 秋季 170 讲和 A+ 暑期 2 讲的版本化升级：5508 页的两轨 current page head 全部指向 `source-runtime-page-v1` revision 2，两轨 172 个 current lecture head 全部指向 release 2；current release snapshot 每轨精确包含 G+ 11132、X+ 19729、A+ 15591、暑期 550，共 47002 个 binding。旧 `aixuexi-page-doc-v1` revision 1 仍为 5508 页，四包均为 `imported/source-runtime-v1`，current head 缺失、legacy/native head 不一致、导入冲突与未解释 drift 均为 0。该结果只证明本机开发库，未写入 Xiaomi/生产。

暑期第 1、8 讲分别为 34/32 页并完成该升级；其余 13 讲仍为 0 页、0 release 占位。Playwright 分别复验暑期与历史 G+ 的“妙答连连1”：4:3 外框内保持 16:9 来源舞台顶对齐，入口仍为来源 `.aix-shared-interaction-entry`、橙色“开始”和 `(434,690,332×90)`，点击后打开本地 `/api/cw-h5/`，无“进入互动”替代按钮、无运行时错误；同时修复了 child `rendered` 先于 iframe `load` 时遮罩被重新置为 loading 的竞态。

补充抽查覆盖 X+ embedded H5 与 A+ ITV：source-runtime 的二级 H5 曾被入口 `X-Frame-Options: SAMEORIGIN` 拒绝，因为其直接父层按合同是 opaque-origin sandbox；现在二级 URL 带明确父层标记，只移除该响应的 XFO，继续保留课堂 runtime 注入、响应 CSP sandbox、内容寻址路径校验和普通顶层 H5 的 SAMEORIGIN 门禁。复验中 X+ 原游戏 canvas 完整显示，A+ ITV 保留来源透明 `.aix-itv-entry` 命中层并打开本地视频控制界面；可执行运行时错误与 HTTP 4xx/5xx 均为 0，无头 Chromium 仅记录源游戏在用户手势前请求音频的标准 autoplay 拒绝。

## 14. DEV-CW-1 课程产品统一课件工作区（待产品逐步确认）

> **当前状态**：`STEP 3A UNIFIED HOST / IN PROGRESS`
>
> **施工授权**：产品负责人已确认 Step 0、Step 1、Step 2 与 Step 2A。Step 3 的 PageDoc 单页写态虽已交付，但产品负责人在首个页面审计中确认不能用页面级／属性级补丁追赶原渲染器；2026-08-31 进一步确认从成熟预览基础升级统一宿主：预览、正式课编辑和微课编辑是同一工作台的三种模式，正式课只比微课多 4:3 适配。当前只允许无写入地收敛工作台模式、画布适配和来源 renderer 宿主协议；不得修改 schema、重导数据、扩到爱学习写态、批量回填或触碰生产。
>
> **推进原则**：一个批次只交付一个可人工审计的增量。每批机器检查通过后只记为 `READY FOR USER AUDIT`；必须收到产品负责人对该批布局和功能的明确确认，才能开始下一批。未回复、仅查看页面、机器检查通过或 Agent 自评均不构成确认。

### 14.1 问题与证据边界

目标工作流固定为：

`课程产品 → 课程/版本 → 教学计划讲次 → 指定页面 → 统一课件工作区 → 草稿/审核/发布`

教研从课程预览发现 16:9 内容问题或 4:3 适配问题后，应从该页面直接进入编辑上下文；不得再经过“讲次工作区 → 课件工作台”的重复跳转。统一工作区同时承载页面内容、两条版式轨、资源绑定和版本状态，但不把导入来源、草稿与已发布 release 混成同一层数据。

2026-08-31 的只读核对只覆盖当前仓库与本机 Docker 开发库：

| 现状 | 本机证据 | 对规划的限制 |
| --- | --- | --- |
| 课程预览先进入讲次工作区，再从主操作进入 Studio | 现有路由存在两次进入动作 | 第一批先审计入口和工作区布局，不先扩展编辑器 |
| E 系列有 71,552 个 16:9 `page-doc-v1` 页面；16,451 页有 A～E 分类，但 `adapted-4x3` 页面 head 为 0 | 本机开发库聚合 | A～F 当前主要是分类元数据，不能宣称已有可独立编辑的 4:3 页面 |
| 爱学习有 5,508 个 `source-runtime-page-v1` 页面；两轨页面 head 全部指向同一 revision。按旧投影权威重算为 `source-master=5,084`、`source-player-compat=424`，与 5,508 页历史模式逐页比对为 0 差异 | 本机开发库只读聚合与逐页比对 | 当前 4:3 是宿主呈现语义，不是独立可编辑内容；`source-master` 恢复原 4:3 排版等比呈现，动画/H5/原生题型/宽画布继续顶部兼容，不得把所有页面一律顶置或伪装成双稿编辑 |
| 教师微课有 108 个 4:3 `courseware-composition-v1` 页面 | 本机开发库聚合 | 12×9 网格、插入游戏/H5/工具可作为交互参考，但不能直接替代正式课程双轨模型 |
| 资源替换 RPC、影响树和回滚模型已经存在，但本机 replacement batch 与 4:3 派生资源记录均为 0 | 当前 schema/UI 与本机数据 | 先以页面上下文做影响预览和样本替换，不直接开展全库批量替换 |
| `source-runtime-page-v1` 由来源 Viewer 拥有 DOM/CSS/行为 | 当前 schema 与 renderer 合同 | 文字/节点级真编辑必须另建来源 patch/投影协议；协议确认前只允许宿主叠加、遮罩、裁切和资源绑定类非破坏编辑 |

本节不把以上本机计数写成生产事实。R1-9 正式来源 inventory 与 release-1 基线仍按 doc 25 单独核验；若后续本机事实改变，先更新本表，再决定是否调整批次。

### 14.2 产品对象与编辑分层

统一工作区编辑的是“一个稳定讲次下的指定页面”，不是孤立素材，也不是研发任务卡。数据和交互按以下五层保持可解释：

| 层 | 用户可做的事 | 传播范围 | 版本规则 |
| --- | --- | --- | --- |
| 导入来源基底 | 查看原始 16:9/source runtime、重新定位来源 | 不直接修改 | 来源对象与已发布 revision 保持不可变 |
| 共享内容修订 | 修正文案、公式、图片语义和可共享元素 | 默认同时作用于 16:9/4:3，提交前显示影响 | 新增草稿 patch/revision，不覆盖历史 |
| 轨道版式 | 移动、缩放、裁切、换行、隐藏、重排 | 只作用于当前轨；可显式复制到另一轨 | 16:9 与 4:3 分别保存 layout recipe |
| 资源绑定 | 替换当前页、当前讲、课程版本、课程族或全部引用中的图片/背景 | 用户每次显式选择，先看影响清单 | 使用既有 replacement ledger；部分替换走 rebind，全量替换才移动共享指针 |
| 发布与冻结 | 保存草稿、提交审核、发布、查看历史 | 新 release 只供之后显式采用 | 已发布 release、当前及历史课次快照不回写 |

A～F 只作为 4:3 的起始排版策略，不作为审核状态或强制分类：A 左裁切、B 小幅溢出/平移、C 完整适配、D 人工重排、E 16:9 兼容壳、F 居中标题；用户还可以选择“自定义”，从当前 16:9 页面建立独立 4:3 layout recipe。切换策略必须先预览差异，用户确认后才替换当前 4:3 草稿的版式参数，不覆盖共享内容或已发布 revision。

### 14.3 首轮布局假设（只供 Step 1 人工审计）

下列布局是待审假设，不是已冻结设计：

- 顶部对象栏保留课程、版本、讲次、页面、草稿/审核/release 身份和返回课程产品的路径。
- 左侧为页面目录与问题定位；同一项显示 16:9、4:3、待修、已改和审核状态，不另建一个“适配校对”数据库式页面承担编辑。
- 中央为画布，可在 16:9、4:3 和并排对照之间切换；进入时保持用户从课程预览选中的页面。
- 右侧为上下文属性区，仅显示当前选中页面或元素可执行的内容、布局、资源替换、插入和影响范围动作。
- 版本历史、审核意见和发布检查作为同一讲次的辅助面板，不与教师微课审核混成一个默认大列表。

Step 1 必须用实际课程、实际讲次和实际页面的只读数据给出可访问页面；产品负责人可以调整栏位归属、顺序、宽度、命名、默认轨道和主操作。确认前不得实现持久编辑、迁移或删除旧入口。

### 14.4 功能边界

统一工作区的目标能力分四组：

1. **页面微调**：修改文字/公式、替换图片、移动/缩放/裁切元素、调整层级/显隐、换行与局部排版；修改前后可对照。
2. **4:3 适配**：按页选择 A～F 或自定义；支持整体缩放、裁切、平移、换行、隐藏与重排；16:9 内容修订和 4:3 几何调整分别保存。
3. **上下文替换**：在发现不合适背景或图片的当前页面直接发起替换，选择影响范围、查看命中页面/讲次/课程与冻结引用，执行后可从 replacement ledger 回滚；公共资源库保留为高级治理和审计入口。
4. **内容扩展**：在能力和课堂同步合同允许时插入文字、公式、形状、图片、游戏、单文件 H5 与工具。教师微课的网格和插入体验作为参考；未声明同步 provider 的自研互动在课堂继续只读/fail closed。

正式 `page-doc-v1`、`source-runtime-page-v1` 和 `courseware-composition-v1` 不强行共用同一份页面 schema。统一的是工作区、选中态、草稿/review/release 语言和用户动作；各来源通过明确 capability adapter 声明“可改内容、可改版式、可换资源、可插入、可发布”的能力。未知来源或未实现动作必须显示原因并 fail closed。

#### 14.4.1 来源渲染一致性硬门

2026-08-31 继续抽查后，产品负责人确认“进位制初步”的标题偏移是源站 2026 年四年级秋季全系列特例，其他年级没有同类现象，预览与编辑器均复现，因此该页不再作为 Mathin 编辑器偏移证据，也不做逐页或 `data-align-v` 特判。本阶段保留来源 renderer 边界审计，但不再以修复该源站内容问题阻塞统一工作台。

来源页此后按三层分工：

| 层 | 所有权 | 合同 |
| --- | --- | --- |
| 来源渲染内核 | 对应来源／导出器 | 以内容寻址包携带 DOM renderer、CSS、字体、必要 JS、交互结束态和 `sourceFingerprint`；同一来源页在预览、编辑、课堂和微课引用中使用同一内核 |
| Mathin 编辑宿主 | Mathin | 只负责画布适配、轨道、资源 URL、选择桥、typed patch／整页 payload、保存状态和课堂桥；不得手抄来源 CSS 或用页面 ID 特判 |
| Mathin 覆盖层 | Mathin | 新插入的文字、图片、游戏、H5、工具及来源暂不支持的非破坏叠加使用 Mathin 自有 composition／overlay renderer，不污染不可变来源基底 |

统一宿主只有一个 `CoursewareWorkbench`，按模式裁剪能力，不再维护三个各自演进的页面组件：

| 模式 | 共用能力 | 本模式加载的差异 |
| --- | --- | --- |
| `preview` | 同一来源 renderer、资源缓存、可用宽高内完整适配、页面目录、翻页与快捷键 | 不加载插入顶栏、属性右栏和写态 |
| `formal-editor` | 预览模式的 renderer 与画布行为，加选择桥、编辑顶栏、属性右栏和保存状态 | 增加 16:9／4:3／对照与 4:3 适配能力 |
| `microcourse-editor` | 与正式课相同的选择、插入、属性和保存组件；来源基底仍走相同 renderer | 默认 4:3，不加载正式课 4:3 适配模块 |

模式切换不得替换渲染权威：同一页、同一 revision、同一资源和同一交互状态在三种模式中必须进入相同的 `StagePreview` renderer adapter；编辑选框、拖拽手柄和属性面板属于宿主覆盖层，不能复制来源 DOM 或改写其排版。页面 schema、action 和保存事务仍由 adapter 持有，统一组件不把正式 PageDoc 与教师微课 composition 强并成一份文档。

统一兼容指“统一宿主协议”，不指“用一个 React DOM 重画所有来源”：

- E 系列继续保留可编辑的稳定 `nodePath`／PageDoc 模型，但来源基底必须由魔法校导出器提供的版本化渲染内核呈现；16:9 与派生 4:3 payload 都交给同一内核，避免两套 CSS／字体语义。
- 爱学习沿用已经落地的 `source-runtime-page-v1`：来源 Viewer 拥有 DOM/CSS/行为，Mathin 只宿主。首期可共用选择、画布、覆盖层、保存和 4:3 宿主能力；文字／节点真编辑只有在来源 runtime 声明 typed patch capability 后才开放。
- 教师微课继续使用 Mathin 自有 composition；引用 E 系列或爱学习页面时，底层来源页走相应渲染内核，新增组件走覆盖层。因此正式课工作区仍只比微课工作区多 4:3 轨道能力，来源差异停留在 renderer adapter 内。

现有 `SourceRuntimeStage` 与 `mathin-source-runtime-v1` 证明内容寻址 iframe、资源物化和课堂桥可行，但 v1 只有 render／advance／error，没有编辑选择与 patch 握手。Step 3A 只审计一个版本化下一代合同：runtime 声明 `format + sourceFingerprint + capabilities`，宿主发送页面 payload／资源／轨道／交互状态，runtime 返回 `rendered`、稳定节点选择与错误；未知 format、fingerprint 漂移、缺资源或未声明编辑能力一律 fail closed。`DocStage` 暂时保留给 Mathin 自有 overlay/composition 与历史 release 兼容，不再被默认视为来源基底的长期权威渲染器。

一致性验收不逐页人工修补。导出器先对全量页面生成“语义签名” inventory（节点 adapter、富文本类／属性、字体、公式、表格、裁切、动画、H5／视频、4:3 模式）；每种签名至少进入一个来源 Viewer ↔ 便携 runtime 的自动截图／结构对照样本，未知签名阻断扩量。产品负责人只人工审计这些代表页和真实工作流；机器对照证明覆盖的 renderer 合同，不替代人工判断画面是否可接受。

Step 0 还需要产品负责人明确以下事项，规划不代替这些产品决定：

- 用户原述“做一个视频”若实际指“自由做一个 4:3 页面/版本”，继续纳入自定义适配；若确指录屏、视频生成或导出，则作为另一条工作流单独规划，不默认塞进页面适配。
- 指定 Step 1～6 使用的首个 E 系列样本讲次、首个爱学习样本讲次，以及各自至少一张典型问题页；Agent 不自行挑选方便但不代表真实问题的样本。
- 确认 Step 1 的默认画布是 4:3、16:9 还是并排对照，以及页面目录、属性区、版本/审核面板的初始归属；本节 §14.3 仅为待审假设。
- 确认资源替换的常用范围是否只保留“当前页/当前讲/课程版本”，把课程族与全部引用收进高级选项；任何范围都不预设为批量执行。

### 14.5 入口收敛方向

新工作区通过人工验收前，现有入口全部保留。验收后的目标归属为：

| 现有入口 | 目标归属 | 何时允许调整导航 |
| --- | --- | --- |
| 课程产品 | 继续作为课程、版本、讲次、页面和统一工作区的主入口 | Step 1 通过后可增加直接入口；Step 7 通过前不删除兼容路径 |
| 研发任务 | 变为课程产品内“我负责/待处理”的过滤或任务投影，不再是平行制作空间 | Step 7 单独验收后 |
| 适配校对 | 变为统一工作区的异常/待审核视图；教师微课审核使用独立对象与队列 | Step 6、7 分别验收后 |
| 公共资源 | 保留高级资源治理、历史和回滚；日常替换从当前页面发起 | Step 4 通过后才允许降级导航权重 |

### 14.6 分批实施与人工确认门

每一步独立提交，只包含该步文件。实现批次在产品负责人确认前只运行保证页面可启动、类型/版本化合同和本次硬门所需的最窄检查；不跑全量回归、批量重导、跨浏览器、正式发布 Gate 或生产写入。

| Step | 本批唯一产物 | 产品负责人必须人工审计 | 未确认时禁止 |
| --- | --- | --- | --- |
| **0 规划确认** | 本节的问题、对象分层、目标路径、入口归属与分批顺序 | 确认是否准确表达真实工作流；确认“共享内容修订/分轨版式/替换范围”边界；指定首个 E 系列与爱学习样本讲次 | 页面代码、schema、开发库写入、批量任务、生产动作 |
| **1 信息架构与只读布局** | 从课程产品指定页面直接进入的只读工作区；只展示页面目录、16:9/4:3/并排画布、属性区占位和版本身份 | 在 `http://192.168.5.213:3130/...` 实际确认进入路径、栏位、信息密度、默认视图、翻页与返回路径 | 持久编辑、数据迁移、旧入口删除、Step 2 控件实现 |
| **2 功能交互样机** | 在 Step 1 壳内提供不写库的文字/图片/布局、A～F/自定义、替换范围和插入动作演示；能力不可用时显示原因 | 逐项确认操作名称、位置、选中反馈、撤销预期、16:9/4:3 联动规则和来源能力提示 | 新表/RPC、真实保存、资源批量替换、跨讲修改 |
| **3A 来源渲染一致性 Gate** | 先用一个内容寻址来源 runtime 同时呈现当前 E 系列样本与按语义签名选出的代表页；接通稳定 `nodePath` 选择桥，但不保存、不改数据库 | 确认样本无需页面 ID／`data-align-v` 等特判即可与来源 Viewer 一致；确认字体、公式、表格、裁切、自动／点击动画、H5／视频的代表签名；确认 runtime fingerprint 与能力提示可见且失败时不会静默降级 | PageDoc 写态复审、schema/RPC、整讲重导、爱学习写态、Step 4 |
| **3B PageDoc 单页纵切复审** | 3A 通过后，把已实现的单页草稿保存／重载接到来源 runtime 的选择和重渲染协议；仍只限本机一个 E 系列页面 | 修改文字／图片／位置后由同一来源内核重渲染，刷新可重读；确认共享内容与分轨几何没有互相污染；确认历史 release 未变 | 适配整讲、爱学习写入、公共资源跨页替换、生产部署 |
| **4 4:3 样本讲次** | 在同一 E 系列样本讲次内，为有限页面建立 A～F/自定义 4:3 草稿和并排差异预览 | 按页确认缩放、裁切、平移、换行、重排、策略切换和撤销；确认发布预览符合预期 | 71,552 页批量回填、默认策略改写、爱学习全量转换 |
| **5 页面上下文资源替换** | 先 dry-run 展示一个背景/图片在页、讲、课程版本、课程族、全部引用五种范围的影响；产品确认后只执行一个本机样本并验证回滚 | 核对命中清单、冻结引用提示、部分/全量语义、替换后页面和 rollback 结果 | 未展示影响就执行、跨范围默认勾选、全库 replacement、生产 Storage 写入 |
| **6 爱学习/source-runtime 决策样机** | 对一个指定爱学习页面分别说明并演示可行的宿主叠加/遮罩/裁切方案，以及需要来源 patch adapter 的文字/节点真编辑边界 | 产品负责人明确选择首期能力：仅非破坏叠加，或批准另做来源 patch 协议；确认 4:3 期望 | 把 iframe 当普通 PageDoc 改写、重造来源 DOM/CSS、升级 5,508 页、生产导入 |
| **7 插入、审核与入口收敛** | 在已通过的工作区中接入获准的游戏/H5/工具能力；分开正式课件适配审核与教师微课审核；给出侧栏调整前后对照 | 确认插入体验、课堂只读/同步提示、两类审核对象、研发任务/适配校对/公共资源的最终可见位置 | 删除旧导航/路由、合并不同审核状态机、开放未审计互动 |
| **8 扩量与生产候选** | 先生成 E 系列与爱学习的真实 inventory、迁移/回填 dry-run、影响计数、耗时预算和回退方案；再由产品负责人另行选择扩量批次 | 审核精确对象数、样本通过率、失败隔离、旧 release/课次冻结保护、预计时长、发布与回退窗口 | 未授权批量写入、长时间全库任务、Xiaomi/生产 migration、Storage/release 改写 |

### 14.7 每批交付记录与停止条件

每批在本节追加一行记录，字段固定为：

| 字段 | 内容 |
| --- | --- |
| Step/状态 | `PLANNED`、`IN PROGRESS`、`READY FOR USER AUDIT`、`CHANGES REQUESTED`、`USER ACCEPTED`；只有产品负责人明确回复后才能写 `USER ACCEPTED` |
| 变更边界 | 路由、组件、schema/表/RPC、样本课程/讲次/页面、是否写入数据 |
| 验收入口 | UI 使用局域网开发链接；文档/合同使用具体文件锚点；不得用 localhost 作为产品验收入口 |
| 人工结论 | 产品负责人确认日期、确认项、保留意见和下一步授权范围 |
| 机器证据 | 仅记录该批实际执行的窄检查；不得把检查通过写成布局或功能已验收 |
| 提交 | 该批独立 commit；不得夹带下一批或无关改动 |

任一情况立即停止当前批次并回到人工审计：产品负责人要求改变布局或功能归属；发现来源能力与样机假设不一致；变更面将跨入下一 Step；需要新增 migration/RPC、批量回填或超过一个样本讲次；预计验证或数据任务超过 15 分钟；需要生产写入、服务重载或不可逆动作。停止时保留当前可运行的小增量，报告实际差异，不以“顺手完成”为由继续扩张。

### 14.8 当前交付记录

| Step | 状态 | 证据/入口 | 人工结论 | 下一步权限 |
| --- | --- | --- | --- | --- |
| 0 规划确认 | `USER ACCEPTED` | `docs/plan/16-p6-courseware-platform.md` §14；active 登记见 doc 00/04/25 | 2026-08-31 产品负责人回复“开始执行” | 只授权 Step 1 |
| 1 信息架构与只读布局 | `USER ACCEPTED` | 稳定讲次路由使用 `?workspace=courseware&canvas=compare`；本机 E 系列样本“进位制初步”和爱学习样本“10的认识和加减法（上）”由交付消息提供局域网入口 | 2026-08-31 首轮审计要求：主操作与版本筛选同排；缺少 4:3 时提示并保留 16:9；各轨画布完整适配可用宽高。第二轮要求：三点菜单一并下移；“对照”保持双栏且缺失侧显示空态；爱学习普通源母版恢复直接 4:3，兼容页继续顶置；移除画布标题行与底部批次状态条。产品负责人随后回复“通过，继续” | 只授权 Step 2 |
| 2 功能交互样机 | `USER ACCEPTED` | 在已确认的右侧“页面与能力”栏提供四个页签；仍使用 Step 1 的 E 系列与爱学习局域网入口 | 已实现微调、A～F/自定义、五档替换范围、插入、选中反馈和会话级撤销。爱学习只开放 E 与宿主级自定义，文字/节点/插入因来源 patch 尚未决定而 fail closed；2026-08-31 产品负责人回复“审计通过” | 只授权 Step 2A 共享编辑框架迁移 |
| 2A 共享课件编辑框架 | `USER ACCEPTED` | 一个 `CoursewareEditorWorkbench` 直接渲染页面目录、插入顶栏、画布/翻页、右栏标题和右栏正文，两条链共用 `CoursewareInsertionToolbar`；微课 adapter 是共同功能基线，正式 adapter 只额外开启 4:3 适配；正式轨道内重复标题行退出 | 2026-08-31 产品负责人回复“审计通过”；要求工作区整体重构完成后再双端回看并定稿组件表现 | 只授权 Step 3；双端定稿列为 Step 7 后、Step 8 前人工门 |
| 3A 来源渲染一致性 Gate | `IN PROGRESS` | “进位制初步”标题偏移已由产品负责人核对为源站 2026 年四年级秋季全系列特例，预览与编辑器一致复现；该页退出编辑器回归证据，不再逐页修补。当前施工转回统一工作台、共同 renderer adapter 和保存反馈一致性 | 产品负责人确认“从现有预览组件基础升级编辑器；三者为同一组件不同形态；正式课只多 4:3”，并要求不能只共享外壳或槽位 | 只允许 3A 工作台与 renderer adapter 小增量；禁止 Step 4、schema/RPC、重导、批量和生产动作 |
| 3A-1 统一工作台模式与画布 | `CHANGES REQUESTED` | 三个主入口已登记为 `CoursewareWorkbench` 的 `preview`／`formal-editor`／`microcourse-editor` 模式并共用 `CoursewareStageViewport` | 首轮人工审计发现仍由正式课、微课各自装配顶栏／保存／右栏，正式课保存入口消失、微课保存回退到右栏；因此仅有模式 dispatcher 与画布共享不构成完成 | 只修正同一工作台实现层，不进入后续来源 runtime 或扩量 |
| 3A-2 共享编辑表面与保存顶栏 | `READY FOR USER AUDIT` | 新增唯一 `CoursewareEditorAdapterSurface`，正式 PageDoc 与微课 composition 都通过它挂载插入栏、保存状态、右栏和共享 `CoursewareStageViewport`；`CoursewareWorkbench` 顶栏横跨画布与右栏，左侧固定插入、右侧固定自动保存状态与立即保存按钮，右栏只保留属性／能力。PageDoc 继续调用 `StagePreview`，composition grid 继续以 `CoursewareCompositionStage` 为来源基底并只叠加选择／拖拽层 | 待产品负责人核对：两种编辑器保存状态和按钮均在同一顶栏右端；微课右栏不再承载保存；正式课修改后出现未保存／保存中／已自动保存并可立即保存；预览、正式、微课的相同来源页面仍由同一 renderer 呈现 | 未确认前不继续拆目录／翻页公共实现，不进入来源 runtime、Step 4 或任何数据扩量 |
| 3B PageDoc 单页纵切复审 | `CHANGES REQUESTED` | 已实现的显式入口、800ms 自动保存、立即保存与离页保护保留，但当前 `DocStage` 画面不再作为可接受的来源一致性证据 | 等 3A 通过后再用来源 runtime 复审修改、保存、刷新和 release 不变 | 3A 未通过不得继续 |

Step 1 变更边界：只新增只读数据 loader、连续三栏工作区、画布自适应叶子、课程预览直达按钮、双语文案和定向合同；首轮修订移动课程产品主操作、增加 4:3 缺失的 16:9 降级提示，并把单轨舞台约束为可用宽高内等比完整显示。第二轮把三点菜单移入同一命令行，使对照缺轨时保留双栏空态，按不可变爱学习布局重建旧 4:3 投影，并移除中央冗余标题行和底部状态条。爱学习判定与旧权威在本机开发库 5,508 页上比对为 0 差异；普通 1,200×900 源母版直接呈现为完整 4:3，带动画、嵌入 H5、原生题型或宽画布的 424 页保留顶部兼容带。不接 editor action，不新增 schema/RPC，不写数据库/Storage，不删除讲次工作区或旧 Studio。机器证据为 TypeScript、受影响 ESLint、双语键 5,264×2、定向 Vitest 3 文件 18/18；这些证据不代表布局已经获得产品确认。

Step 2 变更边界：只把右侧能力占位替换为一个 client 叶子样机。四个页签分别承载内容微调、4:3 A～F/自定义、背景/图片替换范围和内容插入；内容修订默认双版联动、几何只作用 4:3、替换只展示影响范围、游戏/H5/互动继续受课堂同步 provider 门约束。样机历史只存在 React 会话状态，支持撤销上一步和清空，刷新即消失；没有 `fetch`、Server Action、editor action、schema/RPC、数据库/Storage 或 release 写入。爱学习来源运行时只开放 E 兼容顶置和宿主级自定义预览，A～D/F、文字/节点真编辑与插入继续 fail closed，等待 Step 6 的来源能力决策。机器证据为 TypeScript、受影响 ESLint、双语键 5,321×2、Step 1/2 定向 Vitest 2 文件 9/9；这些证据不代表产品负责人已确认功能名称、位置或交互语义。

Step 2A 变更边界：正式课程统一工作区和教师微课 composition 编辑器不再各自拼装独立外壳。`CoursewareEditorWorkbench` 直接拥有三栏两行几何、页面目录头/正文/页脚、中间插入顶栏、画布与翻页页脚、右栏标题和右栏滚动正文；正式 PageDoc／source-runtime 与微课 composition 只提供数据、动作和能力内容。`CoursewareInsertionToolbar` 统一七枚插入动作的顺序与按钮语义，微课继续接真实 action/Dialog，正式继续接无写入会话样机。`MicrocourseVariantPreview` 另直接接入成熟 `CoursewarePreviewWorkspace`，同步获得可拖拽目录、全屏、可用宽高内完整适配、上一页/下一页和键盘翻页。Git 历史确认 `487b60d` 已实现标题栏插入和左栏重命名，当前 composition 保留该布局及后续工具组件、多互动和 800ms 自动保存。第三轮审计把微课 adapter 定为共同功能基线，正式 adapter 只额外声明 `adapt4x3`，并删除轨道画布内重复的“16:9 原生版”等标题行；不借此把两种文档 schema 或写态强并。正式课程仍只有无写入样机，共享组件不导入 action、不调用 `fetch`；本批不新增持久化。最新机器证据为 TypeScript、受影响 ESLint和共享 Workbench／Step 2／微课编辑链定向 Vitest 12/12；这些结果不代替产品负责人后续人工审计。

Step 3 已实现部分的边界不变：写态仍由显式 `edit=page-doc`、固定讲次 `ff04ee0e-2112-43c5-b4fd-27f0d853d3c3`、固定第 5 页 `b58bbb24-e11a-418a-b269-92dde7009fbe` 和 `courseware.page.edit` 四重条件限制；800ms 自动保存、立即保存、乐观锁与离页保护继续存在，但暂停作为 Step 3 验收证据。首轮把进入偏移归因于 `slideInLeft`，后续虽以 `settleAuto` 解决“播放动画”和“隐藏标题”的矛盾，产品负责人再次审计仍看到标题内部布局偏移。只读核对进一步确认当前 revision 为 import r1、没有 draft，父组和富文本几何与来源导出完全一致；偏移来自富文本 HTML 依赖的来源 CSS／字体运行时没有进入 `DocStage`。因此不实施 `data-align-v` 单项补丁，也不改节点坐标。下一可施工批次改为 3A：先让来源拥有的 renderer runtime 在无数据库写入条件下证明 E 系列代表语义可复现，并复用爱学习已经验证的宿主隔离方法；只有产品负责人确认该根方案后，才把现有单页保存能力接回 3B。期间插入、4:3 A～F、自定义、上下文资源替换、爱学习写态、整讲和生产动作继续关闭。
