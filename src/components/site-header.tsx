import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getProfile } from "@/lib/auth";
import { pickActiveEnvironment, resolveAvailableEnvironments } from "@/lib/environment";
import { createClient } from "@/lib/supabase/server";
import { getThemePreference } from "@/lib/theme";
import { UtilitySheet } from "./utility-sheet";
import { ChangeBell } from "@/features/events/ChangeBell";
import { getInitialChangeFeed } from "@/features/events/actions";

export async function SiteHeader({ workspace = false }: { workspace?: boolean } = {}) {
  const locale = await getLocale();
  const theme = await getThemePreference();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const changes = user ? await getInitialChangeFeed() : [];

  let environments: Awaited<ReturnType<typeof resolveAvailableEnvironments>> = [];
  let activeEnvironment: ReturnType<typeof pickActiveEnvironment> = null;
  let profile: Awaited<ReturnType<typeof getProfile>> = null;
  if (user) {
    profile = await getProfile(user.id);
    environments = await resolveAvailableEnvironments(supabase, user.id, profile?.role);
    activeEnvironment = pickActiveEnvironment(profile?.lastActiveEnvironment, environments);
  }

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-start justify-between gap-6 px-4 py-4 md:px-7 md:py-6">
      {workspace ? <span /> : (
        <Link href="/" className="pointer-events-auto font-display text-2xl tracking-tight text-ink drop-shadow-sm md:text-3xl">
          Mathin
        </Link>
      )}
      <div className="pointer-events-auto flex items-center gap-2">
        {user && <ChangeBell initialEvents={changes} />}
        <UtilitySheet
          isLoggedIn={!!user}
          locale={locale}
          environments={environments}
          activeEnvironment={activeEnvironment}
          initialTheme={theme}
          accountName={profile?.displayName || user?.email || undefined}
          accountEmail={user?.email}
        />
      </div>
    </header>
  );
}
