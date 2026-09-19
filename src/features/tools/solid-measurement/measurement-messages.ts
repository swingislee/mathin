const zh = {
  title: "测量与单位", close: "收起", enabled: "显示测量", dimensions: "尺寸标注", faceArea: "所选面面积", totals: "表面积与体积",
  unitGrid: "表面单位网格", unitFill: "单位方块分层", units: "这里的 u 是抽象单位长度；u²、u³ 分别是面积、体积单位。", selectSolid: "先选择一个立体。",
  chooseFace: "选择一个面观察面积", noFace: "选择下方的面，或用观察面工具在实体上点选。", surfaceArea: "表面积 S", volume: "体积 V", selectedArea: "此面面积",
  perLayer: "每层", targetLayers: "目标层数", filled: "目标单位方块数", addLayer: "放入一层", removeLayer: "移出一层", fillAll: "逐层填满", clear: "逐层清空",
  layerHint: "点击后按层依次变化，可中途改变目标；旋转视角能观察每层。", gridHint: "网格从一个角起每隔 1 u 划分；小数尺寸的最后一格可能不足 1 u。",
  cuboidOnly: "单位网格与方块填充用于正方体、长方体；其他立体仍可观察尺寸与面积、体积。",
  fillWhole: "单位方块只在各边都是整数单位时铺满；当前保留真实尺寸，不近似成满格。",
  fillLimit: "单位方块演示支持各边 1–6 u，最多 216 块；当前尺寸的面积、体积仍按真实参数计算。",
  sourceSolid: "读数对应原实体的完整表面与体积。", partial: "正在放入或移出一层", unitCubes: "单位方块",
  dimensionNames: { width: "宽", height: "高", depth: "深", radius: "半径", baseWidth: "底边", triangleHeight: "三角形高", prismLength: "棱柱长" },
};
export type MeasurementMessages = { [K in keyof typeof zh]: typeof zh[K] extends string ? string : { [J in keyof typeof zh[K]]: string } };
const en: MeasurementMessages = {
  title: "Measurement & units", close: "Close", enabled: "Show measurements", dimensions: "Dimension labels", faceArea: "Selected face area", totals: "Surface area & volume",
  unitGrid: "Unit surface grid", unitFill: "Unit-cube layers", units: "u is an abstract length unit. u² and u³ are area and volume units.", selectSolid: "Select a solid first.",
  chooseFace: "Choose a face to observe its area", noFace: "Choose a face below, or use Explore faces to select one on the solid.", surfaceArea: "Surface area S", volume: "Volume V", selectedArea: "Face area",
  perLayer: "Per layer", targetLayers: "Target layers", filled: "Target unit-cube count", addLayer: "Add one layer", removeLayer: "Remove one layer", fillAll: "Fill layer by layer", clear: "Empty layer by layer",
  layerHint: "Layers change in sequence. You can change the target mid-way and orbit to observe each layer.", gridHint: "Grid lines start at one corner every 1 u. The last interval of a fractional dimension may be less than 1 u.",
  cuboidOnly: "Unit grids and cube filling apply to cubes and cuboids. Other solids retain dimensions, surface area and volume.",
  fillWhole: "Unit cubes fill a solid only when every edge is a whole number of units. Fractional dimensions remain unchanged.",
  fillLimit: "Unit-cube demonstrations support edges of 1–6 u, up to 216 cubes. Area and volume still use the actual dimensions.",
  sourceSolid: "Readings refer to the original solid's complete surface and volume.", partial: "Adding or removing a layer", unitCubes: "Unit cubes",
  dimensionNames: { width: "Width", height: "Height", depth: "Depth", radius: "Radius", baseWidth: "Base edge", triangleHeight: "Triangle height", prismLength: "Prism length" },
};
export function measurementMessages(locale: string): MeasurementMessages { return locale === "en" ? en : zh; }
