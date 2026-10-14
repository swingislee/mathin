import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { readPublishedSettings } from "@/features/participant-portal/settings-server";
import { loadMiniappRuntime } from "@/features/school/miniapp-runtime/actions";
import { MiniappRuntimeConsole } from "@/features/school/miniapp-runtime/RuntimeConsole";
import { defaultMiniappSettings } from "../../../../../contracts/participant-api/miniapp-settings";
import { loadMiniappActivityChoices, loadMiniappContactOptions, loadMiniappSettings } from "@/features/school/miniapp-settings/actions";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const [runtime, settings, live, contacts, activities] = await Promise.all([loadMiniappRuntime(), loadMiniappSettings(), readPublishedSettings(), loadMiniappContactOptions(), loadMiniappActivityChoices()]);
  if (!runtime.ok) throw new Error(runtime.code);
  if (!settings.ok) throw new Error(settings.code);
  return <MiniappRuntimeConsole initial={runtime.data} settings={settings.data} liveSettings={live.config ?? defaultMiniappSettings()} contactOptions={contacts.ok ? contacts.data : undefined}
    activities={activities.ok ? activities.data : []} locale={locale === "en" ? "en" : "zh"} />;
}
