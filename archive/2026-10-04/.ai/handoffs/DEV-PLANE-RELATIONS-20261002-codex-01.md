# DEV-PLANE-RELATIONS-20261002 · Codex 第 01 次交接

- 发出方 / 接收方：领域 worker plane_relations_deep → 本批 root 集成人。
- 目的：实现交付、请求只读复核及共用接入。
- 关联任务卡：`DEV-PLANE-RELATIONS-20261002`。
- 代码 base：`4f9939250a10267a1d7a01e3ea2fda81a5eb9ab7`。
- 代码 head：`81093ac1bc50dd46066e87df6bcc26f9d09040cb`。
- 分支 / worktree：`codex/plane-relations-deep-codex` / `.worktrees/plane-relations-deep-codex`。

## 已实现

- `plane-relations/`：`18-create` 自绘及累加三角形/严格凸四边形；选底、真实高、底边分点与同高两分片、约束顶点沿真实平行线移动并可解除、四边形对角线四分、一层中点三角形的独立复制。观察属于各自材料，删除清理、复制不保持源依赖。复用 construction、HeightMark、现有动作 ID、移动/旋转语义动画与共用 contextActions。
- `plane-overlap/`：`33-create` 自绘/编辑凸纸片、独立尺寸、稳定 A/B 引用及标识、移动/旋转、真实交集/并集/A−B。差集返回互不重叠凸片，包含时保留孔、横穿时保留多片；区域不按包围盒或 SVG 像素计算。
- 两份领域测试；`20261002000300_tool_plane_relations_overlap.sql` 仅定义并撤销公开执行权的四个 state/scene helper，没有写入或执行数据库。

## 精确合同及 root 接入点

- 导出：`plane-relations/scenes.tsx` 的 `planeRelationsScene`；`plane-relations/validation.ts` 的 `isValidRelationsState`；重叠相应为 `planeOverlapScene` / `isValidOverlapState`。
- 版本：`plane-area-relations-lesson-v2` / `18-create`；`plane-overlap-lesson-v2` / `33-create`。
- 面积关系沿用 construction，逐对象追加完整的 `params.base.ID`、`params.fraction.ID` 与 `flags.height.ID / division.ID / parallel.ID / diagonals.ID / midpoints.ID`。三角形使用 division/parallel/midpoints，四边形使用 diagonals；高可对两类开启。分点范围 0.05～0.95；底边引用必须属于本材料。三角形锁定期间宽高输入停用，真实平行拖动不受网格吸附干扰。
- 重叠追加 `params.pairA / pairB`（-1 或两个不同的有效对象 ID）和 `region`（0 原纸片、1 交、2 并、3 A−B）。添加、复制和无关材料操作保持 A/B，删除只清空缺失槽。
- 两域不存派生交点、分片或重复面积；沿用构造材料 16 张、单多边形 32 点、总计 192 点及各 record 256 键边界。面积关系进一步限定每张 3/4 个严格凸顶点；重叠可保留同向共线编辑点。
- SQL helper：`tool_plane_relations_state_is_valid`、`tool_plane_relations_scene_is_valid`、`tool_plane_overlap_state_is_valid`、`tool_plane_overlap_scene_is_valid`。外壳限定 toolId/contentVersion、精确 payload/title/initial；异常 false，撤销 public/anon/authenticated/service_role execute。root 负责聚合入口、目录、类型、同步 provider 与受控执行。
- 未写 catalog、contract、scene-registry、动作图标、清单及共用宿主。

## 验证

- `node node_modules/vitest/vitest.mjs run tests/plane-relations.test.ts tests/plane-overlap.test.ts`：当时两份共 23 项通过。随后只新增近共线/多姿态面积守恒和 SQL helper 声明边界两项，用 `node node_modules/vitest/vitest.mjs run tests/plane-overlap.test.ts -t "keeps finite conserved|delivers private SQL"` 检查，两项通过；前 23 项行为代码未再变化，复用既有结果。
- `node node_modules/eslint/bin/eslint.js src/features/tools/plane-relations src/features/tools/plane-overlap tests/plane-relations.test.ts tests/plane-overlap.test.ts`：通过。
- TypeScript 按仓库 tsconfig 读取 compilerOptions，取两领域及两测试的 9 个文件作 roots（连同导入依赖、noEmit、incremental=false）检查：0 diagnostics。首次全仓 `tsc --noEmit --incremental false` 另暴露既有 `tests/agent-coordination.test.ts` 四项 taskId 类型诊断及 `tests/parent-assessment-fixtures.test.ts` 的 admin 属性推断诊断；本任务测试曾有一项 record 联合推断已修复，未改其它文件。
- `git diff --cached --check` 通过；实现提交 pre-commit 隐私扫描 12 文件通过。Node 22.16.0、TypeScript 5.9.3、Vitest 4.1.10。未执行 SQL、E2E、浏览器、截图、构建或全量回归。
- Windows sandbox 首次启动 Vitest 因 spawn EPERM 失败；经工具批准后同一窄命令通过。直接 node CLI，未运行安装、未清理 node_modules junction。

## 兼容性与边界

- 旧 v1 代码与持久合同完全未改；root 需保留其目录/版本可读分支。
- 此面积关系 v2 不宣称替代旧 18 的方格条细分、38/39/41/59 的共角/内点/共同部分/相似联动，也未迁移 42 的多层嵌套；已在领域 README 写清。本批仅一层中点与独立复制。
- 通用凹多边形及圆弧布尔未实现。旧 44/45 的准确弧边仍沿旧版本，不把圆伪装为折线。
- 产品人工视觉/教学手感待验收；本 worker 未启动服务、未操作 DB，未部署生产、未关闭 Gate。
- 未提交修改 / 运行进程 / 共享资源：实现提交后工作树干净，仅本交接文件待独立提交；没有本任务存活服务或数据库会话，原 node_modules junction 保留。
- 接收方下一步：只读复核该 head，集成已批准提交；接通目录、严格 schema、scene registry、contextActions 与 SQL 总入口后补本批共享版本/回放/按钮合同检查，再交付统一开发入口供人工验收。
- 接收确认：待接收。
