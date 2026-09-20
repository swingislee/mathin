const zh = {
  title: "索玛立方体", observe: "单块观察", assemble: "自由拼搭", pieces: "选择拼块", count: "拼块数量", countUnit: "块", cubes: "个小立方体",
  selectHint: "任意组合 1–7 宝；勾选加入，取消勾选移出。", observeHint: "点击下方切换观察对象；拖动画面转动视角，滚轮缩放。返回拼搭可继续原来的作品。",
  assembleHint: "拖动拼块在桌面上移动，拖空白转动视角。按住 Shift 拖拼块，或拖旁边的旋转把手转动；Y 箭头可抬高。",
  move: "移动拼块", rotate: "旋转拼块", orbit: "转动视角", pan: "平移视角", fit: "完整显示", undo: "撤销", redo: "重做", reset: "恢复起点",
  settings: "显示设置", grid: "底面网格", axes: "坐标轴", labels: "拼块名称", close: "关闭", apart: "分开摆放", example: "3×3×3 示例", selected: "当前选择",
  moveHint: "拖动时连续跟手，松手对齐网格；淡色轮廓预览落点。桌面拖动保持高度，屏幕拖动可同时改变高度。XYZ 箭头与按钮保留精确移动。", rotateHint: "拖拼块或旋转把手连续转动，松手就近对齐。彩色十字是固定转动支点；下方按钮精确转动 90°。贴地时可先抬高再转。",
  rotateDrag: "拖动旋转拼块（键盘按 Enter 转动 90°）", moveFeel: "拖动手感（本次试用）", tableMove: "沿桌面", screenMove: "跟随屏幕",
  tableEdgeOn: "当前视角几乎贴着桌面，请稍微转动视角，或在移动面板切换为跟随屏幕。", gestureBlocked: "落点与其他拼块或地面冲突，已回到起拖位置。可先移开或抬高再转动。",
  blocked: "这个位置与其他拼块重叠，或超出搭建范围。请先移到空处。", hiddenAxis: "这条轴朝向屏幕，请切换视角或使用移动按钮。",
  syncError: "课堂同步未成功，画面保留上次状态，请重试。", add: "加入", remove: "移出", choose: "选择", lastPiece: "至少保留一宝",
  views: { angle: "立体视角", front: "正面", left: "左面", right: "右面", top: "上面" },
  axisSnap: "视角吸附", enableAxisSnap: "开启视角吸附", disableAxisSnap: "关闭视角吸附",
};
const en: typeof zh = {
  title: "Soma cube", observe: "Observe one", assemble: "Build freely", pieces: "Choose pieces", count: "Piece count", countUnit: "pieces", cubes: "unit cubes",
  selectHint: "Combine any 1–7 Bao. Check to add a piece, uncheck to remove it.", observeHint: "Select a piece below. Drag to orbit and scroll to zoom. Return to building to continue your assembly.",
  assembleHint: "Drag a piece along the table; drag empty space to orbit. Shift-drag a piece or drag its rotation grip to turn it. Use the Y arrow to lift.",
  move: "Move piece", rotate: "Rotate piece", orbit: "Orbit view", pan: "Pan view", fit: "Fit all", undo: "Undo", redo: "Redo", reset: "Restore start",
  settings: "Display settings", grid: "Ground grid", axes: "Axes", labels: "Piece names", close: "Close", apart: "Spread pieces", example: "3×3×3 example", selected: "Selected",
  moveHint: "Movement follows your drag continuously and snaps on release. The faint outline previews the landing. Table dragging keeps height; screen dragging can change it. XYZ arrows and buttons remain available for exact moves.", rotateHint: "Drag a piece or its grip to rotate continuously, then release to align. The colored cross marks the fixed pivot. Use the buttons for exact 90° turns. Lift first if the floor blocks a turn.",
  rotateDrag: "Drag to rotate the piece (Enter turns 90°)", moveFeel: "Drag feel (this session)", tableMove: "Along table", screenMove: "Follow screen",
  tableEdgeOn: "The table is nearly edge-on. Orbit slightly, or choose Follow screen in the move panel.", gestureBlocked: "The landing meets another piece or the floor. Returned to the starting pose; move away or lift before turning.",
  blocked: "This placement overlaps another piece or is outside the board. Move into an empty area first.", hiddenAxis: "This axis points toward the screen. Change the view or use the move buttons.",
  syncError: "Classroom sync failed. The last state is preserved. Please retry.", add: "Add", remove: "Remove", choose: "Select", lastPiece: "Keep at least one Bao",
  views: { angle: "Perspective", front: "Front", left: "Left", right: "Right", top: "Top" },
  axisSnap: "Snap view", enableAxisSnap: "Enable view snap", disableAxisSnap: "Disable view snap",
};
export function somaMessages(locale: string) { return locale === "en" ? en : zh; }
