"use client";

import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { DashboardEmptyState, DashboardTableShell } from "../dashboard-page";
import { DashboardTableColumnHeader } from "../dashboard-page/DashboardTableColumnHeader";
import { FollowupRecordRow, FollowupTableBody } from "../dashboard-page/FollowupRecordRow";
import { adjacentFollowupKey, followupKeyboardCommand, followupKeyContext } from "../followup-keyboard";
import { DashboardRowDisclosure } from "../dashboard-page/DashboardRowDisclosure";
import { DashboardTablePagination } from "../dashboard-page/DashboardTablePagination";
import { useDashboardFieldView } from "../dashboard-page/useDashboardFieldView";
import type { DashboardFieldDefinitions, DashboardFieldQuery } from "../dashboard-page/dashboard-table-field-contract";
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
const widths = ["w-[20%]", "w-[9%]", "w-[10%]", "w-[11%]", "w-[11%]", "w-[9%]", "w-[15%]", "w-[15%]"];

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
  const [mountedAt] = useState(Date.now);
  const allGroups = useMemo(() => groupTeachingClasses(data), [data]);
  const scopedGroups = useMemo(() => teacher ? groupTeachingClasses(data, teacher) : allGroups, [data, teacher, allGroups]);
  const teacherOptions = useMemo(() => [...new Map(allGroups.flatMap(row => row.teachers.length
    ? row.teachers.map(person => ({ value: person.id, label: person.name || workT("unnamedTeacher") }))
    : [{ value: "unassigned", label: workT("unassigned") }]).map(person => [person.value, person])).values()], [allGroups, workT]);
  const fields = useMemo<DashboardFieldDefinitions<ClassRow>>(() => ({
    classroom: { label: t("classAndLesson"), kind: "enum", multiple: false, values: row => [{ value: row.id, label: row.name }] },
    students: { label: t("fields.students"), kind: "number", value: row => row.studentCount },
    teacher: { label: workT("teacher"), kind: "enum", multiple: false, options: teacherOptions,
      values: row => row.teachers.length ? row.teachers.map(person => ({ value: person.id, label: person.name || workT("unnamedTeacher") }))
        : [{ value: "unassigned", label: workT("unassigned") }] },
    sessions: { label: t("fields.recordedSessions"), kind: "number", value: row => row.recordedSessions },
    totalSessions: { label: t("fields.totalSessions"), kind: "number", value: row => row.sessions.length },
    attendance: { label: t("fields.attendance"), hint: t("attendanceHint"), kind: "number", step: 1,
      value: row => row.attendance.marked ? row.attendance.present / row.attendance.marked * 100 : null },
    learning: { label: t("fields.learning"), hint: t("learningHint"), kind: "number", value: row => row.ratedCount },
    reviewCount: { label: t("fields.reviewCount"), kind: "number", value: row => row.reviewCount },
    attention: { label: t("attention"), hint: t("attentionHint"), kind: "number", value: row => row.ratedCount ? row.attention.length : null },
    reviews: { label: t("reviews"), kind: "text", value: row => row.latestReview?.content },
    reviewAt: { label: t("fields.reviewAt"), kind: "date", value: row => row.latestReview?.at },
    contacts: { label: t("fields.contactCount"), hint: t("contactsHint"), kind: "number", value: row => data.canReadContacts ? row.contacts.count : null },
    contactContent: { label: t("fields.contactContent"), kind: "text", value: row => data.canReadContacts ? row.contacts.latest?.content : null },
  }), [t, workT, teacherOptions, data.canReadContacts]);
  const initialQuery = useMemo<DashboardFieldQuery>(() => ({ version: 2, sort: null, filters: {
    ...(initialTeacher ? { teacher: { kind: "enum", values: [initialTeacher] } as const } : {}),
    ...(initialClassroom ? { classroom: { kind: "enum", values: [initialClassroom] } as const } : {}),
  } }), [initialTeacher, initialClassroom]);
  const table = useDashboardFieldView({ rows: scopedGroups, fields, columns: {
    classroom: ["classroom", "students"], teacher: ["teacher"], sessions: ["sessions", "totalSessions"],
    attendance: ["attendance"], learning: ["learning", "reviewCount"], attention: ["attention"],
    reviews: ["reviews", "reviewAt"], contacts: ["contacts", "contactContent"],
  }, context: { locale, timeZone, now: mountedAt }, initialQuery, onQueryChange: query => {
    const filter = query.filters.teacher;
    setTeacher(filter?.kind === "enum" ? filter.values[0] : undefined);
    setPage(1); setExpandedSession(null);
  } });
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
    if (table.filters.classroom?.kind === "enum") params.set("classroom", table.filters.classroom.values[0]); else params.delete("classroom");
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

  return <div className="flex min-h-0 flex-1 flex-col gap-1.5">
    {data.workbench.truncated && <p role="alert" className="text-sm text-rose">{workT("truncated")}</p>}
    <p id="teaching-overview-help" className="sr-only">{t("hint")} {t("keyboardHint")}</p>
    <DashboardTableShell data-followup-workbench data-followup-scroll data-teaching-overview>
    <Table aria-describedby="teaching-overview-help" className="w-full min-w-[1100px] table-fixed text-xs" containerClassName="isolate overflow-auto [scrollbar-gutter:stable]">
      <TableHeader><TableRow>{columns.map((column, index) => {
        const props = table.columnProps(column);
        return <TableHead key={column} className={`${widths[index]} sticky top-0 h-9 bg-card px-2 ${index === 0 ? "left-0 z-30 border-r border-line" : "z-20"}`}>
          <DashboardTableColumnHeader label={labels[column]} {...props} disabled={column === "contacts" && !data.canReadContacts}
            fields={column === "teacher" ? props.fields.map(field => ({ ...field, options: teacherOptions })) : props.fields} />
        </TableHead>;
      })}</TableRow></TableHeader>
      <FollowupTableBody onNavigate={key => { setActiveKey(key); return true; }}>
        {rows.length === 0 && <TableRow><TableCell colSpan={8}><DashboardEmptyState>{workT(data.workbench.sessions.length ? "emptyFilter" : "emptyPeriod")}</DashboardEmptyState></TableCell></TableRow>}
        {rows.map(row => <Fragment key={row.id}>
          <FollowupRecordRow rowKey={`class:${row.id}`} rowProps={{ id: `teaching-summary-class:${row.id}`, "data-teaching-level": "class" }} active={activeKey === `class:${row.id}`} expanded={expanded === row.id}
            onActivate={() => setActiveKey(`class:${row.id}`)} onExpandedChange={open => changeClass(row.id, open)} renderDetails={false}
            detailsId={row.sessions.map(session => `teaching-summary-session:${session.id}`).join(" ")} title={row.name} colSpan={8} summary={<>
              <TableCell className="sticky left-0 z-10 border-r border-line px-2 py-1.5 align-top"><div className="flex min-w-0 items-start gap-1">
                <DashboardRowDisclosure expanded={expanded === row.id} label={t(expanded === row.id ? "collapseClass" : "expandClass", { name: row.name })} controls={row.sessions.map(session => `teaching-summary-session:${session.id}`).join(" ")} onToggle={() => changeClass(row.id, expanded !== row.id)} />
                <div className="min-w-0"><Link prefetch={false} href={classHref(row.id)} className="line-clamp-2 break-words text-xs font-medium leading-5 hover:underline" title={row.name}>{row.name}</Link><p className="mt-0.5 text-[11px] text-muted">{t("students", { count: row.studentCount })}</p></div>
              </div></TableCell>
              <TableCell className="px-2 py-1.5 align-top">{row.teachers.map(person => person.name || workT("unnamedTeacher")).join("、") || workT("unassigned")}</TableCell>
              <TableCell className="px-2 py-1.5 align-top"><p>{t("recorded", { done: row.recordedSessions, total: row.sessions.length })}</p><p className="mt-0.5 text-[11px] text-muted">{t("ended", { count: row.endedSessions })}</p></TableCell>
              <TableCell className="px-2 py-1.5 align-top" title={t("attendanceHint")}><p>{row.attendance.marked ? t("present", { count: row.attendance.present, marked: row.attendance.marked }) : t("noAttendance")}</p><p className="mt-0.5 text-[11px] text-muted">{row.attendance.marked ? t("absence", { absent: row.attendance.absent, late: row.attendance.late, leave: row.attendance.leave }) : t("rosterEntries", { count: row.rosterEntries })}</p></TableCell>
              <TableCell className="px-2 py-1.5 align-top" title={t("learningHint")}><p>{row.expectedRatings ? t("ratings", { done: row.ratedCount, total: row.expectedRatings }) : t("noChecks")}</p><p className="mt-0.5 text-[11px] text-muted">{t("reviewCount", { count: row.reviewCount })}</p></TableCell>
              <TableCell className="px-2 py-1.5 align-top" title={t("attentionHint")}><p>{row.ratedCount ? t("people", { count: row.attention.length }) : t("notRecorded")}</p><p className="mt-0.5 line-clamp-2 text-[11px] text-muted" title={row.attention.map(student => student.name).join("、")}>{row.attention.map(student => student.name).join("、")}</p></TableCell>
              <TableCell className="px-2 py-1.5 align-top">{snippet(row.latestReview, t("noReview"))}</TableCell>
              <TableCell className="px-2 py-1.5 align-top">{data.canReadContacts ? <><p className="mb-0.5 text-[11px] text-muted">{t("contactCount", { count: row.contacts.count, students: row.contacts.studentCount })}</p>{snippet(row.contacts.latest, t("noContacts"))}</> : t("contactsRestricted")}</TableCell>
            </>} />
          {expanded === row.id && row.sessions.map(session => <FollowupRecordRow key={session.id} rowKey={`session:${session.id}`} rowProps={{ id: `teaching-summary-session:${session.id}`, "data-teaching-level": "session" }} active={activeKey === `session:${session.id}`} expanded={expandedSession === session.id}
            onActivate={() => setActiveKey(`session:${session.id}`)} onExpandedChange={open => changeSession(session.id, open)} onKeyDown={event => navigateDetails(event, `session:${session.id}`)}
            detailsId={`session-records-${session.id}`} title={`${session.title || workT("untitled")} · ${date(session.scheduledAt)}`} colSpan={8} summary={<>
              <TableCell className="sticky left-0 z-10 border-r border-line py-1.5 pl-8 pr-2 align-top"><div className="flex items-start gap-1">
                <DashboardRowDisclosure expanded={expandedSession === session.id} label={workT(expandedSession === session.id ? "records.collapse" : "records.open")} controls={`session-records-${session.id}`} onToggle={() => changeSession(session.id, expandedSession !== session.id)} />
                <div className="min-w-0"><p className="line-clamp-2 leading-5">{session.title || workT("untitled")}</p><p className="mt-0.5 text-[11px] text-muted">{date(session.scheduledAt)}</p></div>
              </div></TableCell>
              <TableCell className="px-2 py-1.5 align-top">{session.teachers.map(person => person.name).join("、") || workT("unassigned")}</TableCell>
              <TableCell className="px-2 py-1.5 align-top">{hasTeachingRecords(session.metrics) ? t("hasRecords") : t("notRecorded")}<p className="mt-0.5 text-[11px] text-muted">{workT(session.endedAt ? "records.ended" : session.startedAt ? "records.started" : "records.notStarted")}</p></TableCell>
              <TableCell className="px-2 py-1.5 align-top">{session.metrics.attendance.marked ? t("present", { count: session.metrics.attendance.present, marked: session.metrics.attendance.marked }) : t("noAttendance")}</TableCell>
              <TableCell className="px-2 py-1.5 align-top">{session.metrics.checkCount ? t("ratings", { done: session.metrics.ratedCount, total: session.metrics.checkCount * session.metrics.studentIds.length }) : t("noChecks")}<p className="mt-0.5 text-[11px] text-muted">{t("reviewCount", { count: session.metrics.reviewCount })}</p></TableCell>
              <TableCell className="px-2 py-1.5 align-top">{session.metrics.attentionStudents.map(student => student.name).join("、") || "—"}</TableCell>
              <TableCell className="px-2 py-1.5 align-top">{snippet(session.metrics.latestReview, t("noReview"))}</TableCell>
              <TableCell className="px-2 py-1.5 align-top text-muted">{data.canReadContacts ? t("contactsOnExpand") : t("contactsRestricted")}</TableCell>
            </>}>
            {() => <InlineRecords key={session.id} sessionId={session.id} locale={locale} timeZone={timeZone} cache={recordCache} />}
          </FollowupRecordRow>)}
        </Fragment>)}
      </FollowupTableBody>
    </Table></DashboardTableShell>
    <div className="shrink-0"><DashboardTablePagination currentPage={page} totalPages={pages} totalCount={groups.length}
      pageSize={pageSize} pageSizes={[20, 50, 100]} onPageChange={value => { setPage(value); setExpandedSession(null); }}
      onPageSizeChange={value => { setPageSize(value); setPage(1); setExpandedSession(null); }} /></div>
  </div>;
}
