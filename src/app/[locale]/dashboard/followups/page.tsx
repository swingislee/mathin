import { redirect } from "@/i18n/navigation";
import { getMyPerms, requireUser } from "@/lib/auth";
import { isTeacherWorkspaceViewer } from "@/features/school/teacher-workspace";
import { TeacherWorkspaceEntry } from "@/features/school/TeacherWorkspaceMemory";

export default async function FollowupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireUser(locale);
  const [permissions, teacherView] = await Promise.all([getMyPerms(user.id), isTeacherWorkspaceViewer(user.id)]);
  if (teacherView) return <TeacherWorkspaceEntry workspace="followups" />;
  const section = permissions.has("followup.view") ? "leads" : permissions.has("review.write") ? "assessments" : "enrollments";
  redirect({ locale, href: `/dashboard/followups/${section}` });
}
