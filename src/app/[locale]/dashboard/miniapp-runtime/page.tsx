import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { loadMiniappRuntime } from "@/features/school/miniapp-runtime/actions";
import { MiniappRuntimeConsole } from "@/features/school/miniapp-runtime/RuntimeConsole";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const result = await loadMiniappRuntime();
  if (!result.ok) throw new Error(result.code);
  return <MiniappRuntimeConsole initial={result.data} locale={locale === "en" ? "en" : "zh"} />;
}
