"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GripVertical, LoaderCircle, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { Student360Trigger } from "./Student360Sheet";
import { FilterSearchInput } from "./FilterBar";
import { FollowupTabs } from "./FollowupTabs";
import { FollowupCommandPanel } from "./FollowupCommandPanel";
import { FollowupPrimaryFilter, useFollowupWorkFilter } from "./FollowupPrimaryFilter";
import { PLACEMENT_WORK_FILTERS, placementClassMatchesWorkFilter, type PlacementWorkFilter } from "./followup-primary-filter-contract";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandState, DashboardPage, DashboardTableColumnHeader, DashboardTableShell } from "./dashboard-page";
import { useDashboardFieldView } from "./dashboard-page/useDashboardFieldView";
import { PLACEMENT_TABLE_COLUMNS, placementTableFields, type PlacementRosterRow as RosterRow } from "./placement-table-fields";
import { LeadPoolPagination } from "./LeadPoolPagination";
import { useFollowupPagination } from "./useFollowupPagination";
import { BusinessRecordStateFilter, HistoricalRecordBadge, useBusinessSearchQuery } from './BusinessRecordStateFilter';
import { businessRecordMessages, matchesBusinessRecordState, type BusinessRecordStateFilter as StateFilter } from './business-record-state-contract';
import { businessSubjectKey, type HistoricalEnrollment, type StudentBusinessHistory } from './student-business-history-contract';
import { classWeeklyScheduleLabel, enrollmentErrorKey, placementHealth, placementStudentBackground, placementStudents, type EnrollmentPlacementBoard, type PlacementClassroom, type PlacementStudent } from "./enrollment-workflow-contract";
import { moveEnrollmentSeatAction } from "./enrollment-workflow-actions";
import { placementRosterSeats, placementSeatTargetError } from "./placement-roster";
import { useTilePointerDrag } from "./tile-pointer-drag";
import { SourceEnrollmentPlacementDialog } from './SourceEnrollmentPlacementDialog';
import { SchoolSupportSeatEntry } from "./SchoolSupportInlineEntry";
import { SchoolSupportPendingRows } from './SchoolSupportPendingRows';

interface SeatTarget {
  classroom: PlacementClassroom | null;
  termId: string;
  grade: number;
  seat: number | null;
}

const NAME_GRID = "grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-px";

interface StudentTileRecord {
  key: string; studentId: string | null; name: string; phone: string; grade: number;
  status: PlacementStudent['status'] | null; courseTitle: string; recommendation: string; note: string;
  placement?: PlacementStudent;
  sourceEnrollment?: HistoricalEnrollment;
}

const studentTileRecord = (student: PlacementStudent): StudentTileRecord => ({ ...student, placement: student });

function rosterRows(board: EnrollmentPlacementBoard, students: PlacementStudent[]): RosterRow[] {
  const groups = new Map<string, { grade: number; termId: string; classrooms: PlacementClassroom[]; students: PlacementStudent[] }>();
  const groupFor = (termId: string, grade: number) => {
    const key = `${termId}:${grade}`;
    if (!groups.has(key)) groups.set(key, { termId, grade, classrooms: [], students: [] });
    return groups.get(key)!;
  };
  for (const classroom of board.options.classrooms) {
    groupFor(classroom.termId, board.options.courses.find((course) => course.id === classroom.courseId)?.grade ?? 0).classrooms.push(classroom);
  }
  for (const student of students) groupFor(student.termId, student.grade).students.push(student);
  return [...groups.entries()].flatMap(([group, value]) => [
    { ...value, group, key: `${group}:pending`, classroom: null, students: value.students.filter((student) => !student.classroomId || !value.classrooms.some((classroom) => classroom.id === student.classroomId)) },
    ...value.classrooms.map((classroom) => ({ ...value, group, key: classroom.id, classroom, students: value.students.filter((student) => student.classroomId === classroom.id) })),
  ]);
}

function sourceRosterRows(board:EnrollmentPlacementBoard,history:StudentBusinessHistory|null|undefined):RosterRow[] {
  const bound=new Set(board.enrollments.map(row=>row.id));
  const grouped=new Map<string,RosterRow>();
  const termKey=(label:string)=>label.replace(/[\s年学期]/gu,'').replace('暑假','暑').replace('秋季','秋');
  for(const row of history?.enrollments??[]) {
    if(bound.has(row.id))continue;
    const grade=history?.subjects[businessSubjectKey(row)]?.grade??0;
    const termId=board.options.terms.find(term=>termKey(term.name)===termKey(row.period_label))?.id??`period:${row.period_label}`;
    const group=`${termId}:${grade}`,key=JSON.stringify([group,row.record_state??'historical',row.class_label,row.teacher_label,row.schedule_label,row.room_label]);
    const existing=grouped.get(key);
    if(existing)existing.sourceEnrollments!.push(row);
    else grouped.set(key,{key,group,termId,grade,classroom:null,classrooms:[],students:[],historical:row,sourceEnrollments:[row]});
  }
  return [...grouped.values()];
}

export function EnrollmentPlacementWorkbench({ initialBoard, initialTermId, focusStudentId, canCreateClass, canAdd=false, history, initialQuery, initialRecordState='current', timeZone = "Asia/Shanghai", now }: {
  initialBoard: EnrollmentPlacementBoard; initialTermId?: string; focusStudentId?: string; canCreateClass: boolean;
  canAdd?: boolean;
  history?: StudentBusinessHistory|null; initialQuery?: string; initialRecordState?: StateFilter;
  timeZone?: string; now?: number;
}) {
  const t = useTranslations("school.enrollmentWorkflow");
  const filterT = useTranslations("school.followupFilters");
  const healthT = useTranslations("school.renewals.poolV2");
  const locale = useLocale();
  const [clockNow] = useState(() => now ?? Date.now());
  const context = useMemo(() => ({ locale, timeZone, now: clockNow }), [locale, timeZone, clockNow]);
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const pointerPosition = useRef<{ clientX: number; clientY: number } | null>(null);
  const [savedBoard, setSavedBoard] = useState<{ base: EnrollmentPlacementBoard; value: EnrollmentPlacementBoard } | null>(null);
  const board = savedBoard?.base === initialBoard ? savedBoard.value : initialBoard;
  const [query, setQuery] = useBusinessSearchQuery("enrollments",initialQuery);
  const [recordState,setRecordState]=useState(initialRecordState);
  const [workFilter, setWorkFilter] = useFollowupWorkFilter("enrollments", PLACEMENT_WORK_FILTERS, "all");
  const recordM=businessRecordMessages(locale);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pending, startMoving] = useTransition();
  const [seatEntry,setSeatEntry]=useState<{classroom:PlacementClassroom;seat:number}|null>(null);
  const [sourceEnrollment,setSourceEnrollment]=useState<HistoricalEnrollment|null>(null);
  const students = useMemo(() => placementStudents(board), [board]);
  const renewedMembershipIds = new Set(board.renewedMembershipIds ?? []);
  const selected = students.find((student) => student.key === selectedKey) ?? null;
  const rows = useMemo(() => [...rosterRows(board, students),...sourceRosterRows(board,history)], [board, students,history]);
  const terms = new Map(board.options.terms.map((term) => [term.id, term.name]));
  const courses = new Map(board.options.courses.map((course) => [course.id, course.title]));
  const schedule = (classroom: PlacementClassroom) => classWeeklyScheduleLabel(classroom, locale) || t("schedulePending");
  const fields = useMemo(() => placementTableFields(board, locale, timeZone, t, row => ({
    names: (row.sourceEnrollments ?? []).map(fact => history?.students[businessSubjectKey(fact)] ?? "").join(" "),
    phones: (row.sourceEnrollments ?? []).map(fact => history?.subjects[businessSubjectKey(fact)]?.phone ?? "").join(" "),
  })), [board, locale, timeZone, t, history]);
  const focused = students.find((student) => student.studentId === focusStudentId);
  const explicitTerm = board.options.terms.find((term) => term.id === initialTermId)?.id;
  const currentTerm = board.options.terms.find((term) => term.isCurrent)?.id;
  const defaultTerm = explicitTerm ?? focused?.termId ?? currentTerm;
  const searchableRows=rows.filter(row=>matchesBusinessRecordState(row.historical ? row.historical.record_state ?? 'historical' : 'current',recordState)&&(!query.trim()||[
    row.classroom?.name??'',...row.students.flatMap(student=>[student.name,student.phone]),
    ...(row.sourceEnrollments??[]).flatMap(fact=>[history?.students[businessSubjectKey(fact)]??'',history?.subjects[businessSubjectKey(fact)]?.phone??'',fact.period_label,fact.class_label,fact.teacher_label,fact.note??'']),
  ].join(' ').toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))));
  // 当前周期隶属已启用学年；按周期保存展示偏好，指定入口保留自身定位。
  const table = useDashboardFieldView({ rows: searchableRows, fields, columns: PLACEMENT_TABLE_COLUMNS, context,
    persistenceKey: explicitTerm || focused ? undefined : `followup-enrollment-roster-fields-v3:${currentTerm ?? "all"}`,
    initialQuery: { version: 2, filters: {
      ...(defaultTerm ? { term: { kind: "enum", values: [defaultTerm] } } : {}),
      ...(!explicitTerm && focused ? { grade: { kind: "enum", values: [String(focused.grade)] } } : {}),
    }, sort: null } });
  const enumMatches = (id: string, value: string) => { const filter = table.filters[id]; return !filter || (filter.kind === "enum" ? filter.values.includes(value) : filter.kind !== "presence" || (filter.value === "present") === Boolean(value)); };
  const effectiveWorkFilter = recordState === "historical" ? "all" : workFilter;
  const matchingGroups = new Set(table.visibleRows.filter(row => {
    if (row.historical) return false;
    if (effectiveWorkFilter === "pending") return !row.classroom && row.students.some(student => !student.classroomId && student.status !== "withdrawn"
      && enumMatches("course", student.courseId));
    return row.classroom && placementClassMatchesWorkFilter(row.classroom, effectiveWorkFilter);
  }).map(row => row.group));
  // 待分班保留同组目标班级及已占座位；班额筛选只收窄班级，不生成虚假空位。
  const matchedRows = table.visibleRows.filter(row => {
    if (effectiveWorkFilter === "all") return true;
    if (row.historical || !matchingGroups.has(row.group)) return false;
    return row.classroom ? placementClassMatchesWorkFilter(row.classroom, effectiveWorkFilter) : true;
  });
  const allGroups = [...new Set(matchedRows.map((row) => row.group))];
  if (!table.sort || !["grade", "term"].includes(table.sort.field)) {
    allGroups.sort((a, b) => {
      const left = rows.find((row) => row.group === a)!;
      const right = rows.find((row) => row.group === b)!;
      return board.options.terms.findIndex((term) => term.id === left.termId) - board.options.terms.findIndex((term) => term.id === right.termId) || left.grade - right.grade;
    });
  }
  const orderedRows = allGroups.flatMap(group => {
    const groupRows = matchedRows.filter(row => row.group === group);
    return table.sort ? groupRows : groupRows.sort((a, b) => (!a.classroom && !a.historical ? -1 : !b.classroom && !b.historical ? 1
      : (a.classroom?.name ?? a.historical?.class_label ?? "").localeCompare(b.classroom?.name ?? b.historical?.class_label ?? "", locale, { numeric: true })));
  });
  const pagination = useFollowupPagination(orderedRows, JSON.stringify([query, recordState, effectiveWorkFilter, table.filters, table.sort]));
  const visibleRows = pagination.rows;
  const groups = [...new Set(visibleRows.map(row => row.group))];
  const queryText = query.trim().toLocaleLowerCase(locale);
  const textMatches = (id: string, value: string) => { const filter = table.filters[id]; return !filter || filter.kind !== "text" || value.toLocaleLowerCase(locale).includes(filter.query.trim().toLocaleLowerCase(locale)); };
  const matches = (student: PlacementStudent) => enumMatches("course", student.courseId)
    && enumMatches("health", placementHealth(board.health?.[student.studentId]).tone)
    && textMatches("student", student.name) && textMatches("phone", student.phone)
    && (!queryText || [student.name, student.phone, student.courseTitle, board.options.classrooms.find((classroom) => classroom.id === student.classroomId)?.name ?? ""].join(" ").toLocaleLowerCase(locale).includes(queryText));

  const targets = new Map<string, SeatTarget>();
  const registerTarget = (key: string, target: SeatTarget) => { targets.set(key, target); return { "data-placement-target": key }; };
  const accepts = (student: PlacementStudent | null, target: SeatTarget) => Boolean(student && !pending && !placementSeatTargetError(student, target.classroom, target, students));
  const targetAt = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-placement-target]");
    return element && root.current?.contains(element) ? element.dataset.placementTarget ?? null : null;
  };
  const move = (student: PlacementStudent, target: SeatTarget) => {
    const { classroom, seat } = target;
    if (pending || (student.classroomId === (classroom?.id ?? null) && student.seat === seat)) return;
    const error = placementSeatTargetError(student, classroom, target, students);
    if (error) { toast.error(t(enrollmentErrorKey(error))); return; }
    startMoving(async () => {
      const result = await moveEnrollmentSeatAction({ enrollmentId: student.enrollmentId, membershipId: student.membershipId, fromClassroomId: student.classroomId, toClassroomId: classroom?.id ?? null, seat, expectedSeat: student.seat });
      if (!result.ok) { toast.error(t(enrollmentErrorKey(result.code))); router.refresh(); return; }
      setSavedBoard({ base: initialBoard, value: result.data });
      setSelectedKey(null);
      toast.success(t("placementSaved", { name: student.name, placement: classroom?.name || t("returnPending") }));
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
      router.refresh();
    });
  };
  const pointer = useTilePointerDrag<string>({
    onStart: (drag) => { setSelectedKey(drag.data); pointerPosition.current = drag; },
    onMove: (drag) => { pointerPosition.current = drag; setHovered(targetAt(drag.clientX, drag.clientY)); },
    onEnd: (drag) => {
      pointerPosition.current = null;
      setHovered(null);
      const target = targets.get(targetAt(drag.clientX, drag.clientY) ?? "");
      const student = students.find((value) => value.key === drag.data);
      if (student && target && accepts(student, target)) move(student, target);
    },
    onCancel: () => { pointerPosition.current = null; setHovered(null); },
  });
  const dragging = Boolean(pointer.drag);
  useEffect(() => {
    if (!dragging) return;
    const container = root.current?.querySelector<HTMLElement>("[data-slot='table-container']");
    if (!container) return;
    let frame = 0;
    const scroll = () => {
      const position = pointerPosition.current;
      if (position) {
        const rect = container.getBoundingClientRect();
        const speed = (value: number, start: number, end: number) => value < start + 36 ? -Math.min(12, (start + 36 - value) / 3) : value > end - 36 ? Math.min(12, (value - end + 36) / 3) : 0;
        if (position.clientX >= rect.left - 36 && position.clientX <= rect.right + 36 && position.clientY >= rect.top - 36 && position.clientY <= rect.bottom + 36) {
          const previousTop = container.scrollTop;
          const previousLeft = container.scrollLeft;
          container.scrollBy(speed(position.clientX, rect.left, rect.right), speed(position.clientY, rect.top, rect.bottom));
          if (container.scrollTop !== previousTop || container.scrollLeft !== previousLeft) {
            const target = document.elementFromPoint(position.clientX, position.clientY)?.closest<HTMLElement>("[data-placement-target]");
            setHovered(target && root.current?.contains(target) ? target.dataset.placementTarget ?? null : null);
          }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  useEffect(() => {
    if (focusStudentId) root.current?.querySelector<HTMLElement>("[data-placement-focus='true']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusStudentId]);

  const studentTile = (student: StudentTileRecord, target?: SeatTarget) => {
    const signals = student.placement ? board.health?.[student.studentId ?? ""] ?? [] : [];
    const health = student.placement ? placementHealth(signals) : null;
    const renewed = Boolean(student.placement?.membershipId && renewedMembershipIds.has(student.placement.membershipId));
    const movable = Boolean(student.placement && student.status !== "withdrawn" && !pending);
    const swapping = Boolean(student.placement && selected && selected.key !== student.key && target && accepts(selected, target));
    return <Tooltip key={student.key}><TooltipTrigger asChild><span
      data-placement-student={student.key}
      data-placement-renewed={renewed}
      data-placement-health={health?.tone}
      data-placement-focus={student.studentId === focusStudentId}
      onPointerDown={(event) => { if (movable) pointer.begin(event, student.key, (event.target as HTMLElement).closest("button") ?? event.currentTarget); }}
      onClickCapture={(event) => {
        if (!swapping || (event.target as HTMLElement).closest("[data-placement-select]")) return;
        event.preventDefault(); event.stopPropagation();
        if (selected && target) move(selected, target);
      }}
      className={cn("group relative flex min-h-9 min-w-0 select-none items-center justify-center px-1", movable && "touch-none cursor-grab active:cursor-grabbing", selectedKey === student.key && "ring-2 ring-inset ring-crater", student.studentId === focusStudentId && "outline-2 -outline-offset-2 outline-leaf-deep", student.placement && !matches(student.placement) && "opacity-35")}
      style={{ background: placementStudentBackground(health, renewed) }}
    >
      {student.sourceEnrollment?<button type="button" onClick={()=>setSourceEnrollment(student.sourceEnrollment!)} className="w-full truncate py-1 text-xs hover:underline">{student.name}</button>:<Student360Trigger subject={{ studentId: student.studentId, leadId: null }} fallback={{ name: student.name, phone: student.phone, grade: student.grade || null }} className="flex w-full min-w-0 flex-col items-center justify-center py-1 text-xs font-normal">
        <span className="max-w-full truncate">{student.name}</span>
        {student.status && student.status !== "active" ? <span className="whitespace-nowrap text-[9px] leading-3 text-muted">{t(`status_${student.status}`)}</span> : null}
      </Student360Trigger>}
      {movable ? <button type="button" data-placement-select aria-label={t("selectStudent", { name: student.name })} aria-pressed={selectedKey === student.key} className="absolute right-0 top-0 flex h-full w-3 items-center justify-center bg-card/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-crater" onClick={() => setSelectedKey((value) => value === student.key ? null : student.key)}><GripVertical className="size-3" /></button> : null}
    </span></TooltipTrigger><TooltipContent className="max-w-80 space-y-1 text-xs leading-5">
      <p className="font-medium">{student.name}{student.status && student.status !== "active" ? t(`status_${student.status}`) : ""}</p><p>{student.courseTitle}</p>{target?.seat ? <p>{t("capacitySlot", { count: target.seat })}</p> : null}
      {student.phone ? <p>{student.phone}</p> : null}{student.recommendation ? <p>{student.recommendation}</p> : null}{student.note ? <p>{student.note}</p> : null}
      {health ? <p>{t(`health_${health.tone}`)}</p> : <HistoricalRecordBadge locale={locale} />}{signals.filter((signal) => signal.level === "observed" || signal.level === "attention").map((signal) => <p key={signal.key}>{healthT(signal.key)} · {healthT(signal.level)}{signal.total ? ` (${signal.count ?? 0}/${signal.total})` : ""}</p>)}
      <p>{student.placement ? t("studentInteraction") : recordM.viewStudent}</p>
    </TooltipContent></Tooltip>;
  };
  const retiredRow = (retired: PlacementStudent[], label: string) => retired.length ? <TableRow className="hover:bg-transparent"><TableCell colSpan={3} className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1 text-[11px] text-muted">{label}</TableCell><TableCell className="p-0"><div className={NAME_GRID}>{retired.map((student) => studentTile(studentTileRecord(student)))}</div></TableCell></TableRow> : null;
  return <DashboardPage title={t("placementTitle")} density="compact" commandPanel={<FollowupCommandPanel>
    <DashboardCommandState><FollowupTabs /></DashboardCommandState>
    <DashboardCommandFilters>
      <FollowupPrimaryFilter label={filterT("workQueue")} value={effectiveWorkFilter} disabled={pending}
        options={PLACEMENT_WORK_FILTERS.map(value => ({ value, label: filterT(`enrollments_${value}`) }))}
        onValueChange={value => {
          pointer.cancel(); setSelectedKey(null); setWorkFilter(value as PlacementWorkFilter);
          if (value !== "all" && recordState === "historical") setRecordState("current");
        }} />
      <DashboardTableColumnHeader label={t("term")} {...table.columnProps("term")} />
      <DashboardTableColumnHeader label={t("targetGrade")} {...table.columnProps("grade")} />
      <DashboardTableColumnHeader label={t("course")} {...table.columnProps("course")} />
      <BusinessRecordStateFilter presentation="followup" value={recordState} onChange={value => {
        if (pending) return;
        pointer.cancel(); setSelectedKey(null); setRecordState(value);
        if (value === "historical") setWorkFilter("all");
      }} locale={locale}/>
      <FilterSearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlacement")} aria-label={t("searchPlacement")} />
    </DashboardCommandFilters>
    <DashboardCommandActions><span role="status" className={cn("flex w-32 items-center justify-end gap-1 text-xs text-muted", !selected && "invisible")} title={selected ? t("selectedHint", { name: selected.name }) : undefined}><span className="truncate">{selected?.name}</span><Button size="sm" variant="ghost" className="size-7 shrink-0 p-0" aria-label={t("clearSelection")} disabled={!selected || pending} onClick={() => setSelectedKey(null)}>{pending ? <LoaderCircle className="size-3 animate-spin" /> : <X className="size-3" />}</Button></span>{canCreateClass ? <Link href="/dashboard/classes/new" className={buttonVariants({ size: "sm", variant: "secondary" })}><Plus className="size-4" />{t("createClass")}</Link> : null}</DashboardCommandActions>
  </FollowupCommandPanel>} footer={<LeadPoolPagination baseHref="/dashboard/followups/enrollments" currentPage={pagination.page} totalPages={pagination.totalPages} totalCount={pagination.count}
    pageSize={pagination.pageSize} disabled={pending} onPageChange={(page, size) => { pointer.cancel(); setSelectedKey(null); pagination.onPageChange(page, size); }} />}>
    <div ref={root} className="flex min-h-0 flex-1 flex-col" onPointerMove={pointer.onPointerMove} onPointerUp={pointer.onPointerUp} onPointerCancel={pointer.onPointerCancel} onLostPointerCapture={pointer.onLostPointerCapture} onClickCapture={pointer.onClickCapture} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { pointer.cancel(); setSelectedKey(null); } }}>
      <TooltipProvider delayDuration={350}><DashboardTableShell data-followup-scroll><Table className="min-w-[44rem] table-fixed text-xs" containerClassName="overflow-auto" aria-busy={pending}>
        <colgroup><col className="w-36" /><col className="w-28" /><col className="w-20" /><col /></colgroup>
        <TableHeader><TableRow className="[&>th]:h-8 [&>th]:px-2">
          <TableHead className="sticky left-0 top-0 z-30 border-r border-line bg-card"><DashboardTableColumnHeader label={t("classLabel")} {...table.columnProps("classroom")} /></TableHead>
          <TableHead className="sticky left-36 top-0 z-30 border-r border-line bg-card"><DashboardTableColumnHeader label={t("timeLabel")} {...table.columnProps("time")} /></TableHead>
          <TableHead className="sticky left-64 top-0 z-30 border-r border-line bg-card"><DashboardTableColumnHeader label={t("teacherLabel")} {...table.columnProps("teacher")} /></TableHead>
          <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("student")} {...table.columnProps("health")} /></TableHead>
        </TableRow></TableHeader>
        <TableBody><SchoolSupportPendingRows workspace="enrollments" colSpan={4} />{groups.map((group) => {
          const scope = rows.find((row) => row.group === group && !row.classroom)!;
          const pendingStudents = scope.students.filter((student) => !student.classroomId && student.status !== "withdrawn" && enumMatches("course", student.courseId));
          const classrooms = visibleRows.filter((row) => row.group === group && (row.classroom || row.historical));
          const pendingTarget: SeatTarget = { classroom: null, termId: scope.termId, grade: scope.grade, seat: null };
          const canReturn = Boolean(selected?.classroomId && accepts(selected, pendingTarget));
          const pendingTargetKey = `${group}:pending`;
          return <Fragment key={group}>
            <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="h-8 bg-paper px-2 py-1 font-medium"><span className="sticky left-2">{scope.grade ? t("grade", { grade: scope.grade }) : t("gradePending")}<span className="ml-3 text-[11px] font-normal text-muted">{scope.historical?.period_label ?? terms.get(scope.termId) ?? "—"}</span>{scope.historical ? <HistoricalRecordBadge locale={locale} /> : null}</span></TableCell></TableRow>
            {!scope.historical && visibleRows.some(row => row.key === `${group}:pending`) ? <TableRow data-placement-pending={group} className="hover:bg-transparent" {...registerTarget(pendingTargetKey, pendingTarget)}>
              <TableCell colSpan={3} className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1"><div className="flex items-center justify-between gap-1"><span>{t("pendingRow", { count: pendingStudents.length })}</span>{canReturn ? <Button size="sm" variant="ghost" className="h-7 px-1 text-[11px]" onClick={() => { if (selected) move(selected, pendingTarget); }}>{t("returnPending")}</Button> : null}</div></TableCell>
              <TableCell className={cn("p-0", canReturn && "ring-1 ring-inset ring-crater/50", hovered === pendingTargetKey && canReturn && "bg-moon/30 ring-2 ring-crater")}><div className={cn(NAME_GRID, "min-h-9")}>{pendingStudents.map((student) => studentTile(studentTileRecord(student)))}{!pendingStudents.length ? <span className="col-span-full px-2 py-2 text-[11px] text-muted">{t("noPending")}</span> : null}</div></TableCell>
            </TableRow> : null}
            {classrooms.map((row) => {
              const classroom = row.classroom;
              const fact = row.historical;
              const className = classroom?.name ?? fact?.class_label ?? recordM.unknown;
              const teacher = classroom?.teacherNames ?? fact?.teacher_label ?? recordM.unknown;
              const time = classroom ? schedule(classroom) : fact?.schedule_label || recordM.unknown;
              const courseTitle = classroom ? courses.get(classroom.courseId) : fact?.period_label;
              const slots = classroom ? placementRosterSeats(classroom, row.students) : [];
              return <Fragment key={row.key}><TableRow data-record-state={fact ? fact.record_state ?? 'historical' : 'current'} data-placement-classroom={classroom?.id} data-placement-record={row.key} className="hover:bg-transparent">
                <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1"><div className="flex items-center justify-between gap-1">{classroom ? <Link href={`/dashboard/classes/${classroom.id}`} className="min-w-0 truncate font-medium hover:underline" title={className}>{className}</Link> : <span className="min-w-0 truncate font-medium" title={className}>{className}</span>}{classroom ? <span className="shrink-0 text-[10px] tabular-nums text-muted">{classroom.activeCount}/{classroom.capacity ?? "∞"}</span> : null}</div><div className="truncate text-[10px] text-muted" title={courseTitle}>{courseTitle}</div>{fact ? <p className="mt-1 text-[10px] text-muted">{fact.registered_on ?? recordM.unknown} · {fact.amount ?? fact.amount_original}</p> : null}</TableCell>
                <TableCell className="sticky left-36 z-10 border-r border-line bg-card px-2 py-1 text-[11px]" title={time}><span className="line-clamp-2 break-words">{time}</span>{fact?.room_label ? <p className="mt-1 text-muted">{fact.room_label}</p> : null}</TableCell>
                <TableCell className="sticky left-64 z-10 border-r border-line bg-card px-2 py-1" title={teacher}><span className="block truncate">{teacher || "—"}</span></TableCell>
                <TableCell className="bg-paper/50 p-0"><div className={NAME_GRID}>{(row.sourceEnrollments??[]).map(item=>studentTile({key:item.id,studentId:item.student_id,name:history?.students[businessSubjectKey(item)]??recordM.unknown,phone:history?.subjects[businessSubjectKey(item)]?.phone??'',grade:history?.subjects[businessSubjectKey(item)]?.grade??0,status:null,courseTitle:item.period_label,recommendation:'',note:item.note??'',sourceEnrollment:item}))}{classroom ? slots.map(({ seat, student }) => {
                  const target = { classroom, termId: scope.termId, grade: scope.grade, seat };
                  const key = `${classroom.id}:${seat}`;
                  const eligible = accepts(selected, target);
                  return <div key={seat} {...registerTarget(key, target)} className={cn("relative min-w-0 border-b border-line", eligible && "ring-1 ring-inset ring-crater/40", hovered === key && eligible && "z-10 ring-2 ring-crater", hovered === key && !eligible && dragging && "ring-2 ring-rose")}>
                    {student ? studentTile(studentTileRecord(student), target) : classroom.capacity !== null && seat > classroom.capacity ? <span className="flex min-h-9 items-center justify-center text-line" aria-label={t("noSeat")}>—</span> : <button type="button" className="flex min-h-9 w-full items-center justify-center gap-1 bg-card text-[10px] tabular-nums text-muted/50 enabled:hover:bg-moon/25 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-crater" disabled={selected ? !eligible : !canAdd} aria-label={selected ? t("placeInSeat", { name: selected.name, classroom: classroom.name, seat }) : canAdd ? (locale === "en" ? `Add student · ${classroom.name} · Seat ${seat}` : `补入学生 · ${classroom.name} · ${seat} 号位`) : t("emptySeatNumber", { seat })} onClick={() => { if (selected) move(selected, target); else setSeatEntry({classroom,seat}); }}><span className="absolute right-1 text-[9px] text-muted/40">{seat}</span>{eligible || canAdd ? <Plus className="size-4 rounded-full border border-line bg-card p-0.5 text-muted" /> : seat}</button>}
                  </div>;
                }) : null}</div></TableCell>
              </TableRow>{retiredRow(row.students.filter((student) => student.status === "withdrawn"), `${className} ${t("status_withdrawn")}`)}</Fragment>;
            })}
            {retiredRow(scope.students.filter((student) => !student.classroomId && student.status === "withdrawn"), t("status_withdrawn"))}
            {retiredRow(scope.students.filter((student) => student.classroomId && !scope.classrooms.some((classroom) => classroom.id === student.classroomId)), t("unavailableClass"))}
          </Fragment>;
        })}{!groups.length ? <TableRow><TableCell colSpan={4} className="h-40 text-center text-muted">{t("emptyPlacement")}</TableCell></TableRow> : null}</TableBody>
      </Table></DashboardTableShell></TooltipProvider>
      {seatEntry?<SchoolSupportSeatEntry open onClose={()=>setSeatEntry(null)} classroomName={seatEntry.classroom.name} classroomId={seatEntry.classroom.id} courseId={seatEntry.classroom.courseId} termId={seatEntry.classroom.termId} seat={seatEntry.seat}/>:null}
      {sourceEnrollment?<SourceEnrollmentPlacementDialog record={sourceEnrollment} name={history?.students[businessSubjectKey(sourceEnrollment)]??recordM.unknown} options={board.options} locale={locale} onClose={()=>setSourceEnrollment(null)} onSaved={value=>{setSavedBoard({base:initialBoard,value});setSourceEnrollment(null);router.refresh();}}/>:null}
      {pointer.drag ? <div aria-hidden className="pointer-events-none fixed z-50 min-w-20 rounded-sm border border-crater bg-card px-3 py-2 text-center text-xs shadow-lg" style={{ left: pointer.drag.clientX + 12, top: pointer.drag.clientY + 12 }}>{students.find((student) => student.key === pointer.drag?.data)?.name}</div> : null}
    </div>
  </DashboardPage>;
}
