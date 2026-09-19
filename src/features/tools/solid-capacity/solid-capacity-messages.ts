const zh = {
  title: "容积比较", tools: "容积比较工具", close: "关闭", settings: "结构与显示设置", reset: "恢复备课起点", clear: "清空两容器",
  dimensions: "容器尺寸", radius: "底面半径", height: "高", cone: "圆锥", cylinder: "圆柱", equalDimensions: "同底等高", independent: "分别设置",
  dimensionHint: "修改尺寸会清空两容器，再重新装入液体。", liquid: "装入与转移", fillCone: "装满圆锥", fillCylinder: "装满圆柱", emptyCone: "清空圆锥", emptyCylinder: "清空圆柱",
  pourCone: "圆锥倒入圆柱", pourCylinder: "圆柱倒回圆锥", portion: "转移量", all: "全部现有液体", halfCone: "半锥容量", oneCone: "一锥容量",
  liquidHint: "容量不足时，剩余液体留在原容器。此处为受控灌入示意。", tipDown: "尖端朝下", tipUp: "尖端朝上", orientationHint: "切换方向会清空圆锥。",
  numbers: "显示容量数字", dimensionLabels: "显示尺寸", axes: "坐标轴", grid: "网格", orbit: "旋转观察", pan: "平移视角", fit: "适合视野",
  amount: "液量", capacity: "容量", ratio: "同底等高：圆锥容量 : 圆柱容量 = 1 : 3", ratioDifferent: "不同尺寸：按各自半径和高比较容量", units: "单位³",
  axisSnap: "视角吸附", enableAxisSnap: "开启视角吸附", disableAxisSnap: "关闭视角吸附", syncError: "课堂状态未保存，请重试。", fallback: "当前设备无法显示三维画布。",
  views: { angle: "斜侧视图", front: "正视图", left: "左视图", right: "右视图", top: "俯视图", bottom: "底视图" },
};
const en: typeof zh = {
  title: "Capacity comparison", tools: "Capacity tools", close: "Close", settings: "Structure and display", reset: "Restore prepared start", clear: "Empty both vessels",
  dimensions: "Vessel dimensions", radius: "Base radius", height: "Height", cone: "Cone", cylinder: "Cylinder", equalDimensions: "Equal base and height", independent: "Set separately",
  dimensionHint: "Changing dimensions empties both vessels before refilling.", liquid: "Fill and transfer", fillCone: "Fill cone", fillCylinder: "Fill cylinder", emptyCone: "Empty cone", emptyCylinder: "Empty cylinder",
  pourCone: "Pour cone into cylinder", pourCylinder: "Pour cylinder into cone", portion: "Transfer amount", all: "All available liquid", halfCone: "Half a cone capacity", oneCone: "One cone capacity",
  liquidHint: "Any excess remains in the source vessel. This is a controlled filling demonstration.", tipDown: "Tip down", tipUp: "Tip up", orientationHint: "Changing orientation empties the cone.",
  numbers: "Show capacity values", dimensionLabels: "Show dimensions", axes: "Axes", grid: "Grid", orbit: "Orbit view", pan: "Pan view", fit: "Fit to view",
  amount: "Liquid", capacity: "Capacity", ratio: "Equal base and height: cone : cylinder capacity = 1 : 3", ratioDifferent: "Different dimensions: compare capacities using each radius and height", units: "units³",
  axisSnap: "Axis snap", enableAxisSnap: "Enable axis snap", disableAxisSnap: "Disable axis snap", syncError: "Classroom state was not saved. Try again.", fallback: "This device cannot display the 3D canvas.",
  views: { angle: "Oblique view", front: "Front view", left: "Left view", right: "Right view", top: "Top view", bottom: "Bottom view" },
};
export function solidCapacityMessages(locale: string) { return locale === "en" ? en : zh; }
