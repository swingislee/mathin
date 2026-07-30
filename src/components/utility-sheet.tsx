"use client";

import { BookOpen, GraduationCap, Home as HomeIcon, LayoutDashboard, Lightbulb, LogIn, LogOut, type LucideIcon, Menu, NotebookPen, PenLine, Presentation, Puzzle, ShieldCheck, Sprout, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { logout } from "@/app/[locale]/(auth)/actions";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { setActiveEnvironmentAction } from "@/features/school/environment-actions";
import { Link } from "@/i18n/navigation";
import type { UserEnvironment } from "@/lib/environment";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle, type Theme } from "./theme-toggle";

const publicItems = [
  ["story", BookOpen], ["games", Puzzle], ["minds", Lightbulb], ["terms", Sprout], ["tools", Wrench],
] as const;
const featureItems = [
  ["dashboard", LayoutDashboard], ["classroom", Presentation], ["notebook", NotebookPen], ["whiteboard", PenLine],
] as const;
const environmentItems: readonly [UserEnvironment, "envStaff" | "envFamily" | "envLearning", LucideIcon][] = [
  ["staff", "envStaff", LayoutDashboard],
  ["family", "envFamily", HomeIcon],
  ["learning", "envLearning", GraduationCap],
];

export function UtilitySheet({
  isLoggedIn,
  locale,
  environments = [],
  activeEnvironment = null,
  initialTheme,
  accountName,
  accountEmail,
}: {
  isLoggedIn: boolean;
  locale: string;
  environments?: UserEnvironment[];
  activeEnvironment?: UserEnvironment | null;
  initialTheme: Theme;
  accountName?: string;
  accountEmail?: string;
}) {
  const nav = useTranslations("nav");
  const home = useTranslations("home");
  const common = useTranslations("common");

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button aria-label={home("openDrawer")} className="edge-control"><Menu size={18} /></button>
      </SheetTrigger>
      <SheetContent side="right" closeLabel={home("closeDrawer")} className="grid h-dvh w-[min(90vw,380px)] grid-rows-[auto_minmax(0,1fr)_auto] p-0">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3 pr-16">
          <SheetTitle className="sr-only">{home("drawer")}</SheetTitle>
          {isLoggedIn && accountName ? (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-moon/45 font-display text-lg text-ink">
                {accountName.trim().charAt(0).toLocaleUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{accountName}</p>
                {accountEmail && accountEmail !== accountName && <p className="truncate text-xs text-muted">{accountEmail}</p>}
              </div>
            </div>
          ) : (
            <SheetClose asChild>
              <Link href="/login" className="flex items-center gap-3 rounded-xl py-1 text-sm font-medium text-ink">
                <span className="grid size-10 place-items-center rounded-full border border-line bg-moon/45">
                  <LogIn size={18} strokeWidth={1.75} />
                </span>
                <span>{common("login")}</span>
              </Link>
            </SheetClose>
          )}
          {isLoggedIn && (
            <form action={logout} className="ml-auto shrink-0">
              <Input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                aria-label={common("logout")}
                className="grid size-10 place-items-center rounded-full border border-line text-muted transition hover:bg-moon/30 hover:text-ink"
              >
                <LogOut size={18} strokeWidth={1.75} />
              </button>
            </form>
          )}
        </div>

        <ScrollArea className="min-h-0">
          <div className="space-y-5 px-5 py-4">
            <nav aria-label={home("publicSections")} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{home("publicSections")}</p>
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card/80 shadow-sm">
                {publicItems.map(([slug, Icon]) => (
                  <SheetClose asChild key={slug}>
                    <Link href={`/${slug}`} className="drawer-nav-row">
                      <Icon size={19} strokeWidth={1.75} />
                      <span>{nav(slug)}</span>
                    </Link>
                  </SheetClose>
                ))}
              </div>
            </nav>

            {isLoggedIn && environments.length > 1 && (
              <nav aria-label={nav("envSection")} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{nav("envSection")}</p>
                <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card/80 shadow-sm">
                  {environmentItems
                    .filter(([env]) => environments.includes(env))
                    .map(([env, labelKey, Icon]) => (
                      <form action={setActiveEnvironmentAction} key={env}>
                        <Input type="hidden" name="locale" value={locale} />
                        <Input type="hidden" name="env" value={env} />
                        <button
                          type="submit"
                          aria-current={env === activeEnvironment ? "page" : undefined}
                          className="drawer-nav-row aria-[current=page]:bg-moon/50 aria-[current=page]:text-ink"
                        >
                          <Icon size={19} strokeWidth={1.75} />
                          <span>{nav(labelKey)}</span>
                        </button>
                      </form>
                    ))}
                </div>
              </nav>
            )}

            {isLoggedIn && (
              <nav aria-label={home("featureSections")} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{home("featureSections")}</p>
                <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card/80 shadow-sm">
                  {featureItems.map(([slug, Icon]) => (
                    <SheetClose asChild key={slug}>
                      <Link href={`/${slug}`} className="drawer-nav-row">
                        <Icon size={19} strokeWidth={1.75} />
                        <span>{nav(slug)}</span>
                      </Link>
                    </SheetClose>
                  ))}
                  <SheetClose asChild>
                    <Link href="/dashboard/account-security" className="drawer-nav-row">
                      <ShieldCheck size={19} strokeWidth={1.75} />
                      <span>{nav("accountSecurity")}</span>
                    </Link>
                  </SheetClose>
                </div>
              </nav>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center gap-2 border-t border-line bg-background/95 px-5 py-2 backdrop-blur-md">
          <LocaleSwitcher />
          <ThemeToggle initialTheme={initialTheme} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
