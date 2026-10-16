import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { classRosterLocation, classRosterMessages } from "./class-roster-presentation-contract";
import type { PlacementRosterRow } from "./placement-table-fields";

/** 同一班级在宽屏按列比较，窄屏先定位时间与地点，再打开名单和课次。 */
export function ClassRosterClassSummary({ row, locale, className, courseTitle, time, teacher, showTeacher, grade, level, disclosure,
  rosterId, rosterOpen, onRosterToggle, lessonCount, lessonsOpen, onLessonsToggle, disabled, contentLabel, contentCount, entryAction }: {
  row: PlacementRosterRow; locale: string; className: string; courseTitle?: string; time: string; teacher: string; showTeacher: boolean; grade: string; level: string;
  disclosure?: ReactNode; rosterId: string; rosterOpen: boolean; onRosterToggle: () => void;
  lessonCount?: number; lessonsOpen: boolean; onLessonsToggle: () => void; disabled: boolean;
  contentLabel?: string; contentCount?: number; entryAction?: ReactNode;
}) {
  const m = classRosterMessages(locale);
  const location = classRosterLocation(row, locale);
  const count = row.classroom ? `${row.classroom.activeCount}/${row.classroom.capacity ?? "∞"}` : String(row.sourceEnrollments?.length ?? 0);
  return <div className="flex min-w-0 items-start gap-1">
    <span data-class-desktop>{disclosure}</span>
    <div className="min-w-0 flex-1">
      <div data-class-mobile>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 break-words text-sm font-medium leading-6 tabular-nums">{time}</p>
          {row.classroom && <Link data-class-open href={`/dashboard/classes/${row.classroom.id}`} className="inline-flex min-h-10 shrink-0 items-center text-xs text-ink underline underline-offset-4">{m.openClass}</Link>}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted"><span>{location.campus}</span><span>{grade}</span><span>{m.level} {level}</span>{showTeacher && teacher && <span>{teacher}</span>}</p>
      </div>
      <span data-class-desktop><Popover><PopoverTrigger asChild><Button data-class-info variant="ghost" size="sm" className="h-auto min-h-0 w-full justify-start whitespace-normal px-0 py-0 text-left text-xs font-normal hover:bg-transparent hover:underline" aria-label={`${m.info} · ${className}`}>
        <span className="min-w-0 break-words">
          <span className="block leading-5 text-ink">{location.campus}</span>
        </span>
      </Button></PopoverTrigger>
        <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] space-y-2 p-3 text-sm">
          <p className="break-words font-medium">{className}</p><p className="break-words text-muted">{courseTitle}</p>
          <p className="break-words text-muted">{m.campus} {location.campus}{location.room && <> · {m.room} {location.room}</>}</p>
          <p className="break-words text-muted">{grade} · {m.level} {level}{teacher ? ` · ${teacher}` : ""}</p>
          <p className="text-muted">{m.roster} {count}</p>
          {row.historical && <p className="text-muted">{row.historical.registered_on || "—"} · {row.historical.amount ?? row.historical.amount_original}</p>}
          {row.classroom && <Link href={`/dashboard/classes/${row.classroom.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>{m.details}</Link>}
        </PopoverContent>
      </Popover></span>
      {entryAction && <div data-class-desktop className="pt-1">{entryAction}</div>}
      <div data-class-mobile>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant={rosterOpen ? "secondary" : "ghost"} size="sm" className="min-h-10 px-2 text-xs" disabled={disabled}
            data-class-roster-toggle={row.key} aria-expanded={rosterOpen} aria-controls={rosterId} aria-label={`${contentLabel ? `${locale.startsWith("en") ? rosterOpen ? "Hide" : "Show" : rosterOpen ? "收起" : "展开"}${locale.startsWith("en") ? " " : ""}${contentLabel}` : rosterOpen ? m.hideRoster : m.showRoster} · ${className}`}
            onClick={onRosterToggle}>{contentLabel ?? m.roster} <span className="tabular-nums">{contentCount ?? count}</span></Button>
          {lessonCount !== undefined && <Button data-class-lessons-toggle variant={lessonsOpen ? "secondary" : "ghost"} size="sm" className="min-h-10 px-2 text-xs" disabled={disabled}
            aria-expanded={lessonsOpen} onClick={onLessonsToggle}>{m.lessons} <span className="tabular-nums">{lessonCount}</span></Button>}
          {entryAction}
        </div>
      </div>
    </div>
  </div>;
}
