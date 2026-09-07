const zh = {
  menu: "筛选与排序", search: "检索", choices: "检索选项", all: "不限", present: "有值", missing: "未填写",
  ascending: "升序", descending: "降序", clearField: "清除此字段条件", clearColumn: "清除此列", clearAll: "清除全部条件",
  min: "最小值", max: "最大值", from: "开始日期", to: "结束日期", apply: "应用范围", rangeInvalid: "请填写有效范围，起点不大于终点。",
  year: "年", month: "月", week: "周", day: "日", noOptions: "当前范围没有可选值", fields: "选择字段",
  combine: "字段之间同时满足；同一字段多选满足任一项。", sortHint: "当前仅按一个字段排序。",
  scope: "已加载的权限内记录", migrated: "筛选已升级，无法对应到新字段的旧条件已清除。",
  score: "同卷分数", scoreRate: "得分率（%）", scoreScope: "先选一个试卷版本，再筛选或排列同卷分数。仅比较评分口径已确认的正式成绩。",
  rateHint: "仅计算有可靠满分的正式成绩；得分率不代表跨卷能力等级。", scoreMaxMissing: "满分未记录",
  scoreInvalid: "分数超出已记录满分，待核对", scoreSource: "结果来源", paperVersion: "试卷版本",
  recordedAt: "记录时间", recordedHint: "当前记录取最近更新时间；来源资料取实际发生日期。", recordedResult: "其他已记录结果",
  scheduledAt: "安排／发生日期", unknownPaper: "试卷版本未记录", progress: "答题进度（%）", progressHint: "已答题数占总题数，独立于成绩。",
} as const;

const en: Record<keyof typeof zh, string> = {
  menu: "Filter and sort", search: "Search", choices: "Search options", all: "Any", present: "Has value", missing: "Not recorded",
  ascending: "Ascending", descending: "Descending", clearField: "Clear field filter", clearColumn: "Clear this column", clearAll: "Clear all conditions",
  min: "Minimum", max: "Maximum", from: "Start date", to: "End date", apply: "Apply range", rangeInvalid: "Enter a valid range with the start no greater than the end.",
  year: "Year", month: "Month", week: "Week", day: "Day", noOptions: "No options in this scope", fields: "Choose a field",
  combine: "Match every field; match any selected value within a field.", sortHint: "Sort by one field at a time.",
  scope: "Loaded records within your access", migrated: "Filters updated. Old conditions without an exact field match were cleared.",
  score: "Same-paper score", scoreRate: "Score rate (%)", scoreScope: "Choose one paper version to filter or sort comparable final scores with a confirmed scale.",
  rateHint: "Final scores with a reliable maximum only. This is not a cross-paper ability ranking.", scoreMaxMissing: "Maximum not recorded",
  scoreInvalid: "Score exceeds the recorded maximum; review needed", scoreSource: "Result source", paperVersion: "Paper version",
  recordedAt: "Record date", recordedHint: "Latest update for current records; actual occurrence date for source records.", recordedResult: "Other recorded result",
  scheduledAt: "Scheduled / occurrence date", unknownPaper: "Paper version not recorded", progress: "Answered (%)", progressHint: "Answered questions out of all questions; separate from the score.",
};

export function dashboardFieldMessages(locale: string): Record<keyof typeof zh, string> {
  return locale.startsWith("zh") ? zh : en;
}
