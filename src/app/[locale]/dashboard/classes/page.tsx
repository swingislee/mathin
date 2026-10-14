import { cookies } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";
import ClassPlacementPage from "@/features/school/ClassPlacementPage";
import ClassDirectoryPage from "@/features/school/ClassDirectoryPage";
import { CLASS_WORKSPACE_COOKIE, classWorkspaceHrefFromCookie } from "@/features/school/class-workspace-preferences";
import { ClassWorkspaceEntry } from "@/features/school/ClassWorkspaceMemory";
import TeachingWorkspacePage from "@/features/school/teaching-workbench/TeachingWorkspacePage";
import type { WorkEntryQuery } from "@/features/school/work-entry-contract";

export default async function ClassesPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<WorkEntryQuery>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { user } = await requireDashboardEnvironment(locale, ["staff"]);
  if (!Object.keys(query).length) {
    // 裸入口直接进入本人上次的视图；没有记录时由客户端读取本机偏好。
    const remembered = classWorkspaceHrefFromCookie((await cookies()).get(CLASS_WORKSPACE_COOKIE)?.value, user.id);
    if (remembered) redirect({ href: remembered, locale });
    return <ClassWorkspaceEntry />;
  }
  const permissions = await getMyPerms(user.id);
  const canTeach = permissions.has("class.view.mine") || permissions.has("class.view.all");
  const view = typeof query.view === "string" ? query.view : "arrange";
  if (view === "directory" || !query.view && query.scope === "test") return <ClassDirectoryPage params={params} searchParams={searchParams} />;
  if (canTeach && view === "tasks") {
    return <TeachingWorkspacePage params={params} searchParams={Promise.resolve({ ...query, view: String(view) })} />;
  }
  return <ClassPlacementPage params={params} searchParams={searchParams} />;
}
