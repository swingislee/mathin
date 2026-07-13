import { getTranslations, setRequestLocale } from "next-intl/server";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getMyPendingAssignments, getMyStudents } from "@/features/school/customer";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { VideoUploadPanel } from "@/features/school/VideoUploadPanel";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function AssignmentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  const t = await getTranslations("school.customer");

  const myStudents = await safe(getMyStudents, []);
  const isBound = myStudents.length > 0;
  const assignments = isBound ? await safe(getMyPendingAssignments, []) : [];

  return (
    <div className="mx-auto w-full max-w-4xl">
      <SchoolPageHeader title={t("pendingAssignmentsTitle")} />

      {!isBound ? (
        <section className="mt-6 rounded-2xl border bg-card p-5">
          <p className="text-sm text-muted">{t("notBound")}</p>
          <div className="mt-4">
            <BindCodeForm mode="claim" />
          </div>
        </section>
      ) : assignments.length === 0 ? (
        <p className="mt-6 rounded-2xl border bg-card p-5 text-sm text-muted">{t("pendingAssignmentsEmpty")}</p>
      ) : (
        <ul className="mt-6 divide-y rounded-2xl border bg-card px-5">
          {assignments.map((assignment) => (
            <li key={assignment.assignmentId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{assignment.title}</span>
              <span className="shrink-0 text-xs text-muted">{assignment.classroomName}</span>
              {assignment.dueAt && (
                <time className="shrink-0 text-xs text-rose">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(assignment.dueAt))}
                </time>
              )}
              <Link href={`/classroom/${assignment.classroomId}`} className="shrink-0 text-xs text-crater underline underline-offset-2">
                {t("goSubmit")}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {isBound && <VideoUploadPanel />}
    </div>
  );
}
