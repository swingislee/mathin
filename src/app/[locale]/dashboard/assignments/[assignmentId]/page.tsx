import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SubmissionForm } from "@/features/classroom/assignments/SubmissionForm";
import { getCustomerAssignment } from "@/features/school/customer";
import { DashboardBackLink, DashboardCard, DashboardContentGrid, DashboardMainColumn, DashboardPage } from "@/features/school/dashboard-page";
import { requireDashboardEnvironment } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerAssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; assignmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, assignmentId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["learning", "family"]);
  const rawStudent = Array.isArray(query.student) ? query.student[0] : query.student;
  if (!UUID_PATTERN.test(assignmentId) || !rawStudent || !UUID_PATTERN.test(rawStudent)) notFound();
  const [t, result] = await Promise.all([
    getTranslations("classroom.assignments"),
    getCustomerAssignment(assignmentId, rawStudent),
  ]);
  if (!result.assignment) notFound();
  const assignment = result.assignment;

  return (
    <DashboardPage
      title={assignment.title || t("untitled")}
      description={`${assignment.studentName} · ${assignment.classroomName}`}
    >
      <DashboardContentGrid>
        <DashboardMainColumn className="space-y-5">
          <DashboardBackLink href="/dashboard/assignments" label={t("backToAssignments")} />
          {assignment.content.text && (
            <DashboardCard>
              <p className="whitespace-pre-wrap text-sm">{assignment.content.text}</p>
              <p className="mt-3 text-xs text-muted">
                {assignment.dueAt ? t("due", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(assignment.dueAt)) }) : t("noDue")}
              </p>
            </DashboardCard>
          )}
          <SubmissionForm assignmentId={assignment.assignmentId} studentId={assignment.studentId} mine={result.submission} />
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
