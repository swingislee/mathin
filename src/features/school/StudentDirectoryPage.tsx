import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { PermissionKey } from "./permissions";
import { isTeacherWorkspaceViewer } from "./teacher-workspace";
import { NewStudentDialog } from "./NewStudentDialog";
import { loadStudentDirectory } from "./student-directory-data";
import { parseStudentDirectoryFilters } from "./student-directory-contract";
import { studentDirectoryMessages } from "./student-directory-messages";
import { StudentDirectoryWorkspace } from "./StudentDirectoryWorkspace";

export async function StudentDirectoryPage({ locale, currentUserId, permissions, searchParams }: {
  locale: string; currentUserId: string; permissions: Set<PermissionKey>; searchParams: Record<string, string | string[] | undefined>;
}) {
  const teacher = await isTeacherWorkspaceViewer(currentUserId);
  const filters = parseStudentDirectoryFilters(searchParams, teacher || !permissions.has("student.view.all") ? "mine" : "all");
  const data = await loadStudentDirectory(filters);
  const m = studentDirectoryMessages(locale);
  return <StudentDirectoryWorkspace data={data} filters={{ ...filters, page: data.page }} locale={locale}
    canContact={permissions.has("followup.view") && permissions.has("followup.write")}
    actions={<>
      <Link href="/dashboard/students/groups" className={buttonVariants({ variant: "ghost", size: "sm" })}>{m.groups}</Link>
      {permissions.has("student.import") ? <Link href="/dashboard/students/import" className={buttonVariants({ variant: "ghost", size: "sm" })}>{m.import}</Link> : null}
      {permissions.has("student.delete") ? <Link href="/dashboard/students?tab=recycle" className={buttonVariants({ variant: "ghost", size: "sm" })}>{m.recycle}</Link> : null}
      {permissions.has("student.create") ? <NewStudentDialog /> : null}
    </>} />;
}
