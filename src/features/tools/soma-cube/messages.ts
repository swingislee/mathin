const zh = {
  title: "索玛立方体", observe: "单块观察", assemble: "自由拼搭", pieces: "选择拼块", count: "拼块数量", countUnit: "块", cubes: "个小立方体",
  selectHint: "任意组合 1–7 宝；勾选加入，取消勾选移出。", observeHint: "点击下方切换观察对象；拖动画面转动视角，滚轮缩放。返回拼搭可继续原来的作品。",
  assembleHint: "选择一宝后，拖动 X / Y / Z 箭头移动；也可打开移动面板逐格调整。落位自动对齐网格。",
  move: "移动拼块", rotate: "旋转拼块", orbit: "转动视角", pan: "平移视角", fit: "完整显示", undo: "撤销", redo: "重做", reset: "恢复起点",
  settings: "显示设置", grid: "底面网格", axes: "坐标轴", labels: "拼块名称", close: "关闭", apart: "分开摆放", example: "3×3×3 示例", selected: "当前选择",
  moveHint: "沿所选轴拖动整宝，或每次移动一格。Y 轴向上。", rotateHint: "绕轴转动 90°，以拼块包围盒的最小角对齐网格。",
  blocked: "这个位置与其他拼块重叠，或超出搭建范围。请先移到空处。", hiddenAxis: "这条轴朝向屏幕，请切换视角或使用移动按钮。",
  syncError: "课堂同步未成功，画面保留上次状态，请重试。", add: "加入", remove: "移出", choose: "选择", lastPiece: "至少保留一宝",
  views: { angle: "立体视角", front: "正面", left: "左面", right: "右面", top: "上面" },
  axisSnap: "视角吸附", enableAxisSnap: "开启视角吸附", disableAxisSnap: "关闭视角吸附",
};
const en: typeof zh = {
  title: "Soma cube", observe: "Observe one", assemble: "Build freely", pieces: "Choose pieces", count: "Piece count", countUnit: "pieces", cubes: "unit cubes",
  selectHint: "Combine any 1–7 Bao. Check to add a piece, uncheck to remove it.", observeHint: "Select a piece below. Drag to orbit and scroll to zoom. Return to building to continue your assembly.",
  assembleHint: "Select a Bao and drag its X / Y / Z arrows, or use the move panel for single steps. Placement snaps to the grid.",
  move: "Move piece", rotate: "Rotate piece", orbit: "Orbit view", pan: "Pan view", fit: "Fit all", undo: "Undo", redo: "Redo", reset: "Restore start",
  settings: "Display settings", grid: "Ground grid", axes: "Axes", labels: "Piece names", close: "Close", apart: "Spread pieces", example: "3×3×3 example", selected: "Selected",
  moveHint: "Drag the whole Bao along an axis, or move one cell at a time. Y points up.", rotateHint: "Turn 90° about an axis, aligning the minimum corner of the piece's bounds to the grid.",
  blocked: "This placement overlaps another piece or is outside the board. Move into an empty area first.", hiddenAxis: "This axis points toward the screen. Change the view or use the move buttons.",
  syncError: "Classroom sync failed. The last state is preserved. Please retry.", add: "Add", remove: "Remove", choose: "Select", lastPiece: "Keep at least one Bao",
  views: { angle: "Perspective", front: "Front", left: "Left", right: "Right", top: "Top" },
  axisSnap: "Snap view", enableAxisSnap: "Enable view snap", disableAxisSnap: "Disable view snap",
};
export function somaMessages(locale: string) { return locale === "en" ? en : zh; }
