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
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { cn } from "@/lib/utils";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState, DashboardPage, DashboardTableColumnHeader, DashboardTableShell } from "./dashboard-page";
import { classScheduleLabel, enrollmentErrorKey, placementDestinationError, placementStudents, type EnrollmentPlacementBoard, type PlacementClassroom, type PlacementStudent } from "./enrollment-workflow-contract";
import { moveEnrollmentPlacementAction } from "./enrollment-workflow-actions";
import { Student360Trigger } from "./Student360Sheet";

const DRAG_TYPE = "application/x-mathin-enrollment";
export function EnrollmentPlacementWorkbench({ initialBoard, initialTermId, focusStudentId, canCreateClass }: {
  initialBoard: EnrollmentPlacementBoard; initialTermId?: string; focusStudentId?: string; canCreateClass: boolean;
}) {
  const t = useTranslations("school.enrollmentWorkflow");
  const locale = useLocale();
  const router = useRouter();
  const [savedBoard, setSavedBoard] = useState<{ base: EnrollmentPlacementBoard; value: EnrollmentPlacementBoard } | null>(null);
  const board = savedBoard?.base === initialBoard ? savedBoard.value : initialBoard;
  const [termId, setTermId] = useState(() => board.options.terms.find((term) => term.id === initialTermId)?.id ?? board.options.terms.find((term) => term.isCurrent)?.id ?? board.options.terms[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState<string | undefined>();
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
  const columns = Math.max(1, ...termClasses.map((classroom) => Math.max(classroom.activeCount, classroom.capacity ?? classroom.activeCount + 1)));
  const matches = (student: PlacementStudent) => !query || [student.name, student.phone, student.courseTitle].join(" ").toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale));
  const move = (student: PlacementStudent, classroom: PlacementClassroom | null) => {
    if (pending || student.classroomId === (classroom?.id ?? null)) return;
    const error = placementDestinationError(student, classroom, students);
    if (error) { toast.error(t(enrollmentErrorKey(error))); return; }
    startMoving(async () => {
      const result = await moveEnrollmentPlacementAction({ enrollmentId: student.enrollmentId, membershipId: student.membershipId, fromClassroomId: student.classroomId, toClassroomId: classroom?.id ?? null });
      if (!result.ok) { toast.error(t(enrollmentErrorKey(result.code))); window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); router.refresh(); return; }
      setSavedBoard({ base: initialBoard, value: result.data }); setSelectedKey(null);
      toast.success(t("placementSaved", { name: student.name, placement: classroom?.name || t("pendingPlacement") })); window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); router.refresh();
    });
  };
  const dropProps = (classroom: PlacementClassroom | null, grade: number) => ({
    onDragOver: (event: React.DragEvent) => {
      if (selected && !pending && selected.grade === grade && !placementDestinationError(selected, classroom, students)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const student = students.find((item) => item.key === event.dataTransfer.getData(DRAG_TYPE));
      if (student && student.grade === grade && student.termId === termId) move(student, classroom);
    },
  });
  const studentChip = (student: PlacementStudent, movable = true) => <Tooltip key={student.key}>
    <TooltipTrigger asChild><span
      draggable={movable && !pending}
      onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, student.key); event.dataTransfer.effectAllowed = "move"; setSelectedKey(student.key); }}
      className={cn("inline-flex max-w-full items-center gap-0.5 rounded-md px-1 py-1", selectedKey === student.key && "bg-moon/40 ring-1 ring-crater", focusStudentId === student.studentId && "bg-leaf/25", query && !matches(student) && "opacity-35")}
    >
      {movable ? <Button size="sm" variant="ghost" className="h-7 w-5 shrink-0 cursor-grab p-0 active:cursor-grabbing" aria-label={t("selectStudent", { name: student.name })} aria-pressed={selectedKey === student.key} disabled={pending} onClick={() => setSelectedKey((value) => value === student.key ? null : student.key)}><GripVertical className="size-3.5" /></Button> : null}
      <Student360Trigger subject={{ studentId: student.studentId, leadId: null }} fallback={{ name: student.name, phone: student.phone, grade: student.grade || null }} className="max-w-28 truncate text-xs">{student.name}</Student360Trigger>
    </span></TooltipTrigger>
    <TooltipContent className="max-w-72 space-y-1 leading-5"><p className="font-medium">{student.name} · {student.phone}</p><p>{student.courseTitle}</p>{student.recommendation ? <p>{student.recommendation}</p> : null}{student.note ? <p>{student.note}</p> : null}<p>{t("studentInteraction")}</p></TooltipContent>
  </Tooltip>;
  return <DashboardPage title={t("placementTitle")} description={t("placementIntro")} density="compact" commandPanel={<DashboardCommandPanel>
    <DashboardCommandState><Select value={termId} onValueChange={(value) => { setTermId(value); setSelectedKey(null); const queryParams = new URLSearchParams(window.location.search); queryParams.set("term", value); window.history.replaceState(window.history.state, "", `${window.location.pathname}?${queryParams}`); }}><SelectTrigger className="h-9 min-w-44" aria-label={t("term")}><SelectValue placeholder={t("chooseTerm")} /></SelectTrigger><SelectContent>{board.options.terms.map((term) => <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>)}</SelectContent></Select><span className="text-xs text-muted">{t("placementCounts", { pending: termStudents.filter((student) => !student.classroomId).length, assigned: termStudents.filter((student) => student.classroomId).length })}</span></DashboardCommandState>
    <DashboardCommandFilters><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlacement")} aria-label={t("searchPlacement")} className="h-9 max-w-sm" />{selected ? <span className="text-xs text-ink" aria-live="polite">{t("selectedHint", { name: selected.name })}</span> : <span className="text-xs text-muted">{t("dragHint")}</span>}</DashboardCommandFilters>
    <DashboardCommandActions>{selected ? <Button size="sm" variant="ghost" onClick={() => setSelectedKey(null)} disabled={pending}>{t("clearSelection")}</Button> : null}{canCreateClass ? <Link href="/dashboard/classes/new" className={buttonVariants({ size: "sm", variant: "secondary" })}><Plus className="size-4" />{t("createClass")}</Link> : null}</DashboardCommandActions>
  </DashboardCommandPanel>}>
    <TooltipProvider delayDuration={300}><DashboardTableShell>
      <Table className="w-max min-w-full table-fixed text-xs" containerClassName="max-h-[calc(100dvh-13rem)] overflow-auto" aria-busy={pending}>
        <TableHeader><TableRow>
          <TableHead className="sticky left-0 top-0 z-30 w-72 min-w-72 border-r border-line bg-card"><DashboardTableColumnHeader label={t("classCapacity")} filterValue={gradeFilter} filterOptions={grades.map((grade) => ({ value: String(grade), label: grade ? t("grade", { grade }) : t("gradePending") }))} onFilterChange={setGradeFilter} sortDirection={sort} onSortChange={setSort} onClear={() => { setGradeFilter(undefined); setSort(undefined); }} /></TableHead>
          {Array.from({ length: columns }, (_, index) => <TableHead key={index} className="sticky top-0 z-20 w-32 min-w-32 bg-card text-center">{t("capacitySlot", { count: index + 1 })}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>{visibleGrades.map((grade) => {
          const unassigned = termStudents.filter((student) => student.grade === grade && !student.classroomId);
          const classes = termClasses.filter((classroom) => gradeOf(classroom) === grade).sort((a, b) => a.name.localeCompare(b.name, locale) * (sort === "desc" ? -1 : 1));
          const unavailable = termStudents.filter((student) => student.grade === grade && student.classroomId && !termClasses.some((classroom) => classroom.id === student.classroomId));
          return <Fragment key={grade}>
            <TableRow className="hover:bg-transparent"><TableCell colSpan={columns + 1} className="py-2 font-medium text-ink"><span className="sticky left-3">{grade ? t("grade", { grade }) : t("gradePending")}</span></TableCell></TableRow>
            <TableRow {...dropProps(null, grade)} className={cn(selected?.grade === grade && selected.classroomId && "bg-moon/10")}>
              <TableCell className="sticky left-0 z-10 border-r border-line bg-card"><p className="font-medium">{t("pendingRow", { count: unassigned.length })}</p>{selected?.grade === grade && selected.classroomId ? <Button size="sm" variant="ghost" className="mt-1" disabled={pending} onClick={() => move(selected, null)}>{t("returnPending")}</Button> : null}</TableCell>
              <TableCell colSpan={columns}><div className="flex min-h-10 max-w-[80vw] flex-wrap items-center gap-2">{unassigned.map((student) => studentChip(student))}{!unassigned.length ? <span className="text-muted">{t("noPending")}</span> : null}</div></TableCell>
            </TableRow>
            {classes.map((classroom) => {
              const members = termStudents.filter((student) => student.classroomId === classroom.id);
              const capacity = Math.max(classroom.capacity ?? members.length + 1, members.length);
              const eligible = selected && !placementDestinationError(selected, classroom, students);
              return <TableRow key={classroom.id} {...dropProps(classroom, grade)} className={cn(eligible && selected.classroomId !== classroom.id && "bg-moon/10")}>
                <TableCell className="sticky left-0 z-10 border-r border-line bg-card py-3"><div className="flex items-center justify-between gap-2"><Link href={`/dashboard/classes/${classroom.id}`} className="font-medium hover:underline">{classroom.name}</Link><span className={cn("tabular-nums", classroom.capacity !== null && classroom.activeCount >= classroom.capacity && "text-rose")}>{classroom.activeCount}/{classroom.capacity ?? "∞"}</span></div><p className="mt-1 max-w-64 truncate text-[11px] text-muted">{classroom.teacherNames || t("teacherPending")}</p><p className="mt-1 max-w-64 truncate text-[11px] text-muted" title={board.options.courses.find((course) => course.id === classroom.courseId)?.title}>{board.options.courses.find((course) => course.id === classroom.courseId)?.title}</p><p className="mt-1 max-w-64 text-[11px] leading-5 text-muted">{classScheduleLabel(classroom, locale) || t("schedulePending")}</p></TableCell>
                {Array.from({ length: columns }, (_, index) => <TableCell key={index} className="px-1 text-center">{members[index] ? studentChip(members[index]) : index < capacity ? <Button size="sm" variant="ghost" className="h-9 w-full text-muted" aria-label={selected ? t("placeIn", { name: selected.name, classroom: classroom.name }) : t("emptySeat")} disabled={!eligible || pending || selected?.classroomId === classroom.id} onClick={() => { if (selected) move(selected, classroom); }}>{selected && eligible ? <Plus className="size-3.5" /> : t("emptySeat")}</Button> : <span aria-label={t("noSeat")} className="text-line">—</span>}</TableCell>)}
              </TableRow>;
            })}
            {unavailable.length ? <TableRow><TableCell className="sticky left-0 z-10 border-r border-line bg-card text-muted">{t("unavailableClass")}</TableCell><TableCell colSpan={columns}>{unavailable.map((student) => studentChip(student, false))}</TableCell></TableRow> : null}
          </Fragment>;
        })}{!visibleGrades.length ? <TableRow><TableCell colSpan={columns + 1} className="h-40 text-center text-muted">{t("emptyPlacement")}</TableCell></TableRow> : null}</TableBody>
      </Table>
    </DashboardTableShell></TooltipProvider>
  </DashboardPage>;
}
