const zh = {
  title: "自由拼纸", layout: "拼接方格", fold: "直接拖纸折叠", unfold: "依次全部展开", reset: "恢复备课起点", undo: "撤销", redo: "重做",
  add: "增加方格", remove: "移除方格", select: "选择方格", style: "纸片颜色与标注", label: "标注", labels: "显示标注", selected: "选中纸片",
  help: "直接拖纸片即可沿最近的连接棱折动；拖空白处旋转观察。",
  layoutHelp: "点击虚线方格添加；点击已有方格选择。最多 12 格，保持一张树状连接的纸片。",
  folded: "先依次全部展开，再修改平面拼接。", limit: "保留 1～12 个方格。", duplicate: "这个位置已有方格。",
  disconnected: "请保留连通的纸片；可以先从末端移除。", cycle: "这里会形成闭环连接。首版支持树状纸片，请先移除一格，留出断开的边再拼接。",
  coordinate: "已到当前拼接范围，请在 −8～8 的方格范围内摆放。", failed: "课堂状态未保存，当前现场保留；请重试。",
  webgl: "当前设备未启用 3D。平面拼接仍可查看。", snap: "视角吸附", snapOn: "开启视角吸附", snapOff: "关闭视角吸附",
  square: (label: string) => `纸片 ${label}`, addAt: (x: number, z: number) => `在 (${x}, ${z}) 增加方格`,
};
const en: typeof zh = {
  title: "Free paper folding", layout: "Arrange squares", fold: "Drag paper to fold", unfold: "Unfold one hinge at a time", reset: "Restore prepared start", undo: "Undo", redo: "Redo",
  add: "Add square", remove: "Remove square", select: "Select square", style: "Paper color and label", label: "Label", labels: "Show labels", selected: "Selected paper",
  help: "Drag a paper face to fold its nearest connected edge. Drag empty space to orbit.",
  layoutHelp: "Click a dashed square to add it, or a paper square to select it. Keep one tree-connected sheet, up to 12 squares.",
  folded: "Unfold all hinges before changing the flat arrangement.", limit: "Keep between 1 and 12 squares.", duplicate: "This square is already occupied.",
  disconnected: "Keep the sheet connected. Remove end squares first.", cycle: "This would create a loop. This first version supports tree connections. Remove a square to leave a cut before adding here.",
  coordinate: "Keep square coordinates between −8 and 8.", failed: "The classroom state was not saved. Your current scene is unchanged; please retry.",
  webgl: "3D is unavailable on this device. The flat arrangement remains visible.", snap: "Axis snap", snapOn: "Enable axis snap", snapOff: "Disable axis snap",
  square: (label) => `Paper ${label}`, addAt: (x, z) => `Add square at (${x}, ${z})`,
};
export function paperFoldingMessages(locale: "zh" | "en") { return locale === "en" ? en : zh; }
