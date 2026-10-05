# 线网精确操作交接

- 源码提交：`07012f67876a369809b41eda0773d08a2939d195`，分支 `codex/plane-network-precision-codex`。
- 范围：`plane-network` 的 model、scenes、新 README；领域测试、新宿主集成测试和 `planeNetworkCases()` fixture。保持 `47-create`／`52-create` v2、原 validator、数据库与共享接线不变。
- 结果：节点和边准确参数；整真实连通分量的准确中心／方向、平移／旋转及直接手势；稳定编号的单条观察／笔迹选择、删除和续笔；逐笔起终点。准确操作原子检查边界、碰撞与图拓扑，保留真实点边和记录身份。
- 开发入口由 root 集成后提供：`http://192.168.5.213:3130/zh/tools/plane-patterns`、`http://192.168.5.213:3130/zh/tools/plane-graph-path`。本 worker 未运行数据库、服务或浏览器。

## 实际检查

- 2026-10-04 23:16，`node node_modules/vitest/vitest.mjs run tests/plane-network-model.test.ts tests/plane-network-integration.test.ts`：52 项通过。覆盖分数坐标、整组刚体性质、原子拒绝、记录独立移除／续笔、v2 冻结与快照、直接手势取消及单次撤销、只读展示。
- 定向 ESLint：上述源码和测试通过。
- 范围 TypeScript：model／scenes 入口为 0 诊断；扩展到宿主集成测试后，本任务文件 0 诊断，依赖现存 Radix／CSS 类型诊断 36 条。本任务未修改共享类型或 UI 依赖。
- `node scripts/agent-context.mjs --task DEV-PLANE-NETWORK-20261004`、实际暂存 `git diff --cached --check` 与 `node scripts/check-staged-secrets.mjs` 通过。
- 教学手感、密集记录布局和触摸使用仍待人工确认。机器检查仅覆盖上述行为合同。

## root 集成项

- 共享 `control-inventory.ts` 由 root 维护；新增操作：`network-node-precision`、`network-edge-precision`、`network-component`、`network-records`。
- 两个场景共有动作：`network-remove-record`、`network-component-positive-turn`、`network-component-negative-turn`、`network-component-left`、`network-component-right`、`network-component-up`、`network-component-down`。仅 52：`network-continue-stroke`。
- 准确字段不持久化：`nodeX/Y`、`edgeAX/AY/BX/BY`、`edgeLength`、`edgeAngle`、`componentX/Y`、`componentAngle`；值从真实图几何读取。共享宿主现有读字段和撤销合同已经适配，无需新字段接线。
- `tests/fixtures/plane-network-cases.ts` 导出 20 条新操作终点与拒绝缓存样例，若本批运行 TS／SQL 对照可以直接复用；沿用现有 SQL，不要求增加迁移。

## 保留语义

- 输入舞台坐标 X 向右、Y 向下；30 舞台单位＝1 u，方向逆时针为正。准确输入不经过拖动吸附。
- 新准确操作遇到零长、越界、碰撞或未分裂交点时整次保留现场；既有直接拖点／画线仍维持原有合点和交点分裂。
- 连通组中心是节点平均点，参考方向取所选边或最早边；孤立点可以平移。操作关闭仅收起直接柄。
- 删除记录保留编号空缺和其余记录，删除当前笔后结束该笔。续笔可以选旧笔，沿用 v2 全部笔迹共享的禁重边约束；允许重复开关语义保持。

下一步只读评估平面运动 24 的绕点重复、对应点观察与直接手势，等待 main 转移文件归属后再实现。
