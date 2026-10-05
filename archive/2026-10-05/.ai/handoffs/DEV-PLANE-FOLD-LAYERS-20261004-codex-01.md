# DEV-PLANE-FOLD-LAYERS-20261004 · Codex 第 1 次交接

- 发出方 / 接收方：双折与剪口实现者 / 本批集成人。
- 目的：实现交付，待独立复核与共享接线。
- 关联任务卡：[双折与剪口编辑](../tasks/DEV-PLANE-FOLD-LAYERS-20261004.md)。
- 代码 base / head：`583e59efbea50313af64622d2cf8a77cb6a5ba4c` / `cdec23228606adda22dedb7bc3a580fb9d86b6dd`。
- 分支 / worktree：`codex/plane-fold-layers-codex` / `.worktrees/plane-invariants-codex`；此前面积分支保留。

## 本次行为与文件

- `src/features/tools/plane-paper-layers/` 新增几何、领域操作、严格状态与场景。初始为同一张纸；可自绘简单凹凸多边形或长方形，再逐次画至多两条任意折痕。
- 每折按当前真实纸层裁分、反射并反转折起层序。各来源路径保留原纸区域与每个剪切深度的完整等距映射；凹纸同侧分离区域保留为独立区域，不以连接桥补齐。
- 慢慢折合 / 展开按第一折至第二折、第二折至第一折依次执行；手动纸层拖动和准确折角也使用同一铰链模型。第二折开始后第一折保持完全折合，来源关系保持明确。
- 每个剪口有稳定 ID 和创建深度，可独立移动、修改坐标 / 圆半径 / 多边形顶点、回到剪切姿态或删除。展开任意副本上的编辑通过原纸来源映射回同一个剪口，其他剪口不改号、不重置。
- 圆形剪口保持解析圆，逐层使用真实透明 mask；跨纸边剪口保留为缺口，底层仍有的纸不被背景色覆盖。保留原纸面积的显示仅适用于尚未剪切状态，不把剪口面积简单相加。
- 纸张替换需要全部展开并清空剪口；折痕编辑仅锁定依赖它的剪口。最后一折无依赖剪口且已展开时可独立移除，先前剪口保留。
- `supabase/migrations/20261004031000_tool_plane_paper_layers.sql` 新增 4 个私有 helper；总分发由集成迁移负责。没有业务写入、RLS、服务或旧版文件变更。
- 两份测试和 `tests/fixtures/plane-paper-layers-cases.ts` 覆盖真实来源层、剪口编辑、边界、动画 / 回放、严格合同及旧版可读性样例。

## 合同与接线

- 新版 `plane-folding-lesson-v3`，新场景 `32-layers`；旧 `32-create` / v2 和 legacy `32` / v1 源文件保留。
- `model.ts` 导出 `createPaperLayersState`、`isValidPaperLayersState`；校验实现也可从 `validation.ts` 导入。`scenes.tsx` 导出 `planePaperLayersScene`。
- 公共基本参数：`paperCount`、`foldCount`、`activeFold`、`nextCutId`、`activeCut`、`activeVertex`。每折保存 `foldAngle.i` / `foldSide.i` 和 `foldA.i` / `foldB.i`；每剪口保存 `cutKind.id` / `cutVertices.id` / `cutRadius.id` / `cutDepth.id` 与 `cut.id.j`。
- `phase` 固定为 0；准确折角是可重建的语义状态。动画中间帧额外携带 `layerFrame`，`isExact` 与严格保存合同返回 false；准确端点不带该字段。暂停过程继续依靠宿主运动时间锚点，不把临时投影顶点写回原纸。
- 最多 32 原纸点、2 折、12 剪口 / 192 剪口点；参数与点各自保持通用 256 键预算。原纸坐标在 960 × 720 舞台内；折痕和剪口世界坐标在 ±5000 内，多边形剪口包围盒长宽各不超过 1600。
- SQL 严格入口：`tool_plane_paper_layers_state_is_valid(jsonb)` / `tool_plane_paper_layers_scene_is_valid(jsonb)`；辅助多边形、折层函数使用同一前缀。4 个 helper 全部从 public / anon / authenticated / service_role 撤销直接执行。
- SQL title 与 routes302 采用同样 JavaScript trim 字符集及 UTF-16 长度；fixtures 包含全角空白、BOM 和辅助平面字符边界。
- fixture factory：`planePaperLayersCases()`，每项 `{ label, accepted, scene }`；供根接线后加入既有 TS / SQL 对照。包含不同剪切深度、稳定 ID 缺口、斜折、凹纸、192 点、12 剪口、临时帧、未知键、类型、版本错配与旧版读取。
- 根接线范围：catalog、contract、scene-registry、工具注册 / inventory、runtime、SQL 总分发、实际生成类型。本提交不修改共享文件。

## 检查与边界

- `node ../../node_modules/vitest/vitest.mjs run tests/plane-paper-layers.test.ts tests/plane-paper-layers-integration.test.ts`：18 项通过，最终运行包含重复剪口点键序边界及只读隐藏编辑手柄。
- 定向 TypeScript Compiler API：以新目录、两份测试和 fixture 为根，仅筛选本任务文件诊断；0 诊断。没有把全库检查计作本任务验证。
- 定向 ESLint：新目录、两份测试和 fixture 通过。
- `git diff --cached --check` / `node scripts/check-staged-secrets.mjs`：8 个代码文件通过；本地提交 hook 保持启用并通过。
- 本地 Vitest 的隔离临时缓存 rename 遇到 EPERM 后，经权限审查使用普通本地缓存运行；测试未访问数据库或浏览器。
- 未运行数据库连接、迁移或 SQL fixture 执行；迁移文本合同检查已覆盖 helper 范围、ACL、title 和容量。SQL 实际等价、通用场景保存 / 课堂校验由根接线后验证。
- 本任务代码提交后工作树干净，无遗留服务或后台进程。未运行浏览器、开发服务、生产操作或全量 Gate。
- 未决事项：根独立复核及共享 v3 接线、SQL fixtures 对照；如发现问题由实现者修复。
- 人工验收 / 部署 / Gate：未人工验收，未部署，未关闭 Gate。本提交是待集成实现增量，机器检查不替代视觉和教学手感确认。
- 接收方下一步：复核 / cherry-pick 代码与交接提交，完成共享接线验证，再交付局域网开发页面。
- 接收确认：待接收；由集成人记录原会话确认及复核结论。
