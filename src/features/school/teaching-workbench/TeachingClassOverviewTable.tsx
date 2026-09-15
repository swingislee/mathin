"use client";

import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { TeachingCoverage, TeachingFocus, TeachingPerformance } from "./TeachingObservationCells";
import { groupTeachingClassSections, type TeachingGrouping } from "./teaching-grouping-contract";

const InlineRecords = dynamic(() => import("./TeachingInlineRecords").then(module => module.TeachingInlineRecords), { loading: () => <InlineLoading /> });
function InlineLoading() {
  const t = useTranslations("school.teachingWorkbench.records");
  return <p role="status" className="py-3 text-sm text-muted">{t("loading")}</p>;
}

type ClassRow = ReturnType<typeof groupTeachingClasses>[number];
type Column = "classroom" | "teacher" | "sessions" | "attendance" | "learning" | "attention" | "reviews" | "contacts";
const columns: Column[] = ["classroom", "teacher", "sessions", "attendance", "learning", "attention", "reviews", "contacts"];
const widths = ["w-[20%]", "w-[9%]", "w-[10%]", "w-[11%]", "w-[11%]", "w-[9%]", "w-[15%]", "w-[15%]"];

export function TeachingClassOverviewTable({ data, locale, timeZone, returnTo, initialTeacher, initialClassroom, replayId, groupBy, replayFrom, replayTo }: {
  data: TeachingClassOverview; locale: string; timeZone: string; returnTo: string; initialTeacher?: string; initialClassroom?: string; replayId?: "2026-09-07"; groupBy?: TeachingGrouping; replayFrom?: string; replayTo?: string;
}) {
  const t = useTranslations("school.teachingWorkbench.overview");
  const workT = useTranslations("school.teachingWorkbench");
  const rich = data.metrics.length > 0 && data.metrics.every(metric => metric.observations);
  const columnWidths = rich ? ["w-[20%]", "w-[8%]", "w-[10%]", "w-[13%]", "w-[10%]", "w-[14%]", "w-[12%]", "w-[13%]"] : widths;
  const [teacher, setTeacher] = useState(initialTeacher);
  const [initialExpanded] = useState(() => {
    if (!initialClassroom || !groupBy) return initialClassroom ?? null;
    const section = groupTeachingClassSections(data, groupTeachingClasses(data, initialTeacher, initialClassroom), groupBy, locale, initialTeacher)[0];
    return section ? `${section.id}/${initialClassroom}` : null;
  });
  const [expanded, setExpanded] = useState<string | null>(initialExpanded);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(initialExpanded ? `class:${initialExpanded}` : null);
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
    endedSessions: { label: workT("observations.endedField"), kind: "number", value: row => row.endedSessions },
    unclosedSessions: { label: workT("observations.unclosedField"), kind: "number", value: row => row.sessions.length - row.endedSessions },
    attendance: { label: t("fields.attendance"), hint: t("attendanceHint"), kind: "number", step: 1,
      value: row => row.attendance.marked ? row.attendance.present / row.attendance.marked * 100 : null },
    learning: { label: t("fields.learning"), hint: t("learningHint"), kind: "number", value: row => row.ratedCount },
    autonomous: { label: workT("observations.autonomousField"), hint: workT("observations.basis"), kind: "number", value: row => row.observations ? row.observations.independent + row.observations.explained : null },
    support: { label: workT("observations.supportField"), hint: workT("observations.basis"), kind: "number", value: row => row.observations ? row.observations.prompted + row.observations.imitated + row.observations.incomplete : null },
    recordedChecks: { label: workT("observations.recordedChecks"), kind: "number", value: row => row.observations?.recordedChecks },
    focusCheck: { label: workT("observations.focus"), hint: workT("observations.focusBasis"), kind: "text", value: row => row.observations?.focusChecks[0]?.title },
    reviewCount: { label: t("fields.reviewCount"), kind: "number", value: row => row.reviewCount },
    attention: { label: t("attention"), hint: t("attentionHint"), kind: "number", value: row => row.ratedCount ? row.attention.length : null },
    reviews: { label: t("reviews"), kind: "text", value: row => row.latestReview?.content },
    reviewAt: { label: t("fields.reviewAt"), kind: "date", value: row => row.latestReview?.at },
    contacts: { label: t("fields.contactCount"), hint: replayId ? workT("replay.contactsHint") : t("contactsHint"), kind: "number", value: row => data.canReadContacts ? row.contacts.count : null },
    contactContent: { label: t("fields.contactContent"), kind: "text", value: row => data.canReadContacts ? row.contacts.latest?.content : null },
  }), [t, workT, teacherOptions, data.canReadContacts, replayId]);
  const initialQuery = useMemo<DashboardFieldQuery>(() => ({ version: 2, sort: null, filters: {
    ...(initialTeacher ? { teacher: { kind: "enum", values: [initialTeacher] } as const } : {}),
    ...(initialClassroom ? { classroom: { kind: "enum", values: [initialClassroom] } as const } : {}),
  } }), [initialTeacher, initialClassroom]);
  const table = useDashboardFieldView({ rows: scopedGroups, fields, columns: {
    classroom: ["classroom", "students"], teacher: ["teacher"], sessions: rich ? ["endedSessions", "unclosedSessions", "attendance"] : ["sessions", "totalSessions"],
    attendance: rich ? ["autonomous", "support"] : ["attendance"], learning: rich ? ["recordedChecks", "learning", "reviewCount"] : ["learning", "reviewCount"], attention: rich ? ["focusCheck", "attention"] : ["attention"],
    reviews: ["reviews", "reviewAt"], contacts: ["contacts", "contactContent"],
  }, context: { locale, timeZone, now: mountedAt }, initialQuery, onQueryChange: query => {
    const filter = query.filters.teacher;
    setTeacher(filter?.kind === "enum" ? filter.values[0] : undefined);
    setPage(1); setExpandedSession(null);
  } });
  const sections = useMemo(() => groupBy ? groupTeachingClassSections(data, table.visibleRows, groupBy, locale, teacher)
    : [{ id: "", name: null, grade: null, rows: table.visibleRows }], [data, table.visibleRows, groupBy, locale, teacher]);
  const groups = sections.flatMap(section => section.rows.map(row => ({ ...row, classroomId: row.id, id: section.id ? `${section.id}/${row.id}` : row.id, section })));
  const pages = Math.max(1, Math.ceil(groups.length / pageSize));
  const page = Math.min(requestedPage, pages);
  const rows = groups.slice((page - 1) * pageSize, page * pageSize);
  const sessionKey = (rowId: string, sessionId: string) => groupBy ? `${rowId}/${sessionId}` : sessionId;
  const visibleKeys = rows.flatMap(row => [`class:${row.id}`, ...(expanded === row.id ? row.sessions.map(session => `session:${sessionKey(row.id, session.id)}`) : [])]);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }), [locale, timeZone]);
  const date = (value: string) => formatter.format(new Date(value));
  const snippet = (value: TeachingRecordSnippet | null, empty: string) => value ? <>
    <p className="line-clamp-2 break-words leading-5" title={value.content}>{value.studentName}：{value.content}</p>
    <p className="mt-0.5 text-[11px] text-muted">{value.author || workT("records.unknownAuthor")} · {value.eventDate === undefined ? date(value.at) : value.eventDate || workT("records.unknownContactDate")}</p>
    {value.eventDate !== undefined && <p className="text-[11px] text-muted">{workT("records.enteredAt", { date: date(value.at) })}</p>}
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
  if (rich) { labels.sessions = workT("observations.sessionState"); labels.attendance = workT("observations.performance"); labels.learning = workT("observations.coverageTitle"); labels.attention = workT("observations.focus"); }
  if (replayId) labels.contacts = workT("replay.contacts");

  return <div className="flex min-h-0 flex-1 flex-col gap-1.5">
    {data.workbench.truncated && <p role="alert" className="text-sm text-rose">{workT("truncated")}</p>}
    <p id="teaching-overview-help" className="sr-only">{replayId ? workT("replay.hint") : t("hint")} {t("keyboardHint")}</p>
    <DashboardTableShell data-followup-workbench data-followup-scroll data-teaching-overview>
    <Table aria-describedby="teaching-overview-help" className="w-full min-w-[1100px] table-fixed text-xs" containerClassName="isolate overflow-auto [scrollbar-gutter:stable]">
      <TableHeader><TableRow>{columns.map((column, index) => {
        const props = table.columnProps(column);
        return <TableHead key={column} className={`${columnWidths[index]} sticky top-0 h-9 bg-card px-2 ${index === 0 ? "left-0 z-30 border-r border-line" : "z-20"}`}>
          <DashboardTableColumnHeader label={labels[column]} {...props} disabled={column === "contacts" && !data.canReadContacts}
            fields={column === "teacher" ? props.fields.map(field => ({ ...field, options: teacherOptions })) : props.fields} />
        </TableHead>;
      })}</TableRow></TableHeader>
      <FollowupTableBody onNavigate={key => { setActiveKey(key); return true; }}>
        {rows.length === 0 && <TableRow><TableCell colSpan={8}><DashboardEmptyState>{workT(data.workbench.sessions.length ? "emptyFilter" : "emptyPeriod")}</DashboardEmptyState></TableCell></TableRow>}
        {rows.map((row, index) => <Fragment key={row.id}>
          {groupBy && (index === 0 || rows[index - 1].section.id !== row.section.id) && <TableRow data-teaching-group={row.section.id} className="bg-moon/20 hover:bg-moon/20">
            <TableCell colSpan={8} className="px-2 py-1.5"><div className="flex items-center gap-3"><span className="font-medium">{groupBy === "grade" ? row.section.grade === null ? workT("grouping.unknownGrade") : workT("grouping.gradeLabel", { grade: row.section.grade }) : row.section.name || workT("unassigned")}</span><span className="text-[11px] text-muted">{workT("grouping.count", { classes: row.section.rows.length, sessions: row.section.rows.reduce((sum, item) => sum + item.sessions.length, 0) })}</span></div></TableCell>
          </TableRow>}
          <FollowupRecordRow rowKey={`class:${row.id}`} rowProps={{ id: `teaching-summary-class:${row.id}`, "data-teaching-level": "class", className: "h-11 cursor-pointer" }} active={activeKey === `class:${row.id}` || expanded === row.id && row.sessions.some(session => activeKey === `session:${sessionKey(row.id, session.id)}`)} expanded={expanded === row.id}
            onActivate={() => setActiveKey(`class:${row.id}`)} onExpandedChange={open => changeClass(row.id, open)} hideTitle
            detailsId={`teaching-class-details-${row.id}`} title={row.name} colSpan={8} summary={<>
              <TableCell className="sticky left-0 z-10 border-r border-line px-2 py-1.5 align-middle"><div className="flex min-w-0 items-center gap-1">
                <DashboardRowDisclosure expanded={expanded === row.id} label={t(expanded === row.id ? "collapseClass" : "expandClass", { name: row.name })} controls={`teaching-class-details-${row.id}`} onToggle={() => changeClass(row.id, expanded !== row.id)} />
                <div className="min-w-0">{replayId ? <p className="truncate text-xs font-medium leading-5" title={row.name}>{row.name}</p> : <Link prefetch={false} href={classHref(row.classroomId)} className="block truncate text-xs font-medium leading-5 hover:underline" title={row.name}>{row.name}</Link>}<p className="mt-0.5 truncate text-[11px] text-muted" title={rich && row.sessions.length === 1 ? row.sessions[0].title : undefined}>{t("students", { count: row.studentCount })}{rich && row.sessions.length === 1 && ` · ${row.sessions[0].title}`}</p></div>
              </div></TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{row.teachers.map(person => person.name || workT("unnamedTeacher")).join("、") || workT("unassigned")}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle"><p>{rich ? row.endedSessions === row.sessions.length ? t("ended", { count: row.endedSessions }) : workT("observations.unclosed", { count: row.sessions.length - row.endedSessions }) : t("recorded", { done: row.recordedSessions, total: row.sessions.length })}</p><p className="mt-0.5 text-[11px] text-muted">{rich ? row.attendance.marked ? t("present", { count: row.attendance.present, marked: row.attendance.marked }) : workT("observations.noAttendance") : t("ended", { count: row.endedSessions })}</p></TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{rich && row.observations ? <TeachingPerformance value={row.observations} /> : <div title={t("attendanceHint")}><p>{row.attendance.marked ? t("present", { count: row.attendance.present, marked: row.attendance.marked }) : t("noAttendance")}</p><p className="mt-0.5 text-[11px] text-muted">{row.attendance.marked ? t("absence", { absent: row.attendance.absent, late: row.attendance.late, leave: row.attendance.leave }) : t("rosterEntries", { count: row.rosterEntries })}</p></div>}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{rich && row.observations ? <TeachingCoverage value={row.observations} reviewCount={row.reviewCount} /> : <div title={t("learningHint")}><p>{row.expectedRatings ? t("ratings", { done: row.ratedCount, total: row.expectedRatings }) : t("noChecks")}</p><p className="mt-0.5 text-[11px] text-muted">{t("reviewCount", { count: row.reviewCount })}</p></div>}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{rich && row.observations ? <TeachingFocus value={row.observations} /> : <div title={t("attentionHint")}><p>{row.ratedCount ? t("people", { count: row.attention.length }) : t("notRecorded")}</p><p className="mt-0.5 line-clamp-2 text-[11px] text-muted" title={row.attention.map(student => student.name).join("、")}>{row.attention.map(student => student.name).join("、")}</p></div>}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{snippet(row.latestReview, t("noReview"))}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{data.canReadContacts ? <><p className="mb-0.5 text-[11px] text-muted">{t("contactCount", { count: row.contacts.count, students: row.contacts.studentCount })}</p>{snippet(row.contacts.latest, t("noContacts"))}</> : t("contactsRestricted")}</TableCell>
            </>}>
          {() => <Table data-teaching-session-table aria-label={t("classLessons", { name: row.name })} className="table-fixed bg-transparent text-xs" containerClassName="overflow-visible">
            <colgroup>{columnWidths.map((width, index) => <col key={index} className={width} />)}</colgroup>
            <TableHeader className="sr-only"><TableRow>{columns.map(column => <TableHead key={column}>{labels[column]}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{row.sessions.map(session => <FollowupRecordRow key={session.id} rowKey={`session:${sessionKey(row.id, session.id)}`} rowProps={{ id: `teaching-summary-session:${sessionKey(row.id, session.id)}`, "data-teaching-level": "session", className: "h-11 cursor-pointer" }} active={activeKey === `session:${sessionKey(row.id, session.id)}`} expanded={expandedSession === sessionKey(row.id, session.id)}
            onActivate={() => setActiveKey(`session:${sessionKey(row.id, session.id)}`)} onExpandedChange={open => changeSession(sessionKey(row.id, session.id), open)} onKeyDown={event => navigateDetails(event, `session:${sessionKey(row.id, session.id)}`)}
            detailsId={`session-records-${sessionKey(row.id, session.id)}`} title={`${session.title || workT("untitled")} · ${date(session.scheduledAt)}`} hideTitle colSpan={8} summary={<>
              <TableCell className="px-2 py-1.5 align-middle"><div className="flex items-center gap-1">
                <DashboardRowDisclosure expanded={expandedSession === sessionKey(row.id, session.id)} label={workT(expandedSession === sessionKey(row.id, session.id) ? "records.collapse" : "records.open")} controls={`session-records-${sessionKey(row.id, session.id)}`} onToggle={() => changeSession(sessionKey(row.id, session.id), expandedSession !== sessionKey(row.id, session.id))} />
                <div className="min-w-0"><p className="line-clamp-2 leading-5">{session.title || workT("untitled")}</p><p className="mt-0.5 text-[11px] text-muted">{date(session.scheduledAt)}</p></div>
              </div></TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{session.teachers.map(person => person.name).join("、") || workT("unassigned")}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{hasTeachingRecords(session.metrics) ? t("hasRecords") : t("notRecorded")}<p className="mt-0.5 text-[11px] text-muted">{rich && !session.endedAt ? workT("observations.unclosed", { count: 1 }) : workT(session.endedAt ? "records.ended" : session.startedAt ? "records.started" : "records.notStarted")}</p></TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{rich && session.metrics.observations ? <TeachingPerformance value={session.metrics.observations} /> : session.metrics.attendance.marked ? t("present", { count: session.metrics.attendance.present, marked: session.metrics.attendance.marked }) : t("noAttendance")}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{rich && session.metrics.observations ? <TeachingCoverage value={session.metrics.observations} reviewCount={session.metrics.reviewCount} /> : <>{session.metrics.checkCount ? t("ratings", { done: session.metrics.ratedCount, total: session.metrics.checkCount * session.metrics.studentIds.length }) : t("noChecks")}<p className="mt-0.5 text-[11px] text-muted">{t("reviewCount", { count: session.metrics.reviewCount })}</p></>}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{rich && session.metrics.observations ? <TeachingFocus value={session.metrics.observations} /> : session.metrics.attentionStudents.map(student => student.name).join("、") || "—"}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle">{snippet(session.metrics.latestReview, t("noReview"))}</TableCell>
              <TableCell className="px-2 py-1.5 align-middle text-muted">{data.canReadContacts ? t("contactsOnExpand") : t("contactsRestricted")}</TableCell>
            </>}>
            {() => <InlineRecords key={session.id} sessionId={session.id} locale={locale} timeZone={timeZone} cache={recordCache} replayId={replayId} replayFrom={replayFrom} replayTo={replayTo} />}
          </FollowupRecordRow>)}</TableBody></Table>}
        </FollowupRecordRow></Fragment>)}
      </FollowupTableBody>
    </Table></DashboardTableShell>
    <div className="shrink-0"><DashboardTablePagination currentPage={page} totalPages={pages} totalCount={groups.length}
      pageSize={pageSize} pageSizes={[20, 50, 100]} onPageChange={value => { setPage(value); setExpandedSession(null); }}
      onPageSizeChange={value => { setPageSize(value); setPage(1); setExpandedSession(null); }} /></div>
  </div>;
}
