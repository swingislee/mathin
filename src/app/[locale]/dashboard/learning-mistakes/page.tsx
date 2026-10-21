import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { loadLearningPolicy } from "@/features/school/learning-rewards/policy-actions";
import type { LearningPolicy } from "@/features/school/learning-rewards/policy";
import type { MistakeRules } from "@/features/school/learning-mistakes/contract";
import { MistakeConsole } from "@/features/school/learning-mistakes/MistakeConsole";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const result = await loadLearningPolicy("mistakes"); if (!result.ok) throw new Error(result.code);
  const policy = result.data as LearningPolicy<MistakeRules>;
  return <MistakeConsole initial={policy.draft || policy.published!} initialPolicy={policy} locale={locale === "en" ? "en" : "zh"} />;
}
