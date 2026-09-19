import { setRequestLocale } from "next-intl/server";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";
import ClassPlacementPage from "@/features/school/ClassPlacementPage";
import ClassDirectoryPage from "@/features/school/ClassDirectoryPage";
import TeachingWorkspacePage from "@/features/school/teaching-workbench/TeachingWorkspacePage";
import { isTeacherWorkspaceViewer } from "@/features/school/teacher-workspace";
import type { WorkEntryQuery } from "@/features/school/work-entry-contract";

export default async function ClassesPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<WorkEntryQuery>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { user } = await requireDashboardEnvironment(locale, ["staff"]);
  const permissions = await getMyPerms(user.id);
  const canTeach = permissions.has("class.view.mine") || permissions.has("class.view.all");
  const view = query.view ?? (canTeach && await isTeacherWorkspaceViewer(user.id) ? "records" : "arrange");
  if (view === "directory" || !query.view && query.scope === "test") return <ClassDirectoryPage params={params} searchParams={searchParams} />;
  if (canTeach && ["records", "progress", "tasks"].includes(String(view))) {
    return <TeachingWorkspacePage params={params} searchParams={Promise.resolve({ ...query, view: String(view) })} />;
  }
  return <ClassPlacementPage params={params} searchParams={searchParams} />;
}
