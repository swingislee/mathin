import { buildStarLedger, starCountForRosterEntry } from "./stars";
import type { QuizReport, SessionEvent, SessionReport, SessionReportRow, SessionRosterEntry } from "./types";

// 课堂报告聚合（08-§6 P4-7）：纯函数，输入 session_events + 冻结课次名单。
// 星数双读 legacy 净值与 v2 award/revoke set；quiz 用 session_ctl
// 的 quiz_open 建记录、answer 事件按 quizId 归入——事件已按 at 升序，
// 同一 quizId 只会开一次（发题前端每次生成新 uuid），故直接用 map 取最新即可。
export function buildSessionReport(roster: SessionRosterEntry[], events: SessionEvent[]): SessionReport {
  const starLedger = buildStarLedger(events);
  const handRaises = new Map<string, number>();
  const quizzes = new Map<string, { options: number; openedAt: string; answers: Map<string, number> }>();

  for (const ev of events) {
    if (ev.type === "hand") {
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

  const hasHandEvents = events.some((event) => event.type === "hand");
  const hasQuizEvents = quizzes.size > 0;

  const rows: SessionReportRow[] = roster.map((student) => {
    let answeredCount = 0;
    if (student.userId) {
      for (const quiz of quizzes.values()) if (quiz.answers.has(student.userId)) answeredCount += 1;
    }
    return {
      userId: student.userId,
      studentId: student.studentId,
      displayName: student.name,
      attendanceStatus: null,
      stars: starCountForRosterEntry(starLedger, student),
      handRaises: hasHandEvents && student.userId ? handRaises.get(student.userId) ?? 0 : null,
      answeredCount: hasQuizEvents && student.userId ? answeredCount : null,
    };
  });

  const quizReports: QuizReport[] = [...quizzes.entries()]
    .sort((a, b) => a[1].openedAt.localeCompare(b[1].openedAt))
    .map(([quizId, quiz]) => {
      const tally = new Array<number>(quiz.options).fill(0);
      for (const choice of quiz.answers.values()) if (choice >= 0 && choice < tally.length) tally[choice] += 1;
      return { quizId, options: quiz.options, openedAt: quiz.openedAt, tally, respondents: quiz.answers.size };
    });

  return { rows, quizzes: quizReports, learningChecks: [] };
}
