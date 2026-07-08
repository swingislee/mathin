import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { SectionShell } from "@/components/section-shell";
import { getAssignment, getClassroom, getMySubmission, listSubmissions } from "@/features/classroom/actions";
import { SubmissionForm } from "@/features/classroom/assignments/SubmissionForm";
import { SubmissionsRoster } from "@/features/classroom/assignments/SubmissionsRoster";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string; assignmentId: string }>;
}) {
  const { locale, classId, assignmentId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  if (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(assignmentId)) notFound();

  const [t, classroom, assignment] = await Promise.all([
    getTranslations("classroom.assignments"),
    getClassroom(classId),
    getAssignment(assignmentId),
  ]);
  if (!classroom || !assignment || assignment.classroomId !== classId) notFound();
  const isTeacher = classroom.myRole === "teacher";
  const submissions = isTeacher ? await listSubmissions(assignmentId) : null;
  const mine = isTeacher ? null : await getMySubmission(assignmentId);

  return (
    <SectionShell section="classroom" wide>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/classroom/${classId}`}
          aria-label={t("back")}
          className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-2xl md:text-3xl">{assignment.title || t("untitled")}</h2>
          <p className="mt-1 text-xs text-muted">
            {assignment.dueAt
              ? t("due", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(assignment.dueAt)) })
              : t("noDue")}
          </p>
        </div>
      </div>

      {assignment.content.text && (
        <p className="mt-6 whitespace-pre-wrap rounded-2xl border border-line bg-moon/10 p-5 text-sm">
          {assignment.content.text}
        </p>
      )}

      <div className="mt-8">
        {isTeacher && submissions ? (
          <SubmissionsRoster rows={submissions} />
        ) : (
          <SubmissionForm assignmentId={assignmentId} mine={mine} />
        )}
      </div>
    </SectionShell>
  );
}
