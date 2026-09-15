"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { DashboardEmptyState, DashboardSection, DashboardTableShell } from "../dashboard-page";
import { DashboardTableColumnHeader } from "../dashboard-page/DashboardTableColumnHeader";
import { leadPaginationTokens } from "../lead-pagination";
import { withReturnTo } from "../object-workspace/return-target";
import { groupTeachingClasses, hasTeachingRecords, type TeachingClassOverview, type TeachingRecordSnippet } from "./teaching-class-overview-contract";
import { teachingRecordHref } from "./teaching-records-contract";

export function TeachingClassOverviewTable({ data, locale, timeZone, returnTo, initialTeacher, initialClassroom }: {
  data: TeachingClassOverview; locale: string; timeZone: string; returnTo: string; initialTeacher?: string; initialClassroom?: string;
}) {
  const t = useTranslations("school.teachingWorkbench.overview");
  const workT = useTranslations("school.teachingWorkbench");
  const [teacher, setTeacher] = useState(initialTeacher);
  const [classroom, setClassroom] = useState(initialClassroom);
  const [expanded, setExpanded] = useState<string | null>(initialClassroom ?? null);
  const [pageSize, setPageSize] = useState(20);
  const [requestedPage, setPage] = useState(1);
  const [attentionOnly, setAttentionOnly] = useState<string>();
  const allGroups = groupTeachingClasses(data);
  const groups = groupTeachingClasses(data, teacher, classroom).filter(row => !attentionOnly || row.attention.length > 0);
  const teachers = [...new Map(allGroups.flatMap(row => row.teachers).map(row => [row.id, row])).values()];
  const pages = Math.max(1, Math.ceil(groups.length / pageSize));
  const page = Math.min(requestedPage, pages);
  const rows = groups.slice((page - 1) * pageSize, page * pageSize);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  const snippet = (value: TeachingRecordSnippet | null, empty: string) => value ? <>
    <p className="line-clamp-2 break-words leading-5" title={value.content}>{value.studentName}：{value.content}</p>
    <p className="mt-0.5 truncate text-[11px] text-muted">{value.author || workT("records.unknownAuthor")} · {date(value.at)}</p>
  </> : <span className="text-xs text-muted">{empty}</span>;
  const scopedReturnTo = (() => {
    const [path, query] = returnTo.split("?");
    const params = new URLSearchParams(query);
    if (teacher) params.set("teacher", teacher); else params.delete("teacher");
    if (classroom) params.set("classroom", classroom); else params.delete("classroom");
    return `${path}?${params}`;
  })();
  return <DashboardSection description={t("hint")}>
    {data.workbench.truncated && <p role="alert" className="mb-3 text-sm text-rose">{workT("truncated")}</p>}
    <p className="mb-2 text-xs text-muted" aria-live="polite">{t("summary", { classes: groups.length, sessions: groups.reduce((sum,row) => sum + row.sessions.length, 0), recorded: groups.reduce((sum,row) => sum + row.recordedSessions, 0) })}</p>
    <DashboardTableShell><Table className="w-full min-w-[1060px] table-fixed text-xs" containerClassName="max-h-[72vh] overflow-auto">
      <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
        <TableHead className="w-8 px-1"><span className="sr-only">{workT("expand")}</span></TableHead>
        <TableHead className="w-[22%] px-2"><div className="flex flex-wrap items-center gap-x-3">
          <DashboardTableColumnHeader label={workT("records.classroom")} filterValue={classroom} filterOptions={allGroups.map(row => ({ value: row.id, label: row.name }))}
            onFilterChange={value => { setClassroom(value); setPage(1); }} onClear={() => { setClassroom(undefined); setPage(1); }} />
          <DashboardTableColumnHeader label={workT("teacher")} filterValue={teacher} filterOptions={[
            ...teachers.map(row => ({ value: row.id, label: row.name || workT("unnamedTeacher") })),
            ...(allGroups.some(row => row.teachers.length === 0) ? [{ value: "unassigned", label: workT("unassigned") }] : []),
          ]} onFilterChange={value => { setTeacher(value); setPage(1); }} onClear={() => { setTeacher(undefined); setPage(1); }} />
        </div></TableHead>
        <TableHead className="w-[9%] px-2">{t("sessions")}</TableHead>
        <TableHead className="w-[11%] px-2" title={t("attendanceHint")}>{t("attendance")}</TableHead>
        <TableHead className="w-[11%] px-2" title={t("learningHint")}>{t("learning")}</TableHead>
        <TableHead className="w-[10%] px-2" title={t("attentionHint")}><DashboardTableColumnHeader label={t("attention")} filterValue={attentionOnly}
          filterOptions={[{ value: "attention", label: t("withAttention") }]} onFilterChange={value => { setAttentionOnly(value); setPage(1); }} onClear={() => { setAttentionOnly(undefined); setPage(1); }} /></TableHead>
        <TableHead className="w-[17%] px-2">{t("reviews")}</TableHead>
        <TableHead className="px-2" title={t("contactsHint")}>{t("contacts")}</TableHead>
      </TableRow></TableHeader>
      <TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={8}><DashboardEmptyState>{workT(data.workbench.sessions.length ? "emptyFilter" : "emptyPeriod")}</DashboardEmptyState></TableCell></TableRow> : rows.map(row => <Fragment key={row.id}>
        <TableRow data-state={expanded === row.id ? "selected" : undefined}>
          <TableCell className="px-1 py-2 align-top"><Button size="sm" variant="ghost" className="size-7 p-0" aria-label={t("expandClass", { name: row.name })} aria-expanded={expanded === row.id} aria-controls={`class-lessons-${row.id}`} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
            <ChevronDown className={expanded === row.id ? "rotate-180" : ""} size={15} />
          </Button></TableCell>
          <TableCell className="px-2 py-2 align-top">
            <Link href={withReturnTo(`/dashboard/classes/${row.id}`, scopedReturnTo)} className="line-clamp-2 break-words text-sm font-medium leading-5 hover:underline" title={row.name}>{row.name}</Link>
            <p className="mt-1 truncate text-xs text-muted" title={row.teachers.map(person => person.name).join("、")}>
              {row.teachers.map(person => person.name || workT("unnamedTeacher")).join("、") || workT("unassigned")} · {t("students", { count: row.studentCount })}
            </p>
          </TableCell>
          <TableCell className="px-2 py-2 align-top"><Button variant="ghost" className="h-auto p-0 text-xs underline underline-offset-4" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{t("recorded", { done: row.recordedSessions, total: row.sessions.length })}</Button>
            <p className="mt-1 text-[11px] text-muted">{t("ended", { count: row.endedSessions })}</p>
          </TableCell>
          <TableCell className="px-2 py-2 align-top" title={t("attendanceHint")}>
            <p className="tabular-nums">{row.attendance.marked ? t("present", { count: row.attendance.present, marked: row.attendance.marked }) : t("noAttendance")}</p>
            <p className="mt-1 text-[11px] text-muted">{row.attendance.marked ? t("absence", { absent: row.attendance.absent, late: row.attendance.late, leave: row.attendance.leave }) : t("rosterEntries", { count: row.rosterEntries })}</p>
          </TableCell>
          <TableCell className="px-2 py-2 align-top" title={t("learningHint")}>
            <p className="tabular-nums">{row.expectedRatings ? t("ratings", { done: row.ratedCount, total: row.expectedRatings }) : t("noChecks")}</p>
            <p className="mt-1 text-[11px] text-muted">{t("reviewCount", { count: row.reviewCount })}</p>
          </TableCell>
          <TableCell className="px-2 py-2 align-top" title={t("attentionHint")}>
            <p className={row.attention.length ? "font-medium text-rose" : "text-muted"}>{row.ratedCount ? t("people", { count: row.attention.length }) : t("notRecorded")}</p>
            <p className="mt-1 line-clamp-2 text-[11px] text-muted" title={row.attention.map(student => student.name).join("、")}>{row.attention.map(student => student.name).join("、")}</p>
          </TableCell>
          <TableCell className="px-2 py-2 align-top">{snippet(row.latestReview, t("noReview"))}</TableCell>
          <TableCell className="px-2 py-2 align-top">{data.canReadContacts ? <>
            <p className="mb-0.5 text-[11px] text-muted">{t("contactCount", { count: row.contacts.count, students: row.contacts.studentCount })}</p>
            {snippet(row.contacts.latest, t("noContacts"))}
          </> : <span className="text-muted">{t("contactsRestricted")}</span>}</TableCell>
        </TableRow>
        {expanded === row.id && <TableRow id={`class-lessons-${row.id}`}><TableCell colSpan={8} className="p-0">
          <Table className="table-fixed text-xs" containerClassName="max-h-80 overflow-auto">
            <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
              <TableHead className="w-[27%] pl-10">{t("lesson")}</TableHead><TableHead>{workT("teacher")}</TableHead><TableHead>{t("attendance")}</TableHead><TableHead>{t("learning")}</TableHead><TableHead>{t("attention")}</TableHead><TableHead>{workT("records.open")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>{[...row.sessions].sort((a,b) => b.scheduledAt.localeCompare(a.scheduledAt)).map(session => <TableRow key={session.id}>
              <TableCell className="py-2 pl-10"><Link className="hover:underline" href={teachingRecordHref(returnTo, session.id, teacher, row.id)}>{session.title || workT("untitled")}</Link>
                <p className="mt-0.5 text-[11px] text-muted">{date(session.scheduledAt)} · {hasTeachingRecords(session.metrics) ? t("hasRecords") : workT(session.endedAt ? "records.ended" : session.startedAt ? "records.started" : "records.notStarted")}</p>
              </TableCell>
              <TableCell className="py-2">{session.teachers.map(person => person.name).join("、") || workT("unassigned")}</TableCell>
              <TableCell className="py-2">{session.metrics.attendance.marked ? t("present", { count: session.metrics.attendance.present, marked: session.metrics.attendance.marked }) : t("noAttendance")}</TableCell>
              <TableCell className="py-2">{session.metrics.checkCount ? t("ratings", { done: session.metrics.ratedCount, total: session.metrics.checkCount * session.metrics.studentIds.length }) : t("noChecks")}</TableCell>
              <TableCell className="py-2">{session.metrics.attentionStudents.map(student => student.name).join("、") || "—"}</TableCell>
              <TableCell className="py-2"><Link className="underline underline-offset-4" href={teachingRecordHref(returnTo, session.id, teacher, row.id)}>{workT("records.open")}</Link></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </TableCell></TableRow>}
      </Fragment>)}</TableBody>
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
