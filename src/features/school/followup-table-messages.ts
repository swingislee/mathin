const zh = {
  arrangementDate: "安排日期", recordedAt: "记录发生时间", lastContact: "最近联系", nextContact: "下次联系",
  contactOutcome: "联系结果", invitationState: "邀约状态", weekday: "星期", startTime: "开始时间（HH:mm）", endTime: "结束时间（HH:mm）",
  timeHint: "按当天分钟数筛选，例如 9:30 为 570。", sourceText: "原文检索", student: "学生姓名", phone: "手机号",
  grade: "年级", owner: "学服老师", teacher: "老师", targetTerm: "目标学期", course: "课程", note: "备注",
  amount: "实付金额", paidOn: "缴费日期", periods: "期数", contactMethod: "沟通方式", state: "工作状态", arrangement: "安排类型",
} as const;
const en: Record<keyof typeof zh, string> = {
  arrangementDate: "Arrangement date", recordedAt: "Record occurrence", lastContact: "Last contact", nextContact: "Next contact",
  contactOutcome: "Contact result", invitationState: "Invitation status", weekday: "Weekday", startTime: "Start time (HH:mm)", endTime: "End time (HH:mm)",
  timeHint: "Minutes since midnight, e.g. 570 for 9:30.", sourceText: "Search original text", student: "Student name", phone: "Phone",
  grade: "Grade", owner: "Support teacher", teacher: "Teacher", targetTerm: "Target term", course: "Course", note: "Notes",
  amount: "Amount paid", paidOn: "Payment date", periods: "Periods", contactMethod: "Contact method", state: "Work status", arrangement: "Arrangement type",
};
export const followupTableMessages = (locale: string) => locale.startsWith("zh") ? zh : en;
