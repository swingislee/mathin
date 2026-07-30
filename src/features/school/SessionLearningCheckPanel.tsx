"use client";

import { CheckCircle2, CheckSquare2, CircleDashed, ClipboardCheck, LoaderCircle, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { markSessionLearningChecksAction } from "./session-learning-actions";
import {
  LEARNING_CHECK_STATUSES,
  learningCheckIdAfterPageChange,
  learningCheckIdForPage,
  learningResultKey,
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
    return setup.students.filter((student) =>
      (results.get(learningResultKey(activeCheck.id, student.id)) ?? "unchecked") !== "unchecked").length;
  }, [activeCheck, results, setup.students]);

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

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink px-3 text-xs text-paper">
          <ClipboardCheck size={14} />
          {t("learningPanelOpen")}
        </button>
      </DialogTrigger>
      <DialogContent className="flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:rounded-none">
        <DialogHeader className="shrink-0 border-b border-line px-4 py-2.5">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck size={18} />{t("learningPanelTitle")}
            {pending && <LoaderCircle size={14} className="animate-spin text-muted motion-reduce:animate-none" />}
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 border-b border-line px-3 py-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {setup.checks.map((check, index) => (
              <Button
                key={check.id}
                size="sm"
                variant={check.id === activeCheck?.id ? "primary" : "secondary"}
                className="min-h-9 shrink-0 px-3 py-1.5 text-xs"
                onClick={() => {
                  setManualSelection({ pageDocId: activePageDocId, checkId: check.id });
                  setStudentSelection({ checkId: check.id, ids: new Set() });
                }}
              >
                {index + 1}. {check.title}
              </Button>
            ))}
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className="truncate font-medium">{activeCheck?.title}</p>
                <p className="shrink-0 text-xs tabular-nums text-muted">{t("learningCheckedCount", { checked: checkedCount, total: setup.students.length })}</p>
              </div>
              <div className="mt-1.5 h-1.5 max-w-sm overflow-hidden rounded-full bg-line/70">
                <div
                  className="h-full rounded-full bg-leaf transition-[width] duration-200 motion-reduce:transition-none"
                  style={{ width: `${setup.students.length > 0 ? (checkedCount / setup.students.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            <Button
              size="sm"
              variant={batchMode ? "primary" : "secondary"}
              onClick={() => {
                setBatchMode((enabled) => !enabled);
                if (activeCheck) setStudentSelection({ checkId: activeCheck.id, ids: new Set() });
              }}
            >
              {batchMode ? <CheckSquare2 size={15} /> : <Square size={15} />}
              {batchMode ? t("learningBatchExit") : t("learningBatchStart")}
            </Button>
            {batchMode && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!activeCheck) return;
                  setStudentSelection({
                    checkId: activeCheck.id,
                    ids: selectedStudentIds.size === setup.students.length
                      ? new Set()
                      : new Set(setup.students.map((student) => student.id)),
                  });
                }}
              >
                {selectedStudentIds.size === setup.students.length ? t("learningBatchClear") : t("learningBatchAll")}
              </Button>
            )}
          </div>

          {batchMode && (
            <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-paper/95 p-2 shadow-sm backdrop-blur">
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

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {setup.students.map((student) => {
              const status = activeCheck
                ? results.get(learningResultKey(activeCheck.id, student.id)) ?? "unchecked"
                : "unchecked";
              const selected = selectedStudentIds.has(student.id);
              const saving = savingStudentIds.has(student.id);
              const recorded = status !== "unchecked";
              const statusStyle = STATUS_STYLE[status];
              return (
                <article
                  key={student.id}
                  className={cn(
                    "min-w-0 rounded-2xl border p-2.5 shadow-sm transition-[border-color,background-color,box-shadow]",
                    batchMode && selected
                      ? "border-rose bg-rose/10 ring-2 ring-rose/20"
                      : statusStyle.card,
                  )}
                >
                  <button
                    type="button"
                    disabled={!batchMode}
                    onClick={() => toggleSelected(student.id)}
                    className={cn(
                      "flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-left",
                      batchMode && "hover:bg-moon/30 active:scale-[0.99]",
                    )}
                  >
                    {batchMode && (selected ? <CheckSquare2 size={16} className="shrink-0 text-rose" /> : <Square size={16} className="shrink-0 text-muted" />)}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{student.name}</span>
                    <span className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      saving
                        ? "border-crater/40 bg-moon/40 text-ink"
                        : recorded
                          ? "border-transparent bg-ink text-paper"
                          : "border-line bg-paper/70 text-muted",
                    )}>
                      {saving
                        ? <LoaderCircle size={11} className="animate-spin motion-reduce:animate-none" />
                        : recorded
                          ? <CheckCircle2 size={11} />
                          : <CircleDashed size={11} />}
                      {t(saving ? "learningStudentSaving" : recorded ? "learningStudentRecorded" : "learningStudentPending")}
                    </span>
                  </button>
                  {!batchMode && (
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                      {LEARNING_CHECK_STATUSES.map((candidate) => (
                        <button
                          key={candidate}
                          type="button"
                          disabled={saving}
                          aria-pressed={status === candidate}
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
                          {t("learningStatus_" + candidate)}
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
