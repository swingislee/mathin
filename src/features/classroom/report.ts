import type { ClassroomMember, QuizReport, SessionEvent, SessionReport, SessionReportRow } from "./types";

// 课堂报告聚合（08-§6 P4-7）：纯函数，输入 session_events + 教室学生名录。
// 星数走 star/star_undo 净值（原子撤销语义，08-§3.5）；quiz 用 session_ctl
// 的 quiz_open 建记录、answer 事件按 quizId 归入——事件已按 at 升序，
// 同一 quizId 只会开一次（发题前端每次生成新 uuid），故直接用 map 取最新即可。
export function buildSessionReport(members: ClassroomMember[], events: SessionEvent[]): SessionReport {
  const students = members.filter((member) => member.role === "student");
  const stars = new Map<string, number>();
  const handRaises = new Map<string, number>();
  const quizzes = new Map<string, { options: number; openedAt: string; answers: Map<string, number> }>();

  for (const ev of events) {
    if (ev.type === "star") {
      const studentId = String(ev.payload.studentId ?? "");
      if (studentId) stars.set(studentId, (stars.get(studentId) ?? 0) + 1);
    } else if (ev.type === "star_undo") {
      const studentId = String(ev.payload.studentId ?? "");
      if (studentId) stars.set(studentId, Math.max(0, (stars.get(studentId) ?? 0) - 1));
    } else if (ev.type === "hand") {
      if (ev.payload.up === true) handRaises.set(ev.userId, (handRaises.get(ev.userId) ?? 0) + 1);
    } else if (ev.type === "session_ctl" && ev.payload.action === "quiz_open") {
      const quizId = String(ev.payload.quizId ?? "");
      const options = Number(ev.payload.options);
      if (quizId && Number.isFinite(options)) {
        quizzes.set(quizId, { options: Math.max(2, Math.min(4, options)), openedAt: ev.at, answers: new Map() });
      }
    } else if (ev.type === "answer") {
      const quizId = String(ev.payload.quizId ?? "");
      const choice = Number(ev.payload.choice);
      const quiz = quizzes.get(quizId);
      if (quiz && Number.isFinite(choice)) quiz.answers.set(ev.userId, choice);
    }
  }

  const rows: SessionReportRow[] = students.map((student) => {
    let answeredCount = 0;
    for (const quiz of quizzes.values()) if (quiz.answers.has(student.userId)) answeredCount += 1;
    return {
      userId: student.userId,
      displayName: student.displayName,
      stars: stars.get(student.userId) ?? 0,
      handRaises: handRaises.get(student.userId) ?? 0,
      answeredCount,
    };
  });

  const quizReports: QuizReport[] = [...quizzes.entries()]
    .sort((a, b) => a[1].openedAt.localeCompare(b[1].openedAt))
    .map(([quizId, quiz]) => {
      const tally = new Array<number>(quiz.options).fill(0);
      for (const choice of quiz.answers.values()) if (choice >= 0 && choice < tally.length) tally[choice] += 1;
      return { quizId, options: quiz.options, openedAt: quiz.openedAt, tally, respondents: quiz.answers.size };
    });

  return { rows, quizzes: quizReports };
}
