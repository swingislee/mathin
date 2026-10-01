const zh = {
  title: "数位积木", tools: "数位积木工具", settings: "结构与显示设置", prepare: "准备数与分组", compare: "比较两个数", inspect: "观察计数单位",
  presentation: "演示策略", rods: "长条进位", boxes: "装盒映射", inside: "放回盒内", outside: "取出展示", both: "内外同时展示",
  boxOverflow: (count: number) => "超出 " + count,
  boxActions: "选中盒子的操作", takeOut: "取出", putBack: "放回", compareContents: "对比",
  boxHint: "点一次进位，连续完成倒下或叠合、装入高一位的盒子，数字同步完成。点选盒子后在旁边取出、放回或同时对比；右侧保留完整观察设置。",
  mappingHint: "先点选一盒，再取出查看；原盒留空，其他盒保持收纳。放回或内外同时展示只改变表示，不改变数量。切换盒子会先收回上一盒。盒内使用压缩表示，取出后按原始单位尺寸展示。",
  boxColors: "每盒前端都是完整的一个单位，按本列每五个黄蓝交替；顶面和侧面分格保留组成。完整体再次作为一个小单位，不在后排累成高塔。",
  boxGroupHint: "点选一盒，再选择取出或内外同时展示。旋转视角只改变观察方向，不改变装盒状态。",
  strategyLegacy: "已保存的旧版场景保留原演示。新建数位积木场景可选择装盒映射。",
  single: "一个数", left: "左边", right: "右边", close: "关闭", orbit: "旋转视角", pan: "平移视角", fit: "适合画面", reset: "恢复教学起点",
  undo: "撤销", redo: "重做", add: "加一个一", remove: "拿走一个一", carry: "满十进一", carryOne: "十个一合成一个十", carryTen: "十个十合成一个百",
  unpack: "拆开一个计数单位", unpackTen: "一个十拆成十个一", unpackHundred: "一个百拆成十个十",
  pause: "暂停过程", resume: "继续过程", step: "前进一步", progress: "演示进度", autoCarry: "满一组后自动进位",
  speed: "演示速度", slow: "慢", normal: "常速", fast: "快", showDigits: "显示数位与数字", showLabels: "显示数位标签", grid: "参考网格", axes: "坐标轴",
  total: "总数", notation: "数的写法", ones: "个位", tens: "十位", hundreds: "百位", pending: "可以继续进位",
  pendingOnes: (count: number) => count + " 个一 · 待进位", pendingTens: (count: number) => count + " 个十 · 待进位",
  needUnpack: "先拆开一个十，再拿走一个一。", limit: "本教具支持 0–999。", failed: "本次操作未保存，请重试。",
  normalGrouping: "按数位分组", allOnes: "全部是单个一", allTens: "最多合成十", apply: "摆放", clear: "清空当前数", value: "设置数",
  comparison: "比较符号", hidden: "隐藏", all: "全部", groupHint: "点击积木，观察它所属计数单位的真实长度与组成。",
  units: "个一", group: "选中单位包含", moving: "正在演示", paused: "已暂停",
  editPlace: (place: string) => "修改" + place + "的数字", addAt: (place: string) => place + "加一个单位", removeAt: (place: string) => place + "减一个单位",
  toTens: "进到十位", toHundreds: "进到百位", depth: (value: number) => value + " 个单位长",
  carryLabel: "进位", pauseLabel: "暂停", resumeLabel: "继续",
  orientation: "颜色固定每五个切换：五黄、五蓝循环。长条每五组切换摆放方向，原单位颜色不随进位改变；进位数量由所选进制决定。",
  fullHint: "长条保持真实单位长度。大量积木使用连续长条与分格纹理，远景略去不可分辨的细线，放大可见单位格；两数始终使用同一比例。",
  radix: "进制", places: "显示数位", baseNote: "各位按进制的幂标注；十六进制用 A–F 表示十至十五。输入使用当前进制。",
  capacityError: "当前数超出了所选进制或数位范围。请增加数位，或先调整数。",
  groupsError: "该摆放会产生过多独立组，请使用按数位分组；长条长度保持不变。",
  legacyNote: "这是已保存的三位十进制旧版本。新建数位积木场景可选择其它进制与更多数位。",
  axisSnap: "视角吸附", enableAxisSnap: "开启视角吸附", disableAxisSnap: "关闭视角吸附",
  views: { angle: "斜视", front: "正面", left: "左侧", right: "右侧", top: "上面" },
};
const en: typeof zh = {
  title: "Place-value blocks", tools: "Place-value tools", settings: "Structure and display", prepare: "Prepare number and groups", compare: "Compare numbers", inspect: "Inspect a counting unit",
  presentation: "Presentation strategy", rods: "Rod regrouping", boxes: "Box mapping", inside: "Return inside", outside: "Take out", both: "Show both",
  boxOverflow: (count: number) => count + " over",
  boxActions: "Selected box actions", takeOut: "Take out", putBack: "Return", compareContents: "Compare",
  boxHint: "Click Carry once to lay down or stack, then pack directly into the next-place box as the digits change. Select a box for nearby Take out, Return and Compare actions. Full inspection settings remain on the side.",
  mappingHint: "Select one box to take out its contents, leaving that box empty and the others packed. Return inside or Show both changes the representation, not the quantity. Selecting another box first returns the previous one. Contents are compressed inside the box and return to their original unit dimensions outside.",
  boxColors: "Each box has one whole front face; colors alternate every five boxes. Top and side grids retain its composition. A complete solid becomes a new small unit instead of a tall rear tower.",
  boxGroupHint: "Select one box, then take out its contents or show both. Orbiting changes the view, not the packing state.",
  strategyLegacy: "Saved legacy scenes keep their original presentation. Create a new place-value scene to use box mapping.",
  single: "One number", left: "Left", right: "Right", close: "Close", orbit: "Orbit camera", pan: "Pan camera", fit: "Fit view", reset: "Restore starting scene",
  undo: "Undo", redo: "Redo", add: "Add one unit", remove: "Take away one unit", carry: "Regroup ten", carryOne: "Ten ones make one ten", carryTen: "Ten tens make one hundred",
  unpack: "Unpack a counting unit", unpackTen: "One ten becomes ten ones", unpackHundred: "One hundred becomes ten tens",
  pause: "Pause process", resume: "Resume process", step: "Step forward", progress: "Process progress", autoCarry: "Automatically carry a full group",
  speed: "Animation speed", slow: "Slow", normal: "Normal", fast: "Fast", showDigits: "Show place-value digits", showLabels: "Show place labels", grid: "Reference grid", axes: "Axes",
  total: "Total", notation: "Written number", ones: "Ones", tens: "Tens", hundreds: "Hundreds", pending: "Ready to regroup",
  pendingOnes: (count: number) => count + " ones · Ready to regroup", pendingTens: (count: number) => count + " tens · Ready to regroup",
  needUnpack: "Unpack a ten before taking away a unit.", limit: "This tool supports 0–999.", failed: "This change was not saved. Please try again.",
  normalGrouping: "Place-value groups", allOnes: "Individual ones", allTens: "Group into tens", apply: "Arrange", clear: "Clear current number", value: "Set number",
  comparison: "Comparison symbol", hidden: "Hidden", all: "All", groupHint: "Select a block to inspect its counting unit, true length and composition.",
  units: "ones", group: "Units in selection", moving: "Demonstrating", paused: "Paused",
  editPlace: (place: string) => "Edit " + place + " digit", addAt: (place: string) => "Add one " + place + " unit", removeAt: (place: string) => "Remove one " + place + " unit",
  toTens: "Carry to tens", toHundreds: "Carry to hundreds", depth: (value: number) => value + " units long",
  carryLabel: "Carry", pauseLabel: "Pause", resumeLabel: "Resume",
  orientation: "Colors repeat in groups of five yellow and five blue. Reverse rod placement every five groups. Units retain their colors when regrouped; the selected base determines when to carry.",
  fullHint: "Rods keep their true unit lengths. Large numbers use continuous rods with procedural unit grids. Subpixel lines fade at a distance and reappear when zoomed in. Both numbers use the same scale.",
  radix: "Base", places: "Number of places", baseNote: "Place weights are powers of the base. Hexadecimal uses A–F for ten through fifteen. Enter numbers in the selected base.",
  capacityError: "The current number does not fit this base or place count. Add places or adjust the number first.",
  groupsError: "This arrangement needs too many separate groups. Use place-value grouping; rod lengths remain unchanged.",
  legacyNote: "This saved legacy scene uses three decimal places. Create a new place-value scene to select other bases or more places.",
  axisSnap: "Camera snap", enableAxisSnap: "Enable camera snap", disableAxisSnap: "Disable camera snap",
  views: { angle: "Angle", front: "Front", left: "Left", right: "Right", top: "Top" },
};
export function placeValueMessages(locale: "zh" | "en") { return locale === "en" ? en : zh; }
const superscripts = ["⁰", "¹", "²", "³", "⁴", "⁵"];
export function placeValueLabel(locale: "zh" | "en", level: number, radix: number) {
  return radix === 10 ? (locale === "zh" ? ["个位", "十位", "百位", "千位", "万位", "十万位"] : ["Ones", "Tens", "Hundreds", "Thousands", "Ten thousands", "Hundred thousands"])[level]
    : radix + superscripts[level];
}
export function placeValueCarryLabel(locale: "zh" | "en", level: number, radix: number, unpack = false) {
  const m = placeValueMessages(locale);
  if (radix === 10 && level < 2) return level === 0 ? unpack ? m.unpackTen : m.carryOne : unpack ? m.unpackHundred : m.carryTen;
  const lower = radix + " × " + placeValueLabel(locale, level, radix), upper = "1 × " + placeValueLabel(locale, level + 1, radix);
  return unpack ? upper + " → " + lower : lower + " → " + upper;
}
