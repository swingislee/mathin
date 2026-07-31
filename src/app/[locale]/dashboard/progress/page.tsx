import { getTranslations, setRequestLocale } from "next-intl/server";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import {
  getMyLearningSummary,
  getMyReviewedVideos,
  getMySessionReviews,
  getMySessionReviewStates,
  getMyStudents,
} from "@/features/school/customer";
import {
  DashboardCard,
  DashboardContentGrid,
  DashboardEmptyCard,
  DashboardMainColumn,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { FamilyLearningResults } from "@/features/school/FamilyLearningResults";
import { addDays } from "@/features/school/schedule";
import { requireDashboardEnvironment } from "@/lib/auth";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function ProgressPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["learning"]);
  const [t, studentsT] = await Promise.all([
    getTranslations("school.customer"),
    getTranslations("school.students"),
  ]);
  const students = await safe(getMyStudents, []);
  const studentId = students[0]?.id ?? null;
  const now = new Date();
  const [summaries, reviews, states, videos] = studentId
    ? await Promise.all([
        safe(getMyLearningSummary, []),
        safe(() => getMySessionReviews(addDays(now, -180).toISOString(), now.toISOString()), []),
        safe(() => getMySessionReviewStates(addDays(now, -180).toISOString(), now.toISOString()), []),
        safe(getMyReviewedVideos, []),
      ])
    : [[], [], [], []];
  const summary = summaries.find((row) => row.studentId === studentId) ?? null;
  const submissions = summary?.recentSubmissions ?? [];
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <DashboardPage title={t("progressTitle")} description={t("progressIntro")}>
      <DashboardContentGrid>
        <DashboardMainColumn className="space-y-6">
          {!studentId ? (
            <DashboardCard>
              <p className="text-sm text-muted">{t("notBound")}</p>
              <div className="mt-4"><BindCodeForm mode="claim" /></div>
            </DashboardCard>
          ) : (
            <>
              <DashboardCard title={t("myStarsTitle")}>
                <p className="font-display text-3xl tabular-nums">{summary?.starTotal ?? 0}</p>
                <p className="mt-1 text-xs text-muted">{t("starTotal")}</p>
              </DashboardCard>

              <DashboardCard title={studentsT("submissions")}>
                {submissions.length === 0 ? (
                  <DashboardEmptyCard>{studentsT("noSubmissions")}</DashboardEmptyCard>
                ) : (
                  <ul className="divide-y divide-line">
                    {submissions.map((submission, index) => (
                      <li key={`${submission.title}:${index}`} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium">{submission.title}</span>
                        <span className="shrink-0 tabular-nums">{submission.score ?? studentsT("ungraded")}</span>
                        {submission.gradedAt && <time className="shrink-0 text-xs text-muted">{date.format(new Date(submission.gradedAt))}</time>}
                      </li>
                    ))}
                  </ul>
                )}
              </DashboardCard>

              <div id="learning-results" className="scroll-mt-24">
                <DashboardCard title={studentsT("recentReviews")}>
                  <FamilyLearningResults
                    locale={locale}
                    reviews={reviews.filter((row) => row.studentId === studentId)}
                    states={states.filter((row) => row.studentId === studentId)}
                    videos={videos.filter((row) => row.studentId === studentId)}
                  />
                </DashboardCard>
              </div>
            </>
          )}
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
