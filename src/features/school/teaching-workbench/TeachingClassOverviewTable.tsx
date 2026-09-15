"use client";

import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { DashboardEmptyState, DashboardSection, DashboardTableShell, useDashboardTableView, type DashboardTableColumnDefinition } from "../dashboard-page";
import { DashboardTableColumnHeader } from "../dashboard-page/DashboardTableColumnHeader";
import { FollowupRecordRow, FollowupTableBody } from "../dashboard-page/FollowupRecordRow";
import { adjacentFollowupKey, followupKeyboardCommand, followupKeyContext } from "../followup-keyboard";
import { leadPaginationTokens } from "../lead-pagination";
import { withReturnTo } from "../object-workspace/return-target";
import { groupTeachingClasses, hasTeachingRecords, type TeachingClassOverview, type TeachingRecordSnippet } from "./teaching-class-overview-contract";
import type { TeachingRecordCache } from "./teaching-records-client";

const InlineRecords = dynamic(() => import("./TeachingInlineRecords").then(module => module.TeachingInlineRecords), { loading: () => <InlineLoading /> });
function InlineLoading() {
  const t = useTranslations("school.teachingWorkbench.records");
  return <p role="status" className="py-3 text-sm text-muted">{t("loading")}</p>;
}

type ClassRow = ReturnType<typeof groupTeachingClasses>[number];
type Column = "classroom" | "teacher" | "sessions" | "attendance" | "learning" | "attention" | "reviews" | "contacts";
const columns: Column[] = ["classroom", "teacher", "sessions", "attendance", "learning", "attention", "reviews", "contacts"];
const widths = ["w-[23%]", "w-[9%]", "w-[9%]", "w-[11%]", "w-[11%]", "w-[9%]", "w-[14%]", "w-[14%]"];

function Disclosure({ open, label, controls, onToggle }: { open: boolean; label: string; controls: string; onToggle: () => void }) {
  return <Button type="button" size="sm" variant="ghost" className="size-7 shrink-0 p-0" aria-label={label} title={label}
    aria-keyshortcuts="Enter" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
    {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
  </Button>;
}

export function TeachingClassOverviewTable({ data, locale, timeZone, returnTo, initialTeacher, initialClassroom }: {
  data: TeachingClassOverview; locale: string; timeZone: string; returnTo: string; initialTeacher?: string; initialClassroom?: string;
}) {
  const t = useTranslations("school.teachingWorkbench.overview");
  const workT = useTranslations("school.teachingWorkbench");
  const [teacher, setTeacher] = useState(initialTeacher);
  const [expanded, setExpanded] = useState<string | null>(initialClassroom ?? null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [recordCache] = useState<TeachingRecordCache>(() => new Map());
  const [pageSize, setPageSize] = useState(20);
  const [requestedPage, setPage] = useState(1);
  const allGroups = useMemo(() => groupTeachingClasses(data), [data]);
  const scopedGroups = useMemo(() => teacher ? groupTeachingClasses(data, teacher) : allGroups, [data, teacher, allGroups]);
  const definitions = useMemo<Record<Column, DashboardTableColumnDefinition<ClassRow>>>(() => {
    const number = (value: number) => ({ value: String(value), label: String(value) });
    const recorded = (value: boolean) => ({ value: value ? "recorded" : "empty", label: value ? t("hasRecords") : t("notRecorded") });
    return {
      classroom: { filterValues: row => ({ value: row.id, label: row.name }), sortValue: row => row.name },
      teacher: { filterValues: row => row.teachers.length ? row.teachers.map(person => ({ value: person.id, label: person.name || workT("unnamedTeacher") })) : [{ value: "unassigned", label: workT("unassigned") }], sortValue: row => row.teachers.map(person => person.name).join("、") },
      sessions: { filterValues: row => number(row.recordedSessions), sortValue: row => row.recordedSessions },
      attendance: { filterValues: row => recorded(row.attendance.marked > 0), sortValue: row => row.attendance.marked ? row.attendance.present / row.attendance.marked : null },
      learning: { filterValues: row => recorded(row.ratedCount > 0), sortValue: row => row.expectedRatings ? row.ratedCount / row.expectedRatings : null },
      attention: { filterValues: row => ({ value: row.attention.length ? "attention" : "none", label: row.attention.length ? t("withAttention") : t("withoutAttention") }), sortValue: row => row.attention.length },
      reviews: { filterValues: row => recorded(Boolean(row.latestReview)), sortValue: row => row.latestReview?.at },
      contacts: { filterValues: row => recorded(row.contacts.count > 0), sortValue: row => data.canReadContacts ? row.contacts.count : null },
    };
  }, [t, workT, data.canReadContacts]);
  const initialFilters = useMemo(() => ({ teacher: initialTeacher, classroom: initialClassroom }), [initialTeacher, initialClassroom]);
  const teacherOptions = useMemo(() => [...new Map(allGroups.flatMap(row => row.teachers.length
    ? row.teachers.map(person => ({ value: person.id, label: person.name || workT("unnamedTeacher") }))
    : [{ value: "unassigned", label: workT("unassigned") }]).map(person => [person.value, person])).values()], [allGroups, workT]);
  const table = useDashboardTableView({ rows: scopedGroups, columns: definitions, locale, initialFilters });
  const groups = table.visibleRows;
  const pages = Math.max(1, Math.ceil(groups.length / pageSize));
  const page = Math.min(requestedPage, pages);
  const rows = groups.slice((page - 1) * pageSize, page * pageSize);
  const visibleKeys = rows.flatMap(row => [`class:${row.id}`, ...(expanded === row.id ? row.sessions.map(session => `session:${session.id}`) : [])]);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }), [locale, timeZone]);
  const date = (value: string) => formatter.format(new Date(value));
  const snippet = (value: TeachingRecordSnippet | null, empty: string) => value ? <>
    <p className="line-clamp-2 break-words leading-5" title={value.content}>{value.studentName}：{value.content}</p>
    <p className="mt-0.5 truncate text-[11px] text-muted">{value.author || workT("records.unknownAuthor")} · {date(value.at)}</p>
  </> : <span className="text-xs text-muted">{empty}</span>;
  const changeClass = (id: string, open: boolean) => { setExpanded(open ? id : null); setExpandedSession(null); setActiveKey(`class:${id}`); };
  const changeSession = (id: string, open: boolean) => { setExpandedSession(open ? id : null); setActiveKey(`session:${id}`); };
  const classHref = (id: string) => {
    const [path, query] = returnTo.split("?"); const params = new URLSearchParams(query);
    if (teacher) params.set("teacher", teacher); else params.delete("teacher");
    if (table.filters.classroom) params.set("classroom", table.filters.classroom); else params.delete("classroom");
    return withReturnTo(`/dashboard/classes/${id}`, `${path}?${params}`);
  };
  // 逐生记录内部也有表格；方向键以所属课次为起点，沿同一可见行序列移动。
  const navigateDetails = (event: KeyboardEvent<HTMLElement>, key: string) => {
    if (!event.currentTarget.hasAttribute("data-followup-inline-details")) return;
    const command = followupKeyboardCommand({ ...event, isComposing: event.nativeEvent.isComposing }, followupKeyContext(event));
    if (command?.type !== "move") return;
    event.preventDefault(); event.stopPropagation();
    const next = adjacentFollowupKey(visibleKeys, key, command.direction);
    if (!next) return;
    setActiveKey(next);
    const element = document.getElementById(`teaching-summary-${next}`);
    element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const labels: Record<Column, string> = { classroom: t("classAndLesson"), teacher: workT("teacher"), sessions: t("sessions"), attendance: t("attendance"), learning: t("learning"), attention: t("attention"), reviews: t("reviews"), contacts: t("contacts") };

  return <DashboardSection description={t("hint")}>
    {data.workbench.truncated && <p role="alert" className="mb-3 text-sm text-rose">{workT("truncated")}</p>}
    <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
      <p aria-live="polite">{t("summary", { classes: groups.length, sessions: groups.reduce((sum,row) => sum + row.sessions.length, 0), recorded: groups.reduce((sum,row) => sum + row.recordedSessions, 0) })}</p>
      <p>{t("keyboardHint")}</p>
    </div>
    <DashboardTableShell data-followup-workbench data-teaching-overview><Table className="w-full min-w-[1100px] table-fixed text-xs" containerClassName="isolate max-h-[72vh] overflow-auto">
      <TableHeader><TableRow>{columns.map((column, index) => {
        const props = table.columnProps(column);
        return <TableHead key={column} className={`${widths[index]} sticky top-0 z-20 h-9 bg-card px-2`}>
          <DashboardTableColumnHeader label={labels[column]} {...props} labels={{ scope: t("filterScope") }}
            filterOptions={column === "teacher" ? teacherOptions : props.filterOptions}
            onFilterChange={value => { if (column === "teacher") setTeacher(value); props.onFilterChange(value); setPage(1); }}
            onSortChange={direction => { props.onSortChange(direction); setPage(1); }}
            onClear={() => { if (column === "teacher") setTeacher(undefined); props.onClear(); setPage(1); }} />
        </TableHead>;
      })}</TableRow></TableHeader>
      <FollowupTableBody onNavigate={key => { setActiveKey(key); return true; }}>
        {rows.length === 0 && <TableRow><TableCell colSpan={8}><DashboardEmptyState>{workT(data.workbench.sessions.length ? "emptyFilter" : "emptyPeriod")}</DashboardEmptyState></TableCell></TableRow>}
        {rows.map(row => <Fragment key={row.id}>
          <FollowupRecordRow rowKey={`class:${row.id}`} rowProps={{ id: `teaching-summary-class:${row.id}`, "data-teaching-level": "class" }} active={activeKey === `class:${row.id}`} expanded={expanded === row.id}
            onActivate={() => setActiveKey(`class:${row.id}`)} onExpandedChange={open => changeClass(row.id, open)} renderDetails={false}
            detailsId={row.sessions.map(session => `teaching-summary-session:${session.id}`).join(" ")} title={row.name} colSpan={8} summary={<>
              <TableCell className="px-2 py-2 align-top"><div className="flex items-start gap-1">
                <Disclosure open={expanded === row.id} label={t(expanded === row.id ? "collapseClass" : "expandClass", { name: row.name })} controls={row.sessions.map(session => `teaching-summary-session:${session.id}`).join(" ")} onToggle={() => changeClass(row.id, expanded !== row.id)} />
                <div className="min-w-0"><Link prefetch={false} href={classHref(row.id)} className="line-clamp-2 break-words text-sm font-medium leading-5 hover:underline" title={row.name}>{row.name}</Link><p className="mt-1 text-[11px] text-muted">{t("students", { count: row.studentCount })}</p></div>
              </div></TableCell>
              <TableCell className="px-2 py-2 align-top">{row.teachers.map(person => person.name || workT("unnamedTeacher")).join("、") || workT("unassigned")}</TableCell>
              <TableCell className="px-2 py-2 align-top"><p>{t("recorded", { done: row.recordedSessions, total: row.sessions.length })}</p><p className="mt-1 text-[11px] text-muted">{t("ended", { count: row.endedSessions })}</p></TableCell>
              <TableCell className="px-2 py-2 align-top" title={t("attendanceHint")}><p>{row.attendance.marked ? t("present", { count: row.attendance.present, marked: row.attendance.marked }) : t("noAttendance")}</p><p className="mt-1 text-[11px] text-muted">{row.attendance.marked ? t("absence", { absent: row.attendance.absent, late: row.attendance.late, leave: row.attendance.leave }) : t("rosterEntries", { count: row.rosterEntries })}</p></TableCell>
              <TableCell className="px-2 py-2 align-top" title={t("learningHint")}><p>{row.expectedRatings ? t("ratings", { done: row.ratedCount, total: row.expectedRatings }) : t("noChecks")}</p><p className="mt-1 text-[11px] text-muted">{t("reviewCount", { count: row.reviewCount })}</p></TableCell>
              <TableCell className="px-2 py-2 align-top" title={t("attentionHint")}><p>{row.ratedCount ? t("people", { count: row.attention.length }) : t("notRecorded")}</p><p className="mt-1 line-clamp-2 text-[11px] text-muted" title={row.attention.map(student => student.name).join("、")}>{row.attention.map(student => student.name).join("、")}</p></TableCell>
              <TableCell className="px-2 py-2 align-top">{snippet(row.latestReview, t("noReview"))}</TableCell>
              <TableCell className="px-2 py-2 align-top">{data.canReadContacts ? <><p className="mb-0.5 text-[11px] text-muted">{t("contactCount", { count: row.contacts.count, students: row.contacts.studentCount })}</p>{snippet(row.contacts.latest, t("noContacts"))}</> : t("contactsRestricted")}</TableCell>
            </>} />
          {expanded === row.id && row.sessions.map(session => <FollowupRecordRow key={session.id} rowKey={`session:${session.id}`} rowProps={{ id: `teaching-summary-session:${session.id}`, "data-teaching-level": "session" }} active={activeKey === `session:${session.id}`} expanded={expandedSession === session.id}
            onActivate={() => setActiveKey(`session:${session.id}`)} onExpandedChange={open => changeSession(session.id, open)} onKeyDown={event => navigateDetails(event, `session:${session.id}`)}
            detailsId={`session-records-${session.id}`} title={`${session.title || workT("untitled")} · ${date(session.scheduledAt)}`} colSpan={8} summary={<>
              <TableCell className="py-2 pl-6 pr-2 align-top"><div className="flex items-start gap-1">
                <Disclosure open={expandedSession === session.id} label={workT(expandedSession === session.id ? "records.collapse" : "records.open")} controls={`session-records-${session.id}`} onToggle={() => changeSession(session.id, expandedSession !== session.id)} />
                <div className="min-w-0"><p className="line-clamp-2 leading-5">{session.title || workT("untitled")}</p><p className="mt-1 text-[11px] text-muted">{date(session.scheduledAt)}</p></div>
              </div></TableCell>
              <TableCell className="px-2 py-2 align-top">{session.teachers.map(person => person.name).join("、") || workT("unassigned")}</TableCell>
              <TableCell className="px-2 py-2 align-top">{hasTeachingRecords(session.metrics) ? t("hasRecords") : t("notRecorded")}<p className="mt-1 text-[11px] text-muted">{workT(session.endedAt ? "records.ended" : session.startedAt ? "records.started" : "records.notStarted")}</p></TableCell>
              <TableCell className="px-2 py-2 align-top">{session.metrics.attendance.marked ? t("present", { count: session.metrics.attendance.present, marked: session.metrics.attendance.marked }) : t("noAttendance")}</TableCell>
              <TableCell className="px-2 py-2 align-top">{session.metrics.checkCount ? t("ratings", { done: session.metrics.ratedCount, total: session.metrics.checkCount * session.metrics.studentIds.length }) : t("noChecks")}<p className="mt-1 text-[11px] text-muted">{t("reviewCount", { count: session.metrics.reviewCount })}</p></TableCell>
              <TableCell className="px-2 py-2 align-top">{session.metrics.attentionStudents.map(student => student.name).join("、") || "—"}</TableCell>
              <TableCell className="px-2 py-2 align-top">{snippet(session.metrics.latestReview, t("noReview"))}</TableCell>
              <TableCell className="px-2 py-2 align-top text-muted">{data.canReadContacts ? t("contactsOnExpand") : t("contactsRestricted")}</TableCell>
            </>}>
            {() => <InlineRecords key={session.id} sessionId={session.id} locale={locale} timeZone={timeZone} cache={recordCache} />}
          </FollowupRecordRow>)}
        </Fragment>)}
      </FollowupTableBody>
    </Table></DashboardTableShell>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
      <span>{workT("pagination", { page, pages, count: groups.length })}</span>
      <div className="flex items-center gap-3">
        <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger className="h-8 w-auto" aria-label={workT("pageSize")}><SelectValue /></SelectTrigger><SelectContent>{[20,50,100].map(size => <SelectItem key={size} value={String(size)}>{workT("rowsPerPage", { count: size })}</SelectItem>)}</SelectContent></Select>
        <Pagination className="w-auto" aria-label={workT("pages")}><PaginationContent>
          <PaginationItem><Button variant="ghost" size="sm" className="size-8 p-0" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label={workT("previousPage")}><ChevronLeft size={16} /></Button></PaginationItem>
          {leadPaginationTokens(page, pages).map(token => typeof token === "number" ? <PaginationItem key={token}><PaginationLink asChild isActive={token === page}><Button variant="ghost" className="size-8 p-0" onClick={() => setPage(token)}>{token}</Button></PaginationLink></PaginationItem> : <PaginationItem key={token}><PaginationEllipsis label={workT("morePages")} /></PaginationItem>)}
          <PaginationItem><Button variant="ghost" size="sm" className="size-8 p-0" disabled={page === pages} onClick={() => setPage(page + 1)} aria-label={workT("nextPage")}><ChevronRight size={16} /></Button></PaginationItem>
        </PaginationContent></Pagination>
      </div>
    </div>
  </DashboardSection>;
}
