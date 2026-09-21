# 教具接入与空间操作

- 教具用于备课和现场操作；新增能力先判断是已有工具的动作、显示开关还是独立工具。参数、备课、课堂与恢复起点使用 `scenes/` 的已有入口。
- 空间工具的模式与参数面板使用 `spatial-interaction/useSpatialToolState`，在 `panels` 中穷尽声明每个面板需要的拾取方式。一次性命令与显示开关留在领域状态，不伪装成鼠标模式。
- 3D 功能按钮用 `SpatialActionButton` 的动作 ID，带文字的按钮复用 `SpatialActionIcon`；SVG 与 zh/en 语义在 `spatial-interaction/actions.ts` / `SpatialActionIcon.tsx` 维护。先比对现有动作：同义复用，整体移动／移面、旋转视角／旋转对象、展开／复原、透明／液量、截面／剪棱保持区分。视角栏、XYZ 精确步进、颜色、透明度和浮窗复用共用组件；领域只提供状态与回调。新增动作同步 `control-inventory.ts`，用 `node scripts/spatial-controls-catalog.mjs` 生成实际 SVG 对照页，并运行 `tests/spatial-controls-catalog.test.ts`。
- 参数面板与工具按钮一起切换；再点已启用的操作或关闭面板回到该工具的常规直接操作。切平面等仍显示在舞台上的专用手柄可以继续响应，优先级由命中区域决定。收起参数并保留舞台确认流程时，显式使用 `hidePanel`。
- 命中对象/手柄才接管指针，空白手势交给 `SpatialCameraRig`。复用共用点击保护，不把拖回起点、双指操作、右键或取消当作点击命令；多个课件实例的操作状态相互隔离。
- 所有 3D 工作台把 `controls.onPointerMissed` 接到实际 Canvas，轻点空白或工作台内按 Esc 取消选中；空白拖动保留选择并转视角。`onClearSelection` 清理本机拾取反馈，要求保留对象 ID 的旧快照用 `selectionActive` 隐藏高亮、手柄和快捷栏，重选/直接拖动后用 `activateSelection` 恢复。取消选中不复原数学现场；被动容器接收键盘但不画焦点外框，内部控件保留焦点样式。
- 对象动作同时提供直接入口与准确参数，调用同一个领域终点。移动复用 `CubeMoveHandles`；旋转/翻滚复用对象旁控制与表现层。新工具提供数学约束、合法落点与序列化，不另写一套相机或重复动画。
- 对象手柄通过 `CubeMoveHandles.bodyGesture` 接入 `SpatialTransformHandles`：移动提供 XYZ 箭头及 XZ／XY／YZ 平面方片，旋转提供世界轴圆环；命中、平面求交和环转动共用 `transform-handles` 与 `object-gesture-controller`。起拖锁定平面、轴、支点和手柄尺寸，优先于下方对象拾取。领域提供准确候选，旧离散工具用 `gizmo-adapter` 保留原终点合同，不为某个拼块复制组件。
- Soma 的整块拖动固定沿 XZ，其他平面由方片明确指定；移除旧平面选项、按视角选面与灰色平面框，仅保留纵向高度虚线。可选自由轨迹球继续复用 Arcball 与指针归属。需要准确落位时复用 `rotation-snap`，松手自动平滑吸附；开关与视角吸附分开。自由姿态仅按支持它的新版合同保存，共用手柄不扩大其他教具的合法姿态范围。
- 教学动画保留中间帧；直接拖动松手只提交一次，回执不重播。保存、课堂与晚加入只携带准确状态/语义命令，过程帧留在表现层。旧冻结版本保持原有可读边界。
- 翻滚共用 `planSpatialRoll`：缺少实际支撑棱时用当前姿态沿世界轴的最小外接长方体底棱作虚拟支撑，以细虚线说明；领域继续检查碰撞、路径、落点和可保存姿态。支撑提示元数据不进入快照或录制，折纸/液体/曲面不套用刚体翻滚。
- 变更空间按钮时运行 `tests/spatial-button-interaction.test.ts`、`tests/spatial-workbench-policy.test.ts` 及受影响工作台用例；动作增加中间帧、终点、恢复/撤销及课堂回执用例。人工手感由产品负责人验收。

组件、核查清单与新增操作的接入步骤见 [共用空间交互](spatial-interaction/README.md)。
