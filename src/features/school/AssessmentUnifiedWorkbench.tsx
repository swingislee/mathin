"use client";

import { Fragment, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  UserCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { DashboardInlineEntry } from "./dashboard-page/DashboardInlineEntry";
import { Link } from "@/i18n/navigation";
import { PostActivityHandoff } from "./EnrollmentHandoffButton";
import { reassignAssessmentAssessorAction } from "./assessment-assessor-actions";
import {
  type ActivityRouteKind,
} from "./activity-workflow-contract";
import {
  ASSESSMENT_WORKBENCH_QUEUES,
  assessmentWorkbenchStage,
  type AssessmentWorkbenchQueue,
  type AssessmentWorkbenchRow,
} from "./assessment-workbench-contract";
import {
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardEmptyCard,
  DashboardPage,
  DashboardTableShell,
} from "./dashboard-page";
import type { InvitationAssessorOption } from "./invitation-contract";
import { LearningCheckStatusIcon } from "./LearningCheckStatusIcon";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";
import { TEACHER_ASSESSMENT_OUTCOMES } from "./teacher-assessment-contract";
import { TeacherAssessmentEntryButton } from "./TeacherAssessmentEntryButton";

interface SupportDraft {
  route: ActivityRouteKind | null;
}


const QUEUE_LABEL_KEYS: Record<AssessmentWorkbenchQueue, string> = {
  pending: "queue_assessment_pending",
  in_progress: "queue_in_progress",
  feedback: "queue_pending",
  handled: "queue_handled",
  all: "queue_all",
};

function draftFromRow(row: AssessmentWorkbenchRow): SupportDraft {
  return {
    route: row.route?.route ?? null,
  };
}

function queueFor(
  row: AssessmentWorkbenchRow,
  draft: SupportDraft,
): Exclude<AssessmentWorkbenchQueue, "all"> {
  const stage = assessmentWorkbenchStage(row);
  if (stage === "feedback" || stage === "handled") {
    return draft.route ? "handled" : "feedback";
  }
  return stage;
}

function defaultQueue(
  rows: readonly AssessmentWorkbenchRow[],
  drafts: Readonly<Record<string, SupportDraft>>,
  canSupport: boolean,
): AssessmentWorkbenchQueue {
  if (canSupport && rows.some((row) => queueFor(row, drafts[row.id]) === "feedback")) return "feedback";
  if (rows.some((row) => queueFor(row, drafts[row.id]) === "pending")) return "pending";
  if (rows.some((row) => queueFor(row, drafts[row.id]) === "in_progress")) return "in_progress";
  if (rows.some((row) => queueFor(row, drafts[row.id]) === "handled")) return "handled";
  return "all";
}

export function AssessmentUnifiedWorkbench({
  initialRows,
  assessors,
  locale,
  canAssess,
  canSupport,
  canManageAssessor,
}: {
  initialRows: AssessmentWorkbenchRow[];
  assessors: InvitationAssessorOption[];
  locale: string;
  canAssess: boolean;
  canSupport: boolean;
  canManageAssessor: boolean;
}) {
  const t = useTranslations("school.supportAssessment");
  const hubT = useTranslations("school.assessmentHub");
  const assessmentT = useTranslations("school.assessments");
  const teacherT = useTranslations("school.teacherAssessment");
  const sessionT = useTranslations("school.session");
  const initialDrafts = useMemo(() => Object.fromEntries(
    initialRows.map((row) => [row.id, draftFromRow(row)]),
  ), [initialRows]);
  const initialQueue = useMemo(
    () => defaultQueue(initialRows, initialDrafts, canSupport),
    [canSupport, initialDrafts, initialRows],
  );
  const [rows, setRows] = useState(initialRows);
  const [drafts, setDrafts] = useState<Record<string, SupportDraft>>(initialDrafts);
  const [queue, setQueue] = useState<AssessmentWorkbenchQueue>(initialQueue);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(
    initialRows.find((row) => queueFor(row, initialDrafts[row.id]) === initialQueue)?.id
      ?? initialRows[0]?.id
      ?? null,
  );
  const [retainedId, setRetainedId] = useState<string | null>(null);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const dateTime = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }), [locale]);

  const counts = useMemo(() => ({
    pending: rows.filter((row) => queueFor(row, drafts[row.id]) === "pending").length,
    in_progress: rows.filter((row) => queueFor(row, drafts[row.id]) === "in_progress").length,
    feedback: rows.filter((row) => queueFor(row, drafts[row.id]) === "feedback").length,
    handled: rows.filter((row) => queueFor(row, drafts[row.id]) === "handled").length,
    all: rows.length,
  }), [drafts, rows]);
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return rows.filter((row) => {
      const draft = drafts[row.id];
      const inQueue = queue === "all" || queueFor(row, draft) === queue || row.id === retainedId;
      if (!inQueue) return false;
      if (!needle) return true;
      const assessment = row.assessment;
      return [
        row.name,
        row.phone,
        row.gradeText,
        row.location,
        row.assessorName,
        row.background,
        assessment?.teacherObservation ?? "",
        assessment?.teacherRecommendation ?? "",
      ].some((value) => value.toLocaleLowerCase(locale).includes(needle));
    });
  }, [drafts, locale, query, queue, retainedId, rows]);

  const updateDraft = (id: string, update: (draft: SupportDraft) => SupportDraft) => {
    setDrafts((current) => ({ ...current, [id]: update(current[id]) }));
  };
  const chooseQueue = (nextQueue: AssessmentWorkbenchQueue) => {
    setQueue(nextQueue);
    setRetainedId(null);
    setActiveId(rows.find((row) => nextQueue === "all" || queueFor(row, drafts[row.id]) === nextQueue)?.id ?? null);
  };
  const reassignAssessor = (row: AssessmentWorkbenchRow, assessorId: string) => {
    if (!row.invitationId || assessorId === row.assessorId) return;
    const option = assessors.find((candidate) => candidate.userId === assessorId);
    if (!option) return;
    const previous = { assessorId: row.assessorId, assessorName: row.assessorName };
    setReassigningId(row.id);
    setRows((current) => current.map((candidate) => candidate.id === row.id ? {
      ...candidate,
      assessorId,
      assessorName: option.displayName,
      assessorSource: "assigned",
      updatedAt: new Date().toISOString(),
    } : candidate));
    void reassignAssessmentAssessorAction(row.invitationId, assessorId).then((result) => {
      setReassigningId(null);
      if (result.ok) {
        toast.success(t("reassignSuccess", { assessor: option.displayName }));
        return;
      }
      setRows((current) => current.map((candidate) => candidate.id === row.id ? {
        ...candidate,
        assessorId: previous.assessorId,
        assessorName: previous.assessorName,
      } : candidate));
      toast.error(t("reassignFailed"));
    });
  };

  return (
    <DashboardPage
      title={hubT("title")}
      eyebrow={hubT("sharedDesk")}
      description={t("unifiedIntro")}
      meta={t("liveQueueMeta")}
      density="compact"
      commandPanel={(
        <DashboardCommandPanel>
          <DashboardCommandState>
            <Tabs value={queue} onValueChange={(value) => chooseQueue(value as AssessmentWorkbenchQueue)} aria-label={t("unifiedQueueLabel")}>
              <TabsList className="h-9 p-0.5">
                {ASSESSMENT_WORKBENCH_QUEUES.map((item) => (
                  <TabsTrigger key={item} value={item} className="h-8 gap-1.5 px-2.5 text-xs">
                    {t(QUEUE_LABEL_KEYS[item])}
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-line/70 px-1.5 text-[10px] leading-5 text-ink">
                      {counts[item]}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </DashboardCommandState>
          <DashboardCommandFilters>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 min-w-56 max-w-xl flex-1 text-xs"
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
            />
          </DashboardCommandFilters>

        </DashboardCommandPanel>
      )}
    >
      {visibleRows.length === 0 ? <DashboardEmptyCard>{t("empty")}</DashboardEmptyCard> : (
        <DashboardTableShell data-assessment-unified-workbench>
          <Table className="min-w-[86rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-13rem)] overflow-auto">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 top-0 z-30 h-9 w-56 border-r border-line bg-card px-2">{t("studentColumn")}</TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-64 bg-card px-2">{t("arrangementColumn")}</TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-48 bg-card px-2">{t("resultColumn")}</TableHead>
                <TableHead className="sticky top-0 z-20 h-9 bg-card px-2">{t("teacherColumn")}</TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-48 bg-card px-2">{t("statusColumn")}</TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-28 bg-card px-2">{t("updatedColumn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const draft = drafts[row.id];
                const active = row.id === activeId;
                const stage = queueFor(row, draft);
                const completed = stage === "feedback" || stage === "handled";
                const conclusion = row.assessment?.teacherObservation
                  || row.assessment?.teacherRecommendation
                  || row.assessment?.strengths
                  || "";
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      aria-expanded={active}
                      aria-selected={active}
                      className={cn("cursor-pointer", active && "bg-moon/10 hover:bg-moon/10")}
                      onClick={() => setActiveId((current) => current === row.id ? null : row.id)}
                      data-assessment-workbench-row={row.id}
                    >
                      <TableCell
                        className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2"
                        style={active ? { backgroundColor: "color-mix(in srgb, var(--card) 90%, var(--moon))" } : undefined}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          {active ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted" />}
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              {row.studentId ? (
                                <Link
                                  href={`/dashboard/students/${row.studentId}`}
                                  className="truncate font-medium text-ink hover:underline"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {row.name}
                                </Link>
                              ) : <span className="truncate font-medium text-ink">{row.name}</span>}
                              <span className="shrink-0 text-[11px] text-muted">
                                {row.gradeText || (row.grade ? assessmentT("gradeValue", { grade: row.grade }) : assessmentT("gradePending"))}
                              </span>
                            </div>
                            {row.phone ? <a href={`tel:${row.phone}`} className="mt-0.5 block font-mono text-[11px] text-muted hover:underline" onClick={(event) => event.stopPropagation()}>{row.phone}</a> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <p className="truncate whitespace-nowrap font-medium text-ink">
                          {dateTime.format(new Date(row.scheduledAt))} · {row.location || assessmentT("locationPending")}
                        </p>
                        <div className="mt-1" onClick={(event) => event.stopPropagation()}>
                          {completed || !canManageAssessor || !row.invitationId ? (
                            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                              {row.assessorSource === "actual" ? <UserCheck className="size-3.5 shrink-0 text-leaf-deep" /> : null}
                              <span className="shrink-0">{t(row.assessorSource === "actual" ? "actualAssessor" : "assignedAssessor")}</span>
                              <span className="truncate font-medium text-ink">{row.assessorName || t("assessorPending")}</span>
                            </div>
                          ) : (
                            <Select
                              value={row.assessorId ?? undefined}
                              disabled={reassigningId === row.id}
                              onValueChange={(value) => reassignAssessor(row, value)}
                            >
                              <SelectTrigger
                                className="h-7 w-full border-dashed px-2 text-[11px] shadow-none hover:translate-y-0"
                                aria-label={t("changeAssessorFor", { name: row.name })}
                                data-assessor-reassignment={row.id}
                              >
                                <SelectValue placeholder={t("assessorPending")} />
                              </SelectTrigger>
                              <SelectContent>
                                {assessors.map((assessor) => (
                                  <SelectItem key={assessor.userId} value={assessor.userId} className="text-xs">
                                    {assessor.displayName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {completed && row.assessment?.score !== null && row.assessment?.score !== undefined ? (
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                              {row.questionSummary
                                ? t("scoreValue", { score: row.assessment.score, total: row.questionSummary.totalScore })
                                : t("scoreOnly", { score: row.assessment.score })}
                            </span>
                            {row.assessment.assessmentBand ? (
                              <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300">
                                {teacherT(`band_${row.assessment.assessmentBand}`)}
                              </Badge>
                            ) : null}
                          </div>
                        ) : row.questionSummary ? (
                          <p className="font-medium tabular-nums text-ink">{t("progressValue", {
                            answered: row.questionSummary.answeredCount,
                            total: row.questionSummary.questionCount,
                          })}</p>
                        ) : <p className="font-medium text-muted">{t(stage === "pending" ? "waitingStart" : "teacherWorking")}</p>}
                        <p className="mt-0.5 truncate text-[11px] text-muted">{row.questionSummary?.paperTitle || t("paperPending")}</p>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <p className={cn("line-clamp-2 leading-5", conclusion ? "text-ink" : "text-muted")}>
                          {conclusion || (completed ? t("conclusionPending") : t("teacherWorking"))}
                        </p>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <StageBadge stage={stage} contacting={false} />
                          {canAssess ? (
                            <TeacherAssessmentEntryButton registrationId={row.registrationId} invitationId={row.invitationId} />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2 text-[11px] tabular-nums text-muted">
                        {dateTime.format(new Date(row.updatedAt))}
                      </TableCell>
                    </TableRow>

                    {active ? (
                      <TableRow className="bg-moon/5 hover:bg-moon/5" data-assessment-workbench-detail={row.id}>
                        <TableCell colSpan={6} className="p-0">
                          <DashboardInlineEntry flush>
                          {!completed ? (
                            <div className="grid min-w-0 md:grid-cols-[1fr_auto]">
                              <section className="min-w-0 border-b border-line/70 px-5 py-4 md:border-b-0 md:border-r">
                                <h3 className="text-xs font-medium text-ink">{t("backgroundTitle")}</h3>
                                <p className="mt-1 text-xs leading-5 text-muted">{row.background || assessmentT("backgroundEmpty")}</p>
                                <p className="mt-3 text-[11px] leading-5 text-muted">{t("autoHandoff")}</p>
                              </section>
                              <section className="flex min-w-72 items-center gap-3 px-5 py-4">
                                <Clock3 className="size-5 shrink-0 text-yellow-600" />
                                <div className="min-w-0">
                                  <p className="font-medium text-ink">{t(stage === "pending" ? "waitingAssessment" : "assessmentInProgress")}</p>
                                  <p className="mt-1 text-[11px] leading-5 text-muted">{t("teacherEntryHint")}</p>
                                  {canAssess ? (
                                    <div className="mt-2">
                                      <TeacherAssessmentEntryButton registrationId={row.registrationId} invitationId={row.invitationId} />
                                    </div>
                                  ) : null}
                                </div>
                              </section>
                            </div>
                          ) : (
                            <div className={cn("grid min-w-0", canSupport && "xl:grid-cols-[1fr_1.6fr]")}>
                              <section className={cn("min-w-0 p-4", canSupport && "border-b border-line/70 xl:border-b-0 xl:border-r")}>
                                <h3 className="text-xs font-medium text-ink">{t("teacherEvidence")}</h3>
                                <p className="mt-2 text-xs leading-5 text-ink">{conclusion || t("conclusionPending")}</p>
                                {row.questionSummary ? (
                                  <>
                                    <div className="mt-3 flex flex-wrap gap-1">
                                      {TEACHER_ASSESSMENT_OUTCOMES.map((status) => {
                                        const count = row.questionSummary?.outcomeCounts[status] ?? 0;
                                        if (count === 0) return null;
                                        return (
                                          <Badge
                                            key={status}
                                            variant="outline"
                                            className={cn(
                                              "gap-1 px-2 py-1 text-[10px]",
                                              LEARNING_CHECK_STATUS_STYLE[status].card,
                                              LEARNING_CHECK_STATUS_STYLE[status].icon,
                                            )}
                                          >
                                            <LearningCheckStatusIcon status={status} size={12} />
                                            {sessionT(`learningStatusShort_${status}`)} {count}
                                          </Badge>
                                        );
                                      })}
                                    </div>
                                    <h4 className="mt-4 text-[11px] font-medium text-muted">{t("keyNotes")}</h4>
                                    {row.questionSummary.keyNotes.length > 0 ? (
                                      <ul className="mt-1 divide-y divide-line/70">
                                        {row.questionSummary.keyNotes.map((note, index) => (
                                          <li key={`${row.id}:${note.questionNo}:${index}`} className="py-2 text-[11px] leading-5">
                                            <span className="font-medium text-ink">{t("questionNote", { question: note.questionNo, point: note.knowledgePoint })}</span>
                                            <span className="ml-2 text-muted">{note.note}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : <p className="mt-1 text-[11px] text-muted">{t("noKeyNotes")}</p>}
                                  </>
                                ) : null}
                              </section>

                              {canSupport ? (
                                <section className="min-w-0 p-4">
                                  <PostActivityHandoff
                                    source={{ registrationId: row.registrationId, invitationId: row.registrationId ? null : row.invitationId }}
                                    onSaved={(context) => {
                                      setRetainedId(row.id);
                                      updateDraft(row.id, (current) => ({ ...current, route: context.route }));
                                    }}
                                  />
                                </section>
                              ) : null}
                            </div>
                          )}
                          </DashboardInlineEntry>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </DashboardTableShell>
      )}
    </DashboardPage>
  );

  function StageBadge({
    stage,
    contacting,
  }: {
    stage: Exclude<AssessmentWorkbenchQueue, "all">;
    contacting: boolean;
  }) {
    const label = stage === "pending"
      ? t("stageAssessmentPending")
      : stage === "in_progress"
        ? t("stageInProgress")
        : stage === "handled"
          ? t("stageHandled")
          : contacting
            ? t("stageContacting")
            : t("stagePending");
    return (
      <Badge
        variant="outline"
        className={cn(
          "whitespace-nowrap",
          stage === "pending" && "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
          stage === "in_progress" && "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
          stage === "feedback" && "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
          stage === "handled" && "border-leaf-deep/40 bg-leaf/30 text-leaf-deep",
        )}
      >
        {label}
      </Badge>
    );
  }
}
