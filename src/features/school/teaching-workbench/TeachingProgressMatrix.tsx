"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BookOpenCheck, ClipboardList, FilePenLine, Lightbulb, Megaphone, MessagesSquare, RefreshCw, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ClassRosterTermPicker } from "../ClassRosterTermPicker";
import { ClassWorkspaceTabs } from "../ClassWorkspaceTabs";
import { ClassWorkspaceMemory } from "../ClassWorkspaceMemory";
import { ClassWorkspaceActions } from "../ClassWorkspaceActions";
import { ClassWorkspaceCommandPanel } from "../ClassWorkspaceCommandPanel";
import { classSessionMessages } from "../class-roster-session-contract";
import { workEntryHref, workEntryMessages, type WorkEntryQuery } from "../work-entry-contract";
import { DashboardPage, DashboardTableColumnHeader, DashboardTableShell } from "../dashboard-page";
import { FollowupRecordRow, FollowupTableBody } from "../dashboard-page/FollowupRecordRow";
import { DashboardTablePagination } from "../dashboard-page/DashboardTablePagination";
import { useDashboardFieldView } from "../dashboard-page/useDashboardFieldView";
import type { DashboardFieldDefinitions } from "../dashboard-page/dashboard-table-field-contract";
import {
  TEACHING_PROGRESS_ITEMS, TEACHING_PROGRESS_TONES, teachingMatrixColumns, teachingMatrixMessages, teachingMatrixSessions, teachingMatrixTeachers,
  type TeachingProgressClass, type TeachingProgressMatrixData, type TeachingProgressSession, type TeachingProgressTerm,
} from "./teaching-progress-matrix-contract";

const SessionDetail = dynamic(() => import("../ClassRosterSessionDetail").then(module => module.ClassRosterSessionDetail), {
  loading: () => <div role="status" className="h-24 animate-pulse bg-moon/10" />,
});
const icons = { solution: BookOpenCheck, lesson_plan: FilePenLine, rehearsal_video: Video, learning: Users,
  class_feedback: Megaphone, homework: ClipboardList, communication: MessagesSquare, reflection: Lightbulb };
const columns = { campus: ["campus"], time: ["time"], teacher: ["teacher"], level: ["level"] } as const;
const DETAILS_LAYOUT = "[&>tbody>tr[data-followup-inline-details]>td>[data-dashboard-inline-entry]]:sticky [&>tbody>tr[data-followup-inline-details]>td>[data-dashboard-inline-entry]]:left-3 [&>tbody>tr[data-followup-inline-details]>td>[data-dashboard-inline-entry]]:w-[var(--teaching-matrix-width)] [&>tbody>tr[data-followup-inline-details]>td>[data-dashboard-inline-entry]]:max-w-full";

export function TeachingProgressMatrix({ data, terms, termId, query, locale, timeZone, now }: {
  data: TeachingProgressMatrixData; terms: TeachingProgressTerm[]; termId?: string; query: WorkEntryQuery;
  locale: string; timeZone: string; now: number;
}) {
  const m = teachingMatrixMessages(locale), sessionM = classSessionMessages(locale), workM = workEntryMessages(locale);
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => typeof query.session === "string" && data.sessions.some(row => row.id === query.session) ? query.session : null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const canLeave = useCallback(() => { if (dirtyRef.current) toast.info(sessionM.draft); return !dirtyRef.current; }, [sessionM.draft]);
  const onDirtyChange = useCallback((value: boolean) => {
    const finished = dirtyRef.current && !value;
    dirtyRef.current = value; setDirty(value);
    if (finished) router.refresh();
  }, [router]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => element.style.setProperty("--teaching-matrix-width", `${Math.max(0, entries[0].contentRect.width - 26)}px`));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest("a[href]");
      if (!link || event.ctrlKey || event.metaKey || link.getAttribute("target") === "_blank") return;
      event.preventDefault(); event.stopPropagation(); toast.info(sessionM.draft);
    };
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    document.addEventListener("click", guard, true); window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("click", guard, true); window.removeEventListener("beforeunload", unload); };
  }, [dirty, sessionM.draft]);

  const sessionByClass = useMemo(() => {
    const map = new Map<string, TeachingProgressSession[]>();
    for (const session of data.sessions) map.set(session.classroomId, [...(map.get(session.classroomId) ?? []), session]);
    return map;
  }, [data.sessions]);
  const schedule = useCallback((row: TeachingProgressClass) => {
    const dayTime = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    const clock = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
    return [...new Set((sessionByClass.get(row.id) ?? []).flatMap(session => session.scheduledAt
      ? [`${dayTime.format(new Date(session.scheduledAt))}${session.duration ? `–${clock.format(new Date(Date.parse(session.scheduledAt) + session.duration * 60_000))}` : ""}`] : []))].join(" / ") || m.unscheduled;
  }, [sessionByClass, locale, timeZone, m.unscheduled]);
  const teacherNames = (row: TeachingProgressClass) => teachingMatrixTeachers(row, sessionByClass.get(row.id) ?? [])
    .map(teacher => `${teacher.name || m.unassigned}${teacher.substitute ? ` (${m.substitute})` : ""}`).join("、") || m.unassigned;
  const fields = useMemo<DashboardFieldDefinitions<TeachingProgressClass>>(() => ({
    campus: { kind: "enum", label: m.campus, values: row => [{ value: row.campus ?? "unset", label: row.campus || m.unset }], sortValue: row => row.campus },
    time: { kind: "text", label: m.time, value: schedule },
    teacher: { kind: "enum", label: m.teacher, values: row => {
      const people = teachingMatrixTeachers(row, sessionByClass.get(row.id) ?? []);
      return people.length ? people.map(person => ({ value: person.id, label: person.name || m.unassigned })) : [{ value: "unassigned", label: m.unassigned }];
    }, sortValue: row => teachingMatrixTeachers(row, sessionByClass.get(row.id) ?? []).map(person => person.name).join("、") },
    level: { kind: "enum", label: m.level, values: row => row.level ? [{ value: row.level, label: row.level }] : [], sortValue: row => row.level },
  }), [m.campus, m.time, m.teacher, m.level, m.unset, m.unassigned, schedule, sessionByClass]);
  const initialTeacher = typeof query.teacher === "string" ? query.teacher : undefined;
  const rows = data.classrooms.filter(row => (!query.classroom || row.id === query.classroom) && (!search.trim()
    || [row.name, row.courseTitle, row.campus, ...teachingMatrixTeachers(row, sessionByClass.get(row.id) ?? []).map(person => person.name)].join(" ").toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale))));
  const table = useDashboardFieldView({ rows, fields, columns, persistenceKey: initialTeacher ? undefined : "teaching-progress-matrix", context: { locale, timeZone, now },
    initialQuery: { version: 2, filters: initialTeacher ? { teacher: { kind: "enum", values: [initialTeacher] } } : {}, sort: null },
    onQueryChange: () => { setPage(1); setSelected(null); },
  });
  const sorted = [...table.visibleRows].sort((a, b) => (a.termId ?? "").localeCompare(b.termId ?? "") || (a.grade ?? 99) - (b.grade ?? 99));
  const columnProps = (column: keyof typeof columns) => {
    const props = table.columnProps(column);
    return { ...props, disabled: dirty, fields: props.fields.map(field => ({ ...field, disabled: dirty || field.disabled,
      onFilterChange: (value: Parameters<typeof field.onFilterChange>[0]) => { if (canLeave()) field.onFilterChange(value); },
      onSortChange: (value: Parameters<typeof field.onSortChange>[0]) => { if (canLeave()) field.onSortChange(value); },
    })), onClearColumn: () => { if (canLeave()) props.onClearColumn(); }, onClearAll: () => { if (canLeave()) props.onClearAll(); } };
  };
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize)), currentPage = Math.min(page, pages);
  const visible = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const lessonColumns = teachingMatrixColumns(data.sessions.filter(session => table.visibleRows.some(row => row.id === session.classroomId)));
  const columnCount = 4 + Math.max(1, lessonColumns.length);
  const workspaceQuery = { ...query, view: "progress", term: termId ?? "all" };
  const currentSession = data.sessions.find(session => session.id === selected);
  const termsById = new Map(terms.map(term => [term.id, term.name]));
  const choose = (session: TeachingProgressSession) => {
    if (!canLeave()) return;
    setActive(session.classroomId); setSelected(selected === session.id ? null : session.id);
  };
  const date = (at: string | null) => at ? new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(at)) : m.unscheduled;
  const hasUnavailable = data.sessions.some(session => TEACHING_PROGRESS_ITEMS.some(kind => session.progress[kind].state === "unavailable"));
  return <DashboardPage title={workM.classes} density="compact" commandPanel={<ClassWorkspaceCommandPanel
    navigation={<><ClassWorkspaceMemory query={workspaceQuery} /><ClassWorkspaceTabs active="progress" canTeach query={workspaceQuery} /></>}
    period={<ClassRosterTermPicker terms={terms} selectedId={termId} disabled={dirty} onChange={id => {
      if (canLeave()) router.replace(workEntryHref("/dashboard/classes", query, { view: "progress", term: id ?? "all", session: undefined, classroom: undefined, period: undefined, date: undefined }));
    }} />}
    actions={<>
      <Input value={search} disabled={dirty} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={m.search} aria-label={m.search} className="h-8 w-44 text-xs" />
      <Button size="sm" variant="ghost" disabled={dirty} onClick={() => router.refresh()} aria-label={m.refresh}><RefreshCw size={14} /><span className="hidden sm:inline">{m.refresh}</span></Button>
      <ClassWorkspaceActions canTeach query={workspaceQuery} filters={<div className="flex flex-wrap gap-2">{(Object.keys(columns) as (keyof typeof columns)[]).map(column => <DashboardTableColumnHeader key={column} label={m[column]} {...columnProps(column)} />)}</div>} />
    </>}
  />}>
    <div ref={root} className="min-w-0 space-y-3" data-teaching-progress-matrix>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted" aria-label={m.title}>
        <div className="flex flex-wrap gap-x-3 gap-y-1">{TEACHING_PROGRESS_ITEMS.map(kind => { const Icon = icons[kind]; return <span key={kind} className="inline-flex items-center gap-1"><Icon size={14} aria-hidden />{m.items[kind]}</span>; })}</div>
        <div className="flex items-center gap-3">{(["incomplete", "review", "archived"] as const).map(state => <span key={state} className={cn("inline-flex items-center gap-1.5", TEACHING_PROGRESS_TONES[state])}><span aria-hidden className="size-1.5 rounded-full bg-current" />{m.states[state]}</span>)}</div>
      </div>
      {hasUnavailable && <p role="status" className="text-xs text-muted">{m.partial}</p>}
      <TooltipProvider delayDuration={250}><DashboardTableShell><Table className={cn("w-full table-auto text-xs", DETAILS_LAYOUT)} containerClassName="max-h-[75dvh] overflow-auto" aria-label={m.title}>
        <TableHeader><TableRow className="[&>th]:h-9 [&>th]:px-2">
          <TableHead className="sticky left-0 top-0 z-30 min-w-40 border-r border-line bg-card lg:min-w-24"><DashboardTableColumnHeader label={m.campus} {...columnProps("campus")} /></TableHead>
          <TableHead className="sticky top-0 z-20 hidden min-w-36 border-r border-line bg-card lg:table-cell"><DashboardTableColumnHeader label={m.time} {...columnProps("time")} /></TableHead>
          <TableHead className="sticky top-0 z-20 hidden min-w-20 border-r border-line bg-card lg:table-cell"><DashboardTableColumnHeader label={m.teacher} {...columnProps("teacher")} /></TableHead>
          <TableHead className="sticky top-0 z-20 hidden border-r border-line bg-card lg:table-cell"><DashboardTableColumnHeader label={m.level} {...columnProps("level")} /></TableHead>
          {lessonColumns.length ? lessonColumns.map(column => <TableHead key={column.key} className="sticky top-0 z-20 min-w-28 border-r border-line bg-card text-center font-medium last:border-r-0">{column.lectureNo === null ? m.unspecified : m.lesson(column.lectureNo)}</TableHead>)
            : <TableHead className="sticky top-0 z-20 bg-card">{m.noLessons}</TableHead>}
        </TableRow></TableHeader>
        <FollowupTableBody navigation="tree" onNavigate={key => { setActive(key); return true; }}>
          {!visible.length && <TableRow><TableCell colSpan={columnCount} className="h-40 text-center text-muted">{data.classrooms.length ? m.filterEmpty : m.empty}</TableCell></TableRow>}
          {visible.map((row, index) => {
            const classSessions = sessionByClass.get(row.id) ?? [];
            const expanded = currentSession?.classroomId === row.id;
            const detailsId = `teaching-matrix-${row.id}`;
            const group = `${row.termId}:${row.grade}`;
            const previous = visible[index - 1];
            return <Fragment key={row.id}>
              {(!previous || `${previous.termId}:${previous.grade}` !== group) && <TableRow className="hover:bg-transparent"><TableCell colSpan={columnCount} className="h-8 bg-paper px-2 py-1 font-medium"><span className="sticky left-2">{row.grade ? m.gradeLabel(row.grade) : m.unknownGrade}<span className="ml-3 font-normal text-muted">{termsById.get(row.termId ?? "") ?? "—"}</span></span></TableCell></TableRow>}
              <FollowupRecordRow rowKey={row.id} active={active === row.id} expanded={expanded} onActivate={() => setActive(row.id)}
                onExpandedChange={open => { if (!canLeave()) return; setSelected(open ? classSessions[0]?.id ?? null : null); }}
                rowProps={{ "data-teaching-class": row.id }} detailsId={detailsId} title={`${row.name} · ${currentSession?.title || m.untitled}`} colSpan={columnCount}
                summary={<>
                  <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1">
                    <Popover><PopoverTrigger asChild><Button size="sm" variant="ghost" className="h-auto min-h-8 justify-start px-0 py-1 text-xs font-normal" aria-label={`${m.classroom} · ${row.name}`}>
                      <span className="text-left"><span className="block">{row.campus || m.unset}</span><span className="mt-1 block max-w-40 text-[11px] leading-5 text-muted lg:hidden">{schedule(row)}<br />{teacherNames(row)} · {row.level || "—"}</span></span>
                    </Button></PopoverTrigger><PopoverContent align="start" className="w-72 space-y-2 p-3 text-xs"><p className="font-medium">{row.name}</p><p>{row.courseTitle}</p><p className="text-muted">{row.campus || m.unset} · {row.room || "—"}</p><Link href={`/dashboard/classes/${row.id}`} className="underline underline-offset-4">{m.classroom}</Link></PopoverContent></Popover>
                  </TableCell>
                  <TableCell className="hidden border-r border-line px-2 py-1 text-[11px] lg:table-cell"><span className="block max-w-56 whitespace-normal leading-5">{schedule(row)}</span></TableCell>
                  <TableCell className="hidden border-r border-line px-2 py-1 lg:table-cell"><span className="block max-w-32 whitespace-normal leading-5">{teacherNames(row)}</span></TableCell>
                  <TableCell className="hidden border-r border-line px-1 py-1 text-center lg:table-cell">{row.level || "—"}</TableCell>
                  {lessonColumns.length ? lessonColumns.map(column => {
                    const lessons = teachingMatrixSessions(classSessions, row.id, column.lectureNo);
                    return <TableCell key={column.key} className="border-r border-line p-0 last:border-r-0">
                      {lessons.length ? lessons.map(session => <button key={session.id} type="button" data-teaching-session={session.id}
                        aria-expanded={selected === session.id} aria-controls={detailsId} disabled={dirty && selected !== session.id}
                        aria-label={`${m.open} · ${row.name} · ${column.lectureNo === null ? session.title || m.untitled : m.lesson(column.lectureNo)} · ${TEACHING_PROGRESS_ITEMS.map(kind => `${m.items[kind]}：${m.states[session.progress[kind].state]}`).join("；")}`}
                        className={cn("block w-full px-3 py-2 text-left hover:bg-moon/20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-crater", selected === session.id && "bg-moon/25")}
                        onClick={() => choose(session)}>
                        {(lessons.length > 1 || column.lectureNo === null) && <span className="mb-1 block max-w-32 truncate text-[10px] text-muted" title={session.title}>{column.lectureNo === null ? session.title || m.untitled : date(session.scheduledAt)}</span>}
                        <span className="grid grid-cols-4 justify-items-center gap-x-2 gap-y-2">{TEACHING_PROGRESS_ITEMS.map(kind => {
                          const Icon = icons[kind], progress = session.progress[kind];
                          return <Tooltip key={kind}><TooltipTrigger asChild><span className={cn("inline-flex size-4 items-center justify-center", TEACHING_PROGRESS_TONES[progress.state])}>
                            <Icon size={16} strokeWidth={1.7} aria-hidden />
                          </span></TooltipTrigger><TooltipContent>{m.items[kind]} · {m.states[progress.state]}<span className="ml-1 text-[11px]">{m.reasons[progress.reason]}</span></TooltipContent></Tooltip>;
                        })}</span>
                      </button>) : <span className="block px-3 py-3 text-center text-muted" aria-label={m.noLessons}>—</span>}
                    </TableCell>;
                  }) : <TableCell className="text-muted">{m.noLessons}</TableCell>}
                </>}>
                {() => currentSession && <div className="min-w-0 space-y-4" data-class-session-editor>
                  <p className="text-xs text-muted">{currentSession.lectureNo !== null && `${m.lesson(currentSession.lectureNo)} · `}{date(currentSession.scheduledAt)}{currentSession.teacherOverride && ` · ${m.teacher}：${currentSession.teacherOverride.name || m.unassigned}`}</p>
                  <DashboardTableShell><Table mobileLayout="stacked" aria-label={`${m.title} · ${currentSession.title}`}><TableHeader><TableRow>
                    <TableHead>{m.item}</TableHead><TableHead>{m.status}</TableHead><TableHead>{m.record}</TableHead>
                  </TableRow></TableHeader><TableBody>{TEACHING_PROGRESS_ITEMS.map(kind => {
                    const Icon = icons[kind], progress = currentSession.progress[kind];
                    return <TableRow key={kind}><TableCell mobileSpan="primary" mobileLabel={m.item}><span className="inline-flex items-center gap-2"><Icon size={15} className={TEACHING_PROGRESS_TONES[progress.state]} aria-hidden />{m.items[kind]}</span></TableCell>
                      <TableCell mobileLabel={m.status} className={TEACHING_PROGRESS_TONES[progress.state]}>{m.states[progress.state]}</TableCell>
                      <TableCell mobileLabel={m.record}><span>{m.reasons[progress.reason]}</span><span className="ml-3 text-[11px] text-muted">{m.sources[kind]}</span></TableCell></TableRow>;
                  })}</TableBody></Table></DashboardTableShell>
                  <h3 className="text-sm font-medium">{m.details}</h3>
                  <SessionDetail key={currentSession.id} sessionId={currentSession.id} classroomId={row.id} locale={locale} timeZone={timeZone} now={now} onDirtyChange={onDirtyChange} />
                </div>}
              </FollowupRecordRow>
            </Fragment>;
          })}
        </FollowupTableBody>
      </Table></DashboardTableShell></TooltipProvider>
      <DashboardTablePagination currentPage={currentPage} totalPages={pages} totalCount={sorted.length} pageSize={pageSize} pageSizes={[20, 50, 100]} disabled={dirty}
        onPageChange={value => { if (canLeave()) { setPage(value); setSelected(null); } }} onPageSizeChange={value => { if (canLeave()) { setPageSize(value); setPage(1); setSelected(null); } }} />
    </div>
  </DashboardPage>;
}
