import { redirect } from "@/i18n/navigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

export default async function CourseOpportunitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireAnyPerm(locale, ["followup.view", "enrollment.manage"]);
  const permissions = await getMyPerms(user.id);
  redirect({ href: permissions.has("followup.view") ? "/dashboard/invitations?queue=post_activity" : "/dashboard/enrollments", locale });
}
