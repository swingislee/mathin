"use client";

import { Baby, BookOpen, CalendarDays, ClipboardList, Crop, FolderOpen, KeyRound, LayoutDashboard, PanelLeftOpen, PhoneForwarded, Presentation, School, ShieldAlert, ShieldCheck, Users, UserCog, Wallet } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { SchoolNavItem } from "./nav";

const ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  home: LayoutDashboard,
  followups: PhoneForwarded,
  students: Users,
  courses: BookOpen,
  workbench: Presentation,
  adaptReview: Crop,
  sharedAssets: FolderOpen,
  classes: School,
  schedule: CalendarDays,
  finance: Wallet,
  staff: UserCog,
  roles: ShieldCheck,
  registrationInvites: KeyRound,
  children: Baby,
  assignments: ClipboardList,
  operations: ShieldAlert,
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 课件审阅/编辑工作区、讲次工作区和课表需要独立的桌面端面板布局（内部单一滚动区，
 * 不与 <main> 争夺滚动），其余 Dashboard 页面统一使用全宽壳层。
 */
function isPanelWorkspace(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "dashboard") return false;
  if (segments[1] === "courseware" && segments[2] !== "assets" && segments.length >= 4) return true;
  if (segments[1] === "curriculum" && segments[2] === "lectures" && segments.length >= 4) return true;
  if (segments[1] === "sessions" && segments.length >= 3) return true;
  if (segments[1] === "schedule") return true;
  return false;
}

function withGroupHeaders(nav: readonly SchoolNavItem[]): Array<{ item: SchoolNavItem; showGroupHeader: boolean }> {
  const result: Array<{ item: SchoolNavItem; showGroupHeader: boolean }> = [];
  let lastGroup: string | undefined;
  for (const item of nav) {
    result.push({ item, showGroupHeader: item.group !== undefined && item.group !== lastGroup });
    lastGroup = item.group;
  }
  return result;
}

function NavList({ nav, pathname, onNavigate }: { nav: readonly SchoolNavItem[]; pathname: string; onNavigate?: () => void }) {
  const navT = useTranslations("school.nav");
  return (
    <nav className="flex flex-col gap-0.5 px-3 pb-4">
      {withGroupHeaders(nav).map(({ item, showGroupHeader }) => {
        const Icon = ICONS[item.labelKey] ?? LayoutDashboard;
        const active = isActive(pathname, item.href);
        return (
          <Fragment key={item.href}>
            {showGroupHeader ? (
              <p className="mb-1 mt-4 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted first:mt-1">
                {navT(`group_${item.group}`)}
              </p>
            ) : null}
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                active ? "bg-moon/35 font-medium text-ink" : "text-muted hover:bg-card/70 hover:text-ink",
              )}
            >
              <Icon size={17} strokeWidth={1.75} />
              {navT(item.labelKey)}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}

/** Dashboard keeps the navigation static and gives scrolling responsibility to the main workspace. */
export function DashboardShell({ nav, children }: { nav: readonly SchoolNavItem[]; children: React.ReactNode }) {
  const shellT = useTranslations("dashboard.shell");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const workspace = isPanelWorkspace(pathname);

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-card/35 lg:flex lg:flex-col">
        <Link href="/" className="shrink-0 px-6 pb-5 pt-6 font-display text-3xl tracking-tight text-ink">
          Mathin
        </Link>
        <ScrollArea className="min-h-0 flex-1">
          <NavList nav={nav} pathname={pathname} />
        </ScrollArea>
        <div className="relative h-36 shrink-0 overflow-hidden px-4 pb-3" aria-hidden>
          <Image
            src="/illustrations/dashboard-observatory.png"
            alt=""
            fill
            sizes="240px"
            className="object-cover object-center opacity-70 mix-blend-multiply dark:opacity-35 dark:mix-blend-screen"
          />
        </div>
      </aside>

      <div className="fixed left-4 top-4 z-40 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="secondary" size="sm" className="size-11 rounded-full p-0 shadow-lg" aria-label={shellT("openNav")}>
              <PanelLeftOpen size={18} />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" closeLabel={shellT("closeNav")} className="grid h-dvh w-[min(84vw,320px)] grid-rows-[auto_minmax(0,1fr)] p-0">
            <div className="border-b border-line px-5 py-5 pr-14">
              <SheetTitle className="font-display text-xl">{shellT("title")}</SheetTitle>
            </div>
            <ScrollArea className="min-h-0 pt-3">
              <NavList nav={nav} pathname={pathname} onNavigate={() => setOpen(false)} />
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>

      <main className={cn(
        "flex min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-5 md:px-6 lg:px-8 lg:pb-6 lg:pr-24 2xl:px-10",
        workspace && "xl:overflow-hidden",
      )}>
        <div
          data-dashboard-content
          data-dashboard-workspace={workspace ? "true" : undefined}
          className={cn("min-w-0", workspace && "min-h-0 flex-1 xl:flex")}
        >
          {children}
        </div>
      </main>
    </div>
  );
}