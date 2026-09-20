export function spatialActionMessages(locale: string) {
  return locale === "en" ? {
    roll: "Roll along a direction", rollHint: "Select an object or group, then use the X/Z arrows above it to roll 90° around its supporting edge. Hover to preview the edge and path; drag blank space to inspect.",
    rollBlocked: "Leave room for the whole roll. A direction is unavailable if its supporting edge is absent or the path or final placement is blocked.",
    rollSelect: "Select an object or group on the stage first.",
  } : {
    roll: "沿方向翻滚", rollHint: "先选中立体或组合，再点击对象上方的 X/Z 方向箭头，沿底部支撑棱翻滚 90°。悬停可预看支撑棱与路径；拖空白处观察。",
    rollBlocked: "请给翻滚过程留出空间；缺少支撑棱、路径受阻或不能落位的方向暂不可用。",
    rollSelect: "先在舞台中选中一个立体或组合。",
  };
}
