import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { classRosterLocation, classRosterMessages } from "./class-roster-presentation-contract";
import type { PlacementRosterRow } from "./placement-table-fields";

/** 同一班级在宽屏按列比较，窄屏先定位时间与地点，再打开名单和课次。 */
export function ClassRosterClassSummary({ row, locale, className, courseTitle, time, teacher, showTeacher, grade, level, disclosure,
  rosterId, rosterOpen, onRosterToggle, lessonCount, lessonsOpen, onLessonsToggle, disabled }: {
  row: PlacementRosterRow; locale: string; className: string; courseTitle?: string; time: string; teacher: string; showTeacher: boolean; grade: string; level: string;
  disclosure?: ReactNode; rosterId: string; rosterOpen: boolean; onRosterToggle: () => void;
  lessonCount?: number; lessonsOpen: boolean; onLessonsToggle: () => void; disabled: boolean;
}) {
  const m = classRosterMessages(locale);
  const location = classRosterLocation(row, locale);
  const count = row.classroom ? `${row.classroom.activeCount}/${row.classroom.capacity ?? "∞"}` : String(row.sourceEnrollments?.length ?? 0);
  return <div className="flex min-w-0 items-start gap-1">
    <span data-class-desktop>{disclosure}</span>
    <div className="min-w-0 flex-1">
      <p data-class-mobile className="whitespace-normal break-words text-base font-medium leading-6 tabular-nums">{time}</p>
      <Popover><PopoverTrigger asChild><Button data-class-info variant="ghost" size="sm" className="h-auto min-h-0 w-full justify-start whitespace-normal px-0 py-0 text-left font-normal hover:bg-transparent hover:underline" aria-label={`${m.info} · ${className}`}>
        <span className="min-w-0 break-words">
          <span data-class-desktop><span className="block font-medium leading-5">{location.campus}</span>{location.room && <span className="block text-[11px] leading-5 text-muted">{location.room}</span>}</span>
          <span data-class-mobile className="text-sm">{location.campus}{location.room && <span className="text-muted"> · {location.room}</span>}</span>
        </span>
      </Button></PopoverTrigger>
        <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] space-y-2 p-3 text-sm">
          <p className="break-words font-medium">{className}</p><p className="break-words text-muted">{courseTitle}</p>
          <p className="break-words text-muted">{grade} · {m.level} {level}{teacher ? ` · ${teacher}` : ""}</p>
          <p className="text-muted">{m.roster} {count}</p>
          {row.historical && <p className="text-muted">{row.historical.registered_on || "—"} · {row.historical.amount ?? row.historical.amount_original}</p>}
          {row.classroom && <Link href={`/dashboard/classes/${row.classroom.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>{m.details}</Link>}
        </PopoverContent>
      </Popover>
      <div data-class-mobile className="space-y-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted"><span>{grade}</span><span>{m.level} {level}</span>{showTeacher && teacher && <span>{teacher}</span>}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant={rosterOpen ? "secondary" : "ghost"} size="sm" className="min-h-10 px-3 text-sm" disabled={disabled}
            data-class-roster-toggle={row.key} aria-expanded={rosterOpen} aria-controls={rosterId} aria-label={`${rosterOpen ? m.hideRoster : m.showRoster} · ${className}`}
            onClick={onRosterToggle}>{m.roster} <span className="tabular-nums">{count}</span></Button>
          {lessonCount !== undefined && <Button variant={lessonsOpen ? "secondary" : "ghost"} size="sm" className="min-h-10 px-3 text-sm" disabled={disabled}
            aria-expanded={lessonsOpen} onClick={onLessonsToggle}>{m.lessons} <span className="tabular-nums">{lessonCount}</span></Button>}
        </div>
      </div>
    </div>
  </div>;
}
