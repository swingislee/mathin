import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BookOpen, ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SectionShell } from "@/components/section-shell";
import { CreateAssignmentButton, DeleteAssignmentButton } from "@/features/classroom/assignments/AssignmentActions";
import { getClassroom, listAssignments, listClassSessions } from "@/features/classroom/actions";
import { CopyInviteButton, LeaveClassroomButton, RemoveMemberButton } from "@/features/classroom/HomeActions";
import { CreateSessionButton } from "@/features/classroom/SessionActions";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClassroomHomePage({ params }: { params: Promise<{ locale: string; classId: string }> }) {
  const { locale, classId } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!UUID_PATTERN.test(classId)) notFound();
  const [t, tSessions, tAssignments, tReport, classroom] = await Promise.all([
    getTranslations("classroom.home"),
    getTranslations("classroom.sessions"),
    getTranslations("classroom.assignments"),
    getTranslations("classroom.report"),
    getClassroom(classId),
  ]);
  if (!classroom) notFound();
  const [sessions, assignments] = await Promise.all([
    listClassSessions(classId),
    listAssignments(classId),
  ]);
  const isTeacher = classroom.myRole === "teacher";
  const isOwner = classroom.ownerId === user.id;

  return (
    <SectionShell section="classroom" wide>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="font-display text-2xl md:text-3xl">{classroom.name || t("untitled")}</h2>
        {!isOwner && <LeaveClassroomButton classroomId={classroom.id} />}
      </div>

      {isTeacher && classroom.inviteCode && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-moon/15 px-5 py-4">
          <div>
            <p className="text-xs text-muted">{t("invite")}</p>
            <p className="mt-1 font-mono text-xl tracking-widest">{classroom.inviteCode}</p>
          </div>
          <CopyInviteButton code={classroom.inviteCode} />
          <p className="w-full text-xs text-muted sm:ml-auto sm:w-auto">{t("inviteHint")}</p>
        </div>
      )}

      <section className="mt-10">
        <h3 className="text-sm font-medium text-muted">{t("members", { count: classroom.members.length })}</h3>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
          {classroom.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-moon/50 text-sm font-medium">
                {(member.displayName || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{member.displayName || t("anonymous")}</span>
              <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">
                {member.role === "teacher" ? t("teacher") : t("student")}
              </span>
              {isTeacher && member.userId !== classroom.ownerId && member.userId !== user.id && (
                <RemoveMemberButton classroomId={classroom.id} userId={member.userId} name={member.displayName || t("anonymous")} />
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-line p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted">{t("sessionsTitle")}</h3>
            {isTeacher && <CreateSessionButton classroomId={classroom.id} />}
          </div>
          {sessions.length === 0 ? (
            <EmptyState message={tSessions("empty")} />
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {sessions.map((session) => {
                const status = session.endedAt ? "ended" : session.startedAt ? "live" : "notStarted";
                return (
                  <li key={session.id} className="flex items-center gap-3 py-2.5">
                    <BookOpen size={15} className="shrink-0 text-muted" aria-hidden />
                    <Link
                      href={`/classroom/${classroom.id}/session/${session.id}`}
                      className="min-w-0 flex-1 truncate text-sm underline-offset-4 transition-colors hover:underline"
                    >
                      {session.title || tSessions("untitled")}
                    </Link>
                    <span className="shrink-0 text-xs text-muted">{tSessions("pages", { count: session.pageCount })}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                        status === "live" ? "bg-leaf/15 text-leaf-deep" : "bg-line/50 text-muted"
                      }`}
                    >
                      {tSessions(status)}
                    </span>
                    {isTeacher && status === "ended" && (
                      <Link
                        href={`/classroom/${classroom.id}/session/${session.id}/report`}
                        aria-label={tReport("openLink")}
                        title={tReport("openLink")}
                        className="shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                      >
                        <ClipboardList size={14} />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-line p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted">{t("assignmentsTitle")}</h3>
            {isTeacher && <CreateAssignmentButton classroomId={classroom.id} />}
          </div>
          {assignments.length === 0 ? (
            <EmptyState message={tAssignments("empty")} />
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {assignments.map((assignment) => (
                <li key={assignment.id} className="flex items-center gap-3 py-2.5">
                  <ClipboardList size={15} className="shrink-0 text-muted" aria-hidden />
                  <Link
                    href={`/classroom/${classroom.id}/assignment/${assignment.id}`}
                    className="min-w-0 flex-1 truncate text-sm underline-offset-4 transition-colors hover:underline"
                  >
                    {assignment.title || tAssignments("untitled")}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">
                    {assignment.dueAt
                      ? tAssignments("due", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(assignment.dueAt)) })
                      : tAssignments("noDue")}
                  </span>
                  {isTeacher && <DeleteAssignmentButton assignmentId={assignment.id} title={assignment.title || tAssignments("untitled")} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SectionShell>
  );
}
