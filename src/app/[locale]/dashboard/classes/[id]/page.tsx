import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ClassroomEditor } from "@/features/school/ClassroomEditor";
import { ClassroomStaffDialog } from "@/features/school/ClassroomStaffDialog";
import { getClassroomDetailForScope, listStaffOptions } from "@/features/school/classes";
import { ConsumeRuleDialog } from "@/features/school/ConsumeRuleDialog";
import { CoursewareTrackSettings } from "@/features/school/CoursewareTrackSettings";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { RosterPanel } from "@/features/school/RosterPanel";
import { SessionGroupList } from "@/features/school/SessionGroupList";
import { SessionManagementDrawer } from "@/features/school/SessionManagementDrawer";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = ["sessions", "students", "readiness", "records"] as const;
type Tab = (typeof TABS)[number];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
        <ClassDetailBody locale={locale} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ClassDetailBody({
  locale,
  params,
  searchParams,
}: {
  locale: string;
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, rawSearchParams, user] = await Promise.all([params, searchParams, requireUser(locale)]);
  if (!UUID_PATTERN.test(id)) notFound();

  const [t, classroom, perms] = await Promise.all([
    getTranslations("school.classes"),
    getClassroomDetailForScope(id),
    getMyPerms(user.id),
  ]);
  if (!classroom) notFound();

  const isManagementView = classroom.capabilities.canManageClassroom;
  const isTeachingView = classroom.capabilities.canPrepareTeaching;
  const defaultTab: Tab = isManagementView || isTeachingView ? "sessions" : "students";
  const requestedTab = first(rawSearchParams.tab);
  const activeTab: Tab = TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : defaultTab;

  const requestedSessionId = first(rawSearchParams.session);
  const activeSession = requestedSessionId && UUID_PATTERN.test(requestedSessionId)
    ? classroom.sessions.find((session) => session.id === requestedSessionId) ?? null
    : null;
  const closeHref = `/dashboard/classes/${id}?tab=${activeTab}`;
  const staffOptions = isManagementView ? await listStaffOptions() : [];
  const anomalyCount = classroom.sessions.filter((session) => session.state === "scheduled" && session.scheduledAt && new Date(session.scheduledAt) < new Date()).length;

  return (
    <>
      <SchoolPageHeader
        title={classroom.name}
        backHref="/dashboard/classes"
        backLabel={t("back")}
        breadcrumbs={[{ label: t("title"), href: "/dashboard/classes" }, { label: classroom.name }]}
        actions={
          <>
            {classroom.capabilities.canManageClassroom && <ClassroomEditor classroom={classroom} />}
            {classroom.capabilities.canManageClassroom && (
              <ClassroomStaffDialog classroomId={classroom.id} staffAssignments={classroom.staffAssignments} staffOptions={staffOptions} />
            )}
            {perms.has("finance.account.adjust") && <ConsumeRuleDialog classroomId={classroom.id} />}
            <Link href="/dashboard/classes" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("back")}</Link>
            {(isManagementView || isTeachingView) && (
              <Link href={`/classroom/${classroom.id}`} className={cn(buttonVariants({ size: "sm" }))}>{t("openClassroom")}</Link>
            )}
          </>
        }
      >
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>
            {classroom.courseTitle ?? t("freeClass")}
            {classroom.grade ? ` · ${t("grade", { grade: classroom.grade })}` : ""}
            {classroom.room ? ` · ${classroom.room}` : ""}
          </span>
          <Badge variant={classroom.operationalStatus === "active" ? "secondary" : "outline"}>{t(classroom.operationalStatus === "active" ? "operationalActive" : classroom.operationalStatus)}</Badge>
          {classroom.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}
        </div>
      </SchoolPageHeader>

      <nav aria-label={t("tabsLabel")} className="mt-6 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/dashboard/classes/${id}?tab=${tab}`}
            aria-current={tab === activeTab ? "page" : undefined}
            className={cn(buttonVariants({ variant: tab === activeTab ? "primary" : "secondary", size: "sm" }), "h-9")}
          >
            {t(`tab_${tab}`)}
          </Link>
        ))}
      </nav>

      {isManagementView && anomalyCount > 0 && (
        <p className="mt-4 flex items-center gap-1.5 rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-sm text-rose">
          <CircleAlert className="size-4" />
          {t("anomalySummary", { count: anomalyCount })}
        </p>
      )}

      <div className="mt-6 grid gap-6">
        {activeTab === "sessions" && (
          <SessionGroupList classroomId={classroom.id} sessions={classroom.sessions} />
        )}
        {activeTab === "students" && (
          <RosterPanel classroomId={classroom.id} roster={classroom.roster} canManage={perms.has("enrollment.manage")} />
        )}
        {activeTab === "readiness" && (
          classroom.capabilities.canManageClassroom && classroom.courseId
            ? <CoursewareTrackSettings classroomId={classroom.id} track={classroom.coursewareTrack} />
            : <p className="rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("readinessTabEmpty")}</p>
        )}
        {activeTab === "records" && (
          <p className="rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("recordsTabEmpty")}</p>
        )}
      </div>

      <SessionManagementDrawer
        key={activeSession?.id ?? "none"}
        session={activeSession}
        classroomCoursewareTrack={classroom.coursewareTrack}
        closeHref={closeHref}
      />
    </>
  );
}
