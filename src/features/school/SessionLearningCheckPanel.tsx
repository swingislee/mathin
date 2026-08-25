"use client";

import { Armchair, CheckSquare2, ClipboardCheck, GripVertical, Lightbulb, LoaderCircle, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { amendAttendanceStatusAction } from "./actions/attendance";
import type { AttendanceDrawerRow } from "./actions/types";
import { ATTENDANCE_STATUS_LIGHT, ATTENDANCE_STATUS_TONE } from "./attendance-visual";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./learning";
import { markSessionLearningChecksAction, saveClassroomStudentSeatLayoutAction } from "./session-learning-actions";
import {
  buildLearningSeatSlots,
  LEARNING_CHECK_STATUSES,
  LEARNING_SEAT_COLUMNS,
  learningCheckIdAfterPageChange,
  learningCheckIdForPage,
  learningResultKey,
  learningSeatAssignments,
  moveLearningStudentToSeat,
  type LearningCheckStatus,
  type LearningSeatSlot,
  type SessionLearningSetup,
  type SessionLearningStudent,
} from "./session-learning-contract";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";

const EMPTY_STUDENT_IDS = new Set<string>();

function AttendanceStatusLight({
  studentName,
  row,
  saving,
  onChange,
}: {
  studentName: string;
  row: AttendanceDrawerRow | undefined;
  saving: boolean;
  onChange: (status: AttendanceStatus) => void;
}) {
  const t = useTranslations("school.session");
  const attendanceT = useTranslations("school.classes");
  const [open, setOpen] = useState(false);
  const status = row?.marked ? row.status : null;
  const statusLabel = status ? attendanceT(status) : t("learningAttendanceUnmarked");
  const label = t("learningAttendanceLabel", { name: studentName, status: statusLabel });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={saving}
          aria-label={label}
          title={label}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-moon/30 hover:text-ink disabled:opacity-55"
          data-learning-attendance={status ?? "unmarked"}
        >
          {saving
            ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />
            : (
                <Lightbulb
                  aria-hidden
                  size={16}
                  className={status ? ATTENDANCE_STATUS_LIGHT[status] : "fill-transparent text-line"}
                />
              )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="z-[90] w-64 p-2">
        <p className="truncate px-1 pb-2 text-xs font-medium text-ink">{label}</p>
        <div className="grid grid-cols-4 gap-1">
          {ATTENDANCE_STATUSES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={status === candidate}
              onClick={() => {
                onChange(candidate);
                setOpen(false);
              }}
              className={cn(
                "min-h-10 rounded-lg border px-1 text-[11px] font-medium transition-transform active:scale-95",
                ATTENDANCE_STATUS_TONE[candidate],
                status === candidate && "ring-2 ring-ink/45 ring-offset-1 ring-offset-card",
              )}
            >
              {attendanceT(candidate)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface LearningCheckSummarySnapshot {
  checkId: string;
  results: ReadonlyMap<string, LearningCheckStatus>;
}

export function SessionLearningCheckPanel({
  sessionId,
  setup,
  activePageDocId,
  attendanceRows = [],
  attendanceIntegrated = false,
  ephemeral = false,
  triggerVariant = "default",
  onSummaryChange,
  onSeatOrderChange,
}: {
  sessionId: string;
  setup: SessionLearningSetup;
  activePageDocId: string | null;
  attendanceRows?: readonly AttendanceDrawerRow[];
  attendanceIntegrated?: boolean;
  ephemeral?: boolean;
  triggerVariant?: "default" | "rail";
  onSummaryChange?: (snapshot: LearningCheckSummarySnapshot) => void;
  onSeatOrderChange?: (assignments: Array<{ studentId: string; position: number }>) => void;
}) {
  const t = useTranslations("school.session");
  const [manualSelection, setManualSelection] = useState<{
    pageDocId: string | null;
    checkId: string | null;
  }>(() => ({
    pageDocId: activePageDocId,
    checkId: learningCheckIdAfterPageChange(setup.checks, null, activePageDocId),
  }));
  const [results, setResults] = useState(() => new Map(
    setup.results.map((result) => [learningResultKey(result.checkId, result.studentId), result.status as LearningCheckStatus]),
  ));
  const [seatSlots, setSeatSlots] = useState(() => buildLearningSeatSlots(setup.students));
  const [attendanceByStudent, setAttendanceByStudent] = useState(() => new Map(
    attendanceRows.map((row) => [row.studentId, row]),
  ));
  const [attendanceSavingStudentIds, setAttendanceSavingStudentIds] = useState<Set<string>>(() => new Set());
  const [seatEditMode, setSeatEditMode] = useState(false);
  const seatSlotsRef = useRef(buildLearningSeatSlots(setup.students));
  const savedSeatSlotsRef = useRef(buildLearningSeatSlots(setup.students));
  const dragStartSeatSlotsRef = useRef(buildLearningSeatSlots(setup.students));
  const seatGridRef = useRef<HTMLDivElement>(null);
  const draggingStudentIdRef = useRef<string | null>(null);
  const dragOverSeatPositionRef = useRef<number | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const seatOrderSavingRef = useRef(false);
  const [draggingStudentId, setDraggingStudentId] = useState<string | null>(null);
  const [dragOverSeatPosition, setDragOverSeatPosition] = useState<number | null>(null);
  const [dragOriginSeatPosition, setDragOriginSeatPosition] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [seatOrderSaving, setSeatOrderSaving] = useState(false);
  const [studentSelection, setStudentSelection] = useState<{
    checkId: string;
    ids: Set<string>;
  }>(() => ({ checkId: "", ids: new Set<string>() }));
  const [batchMode, setBatchMode] = useState(false);
  const [savingStudentIds, setSavingStudentIds] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const orderedStudents = useMemo(
    () => seatSlots.filter((student): student is SessionLearningStudent => student !== null),
    [seatSlots],
  );
  const stableSeatStudents = useMemo(
    () => [...orderedStudents].sort((left, right) => left.id.localeCompare(right.id)),
    [orderedStudents],
  );
  const seatPositionByStudentId = useMemo(() => new Map(
    seatSlots.flatMap((student, position) => student ? [[student.id, position] as const] : []),
  ), [seatSlots]);
  const automaticCheckId = learningCheckIdForPage(setup.checks, activePageDocId);
  if (manualSelection.pageDocId !== activePageDocId) {
    // React discards this render and retries with the new shared page. A marked
    // page follows its check; an unmarked/media/board page keeps the current one.
    setManualSelection({
      pageDocId: activePageDocId,
      checkId: learningCheckIdAfterPageChange(setup.checks, manualSelection.checkId, activePageDocId),
    });
    if (studentSelection.ids.size > 0) {
      setStudentSelection({ checkId: "", ids: new Set() });
    }
  }
  const activeCheckId = manualSelection.pageDocId === activePageDocId
    ? manualSelection.checkId ?? automaticCheckId ?? setup.checks[0]?.id ?? ""
    : learningCheckIdAfterPageChange(setup.checks, manualSelection.checkId, activePageDocId) ?? "";
  const activeCheck = setup.checks.find((check) => check.id === activeCheckId) ?? setup.checks[0];
  const activeCheckSummaryId = activeCheck?.id ?? "";
  const selectedStudentIds = activeCheck && studentSelection.checkId === activeCheck.id
    ? studentSelection.ids
    : EMPTY_STUDENT_IDS;
  const checkedCount = useMemo(() => {
    if (!activeCheck) return 0;
    return orderedStudents.filter((student) =>
      (results.get(learningResultKey(activeCheck.id, student.id)) ?? "unchecked") !== "unchecked").length;
  }, [activeCheck, orderedStudents, results]);

  useEffect(() => {
    if (!activeCheckSummaryId) return;
    onSummaryChange?.({ checkId: activeCheckSummaryId, results: new Map(results) });
  }, [activeCheckSummaryId, onSummaryChange, results]);

  if (setup.checks.length === 0) return null;

  const mark = (studentIds: string[], status: LearningCheckStatus) => {
    if (!activeCheck || studentIds.length === 0) return;
    const targetStudentIds = studentIds.filter((studentId) => !savingStudentIds.has(studentId));
    if (targetStudentIds.length === 0) return;
    const previous = new Map(targetStudentIds.map((studentId) => {
      const key = learningResultKey(activeCheck.id, studentId);
      return [key, results.get(key) ?? "unchecked"] as const;
    }));
    setSavingStudentIds((current) => new Set([...current, ...targetStudentIds]));
    setResults((current) => {
      const next = new Map(current);
      for (const studentId of targetStudentIds) {
        const key = learningResultKey(activeCheck.id, studentId);
        if (status === "unchecked") next.delete(key);
        else next.set(key, status);
      }
      return next;
    });
    if (ephemeral) {
      setStudentSelection({ checkId: activeCheck.id, ids: new Set() });
      setSavingStudentIds((current) => {
        const next = new Set(current);
        for (const studentId of targetStudentIds) next.delete(studentId);
        return next;
      });
      return;
    }
    startTransition(async () => {
      const result = await markSessionLearningChecksAction({
        sessionId,
        checkId: activeCheck.id,
        studentIds: targetStudentIds,
        status,
      });
      if (!result.ok) {
        setResults((current) => {
          const next = new Map(current);
          for (const [key, oldStatus] of previous) {
            if (oldStatus === "unchecked") next.delete(key);
            else next.set(key, oldStatus);
          }
          return next;
        });
        toast.error(t("learningSaveFailed", { code: result.code }));
      } else {
        setStudentSelection({ checkId: activeCheck.id, ids: new Set() });
      }
      setSavingStudentIds((current) => {
        const next = new Set(current);
        for (const studentId of targetStudentIds) next.delete(studentId);
        return next;
      });
    });
  };

  const toggleSelected = (studentId: string) => {
    if (!activeCheck) return;
    setStudentSelection((current) => {
      const next = new Set(current.checkId === activeCheck.id ? current.ids : EMPTY_STUDENT_IDS);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return { checkId: activeCheck.id, ids: next };
    });
  };

  const markAttendance = (student: SessionLearningStudent, status: AttendanceStatus) => {
    if (attendanceSavingStudentIds.has(student.id)) return;
    const previous = attendanceByStudent.get(student.id);
    const nextRow: AttendanceDrawerRow = {
      studentId: student.id,
      studentName: student.name,
      status,
      note: previous?.note ?? "",
      marked: true,
    };
    setAttendanceByStudent((current) => new Map(current).set(student.id, nextRow));
    if (ephemeral) return;

    setAttendanceSavingStudentIds((current) => new Set(current).add(student.id));
    void (async () => {
      try {
        const result = await amendAttendanceStatusAction(sessionId, nextRow);
        if (!result.ok) {
          setAttendanceByStudent((current) => {
            const next = new Map(current);
            if (previous) next.set(student.id, previous);
            else next.delete(student.id);
            return next;
          });
          toast.error(t("learningAttendanceSaveFailed"));
        }
      } catch {
        setAttendanceByStudent((current) => {
          const next = new Map(current);
          if (previous) next.set(student.id, previous);
          else next.delete(student.id);
          return next;
        });
        toast.error(t("learningAttendanceSaveFailed"));
      } finally {
        setAttendanceSavingStudentIds((current) => {
          const next = new Set(current);
          next.delete(student.id);
          return next;
        });
      }
    })();
  };

  const updateSeatSlots = (next: LearningSeatSlot[]) => {
    seatSlotsRef.current = next;
    setSeatSlots(next);
  };

  const publishSeatSlots = (next: LearningSeatSlot[]) => {
    updateSeatSlots(next);
    onSeatOrderChange?.(learningSeatAssignments(next));
  };

  const persistSeatLayout = async (next: LearningSeatSlot[]) => {
    const previousSaved = savedSeatSlotsRef.current;
    if (
      seatOrderSavingRef.current
      || next.every((student, index) => student?.id === previousSaved[index]?.id)
    ) return;
    if (ephemeral) {
      savedSeatSlotsRef.current = next;
      onSeatOrderChange?.(learningSeatAssignments(next));
      return;
    }
    seatOrderSavingRef.current = true;
    setSeatOrderSaving(true);
    try {
      const result = await saveClassroomStudentSeatLayoutAction({
        sessionId,
        assignments: learningSeatAssignments(next),
      });
      if (!result.ok) {
        publishSeatSlots(previousSaved);
        toast.error(t(result.code === "ROSTER_CHANGED" ? "learningSeatOrderRosterChanged" : "learningSeatOrderSaveFailed"));
        return;
      }
      savedSeatSlotsRef.current = next;
      onSeatOrderChange?.(learningSeatAssignments(next));
      toast.success(t("learningSeatOrderSaved"));
    } catch {
      publishSeatSlots(previousSaved);
      toast.error(t("learningSeatOrderSaveFailed"));
    } finally {
      seatOrderSavingRef.current = false;
      setSeatOrderSaving(false);
    }
  };

  const finishDragging = (cancelled = false) => {
    if (!draggingStudentIdRef.current) return;
    draggingStudentIdRef.current = null;
    dragOverSeatPositionRef.current = null;
    dragStartPointRef.current = null;
    setDraggingStudentId(null);
    setDragOverSeatPosition(null);
    setDragOriginSeatPosition(null);
    setDragOffset(null);
    if (cancelled) {
      publishSeatSlots(dragStartSeatSlotsRef.current);
      return;
    }
    void persistSeatLayout(seatSlotsRef.current);
  };

  const handleDragPointerDown = (event: PointerEvent<HTMLButtonElement>, studentId: string) => {
    if (!seatEditMode || seatOrderSavingRef.current || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartSeatSlotsRef.current = seatSlotsRef.current;
    dragStartPointRef.current = { x: event.clientX, y: event.clientY };
    draggingStudentIdRef.current = studentId;
    dragOverSeatPositionRef.current = seatSlotsRef.current.findIndex((student) => student?.id === studentId);
    setDraggingStudentId(studentId);
    setDragOverSeatPosition(dragOverSeatPositionRef.current);
    setDragOriginSeatPosition(dragOverSeatPositionRef.current);
    setDragOffset({ x: 0, y: 0 });
  };

  const handleDragPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const activeStudentId = draggingStudentIdRef.current;
    const startPoint = dragStartPointRef.current;
    const grid = seatGridRef.current;
    if (!activeStudentId || !startPoint || !grid) return;
    setDragOffset({ x: event.clientX - startPoint.x, y: event.clientY - startPoint.y });

    const bounds = grid.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const rowCount = Math.ceil(seatSlotsRef.current.length / LEARNING_SEAT_COLUMNS);
    const column = Math.max(0, Math.min(
      LEARNING_SEAT_COLUMNS - 1,
      Math.floor(((event.clientX - bounds.left) / bounds.width) * LEARNING_SEAT_COLUMNS),
    ));
    const row = Math.max(0, Math.min(
      rowCount - 1,
      Math.floor(((event.clientY - bounds.top) / bounds.height) * rowCount),
    ));
    const overSeatPosition = row * LEARNING_SEAT_COLUMNS + column;
    if (!Number.isInteger(overSeatPosition) || overSeatPosition === dragOverSeatPositionRef.current) return;
    dragOverSeatPositionRef.current = overSeatPosition;
    setDragOverSeatPosition(overSeatPosition);
    publishSeatSlots(moveLearningStudentToSeat(
      dragStartSeatSlotsRef.current,
      activeStudentId,
      overSeatPosition,
    ));
  };

  const handleOrderKeyDown = (event: KeyboardEvent<HTMLButtonElement>, studentId: string) => {
    if (seatOrderSavingRef.current || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = seatSlotsRef.current;
    const currentIndex = current.findIndex((student) => student?.id === studentId);
    if (currentIndex < 0) return;
    const delta = event.key === "ArrowLeft"
      ? -1
      : event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp"
          ? -LEARNING_SEAT_COLUMNS
          : LEARNING_SEAT_COLUMNS;
    const targetIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? current.length - 1
        : Math.max(0, Math.min(current.length - 1, currentIndex + delta));
    if (targetIndex === currentIndex) return;
    const next = moveLearningStudentToSeat(current, studentId, targetIndex);
    publishSeatSlots(next);
    void persistSeatLayout(next);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          title={t("learningPanelOpen")}
          className={cn(
            triggerVariant === "rail"
              ? "grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink"
              : "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-3 text-xs text-paper",
          )}
          data-classroom-rail-button={triggerVariant === "rail" ? "learning" : undefined}
        >
          <ClipboardCheck size={triggerVariant === "rail" ? 18 : 14} />
          <span className={triggerVariant === "rail" ? "sr-only" : undefined}>{t("learningPanelOpen")}</span>
        </button>
      </DialogTrigger>
      {/* `w-full` 避免 Windows 经典滚动条下 `100vw` 多出的约 15px。 */}
      <DialogContent className="z-[80] flex h-dvh max-h-none w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none [&>button]:right-2.5 [&>button]:top-2.5">
        <DialogHeader className="shrink-0 space-y-0 border-b border-line px-2 pb-1 pr-11 pt-1.5 text-left">
          <div className="flex min-h-8 min-w-0 items-center gap-2" data-learning-check-toolbar>
            <DialogTitle className="flex shrink-0 items-center gap-1.5 text-sm">
              <ClipboardCheck size={16} />{t("learningPanelTitle")}
            </DialogTitle>
            {ephemeral && (
              <span className="shrink-0 rounded-full bg-moon/50 px-2 py-0.5 text-[10px] text-ink" data-learning-persistence="ephemeral">
                {t("learningRehearsalLocal")}
              </span>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2 border-l border-line pl-2">
              <span className="min-w-0 truncate text-xs font-medium text-ink">{activeCheck?.title}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted">{t("learningCheckedCount", { checked: checkedCount, total: orderedStudents.length })}</span>
              <span className="hidden h-1 w-16 shrink-0 overflow-hidden rounded-full bg-line/70 sm:block">
                <span
                  className="block h-full rounded-full bg-leaf transition-[width] duration-200 motion-reduce:transition-none"
                  style={{ width: `${orderedStudents.length > 0 ? (checkedCount / orderedStudents.length) * 100 : 0}%` }}
                />
              </span>
              {(pending || seatOrderSaving) && <LoaderCircle size={13} className="shrink-0 animate-spin text-muted motion-reduce:animate-none" />}
              {seatOrderSaving && <span className="hidden shrink-0 text-[11px] text-muted md:inline">{t("learningSeatOrderSaving")}</span>}
            </div>
            <Button
              size="sm"
              variant={seatEditMode ? "primary" : "secondary"}
              disabled={seatOrderSaving}
              aria-pressed={seatEditMode}
              className="min-h-8 shrink-0 px-2.5 text-xs"
              onClick={() => {
                if (draggingStudentIdRef.current) finishDragging(true);
                setSeatEditMode((enabled) => !enabled);
                setBatchMode(false);
                if (activeCheck) setStudentSelection({ checkId: activeCheck.id, ids: new Set() });
              }}
            >
              <GripVertical size={14} />
              {seatEditMode ? t("learningSeatEditStop") : t("learningSeatEditStart")}
            </Button>
            <Button
              size="sm"
              variant={batchMode ? "primary" : "secondary"}
              className="min-h-8 shrink-0 px-2.5 text-xs"
              onClick={() => {
                if (draggingStudentIdRef.current) finishDragging(true);
                setSeatEditMode(false);
                setBatchMode((enabled) => !enabled);
                if (activeCheck) setStudentSelection({ checkId: activeCheck.id, ids: new Set() });
              }}
            >
              {batchMode ? <CheckSquare2 size={14} /> : <Square size={14} />}
              {batchMode ? t("learningBatchExit") : t("learningBatchStart")}
            </Button>
            {batchMode && (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-8 shrink-0 px-2 text-xs"
                onClick={() => {
                  if (!activeCheck) return;
                  setStudentSelection({
                    checkId: activeCheck.id,
                    ids: selectedStudentIds.size === orderedStudents.length
                      ? new Set()
                      : new Set(orderedStudents.map((student) => student.id)),
                  });
                }}
              >
                {selectedStudentIds.size === orderedStudents.length ? t("learningBatchClear") : t("learningBatchAll")}
              </Button>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto pb-0.5 pt-1" data-learning-check-strip>
            {setup.checks.map((check, index) => (
              <Button
                key={check.id}
                size="sm"
                variant={check.id === activeCheck?.id ? "primary" : "secondary"}
                className="min-h-8 shrink-0 px-2.5 py-1 text-[11px]"
                onClick={() => {
                  setManualSelection({ pageDocId: activePageDocId, checkId: check.id });
                  setStudentSelection({ checkId: check.id, ids: new Set() });
                }}
              >
                {index + 1}. {check.title}
              </Button>
            ))}
          </div>
        </DialogHeader>

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
          {batchMode && (
            <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-paper/95 p-1.5 shadow-sm backdrop-blur">
              <span className="mr-1 text-xs text-muted">{t("learningBatchSelected", { count: selectedStudentIds.size })}</span>
              {LEARNING_CHECK_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={selectedStudentIds.size === 0 || pending}
                  onClick={() => mark([...selectedStudentIds], status)}
                  className={cn(
                    "min-h-10 rounded-lg border px-2.5 text-xs font-medium transition-transform active:scale-95 disabled:opacity-40",
                    LEARNING_CHECK_STATUS_STYLE[status].active,
                  )}
                >
                  {t("learningStatus_" + status)}
                </button>
              ))}
            </div>
          )}

          <div
            ref={seatGridRef}
            className="grid min-h-0 flex-1 auto-rows-[minmax(8.25rem,1fr)] gap-1"
            style={{ gridTemplateColumns: `repeat(${LEARNING_SEAT_COLUMNS}, minmax(0, 1fr))` }}
            data-learning-seat-grid
            data-learning-seat-columns={LEARNING_SEAT_COLUMNS}
            data-ipad-roster-grid
          >
            {seatSlots.map((student, seatPosition) => (
              <article
                key={`seat-${seatPosition}`}
                data-learning-seat-index={seatPosition}
                data-learning-seat-layer="background"
                data-learning-empty-seat={student ? undefined : ""}
                aria-label={student ? undefined : t("learningEmptySeatNumber", { number: seatPosition + 1 })}
                aria-hidden={student ? true : undefined}
                style={{
                  gridColumnStart: (seatPosition % LEARNING_SEAT_COLUMNS) + 1,
                  gridRowStart: Math.floor(seatPosition / LEARNING_SEAT_COLUMNS) + 1,
                }}
                className={cn(
                  "relative flex min-h-[8.25rem] min-w-0 flex-col items-center justify-center rounded-xl border p-2 text-center text-muted transition-[border-color,background-color,box-shadow]",
                  student
                    ? "pointer-events-none border-transparent bg-transparent"
                    : "border-dashed border-line/80 bg-card/25",
                  draggingStudentId && dragOverSeatPosition === seatPosition && "border-crater bg-moon/35 ring-2 ring-crater/30",
                )}
              >
                {!student && (
                  <>
                    <span className="absolute left-2 top-2 text-[9px] tabular-nums opacity-70" aria-hidden="true">
                      {String(seatPosition + 1).padStart(2, "0")}
                    </span>
                    <Armchair size={20} className="mb-1 opacity-45" aria-hidden="true" />
                    <span className="text-[11px] font-medium">{t("learningEmptySeat")}</span>
                    <span className="mt-0.5 text-[9px] opacity-70">{t("learningEmptySeatDrop")}</span>
                  </>
                )}
              </article>
            ))}
            {stableSeatStudents.map((student) => {
              const seatPosition = seatPositionByStudentId.get(student.id) ?? 0;
              const visualSeatPosition = draggingStudentId === student.id
                ? dragOriginSeatPosition ?? seatPosition
                : seatPosition;
              const status = activeCheck
                ? results.get(learningResultKey(activeCheck.id, student.id)) ?? "unchecked"
                : "unchecked";
              const selected = selectedStudentIds.has(student.id);
              const saving = savingStudentIds.has(student.id);
              const statusStyle = LEARNING_CHECK_STATUS_STYLE[status];
              return (
                <article
                  key={student.id}
                  data-learning-student-id={student.id}
                  data-learning-seat-index={seatPosition}
                  data-learning-seat-layer="student"
                  style={{
                    gridColumnStart: (visualSeatPosition % LEARNING_SEAT_COLUMNS) + 1,
                    gridRowStart: Math.floor(visualSeatPosition / LEARNING_SEAT_COLUMNS) + 1,
                    transform: draggingStudentId === student.id && dragOffset
                      ? `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`
                      : undefined,
                  }}
                  className={cn(
                    "relative z-10 flex min-h-[8.25rem] min-w-0 flex-col overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow,opacity,transform]",
                    batchMode && selected
                      ? "border-rose bg-rose/10 ring-2 ring-rose/20"
                      : statusStyle.card,
                    draggingStudentId === student.id && "z-30 opacity-85 shadow-lg transition-none will-change-transform",
                    dragOverSeatPosition === seatPosition && draggingStudentId !== student.id && "ring-2 ring-crater/35",
                  )}
                >
                  <div className={cn(
                    "h-1 shrink-0 rounded-t-xl transition-colors",
                    status === "unchecked" ? "bg-line/80" : statusStyle.dot,
                  )}
                    data-learning-current-status={status}
                  />
                  <div className="flex min-h-8 items-center gap-0.5 px-1">
                    {attendanceIntegrated && (
                      <AttendanceStatusLight
                        studentName={student.name}
                        row={attendanceByStudent.get(student.id)}
                        saving={attendanceSavingStudentIds.has(student.id)}
                        onChange={(attendanceStatus) => markAttendance(student, attendanceStatus)}
                      />
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!batchMode}
                      onClick={() => toggleSelected(student.id)}
                      className={cn(
                        "h-8 min-w-0 flex-1 justify-start gap-1 px-1 text-left disabled:opacity-100",
                        batchMode && "hover:bg-moon/30 active:scale-[0.99]",
                      )}
                    >
                      {batchMode && (selected ? <CheckSquare2 size={15} className="shrink-0 text-rose" /> : <Square size={15} className="shrink-0 text-muted" />)}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{student.name}</span>
                      {saving && <LoaderCircle size={13} className="shrink-0 animate-spin text-muted motion-reduce:animate-none" />}
                    </Button>
                    {seatEditMode && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={seatOrderSaving}
                        aria-label={t("learningSeatOrderHandle", { name: student.name })}
                        title={t("learningSeatOrderHint")}
                        className="h-8 w-10 shrink-0 touch-none cursor-grab gap-0 p-0 text-muted active:cursor-grabbing"
                        onPointerDown={(event) => handleDragPointerDown(event, student.id)}
                        onPointerMove={handleDragPointerMove}
                        onPointerUp={() => finishDragging(false)}
                        onPointerCancel={() => finishDragging(true)}
                        onKeyDown={(event) => handleOrderKeyDown(event, student.id)}
                      >
                        <GripVertical size={14} />
                        <span className="text-[9px] tabular-nums" aria-hidden="true">
                          {String(seatPosition + 1).padStart(2, "0")}
                        </span>
                      </Button>
                    )}
                  </div>
                  {!batchMode && (
                    <div className="grid min-h-0 flex-1 grid-cols-3 auto-rows-[2.75rem] content-center gap-1 px-1">
                      {LEARNING_CHECK_STATUSES.map((candidate) => (
                        <button
                          key={candidate}
                          type="button"
                          disabled={saving}
                          aria-pressed={status === candidate}
                          aria-label={t("learningStatus_" + candidate)}
                          title={t("learningStatus_" + candidate)}
                          onClick={() => mark([student.id], candidate)}
                          className={cn(
                            "flex h-11 min-h-0 items-center justify-center gap-1 rounded-lg border px-1 text-[11px] font-medium leading-tight outline-none transition-[color,background-color,border-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-crater focus-visible:ring-offset-1 focus-visible:ring-offset-card active:scale-95 disabled:opacity-55",
                            status === candidate
                              ? LEARNING_CHECK_STATUS_STYLE[candidate].active
                              : cn("border-transparent bg-paper/55 text-muted", LEARNING_CHECK_STATUS_STYLE[candidate].idle),
                          )}
                        >
                          <span className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            status === candidate ? "bg-current opacity-75" : LEARNING_CHECK_STATUS_STYLE[candidate].dot,
                          )} />
                          {t("learningStatusShort_" + candidate)}
                        </button>
                      ))}
                    </div>
                  )}
                  {batchMode && <p className="px-1 pb-1 text-xs text-muted">{t("learningStatus_" + status)}</p>}
                </article>
              );
            })}
          </div>
        </main>
      </DialogContent>
    </Dialog>
  );
}
