"use client";

import { Baby, BookOpen, CalendarDays, ClipboardList, Image, LayoutDashboard, Menu, PhoneForwarded, Presentation, School, ShieldAlert, ShieldCheck, Users, UserCog, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ComponentType } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { SchoolNavItem } from "./nav";

const ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  home: LayoutDashboard,
  followups: PhoneForwarded,
  students: Users,
  courses: BookOpen,
  courseware: Presentation,
  assetLibrary: Image,
  classes: School,
  schedule: CalendarDays,
  finance: Wallet,
  staff: UserCog,
  roles: ShieldCheck,
  children: Baby,
  assignments: ClipboardList,
  operations: ShieldAlert,
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 课件审阅/编辑工作区需要独立的桌面端面板布局，其余 Dashboard 页面统一使用全宽壳层。 */
function isCoursewareWorkspace(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] === "dashboard"
    && segments[1] === "courseware"
    && segments[2] !== "assets"
    && segments.length >= 4;
}

function NavList({ nav, pathname, onNavigate }: { nav: readonly SchoolNavItem[]; pathname: string; onNavigate?: () => void }) {
  const navT = useTranslations("school.nav");
  return (
    <nav className="flex flex-col gap-1 p-3">
      {nav.map((item) => {
        const Icon = ICONS[item.labelKey] ?? LayoutDashboard;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition",
              active ? "border-crater bg-crater/10 font-medium text-ink" : "border-transparent text-muted hover:border-line hover:bg-card hover:text-ink",
            )}
          >
            <Icon size={17} strokeWidth={1.75} />
            {navT(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

/** 桌面常驻侧栏 + 移动端抽屉，dashboard 全路由共用（10-§7 布局重构）。 */
export function DashboardShell({ nav, children }: { nav: readonly SchoolNavItem[]; children: React.ReactNode }) {
  const shellT = useTranslations("dashboard.shell");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const workspace = isCoursewareWorkspace(pathname);

  return (
    // 内框 overflow-hidden：aside 与 main 各自独立滚动，祖先已 h-dvh，故 window 永不滚动。
    // 注意 overflow-hidden 祖先内 sticky 失效——aside 不再用 sticky，改为自身 overflow-y-auto。
    <div className="flex min-h-0 w-full max-w-none flex-1 gap-4 overflow-hidden px-4 lg:gap-6 lg:px-6 2xl:px-8">
      <aside className="hidden w-60 shrink-0 overflow-y-auto py-6 lg:block">
        <div className="rounded-2xl border border-line bg-card">
          <NavList nav={nav} pathname={pathname} />
        </div>
      </aside>

      <main className={cn(
        "flex min-w-0 flex-1 flex-col",
        workspace ? "overflow-y-auto py-4 xl:overflow-hidden" : "overflow-y-auto py-6",
      )}>
        <div className="mb-4 shrink-0 lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="secondary" size="sm" aria-label={shellT("openNav")}>
                <Menu size={18} />
                {shellT("openNav")}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" closeLabel={shellT("closeNav")} className="flex w-[min(80vw,320px)] flex-col py-3">
              <SheetTitle className="mb-2 px-4 text-lg">{shellT("title")}</SheetTitle>
              <NavList nav={nav} pathname={pathname} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>

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
