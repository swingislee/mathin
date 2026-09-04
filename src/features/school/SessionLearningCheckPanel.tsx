"use client";

import { Armchair, ClipboardCheck, GripVertical, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  LearningCheckMatrixEntry,
  type LearningCheckMatrixCell,
  type LearningCheckMatrixOrientation,
} from "./LearningCheckMatrixEntry";
import { amendAttendanceStatusAction } from "./actions/attendance";
import type { AttendanceDrawerRow } from "./actions/types";
import { ATTENDANCE_STATUS_LED, ATTENDANCE_STATUS_TONE } from "./attendance-visual";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./learning";
import { markSessionLearningMatrixAction, saveClassroomStudentSeatLayoutAction } from "./session-learning-actions";
import {
  buildLearningSeatSlots,
  LEARNING_SEAT_COLUMNS,
  learningCheckIdAfterPageChange,
  learningCheckIdForPage,
  learningResultKey,
  learningSeatAssignments,
  moveLearningStudentToSeat,
  type LearningCheckStatus,
  type LearningSeatSlot,
  type SessionLearningCheck,
  type SessionLearningSetup,
  type SessionLearningStudent,
} from "./session-learning-contract";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";

interface LearningFillUndo {
  cells: Array<{ checkId: string; studentId: string }>;
  status: Exclude<LearningCheckStatus, "unchecked">;
}

type ClassroomLearningCell = LearningCheckMatrixCell<SessionLearningStudent, SessionLearningCheck>;

const LEARNING_FILL_TOAST_OPTIONS = { position: "top-center" as const };

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
            : <span aria-hidden className={cn("size-2 rounded-full ring-2", status ? ATTENDANCE_STATUS_LED[status] : "bg-transparent ring-line")} />}
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
  const [matrixOrientation, setMatrixOrientation] = useState<LearningCheckMatrixOrientation>("by-question");
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
  const [fillUndo, setFillUndo] = useState<LearningFillUndo | null>(null);
  const [savingCellKeys, setSavingCellKeys] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const orderedStudents = useMemo(
    () => seatSlots.filter((student): student is SessionLearningStudent => student !== null),
    [seatSlots],
  );
  const stableSeatStudents = useMemo(
    () => [...orderedStudents].sort((left, right) => left.id.localeCompare(right.id)),
    [orderedStudents],
  );
  const [activeStudentId, setActiveStudentId] = useState<string | null>(() => setup.students[0]?.id ?? null);
  const resolvedActiveStudentId = orderedStudents.some((student) => student.id === activeStudentId)
    ? activeStudentId
    : orderedStudents[0]?.id ?? null;
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
  }
  const activeCheckId = manualSelection.pageDocId === activePageDocId
    ? manualSelection.checkId ?? automaticCheckId ?? setup.checks[0]?.id ?? ""
    : learningCheckIdAfterPageChange(setup.checks, manualSelection.checkId, activePageDocId) ?? "";
  const activeCheck = setup.checks.find((check) => check.id === activeCheckId) ?? setup.checks[0];
  const activeCheckSummaryId = activeCheck?.id ?? "";
  const fillExcludedStudentIds = useMemo(() => new Set(
    [...attendanceByStudent.entries()].flatMap(([studentId, row]) => (
      row.marked && (row.status === "absent" || row.status === "leave") ? [studentId] : []
    )),
  ), [attendanceByStudent]);
  const canUndoFill = Boolean(fillUndo?.cells.some((cell) => (
    (results.get(learningResultKey(cell.checkId, cell.studentId)) ?? "unchecked") === fillUndo.status
  )));

  useEffect(() => {
    if (!activeCheckSummaryId) return;
    onSummaryChange?.({ checkId: activeCheckSummaryId, results: new Map(results) });
  }, [activeCheckSummaryId, onSummaryChange, results]);

  if (setup.checks.length === 0) return null;

  const mark = (
    cells: Array<{ checkId: string; studentId: string }>,
    status: LearningCheckStatus,
    onSuccess?: (savedCells: Array<{ checkId: string; studentId: string }>) => void,
  ) => {
    const targetCells = cells.filter((cell) => !savingCellKeys.has(learningResultKey(cell.checkId, cell.studentId)));
    if (targetCells.length === 0) return;
    const targetKeys = targetCells.map((cell) => learningResultKey(cell.checkId, cell.studentId));
    const previous = new Map(targetCells.map((cell) => {
      const key = learningResultKey(cell.checkId, cell.studentId);
      return [key, results.get(key) ?? "unchecked"] as const;
    }));
    setSavingCellKeys((current) => new Set([...current, ...targetKeys]));
    setResults((current) => {
      const next = new Map(current);
      for (const cell of targetCells) {
        const key = learningResultKey(cell.checkId, cell.studentId);
        if (status === "unchecked") next.delete(key);
        else next.set(key, status);
      }
      return next;
    });
    if (ephemeral) {
      setSavingCellKeys((current) => {
        const next = new Set(current);
        for (const key of targetKeys) next.delete(key);
        return next;
      });
      onSuccess?.(targetCells);
      return;
    }
    startTransition(async () => {
      const result = await markSessionLearningMatrixAction({
        sessionId,
        cells: targetCells,
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
        onSuccess?.(targetCells);
      }
      setSavingCellKeys((current) => {
        const next = new Set(current);
        for (const key of targetKeys) next.delete(key);
        return next;
      });
    });
  };

  const fillUncheckedCells = (
    cells: ClassroomLearningCell[],
    status: Exclude<LearningCheckStatus, "unchecked">,
  ) => {
    const targetCells = cells.map((cell) => ({
      checkId: cell.question.id,
      studentId: cell.student.id,
    }));
    if (targetCells.length === 0) return;
    const filledOrientation = matrixOrientation;
    mark(targetCells, status, (savedCells) => {
      setFillUndo({ cells: savedCells, status });
      toast.success(t(
        filledOrientation === "by-question" ? "learningFillSaved" : "learningQuestionFillSaved",
        { count: savedCells.length },
      ), LEARNING_FILL_TOAST_OPTIONS);
    });
  };

  const undoLastFill = () => {
    if (!fillUndo) return;
    const undoCells = fillUndo.cells.filter((cell) => (
      (results.get(learningResultKey(cell.checkId, cell.studentId)) ?? "unchecked") === fillUndo.status
    ));
    if (undoCells.length === 0) {
      setFillUndo(null);
      return;
    }
    mark(undoCells, "unchecked", (savedCells) => {
      setFillUndo(null);
      toast.success(t("learningFillUndone", { count: savedCells.length }), LEARNING_FILL_TOAST_OPTIONS);
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
        <DialogHeader className="shrink-0 space-y-0 border-b border-line px-2 py-1.5 pr-11 text-left">
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
              {(pending || seatOrderSaving) && <LoaderCircle size={13} className="shrink-0 animate-spin text-muted motion-reduce:animate-none" />}
              {seatOrderSaving && <span className="hidden shrink-0 text-[11px] text-muted md:inline">{t("learningSeatOrderSaving")}</span>}
            </div>
            {matrixOrientation === "by-question" ? (
              <Button
                size="sm"
                variant={seatEditMode ? "primary" : "secondary"}
                disabled={seatOrderSaving}
                aria-pressed={seatEditMode}
                className="hidden min-h-8 shrink-0 px-2.5 text-xs sm:inline-flex"
                onClick={() => {
                  if (draggingStudentIdRef.current) finishDragging(true);
                  setSeatEditMode((enabled) => !enabled);
                }}
              >
                <GripVertical size={14} />
                {seatEditMode ? t("learningSeatEditStop") : t("learningSeatEditStart")}
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-1" data-learning-responsive-layout="shared-matrix-mobile-list-desktop-grid">
          <LearningCheckMatrixEntry
            students={stableSeatStudents.map((student) => ({
              id: student.id,
              label: student.name,
              slot: seatPositionByStudentId.get(student.id) ?? 0,
              data: student,
            }))}
            questions={setup.checks.map((check, index) => ({
              id: check.id,
              label: check.title,
              slot: index,
              data: check,
            }))}
            orientation={matrixOrientation}
            onOrientationChange={(nextOrientation) => {
              if (nextOrientation === "by-student") {
                if (draggingStudentIdRef.current) finishDragging(true);
                setSeatEditMode(false);
              }
              setMatrixOrientation(nextOrientation);
            }}
            activeStudentId={resolvedActiveStudentId}
            activeQuestionId={activeCheck?.id ?? null}
            onActiveStudentChange={setActiveStudentId}
            onActiveQuestionChange={(checkId) => {
              setManualSelection({ pageDocId: activePageDocId, checkId });
            }}
            statusFor={(studentId, checkId) => (
              results.get(learningResultKey(checkId, studentId)) ?? "unchecked"
            )}
            onStatusChange={(cell, status) => mark([{
              checkId: cell.question.id,
              studentId: cell.student.id,
            }], status)}
            isCellPending={(cell) => savingCellKeys.has(learningResultKey(cell.question.id, cell.student.id))}
            isCellBulkEligible={(cell) => !fillExcludedStudentIds.has(cell.student.id)}
            gridRef={seatGridRef}
            getCardProps={(cell) => ({
              "data-learning-student-id": cell.student.id,
              "data-learning-check-id": cell.question.id,
              "data-learning-seat-index": cell.student.slot,
              "data-learning-seat-layer": "student",
            } as HTMLAttributes<HTMLElement>)}
            getCardStyle={(cell) => {
              if (matrixOrientation !== "by-question") return undefined;
              const seatPosition = cell.student.slot ?? 0;
              const visualSeatPosition = draggingStudentId === cell.student.id
                ? dragOriginSeatPosition ?? seatPosition
                : seatPosition;
              return {
                gridColumnStart: (visualSeatPosition % LEARNING_SEAT_COLUMNS) + 1,
                gridRowStart: Math.floor(visualSeatPosition / LEARNING_SEAT_COLUMNS) + 1,
                transform: draggingStudentId === cell.student.id && dragOffset
                  ? `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`
                  : undefined,
              };
            }}
            getCardClassName={(cell) => {
              if (matrixOrientation !== "by-question") return undefined;
              const seatPosition = cell.student.slot ?? 0;
              return cn(
                draggingStudentId === cell.student.id && "z-30 opacity-85 shadow-lg transition-none will-change-transform",
                dragOverSeatPosition === seatPosition && draggingStudentId !== cell.student.id && "ring-2 ring-crater/35",
              );
            }}
            renderCardHeader={(cell) => {
              const student = cell.student.data;
              const check = cell.question.data;
              const saving = savingCellKeys.has(learningResultKey(check.id, student.id));
              const statusStyle = LEARNING_CHECK_STATUS_STYLE[cell.status];
              if (matrixOrientation === "by-student") {
                return (
                  <div className="flex min-h-8 min-w-0 items-center gap-1 px-2">
                    <span className="w-6 shrink-0 text-center font-mono text-[10px] text-muted">{(cell.question.slot ?? 0) + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{check.title}</span>
                    {cell.status !== "unchecked" ? (
                      <span className={cn("shrink-0 text-[10px] font-medium", statusStyle.icon)}>
                        {t("learningStatus_" + cell.status)}
                      </span>
                    ) : null}
                    {saving ? <LoaderCircle size={13} className="shrink-0 animate-spin text-muted motion-reduce:animate-none" /> : null}
                  </div>
                );
              }
              const seatPosition = cell.student.slot ?? 0;
              return (
                <div className="flex min-h-8 items-center gap-0.5 px-1">
                  {attendanceIntegrated ? (
                    <AttendanceStatusLight
                      studentName={student.name}
                      row={attendanceByStudent.get(student.id)}
                      saving={attendanceSavingStudentIds.has(student.id)}
                      onChange={(attendanceStatus) => markAttendance(student, attendanceStatus)}
                    />
                  ) : null}
                  <div className="flex h-8 min-w-0 flex-1 items-center gap-1 px-1 text-left">
                    <span className="min-w-0 truncate text-xs font-medium">{student.name}</span>
                    {cell.status !== "unchecked" ? (
                      <span className={cn("shrink-0 text-[10px] font-medium", statusStyle.icon)}>
                        {t("learningStatus_" + cell.status)}
                      </span>
                    ) : null}
                    {saving ? <LoaderCircle size={13} className="shrink-0 animate-spin text-muted motion-reduce:animate-none" /> : null}
                  </div>
                  {seatEditMode ? (
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
                  ) : null}
                </div>
              );
            }}
            renderMobileHeader={(cell) => {
              const student = cell.student.data;
              if (matrixOrientation === "by-student") {
                return (
                  <div className="flex min-w-0 items-center gap-2 px-1">
                    <span className="w-6 shrink-0 text-center font-mono text-[10px] text-muted">{(cell.question.slot ?? 0) + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{cell.question.label}</span>
                    {cell.status !== "unchecked" ? (
                      <span className={cn("shrink-0 text-[10px] font-medium", LEARNING_CHECK_STATUS_STYLE[cell.status].icon)}>
                        {t("learningStatus_" + cell.status)}
                      </span>
                    ) : null}
                  </div>
                );
              }
              return (
                <div className="flex min-w-0 items-center gap-1">
                  {attendanceIntegrated ? (
                    <AttendanceStatusLight
                      studentName={student.name}
                      row={attendanceByStudent.get(student.id)}
                      saving={attendanceSavingStudentIds.has(student.id)}
                      onChange={(attendanceStatus) => markAttendance(student, attendanceStatus)}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-ink">{student.name}</span>
                  {cell.status !== "unchecked" ? (
                    <span className={cn("shrink-0 text-[10px] font-medium", LEARNING_CHECK_STATUS_STYLE[cell.status].icon)}>
                      {t("learningStatus_" + cell.status)}
                    </span>
                  ) : null}
                </div>
              );
            }}
            getSlotProps={({ orientation, position, occupied }) => {
              if (orientation !== "by-question") return { "aria-hidden": true };
              return {
                "data-learning-seat-index": position,
                "data-learning-seat-layer": "background",
                "data-learning-empty-seat": occupied ? undefined : "",
                "aria-label": occupied ? undefined : t("learningEmptySeatNumber", { number: position + 1 }),
                "aria-hidden": occupied ? true : undefined,
              } as HTMLAttributes<HTMLElement>;
            }}
            getSlotClassName={({ orientation, position }) => (
              orientation === "by-question" && draggingStudentId && dragOverSeatPosition === position
                ? "border-crater bg-moon/35 ring-2 ring-crater/30"
                : undefined
            )}
            renderSlotBackground={({ orientation, position, occupied }) => (
              orientation === "by-question" && !occupied ? (
                <>
                  <span className="absolute left-2 top-2 text-[9px] tabular-nums opacity-70" aria-hidden="true">
                    {String(position + 1).padStart(2, "0")}
                  </span>
                  <Armchair size={20} className="mb-1 opacity-45" aria-hidden="true" />
                  <span className="text-[11px] font-medium">{t("learningEmptySeat")}</span>
                  <span className="mt-0.5 text-[9px] opacity-70">{t("learningEmptySeatDrop")}</span>
                </>
              ) : undefined
            )}
            fill={{
              pending,
              canUndo: canUndoFill,
              onFill: fillUncheckedCells,
              onUndo: undoLastFill,
            }}
          />
        </main>
      </DialogContent>
    </Dialog>
  );
}
