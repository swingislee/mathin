# DEV-PLANE-GRID-MEASURE-20261002 · 钉板与面积单位

- 用户授权及共用约束见本批集成任务卡。主责 worker，复核 root。
- 新增 `34-create` 钉板与 `11-create` 面积单位，分别升级 v2。原 11/34/56 与 v1 保持可读。
- 钉板可自绘/追加多边形、插点/删点、格点吸附，显示内外点、真实面积、Pick 关系、高与三角分割。格点三角形最小半格面积合法。
- 面积单位可自绘目标，追加、搬动、复制、删除单位方格；允许重叠/越界观察，真实覆盖按并集与目标交集计算。单位显示换算不缩放材料。
- 独立严格 PlanarState 六键合同，限制对象/顶点/方格数量和有效引用；目标最多4个/总96点、方格最多100。phase=0。绘制过程留在宿主，不保存临时帧。
- 输出 `planeGridMeasureScenes` 与 `isValidGridMeasureState`，接现有 construction/operations 描述符，contextActions 引用已有动作 ID。SQL helper 与测试由本任务提交。
- root 负责总目录/合同/SQL与数据库。worker 独立 worktree，仅写登记文件；不启动服务，不执行 DB。
- 验收：凹形/半格面积、非法交叉、增删点、分割面积守恒、重叠/部分覆盖、单位转换、撤销/保存/课堂准确终点。人工手感待验收。
