"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ClassWorkspaceCommandPanel } from "./ClassWorkspaceCommandPanel";
import { DashboardPage } from "./dashboard-page";
import { RouteTabs } from "./navigation/RouteTabs";
import { classWorkHref, workEntryMessages, type WorkEntryQuery } from "./work-entry-contract";
import rosterLayout from "./class-roster-layout.module.css";

/** 名册和学情进度共用班级卡片，只切换正文内容。 */
export function ClassRosterWorkspace({ view, query, canTeach, disabled = false, navigation, grouping, period, actions, footer, children, onViewChange }: {
  view: "arrange" | "progress"; query: WorkEntryQuery; canTeach: boolean; disabled?: boolean;
  navigation?: ReactNode; grouping?: ReactNode; period?: ReactNode; actions?: ReactNode; footer?: ReactNode; children: ReactNode;
  onViewChange?: (view: "arrange" | "progress") => void;
}) {
  const locale = useLocale();
  const m = workEntryMessages(locale);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const table = root.current?.querySelector<HTMLTableElement>("[data-class-identity-table]");
    if (!table) return;
    const cells = [...table.querySelectorAll<HTMLTableCellElement>(":scope > thead > tr > [data-class-sticky]")];
    // 读取实际表头宽度，跟随语言、筛选和窗口变化，保持四列紧邻。
    const sync = () => {
      let left = 0;
      for (const cell of cells) {
        table.style.setProperty(`--class-column-${cell.dataset.classSticky}-left`, `${left}px`);
        left += cell.getBoundingClientRect().width;
      }
    };
    sync();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sync);
      return () => window.removeEventListener("resize", sync);
    }
    const observer = new ResizeObserver(sync);
    cells.forEach(cell => observer.observe(cell));
    return () => observer.disconnect();
  }, [view]);
  return <div ref={root} data-class-workspace data-class-content={view} className={rosterLayout.workspace}>
    <DashboardPage title={m.classes} density="compact" commandPanel={<ClassWorkspaceCommandPanel
      navigation={navigation} grouping={grouping} period={period}
      actions={<>{actions}{canTeach && <div data-class-content-switch inert={disabled || undefined} aria-disabled={disabled || undefined} className={cn(disabled && "opacity-50")}>
        {onViewChange ? <div role="group" aria-label={locale.startsWith("en") ? "Class content" : "班级内容"} className="flex rounded-lg bg-line/40 p-1">
          {(["arrange", "progress"] as const).map(value => <Button key={value} size="sm" variant="ghost" aria-pressed={view === value} disabled={disabled}
            className={cn("h-7 px-2 text-xs", view === value && "bg-card text-ink shadow-sm")} onClick={() => onViewChange(value)}>
            {value === "arrange" ? locale.startsWith("en") ? "All students" : "全部学生" : locale.startsWith("en") ? "Learning progress" : "学情进度"}
          </Button>)}
        </div> : <RouteTabs ariaLabel={locale.startsWith("en") ? "Class content" : "班级内容"} activeValue={view}
          items={[
            { value: "arrange", label: locale.startsWith("en") ? "All students" : "全部学生", href: classWorkHref("arrange", query) },
            { value: "progress", label: locale.startsWith("en") ? "Learning progress" : "学情进度", href: classWorkHref("progress", query) },
          ]} className="[&_a]:min-h-7 [&_a]:px-2 [&_a]:text-xs" />}
      </div>}</>}
    />} footer={footer}>{children}</DashboardPage>
  </div>;
}
