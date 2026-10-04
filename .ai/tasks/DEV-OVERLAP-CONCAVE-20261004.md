# DEV-OVERLAP-CONCAVE-20261004 · 凹多边形交并差

- 授权与阶段：用户确认下一步及并行深修；doc 04 教具开发轨。目标是老师自绘简单凹凸直边纸片，显式指定 A/B，移动或编辑后继续观察交、并、A−B。
- 数学范围：实际直边几何，支持同向共线编辑点、两种绕序、包含孔洞、不连通区域、相切共边与重合。面积守恒且不重复累计内部计算分片；计算剖分边不作为教学切线。圆弧和自交材料不在本批。
- 持久合同：新场景 `33-concave`、版本 `plane-overlap-lesson-v3`，保存仍为真实纸片及 A/B 引用；上限沿用 16 片、单片 32 点、合计 192 点。旧 `33-create` / v2 的凸形校验和场景保持不变，不静默升级。
- 接口：新增 `concave-model.ts`、`concave-validation.ts`、`concave-scene.tsx`；导出 `createConcaveOverlapState`、`isValidConcaveOverlapState`、`planeConcaveOverlapScene`。若命名或合同需变更先告知主任务。
- SQL：`20261004020000_tool_plane_overlap_concave.sql` 仅提供两个严格 helper `tool_plane_overlap_concave_state_is_valid` / `tool_plane_overlap_concave_scene_is_valid` 及默认权限回收；总分发由 root 追加。TS/SQL 复用新旧 fixtures；不连接或写数据库。
- 文件归属见 main 登记；共享几何、宿主、目录、控制目录、生成类型、旧总测试、依赖与消息文件由 root 统一写入。本 worker 使用 `.worktrees/plane-relations-deep-codex` 的新分支。
- 测试：几何边界及不变量、随机或系统凹形案例、A/B 归属／删除／复制、手势取消／历史／只读、保存与旧版隔离。可先只跑领域测试，完整版本接线后补集成。
- 验收：自绘凹形与另一凹／凸纸片重叠，切换交并差；移动、旋转、镜像、编辑，观察孔洞、分离片及面积；保存后重新打开。只交付开发端，待人工视觉及教学手感验收。
