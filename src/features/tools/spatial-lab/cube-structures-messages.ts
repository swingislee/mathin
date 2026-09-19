import { cubeLayerNumber, type CubeOperation } from "./cube-structures-contract";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";

const zh = {
  title: "立方体结构", subtitle: "同一结构 · 同一套工具 · 每次操作都是一步",
  prepare: "备课", demonstrate: "课堂演示（本机）", modes: "工作模式",
  scope: "离开前请在上方保存账号草稿。正式课件发布与课堂联网同步仍待接入。",
  prepareNote: "先自由搭建。需要教学步骤时，打开录制面板并开始录制；日常操作不会自动进入步骤。",
  demoNote: "使用备课的操作逐步演示，也可临场操作；备课记录保持不变。",
  tools: "画布工具", orbit: "观察", select: "多选", build: "搭建", remove: "挖除", color: "整块颜色", face: "单面染色", layer: "按层显隐",
  pan: "平移视野", panHint: "单指或鼠标拖动平移视野，双指缩放；单位块坐标保持不变。",
  move: "移动单位块", moveHint: "拖动 XYZ 箭头，或选择轴后拖动方块。单击选单块；未单独选择时拖动当前分组或整体。开启右上角磁铁，拖动即对齐单元格；关闭时连续预览，松手取整格（拆开展示为半格）。每次拖动记录一步。",
  cellSnap: "单元格吸附", enableCellSnap: "开启单元格吸附", disableCellSnap: "关闭单元格吸附",
  moveAxis: "拖动轴", moveAxisHidden: "这一轴正朝向屏幕。切到立体视角再拖动，或使用该轴的步数按钮。",
  rotate: "整体转动", rotationHint: "单块、所选块或当前分组绕中心附近的格点转动 90°，改变逻辑排列；拆开间距保持独立。正向遵循右手方向。",
  invalidRotation: "转动终点与其他逻辑格或展示方块重叠，或超出范围。请先用逻辑移动留出空间，再转动。",
  groupColor: "编组颜色", applyGroupColor: "应用到当前分组", selectionColorHint: "黄色专门表示临时选择；编组使用独立颜色，方块底色和面染色保持不变。",
  cut: "截面切割", mark: "分类标记", number: "连续编号", transparent: "透明度",
  cutHint: "点击哪一部分，就在该部分切割。靠近棱线选线，移入面内选面；两条共面线或一个可见层界面确定截面。切割后可直接选择其他部分。视图按钮或观察旋转会保留已选线。",
  cutGeometryHint: "选面使用点击面所在的平面。外边界请改用内部层界上的两条线。悬浮面只高亮小面；0% 填充面允许穿透。已有临时多选时仅切多选范围，清除后恢复按点击部分识别。",
  cutFirstPick: "靠近棱线选择第一条线，或移入面内选面。", cutSecondLine: "第 2 步：第一条已保留，再选一条与它共同确定截面的线。", cutReady: "截面已确定，可确认切割或重新选择。",
  cutFaceReady: "点击此面，使用它所在的平面确定截面。", cutLineOrFace: "第一条线已保留。移回棱线可继续选第二条；点击面将改为按此面确定截面。",
  cutSecondReady: "两线可确定此截面，点击第二条线锁定。",
  cutRestart: "重新选择", cutUseScope: "清除临时选择，按点击部分切割", cutHidden: "含隐藏块",
  cutPart: "当前部分", cutPickPart: "指向想切割的部分，自动确定本刀范围。", displayResetPart: "合拢所选部分",
  cutIssues: {
    miss: "这里没有可见候选。请靠近棱线，或移入可见面内。",
    scope: "请在同一部分选择第二条线，或重新选择其他部分；已有临时多选时可先清除。",
    collinear: "这两段属于同一条直线。第一条已保留，请选另一条不共线的线。",
    skew: "这两条线不共面。第一条已保留，请选与它相交或平行的共面线。",
    oblique: "两线确定的是斜截面。当前支持 XYZ 层间切割，请换一条线。",
    boundary: "所选平面位于外边界，两侧无法分开。请用内部层界上的两条线，或选择外露的内部层界面。",
    displaced: "此部分在该方向已有不同展示位移。请先合拢，或临时选择同一位移的单位块。",
    singleLayer: "面已选中，但当前范围在此法向上只有一层。请选择其他方向的面，或扩大范围。",
  },
  cutConfirm: "切割",
  cutAfter: "在此层之后切开", cutGap: "拆开间距", cutSide: "移开方向", performCut: "切开并移开", cutPiece: "切开部分", invalidCut: "此截面需要两侧都有方块，移开目标也需留出空间。",
  displayMove: "拆开展示", logicalMove: "逻辑移动", displayReset: "合拢当前范围", displayResetAll: "全部合拢", displayHint: "展示位移只改变摆放。合拢回到逻辑位置；原结构体积、表面积与染色分类保持不变。",
  markHint: "选择符号后点击方块。符号可放在旁边、点击的表面或半透明中心；同一块可同时保留符号与编号。",
  numberHint: "依次点击方块，从 1 连续编号。已编号的块不会重复计数；撤销也会恢复下一编号。",
  labelPlacement: "标注位置", side: "旁边", surface: "点击的表面", center: "半透明中心", centerHint: "中心标注会将这块的不透明度降至最多 30%，可继续调整。",
  circleShape: "圆形", triangleShape: "三角形", squareShape: "方形", starShape: "星形", diamondShape: "菱形", crossShape: "十字",
  clearMarks: "清除当前范围符号", clearNumbers: "清除当前范围编号", restartNumbering: "清空全部编号，从 1 开始", nextNumber: "下一编号", alreadyNumbered: "这块已有编号；点击其他块继续。", applyMarks: "批量标记（正面）",
  opacityLabel: "不透明度", transparencyHint: "拖动即时预览当前选择／分组／整体，松手应用并记录一步。点击单块也可应用当前数值。0% 只保留棱边与标注，100% 为实心。",
  applyOpacity: "应用到当前范围", restoreOpacity: "当前范围恢复实心", hiddenEdges: "遮挡边使用虚线", hideHiddenEdges: "遮挡边恢复实线",
  record: "录制与步骤", recordStart: "开始录制", recordPause: "暂停录制", recordResume: "继续录制", recordStop: "结束录制", recordOff: "未在录制", recordingActive: "正在录制", recordingPaused: "录制已暂停",
  recordEmpty: "默认不录制。点击开始，当前画面成为起点，此后的操作才进入步骤。",
  recordNewTitle: "开始一段新录制？", recordNewDescription: "保留当前画面作为新起点，替换现有录制步骤。",
  resumeTitle: "恢复到已录末步？", resumeDescription: "暂停期间的试操作没有录入。继续录制会回到已录末步；取消可保留当前画面，再开始新录制。",
  pauseNote: "暂停时可以试操作。继续录制会回到已录末步，确保步骤可以完整重放。",
  closePanel: "收起面板", modelPanel: "结构与显示设置", selectionPanel: "选择与编组", groups: "分组", groupName: "分组名称", createGroup: "将当前选择编组", ungroup: "解除当前编组", allGroups: "整体", groupProtected: "当前已选分组，组外方块保持不变。", noSelection: "先选择需要编组的单位块。",
  moveDistance: "移动步数", invalidMove: "移动目标与其他方块重叠，或超出当前搭建范围。", currentScope: "当前作用范围", selectScope: "选择当前范围", removeSelected: "挖除选中块",
  axes: "坐标轴", hideAxes: "隐藏坐标轴", showAxes: "显示坐标轴", axisNote: "红 X、绿 Y、蓝 Z；原点固定在创建时的左后下顶点。创建时首层为 1，原点不随移动或增减改变。",
  edgeNote: "保留原三维粗边；斜视轮廓宽度不一致的问题仍待解决。",
  editStep: "重新执行并替换此步", deleteStep: "删除此步", moveStepUp: "上移此步", moveStepDown: "下移此步", dragStep: "拖动步骤调整顺序", moveTo: "移动到第几步", confirmMove: "移动步骤", editingStep: "正在重录步骤：使用工具执行一次操作来替换它。", cancelEdit: "取消重录", exitPreview: "退出回放继续操作", previewHint: "正在回放；退出回放即可继续操作当前现场。", sequenceError: "调序或修改未应用：后续步骤引用了尚未创建的对象，或搭建／移动发生冲突。", newGroup: "分组", layerUnit: "层",
  orbitHint: "拖动旋转，滚轮缩放；视角按钮平滑转到指定方向。",
  selectHint: "逐个点击添加或取消选择。批量操作作用于选中的单位块。",
  buildHint: "点击已有方块的面，在相邻格搭建；点击地面可从空结构开始。",
  removeHint: "点击真正挖除一个单位块，体积和表面积随之重新计算。",
  colorHint: "点击改变整块底色。已经染过的面保留原来的面颜色。",
  faceHint: "点击只染当前这一面；批量涂外表面按完整结构计算。",
  layerHint: "点击隐藏所在层；在层列表中重新显示。隐藏不改变结构数量和面积。",
  colorLabel: "颜色", colors: ["叶绿", "珊瑚红", "月黄", "天空蓝", "紫藤", "米白"],
  selected: "已选", clearSelection: "取消选择", selectVisible: "选择可见块", batchColor: "选中块换色", batchPaint: "选中块涂外表面", paintAll: "全部涂外表面", clearPaint: "清除选中块面染色",
  view: "视角", angle: "立体", front: "正视", left: "左视", right: "右视", top: "俯视", fit: "当前方向重新居中",
  layerAxis: "分层轴", layers: "层", hide: "隐藏", show: "显示", showAll: "显示全部层", selectLayer: "选择这一层",
  library: "支线起点", loadPreset: "载入为新起点", empty: "空白结构",
  layeredCounting: "分层计数", hiddenCubes: "遮挡计数", threeViews: "三视图", surfacePainting: "表面染色", hollowing: "挖空与表面积",
  loadTitle: "开始一个新结构？", loadDescription: "这会替换当前结构与操作记录。请先保存未保存的修改；已保存的账号草稿会保留。",
  startTitle: "把当前画面设为起点？", startDescription: "保留当前结构、颜色、显隐和视角；清空已有操作记录，从这里开始录制教学步骤。",
  confirm: "确认", cancel: "取消", setStart: "设为录制起点", restartDemo: "重演备课", steps: "操作记录", initial: "起点",
  previous: "上一步", next: "下一步", play: "播放", pause: "暂停", step: "步", emptySteps: "直接操作画布，操作会逐条出现在这里。",
  replayNote: "正在回看。回到末步可继续录制，或明确从这里续编。", returnEnd: "回到末步", branch: "从这里续编", branchTitle: "替换后续步骤？", branchDescription: "保留当前步及之前的记录，移除后续步骤，然后继续录制。",
  metrics: "结构统计", showMetrics: "显示统计", hideMetrics: "收起统计", volume: "单位块", totalArea: "总表面积", exteriorArea: "外表面积", interiorArea: "内表面积", paintHistogram: "染色面数 → 单位块数", geometryNote: "统计完整逻辑结构；隐藏的块仍计入。整块底色不计作面染色。",
  pending: "账号草稿保存备课内容，临场演示使用独立副本。正式课件发布与课堂联网同步为后续步骤。",
  limit: "已到当前验收版容量：512 个单位块、256 步，坐标范围 −12 至 12。", blockedBuild: "此格已有方块（可能被隐藏），或已超出可搭建范围。",
  clearedPaint: "清除面染色", allLayers: "显示全部层", paint: "染色", cubeUnit: "块", faceUnit: "面",
} as const;

const en = {
  title: "Cube Structures", subtitle: "One structure · One toolset · One operation per step",
  prepare: "Preparation", demonstrate: "Class demo (local)", modes: "Workspace mode",
  scope: "Save your account draft above before leaving. Formal courseware publishing and live classroom sync are not connected yet.",
  prepareNote: "Build freely first. Open recording and start it when you need lesson steps; ordinary operations are not recorded automatically.",
  demoNote: "Replay the prepared operations or improvise with the same tools. Preparation stays unchanged.",
  tools: "Canvas tools", orbit: "Observe", select: "Multi-select", build: "Build", remove: "Remove", color: "Cube color", face: "Paint face", layer: "Layer visibility",
  pan: "Pan view", panHint: "Drag with one finger or the mouse to pan; pinch to zoom. Cube coordinates stay unchanged.",
  move: "Move cubes", moveHint: "Drag an XYZ arrow, or choose an axis and drag cubes. Click to select one cube; otherwise drag the active group or whole structure. Enable the top-right magnet to align to cells while dragging. When disabled, preview continuously and release to whole units (half units for display separation). Each drag records one step.",
  cellSnap: "Cell snapping", enableCellSnap: "Enable cell snapping", disableCellSnap: "Disable cell snapping",
  moveAxis: "Drag axis", moveAxisHidden: "This axis points into the screen. Switch to 3D to drag it, or use its step buttons.",
  rotate: "Rotate as a group", rotationHint: "Turn the selected cube, selection or active group by 90° about a nearby central grid point. This changes the logical arrangement; display gaps stay separate. Positive turns follow the right-hand rule.",
  invalidRotation: "The destination overlaps logical cells or displayed cubes, or exceeds the workspace. Make room with a logical move, then turn.",
  groupColor: "Group color", applyGroupColor: "Apply to the active group", selectionColorHint: "Yellow is reserved for temporary selection. Groups use separate colors; cube base colors and painted faces stay unchanged.",
  cut: "Section cut", mark: "Category marks", number: "Sequential numbers", transparent: "Transparency",
  cutHint: "Click any piece to cut that piece. Move near an edge to pick a line, or inside a face to pick it. Two coplanar lines or one exposed layer face define a section. After cutting, choose any other piece directly. View buttons and Observe retain selected lines.",
  cutGeometryHint: "Faces use their actual planes. For an outer boundary, use two lines on an interior layer boundary. Face hover highlights only that face; 0% fills allow picking through. An explicit multi-selection limits the cut until cleared.",
  cutFirstPick: "Pick the first edge, or move inside a face to select it.", cutSecondLine: "Step 2: First line retained. Pick another line that defines a section with it.", cutReady: "Section ready. Confirm the cut or choose again.",
  cutFaceReady: "Click this face to use its actual plane as the section.", cutLineOrFace: "First line retained. Return to an edge to pick the second line, or click this face to use its plane instead.",
  cutSecondReady: "These lines define this section. Click the second line to lock it.",
  cutRestart: "Choose again", cutUseScope: "Clear selection and cut the clicked piece", cutHidden: "Hidden cubes included:",
  cutPart: "Current piece", cutPickPart: "Point at the piece to determine this cut's scope.", displayResetPart: "Reassemble this piece",
  cutIssues: {
    miss: "No visible candidate here. Move closer to an edge or inside a visible face.",
    scope: "Pick the second line on the same piece, or choose another piece again. Clear any explicit multi-selection if needed.",
    collinear: "These segments belong to the same straight line. First line retained; choose a non-collinear line.",
    skew: "These lines are not coplanar. First line retained; choose an intersecting or parallel coplanar line.",
    oblique: "These lines define an oblique plane. XYZ layer cuts are supported; choose another line.",
    boundary: "This is an outer boundary and cannot separate two sides. Pick two lines on an interior layer boundary, or an exposed interior layer face.",
    displaced: "This piece has different display offsets along that direction. Reassemble it, or explicitly select cubes with the same offset.",
    singleLayer: "Face selected, but this scope has only one layer along its normal. Pick another face direction or expand the scope.",
  },
  cutConfirm: "Cut",
  cutAfter: "Cut after this layer", cutGap: "Separation gap", cutSide: "Move direction", performCut: "Cut and separate", cutPiece: "Cut piece", invalidCut: "Both sides need cubes, and the separated piece needs a free destination.",
  displayMove: "Display separation", logicalMove: "Logical move", displayReset: "Reassemble this scope", displayResetAll: "Reassemble everything", displayHint: "Display offsets only change arrangement. Reassemble to logical positions; volume, surface area and paint classification stay unchanged.",
  markHint: "Choose a symbol and click a cube. Place it beside the cube, on the clicked face or at its translucent center. Symbols and numbers can coexist.",
  numberHint: "Click cubes in order to number them from 1. Already numbered cubes are not counted again. Undo also restores the next number.",
  labelPlacement: "Label position", side: "Beside cube", surface: "Clicked face", center: "Translucent center", centerHint: "A center label reduces this cube's opacity to at most 30%; you can adjust it further.",
  circleShape: "Circle", triangleShape: "Triangle", squareShape: "Square", starShape: "Star", diamondShape: "Diamond", crossShape: "Cross",
  clearMarks: "Clear marks in this scope", clearNumbers: "Clear numbers in this scope", restartNumbering: "Clear all numbers and restart at 1", nextNumber: "Next number", alreadyNumbered: "This cube is numbered. Click another cube to continue.", applyMarks: "Mark this scope (front face)",
  opacityLabel: "Opacity", transparencyHint: "Drag to preview the selection, group or whole structure. Release to apply and record one step. Click a cube to apply the current value. 0% keeps edges and labels; 100% is solid.",
  applyOpacity: "Apply to this scope", restoreOpacity: "Make this scope solid", hiddenEdges: "Dashed hidden edges", hideHiddenEdges: "Solid hidden edges",
  record: "Recording and steps", recordStart: "Start recording", recordPause: "Pause recording", recordResume: "Resume recording", recordStop: "Finish recording", recordOff: "Not recording", recordingActive: "Recording", recordingPaused: "Recording paused",
  recordEmpty: "Recording starts off. Start it to capture this scene as the beginning and record subsequent operations.",
  recordNewTitle: "Start a new recording?", recordNewDescription: "Use the current scene as the new start and replace the existing recorded steps.",
  resumeTitle: "Restore the last recorded step?", resumeDescription: "Operations while paused were not recorded. Resuming restores the last recorded step. Cancel to keep this scene and start a new recording instead.",
  pauseNote: "You can experiment while paused. Resuming returns to the last recorded step so the complete sequence can be replayed.",
  closePanel: "Collapse panel", modelPanel: "Structure and display", selectionPanel: "Selection and groups", groups: "Groups", groupName: "Group name", createGroup: "Group the selected cubes", ungroup: "Ungroup the active group", allGroups: "Whole structure", groupProtected: "A group is active. Cubes outside it stay unchanged.", noSelection: "Select the cubes you want to group first.",
  moveDistance: "Move distance", invalidMove: "The move overlaps other cubes or goes beyond the building range.", currentScope: "Operation scope", selectScope: "Select this scope", removeSelected: "Remove selected cubes",
  axes: "Axes", hideAxes: "Hide axes", showAxes: "Show axes", axisNote: "Red X, green Y, blue Z. The origin is fixed at the initial left-back-bottom corner. The first layer starts at 1; moving or editing cubes never shifts the origin.",
  edgeNote: "Original solid edges are retained. Uneven outline width in oblique views remains unresolved.",
  editStep: "Perform a replacement for this step", deleteStep: "Delete step", moveStepUp: "Move step up", moveStepDown: "Move step down", dragStep: "Drag to reorder steps", moveTo: "Move to step number", confirmMove: "Move step", editingStep: "Replacing a step: perform one operation with the tools to replace it.", cancelEdit: "Cancel replacement", exitPreview: "Exit replay and keep working", previewHint: "Replaying. Exit replay to continue manipulating the live scene.", sequenceError: "Change not applied: a later step references an object that has not been created yet, or building/movement conflicts.", newGroup: "Group", layerUnit: "layer",
  orbitHint: "Drag to rotate and scroll to zoom. View buttons rotate smoothly to the chosen direction.",
  selectHint: "Click cubes to toggle selection. Batch operations affect the selected cubes.",
  buildHint: "Click a cube face to add a neighbor, or click the ground to start from an empty structure.",
  removeHint: "Click to actually remove a cube. Volume and surface area are recalculated.",
  colorHint: "Click to change a cube's base color. Individually painted faces retain their colors.",
  faceHint: "Click to paint one face. Exterior batch painting uses the complete logical structure.",
  layerHint: "Click to hide a layer; show it again in the layer list. Hiding changes neither volume nor area.",
  colorLabel: "Color", colors: ["Leaf", "Coral", "Moon", "Sky", "Wisteria", "Ivory"],
  selected: "Selected", clearSelection: "Clear selection", selectVisible: "Select visible", batchColor: "Color selected cubes", batchPaint: "Paint selected exteriors", paintAll: "Paint all exterior faces", clearPaint: "Clear selected face paint",
  view: "View", angle: "3D", front: "Front", left: "Left", right: "Right", top: "Top", fit: "Reframe this view",
  layerAxis: "Layer axis", layers: "Layers", hide: "Hide", show: "Show", showAll: "Show all layers", selectLayer: "Select this layer",
  library: "Branch starting points", loadPreset: "Load as new start", empty: "Empty structure",
  layeredCounting: "Layer counting", hiddenCubes: "Hidden cubes", threeViews: "Three views", surfacePainting: "Surface painting", hollowing: "Hollowing & surface area",
  loadTitle: "Start a new structure?", loadDescription: "This replaces the current structure and operation history. Save any unsaved changes first; saved account drafts are retained.",
  startTitle: "Use this scene as the start?", startDescription: "Keep the current structure, colors, visibility and view. Clear the operation record and start recording from here.",
  confirm: "Confirm", cancel: "Cancel", setStart: "Set recording start", restartDemo: "Replay preparation", steps: "Operation record", initial: "Start",
  previous: "Previous step", next: "Next step", play: "Play", pause: "Pause", step: "steps", emptySteps: "Operate the canvas. Each operation appears here as a step.",
  replayNote: "Reviewing a past step. Return to the last step to record, or explicitly continue from here.", returnEnd: "Go to last step", branch: "Continue from here", branchTitle: "Replace later steps?", branchDescription: "Keep this step and all earlier operations, remove later steps, then continue recording.",
  metrics: "Structure statistics", showMetrics: "Show statistics", hideMetrics: "Hide statistics", volume: "Unit cubes", totalArea: "Total surface area", exteriorArea: "Exterior area", interiorArea: "Interior area", paintHistogram: "Painted faces → cube count", geometryNote: "Measures the full logical structure, including hidden cubes. Base color is separate from face paint.",
  pending: "Account drafts preserve preparation; live demonstrations use a separate copy. Formal courseware publishing and live classroom sync are later steps.",
  limit: "Review-build capacity: 512 cubes, 256 steps, coordinates from −12 to 12.", blockedBuild: "This cell is occupied (possibly hidden), or is outside the building range.",
  clearedPaint: "Clear face paint", allLayers: "Show all layers", paint: "Paint", cubeUnit: "cubes", faceUnit: "faces",
} satisfies { [Key in keyof typeof zh]: Key extends "colors" ? readonly string[] : Key extends "cutIssues" ? Record<keyof typeof zh.cutIssues, string> : string };

export function cubeStructuresMessages(locale: "zh" | "en") { return locale === "en" ? en : zh; }

export function cubeOperationLabel(operation: CubeOperation, locale: "zh" | "en", origin: VoxelCoordinate | null = null): string {
  const m = cubeStructuresMessages(locale);
  switch (operation.kind) {
    case "build": return `${m.build} (${cubeLayerNumber({ origin }, "x", operation.position.x)}, ${cubeLayerNumber({ origin }, "y", operation.position.y)}, ${cubeLayerNumber({ origin }, "z", operation.position.z)})`;
    case "remove": return `${m.remove} · ${operation.ids.length} ${m.cubeUnit}`;
    case "color": return `${m.color} · ${operation.ids.length} ${m.cubeUnit}`;
    case "paint": return `${m.paint} · ${operation.faces.length} ${m.faceUnit}`;
    case "clear-paint": return `${m.clearedPaint} · ${operation.ids.length} ${m.cubeUnit}`;
    case "layer": return `${operation.visible ? m.show : m.hide} ${operation.axis.toUpperCase()} ${cubeLayerNumber({ origin }, operation.axis, operation.index)} ${m.layerUnit}`;
    case "show-all": return m.allLayers;
    case "view": return `${m.view} · ${m[operation.view]}`;
    case "group": return `${m.groups} · ${operation.name}`;
    case "ungroup": return m.ungroup;
    case "move": return `${m.move} · ${operation.axis.toUpperCase()} ${operation.distance > 0 ? "+" : ""}${operation.distance}`;
    case "rotate": return `${m.rotate} · ${operation.axis.toUpperCase()} ${operation.turn > 0 ? "+" : "−"}90° · ${operation.ids.length} ${m.cubeUnit}`;
    case "axes": return operation.visible ? m.showAxes : m.hideAxes;
    case "cut": return `${m.cut} · ${operation.axis.toUpperCase()} ${cubeLayerNumber({ origin }, operation.axis, operation.after)} · ${operation.name}`;
    case "display-move": return `${m.displayMove} · ${operation.axis.toUpperCase()} ${operation.distance > 0 ? "+" : ""}${operation.distance}`;
    case "display-reset": return `${m.displayReset} · ${operation.ids.length} ${m.cubeUnit}`;
    case "mark": return `${m.mark} · ${m[`${operation.shape}Shape`]} · ${operation.ids.length} ${m.cubeUnit}`;
    case "number": return `${m.number} · ${operation.value ?? ""}`;
    case "clear-labels": return operation.target === "mark" ? m.clearMarks : m.clearNumbers;
    case "restart-numbering": return m.restartNumbering;
    case "opacity": return `${m.transparent} · ${Math.round(operation.opacity * 100)}% · ${operation.ids.length} ${m.cubeUnit}`;
    case "hidden-edges": return operation.visible ? m.hiddenEdges : m.hideHiddenEdges;
  }
}
