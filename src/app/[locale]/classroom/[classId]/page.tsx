import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { SectionShell } from "@/components/section-shell";
import { getClassroom } from "@/features/classroom/actions";
import { CopyInviteButton, LeaveClassroomButton, RemoveMemberButton } from "@/features/classroom/HomeActions";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClassroomHomePage({ params }: { params: Promise<{ locale: string; classId: string }> }) {
  const { locale, classId } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!UUID_PATTERN.test(classId)) notFound();
  const [t, common, classroom] = await Promise.all([
    getTranslations("classroom.home"),
    getTranslations("common"),
    getClassroom(classId),
  ]);
  if (!classroom) notFound();
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
          <h3 className="text-sm font-medium text-muted">{t("sessionsTitle")}</h3>
          <EmptyState message={common("comingSoon")} />
        </section>
        <section className="rounded-2xl border border-line p-5">
          <h3 className="text-sm font-medium text-muted">{t("assignmentsTitle")}</h3>
          <EmptyState message={common("comingSoon")} />
        </section>
      </div>
    </SectionShell>
  );
}
