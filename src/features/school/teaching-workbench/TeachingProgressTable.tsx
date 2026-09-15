"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { DashboardEmptyState, DashboardSection } from "../dashboard-page/DashboardSection";
import { DashboardTableShell } from "../dashboard-page";
import { DashboardTableColumnHeader } from "../dashboard-page/DashboardTableColumnHeader";
import { leadPaginationTokens } from "../lead-pagination";
import { withReturnTo } from "../object-workspace/return-target";
import { teachingRecordHref } from "./teaching-records-contract";
import {
  ARTIFACT_KINDS, PROGRESS_FILTERS, isContactTask, preparationDueAt, preparationSubmitted,
  sessionNeedsAttention, summarizeTeachingByTeacher, summarizeTeachingSessions, taskCounts,
  type ArtifactStatus, type ProgressFilter, type TeachingSession, type TeachingTask, type TeachingWorkbenchData,
} from "./teaching-workbench-contract";

const ARTIFACT_STATUSES: ArtifactStatus[] = ["missing", "draft", "pending", "changes_requested", "approved"];

export function TeachingProgressTable({ data, locale, timeZone, now, returnTo, mode = "progress", initialTeacher, initialClassroom }: {
  data: TeachingWorkbenchData; locale: string; timeZone: string; now: string; returnTo: string;
  mode?: "progress" | "records"; initialTeacher?: string; initialClassroom?: string;
}) {
  const t = useTranslations("school.teachingWorkbench");
  const [teacher, setTeacher] = useState<string | undefined>(initialTeacher);
  const [classroom, setClassroom] = useState<string | undefined>(initialClassroom);
  const recordsMode = mode === "records";
  const [filter, setFilter] = useState<ProgressFilter>("all");
  const [artifactFilters, setArtifactFilters] = useState<Partial<Record<(typeof ARTIFACT_KINDS)[number], string>>>({});
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [requestedPage, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [expanded, setExpanded] = useState<string | null>(null);
  const instant = new Date(now);
  const teachers = summarizeTeachingByTeacher(data.sessions, instant);
  const classrooms = [...new Map(data.sessions.map(session => [session.classroomId, session.classroomName])).entries()];
  const scoped = data.sessions.filter(session => (!classroom || session.classroomId === classroom) && (!teacher || (teacher === "unassigned"
    ? session.teachers.length === 0 : session.teachers.some(person => person.id === teacher))));
  const summary = summarizeTeachingSessions(scoped, instant);
  const filtered = scoped.filter(session => sessionNeedsAttention(session, filter, instant)
    && ARTIFACT_KINDS.every(kind => !artifactFilters[kind] || session.artifacts[kind].status === artifactFilters[kind]))
    .sort((a, b) => (sort === "asc" ? 1 : -1) * a.scheduledAt.localeCompare(b.scheduledAt));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, pages);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  const chooseTeacher = (value: string | undefined) => { setTeacher(value); setPage(1); };
  const href = (session: TeachingSession, stage: "pre" | "post", prepStep?: string) => withReturnTo(
    `/dashboard/sessions/${session.id}?stage=${stage}${prepStep ? `&prepStep=${prepStep}` : ""}`, returnTo,
  );
  const statusBadge = (status: ArtifactStatus) => <Badge variant={status === "changes_requested" ? "danger" : "outline"}
    className={status === "approved" ? "border-leaf/60 bg-leaf/15 text-leaf-deep" : status === "pending" ? "bg-moon/25" : undefined}>{t(`artifactStatus.${status}`)}</Badge>;
  const countsLabel = (tasks: readonly TeachingTask[]) => {
    const count = taskCounts(tasks);
    return t("taskProgress", count) + (count.skipped ? ` · ${t("skippedCount", { count: count.skipped })}` : "");
  };
  const taskCell = (session: TeachingSession, contact: boolean) => {
    const tasks = session.tasks.filter(task => isContactTask(task) === contact);
    const counts = taskCounts(tasks);
    return tasks.length ? <div className="space-y-1 text-xs">
      <span className={counts.pending ? "text-ink" : "text-leaf-deep"}>{countsLabel(tasks)}</span>
      {counts.pending > 0 && <p className="text-muted">{t("pendingCount", { count: counts.pending })}</p>}
      {!contact && session.postworkCompletedAt && <p className="text-leaf-deep">{t("postworkClosed")}</p>}
    </div> : <span className="text-xs text-muted">{t(!contact && session.postworkCompletedAt ? "postworkClosed" : contact || session.endedAt ? "notGenerated" : "notStarted")}</span>;
  };

  return <div className="space-y-7">
    {data.truncated && <p role="alert" className="text-sm text-rose">{t("truncated")}</p>}
    {!recordsMode && <DashboardSection description={t("scopeHint")}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 @3xl/page:grid-cols-5">
        {[
          [t("sessions"), summary.sessions],
          [t("materialsSubmitted"), `${summary.submitted} / ${summary.sessions}`],
          [t("postworkClosed"), `${summary.postwork} / ${summary.ended}`],
          [t("contactsCompleted"), `${summary.contact.done} / ${summary.contact.total}`],
          [t("overdueSessions"), summary.overdue],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-2xl tabular-nums text-ink">{value}</dd></div>)}
      </dl>
    </DashboardSection>}

    {!recordsMode && teachers.length > 1 && <DashboardSection title={t("byTeacher")} description={t("teacherHint")}>
      <DashboardTableShell><Table containerClassName="max-h-[60vh] overflow-auto">
        <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
          {["teacher", "sessions", "materialsSubmitted", "materialsApproved", "postworkClosed", "contactsCompleted", "overdueSessions"].map(key => <TableHead key={key}>{t(key)}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>{teachers.map(person => <TableRow key={person.id} data-state={teacher === person.id ? "selected" : undefined}>
          <TableCell><Button variant="ghost" className="h-auto p-0 text-ink underline-offset-4 hover:underline" onClick={() => chooseTeacher(teacher === person.id ? undefined : person.id)}>{person.name || t("unassigned")}</Button></TableCell>
          <TableCell className="tabular-nums">{person.summary.sessions}</TableCell>
          <TableCell className="tabular-nums">{person.summary.submitted} / {person.summary.sessions}</TableCell>
          <TableCell className="tabular-nums">{person.summary.approved} / {person.summary.sessions}</TableCell>
          <TableCell className="tabular-nums">{person.summary.postwork} / {person.summary.ended}</TableCell>
          <TableCell className="tabular-nums">{person.summary.contact.done} / {person.summary.contact.total}</TableCell>
          <TableCell className={person.summary.overdue ? "text-rose tabular-nums" : "tabular-nums"}>{person.summary.overdue}</TableCell>
        </TableRow>)}</TableBody>
      </Table></DashboardTableShell>
    </DashboardSection>}

    <DashboardSection title={t(recordsMode ? "records.title" : "sessionDetails")} description={t(recordsMode ? "records.listHint" : "detailsHint")}>
      <DashboardTableShell><Table containerClassName="max-h-[70vh] overflow-auto">
        <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
          {!recordsMode && <TableHead className="w-9"><span className="sr-only">{t("expand")}</span></TableHead>}
          <TableHead className="min-w-48"><DashboardTableColumnHeader label={t("session")}
            filterValue={filter === "all" ? undefined : filter} filterOptions={recordsMode ? [] : PROGRESS_FILTERS.filter(value => value !== "all").map(value => ({ value, label: t(`filter.${value}`) }))}
            sortDirection={sort} onSortChange={value => setSort(value ?? "asc")}
            onFilterChange={value => { setFilter((value ?? "all") as ProgressFilter); setPage(1); }}
            onClear={() => { setFilter("all"); setSort("asc"); setPage(1); }}
          /></TableHead>
          <TableHead className="min-w-36"><DashboardTableColumnHeader label={t("records.classroom")} filterValue={classroom}
            filterOptions={classrooms.map(([value, label]) => ({ value, label }))}
            onFilterChange={value => { setClassroom(value); setPage(1); }} onClear={() => { setClassroom(undefined); setPage(1); }}
          /></TableHead>
          <TableHead className="min-w-28"><DashboardTableColumnHeader label={t("teacher")} filterValue={teacher}
            filterOptions={teachers.map(person => ({ value: person.id, label: person.name || t("unassigned") }))}
            onFilterChange={chooseTeacher} onClear={() => chooseTeacher(undefined)}
          /></TableHead>
          {!recordsMode && ARTIFACT_KINDS.map(kind => <TableHead key={kind} className="min-w-28"><DashboardTableColumnHeader label={t(`artifact.${kind}`)}
            filterValue={artifactFilters[kind]} filterOptions={ARTIFACT_STATUSES.map(status => ({ value: status, label: t(`artifactStatus.${status}`) }))}
            onFilterChange={value => { setArtifactFilters(current => ({ ...current, [kind]: value })); setPage(1); }}
            onClear={() => { setArtifactFilters(current => ({ ...current, [kind]: undefined })); setPage(1); }}
          /></TableHead>)}
          {!recordsMode && <><TableHead className="min-w-36">{t("postwork")}</TableHead>
          <TableHead className="min-w-36">{t("contacts")}</TableHead></>}
          <TableHead>{t("records.open")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={recordsMode ? 4 : 10}><DashboardEmptyState>{t(data.sessions.length ? "emptyFilter" : "emptyPeriod")}</DashboardEmptyState></TableCell></TableRow>
          : rows.map(session => <Fragment key={session.id}>
            <TableRow>
              {!recordsMode && <TableCell><Button variant="ghost" size="sm" className="size-7 p-0" aria-label={t("expandSession", { title: session.title || session.classroomName })}
                aria-expanded={expanded === session.id} aria-controls={`teaching-detail-${session.id}`} onClick={() => setExpanded(expanded === session.id ? null : session.id)}>
                <ChevronDown size={15} className={expanded === session.id ? "rotate-180" : ""} />
              </Button></TableCell>}
              <TableCell>
                <Link href={recordsMode ? teachingRecordHref(returnTo, session.id, teacher, classroom) : href(session, session.endedAt ? "post" : "pre")} className="font-medium text-ink underline-offset-4 hover:underline">{session.title || t("untitled")}</Link>
                <p className="mt-1 text-xs tabular-nums text-muted">{formatDate(session.scheduledAt)} · {recordsMode ? t(session.endedAt ? "records.ended" : session.startedAt ? "records.started" : "records.notStarted") : t(session.endedAt ? "ended" : session.startedAt ? "live" : "scheduled")}</p>
                {!recordsMode && !preparationSubmitted(session) && preparationDueAt(session) < instant && <p className="mt-1 text-xs text-rose">{t("preparationOverdue")}</p>}
              </TableCell>
              <TableCell><Link href={withReturnTo(`/dashboard/classes/${session.classroomId}`, returnTo)} className="text-sm underline-offset-4 hover:underline">{session.classroomName}</Link></TableCell>
              <TableCell className="text-sm">{session.teachers.map(person => person.name || t("unnamedTeacher")).join("、") || t("unassigned")}</TableCell>
              {!recordsMode && ARTIFACT_KINDS.map((kind, index) => <TableCell key={kind}>
                {session.canOpenPreparation ? <Link href={href(session, "pre", ["study", "design", "rehearsal"][index])} aria-label={t("openArtifact", { kind: t(`artifact.${kind}`), status: t(`artifactStatus.${session.artifacts[kind].status}`) })}>{statusBadge(session.artifacts[kind].status)}</Link> : statusBadge(session.artifacts[kind].status)}
              </TableCell>)}
              {!recordsMode && <><TableCell>{taskCell(session, false)}</TableCell>
              <TableCell>{taskCell(session, true)}</TableCell></>}
              <TableCell><Link href={teachingRecordHref(returnTo, session.id, teacher, classroom)} className="whitespace-nowrap text-sm underline underline-offset-4">{t("records.open")}</Link></TableCell>
            </TableRow>
            {!recordsMode && expanded === session.id && <TableRow id={`teaching-detail-${session.id}`}><TableCell colSpan={10} className="bg-moon/15 px-5 py-4">
              <div className="grid gap-5 @4xl/page:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-medium">{t("preparationDetails")}</h3>
                  <p className="mb-3 text-xs text-muted">{t("preparationDue", { date: formatDate(preparationDueAt(session).toISOString()) })}</p>
                  <ul className="space-y-2">{ARTIFACT_KINDS.map(kind => <li key={kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span>{t(`artifact.${kind}`)}</span>{statusBadge(session.artifacts[kind].status)}
                    {session.artifacts[kind].submittedAt && <span className="text-muted">{t("submittedAt", { date: formatDate(session.artifacts[kind].submittedAt) })}</span>}
                  </li>)}</ul>
                  <p className="mt-3 text-xs text-muted">{t(session.autoFrozen ? "autoFrozen" : session.preparationStatus === "ready" ? "markedReady" : "notMarkedReady")}</p>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">{t("taskDetails")}</h3>
                  {session.tasks.length === 0 ? <p className="text-xs text-muted">{t("notGenerated")}</p> : <ul className="space-y-2">{session.tasks.map(task => <li key={`${task.source}:${task.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span>{t.has(`taskKind.${task.kind}`) ? t(`taskKind.${task.kind}`) : t("otherTask")}</span>
                    <Badge variant="outline" className={task.status === "done" ? "border-leaf/60 text-leaf-deep" : undefined}>{t(`taskStatus.${task.status}`)}</Badge>
                    <span className="text-muted">{task.assigneeName || t("unassigned")}</span>
                    {!task.required && <span className="text-muted">{t("optional")}</span>}
                    {task.dueAt && <span className={task.status === "pending" && new Date(task.dueAt) < instant ? "text-rose" : "text-muted"}>{t("dueAt", { date: formatDate(task.dueAt) })}</span>}
                    {task.completedAt && <span className="text-muted">{t("completedAt", { date: formatDate(task.completedAt) })}</span>}
                  </li>)}</ul>}
                  <Link href={href(session, "post")} className="mt-3 inline-block text-xs underline underline-offset-4">{t("openPostwork")}</Link>
                </div>
              </div>
            </TableCell></TableRow>}
          </Fragment>)}
        </TableBody>
      </Table></DashboardTableShell>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span aria-live="polite">{t("pagination", { page, pages, count: filtered.length })}</span>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); }}>
            <SelectTrigger className="h-8 w-auto" aria-label={t("pageSize")}><SelectValue /></SelectTrigger>
            <SelectContent>{[20, 50, 100].map(size => <SelectItem key={size} value={String(size)}>{t("rowsPerPage", { count: size })}</SelectItem>)}</SelectContent>
          </Select>
          <Pagination className="w-auto" aria-label={t("pages")}><PaginationContent>
            <PaginationItem><Button variant="ghost" size="sm" className="size-8 p-0" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label={t("previousPage")}><ChevronLeft size={16} /></Button></PaginationItem>
            {leadPaginationTokens(page, pages).map(token => typeof token === "number" ? <PaginationItem key={token}>
              <PaginationLink asChild isActive={token === page}><Button variant="ghost" className="size-8 p-0" onClick={() => setPage(token)} aria-label={t("pageNumber", { page: token })}>{token}</Button></PaginationLink>
            </PaginationItem> : <PaginationItem key={token}><PaginationEllipsis label={t("morePages")} /></PaginationItem>)}
            <PaginationItem><Button variant="ghost" size="sm" className="size-8 p-0" disabled={page === pages} onClick={() => setPage(page + 1)} aria-label={t("nextPage")}><ChevronRight size={16} /></Button></PaginationItem>
          </PaginationContent></Pagination>
        </div>
      </div>
    </DashboardSection>
  </div>;
}
