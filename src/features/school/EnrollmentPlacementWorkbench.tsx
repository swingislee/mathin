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
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState, DashboardPage, DashboardTableColumnHeader, DashboardTableShell, useDashboardTableView } from "./dashboard-page";
import { useDashboardSearchQuery } from "./dashboard-page/DashboardPreferenceScope";
import { classWeeklyScheduleLabel, enrollmentErrorKey, placementHealth, placementStudents, type EnrollmentPlacementBoard, type PlacementClassroom, type PlacementStudent } from "./enrollment-workflow-contract";
import { moveEnrollmentSeatAction } from "./enrollment-workflow-actions";
import { placementRosterSeats, placementSeatTargetError } from "./placement-roster";
import { useTilePointerDrag } from "./tile-pointer-drag";

interface RosterRow {
  key: string;
  group: string;
  grade: number;
  termId: string;
  classroom: PlacementClassroom | null;
  classrooms: PlacementClassroom[];
  students: PlacementStudent[];
}

interface SeatTarget {
  classroom: PlacementClassroom | null;
  termId: string;
  grade: number;
  seat: number | null;
}

const NAME_GRID = "grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-px";

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

export function EnrollmentPlacementWorkbench({ initialBoard, initialTermId, focusStudentId, canCreateClass }: {
  initialBoard: EnrollmentPlacementBoard; initialTermId?: string; focusStudentId?: string; canCreateClass: boolean;
}) {
  const t = useTranslations("school.enrollmentWorkflow");
  const healthT = useTranslations("school.renewals.poolV2");
  const locale = useLocale();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const pointerPosition = useRef<{ clientX: number; clientY: number } | null>(null);
  const [savedBoard, setSavedBoard] = useState<{ base: EnrollmentPlacementBoard; value: EnrollmentPlacementBoard } | null>(null);
  const board = savedBoard?.base === initialBoard ? savedBoard.value : initialBoard;
  const [query, setQuery] = useDashboardSearchQuery("enrollments");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pending, startMoving] = useTransition();
  const students = useMemo(() => placementStudents(board), [board]);
  const selected = students.find((student) => student.key === selectedKey) ?? null;
  const rows = useMemo(() => rosterRows(board, students), [board, students]);
  const terms = new Map(board.options.terms.map((term) => [term.id, term.name]));
  const courses = new Map(board.options.courses.map((course) => [course.id, course.title]));
  const schedule = (classroom: PlacementClassroom) => classWeeklyScheduleLabel(classroom, locale) || t("schedulePending");
  const classValues = (row: RosterRow) => row.classroom ? [row.classroom] : row.classrooms;
  const columns = {
    grade: { filterValues: (row: RosterRow) => ({ value: String(row.grade), label: row.grade ? t("grade", { grade: row.grade }) : t("gradePending") }), sortValue: (row: RosterRow) => row.grade },
    term: { filterValues: (row: RosterRow) => ({ value: row.termId, label: terms.get(row.termId) ?? "—" }), sortValue: (row: RosterRow) => terms.get(row.termId) },
    course: { filterValues: (row: RosterRow) => [...new Set([...classValues(row).map((value) => value.courseId), ...row.students.map((student) => student.courseId)])].map((value) => ({ value, label: courses.get(value) ?? row.students.find((student) => student.courseId === value)?.courseTitle ?? "—" })), sortValue: (row: RosterRow) => courses.get(row.classroom?.courseId ?? "") },
    classroom: { filterValues: (row: RosterRow) => classValues(row).map((value) => ({ value: value.id, label: value.name })), sortValue: (row: RosterRow) => row.classroom?.name },
    teacher: { filterValues: (row: RosterRow) => classValues(row).map((value) => ({ value: value.teacherNames || "$pending", label: value.teacherNames || t("teacherPending") })), sortValue: (row: RosterRow) => row.classroom?.teacherNames },
    time: { filterValues: (row: RosterRow) => classValues(row).map((value) => ({ value: schedule(value), label: schedule(value) })), sortValue: (row: RosterRow) => row.classroom && schedule(row.classroom) },
    health: { filterValues: (row: RosterRow) => row.students.map((student) => { const tone = placementHealth(board.health?.[student.studentId]).tone; return { value: tone, label: t(`legend_${tone}`) }; }), sortValue: (row: RosterRow) => row.classroom?.name },
  };
  const focused = students.find((student) => student.studentId === focusStudentId);
  const explicitTerm = board.options.terms.find((term) => term.id === initialTermId)?.id;
  const table = useDashboardTableView({ rows, columns, locale, persistenceKey: "followup-enrollment-roster", initialFilters: explicitTerm ? { term: explicitTerm } : focused ? { term: focused.termId, grade: String(focused.grade) } : undefined });
  const pendingMatchesClassFilters = (row: RosterRow) => !table.filters.classroom && !table.filters.teacher && !table.filters.time || row.classrooms.some((classroom) =>
    (!table.filters.classroom || classroom.id === table.filters.classroom)
    && (!table.filters.teacher || (classroom.teacherNames || "$pending") === table.filters.teacher)
    && (!table.filters.time || schedule(classroom) === table.filters.time)
    && (!table.filters.course || classroom.courseId === table.filters.course));
  const visibleRows = table.visibleRows.filter((row) => row.classroom || pendingMatchesClassFilters(row));
  const groups = [...new Set(visibleRows.map((row) => row.group))];
  if (!table.sort || !["grade", "term"].includes(table.sort.column)) {
    groups.sort((a, b) => {
      const left = rows.find((row) => row.group === a)!;
      const right = rows.find((row) => row.group === b)!;
      return board.options.terms.findIndex((term) => term.id === left.termId) - board.options.terms.findIndex((term) => term.id === right.termId) || left.grade - right.grade;
    });
  }
  const queryText = query.trim().toLocaleLowerCase(locale);
  const matches = (student: PlacementStudent) => (!table.filters.course || student.courseId === table.filters.course)
    && (!table.filters.health || placementHealth(board.health?.[student.studentId]).tone === table.filters.health)
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

  const studentTile = (student: PlacementStudent, target?: SeatTarget) => {
    const signals = board.health?.[student.studentId] ?? [];
    const health = placementHealth(signals);
    const movable = student.status !== "withdrawn" && !pending;
    const swapping = Boolean(selected && selected.key !== student.key && target && accepts(selected, target));
    return <Tooltip key={student.key}><TooltipTrigger asChild><span
      data-placement-student={student.key}
      data-placement-focus={student.studentId === focusStudentId}
      onPointerDown={(event) => { if (movable) pointer.begin(event, student.key, (event.target as HTMLElement).closest("button") ?? event.currentTarget); }}
      onClickCapture={(event) => {
        if (!swapping || (event.target as HTMLElement).closest("[data-placement-select]")) return;
        event.preventDefault(); event.stopPropagation();
        if (selected && target) move(selected, target);
      }}
      className={cn("group relative flex min-h-9 min-w-0 select-none items-center justify-center px-1", movable && "touch-none cursor-grab active:cursor-grabbing", selectedKey === student.key && "ring-2 ring-inset ring-crater", student.studentId === focusStudentId && "outline-2 -outline-offset-2 outline-leaf-deep", !matches(student) && "opacity-35")}
      style={{ background: health.background }}
    >
      <Student360Trigger subject={{ studentId: student.studentId, leadId: null }} fallback={{ name: student.name, phone: student.phone, grade: student.grade || null }} className="flex w-full min-w-0 flex-col items-center justify-center py-1 text-xs font-normal">
        <span className="max-w-full truncate">{student.name}</span>
        {student.status !== "active" ? <span className="whitespace-nowrap text-[9px] leading-3 text-muted">{t(`status_${student.status}`)}</span> : null}
      </Student360Trigger>
      {movable ? <button type="button" data-placement-select aria-label={t("selectStudent", { name: student.name })} aria-pressed={selectedKey === student.key} className="absolute right-0 top-0 flex h-full w-3 items-center justify-center bg-card/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-crater" onClick={() => setSelectedKey((value) => value === student.key ? null : student.key)}><GripVertical className="size-3" /></button> : null}
    </span></TooltipTrigger><TooltipContent className="max-w-80 space-y-1 text-xs leading-5">
      <p className="font-medium">{student.name}{student.status !== "active" ? t(`status_${student.status}`) : ""}</p><p>{student.courseTitle}</p>{target?.seat ? <p>{t("capacitySlot", { count: target.seat })}</p> : null}
      {student.phone ? <p>{student.phone}</p> : null}{student.recommendation ? <p>{student.recommendation}</p> : null}{student.note ? <p>{student.note}</p> : null}
      <p>{t(`health_${health.tone}`)}</p>{signals.filter((signal) => signal.level === "observed" || signal.level === "attention").map((signal) => <p key={signal.key}>{healthT(signal.key)} · {healthT(signal.level)}{signal.total ? ` (${signal.count ?? 0}/${signal.total})` : ""}</p>)}
      <p>{t("studentInteraction")}</p>
    </TooltipContent></Tooltip>;
  };
  const retiredRow = (retired: PlacementStudent[], label: string) => retired.length ? <TableRow className="hover:bg-transparent"><TableCell colSpan={3} className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1 text-[11px] text-muted">{label}</TableCell><TableCell className="p-0"><div className={NAME_GRID}>{retired.map((student) => studentTile(student))}</div></TableCell></TableRow> : null;
  const visibleClassIds = new Set(visibleRows.flatMap((row) => row.classroom ? [row.classroom.id] : []));
  const scopeStudents = students.filter((student) => (student.classroomId ? visibleClassIds.has(student.classroomId) : groups.includes(`${student.termId}:${student.grade}`)) && (!table.filters.course || student.courseId === table.filters.course));

  return <DashboardPage title={t("placementTitle")} density="compact" commandPanel={<DashboardCommandPanel>
    <DashboardCommandState><FollowupTabs /><span className="whitespace-nowrap text-xs text-muted">{t("placementCounts", { pending: scopeStudents.filter((student) => !student.classroomId && student.status !== "withdrawn").length, assigned: scopeStudents.filter((student) => student.classroomId && student.status !== "withdrawn").length })}</span></DashboardCommandState>
    <DashboardCommandFilters>
      <DashboardTableColumnHeader label={table.filters.term ? terms.get(table.filters.term) ?? t("term") : t("followupAllTerms")} {...table.columnProps("term")} />
      <DashboardTableColumnHeader label={table.filters.grade ? t("grade", { grade: Number(table.filters.grade) }) : t("targetGrade")} {...table.columnProps("grade")} />
      <DashboardTableColumnHeader label={table.filters.course ? courses.get(table.filters.course) ?? t("course") : t("course")} {...table.columnProps("course")} />
      <FilterSearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlacement")} aria-label={t("searchPlacement")} />
    </DashboardCommandFilters>
    <DashboardCommandActions><span role="status" className={cn("flex w-32 items-center justify-end gap-1 text-xs text-muted", !selected && "invisible")} title={selected ? t("selectedHint", { name: selected.name }) : undefined}><span className="truncate">{selected?.name}</span><Button size="sm" variant="ghost" className="size-7 shrink-0 p-0" aria-label={t("clearSelection")} disabled={!selected || pending} onClick={() => setSelectedKey(null)}>{pending ? <LoaderCircle className="size-3 animate-spin" /> : <X className="size-3" />}</Button></span>{canCreateClass ? <Link href="/dashboard/classes/new" className={buttonVariants({ size: "sm", variant: "secondary" })}><Plus className="size-4" />{t("createClass")}</Link> : null}</DashboardCommandActions>
  </DashboardCommandPanel>}>
    <div ref={root} onPointerMove={pointer.onPointerMove} onPointerUp={pointer.onPointerUp} onPointerCancel={pointer.onPointerCancel} onLostPointerCapture={pointer.onLostPointerCapture} onClickCapture={pointer.onClickCapture} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { pointer.cancel(); setSelectedKey(null); } }}>
      <TooltipProvider delayDuration={350}><DashboardTableShell><Table className="min-w-[44rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-12rem)] overflow-auto" aria-busy={pending}>
        <colgroup><col className="w-36" /><col className="w-28" /><col className="w-20" /><col /></colgroup>
        <TableHeader><TableRow className="[&>th]:h-8 [&>th]:px-2">
          <TableHead className="sticky left-0 top-0 z-30 border-r border-line bg-card"><DashboardTableColumnHeader label={t("classLabel")} {...table.columnProps("classroom")} /></TableHead>
          <TableHead className="sticky left-36 top-0 z-30 border-r border-line bg-card"><DashboardTableColumnHeader label={t("timeLabel")} {...table.columnProps("time")} /></TableHead>
          <TableHead className="sticky left-64 top-0 z-30 border-r border-line bg-card"><DashboardTableColumnHeader label={t("teacherLabel")} {...table.columnProps("teacher")} /></TableHead>
          <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("student")} {...table.columnProps("health")} /></TableHead>
        </TableRow></TableHeader>
        <TableBody>{groups.map((group) => {
          const scope = rows.find((row) => row.group === group && !row.classroom)!;
          const pendingStudents = scope.students.filter((student) => !student.classroomId && student.status !== "withdrawn" && (!table.filters.course || student.courseId === table.filters.course));
          const classrooms = table.visibleRows.filter((row) => row.group === group && row.classroom);
          if (!table.sort) classrooms.sort((a, b) => a.classroom!.name.localeCompare(b.classroom!.name, locale, { numeric: true }));
          const pendingTarget: SeatTarget = { classroom: null, termId: scope.termId, grade: scope.grade, seat: null };
          const canReturn = Boolean(selected?.classroomId && accepts(selected, pendingTarget));
          const pendingTargetKey = `${group}:pending`;
          return <Fragment key={group}>
            <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="h-8 bg-paper px-2 py-1 font-medium"><span className="sticky left-2">{scope.grade ? t("grade", { grade: scope.grade }) : t("gradePending")}<span className="ml-3 text-[11px] font-normal text-muted">{terms.get(scope.termId) ?? "—"}</span></span></TableCell></TableRow>
            <TableRow data-placement-pending={group} className="hover:bg-transparent" {...registerTarget(pendingTargetKey, pendingTarget)}>
              <TableCell colSpan={3} className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1"><div className="flex items-center justify-between gap-1"><span>{t("pendingRow", { count: pendingStudents.length })}</span>{canReturn ? <Button size="sm" variant="ghost" className="h-7 px-1 text-[11px]" onClick={() => { if (selected) move(selected, pendingTarget); }}>{t("returnPending")}</Button> : null}</div></TableCell>
              <TableCell className={cn("p-0", canReturn && "ring-1 ring-inset ring-crater/50", hovered === pendingTargetKey && canReturn && "bg-moon/30 ring-2 ring-crater")}><div className={cn(NAME_GRID, "min-h-9")}>{pendingStudents.map((student) => studentTile(student))}{!pendingStudents.length ? <span className="col-span-full px-2 py-2 text-[11px] text-muted">{t("noPending")}</span> : null}</div></TableCell>
            </TableRow>
            {classrooms.map((row) => {
              const classroom = row.classroom!;
              const slots = placementRosterSeats(classroom, row.students);
              return <Fragment key={row.key}><TableRow data-placement-classroom={classroom.id} className="hover:bg-transparent">
                <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1"><div className="flex items-center justify-between gap-1"><Link href={`/dashboard/classes/${classroom.id}`} className="min-w-0 truncate font-medium hover:underline" title={classroom.name}>{classroom.name}</Link><span className="shrink-0 text-[10px] tabular-nums text-muted">{classroom.activeCount}/{classroom.capacity ?? "∞"}</span></div><div className="truncate text-[10px] text-muted" title={courses.get(classroom.courseId)}>{courses.get(classroom.courseId)}</div></TableCell>
                <TableCell className="sticky left-36 z-10 border-r border-line bg-card px-2 py-1 text-[11px]" title={schedule(classroom)}><span className="line-clamp-2 break-words">{schedule(classroom)}</span></TableCell>
                <TableCell className="sticky left-64 z-10 border-r border-line bg-card px-2 py-1" title={classroom.teacherNames}><span className="block truncate">{classroom.teacherNames || "—"}</span></TableCell>
                <TableCell className="bg-paper/50 p-0"><div className={NAME_GRID}>{slots.map(({ seat, student }) => {
                  const target = { classroom, termId: scope.termId, grade: scope.grade, seat };
                  const key = `${classroom.id}:${seat}`;
                  const eligible = accepts(selected, target);
                  return <div key={seat} {...registerTarget(key, target)} className={cn("relative min-w-0 border-b border-line", eligible && "ring-1 ring-inset ring-crater/40", hovered === key && eligible && "z-10 ring-2 ring-crater", hovered === key && !eligible && dragging && "ring-2 ring-rose")}>
                    {student ? studentTile(student, target) : classroom.capacity !== null && seat > classroom.capacity ? <span className="flex min-h-9 items-center justify-center text-line" aria-label={t("noSeat")}>—</span> : <button type="button" className="flex min-h-9 w-full items-center justify-center gap-1 bg-card text-[10px] tabular-nums text-muted/50 enabled:hover:bg-moon/25 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-crater" disabled={!eligible} aria-label={selected ? t("placeInSeat", { name: selected.name, classroom: classroom.name, seat }) : t("emptySeatNumber", { seat })} onClick={() => { if (selected) move(selected, target); }}>{eligible ? <Plus className="size-3" /> : null}{seat}</button>}
                  </div>;
                })}</div></TableCell>
              </TableRow>{retiredRow(row.students.filter((student) => student.status === "withdrawn"), `${classroom.name} ${t("status_withdrawn")}`)}</Fragment>;
            })}
            {retiredRow(scope.students.filter((student) => !student.classroomId && student.status === "withdrawn"), t("status_withdrawn"))}
            {retiredRow(scope.students.filter((student) => student.classroomId && !scope.classrooms.some((classroom) => classroom.id === student.classroomId)), t("unavailableClass"))}
          </Fragment>;
        })}{!groups.length ? <TableRow><TableCell colSpan={4} className="h-40 text-center text-muted">{t("emptyPlacement")}</TableCell></TableRow> : null}</TableBody>
      </Table></DashboardTableShell></TooltipProvider>
      {pointer.drag ? <div aria-hidden className="pointer-events-none fixed z-50 min-w-20 rounded-sm border border-crater bg-card px-3 py-2 text-center text-xs shadow-lg" style={{ left: pointer.drag.clientX + 12, top: pointer.drag.clientY + 12 }}>{students.find((student) => student.key === pointer.drag?.data)?.name}</div> : null}
    </div>
  </DashboardPage>;
}
