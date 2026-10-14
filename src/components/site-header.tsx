import { getLocale } from "next-intl/server";
import { GlobalFloatingControls } from "@/components/global-floating-controls";
import { ChangeBell } from "@/features/events/ChangeBell";
import { getInitialChangeFeed, type ChangeEvent } from "@/features/events/notifications";
import { Link } from "@/i18n/navigation";
import { getActiveEnvironment, getAuthUser, getAvailableEnvironments, getProfile } from "@/lib/auth";
import type { UserEnvironment } from "@/lib/environment";
import { getThemePreference } from "@/lib/theme";
import { UtilitySheet } from "./utility-sheet";

export async function SiteHeader({ workspace = false }: { workspace?: boolean } = {}) {
  const [locale, theme, user] = await Promise.all([getLocale(), getThemePreference(), getAuthUser()]);
  let changes: ChangeEvent[] = [];

  let environments: UserEnvironment[] = [];
  let activeEnvironment: UserEnvironment | null = null;
  let profile: Awaited<ReturnType<typeof getProfile>> = null;
  if (user) {
    // 与布局共用本次请求已读取的资料和环境。
    [profile, environments, activeEnvironment, changes] = await Promise.all([
      getProfile(user.id), getAvailableEnvironments(user.id), getActiveEnvironment(user.id), getInitialChangeFeed(),
    ]);
  }

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-start justify-between gap-6 px-4 py-4 md:px-7 md:py-6">
      {workspace ? <span /> : (
        <Link href="/" className="pointer-events-auto font-display text-2xl tracking-tight text-ink/75 drop-shadow-sm md:text-3xl">
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
