import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getProfile } from "@/lib/auth";
import { pickActiveEnvironment, resolveAvailableEnvironments } from "@/lib/environment";
import { createClient } from "@/lib/supabase/server";
import { getThemePreference } from "@/lib/theme";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { UtilitySheet } from "./utility-sheet";
import { ChangeBell } from "@/features/events/ChangeBell";
import { getInitialChangeFeed } from "@/features/events/actions";

export async function SiteHeader() {
  const locale = await getLocale();
  const theme = await getThemePreference();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const changes = user ? await getInitialChangeFeed() : [];

  let environments: Awaited<ReturnType<typeof resolveAvailableEnvironments>> = [];
  let activeEnvironment: ReturnType<typeof pickActiveEnvironment> = null;
  if (user) {
    const profile = await getProfile(user.id);
    environments = await resolveAvailableEnvironments(supabase, user.id, profile?.role);
    activeEnvironment = pickActiveEnvironment(profile?.lastActiveEnvironment, environments);
  }

  return (
    <header className="flex items-center justify-between gap-6 px-5 py-3 md:px-10 md:py-5">
      <Link href="/" className="font-display text-2xl tracking-tight md:text-3xl">Mathin</Link>
      <div className="flex items-center gap-2">
        {user && <ChangeBell initialEvents={changes} />}
        <LocaleSwitcher />
        <ThemeToggle initialTheme={theme} />
        <UtilitySheet
          isLoggedIn={!!user}
          locale={locale}
          environments={environments}
          activeEnvironment={activeEnvironment}
        />
      </div>
    </header>
  );
}
