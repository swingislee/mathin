import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { SectionShell } from "@/components/section-shell";
import { getClassroom, getClassSession, getSessionReport } from "@/features/classroom/actions";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPTION_LABELS = ["A", "B", "C", "D"];

export default async function SessionReportPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string; sessionId: string }>;
}) {
  const { locale, classId, sessionId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  if (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(sessionId)) notFound();

  const [t, classroom, session] = await Promise.all([
    getTranslations("classroom.report"),
    getClassroom(classId),
    getClassSession(sessionId),
  ]);
  if (!classroom || !session || session.classroomId !== classId) notFound();
  // 仅教师可查看聚合报告（getSessionReport 内也会兜底校验，双保险）
  if (classroom.myRole !== "teacher") notFound();
  const report = await getSessionReport(sessionId);

  return (
    <SectionShell section="classroom" wide>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/classroom/${classId}/session/${sessionId}`}
          aria-label={t("back")}
          className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
        >
          <ArrowLeft size={18} />
        </Link>
        <h2 className="min-w-0 flex-1 truncate font-display text-2xl md:text-3xl">
          {t("title")}
          <span className="ml-3 text-base font-normal text-muted">{session.title}</span>
        </h2>
      </div>

      {report.rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line px-5 py-6 text-sm text-muted">{t("noStudents")}</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-line">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b border-line text-left text-xs text-muted">
                <TableHead className="px-4 py-2.5 font-medium">{t("student")}</TableHead>
                <TableHead className="px-4 py-2.5 font-medium">{t("stars")}</TableHead>
                <TableHead className="px-4 py-2.5 font-medium">{t("hands")}</TableHead>
                <TableHead className="px-4 py-2.5 font-medium">{t("answered")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-line">
              {report.rows.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell className="px-4 py-2.5">{row.displayName || "—"}</TableCell>
                  <TableCell className="px-4 py-2.5 tabular-nums">{row.stars}</TableCell>
                  <TableCell className="px-4 py-2.5 tabular-nums">{row.handRaises}</TableCell>
                  <TableCell className="px-4 py-2.5 tabular-nums">{row.answeredCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <h3 className="mt-10 text-sm font-medium text-muted">{t("quizzesTitle")}</h3>
      {report.quizzes.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("noQuiz")}</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {report.quizzes.map((quiz, index) => {
            const max = Math.max(1, ...quiz.tally);
            return (
              <li key={quiz.quizId} className="rounded-2xl border border-line p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{t("quizTitle", { index: index + 1 })}</span>
                  <span className="text-xs text-muted">{t("respondents", { count: quiz.respondents })}</span>
                </div>
                <div className="mt-3 space-y-1.5">
                  {quiz.tally.map((count, optionIndex) => (
                    <div key={optionIndex} className="flex items-center gap-2 text-xs">
                      <span className="w-4 shrink-0 text-muted">{OPTION_LABELS[optionIndex]}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-moon/30">
                        <div className="h-full rounded-full bg-crater" style={{ width: `${(count / max) * 100}%` }} />
                      </div>
                      <span className="w-6 shrink-0 text-right tabular-nums text-muted">{count}</span>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionShell>
  );
}
