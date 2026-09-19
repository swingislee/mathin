const zh = {
  title: "截面观察", enabled: "显示截面", showPlane: "显示切平面", normal: "切平面方向", tilt: "倾斜", offset: "平移", reset: "复位切平面",
  keep: "完整立体", removePositive: "移去正侧", removeNegative: "移去负侧", removedSide: "观察内部", diagonal: "斜切", preview: "平视截口",
  empty: "切平面还未碰到立体", point: "仅接触一个顶点", segment: "仅接触一条线段", polygon: "条边", boundary: "与立体边界重合",
  hint: "拖动蓝色切平面可平移，拖动两个圆柄可倾斜。空白处旋转视角；正视图通过引线对应红色截口。",
  dragPlane: "拖动切平面", precise: "精确调整",
  unsupported: "当前截面支持正方体、长方体、三棱柱和四棱锥；曲面截线尚未开启。",
  selectedOnly: "作用于当前选中的立体", decrease: "减小", increase: "增大", planeNames: { x: "Y–Z", y: "X–Z", z: "X–Y" },
};
const en: typeof zh = {
  title: "Cross-section", enabled: "Show section", showPlane: "Show cutting plane", normal: "Plane direction", tilt: "Tilt", offset: "Slide", reset: "Reset cutting plane",
  keep: "Whole solid", removePositive: "Remove positive side", removeNegative: "Remove negative side", removedSide: "Look inside", diagonal: "Oblique", preview: "Face-on section",
  empty: "The plane does not touch the solid", point: "Touches one vertex only", segment: "Touches a line segment only", polygon: "sides", boundary: "Coincides with the solid boundary",
  hint: "Drag the blue plane to slide it, or either round handle to tilt it. Drag empty space to orbit. The linked face-on view matches the red section.",
  dragPlane: "Drag cutting plane", precise: "Precise adjustments",
  unsupported: "Sections currently support cubes, cuboids, triangular prisms and square pyramids. Curved surfaces are not enabled.",
  selectedOnly: "Applies to the selected solid", decrease: "Decrease", increase: "Increase", planeNames: { x: "Y–Z", y: "X–Z", z: "X–Y" },
};
export const solidSectionsMessages = (locale: string) => locale === "en" ? en : zh;
