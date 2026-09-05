import { redirect } from "@/i18n/navigation";
import { getMyPerms, requireUser } from "@/lib/auth";

export default async function FollowupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireUser(locale);
  const permissions = await getMyPerms(user.id);
  const section = permissions.has("followup.view") ? "leads" : permissions.has("review.write") ? "assessments" : "enrollments";
  redirect({ locale, href: `/dashboard/followups/${section}` });
}
