import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ClassroomSettingsSheet } from "@/features/school/ClassroomSettingsSheet";
import {
  getClassroomDetailForScope,
  getClassroomOperationalEvents,
  getClassroomRosterSignals,
  getClassroomTeachingReadiness,
  groupClassroomSessions,
  listStaffOptions,
  type OperationalEventRow,
  type RosterSignals,
  type TeachingReadinessRow,
} from "@/features/school/classes";
import { OperationalRecordsPanel } from "@/features/school/OperationalRecordsPanel";
import { RosterPanel } from "@/features/school/RosterPanel";
import { SessionGroupList } from "@/features/school/SessionGroupList";
import { SessionManagementDrawer } from "@/features/school/SessionManagementDrawer";
import { ObjectBar } from "@/features/school/stage/ObjectBar";
import { ContextBar } from "@/features/school/stage/ContextBar";
import { ObjectWorkspace } from "@/features/school/stage/ObjectWorkspace";
import { TeachingReadinessPanel } from "@/features/school/TeachingReadinessPanel";
import { listMyWorkItems } from "@/features/school/work-items";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireUser } from "@/lib/auth";

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

  const [t, classroom, perms, allWorkItems] = await Promise.all([
    getTranslations("school.classes"),
    getClassroomDetailForScope(id),
    getMyPerms(user.id),
    listMyWorkItems(),
  ]);
  if (!classroom) notFound();

  const isManagementView = classroom.capabilities.canManageClassroom;
  const isTeachingView = classroom.capabilities.canPrepareTeaching;
  const canViewClassroom = classroom.capabilities.canViewClassroom;
  const defaultTab: Tab = isManagementView || isTeachingView ? "sessions" : "students";
  const requestedTab = first(rawSearchParams.tab);
  const activeTab: Tab = TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : defaultTab;

  const requestedSessionId = first(rawSearchParams.session);
  const activeSession = requestedSessionId && UUID_PATTERN.test(requestedSessionId)
    ? classroom.sessions.find((session) => session.id === requestedSessionId) ?? null
    : null;
  const closeHref = `/dashboard/classes/${id}?tab=${activeTab}`;
  const staffOptions = isManagementView ? await listStaffOptions() : [];

  const classroomSessionIds = new Set(classroom.sessions.map((session) => session.id));
  const sessionWorkItems = allWorkItems.filter((item) => item.primaryObjectType === "session" && classroomSessionIds.has(item.primaryObjectId));
  const groups = groupClassroomSessions(classroom.sessions, sessionWorkItems);
  const anomalyCount = groups.needsAttention.length;

  // teachingReadiness 不只是"教学准备" tab 自己用——设置 Sheet 的启用班级风险确认（任何 tab 都可能打开
  // 设置）也依赖它，所以只要是管理视角就加载，不能像 rosterSignals/operationalEvents 那样按 tab 懒加载。
  const [rosterSignals, teachingReadiness, operationalEvents] = await Promise.all([
    activeTab === "students" ? getClassroomRosterSignals(id) : Promise.resolve(new Map<string, RosterSignals>()),
    isManagementView ? getClassroomTeachingReadiness(classroom.coursewareTrack, classroom.sessions) : Promise.resolve([] as TeachingReadinessRow[]),
    activeTab === "records" && canViewClassroom ? getClassroomOperationalEvents(id) : Promise.resolve([] as OperationalEventRow[]),
  ]);

  const contextSummary = [
    classroom.courseTitle ?? t("freeClass"),
    classroom.grade ? t("grade", { grade: classroom.grade }) : null,
    classroom.primaryTeacherName ?? t("noPrimaryTeacher"),
    classroom.learningSupportNames.length > 0 ? `${t("learningSupport")}：${classroom.learningSupportNames.join("、")}` : null,
    t("rosterCount", { count: classroom.roster.length }),
    groups.next?.scheduledAt ? t("nextSessionAt", { time: new Date(groups.next.scheduledAt).toLocaleString() }) : null,
  ].filter(Boolean).join(" · ");

  const primaryAction = isTeachingView && groups.next?.capabilities.canEnterLive
    ? <Link href={`/classroom/${classroom.id}/session/${groups.next.id}`} className={buttonVariants({ size: "sm" })}>{t("openClassroom")}</Link>
    : undefined;

  const lifecycleStatus = (
    <span className="flex shrink-0 items-center gap-1.5">
      <Badge variant={classroom.operationalStatus === "active" ? "secondary" : "outline"}>
        {t(classroom.operationalStatus === "active" ? "operationalActive" : classroom.operationalStatus)}
      </Badge>
      {classroom.archivedAt && <Badge variant="outline">{t("archived")}</Badge>}
      {classroom.trashedAt && <Badge variant="outline">{t("trashed")}</Badge>}
      {classroom.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}
    </span>
  );

  return (
    <>
      <ObjectWorkspace
        objectBar={<ObjectBar
          title={classroom.name}
          backHref="/dashboard/classes"
          backLabel={t("back")}
          context={contextSummary}
          status={lifecycleStatus}
          primaryAction={primaryAction}
          overflowSlot={isManagementView ? <ClassroomSettingsSheet classroom={classroom} staffOptions={staffOptions} teachingReadiness={teachingReadiness} /> : undefined}
        />}
        contextBar={<ContextBar
          tabs={TABS.map((tab) => ({ value: tab, label: t(`tab_${tab}`), href: `/dashboard/classes/${id}?tab=${tab}` }))}
          activeTab={activeTab}
        />}
      >
        {isManagementView && anomalyCount > 0 && (
          <p className="mb-4 flex items-center gap-1.5 rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-sm text-rose">
            <CircleAlert className="size-4" />
            {t("anomalySummary", { count: anomalyCount })}
          </p>
        )}

        <div className="grid gap-6">
          {activeTab === "sessions" && (
            <SessionGroupList classroomId={classroom.id} sessions={classroom.sessions} workItems={sessionWorkItems} />
          )}
          {activeTab === "students" && (
            <RosterPanel
              classroomId={classroom.id}
              roster={classroom.roster}
              canManage={perms.has("enrollment.manage")}
              viewerRole={classroom.viewerRole}
              signals={Object.fromEntries(rosterSignals)}
            />
          )}
          {activeTab === "readiness" && (
            classroom.capabilities.canManageClassroom && classroom.courseId
              ? <TeachingReadinessPanel classroomId={classroom.id} track={classroom.coursewareTrack} readiness={teachingReadiness} />
              : <p className="rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("readinessTabEmpty")}</p>
          )}
          {activeTab === "records" && (
            <OperationalRecordsPanel events={operationalEvents} canView={canViewClassroom} />
          )}
        </div>
      </ObjectWorkspace>

      <SessionManagementDrawer
        key={activeSession?.id ?? "none"}
        session={activeSession}
        classroomName={classroom.name}
        classroomRoom={classroom.room}
        closeHref={closeHref}
      />
    </>
  );
}
