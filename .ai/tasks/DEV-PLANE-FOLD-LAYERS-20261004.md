# DEV-PLANE-FOLD-LAYERS-20261004 · 双折与剪口编辑

- 持续目标与本轮并行授权下的独立增量；补齐原批准 32 的双折／逐层展开，以及单个剪口编辑。
- 新目录 `plane-paper-layers/`，`32-layers` / `plane-folding-lesson-v3`。导出 `createPaperLayersState`、`isValidPaperLayersState`、`planePaperLayersScene`；fixture 为 `planePaperLayersCases()`。旧单折 `32-create` 与 legacy 32 保留。
- 一张自绘简单凹凸纸、最多两条任意折痕。第二折作用于第一折后的真实纸层，按裁剪、反射与来源映射推导；复用已有纯几何。逐层展开和反射动画保留过程，临时投影由 `isExact` 阻止保存。
- 剪口使用稳定身份和真实剪切层次；独立移动、准确位置／圆半径、多边形顶点编辑及删除，不改动其他剪口。最大 12 剪口／192 剪口点预算，保持当前通用载荷上限。
- SQL `20261004031000_tool_plane_paper_layers.sql` 仅增加私有 helper，前缀 `tool_plane_paper_layers_`；至少导出 state/scene 两个严格入口。root 的 0311 负责总分发，不在 worker 修改。title 采用 JS trim／UTF-16 范围；ACL 全部回收，fixtures 覆盖边界。
- 复用干净 `.worktrees/plane-invariants-codex`，保留面积分支，从本登记提交创建 `codex/plane-fold-layers-codex`。共享宿主、目录、控制清单、生成类型及 DB 操作归 root。
- 定向验证真实层叠、跨边剪口、独立编辑、准确终点及旧版读取；不运行全量、服务或浏览器。人工视觉和教学手感由产品负责人确认。

- 交付：领域 `cdec2322`、共享接线 `9373f1bd`。真实宿主验证直接折角一次提交、展开剪口的逆映射、逐层动画暂停／继续、v3/v2课堂及只读；0310/0311 已安装隔离开发库，旧版保持。人工教学验收待确认。
