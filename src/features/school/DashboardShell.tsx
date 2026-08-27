"use client";

import { Baby, BookOpen, CalendarDays, ChevronsLeft, ClipboardCheck, ClipboardList, Crop, DatabaseZap, FolderOpen, KeyRound, LayoutDashboard, PanelLeftClose, PanelLeftOpen, PhoneForwarded, Presentation, School, ShieldAlert, ShieldCheck, Sparkles, UserRoundCog, Users, UserCog, Wallet } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import type { ComponentType } from "react";
import { MainFloatingControl } from "@/components/global-floating-controls";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { resolveDashboardShellMode } from "./dashboard-routes";
import {
  DASHBOARD_SIDEBAR_COOKIE,
  nextDashboardSidebarMode,
  type DashboardSidebarMode,
} from "./dashboard-sidebar";
import { resolveActiveNavHref, type SchoolNavItem } from "./nav";

const ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  home: LayoutDashboard,
  followups: PhoneForwarded,
  students: Users,
  courses: BookOpen,
  workbench: Presentation,
  adaptReview: Crop,
  preparationReview: ClipboardCheck,
  sharedAssets: FolderOpen,
  classes: School,
  activities: Sparkles,
  schedule: CalendarDays,
  finance: Wallet,
  staff: UserCog,
  roles: ShieldCheck,
  registrationInvites: KeyRound,
  children: Baby,
  assignments: ClipboardList,
  coursework: CalendarDays,
  progress: ClipboardCheck,
  operations: ShieldAlert,
  accountSecurity: ShieldCheck,
  accountSupport: UserRoundCog,
  testdata: DatabaseZap,
};

function withGroupHeaders(nav: readonly SchoolNavItem[]): Array<{ item: SchoolNavItem; showGroupHeader: boolean }> {
  const result: Array<{ item: SchoolNavItem; showGroupHeader: boolean }> = [];
  let lastGroup: string | undefined;
  for (const item of nav) {
    result.push({ item, showGroupHeader: item.group !== undefined && item.group !== lastGroup });
    lastGroup = item.group;
  }
  return result;
}

function NavList({
  nav,
  pathname,
  onNavigate,
  collapsed = false,
}: {
  nav: readonly SchoolNavItem[];
  pathname: string;
  onNavigate?: () => void;
  /** 图标态：只画图标，分组名退化成分隔线，条目名交给 Tooltip。 */
  collapsed?: boolean;
}) {
  const navT = useTranslations("school.nav");
  // 桌面与移动端共用同一个 active 结果（doc22 §9）：两端各算一次曾经是双重高亮的来源之一。
  const activeHref = resolveActiveNavHref(pathname, nav);
  return (
    // 具名：讲次工作区等页面会渲染自己的 <nav>，无名导航既让读屏用户分不清两者，
    // 也让"侧栏当前项"无法被稳定选中（验收脚本据此断言无双重高亮）。
    <nav
      data-dashboard-nav
      aria-label={navT("sidebarLabel")}
      className={cn("flex flex-col gap-0.5 pb-4", collapsed ? "px-2" : "px-3")}
    >
      {withGroupHeaders(nav).map(({ item, showGroupHeader }) => {
        const Icon = ICONS[item.labelKey] ?? LayoutDashboard;
        const active = item.href === activeHref;
        const label = navT(item.labelKey);
        const link = (
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? label : undefined}
            className={cn(
              "flex min-h-8 items-center rounded-xl text-sm transition-colors",
              collapsed ? "justify-center px-0 py-1.5" : "gap-3 px-3 py-1",
              active ? "bg-moon/35 font-medium text-ink" : "text-muted hover:bg-card/70 hover:text-ink",
            )}
          >
            <Icon size={collapsed ? 17 : 15} strokeWidth={1.75} />
            {collapsed ? null : label}
          </Link>
        );
        return (
          <Fragment key={item.href}>
            {showGroupHeader ? (
              collapsed ? (
                <div className="mx-1 my-1.5 border-t border-line first:mt-0" aria-hidden />
              ) : (
                <p className="mb-1 mt-2 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted first:mt-1">
                  {navT(`group_${item.group}`)}
                </p>
              )
            ) : null}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

/** Dashboard keeps the navigation static and gives scrolling responsibility to the main workspace. */
export function DashboardShell({
  nav,
  initialSidebarMode,
  children,
}: {
  nav: readonly SchoolNavItem[];
  initialSidebarMode: DashboardSidebarMode;
  children: React.ReactNode;
}) {
  const shellT = useTranslations("dashboard.shell");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<DashboardSidebarMode>(initialSidebarMode);
  // doc 23 §6：外壳模式来自路由合同，Shell 不再自己认路径。
  const workspace = resolveDashboardShellMode(pathname) === "panel";
  const collapsed = sidebarMode === "icons";

  const applySidebarMode = (next: DashboardSidebarMode) => {
    setSidebarMode(next);
    // 一年有效期 + Lax：这是纯展示偏好，跨站请求带不带它都无所谓，但刷新和新标签页要记得。
    document.cookie = `${DASHBOARD_SIDEBAR_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      {sidebarMode === "hidden" ? null : (
        <aside
          data-dashboard-sidebar={sidebarMode}
          className={cn(
            "relative hidden shrink-0 overflow-hidden border-r border-line bg-card/35 lg:flex lg:flex-col",
            collapsed ? "w-14" : "w-60",
          )}
        >
          <div className={cn("relative z-10 flex shrink-0 items-center", collapsed ? "flex-col gap-1 px-2 pb-3 pt-4" : "gap-2 px-6 pb-5 pt-6")}>
            <Link
              href="/"
              aria-label="Mathin"
              className={cn("min-w-0 font-display tracking-tight text-ink", collapsed ? "text-xl" : "flex-1 truncate text-3xl")}
            >
              {collapsed ? "M" : "Mathin"}
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-8 shrink-0 rounded-full p-0 text-muted hover:text-ink"
              aria-label={shellT(collapsed ? "hideNav" : "collapseNav")}
              onClick={() => applySidebarMode(nextDashboardSidebarMode(sidebarMode))}
            >
              {collapsed ? <ChevronsLeft size={16} /> : <PanelLeftClose size={16} />}
            </Button>
          </div>

          <ScrollArea className="relative z-10 min-h-0 flex-1">
            {collapsed ? (
              <TooltipProvider delayDuration={200}>
                <NavList nav={nav} pathname={pathname} collapsed />
              </TooltipProvider>
            ) : (
              <NavList nav={nav} pathname={pathname} />
            )}
          </ScrollArea>

          {/*
            doc 24 §4.3「插图是否影响导航文字」。插图沉在导航之后是有意的（层次感），
            但导航一长就会有三四条 `text-muted` 的链接正好压在望远镜和书堆的线条上——
            插图的笔触和文字笔画粗细相近，扫视时要费一下劲才能读出条目名。
            两处收敛：整体压到近乎水印的浓度；再用自上而下的渐变遮罩，让插图只在
            底部真正留白的那一段显形，上半段完全淡出。装饰不该和导航争对比度。

            图标态不画插图：56px 宽度里它只剩几道无法辨认的笔触，却仍要和图标抢对比度。
          */}
          {collapsed ? null : (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-52 mask-[linear-gradient(to_top,black_0%,black_30%,transparent_95%)]"
              aria-hidden
            >
              <Image
                src="/illustrations/dashboard-observatory.webp"
                alt=""
                fill
                loading="eager"
                sizes="240px"
                className="object-cover object-bottom opacity-[0.14] mix-blend-multiply dark:opacity-[0.12] dark:mix-blend-screen"
              />
            </div>
          )}
        </aside>
      )}

      {/*
        左上主入口承担两个不同的动作，取决于视口档位：
        窄屏（<lg）没有常驻侧栏，按钮打开临时抽屉；宽屏在隐藏态下按钮把侧栏放回来。
        两者共用同一个测量壳，安全区变量因此始终等于"真的有没有按钮挡住页头左上角"。
      */}
      <MainFloatingControl className={cn("fixed left-4 top-4 z-40", sidebarMode !== "hidden" && "lg:hidden")}>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="secondary" size="sm" className="size-11 rounded-full p-0 shadow-lg lg:hidden" aria-label={shellT("openNav")}>
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
        {sidebarMode === "hidden" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-dashboard-nav-floating
            className="hidden size-11 rounded-full p-0 shadow-lg lg:inline-flex"
            aria-label={shellT("expandNav")}
            onClick={() => applySidebarMode(nextDashboardSidebarMode(sidebarMode))}
          >
            <PanelLeftOpen size={18} />
          </Button>
        ) : null}
      </MainFloatingControl>

      {/*
        Dashboard 唯一水平边界（docs/plan/21 §6）：--dashboard-gutter 是 A→B / C→D 的
        单一来源，页头安全占位和 chrome 出血都从它推导。左右必须对称——原先为了避让右上
        悬浮控件加的 lg:pr-24 会让整页正文从头到尾右边多缺一块，那份避让已经改由页头内部
        的透明占位承担。
      */}
      <main
        data-dashboard-canvas
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-y-auto pb-5 [--dashboard-gutter:1rem] px-(--dashboard-gutter) md:[--dashboard-gutter:1.5rem] lg:pb-6 lg:[--dashboard-gutter:2rem] 2xl:[--dashboard-gutter:2.5rem]",
          // panel 工作区的"定高不滚动"需要一份够用的宽度，而不是一个够大的视口；
          // 阈值随侧栏状态变化，规则写在 globals.css 的 .panel-canvas-* 里（doc 27 §3 D4）。
          workspace && "panel-canvas-clip",
        )}
      >
        <div
          data-dashboard-content
          data-dashboard-workspace={workspace ? "true" : undefined}
          className={cn("min-w-0", workspace && "min-h-0 flex-1 panel-canvas-flex")}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
