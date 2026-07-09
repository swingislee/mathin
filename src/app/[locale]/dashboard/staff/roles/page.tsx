import { setRequestLocale } from "next-intl/server";
import { SchoolPlaceholderPage } from "@/features/school/PlaceholderPage";
import { requirePerm } from "@/lib/auth";

export default async function StaffRolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "permission.configure");
  return <SchoolPlaceholderPage labelKey="roles" />;
}
