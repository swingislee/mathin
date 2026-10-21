import type { RuntimeDay, RuntimeItem, RuntimeLocale, RuntimeSource } from "../../../../contracts/participant-api/runtime";
import type { DisplayData } from "./display";

/** Clearly labelled example records for staff previews; no family data is read for the signed-in preview. */
export const sampleParticipants = [
  { id: "00000000-0000-4000-8000-00000000000a", name: "示例孩子 A", stage: 3 },
  { id: "00000000-0000-4000-8000-00000000000b", name: "示例孩子 B", stage: 5 },
];
const item = (value: Partial<RuntimeItem> & Pick<RuntimeItem, "id" | "title">): RuntimeItem => ({
  subtitle: "", summary: "", meta: [], tags: [], image: "", status: null, actionLabel: "", action: null, date: "", start: "", end: "", phase: "", ...value,
});

export function sampleItems(source: RuntimeSource, locale: RuntimeLocale): RuntimeItem[] {
  const zh = locale === "zh";
  if (source === "rewards.ledger") return [item({ id: "sample-points", title: zh ? "课堂星星（示例）" : "Classroom star (example)", subtitle: "2026.10.21 10:00", status: { label: "+1", tone: "positive" }, meta: [zh ? "变动后余额 12" : "Balance after: 12"] })];
  if (["rewards.draws", "rewards.drawDetail"].includes(source)) return [item({ id: "sample-draw", title: zh ? "学习奖池（示例）" : "Learning pool (example)", summary: zh ? "每次 10 积分；展示每件奖品的概率、次数和保底规则。" : "10 points per draw; displays all prize probabilities, limits and guarantees." })];
  if (["learning.mistakes", "learning.mistakeDetail"].includes(source)) return [item({ id: "sample-mistake", title: zh ? "习题记录（示例）" : "Question record (example)", summary: zh ? "按老师登记的六档学情与后台规则收录。" : "Included from teachers’ learning records using configured statuses.", status: { label: zh ? "提示完成" : "With prompts", tone: "neutral" } })];
  if (source === "rewards.rules") return [item({ id: "sample-points-rules", title: zh ? "积分规则（示例）" : "Points rules (example)", summary: zh ? "规则保存后适用于后续奖励。历史流水保留原值。" : "Rules apply to future rewards. History keeps original amounts." })];
  if (["rewards.catalog", "rewards.collection", "rewards.orders"].includes(source)) return [item({ id: "sample-prize", title: zh ? "思考之星（示例）" : "Thinking star (example)", image: "asset:icons/complete", summary: zh ? "数字收藏" : "Digital collectible", meta: [zh ? "10 积分" : "10 points"] })];
  if (source === "account.tasks") return [
    item({ id: "sample-task-1", title: zh ? "第 3 讲 课后练习（示例）" : "Lesson 3 practice (example)", subtitle: zh ? "截止 10.20 20:00" : "Due 10.20 20:00",
      meta: [sampleParticipants[0].name], status: { label: zh ? "待提交" : "To submit", tone: "warning" }, action: { type: "route", route: "records" } }),
    item({ id: "sample-task-2", title: zh ? "第 2 讲 课后练习（示例）" : "Lesson 2 practice (example)", subtitle: zh ? "截止 10.13 20:00" : "Due 10.13 20:00",
      meta: [sampleParticipants[0].name], status: { label: zh ? "已提交" : "Submitted", tone: "neutral" }, action: { type: "route", route: "records" } }),
  ];
  if (source === "account.reports") return [
    item({ id: "sample-report", title: zh ? "学习诊断报告（示例）" : "Assessment report (example)", subtitle: "2026.10.08",
      summary: zh ? "推理与表达都有亮点，下一步可以多做图形拆分练习。" : "Strong reasoning; try more shape decomposition next.", meta: [sampleParticipants[0].name],
      action: { type: "route", route: "reflections" } }),
  ];
  if (source === "account.bookings") return [
    item({ id: "sample-booking", title: zh ? "周末数学游园会（示例）" : "Weekend maths fair (example)", subtitle: "2026.10.18 09:30", meta: [sampleParticipants[0].name, zh ? "滨湖校区" : "Lakeside campus"],
      status: { label: zh ? "待参与" : "Upcoming", tone: "positive" }, action: { type: "route", route: "reservations" } }),
  ];
  return [];
}

export function sampleWeek(days: RuntimeDay[], locale: RuntimeLocale): { days: RuntimeDay[]; items: RuntimeItem[] } {
  const zh = locale === "zh";
  const pick = [days[1], days[3], days[5]].filter(Boolean);
  const items = pick.map((day, index) => item({ id: "sample-session-" + index, title: zh ? `第 ${index + 3} 讲 · 图形与推理（示例）` : `Lesson ${index + 3} · Shapes (example)`,
    meta: [zh ? "三年级秋季班 | 示例老师" : "Grade 3 autumn | Example teacher"], date: day.date, start: index === 2 ? "09:00" : "18:30", end: index === 2 ? "10:30" : "20:00",
    phase: "upcoming", status: { label: zh ? "未开始" : "Upcoming", tone: "neutral" } }));
  return { days: days.map(day => ({ ...day, count: items.filter(row => row.date === day.date).length })), items };
}

/** Example content for display blocks bound to personal data. */
export function sampleDisplay(source: string, locale: RuntimeLocale): DisplayData {
  const zh = locale === "zh";
  switch (source) {
    case "rewards.balance": return { metrics: [{ label: zh ? "可用积分（示例）" : "Available points (example)", value: "12", unit: "", hint: "" }] };
    case "account.participant": return { card: { title: sampleParticipants[0].name, subtitle: zh ? "三年级" : "Grade 3", fields: [
      { label: zh ? "下次上课" : "Next class", value: "10.18 18:30" }, { label: zh ? "星星" : "Stars", value: "36" }] } };
    case "account.summary": return { metrics: [
      { label: zh ? "星星" : "Stars", value: "36", unit: "", hint: "" }, { label: zh ? "本周课次" : "This week", value: "2", unit: zh ? "次" : "", hint: "" },
      { label: zh ? "待完成任务" : "To do", value: "1", unit: zh ? "项" : "", hint: "" }, { label: zh ? "近 30 天出勤" : "Attendance", value: "96", unit: "%", hint: "" }] };
    case "account.checkins": return { progress: [
      { label: zh ? "本周打卡" : "This week", value: 4, max: 7, caption: zh ? "4 / 7 天" : "4 / 7 days" },
      { label: zh ? "近 30 天打卡" : "30 days", value: 18, max: 30, caption: zh ? "18 天" : "18 days" }] };
    default: return {};
  }
}
