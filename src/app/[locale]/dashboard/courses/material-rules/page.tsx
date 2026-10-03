import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { getCourseMaterialOptions } from "@/features/school/class-material";
import { CourseMaterialRulesWorkspace } from "@/features/school/CourseMaterialRulesWorkspace";

export default async function MaterialRulesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "course.manage");
  return <CourseMaterialRulesWorkspace options={await getCourseMaterialOptions()} />;
}
