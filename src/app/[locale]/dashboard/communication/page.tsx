import { setRequestLocale } from "next-intl/server";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { StudentStagePage } from "@/features/school/StudentStagePage";
import CommunicationWorklistPage from "@/features/school/CommunicationWorklistPage";
import { DirectoryContactSelectionPage } from "@/features/school/DirectoryContactSelectionPage";
import type { WorkEntryQuery } from "@/features/school/work-entry-contract";

export default async function CommunicationPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<WorkEntryQuery>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["followup.view", "review.write"]);
  const permissions = await getMyPerms(user.id);
  if (query.students !== undefined) {
    return <DirectoryContactSelectionPage locale={locale} currentUserId={user.id} permissions={permissions} query={query} />;
  }
  // 明确的工作单、邀约和联系人定位继续打开原有办理面；普通入口按阶段工作。
  if (query.lead || query.worklist || query.view || !permissions.has("student.view.all") && !permissions.has("student.view.assigned")) {
    return <CommunicationWorklistPage params={params} searchParams={searchParams} />;
  }
  return <StudentStagePage locale={locale} currentUserId={user.id} permissions={permissions} searchParams={query} presentation="communication" />;
}
