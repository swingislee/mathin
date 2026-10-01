export type AssessmentTimeDefinition = { key: string; label: string };

/** 测评沿用业务时区，时间 token 不随手机所在时区改变。 */
export function assessmentDay(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function shiftDay(day: string, offset: number) {
  const value = new Date(day + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
export function assessmentWeek(day: string) {
  const value = new Date(day + "T12:00:00Z");
  return shiftDay(day, -((value.getUTCDay() + 6) % 7));
}
export function assessmentTimeLabel(token: string, afterSchool: string) {
  const [day, key] = token.split("@");
  return day.replace(/-/g, ".") + " " + (key === "after_school" ? afterSchool : key);
}
export function futureAssessmentOption(token: string, now = Date.now()) {
  const [day, key] = token.split("@");
  if (key === "after_school") return day >= assessmentDay(now);
  const time = Date.parse(day + "T" + key + ":00+08:00");
  return Number.isFinite(time) && time > now;
}
export function assessmentGrid(options: {
  week: string; firstDay: string; lastDay: string; weekdays: string[];
  definitions: AssessmentTimeDefinition[]; selected: string[]; now?: number;
}) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDay(options.week, index);
    return { date, label: Number(date.slice(5, 7)) + "." + Number(date.slice(8)), weekday: options.weekdays[index] };
  });
  const timeRows = options.definitions.map(definition => ({ ...definition, cells: days.map(day => {
    const value = day.date + "@" + definition.key;
    return { value, selected: options.selected.includes(value),
      selectable: day.date >= options.firstDay && day.date <= options.lastDay && futureAssessmentOption(value, options.now) };
  }) }));
  return { days, timeRows, weekLabel: days[0].label + " ~ " + days[6].label,
    canPrevious: options.week > assessmentWeek(options.firstDay), canNext: days[6].date < options.lastDay };
}
