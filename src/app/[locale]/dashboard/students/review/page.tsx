import { requireAnyPerm } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";

/** 旧核对入口回到统一档案，来源凭据仍在个人经历中保留。 */
export default async function ReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireAnyPerm(locale, ["student.view.all", "student.view.assigned", "followup.view"]);
  redirect({ locale, href: "/dashboard/students?population=records" });
}
