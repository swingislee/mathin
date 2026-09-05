"use client";

import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  LoaderCircle,
  MessageSquareText,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
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
  fillTeacherAssessmentQuestionsAction,
  saveTeacherAssessmentObservationAction,
  saveTeacherAssessmentQuestionAction,
  undoTeacherAssessmentQuestionFillAction,
} from "./teacher-assessment-actions";
import {
  quickScoreForOutcome,
  teacherAssessmentSummary,
  type TeacherAssessmentOutcome,
  type TeacherAssessmentPaperOption,
  type TeacherAssessmentQuestion,
  type TeacherAssessmentSummary,
  type TeacherAssessmentWorkbenchData,
} from "./teacher-assessment-contract";
import {
  LearningCheckMatrixEntry,
  type LearningCheckMatrixCell,
} from "./LearningCheckMatrixEntry";
import type { LearningCheckStatus } from "./session-learning-contract";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardEmptyCard,
  DashboardPage,
  DashboardTableShell,
} from "./dashboard-page";

type SaveState = "idle" | "queued" | "saving" | "saved" | "error";

interface AssessmentFillUndo {
  questionIds: string[];
  outcome: TeacherAssessmentOutcome;
}

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
        backHref="/dashboard/followups/assessments"
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
  const [fillPending, setFillPending] = useState(false);
  const [fillUndo, setFillUndo] = useState<AssessmentFillUndo | null>(null);
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
      setSaveStates((current) => ({
        ...current,
        [question.id]: timersRef.current.has(question.id) ? "queued" : "saved",
      }));
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
    setSaveStates((current) => ({ ...current, [question.id]: "queued" }));
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

  const chooseOutcome = useCallback((question: TeacherAssessmentQuestion, status: LearningCheckStatus) => {
    const outcome: TeacherAssessmentOutcome | null = status === "unchecked" ? null : status;
    replaceQuestion(question.id, (current) => {
      return {
        ...current,
        result: {
          outcome,
          score: outcome ? quickScoreForOutcome(current, outcome) : null,
          note: current.result?.note ?? "",
          updatedAt: new Date().toISOString(),
        },
      };
    }, true);
    if (outcome) {
      setActiveIndex((current) => Math.min(current + 1, questionsRef.current.length - 1));
    }
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

  const questionSavePending = Object.values(saveStates).some((state) => state === "queued" || state === "saving");
  const canUndoFill = Boolean(
    !summary.completedAt
    && fillUndo
    && fillUndo.questionIds.some((questionId) => (
      questions.find((question) => question.id === questionId)?.result?.outcome === fillUndo.outcome
    )),
  );

  const fillUnansweredQuestions = (
    cells: Array<LearningCheckMatrixCell<null, TeacherAssessmentQuestion>>,
    status: Exclude<LearningCheckStatus, "unchecked">,
  ) => {
    if (fillPending || questionSavePending) return;
    const outcome: TeacherAssessmentOutcome = status;
    const requestedQuestionIds = new Set(cells.map((cell) => cell.question.id));
    const targets = questionsRef.current.filter((question) => (
      requestedQuestionIds.has(question.id) && !question.result?.outcome
    ));
    if (targets.length === 0) return;
    const questionIds = targets.map((question) => question.id);
    const targetIds = new Set(questionIds);
    const previousResults = new Map(targets.map((question) => [question.id, question.result] as const));
    const optimisticQuestions = questionsRef.current.map((question) => targetIds.has(question.id)
      ? {
          ...question,
          result: {
            outcome,
            score: quickScoreForOutcome(question, outcome),
            note: question.result?.note ?? "",
            updatedAt: new Date().toISOString(),
          },
        }
      : question);

    questionsRef.current = optimisticQuestions;
    setQuestions(optimisticQuestions);
    setSummary((current) => teacherAssessmentSummary(paper, optimisticQuestions, current.completedAt));
    setFillPending(true);
    setSaveStates((current) => ({
      ...current,
      ...Object.fromEntries(questionIds.map((questionId) => [questionId, "saving" as const])),
    }));

    void fillTeacherAssessmentQuestionsAction({
      registrationId: data.registrationId,
      questionIds,
      outcome,
    }).then((result) => {
      setFillPending(false);
      if (!result.ok) {
        const restoredQuestions = questionsRef.current.map((question) => (
          targetIds.has(question.id) && question.result?.outcome === outcome
            ? { ...question, result: previousResults.get(question.id) ?? null }
            : question
        ));
        questionsRef.current = restoredQuestions;
        setQuestions(restoredQuestions);
        setSummary((current) => teacherAssessmentSummary(paper, restoredQuestions, current.completedAt));
        setSaveStates((current) => ({
          ...current,
          ...Object.fromEntries(questionIds.map((questionId) => [questionId, "idle" as const])),
        }));
        toast.error(t("fillFailed"));
        return;
      }

      const filledIds = new Set(result.data.questionIds);
      const reconciledQuestions = questionsRef.current.map((question) => (
        targetIds.has(question.id) && !filledIds.has(question.id)
          ? { ...question, result: previousResults.get(question.id) ?? null }
          : question
      ));
      questionsRef.current = reconciledQuestions;
      setQuestions(reconciledQuestions);
      setSummary(result.data);
      setSaveStates((current) => ({
        ...current,
        ...Object.fromEntries(questionIds.map((questionId) => [
          questionId,
          filledIds.has(questionId) ? "saved" as const : "idle" as const,
        ])),
      }));
      setFillUndo(result.data.questionIds.length > 0
        ? { questionIds: result.data.questionIds, outcome }
        : null);
      if (result.data.questionIds.length > 0) {
        toast.success(t("fillSaved", { count: result.data.questionIds.length }));
      }
    });
  };

  const undoLastQuestionFill = () => {
    if (!fillUndo || fillPending || questionSavePending || summary.completedAt) return;
    const eligibleQuestions = questionsRef.current.filter((question) => (
      fillUndo.questionIds.includes(question.id) && question.result?.outcome === fillUndo.outcome
    ));
    if (eligibleQuestions.length === 0) {
      setFillUndo(null);
      return;
    }
    const questionIds = eligibleQuestions.map((question) => question.id);
    const targetIds = new Set(questionIds);
    const previousResults = new Map(eligibleQuestions.map((question) => [question.id, question.result] as const));
    const optimisticQuestions = questionsRef.current.map((question) => targetIds.has(question.id)
      ? {
          ...question,
          result: {
            outcome: null,
            score: null,
            note: question.result?.note ?? "",
            updatedAt: new Date().toISOString(),
          },
        }
      : question);

    questionsRef.current = optimisticQuestions;
    setQuestions(optimisticQuestions);
    setSummary((current) => teacherAssessmentSummary(paper, optimisticQuestions, current.completedAt));
    setFillPending(true);
    setSaveStates((current) => ({
      ...current,
      ...Object.fromEntries(questionIds.map((questionId) => [questionId, "saving" as const])),
    }));

    void undoTeacherAssessmentQuestionFillAction({
      registrationId: data.registrationId,
      questionIds,
      outcome: fillUndo.outcome,
    }).then((result) => {
      setFillPending(false);
      if (!result.ok) {
        const restoredQuestions = questionsRef.current.map((question) => targetIds.has(question.id)
          ? { ...question, result: previousResults.get(question.id) ?? null }
          : question);
        questionsRef.current = restoredQuestions;
        setQuestions(restoredQuestions);
        setSummary((current) => teacherAssessmentSummary(paper, restoredQuestions, current.completedAt));
        setSaveStates((current) => ({
          ...current,
          ...Object.fromEntries(questionIds.map((questionId) => [questionId, "saved" as const])),
        }));
        toast.error(t("fillUndoFailed"));
        return;
      }

      const restoredIds = new Set(result.data.questionIds);
      const reconciledQuestions = questionsRef.current.map((question) => (
        targetIds.has(question.id) && !restoredIds.has(question.id)
          ? { ...question, result: previousResults.get(question.id) ?? null }
          : question
      ));
      questionsRef.current = reconciledQuestions;
      setQuestions(reconciledQuestions);
      setSummary(result.data);
      setSaveStates((current) => ({
        ...current,
        ...Object.fromEntries(questionIds.map((questionId) => [
          questionId,
          restoredIds.has(questionId) ? "saved" as const : "idle" as const,
        ])),
      }));
      setFillUndo(null);
      const firstRestoredIndex = reconciledQuestions.findIndex((question) => restoredIds.has(question.id));
      if (firstRestoredIndex >= 0) setActiveIndex(firstRestoredIndex);
      if (result.data.questionIds.length > 0) {
        toast.success(t("fillUndone", { count: result.data.questionIds.length }));
      }
    });
  };

  const anySaving = observationState === "saving" || questionSavePending || fillPending;
  const complete = summary.answeredCount === summary.questionCount;
  const pageMeta = `${grade} · ${paper.title} · ${t("version", { version: paper.versionNo })}`;

  return (
    <DashboardPage
      title={t("title", { name: data.subjectName })}
      meta={<span>{pageMeta}</span>}
      backHref="/dashboard/followups/assessments"
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
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-[11px] text-muted">
          <p className="truncate">{schedule}{data.location ? ` · ${data.location}` : ""}{data.background ? ` · ${data.background}` : ""}</p>
          <p className="hidden shrink-0 md:block">{t("keyboardHint")}</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col" data-teacher-assessment-entry-surface>
          <LearningCheckMatrixEntry
            students={[{
              id: data.registrationId,
              label: grade,
              data: null,
            }]}
            questions={questions.map((question, index) => ({
              id: question.id,
              label: t("questionTitle", { question: question.questionNo }),
              slot: index,
              data: question,
            }))}
            orientation="by-student"
            activeStudentId={data.registrationId}
            activeQuestionId={questions[activeIndex]?.id ?? null}
            onActiveStudentChange={() => undefined}
            onActiveQuestionChange={(questionId) => {
              const index = questions.findIndex((question) => question.id === questionId);
              if (index >= 0) setActiveIndex(index);
            }}
            statusFor={(_studentId, questionId) => (
              questions.find((question) => question.id === questionId)?.result?.outcome ?? "unchecked"
            )}
            onStatusChange={(cell, status) => chooseOutcome(cell.question.data, status)}
            isCellPending={(cell) => (
              fillPending || saveStates[cell.question.id] === "saving"
            )}
            mobileChoiceDisplay="label"
            getCardProps={(cell) => ({
              "data-teacher-assessment-question": cell.question.data.questionNo,
            } as HTMLAttributes<HTMLElement>)}
            renderCardHeader={(cell) => {
              const question = cell.question.data;
              const outcome = question.result?.outcome ?? null;
              const visualStyle = LEARNING_CHECK_STATUS_STYLE[cell.status];
              return (
                <div className="flex min-h-8 items-center gap-1 px-1" data-teacher-assessment-question-header>
                  <span className="w-6 shrink-0 text-center font-mono text-[10px] text-muted">{question.questionNo}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink" title={[question.knowledgePoint, question.prompt].filter(Boolean).join(" · ")}>
                    {question.knowledgePoint || question.prompt || t("questionFallback", { question: question.questionNo })}
                  </span>
                  {outcome ? (
                    <span className={cn("shrink-0 text-[10px] font-medium", visualStyle.icon)}>
                      {t(`outcomeShort_${outcome}`)}
                    </span>
                  ) : null}
                  {question.result?.note ? <MessageSquareText className="size-3 shrink-0 text-muted" aria-hidden /> : null}
                  <span className="shrink-0 font-mono text-[9px] text-muted">
                    {question.result?.score ?? "–"}/{question.maxScore}
                  </span>
                  <QuestionSaveState state={saveStates[question.id] ?? "idle"} onRetry={() => saveQuestion(question)} />
                </div>
              );
            }}
            renderMobileHeader={(cell) => {
              const question = cell.question.data;
              return (
                <div className="flex min-w-0 items-start justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{t("questionTitle", { question: question.questionNo })}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">{question.prompt || t("questionFallback", { question: question.questionNo })}</p>
                    {question.knowledgePoint ? <p className="mt-0.5 text-[11px] text-muted">{question.knowledgePoint}</p> : null}
                  </div>
                  <QuestionSaveState state={saveStates[question.id] ?? "idle"} onRetry={() => saveQuestion(question)} />
                </div>
              );
            }}
            renderMobileDetails={(cell) => {
              const question = cell.question.data;
              return (
                <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 px-1">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={question.maxScore}
                      value={question.result?.score ?? ""}
                      disabled={fillPending || !question.result?.outcome}
                      aria-label={t("questionScore", { question: question.questionNo })}
                      className="h-8 min-w-0 px-2 text-right font-mono text-xs"
                      onChange={(event) => updateScore(question, event.target.value)}
                    />
                    <span className="font-mono text-[10px] text-muted">/{question.maxScore}</span>
                  </div>
                  <Textarea
                    value={question.result?.note ?? ""}
                    disabled={fillPending}
                    maxLength={1000}
                    className="min-h-8 resize-y py-1.5 text-xs"
                    placeholder={t("notePlaceholder")}
                    aria-label={t("questionNote", { question: question.questionNo })}
                    onChange={(event) => updateNote(question, event.target.value)}
                  />
                </div>
              );
            }}
            renderActiveEditor={({ activeQuestion }) => {
              const question = activeQuestion?.data;
              if (!question) return null;
              return (
                <div
                  className="mb-1 hidden shrink-0 grid-cols-[minmax(0,1fr)_6rem_minmax(12rem,0.85fr)] items-center gap-2 border-b border-line/70 pb-1 sm:grid"
                  data-teacher-assessment-active-editor
                >
                  <p className="min-w-0 truncate text-xs text-ink" title={[question.prompt, question.knowledgePoint].filter(Boolean).join(" · ")}>
                    <span className="font-medium">{t("questionTitle", { question: question.questionNo })}</span>
                    {question.knowledgePoint ? <span className="text-muted"> · {question.knowledgePoint}</span> : null}
                    <span className="text-muted"> · {question.prompt || t("questionFallback", { question: question.questionNo })}</span>
                  </p>
                  <div className="flex min-w-0 items-center gap-1">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={question.maxScore}
                      value={question.result?.score ?? ""}
                      disabled={fillPending || !question.result?.outcome}
                      aria-label={t("questionScore", { question: question.questionNo })}
                      className="h-8 min-w-0 px-2 text-right font-mono text-xs"
                      onChange={(event) => updateScore(question, event.target.value)}
                    />
                    <span className="shrink-0 font-mono text-[10px] text-muted">/{question.maxScore}</span>
                  </div>
                  <Input
                    value={question.result?.note ?? ""}
                    disabled={fillPending}
                    maxLength={1000}
                    className="h-8 min-w-0 px-2 text-xs"
                    placeholder={t("notePlaceholder")}
                    aria-label={t("questionNote", { question: question.questionNo })}
                    onChange={(event) => updateNote(question, event.target.value)}
                  />
                </div>
              );
            }}
            fill={{
              pending: fillPending || questionSavePending,
              canUndo: canUndoFill,
              onFill: fillUnansweredQuestions,
              onUndo: undoLastQuestionFill,
              labels: (remainingCount) => ({
                rail: t("fillRail"),
                remaining: t("fillRemaining", { count: remainingCount }),
                complete: t("fillComplete"),
                action: (status) => t("fillAction", { count: remainingCount, status }),
                undo: t("fillUndo"),
              }),
            }}
          />
        </div>
      </div>
    </DashboardPage>
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
  if (state === "queued" || state === "saving") return <LoaderCircle className="mx-auto size-3 animate-spin text-muted" aria-label={t("saving")} />;
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
