import type { CubeOperation } from "./cube-structures-contract";

const zh = {
  title: "立方体结构", subtitle: "同一结构 · 同一套工具 · 每次操作都是一步",
  prepare: "备课", demonstrate: "课堂演示（本机）", modes: "工作模式",
  scope: "刷新或切换工作台会清空当前草稿；课堂联网同步与课件保存尚未接入。",
  prepareNote: "先搭建初始结构，设为起点，再直接操作画布录制教学步骤。",
  demoNote: "使用备课的操作逐步演示，也可临场操作；备课记录保持不变。",
  tools: "画布工具", orbit: "观察", select: "多选", build: "搭建", remove: "挖除", color: "整块颜色", face: "单面染色", layer: "按层显隐",
  orbitHint: "拖动旋转，滚轮缩放；视角按钮平滑转到指定方向。",
  selectHint: "逐个点击添加或取消选择。批量操作作用于选中的单位块。",
  buildHint: "点击已有方块的面，在相邻格搭建；点击地面可从空结构开始。",
  removeHint: "点击真正挖除一个单位块，体积和表面积随之重新计算。",
  colorHint: "点击改变整块底色。已经染过的面保留原来的面颜色。",
  faceHint: "点击只染当前这一面；批量涂外表面按完整结构计算。",
  layerHint: "点击隐藏所在层；在层列表中重新显示。隐藏不改变结构数量和面积。",
  colorLabel: "颜色", colors: ["叶绿", "珊瑚红", "月黄", "天空蓝", "紫藤", "米白"],
  selected: "已选", clearSelection: "取消选择", selectVisible: "选择可见块", batchColor: "选中块换色", batchPaint: "选中块涂外表面", paintAll: "全部涂外表面", clearPaint: "清除选中块面染色",
  view: "视角", angle: "立体", front: "正视", right: "右视", top: "俯视", fit: "当前方向重新居中",
  layerAxis: "分层轴", layers: "层", hide: "隐藏", show: "显示", showAll: "显示全部层", selectLayer: "选择这一层",
  library: "支线起点", loadPreset: "载入为新起点", empty: "空白结构",
  layeredCounting: "分层计数", hiddenCubes: "遮挡计数", threeViews: "三视图", surfacePainting: "表面染色", hollowing: "挖空与表面积",
  loadTitle: "开始一个新结构？", loadDescription: "这会替换本工作台的结构与操作记录。先完成当前验收，或取消继续编辑。",
  startTitle: "把当前画面设为起点？", startDescription: "保留当前结构、颜色、显隐和视角；清空已有操作记录，从这里开始录制教学步骤。",
  confirm: "确认", cancel: "取消", setStart: "设为录制起点", restartDemo: "重演备课", steps: "操作记录", initial: "起点",
  previous: "上一步", next: "下一步", play: "播放", pause: "暂停", step: "步", emptySteps: "直接操作画布，操作会逐条出现在这里。",
  replayNote: "正在回看。回到末步可继续录制，或明确从这里续编。", returnEnd: "回到末步", branch: "从这里续编", branchTitle: "替换后续步骤？", branchDescription: "保留当前步及之前的记录，移除后续步骤，然后继续录制。",
  metrics: "结构统计", showMetrics: "显示统计", hideMetrics: "收起统计", volume: "单位块", totalArea: "总表面积", exteriorArea: "外表面积", interiorArea: "内表面积", paintHistogram: "染色面数 → 单位块数", geometryNote: "统计完整逻辑结构；隐藏的块仍计入。整块底色不计作面染色。",
  pending: "后续验收：连续切割／拆开展示、编组与定步移动、符号／连续编号、可调半透明与虚线遮挡边。",
  limit: "已到当前验收版容量：512 个单位块、256 步，坐标范围 −12 至 12。", blockedBuild: "此格已有方块（可能被隐藏），或已超出可搭建范围。",
  clearedPaint: "清除面染色", allLayers: "显示全部层", paint: "染色", cubeUnit: "块", faceUnit: "面",
} as const;

const en = {
  title: "Cube Structures", subtitle: "One structure · One toolset · One operation per step",
  prepare: "Preparation", demonstrate: "Class demo (local)", modes: "Workspace mode",
  scope: "Refreshing or switching workspaces clears this draft. Courseware saving and live classroom sync are not connected yet.",
  prepareNote: "Build your starting structure, set it as the start, then operate the canvas to record your lesson.",
  demoNote: "Replay the prepared operations or improvise with the same tools. Preparation stays unchanged.",
  tools: "Canvas tools", orbit: "Observe", select: "Multi-select", build: "Build", remove: "Remove", color: "Cube color", face: "Paint face", layer: "Layer visibility",
  orbitHint: "Drag to rotate and scroll to zoom. View buttons rotate smoothly to the chosen direction.",
  selectHint: "Click cubes to toggle selection. Batch operations affect the selected cubes.",
  buildHint: "Click a cube face to add a neighbor, or click the ground to start from an empty structure.",
  removeHint: "Click to actually remove a cube. Volume and surface area are recalculated.",
  colorHint: "Click to change a cube's base color. Individually painted faces retain their colors.",
  faceHint: "Click to paint one face. Exterior batch painting uses the complete logical structure.",
  layerHint: "Click to hide a layer; show it again in the layer list. Hiding changes neither volume nor area.",
  colorLabel: "Color", colors: ["Leaf", "Coral", "Moon", "Sky", "Wisteria", "Ivory"],
  selected: "Selected", clearSelection: "Clear selection", selectVisible: "Select visible", batchColor: "Color selected cubes", batchPaint: "Paint selected exteriors", paintAll: "Paint all exterior faces", clearPaint: "Clear selected face paint",
  view: "View", angle: "3D", front: "Front", right: "Right", top: "Top", fit: "Reframe this view",
  layerAxis: "Layer axis", layers: "Layers", hide: "Hide", show: "Show", showAll: "Show all layers", selectLayer: "Select this layer",
  library: "Branch starting points", loadPreset: "Load as new start", empty: "Empty structure",
  layeredCounting: "Layer counting", hiddenCubes: "Hidden cubes", threeViews: "Three views", surfacePainting: "Surface painting", hollowing: "Hollowing & surface area",
  loadTitle: "Start a new structure?", loadDescription: "This replaces this workspace's structure and operation record. Finish reviewing the current one first, or cancel to keep editing.",
  startTitle: "Use this scene as the start?", startDescription: "Keep the current structure, colors, visibility and view. Clear the operation record and start recording from here.",
  confirm: "Confirm", cancel: "Cancel", setStart: "Set recording start", restartDemo: "Replay preparation", steps: "Operation record", initial: "Start",
  previous: "Previous step", next: "Next step", play: "Play", pause: "Pause", step: "steps", emptySteps: "Operate the canvas. Each operation appears here as a step.",
  replayNote: "Reviewing a past step. Return to the last step to record, or explicitly continue from here.", returnEnd: "Go to last step", branch: "Continue from here", branchTitle: "Replace later steps?", branchDescription: "Keep this step and all earlier operations, remove later steps, then continue recording.",
  metrics: "Structure statistics", showMetrics: "Show statistics", hideMetrics: "Hide statistics", volume: "Unit cubes", totalArea: "Total surface area", exteriorArea: "Exterior area", interiorArea: "Interior area", paintHistogram: "Painted faces → cube count", geometryNote: "Measures the full logical structure, including hidden cubes. Base color is separate from face paint.",
  pending: "Next reviews: repeated cuts / separated display, groups and fixed-step moves, symbols / sequential numbering, adjustable transparency and dashed hidden edges.",
  limit: "Review-build capacity: 512 cubes, 256 steps, coordinates from −12 to 12.", blockedBuild: "This cell is occupied (possibly hidden), or is outside the building range.",
  clearedPaint: "Clear face paint", allLayers: "Show all layers", paint: "Paint", cubeUnit: "cubes", faceUnit: "faces",
} satisfies { [Key in keyof typeof zh]: Key extends "colors" ? readonly string[] : string };

export function cubeStructuresMessages(locale: "zh" | "en") { return locale === "en" ? en : zh; }

export function cubeOperationLabel(operation: CubeOperation, locale: "zh" | "en"): string {
  const m = cubeStructuresMessages(locale);
  switch (operation.kind) {
    case "build": return `${m.build} (${operation.position.x}, ${operation.position.y}, ${operation.position.z})`;
    case "remove": return `${m.remove} · ${operation.ids.length} ${m.cubeUnit}`;
    case "color": return `${m.color} · ${operation.ids.length} ${m.cubeUnit}`;
    case "paint": return `${m.paint} · ${operation.faces.length} ${m.faceUnit}`;
    case "clear-paint": return `${m.clearedPaint} · ${operation.ids.length} ${m.cubeUnit}`;
    case "layer": return `${operation.visible ? m.show : m.hide} ${operation.axis.toUpperCase()} = ${operation.index}`;
    case "show-all": return m.allLayers;
    case "view": return `${m.view} · ${m[operation.view]}`;
  }
}
