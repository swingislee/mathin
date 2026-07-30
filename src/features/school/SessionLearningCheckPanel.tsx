"use client";

import { CheckSquare2, ClipboardCheck, LoaderCircle, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { markSessionLearningChecksAction } from "./session-learning-actions";
import {
  LEARNING_CHECK_STATUSES,
  learningResultKey,
  type LearningCheckStatus,
  type SessionLearningSetup,
} from "./session-learning-contract";

const STATUS_TONE: Record<LearningCheckStatus, string> = {
  explained: "border-sky-400/60 bg-sky-100 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100",
  independent: "border-leaf/60 bg-leaf/15 text-leaf-deep",
  prompted: "border-amber-400/60 bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  imitated: "border-violet-400/60 bg-violet-100 text-violet-950 dark:bg-violet-950/40 dark:text-violet-100",
  incomplete: "border-rose/60 bg-rose/10 text-rose",
  unchecked: "border-line bg-card text-muted",
};

export function SessionLearningCheckPanel({
  sessionId,
  setup,
}: {
  sessionId: string;
  setup: SessionLearningSetup;
}) {
  const t = useTranslations("school.session");
  const [activeCheckId, setActiveCheckId] = useState(setup.checks[0]?.id ?? "");
  const [results, setResults] = useState(() => new Map(
    setup.results.map((result) => [learningResultKey(result.checkId, result.studentId), result.status as LearningCheckStatus]),
  ));
  const [selectedStudentIds, setSelectedStudentIds] = useState(() => new Set<string>());
  const [batchMode, setBatchMode] = useState(false);
  const [pending, startTransition] = useTransition();
  const activeCheck = setup.checks.find((check) => check.id === activeCheckId) ?? setup.checks[0];
  const checkedCount = useMemo(() => {
    if (!activeCheck) return 0;
    return setup.students.filter((student) =>
      (results.get(learningResultKey(activeCheck.id, student.id)) ?? "unchecked") !== "unchecked").length;
  }, [activeCheck, results, setup.students]);

  if (setup.checks.length === 0) return null;

  const mark = (studentIds: string[], status: LearningCheckStatus) => {
    if (!activeCheck || studentIds.length === 0) return;
    const previous = new Map(studentIds.map((studentId) => {
      const key = learningResultKey(activeCheck.id, studentId);
      return [key, results.get(key) ?? "unchecked"] as const;
    }));
    setResults((current) => {
      const next = new Map(current);
      for (const studentId of studentIds) {
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
        studentIds,
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
        return;
      }
      setSelectedStudentIds(new Set());
    });
  };

  const toggleSelected = (studentId: string) => {
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
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
          <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
            {setup.checks.map((check, index) => (
              <Button
                key={check.id}
                size="sm"
                variant={check.id === activeCheck?.id ? "primary" : "secondary"}
                onClick={() => {
                  setActiveCheckId(check.id);
                  setSelectedStudentIds(new Set());
                }}
              >
                {index + 1}. {check.title}
              </Button>
            ))}
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{activeCheck?.title}</p>
              <p className="text-xs text-muted">{t("learningCheckedCount", { checked: checkedCount, total: setup.students.length })}</p>
            </div>
            <Button
              size="sm"
              variant={batchMode ? "primary" : "secondary"}
              onClick={() => {
                setBatchMode((enabled) => !enabled);
                setSelectedStudentIds(new Set());
              }}
            >
              {batchMode ? <CheckSquare2 size={15} /> : <Square size={15} />}
              {batchMode ? t("learningBatchExit") : t("learningBatchStart")}
            </Button>
            {batchMode && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedStudentIds(
                  selectedStudentIds.size === setup.students.length
                    ? new Set()
                    : new Set(setup.students.map((student) => student.id)),
                )}
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
                    STATUS_TONE[status],
                  )}
                >
                  {t("learningStatus_" + status)}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {setup.students.map((student) => {
              const status = activeCheck
                ? results.get(learningResultKey(activeCheck.id, student.id)) ?? "unchecked"
                : "unchecked";
              const selected = selectedStudentIds.has(student.id);
              return (
                <article
                  key={student.id}
                  className={cn(
                    "min-w-0 rounded-xl border p-2",
                    selected ? "border-ink bg-moon/25 ring-2 ring-ink/20" : "border-line bg-card",
                  )}
                >
                  <button
                    type="button"
                    disabled={!batchMode}
                    onClick={() => toggleSelected(student.id)}
                    className={cn(
                      "flex min-h-9 w-full items-center gap-2 rounded-lg px-1.5 text-left",
                      batchMode && "hover:bg-moon/30",
                    )}
                  >
                    {batchMode && (selected ? <CheckSquare2 size={16} className="shrink-0" /> : <Square size={16} className="shrink-0 text-muted" />)}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{student.name}</span>
                  </button>
                  {!batchMode && (
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      {LEARNING_CHECK_STATUSES.map((candidate) => (
                        <button
                          key={candidate}
                          type="button"
                          disabled={pending}
                          aria-pressed={status === candidate}
                          onClick={() => mark([student.id], candidate)}
                          className={cn(
                            "min-h-11 rounded-lg border px-1 text-[11px] font-medium leading-tight transition-transform active:scale-95",
                            STATUS_TONE[candidate],
                            status === candidate && "ring-2 ring-ink/45 ring-offset-1 ring-offset-card",
                          )}
                        >
                          {t("learningStatus_" + candidate)}
                        </button>
                      ))}
                    </div>
                  )}
                  {batchMode && <p className="px-1.5 pb-1 text-xs text-muted">{t("learningStatus_" + status)}</p>}
                </article>
              );
            })}
          </div>
        </main>
      </DialogContent>
    </Dialog>
  );
}
