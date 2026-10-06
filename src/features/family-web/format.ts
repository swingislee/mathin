export function familyDate(value: string, locale: string, withTime = true) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", {
    timeZone: "Asia/Shanghai", month: "short", day: "numeric", weekday: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(new Date(value));
}
export function familyGrade(grade: number | null, locale: string) {
  if (grade === null) return locale === "en" ? "Grade not set" : "年级待确认";
  if (grade === -1) return locale === "en" ? "K2" : "幼中班";
  if (grade === 0) return locale === "en" ? "K3" : "幼大班";
  if (locale === "en") return `Grade ${grade}`;
  return ["", "一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"][grade] || `${grade} 年级`;
}
