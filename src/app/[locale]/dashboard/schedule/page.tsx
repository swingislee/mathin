import { getTranslations, setRequestLocale } from "next-intl/server";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { ScheduleWeekView } from "@/features/school/ScheduleWeekView";
import { SessionManagementDrawer } from "@/features/school/SessionManagementDrawer";
import { ObjectWorkspace } from "@/features/school/stage/ObjectWorkspace";
import { TermManager } from "@/features/school/TermManager";
import { listSchoolTerms } from "@/features/school/courses";
import { getSessionQuickRow } from "@/features/school/classes";
import { getMyPerms, requireUser } from "@/lib/auth";

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
  const [t, perms, rawSearchParams] = await Promise.all([
    getTranslations("school.schedule"),
    getMyPerms(user.id),
    searchParams,
  ]);
  const schoolTerms = perms.has("schedule.manage") ? await listSchoolTerms() : [];

  const requestedSessionId = first(rawSearchParams.session);
  const quickRow = requestedSessionId && UUID_PATTERN.test(requestedSessionId)
    ? await getSessionQuickRow(requestedSessionId)
    : null;

  return (
    <>
      <ObjectWorkspace
        scroll="internal"
        objectBar={
          <SchoolPageHeader title={t("title")} actions={perms.has("schedule.manage") ? <TermManager terms={schoolTerms} /> : undefined}>
            <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
          </SchoolPageHeader>
        }
      >
        <ScheduleWeekView canFilterAll={perms.has("schedule.view.all")} />
      </ObjectWorkspace>

      <SessionManagementDrawer
        key={quickRow?.id ?? "none"}
        session={quickRow}
        classroomName={quickRow?.classroomName ?? ""}
        classroomRoom={quickRow?.classroomRoom ?? ""}
        closeHref="/dashboard/schedule"
      />
    </>
  );
}
