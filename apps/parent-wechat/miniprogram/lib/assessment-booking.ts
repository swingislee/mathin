import type { AssessmentAvailability, AssessmentTopic } from "./api-types";
import { assessmentDay, shiftDay } from "./assessment-calendar";
import { stageGroups } from "./catalog";
import type { Locale } from "./locale";

export const assessmentTopics: { id: AssessmentTopic; label: { zh: string; en: string } }[] = [
  { id: "math", label: { zh: "数学", en: "Mathematics" } },
  { id: "english", label: { zh: "英语", en: "English" } },
];
export function assessmentFields(locale: Locale, selected: AssessmentTopic[], stageNumber: number | null) {
  const groups = stageGroups.map(group => ({ id: group.id, label: group.label[locale],
    stages: group.stages.map(stage => ({ id: stage.id, stageNumber: stage.stageNumber, label: stage.label[locale] })) }));
  const stages = groups.reduce((all, group) => all.concat(group.stages), [] as typeof groups[0]["stages"]);
  return { stageOptions: groups, stageLabel: stages.find(stage => stage.stageNumber === stageNumber)?.label || "",
    topicLabel: assessmentTopics.filter(topic => selected.includes(topic.id)).map(topic => topic.label[locale]).join(locale === "zh" ? "、" : ", "),
    topicOptions: assessmentTopics.map(topic => ({ id: topic.id, label: topic.label[locale], selected: selected.includes(topic.id) })) };
}
const localTime = (value: string) => new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString();
const shortDay = (date: string) => Number(date.slice(5, 7)) + "." + Number(date.slice(8, 10));
export function bookedTimeLabel(start: string, end: string, weekdays: string[]) {
  const date = localTime(start), endDate = localTime(end);
  return `${date.slice(0, 10).replace(/-/g, ".")} ${weekdays[(new Date(date).getUTCDay() + 6) % 7]} ${date.slice(11, 16)}~${endDate.slice(11, 16)}`;
}
export function publishedAssessmentGrid(options: {
  availability: AssessmentAvailability | null; campusId: string; facilitatorId: string; weekIndex: number;
  selectedSlotId: string; weekdays: string[]; periods: string[]; now?: number;
}) {
  const now = options.now ?? Date.now();
  const firstDay = options.availability?.from || assessmentDay(now);
  const weeks = [0, 1].map(index => ({ index,
    label: shortDay(shiftDay(firstDay, index * 7)) + "~" + shortDay(shiftDay(firstDay, index * 7 + 6)),
    selected: options.weekIndex === index }));
  const week = shiftDay(firstDay, options.weekIndex * 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDay(week, index);
    return { date, label: shortDay(date), weekday: options.weekdays[(new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7] };
  });
  const slots = (options.availability?.slots || []).filter(slot => slot.campusId === options.campusId && slot.facilitatorId === options.facilitatorId)
    .map(slot => ({ ...slot, date: localTime(slot.startsAt).slice(0, 10), start: localTime(slot.startsAt).slice(11, 16), end: localTime(slot.endsAt).slice(11, 16) }));
  const ranges = slots.map(slot => `${slot.start}|${slot.end}`).filter((range, index, all) => all.indexOf(range) === index).sort();
  const timeRows = ranges.map(range => {
    const [start, end] = range.split("|");
    return { key: range, start, end, period: options.periods[Number(start.slice(0, 2)) < 12 ? 0 : Number(start.slice(0, 2)) < 18 ? 1 : 2],
      cells: days.map(day => {
        const slot = slots.find(value => value.date === day.date && value.start === start && value.end === end);
        return { key: day.date + range, id: slot?.id || "", selected: Boolean(slot && options.selectedSlotId === slot.id),
          available: Boolean(slot?.available && Date.parse(slot.startsAt) > now) };
      }) };
  });
  return { weeks, days, timeRows, weekLabel: weeks[options.weekIndex].label };
}
