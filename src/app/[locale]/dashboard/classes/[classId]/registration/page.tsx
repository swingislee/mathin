import { setRequestLocale } from "next-intl/server";
import { requireAnyPerm } from "@/lib/auth";
import { loadRegistrationWorkbench } from "@/features/school/parent-registration";
import { ParentRegistrationSettings } from "@/features/school/ParentRegistrationSettings";
export default async function Page({ params }: { params: Promise<{ locale: string; classId: string }> }) {
  const { locale, classId } = await params; setRequestLocale(locale);
  await requireAnyPerm(locale, ["class.manage", "enrollment.manage"]);
  return <ParentRegistrationSettings key={classId} value={await loadRegistrationWorkbench("class", classId)} />;
}
