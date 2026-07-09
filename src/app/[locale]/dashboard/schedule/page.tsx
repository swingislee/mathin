import { setRequestLocale } from "next-intl/server";
import { SchoolPlaceholderPage } from "@/features/school/PlaceholderPage";
import { requireUser } from "@/lib/auth";

export default async function SchedulePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  return <SchoolPlaceholderPage labelKey="schedule" />;
}
