import { cache, Suspense } from "react";
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
import { ClassroomSetupWorkspace } from "@/features/school/ClassroomSetupWorkspace";
import type { MofaxiaoClassRosterReviewIssue } from "@/features/school/actions/types";
import { loadClassroomImportSetupContext } from "@/features/school/class-roster-imports";
import {
  getClassroomDetailForScope,
  getClassroomOperationalEvents,
  getClassroomRosterSignals,
  getClassroomTeachingReadiness,
  groupClassroomSessions,
  listStaffOptions,
  type ClassroomDetail,
  type OperationalEventRow,
  type RosterSignals,
  type TeachingReadinessRow,
} from "@/features/school/classes";
import { OperationalRecordsPanel } from "@/features/school/OperationalRecordsPanel";
import { PublicClassSourcePanel } from "@/features/school/PublicClassSourcePanel";
import { listPublicClassesForClassroom } from "@/features/school/public-class";
import { RosterPanel } from "@/features/school/RosterPanel";
import { SessionGroupList } from "@/features/school/SessionGroupList";
import { SessionManagementDrawer } from "@/features/school/SessionManagementDrawer";
import {
  DashboardAside,
  DashboardCommandActions,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardContentGrid,
  DashboardEmptyCard,
  DashboardMainColumn,
} from "@/features/school/dashboard-page";
import {
  ObjectBar,
  ObjectTabs,
  ObjectWorkspace,
  parseReturnTo,
  preserveReturnTo,
  type ObjectContextItem,
} from "@/features/school/object-workspace";
import { TeachingReadinessPanel } from "@/features/school/TeachingReadinessPanel";
import { listMyWorkItems } from "@/features/school/work-items";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";
import {
  getOrganizationTimezoneV2,
  getScheduleDefaultsV2,
  listActiveRoomOptionsV2,
} from "@/features/school/organization-locations";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = ["setup", "sessions", "students", "readiness", "records"] as const;
const ROSTER_REPAIR_ISSUES = ["course", "teacher", "room", "schedule"] as const satisfies readonly MofaxiaoClassRosterReviewIssue[];
type Tab = (typeof TABS)[number];

/** 设置、准备页与课次管理共用本次请求的数据，班级入口先显示核心信息。 */
const readClassroomSettings = cache(async (classroom: ClassroomDetail) => {
  const [staffOptions, teachingReadiness, roomOptions] = await Promise.all([
    listStaffOptions(),
    getClassroomTeachingReadiness(classroom.coursewareTrack, classroom.sessions),
    listActiveRoomOptionsV2(),
  ]);
  return { staffOptions, teachingReadiness, roomOptions };
});

async function classroomWorkItems(classroom: ClassroomDetail) {
  const items = await listMyWorkItems();
  const sessionIds = new Set(classroom.sessions.map((session) => session.id));
  return items.filter((item) => item.primaryObjectType === "session" && sessionIds.has(item.primaryObjectId));
}

async function ClassroomSessionList({ classroom, returnTo, timeZone, duration }: {
  classroom: ClassroomDetail; returnTo: string; timeZone: string; duration: number;
}) {
  return <SessionGroupList
    classroomId={classroom.id}
    sessions={classroom.sessions}
    workItems={await classroomWorkItems(classroom)}
    returnTo={returnTo}
    canAddSession={classroom.courseId === null && classroom.capabilities.canManageSchedule}
    defaultDurationMinutes={duration}
    timeZone={timeZone}
  />;
}

async function ClassroomRiskSummary({ classroom, returnTo }: { classroom: ClassroomDetail; returnTo: string }) {
  const groups = groupClassroomSessions(classroom.sessions, await classroomWorkItems(classroom));
  return <ClassroomRisks needsAttention={groups.needsAttention} returnTo={returnTo} />;
}

async function ClassroomSettings({ classroom, setupHref }: { classroom: ClassroomDetail; setupHref: string }) {
  const settings = await readClassroomSettings(classroom);
  return <ClassroomSettingsSheet classroom={classroom} {...settings} setupHref={setupHref} />;
}

async function ClassroomPublicSources({ classroomId, locale }: { classroomId: string; locale: string }) {
  return <PublicClassSourcePanel activities={await listPublicClassesForClassroom(classroomId)} locale={locale} />;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseRosterRepairIssues(value: string | string[] | undefined): MofaxiaoClassRosterReviewIssue[] {
  const candidate = first(value);
  if (!candidate) return [];
  const allowed = new Set<string>(ROSTER_REPAIR_ISSUES);
  return [...new Set(candidate.split(",").filter((issue): issue is MofaxiaoClassRosterReviewIssue => allowed.has(issue)))];
}

function preserveRosterRepair(href: string, issues: readonly MofaxiaoClassRosterReviewIssue[]): string {
  if (issues.length === 0) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}repair=${encodeURIComponent(issues.join(","))}`;
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
  const [{ classId }, rawSearchParams, { user, environment }] = await Promise.all([params, searchParams, requireDashboardEnvironment(locale, ["staff"])]);
  if (!UUID_PATTERN.test(classId)) notFound();

  const [t, classroom, perms, timeZone, scheduleDefaults] = await Promise.all([
    getTranslations("school.classes"),
    getClassroomDetailForScope(classId),
    getMyPerms(user.id),
    getOrganizationTimezoneV2(),
    getScheduleDefaultsV2(),
  ]);
  if (!classroom) notFound();

  const isManagementView = classroom.capabilities.canManageClassroom;
  const isTeachingView = classroom.capabilities.canPrepareTeaching;
  const canViewClassroom = classroom.capabilities.canViewClassroom;
  // doc24 §6：班级从班级列表、今日工作、课表、课程使用情况、学生档案的"在读班级"
  // 五处进入。tabHref 与抽屉的 closeHref 都必须把来源带上，否则用户切一次 Tab、
  // 或者关一次课次抽屉，返回就悄悄退回班级列表。
  const returnTo = parseReturnTo({ returnTo: rawSearchParams.returnTo, environment });
  const requestedRepairIssues = parseRosterRepairIssues(rawSearchParams.repair);
  const isRosterRepair = requestedRepairIssues.length > 0
    && Boolean(returnTo?.startsWith("/dashboard/classes/import/roster"));
  const repairIssues = isRosterRepair ? requestedRepairIssues : [];
  const visibleTabs: readonly Tab[] = isManagementView ? TABS : TABS.filter((tab) => tab !== "setup");
  const defaultTab: Tab = isManagementView || isTeachingView ? "sessions" : "students";
  const requestedTab = first(rawSearchParams.tab);
  const activeTab: Tab = visibleTabs.includes(requestedTab as Tab) ? (requestedTab as Tab) : defaultTab;

  const requestedSessionId = first(rawSearchParams.session);
  const activeSession = requestedSessionId && UUID_PATTERN.test(requestedSessionId)
    ? classroom.sessions.find((session) => session.id === requestedSessionId) ?? null
    : null;
  const tabHref = (tab: Tab) => preserveReturnTo(
    preserveRosterRepair(`/dashboard/classes/${classId}?tab=${tab}`, repairIssues),
    returnTo,
  );
  const closeHref = tabHref(activeTab);
  const settings = isManagementView && (activeTab === "setup" || activeTab === "readiness" || activeSession)
    ? await readClassroomSettings(classroom)
    : null;
  const staffOptions = settings?.staffOptions ?? [];
  const roomOptions = settings?.roomOptions ?? (activeSession ? await listActiveRoomOptionsV2() : []);
  const teachingReadiness = settings?.teachingReadiness ?? [] as TeachingReadinessRow[];
  const importSetupContext = isManagementView && activeTab === "setup"
    ? await loadClassroomImportSetupContext(classId)
    : null;

  // 下一课由真实课次时间决定；完整工作项仍用于列表分组和风险区，各自独立加载。
  const groups = groupClassroomSessions(classroom.sessions, []);

  const [rosterSignals, operationalEvents] = await Promise.all([
    activeTab === "students" ? getClassroomRosterSignals(classId) : Promise.resolve(new Map<string, RosterSignals>()),
    activeTab === "records" && canViewClassroom ? getClassroomOperationalEvents(classId) : Promise.resolve([] as OperationalEventRow[]),
  ]);

  // doc23 §9：身份行只保留"这是哪个班"——课程版本、年级、主讲、学服。
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
    ? <Link href={`/classroom/${classroom.id}/session/${groups.next.id}/live`} className={buttonVariants({ size: "sm" })}>{t("openClassroom")}</Link>
    : undefined;

  const lifecycleStatus = (
    <span className="flex shrink-0 items-center gap-1.5">
      <Badge variant={classroom.operationalStatus === "active" ? "secondary" : "outline"}>
        {t(classroom.operationalStatus === "active" ? "operationalActive" : classroom.operationalStatus)}
      </Badge>
      <Badge variant="outline">{t(`offering_${classroom.offeringType}`)}</Badge>
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
          backHref={returnTo ?? "/dashboard/classes"}
          backLabel={t(isRosterRepair ? "backToRosterImport" : "back")}
          context={contextItems}
          status={lifecycleStatus}
        />}
        navigation={(
          <DashboardCommandPanel>
            <DashboardCommandState>
              <ObjectTabs
                items={visibleTabs.map((tab) => ({ value: tab, label: t(`tab_${tab}`), href: tabHref(tab) }))}
                activeValue={activeTab}
                ariaLabel={t("tabsLabel")}
              />
            </DashboardCommandState>
            {(primaryAction || isManagementView) ? (
              <DashboardCommandActions>
                {primaryAction}
                {isManagementView ? (
                  <Suspense fallback={<span aria-label={t("settings")} className="size-8 animate-pulse rounded-md bg-muted/10" />}>
                    <ClassroomSettings classroom={classroom} setupHref={tabHref("setup")} />
                  </Suspense>
                ) : null}
              </DashboardCommandActions>
            ) : null}
          </DashboardCommandPanel>
        )}
      >
        {/*
          §9：主栏只放当前 tab 的工作面，侧栏放跨 tab 不变的班级状况。
          原来那条异常横幅横在正文顶部，是"通知"而不是"待办"——切到学生 tab 就消失，
          而它恰恰是管理视角进这一页最想先看到的东西，现在固定在 Aside 的风险区。
        */}
        <DashboardContentGrid>
          <DashboardMainColumn>
            {activeTab === "setup" && isManagementView ? (
              <ClassroomSetupWorkspace
                classroom={classroom}
                staffOptions={staffOptions}
                roomOptions={roomOptions}
                defaultDurationMinutes={scheduleDefaults.defaultDurationMinutes}
                timeZone={timeZone}
                importContext={importSetupContext}
                returnTo={isRosterRepair ? returnTo : null}
              />
            ) : null}
            {activeTab === "sessions" && (
              <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-line bg-card" />}>
                <ClassroomSessionList classroom={classroom} returnTo={tabHref("sessions")} duration={scheduleDefaults.defaultDurationMinutes} timeZone={timeZone} />
              </Suspense>
            )}
            {activeTab === "students" && (
              <RosterPanel
                classroomId={classroom.id}
                roster={classroom.roster}
                canManage={perms.has("enrollment.manage")}
                viewerRole={classroom.viewerRole}
                signals={Object.fromEntries(rosterSignals)}
                returnTo={tabHref("students")}
              />
            )}
            {activeTab === "readiness" && (
              classroom.capabilities.canManageClassroom && classroom.courseId
                ? <TeachingReadinessPanel classroomId={classroom.id} track={classroom.coursewareTrack} readiness={teachingReadiness} />
                : <DashboardEmptyCard>{t("readinessTabEmpty")}</DashboardEmptyCard>
            )}
            {activeTab === "records" && (
              <OperationalRecordsPanel events={operationalEvents} canView={canViewClassroom} />
            )}
          </DashboardMainColumn>

          <DashboardAside>
            <ClassroomSummary classroom={classroom} />
            <ClassroomNextSession next={groups.next} returnTo={tabHref(activeTab)} />
            {isManagementView && (
              <Suspense fallback={<div className="h-20 animate-pulse rounded-lg bg-muted/10" />}>
                <ClassroomRiskSummary classroom={classroom} returnTo={tabHref(activeTab)} />
              </Suspense>
            )}
            <ClassroomResponsibility assignments={classroom.staffAssignments} />
            <Suspense fallback={null}>
              <ClassroomPublicSources classroomId={classId} locale={locale} />
            </Suspense>
          </DashboardAside>
        </DashboardContentGrid>
      </ObjectWorkspace>

      {activeSession ? <SessionManagementDrawer
        key={activeSession?.id ?? "none"}
        session={activeSession}
        classroomName={classroom.name}
        classroomDefaultRoomId={classroom.defaultRoomId}
        roomOptions={roomOptions}
        timeZone={timeZone}
        closeHref={closeHref}
      /> : null}
    </>
  );
}
