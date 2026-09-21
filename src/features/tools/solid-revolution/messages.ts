const zh = {
  title: "旋转成体", tools: "旋转成体工具", shape: "纸片与转轴", rectangle: "长方形", "right-triangle": "直角三角形",
  width: "边 A 长度", height: "边 B 长度", axis: "绕哪条边旋转", axisHeight: "绕边 B", axisWidth: "绕边 A", axisHint: "选中的边竖直放置，另一条边成为半径。",
  angle: "旋转角度", rotation: "旋转控制", play: "慢转一周／继续", pause: "暂停旋转", restart: "回到纸片起点", speed: "旋转速度", slow: "慢速", normal: "常速", fast: "快速",
  sweep: "保留扫过的形体", start: "显示起点纸片", measures: "显示尺寸", cylinder: "圆柱", cone: "圆锥", radius: "半径", axisLength: "转轴长",
  settings: "结构与显示设置", axes: "坐标轴", grid: "参考网格", close: "关闭", reset: "恢复教学起点", fit: "适合画面", orbit: "旋转视角", pan: "平移视角",
  axisSnap: "视角吸附", enableAxisSnap: "启用视角吸附", disableAxisSnap: "关闭视角吸附", fallback: "未能启动 3D 画布，请启用 WebGL 后重试。",
  gesture: "拖动纸片绕轴旋转；拖空白转视角。", failed: "课堂保存失败，已保留权威现场，请重试。", prepared: "起点", current: "当前",
  edgeOn: "当前接近平视，绕轴拖动不易定位。请稍微转动视角，或使用旋转角度控件。",
  views: { angle: "斜侧视图", front: "正视图", left: "左视图", right: "右视图", top: "俯视图", bottom: "仰视图" },
};
const en: typeof zh = {
  title: "Solids of revolution", tools: "Revolution tools", shape: "Paper & rotation axis", rectangle: "Rectangle", "right-triangle": "Right triangle",
  width: "Edge A length", height: "Edge B length", axis: "Rotate around", axisHeight: "Edge B", axisWidth: "Edge A", axisHint: "The selected edge stands vertically; the other edge becomes the radius.",
  angle: "Rotation angle", rotation: "Rotation controls", play: "Turn once / resume", pause: "Pause rotation", restart: "Return to flat paper", speed: "Rotation speed", slow: "Slow", normal: "Normal", fast: "Fast",
  sweep: "Keep swept solid", start: "Show starting paper", measures: "Show dimensions", cylinder: "Cylinder", cone: "Cone", radius: "Radius", axisLength: "Axis length",
  settings: "Structure & display", axes: "Axes", grid: "Reference grid", close: "Close", reset: "Restore prepared start", fit: "Fit view", orbit: "Orbit camera", pan: "Pan camera",
  axisSnap: "Camera snap", enableAxisSnap: "Enable camera snap", disableAxisSnap: "Disable camera snap", fallback: "Could not start the 3D canvas. Enable WebGL and try again.",
  gesture: "Drag the paper around its axis; drag empty space to orbit.", failed: "Classroom save failed. The authoritative scene is retained; please retry.", prepared: "Start", current: "Current",
  edgeOn: "The rotation plane is edge-on. Orbit slightly or use the angle controls for an exact turn.",
  views: { angle: "Oblique view", front: "Front view", left: "Left view", right: "Right view", top: "Top view", bottom: "Bottom view" },
};
export const solidRevolutionMessages = (locale: "zh" | "en") => locale === "en" ? en : zh;
