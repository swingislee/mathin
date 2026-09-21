import { getLocale } from "next-intl/server";
import { GlobalFloatingControls } from "@/components/global-floating-controls";
import { ChangeBell } from "@/features/events/ChangeBell";
import { getInitialChangeFeed, type ChangeEvent } from "@/features/events/notifications";
import { Link } from "@/i18n/navigation";
import { getProfile } from "@/lib/auth";
import { pickActiveEnvironment, resolveAvailableEnvironments } from "@/lib/environment";
import { createClient } from "@/lib/supabase/server";
import { getThemePreference } from "@/lib/theme";
import { UtilitySheet } from "./utility-sheet";

export async function SiteHeader({ workspace = false }: { workspace?: boolean } = {}) {
  const locale = await getLocale();
  const theme = await getThemePreference();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let changes: ChangeEvent[] = [];

  let environments: Awaited<ReturnType<typeof resolveAvailableEnvironments>> = [];
  let activeEnvironment: ReturnType<typeof pickActiveEnvironment> = null;
  let profile: Awaited<ReturnType<typeof getProfile>> = null;
  if (user) {
    profile = await getProfile(user.id);
    environments = await resolveAvailableEnvironments(supabase, user.id, profile?.role);
    activeEnvironment = pickActiveEnvironment(profile?.lastActiveEnvironment, environments);
    changes = await getInitialChangeFeed();
  }

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-start justify-between gap-6 px-4 py-4 md:px-7 md:py-6">
      {workspace ? <span /> : (
        <Link href="/" className="pointer-events-auto font-display text-2xl tracking-tight text-ink drop-shadow-sm md:text-3xl">
          Mathin｜数学笔记
        </Link>
      )}
      <GlobalFloatingControls>
        {user && <ChangeBell
          key={changes[0]?.id ?? "empty"}
          initialEvents={changes}
          userId={user.id}
          showWorkLink={activeEnvironment === "staff"}
          desktopNotificationsEligible={profile?.role === "staff" || profile?.role === "admin"}
        />}
        <UtilitySheet
          isLoggedIn={!!user}
          locale={locale}
          environments={environments}
          activeEnvironment={activeEnvironment}
          initialTheme={theme}
          accountName={profile?.displayName || user?.email || undefined}
          accountEmail={user?.email}
        />
      </GlobalFloatingControls>
    </header>
  );
}
