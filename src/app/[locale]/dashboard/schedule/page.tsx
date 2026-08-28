import { getTranslations, setRequestLocale } from "next-intl/server";
import { ScheduleWeekView } from "@/features/school/ScheduleWeekView";
import { SessionManagementDrawer } from "@/features/school/SessionManagementDrawer";
import { getSessionQuickRow } from "@/features/school/classes";
import { getMyPerms, requireUser } from "@/lib/auth";
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
  const [t, perms, rawSearchParams, roomOptions, timeZone] = await Promise.all([
    getTranslations("school.schedule"),
    getMyPerms(user.id),
    searchParams,
    listActiveRoomOptionsV2(),
    getOrganizationTimezoneV2(),
  ]);

  const requestedSessionId = first(rawSearchParams.session);
  const quickRow = requestedSessionId && UUID_PATTERN.test(requestedSessionId)
    ? await getSessionQuickRow(requestedSessionId)
    : null;

  return (
    <>
      {/* 页壳由 ScheduleWeekView 自己渲染：周次切换与筛选是它的客户端状态，
          必须住在命令面板里（docs/plan/21 §14）。 */}
      <ScheduleWeekView
        title={t("title")}
        canFilterAll={perms.has("schedule.view.all")}
        roomOptions={roomOptions}
        timeZone={timeZone}
      />

      <SessionManagementDrawer
        key={quickRow?.id ?? "none"}
        session={quickRow}
        classroomName={quickRow?.classroomName ?? ""}
        classroomDefaultRoomId={quickRow?.classroomDefaultRoomId ?? null}
        roomOptions={roomOptions}
        timeZone={timeZone}
        closeHref="/dashboard/schedule"
      />
    </>
  );
}
