"use client";

import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  LoaderCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  bindTeacherAssessmentPaperAction,
  completeTeacherAssessmentAction,
  saveTeacherAssessmentObservationAction,
  saveTeacherAssessmentQuestionAction,
} from "./teacher-assessment-actions";
import {
  quickScoreForOutcome,
  TEACHER_ASSESSMENT_OUTCOMES,
  teacherAssessmentSummary,
  type TeacherAssessmentOutcome,
  type TeacherAssessmentPaperOption,
  type TeacherAssessmentQuestion,
  type TeacherAssessmentSummary,
  type TeacherAssessmentWorkbenchData,
} from "./teacher-assessment-contract";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardEmptyCard,
  DashboardPage,
  DashboardTableShell,
} from "./dashboard-page";

type SaveState = "idle" | "saving" | "saved" | "error";

const OUTCOME_SHORTCUTS: Record<string, TeacherAssessmentOutcome> = {
  "1": "independent",
  "2": "prompted",
  "3": "partial",
  "4": "unable",
  "5": "not_tested",
};

export function TeacherAssessmentWorkbench({ data }: { data: TeacherAssessmentWorkbenchData }) {
  const t = useTranslations("school.teacherAssessment");
  const locale = useLocale();
  const schedule = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(data.scheduledAt)), [data.scheduledAt, locale]);
  const grade = data.gradeText || (data.grade === null ? t("gradePending") : t("gradeValue", { grade: data.grade }));

  if (!data.paperVersion) {
    return (
      <DashboardPage
        title={t("title", { name: data.subjectName })}
        description={t("choosePaperIntro")}
        meta={<span>{grade} · {schedule}{data.location ? ` · ${data.location}` : ""}</span>}
        backHref="/dashboard/assessments"
        backLabel={t("backToAggregate")}
        density="compact"
      >
        <PaperPicker registrationId={data.registrationId} options={data.paperOptions} />
      </DashboardPage>
    );
  }

  return (
    <QuestionWorkbench
      key={data.paperVersion.id}
      data={data}
      grade={grade}
      schedule={schedule}
    />
  );
}

function PaperPicker({
  registrationId,
  options,
}: {
  registrationId: string;
  options: TeacherAssessmentPaperOption[];
}) {
  const t = useTranslations("school.teacherAssessment");
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (options.length === 0) {
    return <DashboardEmptyCard>{t("noPublishedPapers")}</DashboardEmptyCard>;
  }

  return (
    <DashboardTableShell>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("paperColumn")}</TableHead>
            <TableHead className="w-28">{t("sourceColumn")}</TableHead>
            <TableHead className="w-28">{t("paperScaleColumn")}</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {options.map((option) => (
            <TableRow key={option.id}>
              <TableCell>
                <p className="font-medium text-ink">{option.title}</p>
                <p className="mt-0.5 text-xs text-muted">{t("version", { version: option.versionNo })}</p>
              </TableCell>
              <TableCell>{sourceLabel(option.source, t)}</TableCell>
              <TableCell>{t("paperScale", { questions: option.questionCount, score: option.totalScore })}</TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  disabled={pendingId !== null}
                  onClick={() => {
                    setPendingId(option.id);
                    void bindTeacherAssessmentPaperAction({
                      registrationId,
                      paperVersionId: option.id,
                    }).then((result) => {
                      if (!result.ok) {
                        toast.error(t("bindFailed"));
                        setPendingId(null);
                        return;
                      }
                      window.location.reload();
                    });
                  }}
                >
                  {pendingId === option.id ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {t("usePaper")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}

function QuestionWorkbench({
  data,
  grade,
  schedule,
}: {
  data: TeacherAssessmentWorkbenchData;
  grade: string;
  schedule: string;
}) {
  const t = useTranslations("school.teacherAssessment");
  const paper = data.paperVersion!;
  const [questions, setQuestions] = useState(data.questions);
  const questionsRef = useRef(data.questions);
  const [summary, setSummary] = useState<TeacherAssessmentSummary>(() =>
    teacherAssessmentSummary(paper, data.questions, data.completedAt));
  const [activeIndex, setActiveIndex] = useState(() => {
    const first = data.questions.findIndex((question) => !question.result?.outcome);
    return first < 0 ? 0 : first;
  });
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [observation, setObservation] = useState(data.teacherObservation);
  const [observationState, setObservationState] = useState<SaveState>("idle");
  const [completing, setCompleting] = useState(false);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const sequencesRef = useRef(new Map<string, number>());
  const observationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    if (observationTimerRef.current) clearTimeout(observationTimerRef.current);
  }, []);

  const saveQuestion = useCallback((question: TeacherAssessmentQuestion) => {
    const nextSequence = (sequencesRef.current.get(question.id) ?? 0) + 1;
    sequencesRef.current.set(question.id, nextSequence);
    setSaveStates((current) => ({ ...current, [question.id]: "saving" }));
    void saveTeacherAssessmentQuestionAction({
      registrationId: data.registrationId,
      questionId: question.id,
      outcome: question.result?.outcome ?? null,
      score: question.result?.score ?? null,
      note: question.result?.note ?? "",
    }).then((result) => {
      if (sequencesRef.current.get(question.id) !== nextSequence) return;
      if (!result.ok) {
        setSaveStates((current) => ({ ...current, [question.id]: "error" }));
        toast.error(t("questionSaveFailed", { question: question.questionNo }));
        return;
      }
      setSaveStates((current) => ({ ...current, [question.id]: "saved" }));
      setSummary((current) => ({
        ...result.data,
        completedAt: result.data.completedAt === undefined ? current.completedAt : result.data.completedAt,
      }));
    });
  }, [data.registrationId, t]);

  const queueSave = useCallback((question: TeacherAssessmentQuestion, immediate: boolean) => {
    const existing = timersRef.current.get(question.id);
    if (existing) clearTimeout(existing);
    if (immediate) {
      timersRef.current.delete(question.id);
      saveQuestion(question);
      return;
    }
    setSaveStates((current) => ({ ...current, [question.id]: "idle" }));
    const timer = setTimeout(() => {
      timersRef.current.delete(question.id);
      saveQuestion(question);
    }, 550);
    timersRef.current.set(question.id, timer);
  }, [saveQuestion]);

  const replaceQuestion = useCallback((
    questionId: string,
    update: (question: TeacherAssessmentQuestion) => TeacherAssessmentQuestion,
    immediate: boolean,
  ) => {
    const nextQuestions = questionsRef.current.map((question) => question.id === questionId ? update(question) : question);
    const changed = nextQuestions.find((question) => question.id === questionId);
    if (!changed) return;
    questionsRef.current = nextQuestions;
    setQuestions(nextQuestions);
    setSummary(teacherAssessmentSummary(paper, nextQuestions, summary.completedAt));
    queueSave(changed, immediate);
  }, [paper, queueSave, summary.completedAt]);

  const chooseOutcome = useCallback((question: TeacherAssessmentQuestion, outcome: TeacherAssessmentOutcome) => {
    replaceQuestion(question.id, (current) => {
      const selected = current.result?.outcome === outcome;
      return {
        ...current,
        result: {
          outcome: selected ? null : outcome,
          score: selected ? null : quickScoreForOutcome(current, outcome),
          note: current.result?.note ?? "",
          updatedAt: new Date().toISOString(),
        },
      };
    }, true);
    setActiveIndex((current) => Math.min(current + 1, questionsRef.current.length - 1));
  }, [replaceQuestion]);

  const updateScore = useCallback((question: TeacherAssessmentQuestion, value: string) => {
    const score = value === "" ? null : Math.max(0, Math.min(question.maxScore, Number(value)));
    replaceQuestion(question.id, (current) => ({
      ...current,
      result: {
        outcome: current.result?.outcome ?? null,
        score,
        note: current.result?.note ?? "",
        updatedAt: new Date().toISOString(),
      },
    }), false);
  }, [replaceQuestion]);

  const updateNote = useCallback((question: TeacherAssessmentQuestion, note: string) => {
    replaceQuestion(question.id, (current) => ({
      ...current,
      result: {
        outcome: current.result?.outcome ?? null,
        score: current.result?.score ?? null,
        note,
        updatedAt: new Date().toISOString(),
      },
    }), false);
  }, [replaceQuestion]);

  const onWorkspaceKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, button, [role='dialog'], [role='listbox']")) return;
    const outcome = OUTCOME_SHORTCUTS[event.key];
    if (outcome) {
      event.preventDefault();
      const question = questionsRef.current[activeIndex];
      if (question) chooseOutcome(question, outcome);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, questionsRef.current.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    }
  };

  const anySaving = observationState === "saving" || Object.values(saveStates).some((state) => state === "saving");
  const complete = summary.answeredCount === summary.questionCount;
  const pageMeta = `${grade} · ${paper.title} · ${t("version", { version: paper.versionNo })}`;

  return (
    <DashboardPage
      title={t("title", { name: data.subjectName })}
      meta={<span>{pageMeta}</span>}
      backHref="/dashboard/assessments"
      backLabel={t("backToAggregate")}
      density="compact"
      className="flex w-full min-w-0 flex-1 flex-col panel-canvas"
      bodyClassName="min-h-0 flex-1"
      contentClassName="flex min-h-0 flex-1 flex-col"
      commandPanel={(
        <DashboardCommandPanel className="min-h-12 py-1.5">
          <DashboardCommandState className="gap-1.5">
            <SummaryBadge label={t("progress")} value={`${summary.answeredCount}/${summary.questionCount}`} />
            <SummaryBadge label={t("score")} value={`${summary.score}/${summary.totalScore}`} />
            <SummaryBadge
              label={t("suggestedBand")}
              value={summary.suggestedBand ? t(`band_${summary.suggestedBand}`) : "-"}
            />
            <Badge variant="outline" className="h-7 gap-1 px-2 text-[11px]">
              {anySaving ? <LoaderCircle className="size-3 animate-spin" /> : <CircleCheck className="size-3" />}
              {anySaving ? t("saving") : t("autosaved")}
            </Badge>
          </DashboardCommandState>
          <DashboardCommandFilters className="min-w-0 flex-1">
            <Input
              value={observation}
              maxLength={3000}
              className="h-8 min-w-48 flex-1 text-xs"
              placeholder={t("overallObservationPlaceholder")}
              aria-label={t("overallObservation")}
              onChange={(event) => {
                const next = event.target.value;
                setObservation(next);
                setObservationState("idle");
                if (observationTimerRef.current) clearTimeout(observationTimerRef.current);
                observationTimerRef.current = setTimeout(() => {
                  setObservationState("saving");
                  void saveTeacherAssessmentObservationAction({
                    registrationId: data.registrationId,
                    observation: next,
                  }).then((result) => {
                    if (!result.ok) {
                      setObservationState("error");
                      toast.error(t("observationSaveFailed"));
                      return;
                    }
                    setObservationState("saved");
                  });
                }, 650);
              }}
            />
          </DashboardCommandFilters>
          <DashboardCommandActions>
            <Button
              type="button"
              size="sm"
              className="h-8 px-3 text-xs"
              disabled={!complete || anySaving || completing || Boolean(summary.completedAt)}
              title={!complete ? t("completeDisabled", { count: summary.questionCount - summary.answeredCount }) : undefined}
              onClick={() => {
                setCompleting(true);
                void completeTeacherAssessmentAction(data.registrationId).then((result) => {
                  setCompleting(false);
                  if (!result.ok) {
                    toast.error(t("completeFailed"));
                    return;
                  }
                  setSummary(result.data);
                  toast.success(t("completeSuccess"));
                });
              }}
            >
              {completing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {summary.completedAt ? t("completed") : t("complete")}
            </Button>
          </DashboardCommandActions>
        </DashboardCommandPanel>
      )}
    >
      <div
        className="flex min-h-0 flex-1 flex-col outline-none"
        tabIndex={0}
        onKeyDown={onWorkspaceKeyDown}
        aria-label={t("workspaceLabel")}
      >
        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-[11px] text-muted">
          <p className="truncate">{schedule}{data.location ? ` · ${data.location}` : ""}{data.background ? ` · ${data.background}` : ""}</p>
          <p className="hidden shrink-0 md:block">{t("keyboardHint")}</p>
        </div>

        <DesktopQuestionTable
          questions={questions}
          activeIndex={activeIndex}
          saveStates={saveStates}
          onActivate={setActiveIndex}
          onOutcome={chooseOutcome}
          onScore={updateScore}
          onNote={updateNote}
          onRetry={saveQuestion}
        />
        <MobileQuestionList
          questions={questions}
          activeIndex={activeIndex}
          saveStates={saveStates}
          onActivate={setActiveIndex}
          onOutcome={chooseOutcome}
          onScore={updateScore}
          onNote={updateNote}
          onRetry={saveQuestion}
        />
      </div>
    </DashboardPage>
  );
}

interface QuestionListProps {
  questions: TeacherAssessmentQuestion[];
  activeIndex: number;
  saveStates: Record<string, SaveState>;
  onActivate: (index: number) => void;
  onOutcome: (question: TeacherAssessmentQuestion, outcome: TeacherAssessmentOutcome) => void;
  onScore: (question: TeacherAssessmentQuestion, value: string) => void;
  onNote: (question: TeacherAssessmentQuestion, note: string) => void;
  onRetry: (question: TeacherAssessmentQuestion) => void;
}

function DesktopQuestionTable(props: QuestionListProps) {
  const t = useTranslations("school.teacherAssessment");
  return (
    <DashboardTableShell className="hidden min-h-0 flex-1 md:block">
      <Table className="min-w-[690px] table-fixed text-[11px]" containerClassName="h-full overflow-auto">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky top-0 z-20 h-7 w-10 bg-card px-1 text-center">{t("numberColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-7 w-[22%] bg-card px-1">{t("questionColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-7 w-[35%] bg-card px-1">{t("resultColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-7 w-20 bg-card px-1">{t("scoreColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-7 bg-card px-1">{t("noteColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-7 w-7 bg-card px-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.questions.map((question, index) => (
            <TableRow
              key={question.id}
              data-active={props.activeIndex === index ? "true" : undefined}
              className={cn("h-7 cursor-default", props.activeIndex === index && "bg-moon/15 hover:bg-moon/15")}
              onClick={() => props.onActivate(index)}
            >
              <TableCell className="h-7 px-1 py-0 text-center font-mono text-[10px] text-muted">{question.questionNo}</TableCell>
              <TableCell className="h-7 px-1 py-0">
                <p className="truncate text-[11px] text-ink" title={[question.prompt, question.knowledgePoint].filter(Boolean).join(" · ")}>
                  {question.prompt || t("questionFallback", { question: question.questionNo })}
                  {question.knowledgePoint ? <span className="text-muted"> · {question.knowledgePoint}</span> : null}
                </p>
              </TableCell>
              <TableCell className="h-7 px-1 py-0" onClick={(event) => event.stopPropagation()}>
                <OutcomeButtons question={question} onSelect={(outcome) => props.onOutcome(question, outcome)} compact />
              </TableCell>
              <TableCell className="h-7 px-1 py-0" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center gap-0.5">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={question.maxScore}
                    value={question.result?.score ?? ""}
                    disabled={!question.result?.outcome || question.result.outcome === "not_tested"}
                    aria-label={t("questionScore", { question: question.questionNo })}
                    className="h-6 min-w-0 rounded-md px-1 text-right font-mono text-[11px]"
                    onChange={(event) => props.onScore(question, event.target.value)}
                  />
                  <span className="shrink-0 font-mono text-[9px] text-muted">/{question.maxScore}</span>
                </div>
              </TableCell>
              <TableCell className="h-7 px-1 py-0" onClick={(event) => event.stopPropagation()}>
                <Input
                  value={question.result?.note ?? ""}
                  maxLength={1000}
                  className="h-6 rounded-md px-1.5 text-[11px]"
                  placeholder={t("notePlaceholder")}
                  aria-label={t("questionNote", { question: question.questionNo })}
                  onFocus={() => props.onActivate(index)}
                  onChange={(event) => props.onNote(question, event.target.value)}
                />
              </TableCell>
              <TableCell className="h-7 px-0 py-0 text-center">
                <QuestionSaveState state={props.saveStates[question.id] ?? "idle"} onRetry={() => props.onRetry(question)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}

function MobileQuestionList(props: QuestionListProps) {
  const t = useTranslations("school.teacherAssessment");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line md:hidden">
      {props.questions.map((question, index) => (
        <section
          key={question.id}
          className={cn("border-b border-line p-3 last:border-b-0", props.activeIndex === index && "bg-moon/10")}
          onClick={() => props.onActivate(index)}
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{t("questionTitle", { question: question.questionNo })}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">{question.prompt || t("questionFallback", { question: question.questionNo })}</p>
              {question.knowledgePoint ? <p className="mt-0.5 text-[11px] text-muted">{question.knowledgePoint}</p> : null}
            </div>
            <QuestionSaveState state={props.saveStates[question.id] ?? "idle"} onRetry={() => props.onRetry(question)} />
          </div>
          <div className="mt-2" onClick={(event) => event.stopPropagation()}>
            <OutcomeButtons question={question} onSelect={(outcome) => props.onOutcome(question, outcome)} />
          </div>
          <div className="mt-2 grid grid-cols-[6rem_minmax(0,1fr)] gap-2" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={question.maxScore}
                value={question.result?.score ?? ""}
                disabled={!question.result?.outcome || question.result.outcome === "not_tested"}
                aria-label={t("questionScore", { question: question.questionNo })}
                className="h-8 min-w-0 px-2 text-right font-mono text-xs"
                onChange={(event) => props.onScore(question, event.target.value)}
              />
              <span className="font-mono text-[10px] text-muted">/{question.maxScore}</span>
            </div>
            <Textarea
              value={question.result?.note ?? ""}
              maxLength={1000}
              className="min-h-8 resize-y py-1.5 text-xs"
              placeholder={t("notePlaceholder")}
              aria-label={t("questionNote", { question: question.questionNo })}
              onChange={(event) => props.onNote(question, event.target.value)}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function OutcomeButtons({
  question,
  onSelect,
  compact = false,
}: {
  question: TeacherAssessmentQuestion;
  onSelect: (outcome: TeacherAssessmentOutcome) => void;
  compact?: boolean;
}) {
  const t = useTranslations("school.teacherAssessment");
  return (
    <div className={cn("grid grid-cols-5 gap-1", compact && "gap-0.5")}>
      {TEACHER_ASSESSMENT_OUTCOMES.map((outcome, index) => {
        const selected = question.result?.outcome === outcome;
        return (
          <Button
            key={outcome}
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={selected}
            title={`${index + 1} · ${t(`outcome_${outcome}`)}`}
            className={cn(
              compact ? "h-6 min-w-0 rounded-md px-1 text-[10px]" : "h-8 min-w-0 rounded-lg px-1 text-[11px]",
              selected && outcome === "independent" && "border-leaf-deep bg-leaf/45 text-ink",
              selected && outcome === "prompted" && "border-crater bg-moon/55 text-ink",
              selected && outcome === "partial" && "border-crater bg-crater/20 text-ink",
              selected && outcome === "unable" && "border-rose/60 bg-rose/15 text-rose",
              selected && outcome === "not_tested" && "border-muted/50 bg-line/70 text-ink",
            )}
            onClick={() => onSelect(outcome)}
          >
            <span className="font-mono text-[9px] opacity-70">{index + 1}</span>
            <span className="truncate">{t(`outcomeShort_${outcome}`)}</span>
          </Button>
        );
      })}
    </div>
  );
}

function SummaryBadge({ label, value }: { label: string; value: string }) {
  return (
    <Badge variant="outline" className="h-7 gap-1 px-2 text-[11px]">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </Badge>
  );
}

function QuestionSaveState({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const t = useTranslations("school.teacherAssessment");
  if (state === "saving") return <LoaderCircle className="mx-auto size-3 animate-spin text-muted" aria-label={t("saving")} />;
  if (state === "saved") return <CircleCheck className="mx-auto size-3 text-leaf-deep" aria-label={t("saved")} />;
  if (state === "error") {
    return (
      <button type="button" className="mx-auto block text-rose" title={t("retry")} onClick={(event) => { event.stopPropagation(); onRetry(); }}>
        <CircleAlert className="size-3" />
      </button>
    );
  }
  return <CircleDashed className="mx-auto size-3 text-line" aria-hidden />;
}

function sourceLabel(source: string, t: ReturnType<typeof useTranslations<"school.teacherAssessment">>) {
  if (source === "aixuexi") return t("source_aixuexi");
  if (source === "mofaxiao") return t("source_mofaxiao");
  if (source === "internal") return t("source_internal");
  return source;
}
