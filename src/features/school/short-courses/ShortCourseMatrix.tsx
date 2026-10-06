"use client";

import dynamic from "next/dynamic";
import { Fragment, useCallback, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardTableShell } from "../dashboard-page";
import { DashboardTablePagination } from "../dashboard-page/DashboardTablePagination";
import { withReturnTo } from "../object-workspace/return-target";
import { shortCourseHref, shortCourseListHref, SHORT_COURSE_PAGE_SIZE, type ShortCourseListRow, type shortCourseFilters } from "./contract";
import { shortCourseMessages } from "./messages";

const LessonDetail = dynamic(() => import("../ClassRosterSessionDetail").then(module => module.ClassRosterSessionDetail));

function OpenLesson({ sessionId, classroomId, locale, timeZone, now, returnTo, onDirty }: {
  sessionId: string; classroomId: string; locale: string; timeZone: string; now: number; returnTo: string;
  onDirty: (id: string, value: boolean) => void;
}) {
  const changed = useCallback((value: boolean) => onDirty(sessionId, value), [onDirty, sessionId]);
  return <LessonDetail sessionId={sessionId} classroomId={classroomId} locale={locale} timeZone={timeZone} now={now} returnTo={returnTo} onDirtyChange={changed} />;
}

export function ShortCourseMatrix({ rows, locale, timeZone, now, returnTo, total, filters, focusedSessionId }: {
  rows: ShortCourseListRow[]; locale: string; timeZone: string; now: number; returnTo: string;
  total?: number; filters?: ReturnType<typeof shortCourseFilters>; focusedSessionId?: string;
}) {
  const m = shortCourseMessages(locale);
  const focusedClass = rows.find(row => row.sessions.some(session => session.id === focusedSessionId));
  const [open, setOpen] = useState<Record<string, string | null>>(() => focusedClass && focusedSessionId ? { [focusedClass.id]: focusedSessionId } : {});
  const [visited, setVisited] = useState<string[]>(() => focusedSessionId ? [focusedSessionId] : []);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const onDirty = useCallback((id: string, value: boolean) => setDirty(current => current[id] === value ? current : { ...current, [id]: value }), []);
  const columns = rows.length ? Math.max(1, ...rows.map(row => Math.max(row.sessionCount ?? 0, row.sessions.length))) : 4;
  const dateFormat = new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const toggle = (classId: string, sessionId: string) => {
    if (open[classId] && dirty[open[classId]!]) { setNotice(locale.startsWith("en") ? "Wait for the current lesson to finish saving." : "当前课次仍在保存，请处理提示后再切换。"); return; }
    setNotice(null);
    setVisited(current => current.includes(sessionId) ? current : [...current, sessionId]);
    setOpen(current => ({ ...current, [classId]: current[classId] === sessionId ? null : sessionId }));
  };
  return <div className="space-y-3">
    {notice && <p role="alert" className="text-xs text-rose">{notice}</p>}
    <DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow>
      <TableHead className="min-w-44">{m.name}</TableHead><TableHead>{m.level}</TableHead><TableHead>{m.teacher}</TableHead><TableHead>{m.enrolled}</TableHead>
      {Array.from({ length: columns }, (_, index) => <TableHead key={index} className="min-w-40">{m.lesson(index + 1)}</TableHead>)}
    </TableRow></TableHeader><TableBody>
      {rows.map(row => <Fragment key={row.id}><TableRow>
        <TableCell mobileLabel={m.name}><Link href={withReturnTo(shortCourseHref(row.id), returnTo)} className="font-medium underline-offset-4 hover:underline">{row.name}</Link>
          <p className="mt-1 text-xs text-muted">{row.batchName ?? m.noBatch} · {m[row.status]}</p>
        </TableCell>
        <TableCell mobileLabel={m.level}>{row.level ? m[row.level] : "—"}{row.grades.length > 0 && <p className="mt-1 text-xs text-muted">{m.grades} {row.grades.join(" / ")}</p>}</TableCell>
        <TableCell mobileLabel={m.teacher} className="whitespace-nowrap">{row.teacherName || m.unspecified}</TableCell>
        <TableCell mobileLabel={m.enrolled}><span className="tabular-nums">{row.enrolledCount} / {row.capacity ?? "—"}</span>{row.plannedStudents !== null && <p className="mt-1 whitespace-nowrap text-xs text-muted">{m.planned} {row.plannedStudents}</p>}</TableCell>
        {Array.from({ length: columns }, (_, index) => {
          const session = row.sessions[index];
          if (!session) return <TableCell key={index} mobileLabel={m.lesson(index + 1)}>—</TableCell>;
          const status = session.voided ? m.voided : session.cancelled ? m.cancelled : session.endedAt ? m.ended : session.startedAt ? m.started : m.ready;
          const isOpen = open[row.id] === session.id;
          return <TableCell key={session.id} mobileLabel={m.lesson(index + 1)} className={isOpen ? "bg-followup-detail" : ""}>
            <Button variant="ghost" size="sm" className="h-auto w-full justify-start px-1 py-1 text-left" aria-expanded={isOpen} aria-controls={`short-lesson-${session.id}`} onClick={() => toggle(row.id, session.id)}>
              {isOpen ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
              <span className="space-y-1"><span className="block whitespace-nowrap text-xs">{session.scheduledAt ? dateFormat.format(new Date(session.scheduledAt)) : m.noDate}</span><span className="block text-[11px] text-muted">{status}</span></span>
            </Button>
          </TableCell>;
        })}
      </TableRow>
        {row.sessions.filter(session => visited.includes(session.id)).map(session => <TableRow key={`detail-${session.id}`} hidden={open[row.id] !== session.id} style={open[row.id] !== session.id ? { display: "none" } : undefined} className="bg-followup-detail">
          <TableCell colSpan={columns + 4} id={`short-lesson-${session.id}`} className="p-3">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs"><span className="font-medium">{row.name} · {session.name}</span>
              <Link href={`${shortCourseHref(row.id)}?manage=${session.id}`} className="underline underline-offset-4">{m.manageLesson}</Link>
            </div>
            <OpenLesson sessionId={session.id} classroomId={row.id} locale={locale} timeZone={timeZone} now={now} returnTo={returnTo} onDirty={onDirty} />
          </TableCell>
        </TableRow>)}
      </Fragment>)}
      {!rows.length && <TableRow><TableCell colSpan={columns + 4} className="h-36 text-center text-sm text-muted">{m.empty}</TableCell></TableRow>}
    </TableBody></Table></DashboardTableShell>
    {filters && total !== undefined && <DashboardTablePagination currentPage={filters.page} totalPages={Math.max(1, Math.ceil(total / SHORT_COURSE_PAGE_SIZE))}
      totalCount={total} pageSize={SHORT_COURSE_PAGE_SIZE} pageSizes={[SHORT_COURSE_PAGE_SIZE]} onPageSizeChange={() => undefined}
      hrefFor={page => shortCourseListHref(filters, page)} disabled={Object.values(dirty).some(Boolean)} />}
  </div>;
}
