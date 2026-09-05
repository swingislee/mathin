"use client";

import { Fragment, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GripVertical, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { Student360Trigger } from "./Student360Sheet";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState, DashboardPage, DashboardTableColumnHeader, DashboardTableShell } from "./dashboard-page";
import { classWeeklyScheduleLabel, enrollmentErrorKey, placementDestinationError, placementHealth, placementStudents, type EnrollmentPlacementBoard, type PlacementClassroom, type PlacementStudent } from "./enrollment-workflow-contract";
import { moveEnrollmentSeatAction } from "./enrollment-workflow-actions";

const DRAG_TYPE = "application/x-mathin-enrollment";
export function EnrollmentPlacementWorkbench({ initialBoard, initialTermId, focusStudentId, canCreateClass }: {
  initialBoard: EnrollmentPlacementBoard; initialTermId?: string; focusStudentId?: string; canCreateClass: boolean;
}) {
  const t = useTranslations("school.enrollmentWorkflow");
  const healthT = useTranslations("school.renewals.poolV2");
  const locale = useLocale();
  const router = useRouter();
  const [savedBoard, setSavedBoard] = useState<{ base: EnrollmentPlacementBoard; value: EnrollmentPlacementBoard } | null>(null);
  const board = savedBoard?.base === initialBoard ? savedBoard.value : initialBoard;
  const [termId, setTermId] = useState(() => board.options.terms.find((term) => term.id === initialTermId)?.id ?? board.options.terms.find((term) => term.isCurrent)?.id ?? board.options.terms[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState<string | undefined>();
  const [teacherFilter, setTeacherFilter] = useState<string | undefined>();
  const [timeFilter, setTimeFilter] = useState<string | undefined>();
  const [sort, setSort] = useState<"asc" | "desc" | undefined>();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pending, startMoving] = useTransition();
  const students = placementStudents(board);
  const selected = students.find((student) => student.key === selectedKey) ?? null;
  const termStudents = students.filter((student) => student.termId === termId);
  const termClasses = board.options.classrooms.filter((classroom) => classroom.termId === termId);
  const gradeOf = (classroom: PlacementClassroom) => board.options.courses.find((course) => course.id === classroom.courseId)?.grade ?? 0;
  const grades = [...new Set([...termStudents.map((student) => student.grade), ...termClasses.map(gradeOf)])].sort((a, b) => a - b);
  const visibleGrades = grades.filter((grade) => !gradeFilter || String(grade) === gradeFilter);
  const columns = Math.max(1, ...termClasses.map((classroom) => Math.max(classroom.capacity ?? classroom.activeCount + 1, ...termStudents.filter((student) => student.classroomId === classroom.id && student.status !== "withdrawn").map((student) => student.seat ?? 0))));
  const schedule = (classroom: PlacementClassroom) => classWeeklyScheduleLabel(classroom, locale) || t("schedulePending");
  const matches = (student: PlacementStudent) => !query || [student.name, student.phone, student.courseTitle].join(" ").toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale));
  const move = (student: PlacementStudent, classroom: PlacementClassroom | null, seat: number | null) => {
    if (pending || (student.classroomId === (classroom?.id ?? null) && student.seat === seat)) return;
    const error = placementDestinationError(student, classroom, students);
    if (error) { toast.error(t(enrollmentErrorKey(error))); return; }
    startMoving(async () => {
      const result = await moveEnrollmentSeatAction({ enrollmentId: student.enrollmentId, membershipId: student.membershipId, fromClassroomId: student.classroomId, toClassroomId: classroom?.id ?? null, seat, expectedSeat: student.seat });
      if (!result.ok) { toast.error(t(enrollmentErrorKey(result.code))); router.refresh(); return; }
      setSavedBoard({ base: initialBoard, value: result.data }); setSelectedKey(null);
      toast.success(t("placementSaved", { name: student.name, placement: classroom?.name || t("pendingPlacement") }));
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); router.refresh();
    });
  };
  const accepts = (student: PlacementStudent | null, classroom: PlacementClassroom | null, grade: number, seat: number | null) => {
    if (!student || pending || student.grade !== grade || placementDestinationError(student, classroom, students)) return false;
    const occupied = classroom && students.some((member) => member.classroomId === classroom.id && member.seat === seat && member.status !== "withdrawn");
    return !occupied || student.classroomId === classroom?.id;
  };
  const dropProps = (classroom: PlacementClassroom | null, grade: number, seat: number | null) => ({
    onDragOver: (event: React.DragEvent) => { if (accepts(selected, classroom, grade, seat)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault(); event.stopPropagation();
      const student = students.find((item) => item.key === event.dataTransfer.getData(DRAG_TYPE));
      if (student?.termId === termId && accepts(student, classroom, grade, seat)) move(student, classroom, seat);
    },
  });
  const studentName = (student: PlacementStudent) => {
    const signals = board.health?.[student.studentId] ?? [];
    const health = placementHealth(signals);
    const movable = student.status !== "withdrawn";
    return <Tooltip key={student.key}><TooltipTrigger asChild><span
      draggable={movable && !pending}
      onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, student.key); event.dataTransfer.effectAllowed = "move"; setSelectedKey(student.key); }}
      className={cn("group relative flex min-h-8 w-full items-center justify-center px-1", selectedKey === student.key && "ring-2 ring-inset ring-crater", focusStudentId === student.studentId && "outline-2 outline-leaf-deep", query && !matches(student) && "opacity-30")}
    >
      <Student360Trigger subject={{ studentId: student.studentId, leadId: null }} fallback={{ name: student.name, phone: student.phone, grade: student.grade || null }} className={cn("flex min-w-0 max-w-full items-center text-xs font-normal", student.status === "withdrawn" && "text-muted")}>
        <span className="min-w-0 truncate">{student.name}</span>{student.status !== "active" ? <span className="ml-0.5 shrink-0 whitespace-nowrap text-[10px]">{t(`status_${student.status}`)}</span> : null}
      </Student360Trigger>
      {movable ? <Button size="sm" variant="ghost" className="absolute right-0 h-6 w-3 cursor-grab rounded-none p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={t("selectStudent", { name: student.name })} aria-pressed={selectedKey === student.key} disabled={pending} onClick={() => setSelectedKey((value) => value === student.key ? null : student.key)}><GripVertical className="size-3" /></Button> : null}
    </span></TooltipTrigger><TooltipContent className="max-w-80 space-y-1 text-xs leading-5"><p className="font-medium">{student.name}{student.status !== "active" ? ` · ${t(`status_${student.status}`)}` : ""}</p><p>{student.courseTitle}</p>{student.recommendation ? <p>{student.recommendation}</p> : null}{student.note ? <p>{student.note}</p> : null}<p>{t(`health_${health.tone}`)}</p>{signals.filter((signal) => signal.level === "observed" || signal.level === "attention").map((signal) => <p key={signal.key}>{healthT(signal.key)} · {healthT(signal.level)}{signal.total ? ` (${signal.count ?? 0}/${signal.total})` : ""}</p>)}<p>{t("studentInteraction")}</p></TooltipContent></Tooltip>;
  };
  const retiredRow = (retired: PlacementStudent[], label: string) => retired.length ? <TableRow className="hover:bg-transparent"><TableCell colSpan={3} className="sticky left-0 z-10 bg-card px-2 text-[11px] text-muted">{label}</TableCell><TableCell colSpan={columns} className="p-0"><div className="flex flex-wrap">{retired.map((student) => <div key={student.key} className="w-20 border-r border-line">{studentName(student)}</div>)}</div></TableCell></TableRow> : null;
  return <DashboardPage title={t("placementTitle")} density="compact" commandPanel={<DashboardCommandPanel>
    <DashboardCommandState><Select value={termId} onValueChange={(value) => { setTermId(value); setSelectedKey(null); setTeacherFilter(undefined); setTimeFilter(undefined); const params = new URLSearchParams(window.location.search); params.set("term", value); window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`); }}><SelectTrigger className="h-8 min-w-40" aria-label={t("term")}><SelectValue placeholder={t("chooseTerm")} /></SelectTrigger><SelectContent>{board.options.terms.map((term) => <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>)}</SelectContent></Select><span className="text-xs text-muted">{t("placementCounts", { pending: termStudents.filter((student) => !student.classroomId && student.status !== "withdrawn").length, assigned: termStudents.filter((student) => student.classroomId && student.status !== "withdrawn").length })}</span></DashboardCommandState>
    <DashboardCommandFilters><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlacement")} aria-label={t("searchPlacement")} className="h-8 max-w-64 text-xs" /><span className="text-[11px] text-muted">{selected ? t("selectedHint", { name: selected.name }) : t("seatHint")}</span><span className="flex items-center gap-3 text-[11px] text-muted">{(["low", "neutral", "high"] as const).map((tone) => <span key={tone} className="inline-flex items-center gap-1"><span className="size-2 border border-line" style={{ background: tone === "neutral" ? "var(--card)" : tone === "low" ? "#ef4444" : "#3b82f6" }} />{t(`legend_${tone}`)}</span>)}</span></DashboardCommandFilters>
    <DashboardCommandActions>{selected ? <Button size="sm" variant="ghost" onClick={() => setSelectedKey(null)} disabled={pending}>{t("clearSelection")}</Button> : null}{canCreateClass ? <Link href="/dashboard/classes/new" className={buttonVariants({ size: "sm", variant: "secondary" })}><Plus className="size-4" />{t("createClass")}</Link> : null}</DashboardCommandActions>
  </DashboardCommandPanel>}>
    <TooltipProvider delayDuration={300}><DashboardTableShell><Table className="w-max min-w-full table-fixed text-xs" containerClassName="max-h-[calc(100dvh-12rem)] overflow-auto" aria-busy={pending}>
      <TableHeader><TableRow>
        <TableHead className="sticky left-0 top-0 z-30 h-8 w-36 min-w-36 border-r border-line bg-card px-2"><DashboardTableColumnHeader label={t("classLabel")} filterValue={gradeFilter} filterOptions={grades.map((grade) => ({ value: String(grade), label: grade ? t("grade", { grade }) : t("gradePending") }))} onFilterChange={setGradeFilter} sortDirection={sort} onSortChange={setSort} onClear={() => { setGradeFilter(undefined); setSort(undefined); }} /></TableHead>
        <TableHead className="sticky left-36 top-0 z-30 h-8 w-32 min-w-32 border-r border-line bg-card px-2"><DashboardTableColumnHeader label={t("timeLabel")} filterValue={timeFilter} filterOptions={[...new Set(termClasses.map(schedule))].map((value) => ({ value, label: value }))} onFilterChange={setTimeFilter} onClear={() => setTimeFilter(undefined)} /></TableHead>
        <TableHead className="sticky left-68 top-0 z-30 h-8 w-16 min-w-16 border-r border-line bg-card px-2"><DashboardTableColumnHeader label={t("teacherLabel")} filterValue={teacherFilter} filterOptions={[...new Set(termClasses.map((classroom) => classroom.teacherNames || t("teacherPending")))].map((value) => ({ value, label: value }))} onFilterChange={setTeacherFilter} onClear={() => setTeacherFilter(undefined)} /></TableHead>
        {Array.from({ length: columns }, (_, index) => <TableHead key={index} className="sticky top-0 z-20 h-8 w-20 min-w-20 border-r border-line bg-card px-0 text-center font-normal">{index + 1}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{visibleGrades.map((grade) => {
        const unassigned = termStudents.filter((student) => student.grade === grade && !student.classroomId && student.status !== "withdrawn");
        const classes = termClasses.filter((classroom) => gradeOf(classroom) === grade && (!teacherFilter || (classroom.teacherNames || t("teacherPending")) === teacherFilter) && (!timeFilter || schedule(classroom) === timeFilter)).sort((a, b) => a.name.localeCompare(b.name, locale) * (sort === "desc" ? -1 : 1));
        return <Fragment key={grade}>
          <TableRow className="hover:bg-transparent"><TableCell colSpan={columns + 3} className="h-7 py-1 font-medium"><span className="sticky left-2">{grade ? t("grade", { grade }) : t("gradePending")}</span></TableCell></TableRow>
          <TableRow {...dropProps(null, grade, null)} className="hover:bg-transparent"><TableCell colSpan={3} className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1"><span>{t("pendingRow", { count: unassigned.length })}</span>{selected?.grade === grade && selected.classroomId ? <Button size="sm" variant="ghost" className="ml-2 h-6 p-0 text-[11px]" disabled={pending} onClick={() => move(selected, null, null)}>{t("returnPending")}</Button> : null}</TableCell><TableCell colSpan={columns} className="p-0"><div className="flex min-h-8 max-w-[90vw] flex-wrap">{unassigned.map((student) => <div key={student.key} className="w-20 border-r border-line" style={{ background: placementHealth(board.health?.[student.studentId]).background }}>{studentName(student)}</div>)}{!unassigned.length ? <span className="px-2 py-2 text-[11px] text-muted">{t("noPending")}</span> : null}</div></TableCell></TableRow>
          {classes.map((classroom) => {
            const members = termStudents.filter((student) => student.classroomId === classroom.id && student.status !== "withdrawn");
            const retired = termStudents.filter((student) => student.classroomId === classroom.id && student.status === "withdrawn");
            return <Fragment key={classroom.id}><TableRow className="hover:bg-transparent">
              <TableCell className="sticky left-0 z-10 w-36 border-r border-line bg-card px-2 py-1"><div className="flex items-center justify-between gap-1"><Link href={`/dashboard/classes/${classroom.id}`} className="max-w-28 truncate font-medium hover:underline" title={classroom.name}>{classroom.name}</Link><span className="text-[10px] text-muted">{classroom.activeCount}/{classroom.capacity ?? "∞"}</span></div></TableCell>
              <TableCell className="sticky left-36 z-10 w-32 border-r border-line bg-card px-2 py-1 text-[11px]" title={schedule(classroom)}><span className="block max-w-28 truncate">{schedule(classroom)}</span></TableCell>
              <TableCell className="sticky left-68 z-10 w-16 border-r border-line bg-card px-2 py-1" title={classroom.teacherNames}><span className="block max-w-14 truncate">{classroom.teacherNames || "—"}</span></TableCell>
              {Array.from({ length: columns }, (_, index) => {
                const seat = index + 1;
                const member = members.find((student) => student.seat === seat);
                const exists = member || classroom.capacity === null || seat <= classroom.capacity;
                const eligible = exists && accepts(selected, classroom, grade, seat);
                return <TableCell key={seat} {...(exists ? dropProps(classroom, grade, seat) : {})} className={cn("h-8 border-r border-line p-0 text-center", eligible && "ring-1 ring-inset ring-crater/40")} style={member ? { background: placementHealth(board.health?.[member.studentId]).background } : undefined}>{member ? studentName(member) : exists ? <Button size="sm" variant="ghost" className="h-8 w-full rounded-none p-0 text-line" aria-label={selected ? t("placeInSeat", { name: selected.name, classroom: classroom.name, seat }) : t("emptySeatNumber", { seat })} disabled={!eligible || pending} onClick={() => { if (selected) move(selected, classroom, seat); }}>{eligible ? <Plus className="size-3" /> : <span aria-hidden>·</span>}</Button> : <span className="text-line" aria-label={t("noSeat")}>—</span>}</TableCell>;
              })}
            </TableRow>{retiredRow(retired, `${classroom.name} · ${t("status_withdrawn")}`)}</Fragment>;
          })}
          {retiredRow(termStudents.filter((student) => student.grade === grade && !student.classroomId && student.status === "withdrawn"), t("status_withdrawn"))}
          {retiredRow(termStudents.filter((student) => student.grade === grade && student.classroomId && !termClasses.some((classroom) => classroom.id === student.classroomId)), t("unavailableClass"))}
        </Fragment>;
      })}{!visibleGrades.length ? <TableRow><TableCell colSpan={columns + 3} className="h-40 text-center text-muted">{t("emptyPlacement")}</TableCell></TableRow> : null}</TableBody>
    </Table></DashboardTableShell></TooltipProvider>
  </DashboardPage>;
}
