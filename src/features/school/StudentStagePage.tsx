import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { PermissionKey } from "./permissions";
import { NewStudentDialog } from "./NewStudentDialog";
import { parseStudentStageFilters } from "./student-stage-contract";
import { loadStudentStageData } from "./student-stage-data";
import { StudentStageWorkspace } from "./StudentStageWorkspace";
import { getOrganizationTimezoneV2 } from "./organization-locations";

export async function StudentStagePage({ locale, currentUserId, permissions, searchParams }: {
  locale: string; currentUserId: string; permissions: Set<PermissionKey>; searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = parseStudentStageFilters(searchParams, permissions.has("student.view.all") ? "all" : "mine");
  const [data, t, timeZone] = await Promise.all([loadStudentStageData(filters), getTranslations("school.students"), getOrganizationTimezoneV2()]);
  return <StudentStageWorkspace data={data} filters={filters} locale={locale} currentUserId={currentUserId}
    canEnroll={permissions.has("enrollment.manage")} timeZone={timeZone} actions={<>
      {permissions.has("student.create") ? <NewStudentDialog /> : null}
      {permissions.has("student.import") ? <Link href="/dashboard/students/import" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("import")}</Link> : null}
      {permissions.has("student.delete") ? <Link href="/dashboard/students?tab=recycle" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("recycleBin")}</Link> : null}
    </>} />;
}
