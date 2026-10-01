# DEV-PLANE-PERIMETER-20261002 · 周长开放材料

- 用户授权及共用约束见本批集成任务卡。主责 worker，复核 root。
- 新增 `10-create`、`plane-perimeter-lesson-v2`：自画矩形/简单凹凸多边形，追加、复制、改点/尺寸，连续绕边、保长拉直与围回；比较使用共同比例尺。
- 复用 construction 材料与纯数学，新增每对象 `walk.{id}` / `straight.{id}` 精确进度。新建/复制归零，删除清理，几何编辑只清该对象进度，phase=0。校验严格且前后端一致。
- 新目录输出 `planePerimeterScene` 和 `isValidPerimeterState`。contextActions 按已提交类型引用本定义中的 action/operation ID。通用按钮/图标不复制。
- 本任务提交 helper SQL、领域测试及交接。root 接 catalog、总合同、共享按钮清单和 DB。worker 不修改共享文件、不执行 DB/服务。
- 旧 10/12/13/43 保留；锁周长变形与任意多边形并集若未实现，明确记录，不以新入口代替旧功能结论。
- 验收：自绘凹五边形→改点→追加第二图形→绕边暂停→拉直比较→撤销/恢复；几何保长、自交拒绝、范围、序列化和旧 v1 由定向检查覆盖。人工手感待验收。
