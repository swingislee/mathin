const zh = {
  title: "其它立体展开", fold: "抓住纸片折叠", shape: "立体与尺寸", style: "面色与标注", labels: "显示面标注", selected: "当前面", label: "面标注", opacity: "不透明度",
  foldAll: "依次折成立体", unfold: "依次全部展开", reset: "恢复备课起点", undo: "撤销", redo: "重做", snap: "视角吸附", snapOn: "开启视角吸附", snapOff: "关闭视角吸附",
  cuboid: "长方体", prism: "三棱柱（等腰底面）", width: "长", height: "高", depth: "宽", baseWidth: "三角形底边", baseHeight: "三角形高", prismLength: "柱长",
  sizeHelp: "先全部展开，再修改尺寸。", selectHelp: "点击纸片选择要标色或标注的面。", foldFace: "折起这个面", openFace: "放平这个面",
  failed: "本次课堂操作未保存，已保留确认后的现场，请重试。", invalid: "尺寸应为 0.25 到 8 之间的数。",
  help: "直接抓纸片折叠，空白处拖动可旋转观察；使用右侧按钮依次展开、设置尺寸和恢复起点。",
  webgl: "当前设备未能启动 3D 画布，请启用 WebGL 后重试。",
};
type Messages = { [K in keyof typeof zh]: string };
const en: Messages = {
  title: "Other solid nets", fold: "Grab and fold paper", shape: "Solid & dimensions", style: "Face colors & labels", labels: "Show face labels", selected: "Selected face", label: "Face label", opacity: "Opacity",
  foldAll: "Fold into a solid in sequence", unfold: "Unfold all in sequence", reset: "Restore prepared start", undo: "Undo", redo: "Redo", snap: "View snapping", snapOn: "Enable view snapping", snapOff: "Disable view snapping",
  cuboid: "Cuboid", prism: "Triangular prism (isosceles base)", width: "Length", height: "Height", depth: "Width", baseWidth: "Triangle base", baseHeight: "Triangle height", prismLength: "Prism length",
  sizeHelp: "Unfold all before changing dimensions.", selectHelp: "Click a paper face to change its color or label.", foldFace: "Fold this face", openFace: "Flatten this face",
  failed: "The classroom change was not saved. The confirmed scene is retained; please retry.", invalid: "Dimensions must be between 0.25 and 8.",
  help: "Grab paper to fold; drag empty space to orbit. Use the right toolbar to unfold, change dimensions or restore the prepared start.",
  webgl: "The 3D canvas could not start. Enable WebGL and try again.",
};
export const solidNetsMessages = (locale: string): Messages => locale === "en" ? en : zh;
