# DEV-PLANE-POLYGONS-20261004 · Codex 第 01 次交接

- 当前结果：06/07/08 同台开放材料实现完成，机器定向检查通过，待 root 接入共享合同与目录后交付开发页；人工教学手感和视觉待验收。
- 代码提交：`55faa354ffbca6f562f9377872cec7c1ac35bb53`；基线 `bd7e8519a8bce7c23de1eea0da3c9795bf13652f`。
- 分支 / 工作树：`codex/plane-polygons-open-codex` / `.worktrees/plane-relations-deep-codex`。
- 任务卡：`.ai/tasks/DEV-PLANE-POLYGONS-20261004.md`。

## 变更范围与入口

- 新增 `src/features/tools/plane-polygons/`：`geometry.ts`、`model.ts`、`validation.ts`、`scenes.tsx` 和 README。提供独立小棒、真实三棒关系、活动四杆框架、自由三角形/简单凹凸四边形及五种约束四边形；最多同台 16 份，默认一份三角形和一副框架，观察初始关闭。
- 三棒严格表达可行、共线和不闭合间隙，可以复制为独立棒或合法三角形。框架关节与推斜动画保留四杆长度；两类自绘材料保留左右手性。
- 每份多边形独立选择底和开启真实高，使用共用 `HeightMark`。家族手柄/参数保持形状约束，明确动作转为自由四边形后再任意改形。
- 任意合法三角形拆出三个真实圆弧角片，原图保留；各角片独立位姿、逐片拼角/回原位采用刚性运动，支持暂停、继续和准确中间帧。角片存在时锁住源三角形几何，收回后可再编辑。
- 新合同 `06-create` / `plane-polygons-lesson-v2`，导出 `createPolygonWorkbenchState`、`isValidPolygonWorkbenchState`、`planePolygonWorkbenchScene`。共享 catalog、scene registry、snapshot contract 和宿主未改。
- SQL `20261004030400_tool_plane_polygon_workbench.sql` 只定义两项私有校验 helper 和 ACL；未执行数据库操作。状态字段、数量、尺寸边界、JavaScript trim 和 UTF-16 标题长度与 TS 对齐。
- `tests/fixtures/plane-polygons-open-cases.ts` 导出 `planePolygonWorkbenchCases`，含 63 组正反合同夹具供 root 纳入 SQL 等价检查。

## 实际检查与边界

- 两个新增测试文件：24 项通过（16 领域、8 描述符/渲染/共享运动与历史）。覆盖三棒可行性、框架杆长、自由凹凸/无效形状、家族约束、任意方向与多底高、真实角度及面积、刚性动画全段、暂停继续、复制独立性、容量、只读渲染与 `randomUUID` 缺失。
- 七个任务 TypeScript 文件 ESLint 通过；按仓库配置运行 TypeScript Compiler API `noEmit`，这些文件的语法及语义诊断为 0，不代替全仓检查。
- `git diff --check` 和实际暂存内容隐私扫描通过；代码提交后工作树干净。
- 本地 `pnpm` 尝试获取其指定版本失败后使用已有 `node` 与仓库依赖，未安装依赖。首次 Vitest 缓存重命名受沙箱 EPERM 阻止，正常申请本机定向测试授权后完成。
- 未运行全量测试、开发服务、浏览器或数据库。旧 06/07/08 v1 文件与合同保持不变。
- 当前 integration 测试验证真实描述符、`PlanarFrame`、共享运动与历史；共享注册尚由 root 施工，未假造新版本注册，也未宣称真实 `PlanarWorkbench` 保存/课堂链路已经完成。

## 接手下一步与人工验收

- root 精确集成代码提交并接入三个导出、新版本合同及 SQL 0305 总分发；再定向运行真实宿主、快照/课堂与 TS/SQL 夹具一致性检查。
- 开发入口由 root 注册后提供。人工可同台添加/绘制材料，修改棒长观察不闭合间隙，拖动框架关节；用不同三角形拆角、单片拖动并拼合/暂停；绘制凹四边形、旋转各家族、选不同底看内高/外高，再验证显式解除约束。
- 自由四边形不显示不适用的“底×高”面积结论。角片收回动作恢复顶点编辑；容量满时复制整体保持原状态，不生成半组材料。
- 本批没有生产变更、用户验收结论或正式 Gate 收口。
