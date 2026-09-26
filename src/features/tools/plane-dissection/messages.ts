const zh = {
  title: "平面拼剪 · 平行四边形", preview: "交互试做", review: "返回场景审核", tool: "平面拼剪工具栏",
  cut: "沿高剪开", assemble: "演示拼合", reset: "复原", undo: "撤销", redo: "重做", cancel: "停止动作",
  shape: "调整原图", display: "观察设置", close: "收起", snap: "拼接吸附", origin: "原图虚线", measures: "底与高", area: "面积关系", grid: "参考方格",
  base: "底", height: "高", slant: "倾斜量", unit: "cm", squareUnit: "cm²", body: "主体纸片", offcut: "剪下的三角片",
  cutHint: "先调整原图，再沿高剪开。", dragHint: "直接拖纸片；靠近拼接位置松手吸附。", shapeHint: "拖动圆点调整原图，也可输入准确尺寸。",
  cancelHint: "Esc 取消当前拖动；方向键移动选中纸片。", shapeAfterCut: "修改尺寸前，请先复原。", originalMeasures: "原图尺寸", combinedArea: "两片总面积",
  pending: "本次只试剪拼手感；尚未接入账号场景保存与课堂同步。", snapTarget: "吸附落点", select: "选中", noSnapshot: "只保存准确现场，不保存拖动中间帧。",
};
const en: typeof zh = {
  title: "Plane dissection · Parallelogram", preview: "Interaction preview", review: "Back to scene review", tool: "Dissection toolbar",
  cut: "Cut along height", assemble: "Show rearrangement", reset: "Restore", undo: "Undo", redo: "Redo", cancel: "Stop motion",
  shape: "Adjust shape", display: "Display settings", close: "Close", snap: "Join snapping", origin: "Original outline", measures: "Base & height", area: "Area relationship", grid: "Reference grid",
  base: "Base", height: "Height", slant: "Slant", unit: "cm", squareUnit: "cm²", body: "Main paper", offcut: "Cut triangle",
  cutHint: "Adjust the shape, then cut along its height.", dragHint: "Drag either paper directly; release near a join to snap.", shapeHint: "Drag a dot to reshape, or enter exact dimensions.",
  cancelHint: "Esc cancels a drag; arrow keys move the selected paper.", shapeAfterCut: "Restore the shape before changing dimensions.", originalMeasures: "Original dimensions", combinedArea: "Combined area",
  pending: "This preview tests dissection gestures; account scenes and classroom sync are not connected yet.", snapTarget: "Snap destination", select: "Select", noSnapshot: "Capture exact scenes, not transient drag frames.",
};
export function planeDissectionMessages(locale: string) { return locale === "en" ? en : zh; }
