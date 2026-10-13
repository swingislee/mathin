import type { RuntimeDay, RuntimeItem, RuntimeLocale, RuntimeSource } from "../../../../contracts/participant-api/runtime";

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
