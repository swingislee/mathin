import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { loadMistakeRules } from "@/features/school/learning-mistakes/actions";
import { MistakeConsole } from "@/features/school/learning-mistakes/MistakeConsole";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const result = await loadMistakeRules(); if (!result.ok) throw new Error(result.code);
  return <MistakeConsole initial={result.data} locale={locale === "en" ? "en" : "zh"} />;
}
