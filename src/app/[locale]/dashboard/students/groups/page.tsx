import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { requireAnyPerm } from "@/lib/auth";
import { readSchoolCollaborationSettings } from "@/features/school/school-collaboration-data";
import { SchoolCollaborationSettings } from "@/features/school/SchoolCollaborationSettings";

async function Content({ locale }: { locale: string }) {
  await requireAnyPerm(locale, ["student.view.all", "student.view.assigned", "followup.view"]);
  return <SchoolCollaborationSettings locale={locale} initial={await readSchoolCollaborationSettings()} />;
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense fallback={<p className="text-sm text-muted">{locale.startsWith("en") ? "Loading…" : "正在读取…"}</p>}><Content locale={locale} /></Suspense>;
}
