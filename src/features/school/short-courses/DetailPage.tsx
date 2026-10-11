import { notFound } from "next/navigation";
import { getNow, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getClassroomDetailForScope, listStaffOptions } from "../classes";
import { getOrganizationTimezoneV2, listActiveRoomOptionsV2 } from "../organization-locations";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage } from "../dashboard-page";
import { RosterPanel } from "../RosterPanel";
import { SessionManagementDrawer } from "../SessionManagementDrawer";
import { parseReturnTo } from "../object-workspace/return-target";
import { getShortCourseMetadata } from "./data";
import { shortCourseHref, SHORT_COURSES_HREF, type ShortCourseListRow } from "./contract";
import { shortCourseMessages } from "./messages";
import { ShortCourseMatrix } from "./ShortCourseMatrix";
import { ShortCourseClassSettings } from "./ClassSettings";

export default async function ShortCourseDetailPage({ params, searchParams }: {
  params: Promise<{ locale: string; classId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, classId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  if (!z.string().uuid().safeParse(classId).success) notFound();
  const { user, environment } = await requireDashboardEnvironment(locale, ["staff"]);
  const [classroom, metadata, permissions, timeZone, now] = await Promise.all([
    getClassroomDetailForScope(classId), getShortCourseMetadata(classId), getMyPerms(user.id), getOrganizationTimezoneV2(), getNow(),
  ]);
  if (!classroom || classroom.offeringType !== "short_term_topic" || !classroom.capabilities.canViewClassroom) notFound();
  const m = shortCourseMessages(locale), href = shortCourseHref(classId);
  const backHref = parseReturnTo({ returnTo: query.returnTo, environment })
    ?? `${SHORT_COURSES_HREF}${metadata ? `?batch=${metadata.batchId}` : ""}`;
  const management = classroom.capabilities.canManageClassroom;
  const managedSession = typeof query.manage === "string" ? classroom.sessions.find(session => session.id === query.manage) ?? null : null;
  const [teachers, rooms] = await Promise.all([
    management ? listStaffOptions() : Promise.resolve([]), management || managedSession ? listActiveRoomOptionsV2() : Promise.resolve([]),
  ]);
  const row: ShortCourseListRow = {
    id: classroom.id, name: classroom.name, capacity: classroom.capacity, status: classroom.operationalStatus,
    batchId: metadata?.batchId ?? null, batchName: metadata?.batchName ?? null, topic: metadata?.topic ?? null,
    level: metadata?.level ?? null, grades: metadata?.grades ?? (classroom.grade ? [classroom.grade] : []),
    plannedStudents: metadata?.plannedStudents ?? null, weeklySlots: metadata?.weeklySlots ?? [], sessionCount: metadata?.sessionCount ?? null,
    teacherName: classroom.primaryTeacherName, enrolledCount: classroom.roster.filter(student => student.status === "active").length,
    sessions: classroom.sessions.map(session => ({ id: session.id, name: session.name, scheduledAt: session.scheduledAt,
      startedAt: session.startedAt, endedAt: session.endedAt, cancelled: session.deletedAt !== null, voided: session.voidedAt !== null }))
      .sort((a, b) => (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999") || a.id.localeCompare(b.id)),
  };
  return <DashboardPage title={classroom.name} backHref={backHref} backLabel={m.back} meta={metadata ? `${metadata.topic} · ${metadata.batchName} · ${m[metadata.level]}` : m.title}
    commandPanel={management ? <DashboardCommandPanel><DashboardCommandActions>
      <Link className={buttonVariants({ size: "sm", variant: "secondary" })} href={`${href}/registration`}>{locale.startsWith("en") ? "Registration requests" : "报名申请"}</Link>
      <ShortCourseClassSettings classroom={classroom} teachers={teachers} rooms={rooms} locale={locale} plannedLessons={metadata?.sessionCount ?? classroom.sessions.length} /></DashboardCommandActions></DashboardCommandPanel> : undefined}>
    <div className="space-y-6"><ShortCourseMatrix rows={[row]} locale={locale} timeZone={timeZone} now={now.getTime()} returnTo={href}
      focusedSessionId={typeof query.lesson === "string" ? query.lesson : undefined} />
      <section className="border-t border-line pt-4">
        <RosterPanel continuous classroomId={classId} roster={classroom.roster} canManage={management && permissions.has("enrollment.manage")}
          viewerRole={classroom.viewerRole} signals={{}} returnTo={href} canWriteFollowup={permissions.has("followup.write") && permissions.has("followup.view")} />
      </section>
    </div>
    {managedSession && <SessionManagementDrawer key={managedSession.id} session={managedSession} classroomName={classroom.name}
      classroomDefaultRoomId={classroom.defaultRoomId} roomOptions={rooms} timeZone={timeZone} closeHref={href} />}
  </DashboardPage>;
}
