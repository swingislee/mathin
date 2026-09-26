export const PLANAR_TOOLS = [
  { id: "plane-shapes", version: "plane-shapes-lesson-v1", scenes: ["01-basic"], zh: "基本图形认识", en: "Exploring basic shapes" },
  { id: "plane-geometry", version: "plane-geometry-lesson-v1", scenes: ["03", "04", "05"], zh: "线与角", en: "Lines and angles" },
  { id: "plane-polygons", version: "plane-polygons-lesson-v1", scenes: ["06", "07", "08"], zh: "三角形与四边形", en: "Triangles and quadrilaterals" },
  { id: "plane-perimeter", version: "plane-perimeter-lesson-v1", scenes: ["10", "12", "13", "43"], zh: "周长探究", en: "Exploring perimeter" },
  { id: "plane-measurement", version: "plane-measurement-lesson-v1", scenes: ["11"], zh: "面积单位", en: "Area units" },
  { id: "plane-geoboard", version: "plane-geoboard-lesson-v1", scenes: ["34", "56"], zh: "钉板与格点面积", en: "Geoboards and lattice area" },
  { id: "plane-area", version: "plane-area-lesson-v1", scenes: ["14", "15", "16", "17", "46", "58"], zh: "剪拼与面积转化", en: "Dissection and area" },
  { id: "plane-area-relations", version: "plane-area-relations-lesson-v1", scenes: ["18", "37", "38", "39", "40", "41", "42", "59"], zh: "面积关系", en: "Area relationships" },
  { id: "plane-circle-area", version: "plane-circle-area-lesson-v1", scenes: ["27"], zh: "圆面积割补", en: "Dissecting a circle" },
  { id: "plane-overlap", version: "plane-overlap-lesson-v1", scenes: ["33", "44", "45"], zh: "重叠与圆方", en: "Overlaps, circles and squares" },
  { id: "plane-motion", version: "plane-motion-lesson-v1", scenes: ["20", "21", "22", "24"], zh: "平面图形运动", en: "Plane transformations" },
  { id: "plane-folding", version: "plane-folding-lesson-v1", scenes: ["32"], zh: "折纸与剪纸", en: "Paper folding and cutting" },
  { id: "plane-tiling", version: "plane-tiling-lesson-v1", scenes: ["36"], zh: "镶嵌与空隙", en: "Tiling and gaps" },
  { id: "plane-patterns", version: "plane-patterns-lesson-v1", scenes: ["47", "48", "49"], zh: "图形计数", en: "Counting shapes" },
  { id: "plane-matchsticks", version: "plane-matchsticks-lesson-v1", scenes: ["51"], zh: "火柴棒拼摆", en: "Matchstick arrangements" },
  { id: "plane-graph-path", version: "plane-graph-path-lesson-v1", scenes: ["52"], zh: "一笔画与多笔画", en: "Tracing connected paths" },
  { id: "plane-grid-path", version: "plane-grid-path-lesson-v1", scenes: ["53"], zh: "格点路线", en: "Lattice routes" },
  { id: "plane-reflection-path", version: "plane-reflection-path-lesson-v1", scenes: ["54"], zh: "反射最短路", en: "Reflection and shortest routes" },
  { id: "plane-covering", version: "plane-covering-lesson-v1", scenes: ["57"], zh: "棋盘染色与覆盖", en: "Board colouring and covering" },
  { id: "plane-rolling", version: "plane-rolling-lesson-v1", scenes: ["55"], zh: "圆的内外滚动", en: "Rolling circles" },
  { id: "plane-clock", version: "plane-clock-lesson-v1", scenes: ["60"], zh: "钟面与夹角", en: "Clock hands and angles" },
  { id: "plane-tangram", version: "plane-tangram-lesson-v1", scenes: ["02"], zh: "七巧板拼摆", en: "Tangram construction" },
] as const;
/** 历史备课和发布副本继续按原身份打开，新建入口不再提供合并工具。 */
export const LEGACY_PLANAR_TOOLS = [
  { id: "plane-pieces", version: "plane-pieces-lesson-v1", scenes: ["01", "02"], zh: "图形纸片（旧版）", en: "Shape pieces (legacy)" },
] as const;
export const ALL_PLANAR_TOOLS = [...PLANAR_TOOLS, ...LEGACY_PLANAR_TOOLS] as const;
export type PlanarToolId = (typeof ALL_PLANAR_TOOLS)[number]["id"];
export type PlanarVersion = (typeof ALL_PLANAR_TOOLS)[number]["version"];
