"use client";

import { CheckSquare2, ClipboardCheck, GripVertical, LoaderCircle, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { markSessionLearningChecksAction, saveClassroomStudentSeatOrderAction } from "./session-learning-actions";
import {
  LEARNING_CHECK_STATUSES,
  learningCheckIdAfterPageChange,
  learningCheckIdForPage,
  learningResultKey,
  moveLearningStudent,
  type LearningCheckStatus,
  type SessionLearningSetup,
} from "./session-learning-contract";

const STATUS_STYLE: Record<LearningCheckStatus, {
  active: string;
  card: string;
  dot: string;
  idle: string;
}> = {
  explained: {
    active: "border-sky-500 bg-sky-500 text-white shadow-sm",
    card: "border-sky-500/45 bg-sky-500/[0.04] dark:bg-sky-950/15",
    dot: "bg-sky-500",
    idle: "hover:border-sky-500/45 hover:bg-sky-500/10 hover:text-sky-700 dark:hover:text-sky-200",
  },
  independent: {
    active: "border-leaf bg-leaf text-white shadow-sm",
    card: "border-leaf/50 bg-leaf/[0.05]",
    dot: "bg-leaf",
    idle: "hover:border-leaf/50 hover:bg-leaf/10 hover:text-leaf-deep",
  },
  prompted: {
    active: "border-amber-400 bg-amber-300 text-amber-950 shadow-sm dark:border-amber-500 dark:bg-amber-500",
    card: "border-amber-400/50 bg-amber-400/[0.05] dark:bg-amber-950/15",
    dot: "bg-amber-400",
    idle: "hover:border-amber-400/50 hover:bg-amber-400/10 hover:text-amber-800 dark:hover:text-amber-200",
  },
  imitated: {
    active: "border-violet-500 bg-violet-500 text-white shadow-sm",
    card: "border-violet-500/45 bg-violet-500/[0.04] dark:bg-violet-950/15",
    dot: "bg-violet-500",
    idle: "hover:border-violet-500/45 hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-200",
  },
  incomplete: {
    active: "border-rose bg-rose text-white shadow-sm",
    card: "border-rose/45 bg-rose/[0.04]",
    dot: "bg-rose",
    idle: "hover:border-rose/45 hover:bg-rose/10 hover:text-rose",
  },
  unchecked: {
    active: "border-crater/70 bg-line/70 text-muted",
    card: "border-dashed border-line bg-card/70",
    dot: "bg-crater",
    idle: "hover:border-crater/60 hover:bg-line/50 hover:text-ink",
  },
};

const EMPTY_STUDENT_IDS = new Set<string>();

export function SessionLearningCheckPanel({
  sessionId,
  setup,
  activePageDocId,
}: {
  sessionId: string;
  setup: SessionLearningSetup;
  activePageDocId: string | null;
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
  const [orderedStudents, setOrderedStudents] = useState(() => setup.students);
  const orderedStudentsRef = useRef(setup.students);
  const savedStudentsRef = useRef(setup.students);
  const dragStartStudentsRef = useRef(setup.students);
  const draggingStudentIdRef = useRef<string | null>(null);
  const dragOverStudentIdRef = useRef<string | null>(null);
  const seatOrderSavingRef = useRef(false);
  const [draggingStudentId, setDraggingStudentId] = useState<string | null>(null);
  const [dragOverStudentId, setDragOverStudentId] = useState<string | null>(null);
  const [seatOrderSaving, setSeatOrderSaving] = useState(false);
  const [studentSelection, setStudentSelection] = useState<{
    checkId: string;
    ids: Set<string>;
  }>(() => ({ checkId: "", ids: new Set<string>() }));
  const [batchMode, setBatchMode] = useState(false);
  const [savingStudentIds, setSavingStudentIds] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
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
  const selectedStudentIds = activeCheck && studentSelection.checkId === activeCheck.id
    ? studentSelection.ids
    : EMPTY_STUDENT_IDS;
  const checkedCount = useMemo(() => {
    if (!activeCheck) return 0;
    return orderedStudents.filter((student) =>
      (results.get(learningResultKey(activeCheck.id, student.id)) ?? "unchecked") !== "unchecked").length;
  }, [activeCheck, orderedStudents, results]);

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

  const updateStudentOrder = (next: SessionLearningSetup["students"]) => {
    orderedStudentsRef.current = next;
    setOrderedStudents(next);
  };

  const persistStudentOrder = async (next: SessionLearningSetup["students"]) => {
    const previousSaved = savedStudentsRef.current;
    if (
      seatOrderSavingRef.current
      || next.every((student, index) => student.id === previousSaved[index]?.id)
    ) return;
    seatOrderSavingRef.current = true;
    setSeatOrderSaving(true);
    try {
      const result = await saveClassroomStudentSeatOrderAction({
        sessionId,
        studentIds: next.map((student) => student.id),
      });
      if (!result.ok) {
        updateStudentOrder(previousSaved);
        toast.error(t(result.code === "ROSTER_CHANGED" ? "learningSeatOrderRosterChanged" : "learningSeatOrderSaveFailed"));
        return;
      }
      savedStudentsRef.current = next;
      toast.success(t("learningSeatOrderSaved"));
    } catch {
      updateStudentOrder(previousSaved);
      toast.error(t("learningSeatOrderSaveFailed"));
    } finally {
      seatOrderSavingRef.current = false;
      setSeatOrderSaving(false);
    }
  };

  const finishDragging = (cancelled = false) => {
    if (!draggingStudentIdRef.current) return;
    draggingStudentIdRef.current = null;
    dragOverStudentIdRef.current = null;
    setDraggingStudentId(null);
    setDragOverStudentId(null);
    if (cancelled) {
      updateStudentOrder(dragStartStudentsRef.current);
      return;
    }
    void persistStudentOrder(orderedStudentsRef.current);
  };

  const handleDragPointerDown = (event: PointerEvent<HTMLButtonElement>, studentId: string) => {
    if (seatOrderSavingRef.current || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartStudentsRef.current = orderedStudentsRef.current;
    draggingStudentIdRef.current = studentId;
    dragOverStudentIdRef.current = studentId;
    setDraggingStudentId(studentId);
    setDragOverStudentId(studentId);
  };

  const handleDragPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const activeStudentId = draggingStudentIdRef.current;
    if (!activeStudentId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-learning-student-id]");
    const overStudentId = target?.dataset.learningStudentId;
    if (!overStudentId || overStudentId === dragOverStudentIdRef.current) return;
    dragOverStudentIdRef.current = overStudentId;
    setDragOverStudentId(overStudentId);
    updateStudentOrder(moveLearningStudent(orderedStudentsRef.current, activeStudentId, overStudentId));
  };

  const handleOrderKeyDown = (event: KeyboardEvent<HTMLButtonElement>, studentId: string) => {
    if (seatOrderSavingRef.current || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = orderedStudentsRef.current;
    const currentIndex = current.findIndex((student) => student.id === studentId);
    if (currentIndex < 0) return;
    const targetIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? current.length - 1
        : Math.max(0, Math.min(current.length - 1, currentIndex + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)));
    if (targetIndex === currentIndex) return;
    const target = current[targetIndex];
    const next = moveLearningStudent(current, studentId, target.id);
    updateStudentOrder(next);
    void persistStudentOrder(next);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink px-3 text-xs text-paper">
          <ClipboardCheck size={14} />
          {t("learningPanelOpen")}
        </button>
      </DialogTrigger>
      <DialogContent className="flex h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:rounded-none [&>button]:right-2.5 [&>button]:top-2.5">
        <DialogHeader className="shrink-0 space-y-0 border-b border-line px-2 pb-1 pr-11 pt-1.5 text-left">
          <div className="flex min-h-8 min-w-0 items-center gap-2" data-learning-check-toolbar>
            <DialogTitle className="flex shrink-0 items-center gap-1.5 text-sm">
              <ClipboardCheck size={16} />{t("learningPanelTitle")}
            </DialogTitle>
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
              variant={batchMode ? "primary" : "secondary"}
              className="min-h-8 shrink-0 px-2.5 text-xs"
              onClick={() => {
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

        <main className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-2.5">
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
                    STATUS_STYLE[status].active,
                  )}
                >
                  {t("learningStatus_" + status)}
                </button>
              ))}
            </div>
          )}

          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))" }}
            data-ipad-roster-grid
          >
            {orderedStudents.map((student, studentIndex) => {
              const status = activeCheck
                ? results.get(learningResultKey(activeCheck.id, student.id)) ?? "unchecked"
                : "unchecked";
              const selected = selectedStudentIds.has(student.id);
              const saving = savingStudentIds.has(student.id);
              const statusStyle = STATUS_STYLE[status];
              return (
                <article
                  key={student.id}
                  data-learning-student-id={student.id}
                  className={cn(
                    "min-w-0 rounded-xl border p-1.5 transition-[border-color,background-color,box-shadow,opacity]",
                    batchMode && selected
                      ? "border-rose bg-rose/10 ring-2 ring-rose/20"
                      : statusStyle.card,
                    draggingStudentId === student.id && "opacity-65 shadow-sm",
                    dragOverStudentId === student.id && draggingStudentId !== student.id && "ring-2 ring-crater/35",
                  )}
                >
                  <div className={cn(
                    "-mx-1.5 -mt-1.5 mb-1 h-1 rounded-t-xl transition-colors",
                    status === "unchecked" ? "bg-line/80" : statusStyle.dot,
                  )} />
                  <div className="flex min-h-8 items-center gap-0.5">
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
                        {String(studentIndex + 1).padStart(2, "0")}
                      </span>
                    </Button>
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
                  </div>
                  {!batchMode && (
                    <div className="mt-1 grid grid-cols-3 gap-1">
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
                            "flex min-h-11 items-center justify-center gap-1 rounded-lg border px-1 text-[11px] font-medium leading-tight outline-none transition-[color,background-color,border-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-crater focus-visible:ring-offset-1 focus-visible:ring-offset-card active:scale-95 disabled:opacity-55",
                            status === candidate
                              ? STATUS_STYLE[candidate].active
                              : cn("border-transparent bg-paper/55 text-muted", STATUS_STYLE[candidate].idle),
                          )}
                        >
                          <span className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            status === candidate ? "bg-current opacity-75" : STATUS_STYLE[candidate].dot,
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
