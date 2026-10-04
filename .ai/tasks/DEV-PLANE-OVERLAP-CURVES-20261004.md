# 真实圆弧区域与拆片

- 目标：当前重叠入口补齐获批 44/45；圆、凹凸纸片、叶形与圆方补集在同一舞台组合，结果可作独立材料继续使用。
- 分支：`codex/plane-overlap-curves-codex`，从 main 本次登记建立，复用已完成多边形任务的干净工作树。
- 合同：新增 `33-curves` / `plane-overlap-lesson-v4`，历史 v1/v2/v3 保持。显式保存有向线段／圆弧闭环与刚性位姿；圆不折线化，SVG 不承担数学计算。支持孔洞及分离分量。
- 容量：16 材料、自由单片 32 顶点、全场 192 边界点／32 圆支撑／32 环，并遵守共用参数与点位 256 上限；拆片先整体核对。
- 导出：createCurveOverlapState、isValidCurveOverlapState、planeCurveOverlapScene、planeOverlapCurvesCases。
- SQL：worker 独占 0312，私有 region/state/scene helper；JS trim 与 UTF-16 标题边界一致。root 独占 0313 分发、catalog、contract、场景注册、类型和本地数据库。
- 交付：真实解析线圆／圆圆求交、布尔区域及面积积分；圆弓／补集拆片面积守恒与相切退化定向检查。只读展示与准确状态保持。人工教学手感待确认。

2026-10-05：领域 `98d12ef0`、共享接线 `76f6c4ff` 已集成。复用领域28项结果；共享宿主／目录／旧版本62项通过，依赖类型0诊断、ESLint通过。本机真实目标复核后，495项TS/SQL（含57曲线夹具）、49旧场景、9保存／读取／更新及私有helper权限通过，事务回滚前后受保护数量与函数一致；仅安装0312/0313。实际生成并仅合入3个新函数类型。开发入口 `/zh/tools/plane-overlap`；待人工数学表达与手感确认，生产保持。
