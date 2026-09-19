import { getNow } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { DashboardEmptyCard, DashboardPage } from "./dashboard-page";
import { StudentStageWorkspace } from "./StudentStageWorkspace";
import { getOrganizationTimezoneV2 } from "./organization-locations";
import { directoryReturnHref, directorySelectionSchema } from "./student-directory-contract";
import { loadDirectoryContactSelection } from "./student-directory-data";
import { studentDirectoryMessages } from "./student-directory-messages";
import type { PermissionKey } from "./permissions";
import type { WorkEntryQuery } from "./work-entry-contract";

export async function DirectoryContactSelectionPage({ locale, currentUserId, permissions, query }: {
  locale: string; currentUserId: string; permissions: Set<PermissionKey>; query: WorkEntryQuery;
}) {
  const m = studentDirectoryMessages(locale);
  const selection = directorySelectionSchema.safeParse(typeof query.students === "string" ? query.students.split(",") : []);
  const returnHref = directoryReturnHref(typeof query.returnTo === "string" ? query.returnTo : undefined);
  const back = <Link href={returnHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{m.back}</Link>;
  if (!selection.success || !permissions.has("student.view.all") && !permissions.has("student.view.assigned")) {
    return <DashboardPage title={m.selectionTitle} backHref={returnHref} backLabel={m.back}><DashboardEmptyCard>{m.invalidSelection}</DashboardEmptyCard></DashboardPage>;
  }
  const [data, timeZone, now] = await Promise.all([loadDirectoryContactSelection(selection.data), getOrganizationTimezoneV2(), getNow()]);
  return <StudentStageWorkspace key={selection.data.join(",")} data={data}
    filters={{ stage: "awaiting_enrollment", scope: "all", q: "", detail: "", population: "records", page: 1, pageSize: 100 }}
    locale={locale} currentUserId={currentUserId} presentation="communication" contactSelection={{ requestedCount: selection.data.length }}
    canEnroll={permissions.has("enrollment.manage")} canAssign={false} assignees={[]} timeZone={timeZone} now={now.getTime()}
    actions={<>{back}<Link href="/dashboard/communication" className={buttonVariants({ variant: "ghost", size: "sm" })}>{locale.startsWith("en") ? "All communication" : "全部沟通"}</Link></>} />;
}
