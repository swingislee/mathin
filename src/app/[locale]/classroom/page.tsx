import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getMyProfileRole } from "@/features/classroom/actions";
import { requireUser } from "@/lib/auth";

export default async function ClassroomListCompatibilityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  const role = await getMyProfileRole();
  redirect(role === "staff" || role === "admin"
    ? "/" + locale + "/dashboard/classes"
    : "/" + locale + "/dashboard/learning/classes");
}