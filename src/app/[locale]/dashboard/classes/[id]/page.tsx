import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ClassroomEditor } from "@/features/school/ClassroomEditor";
import { ConsumeRuleDialog } from "@/features/school/ConsumeRuleDialog";
import { getClassroomDetail, listDeletedSessions } from "@/features/school/classes";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { RosterPanel } from "@/features/school/RosterPanel";
import { SessionListPanel } from "@/features/school/SessionListPanel";
import { SessionRecycleBin } from "@/features/school/SessionRecycleBin";
import { CoursewareTrackSettings } from "@/features/school/CoursewareTrackSettings";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClassDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["class.view.all", "class.view.mine"]);
  if (!UUID_PATTERN.test(id)) notFound();

  const [t, classroom, perms] = await Promise.all([
    getTranslations("school.classes"),
    getClassroomDetail(id),
    getMyPerms(user.id),
  ]);
  if (!classroom) notFound();

  const canManage = perms.has("class.manage");
  const deletedSessions = canManage ? await listDeletedSessions(id) : [];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <SchoolPageHeader
        title={classroom.name}
        backHref="/dashboard/classes"
        backLabel={t("back")}
        breadcrumbs={[{label:t("title"),href:"/dashboard/classes"},{label:classroom.name}]}
        actions={
          <>
            {canManage && <ClassroomEditor classroom={classroom} />}
            {perms.has("finance.account.adjust") && <ConsumeRuleDialog classroomId={classroom.id} />}
            <Link href="/dashboard/classes" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              {t("back")}
            </Link>
            <Link href={`/classroom/${classroom.id}`} className={cn(buttonVariants({ size: "sm" }))}>
              {t("openClassroom")}
            </Link>
          </>
        }
      >
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>
            {classroom.courseTitle ?? t("freeClass")}
            {classroom.grade ? ` · ${t("grade", { grade: classroom.grade })}` : ""}
            {classroom.room ? ` · ${classroom.room}` : ""}
          </span>
          <span className="rounded-full bg-line/60 px-3 py-1 text-xs text-muted">
            {classroom.archivedAt ? t("archived") : t("active")}
          </span>
        </div>
      </SchoolPageHeader>

      <div className="mt-6 grid gap-6">
        <RosterPanel classroomId={classroom.id} roster={classroom.roster} canManage={perms.has("enrollment.manage")} />
        {canManage && classroom.courseId ? <CoursewareTrackSettings classroomId={classroom.id} track={classroom.coursewareTrack} /> : null}
        <SessionListPanel
          classroomId={classroom.id}
          sessions={classroom.sessions}
          canMarkAttendance={perms.has("attendance.mark")}
          canManage={canManage}
          canReview={perms.has("review.write")}
          classroomCoursewareTrack={classroom.coursewareTrack}
        />
        {canManage && <SessionRecycleBin sessions={deletedSessions} />}
      </div>
    </div>
  );
}
