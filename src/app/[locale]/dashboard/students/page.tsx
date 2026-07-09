import { setRequestLocale } from "next-intl/server";
import { SchoolPlaceholderPage } from "@/features/school/PlaceholderPage";
import { requireAnyPerm } from "@/lib/auth";

export default async function StudentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["student.view.all", "student.view.assigned"]);
  return <SchoolPlaceholderPage labelKey="students" />;
}
