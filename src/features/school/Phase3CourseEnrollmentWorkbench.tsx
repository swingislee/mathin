"use client";

import { FilterSearchInput } from "./FilterBar";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandSelection,
  DashboardCommandState,
  DashboardEmptyCard,
  DashboardPage,
  DashboardTableShell,
} from "./dashboard-page";
import {
  assignCourseEnrollmentAction,
  assignCourseEnrollmentsAction,
  cancelCourseEnrollmentAction,
  transferCourseEnrollmentAction,
} from "./phase3-enrollment-actions";
import type {
  CourseEnrollmentRow,
  Phase3ClassroomOption,
  Phase3EnrollmentOptions,
} from "./phase3-enrollment-contract";

type View = "pending" | "assigned" | "cancelled" | "all";

function hasCapacity(classroom: Phase3ClassroomOption, seats = 1) {
  return seats === 0 || classroom.capacity === null || classroom.activeCount + seats <= classroom.capacity;
}

function compatibleClassrooms(
  row: CourseEnrollmentRow,
  options: Phase3EnrollmentOptions,
): Phase3ClassroomOption[] {
  return options.classrooms.filter((classroom) =>
    classroom.courseId === row.courseId
    && classroom.termId === row.termId
    && classroom.id !== row.classroomId
    && (row.claimableClassroomIds.includes(classroom.id) || hasCapacity(classroom)));
}

function AssignmentDialog({
  row,
  options,
  onSaved,
}: {
  row: CourseEnrollmentRow;
  options: Phase3EnrollmentOptions;
  onSaved: () => void;
}) {
  const t = useTranslations("school.courseEnrollments");
  const isTransfer = row.assignmentId !== null;
  const classrooms = compatibleClassrooms(row, options);
  const [open, setOpen] = useState(false);
  const [classroomId, setClassroomId] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const onOpenChange = (next: boolean) => {
    if (next) {
      setClassroomId(classrooms[0]?.id ?? "");
      setNote("");
    }
    setOpen(next);
  };

  const submit = () => startTransition(async () => {
    const effectiveAt = new Date().toISOString();
    const result = isTransfer
      ? await transferCourseEnrollmentAction(row.id, classroomId, note, effectiveAt)
      : await assignCourseEnrollmentAction(row.id, classroomId, note, effectiveAt);
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    toast.success(t(isTransfer ? "transferred" : "assigned"));
    setOpen(false);
    onSaved();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={isTransfer ? "secondary" : "primary"}>
          {t(isTransfer ? "transfer" : "assign")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(isTransfer ? "transferTitle" : "assignTitle")}</DialogTitle>
          <DialogDescription>{t("assignmentDescription", {
            student: row.studentName,
            course: row.courseTitle,
            term: row.termName,
          })}</DialogDescription>
        </DialogHeader>
        {classrooms.length === 0 ? (
          <p className="rounded-xl border border-line bg-moon/30 p-4 text-sm text-muted">{t("noCompatibleClassrooms")}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("targetClassroom")}</Label>
              <Select value={classroomId} onValueChange={setClassroomId}>
                <SelectTrigger><SelectValue placeholder={t("chooseClassroom")} /></SelectTrigger>
                <SelectContent>{classrooms.map((classroom) => (
                  <SelectItem key={classroom.id} value={classroom.id}>
                    {classroom.name} · {row.claimableClassroomIds.includes(classroom.id)
                      ? t("claimExistingMembership")
                      : t("capacityValue", {
                          count: classroom.activeCount,
                          capacity: classroom.capacity ?? t("unlimited"),
                        })}
                  </SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`assignment-note-${row.id}`}>{t("note")}</Label>
              <Textarea
                id={`assignment-note-${row.id}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={2_000}
                rows={4}
                placeholder={t("assignmentNotePlaceholder")}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{t("close")}</Button>
          {classrooms.length > 0 ? <Button type="button" disabled={pending || !classroomId} onClick={submit}>
            {pending ? t("saving") : t(isTransfer ? "confirmTransfer" : "confirmAssign")}
          </Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelEnrollmentDialog({ row, onSaved }: { row: CourseEnrollmentRow; onSaved: () => void }) {
  const t = useTranslations("school.courseEnrollments");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const submit = () => startTransition(async () => {
    const result = await cancelCourseEnrollmentAction(row.id, note, new Date().toISOString());
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    toast.success(t("cancelled"));
    setOpen(false);
    onSaved();
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setNote(""); }}>
      <DialogTrigger asChild><Button type="button" size="sm" variant="ghost">{t("cancelEnrollment")}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cancelTitle")}</DialogTitle>
          <DialogDescription>{t("cancelDescription", { student: row.studentName, course: row.courseTitle })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`cancel-note-${row.id}`}>{t("cancelReason")}</Label>
          <Textarea id={`cancel-note-${row.id}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2_000} rows={4} />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{t("close")}</Button>
          <Button type="button" variant="secondary" disabled={pending || !note.trim()} onClick={submit}>{pending ? t("saving") : t("confirmCancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Phase3CourseEnrollmentWorkbench({
  initialEnrollments,
  options,
  canCreateClass,
}: {
  initialEnrollments: CourseEnrollmentRow[];
  options: Phase3EnrollmentOptions;
  canCreateClass: boolean;
}) {
  const t = useTranslations("school.courseEnrollments");
  const locale = useLocale();
  const router = useRouter();
  const [view, setView] = useState<View>("pending");
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [termFilter, setTermFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchClassroomId, setBatchClassroomId] = useState("");
  const [batchPending, startBatchTransition] = useTransition();
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const pendingRows = initialEnrollments.filter((row) => row.status === "active" && row.assignmentId === null);
  const assignedRows = initialEnrollments.filter((row) => row.status === "active" && row.assignmentId !== null);
  const cancelledRows = initialEnrollments.filter((row) => row.status === "cancelled");
  const baseRows = view === "pending" ? pendingRows : view === "assigned" ? assignedRows : view === "cancelled" ? cancelledRows : initialEnrollments;
  const courseById = new Map(options.courses.map((course) => [course.id, course]));
  const grades = [...new Set(options.courses.map((course) => course.grade))].sort((left, right) => left - right);
  const needle = query.trim().toLocaleLowerCase(locale);
  const rows = baseRows.filter((row) => (
    (courseFilter === "all" || row.courseId === courseFilter)
    && (termFilter === "all" || row.termId === termFilter)
    && (gradeFilter === "all" || courseById.get(row.courseId)?.grade === Number(gradeFilter))
    && (!needle || [
      row.studentName,
      row.studentPhone,
      row.courseTitle,
      row.termName,
      row.classroomName,
    ].some((value) => value?.toLocaleLowerCase(locale).includes(needle)))
  ));
  const selectableRows = rows.filter((row) => row.status === "active" && row.assignmentId === null);
  const selectedRows = pendingRows.filter((row) => selected.has(row.id));
  const batchClassrooms = selectedRows.length === 0 ? [] : options.classrooms.filter((classroom) =>
    classroom.courseId === selectedRows[0].courseId
    && classroom.termId === selectedRows[0].termId
    && selectedRows.every((row) => row.courseId === classroom.courseId && row.termId === classroom.termId)
    && hasCapacity(
      classroom,
      selectedRows.filter((row) => !row.claimableClassroomIds.includes(classroom.id)).length,
    ));
  const selectedBatchClassroomId = batchClassrooms.some((classroom) => classroom.id === batchClassroomId)
    ? batchClassroomId
    : "";
  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.id));
  const someVisibleSelected = selectableRows.some((row) => selected.has(row.id));
  const refresh = () => router.refresh();
  const clearSelection = () => {
    setSelected(new Set());
    setBatchClassroomId("");
  };

  const batchAssign = () => startBatchTransition(async () => {
    const result = await assignCourseEnrollmentsAction(
      selectedRows.map((row) => row.id),
      selectedBatchClassroomId,
      t("batchAuditNote", { count: selectedRows.length }),
      new Date().toISOString(),
    );
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    toast.success(t("batchAssigned", { count: result.data.count }));
    clearSelection();
    refresh();
  });

  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      commandPanel={
        <DashboardCommandPanel selection={selectedRows.length > 0 ? (
          <DashboardCommandSelection>
            <span className="font-medium text-ink">{t("selectedCount", { count: selectedRows.length })}</span>
            <Select value={selectedBatchClassroomId} onValueChange={setBatchClassroomId}>
              <SelectTrigger className="w-full sm:w-64" aria-label={t("batchTargetLabel")}>
                <SelectValue placeholder={batchClassrooms.length ? t("chooseClassroom") : t("noSharedClassroom")} />
              </SelectTrigger>
              <SelectContent>{batchClassrooms.map((classroom) => (
                <SelectItem key={classroom.id} value={classroom.id}>{classroom.name}</SelectItem>
              ))}</SelectContent>
            </Select>
            <Button type="button" size="sm" disabled={batchPending || !selectedBatchClassroomId} onClick={batchAssign}>
              {batchPending ? t("saving") : t("batchAssign")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={batchPending} onClick={clearSelection}>{t("clearSelection")}</Button>
          </DashboardCommandSelection>
        ) : undefined}>
          <DashboardCommandState>
            {(["pending", "assigned", "cancelled", "all"] as const).map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={view === item ? "primary" : "secondary"}
                onClick={() => { setView(item); clearSelection(); }}
              >
                {t(`view_${item}`, {
                  count: item === "pending" ? pendingRows.length : item === "assigned" ? assignedRows.length : item === "cancelled" ? cancelledRows.length : initialEnrollments.length,
                })}
              </Button>
            ))}
          </DashboardCommandState>
          <DashboardCommandFilters>
            <FilterSearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              className="w-full sm:max-w-sm"
            />
            <Select value={courseFilter} onValueChange={(value) => { setCourseFilter(value); clearSelection(); }}>
              <SelectTrigger className="w-full sm:w-48" aria-label={t("courseFilter")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("allCourses")}</SelectItem>{options.courses.map((course) => (
                <SelectItem key={course.id} value={course.id}>{course.title}</SelectItem>
              ))}</SelectContent>
            </Select>
            <Select value={termFilter} onValueChange={(value) => { setTermFilter(value); clearSelection(); }}>
              <SelectTrigger className="w-full sm:w-40" aria-label={t("termFilter")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("allTerms")}</SelectItem>{options.terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>
              ))}</SelectContent>
            </Select>
            <Select value={gradeFilter} onValueChange={(value) => { setGradeFilter(value); clearSelection(); }}>
              <SelectTrigger className="w-full sm:w-36" aria-label={t("gradeFilter")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("allGrades")}</SelectItem>{grades.map((grade) => (
                <SelectItem key={grade} value={String(grade)}>{t("gradeValue", { grade })}</SelectItem>
              ))}</SelectContent>
            </Select>
          </DashboardCommandFilters>
          <DashboardCommandActions>
            <Link href="/dashboard/opportunities" className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}>{t("openOpportunities")}</Link>
            {canCreateClass ? <Link href="/dashboard/classes/new" className={cn(buttonVariants({ size: "sm", variant: "primary" }))}>{t("createClass")}</Link> : null}
          </DashboardCommandActions>
        </DashboardCommandPanel>
      }
    >
      {rows.length === 0 ? <DashboardEmptyCard>{t("empty")}</DashboardEmptyCard> : (
        <DashboardTableShell>
          <Table className="min-w-[66rem]">
            <TableHeader><TableRow>
              <TableHead className="w-12">
                {selectableRows.length > 0 ? <Checkbox
                  aria-label={t("selectAll")}
                  checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                  onCheckedChange={(checked) => setSelected((current) => {
                    const next = new Set(current);
                    selectableRows.forEach((row) => checked === true ? next.add(row.id) : next.delete(row.id));
                    return next;
                  })}
                /> : null}
              </TableHead>
              <TableHead>{t("student")}</TableHead>
              <TableHead>{t("courseAndTerm")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("classroom")}</TableHead>
              <TableHead>{t("confirmed")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>{rows.map((row) => {
              const selectable = row.status === "active" && row.assignmentId === null;
              return <TableRow key={row.id}>
                <TableCell>{selectable ? <Checkbox
                  aria-label={t("selectStudent", { name: row.studentName })}
                  checked={selected.has(row.id)}
                  onCheckedChange={(checked) => setSelected((current) => {
                    const next = new Set(current);
                    if (checked === true) next.add(row.id); else next.delete(row.id);
                    return next;
                  })}
                /> : null}</TableCell>
                <TableCell className="min-w-48"><p className="font-medium text-ink">{row.studentName}</p><p className="text-xs text-muted">{row.studentPhone || "—"}</p></TableCell>
                <TableCell className="min-w-56"><p>{row.courseTitle}</p><p className="text-xs text-muted">{row.termName}</p></TableCell>
                <TableCell className="max-w-64"><Badge variant={row.status === "cancelled" ? "outline" : row.assignmentId ? "default" : "secondary"}>
                  {t(row.status === "cancelled" ? "status_cancelled" : row.assignmentId ? "status_assigned" : "status_pending")}
                </Badge>{row.note ? <p className="mt-1 line-clamp-2 text-xs text-muted">{row.note}</p> : null}</TableCell>
                <TableCell>{row.classroomId && row.classroomName ? <Link href={`/dashboard/classes/${row.classroomId}`} className="font-medium text-ink underline-offset-4 hover:underline">{row.classroomName}</Link> : "—"}</TableCell>
                <TableCell className="min-w-44">
                  <p>{dateTime.format(new Date(row.confirmedAt))}</p>
                  <p className="text-xs text-muted">{row.confirmedByName}</p>
                  {row.cancelledAt ? <p className="mt-1 text-xs text-muted">{t("cancelledAt", {
                    time: dateTime.format(new Date(row.cancelledAt)),
                    name: row.cancelledByName ?? "—",
                  })}</p> : null}
                </TableCell>
                <TableCell><div className="flex min-w-max justify-end gap-2">
                  {row.status === "active" ? <AssignmentDialog row={row} options={options} onSaved={refresh} /> : null}
                  {selectable ? <CancelEnrollmentDialog row={row} onSaved={refresh} /> : null}
                </div></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </DashboardTableShell>
      )}
    </DashboardPage>
  );
}
