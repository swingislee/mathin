import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  ClassroomNextSession,
  ClassroomResponsibility,
  ClassroomRisks,
  ClassroomSummary,
} from "@/features/school/ClassroomAsidePanels";
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
import { DashboardAside, DashboardContentGrid, DashboardMainColumn } from "@/features/school/dashboard-page";
import { ObjectBar, ObjectTabs, ObjectWorkspace, type ObjectContextItem } from "@/features/school/object-workspace";
import { TeachingReadinessPanel } from "@/features/school/TeachingReadinessPanel";
import { listMyWorkItems } from "@/features/school/work-items";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";

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
  params: Promise<{ locale: string; classId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="w-full min-w-0">
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
  params: Promise<{ locale: string; classId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ classId }, rawSearchParams, { user }] = await Promise.all([params, searchParams, requireDashboardEnvironment(locale, ["staff"])]);
  if (!UUID_PATTERN.test(classId)) notFound();

  const [t, classroom, perms, allWorkItems] = await Promise.all([
    getTranslations("school.classes"),
    getClassroomDetailForScope(classId),
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
  const closeHref = `/dashboard/classes/${classId}?tab=${activeTab}`;
  const staffOptions = isManagementView ? await listStaffOptions() : [];

  const classroomSessionIds = new Set(classroom.sessions.map((session) => session.id));
  const sessionWorkItems = allWorkItems.filter((item) => item.primaryObjectType === "session" && classroomSessionIds.has(item.primaryObjectId));
  const groups = groupClassroomSessions(classroom.sessions, sessionWorkItems);

  // teachingReadiness 不只是"教学准备" tab 自己用——设置 Sheet 的启用班级风险确认（任何 tab 都可能打开
  // 设置）也依赖它，所以只要是管理视角就加载，不能像 rosterSignals/operationalEvents 那样按 tab 懒加载。
  const [rosterSignals, teachingReadiness, operationalEvents] = await Promise.all([
    activeTab === "students" ? getClassroomRosterSignals(classId) : Promise.resolve(new Map<string, RosterSignals>()),
    isManagementView ? getClassroomTeachingReadiness(classroom.coursewareTrack, classroom.sessions) : Promise.resolve([] as TeachingReadinessRow[]),
    activeTab === "records" && canViewClassroom ? getClassroomOperationalEvents(classId) : Promise.resolve([] as OperationalEventRow[]),
  ]);

  // doc23 §9：身份行只保留"这是哪个班"——课程版本、年级、主讲、学辅。
  // 人数与下一节课是**状况**不是身份，进 Aside；它们放在这条里既会被截断，
  // 又会随排课变化让身份行看起来一直在动。
  const contextItems: ObjectContextItem[] = ([
    { value: classroom.courseTitle ?? t("freeClass") },
    classroom.grade ? { value: t("grade", { grade: classroom.grade }) } : null,
    { label: t("responsibility_primary_teacher"), value: classroom.primaryTeacherName ?? t("noPrimaryTeacher") },
    classroom.learningSupportNames.length > 0
      ? { label: t("learningSupport"), value: classroom.learningSupportNames.join("、") }
      : null,
  ] satisfies (ObjectContextItem | null)[]).filter((item) => item !== null);

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
          context={contextItems}
          status={lifecycleStatus}
          primaryAction={primaryAction}
          overflowSlot={isManagementView ? <ClassroomSettingsSheet classroom={classroom} staffOptions={staffOptions} teachingReadiness={teachingReadiness} /> : undefined}
        />}
        navigation={<ObjectTabs
          items={TABS.map((tab) => ({ value: tab, label: t(`tab_${tab}`), href: `/dashboard/classes/${classId}?tab=${tab}` }))}
          activeValue={activeTab}
          ariaLabel={t("tabsLabel")}
        />}
      >
        {/*
          §9：主栏只放当前 tab 的工作面，侧栏放跨 tab 不变的班级状况。
          原来那条异常横幅横在正文顶部，是"通知"而不是"待办"——切到学生 tab 就消失，
          而它恰恰是管理视角进这一页最想先看到的东西，现在固定在 Aside 的风险区。
        */}
        <DashboardContentGrid>
          <DashboardMainColumn>
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
          </DashboardMainColumn>

          <DashboardAside className="flex flex-col gap-4">
            <ClassroomSummary classroom={classroom} />
            <ClassroomNextSession next={groups.next} />
            {isManagementView && <ClassroomRisks needsAttention={groups.needsAttention} />}
            <ClassroomResponsibility assignments={classroom.staffAssignments} />
          </DashboardAside>
        </DashboardContentGrid>
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
