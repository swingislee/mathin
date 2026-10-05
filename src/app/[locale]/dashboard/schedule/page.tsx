import { getNow, getTranslations, setRequestLocale } from "next-intl/server";
import { ScheduleWeekView } from "@/features/school/ScheduleWeekView";
import { CalendarWorkbench } from "@/features/school/CalendarWorkbench";
import { SessionManagementDrawer } from "@/features/school/SessionManagementDrawer";
import { getSessionQuickRow } from "@/features/school/classes";
import { getActiveEnvironment, getMyPerms, getProfile, requireUser } from "@/lib/auth";
import { getOrganizationTimezoneV2, listActiveRoomOptionsV2 } from "@/features/school/organization-locations";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const [t, perms, rawSearchParams, roomOptions, timeZone, now, environment, profile] = await Promise.all([
    getTranslations("school.schedule"),
    getMyPerms(user.id),
    searchParams,
    listActiveRoomOptionsV2(),
    getOrganizationTimezoneV2(),
    getNow(),
    getActiveEnvironment(user.id),
    getProfile(user.id),
  ]);

  const requestedSessionId = first(rawSearchParams.session);
  const quickRow = requestedSessionId && UUID_PATTERN.test(requestedSessionId)
    ? await getSessionQuickRow(requestedSessionId)
    : null;

  return (
    <>
      {environment === "staff" ? <CalendarWorkbench
        locale={locale}
        now={now.getTime()}
        timeZone={timeZone}
        roomOptions={roomOptions}
        currentUserId={user.id}
        currentUserName={profile?.displayName ?? ""}
        canManageAvailability={perms.has("review.write") || perms.has("followup.write") || perms.has("schedule.manage")}
        canViewAssessments={perms.has("review.write") || perms.has("followup.view")}
        initialDate={first(rawSearchParams.date)}
        refreshKey={quickRow ? [quickRow.id, quickRow.scheduledAt, quickRow.durationMin, quickRow.roomId, quickRow.state].join(":") : ""}
      /> : <ScheduleWeekView
        refreshKey={quickRow ? [quickRow.id, quickRow.scheduledAt, quickRow.durationMin, quickRow.roomId, quickRow.state].join(":") : ""}
        title={t("title")}
        canFilterAll={perms.has("schedule.view.all")}
        roomOptions={roomOptions}
        timeZone={timeZone}
      />}

      <SessionManagementDrawer
        key={quickRow?.id ?? "none"}
        session={quickRow}
        classroomName={quickRow?.classroomName ?? ""}
        classroomDefaultRoomId={quickRow?.classroomDefaultRoomId ?? null}
        roomOptions={roomOptions}
        timeZone={timeZone}
        closeHref={first(rawSearchParams.date) && /^\d{4}-\d{2}-\d{2}$/.test(first(rawSearchParams.date)!) ? `/dashboard/schedule?date=${first(rawSearchParams.date)}` : "/dashboard/schedule"}
      />
    </>
  );
}
