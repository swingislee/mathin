import { getLocale, getTranslations } from "next-intl/server";
import { GlobalFloatingControls } from "@/components/global-floating-controls";
import { ChangeBell, type InboxWorkItem } from "@/features/events/ChangeBell";
import { getInitialChangeFeed, type ChangeEvent } from "@/features/events/notifications";
import { formatWorkItemReason, listMyWorkItems, resolveWorkItemHref } from "@/features/school/work-items";
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
  let inboxWorkItems: InboxWorkItem[] = [];
  let totalWorkItems = 0;

  let environments: Awaited<ReturnType<typeof resolveAvailableEnvironments>> = [];
  let activeEnvironment: ReturnType<typeof pickActiveEnvironment> = null;
  let profile: Awaited<ReturnType<typeof getProfile>> = null;
  if (user) {
    profile = await getProfile(user.id);
    environments = await resolveAvailableEnvironments(supabase, user.id, profile?.role);
    activeEnvironment = pickActiveEnvironment(profile?.lastActiveEnvironment, environments);
    const [nextChanges, rawWorkItems] = await Promise.all([
      getInitialChangeFeed(),
      activeEnvironment === "staff" ? listMyWorkItems().catch(() => []) : Promise.resolve([]),
    ]);
    changes = nextChanges;
    totalWorkItems = rawWorkItems.length;
    if (rawWorkItems.length > 0) {
      const [workT, classesT] = await Promise.all([
        getTranslations("school.work"),
        getTranslations("school.classes"),
      ]);
      const now = new Date();
      const urgencyLabels = {
        now: workT("bucket_now"),
        overdue: workT("bucket_overdue"),
        today: workT("bucket_today"),
        upcoming: workT("bucket_upcoming"),
        backlog: workT("bucket_backlog"),
      };
      inboxWorkItems = rawWorkItems.slice(0, 8).map((item) => ({
        key: item.workKey,
        title: item.primaryObjectName,
        reason: formatWorkItemReason(item, workT, classesT, locale, now),
        href: resolveWorkItemHref(item),
        urgency: item.urgencyBucket,
        urgencyLabel: urgencyLabels[item.urgencyBucket],
      }));
    }
  }

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-start justify-between gap-6 px-4 py-4 md:px-7 md:py-6">
      {workspace ? <span /> : (
        <Link href="/" className="pointer-events-auto font-display text-2xl tracking-tight text-ink drop-shadow-sm md:text-3xl">
          Mathin
        </Link>
      )}
      <GlobalFloatingControls>
        {user && <ChangeBell key={changes[0]?.id ?? "empty"} initialEvents={changes} workItems={inboxWorkItems} totalWorkItems={totalWorkItems} userId={user.id} />}
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
