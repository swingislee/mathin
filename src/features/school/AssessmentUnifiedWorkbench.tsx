"use client";

import { useDashboardSearchQuery } from "./dashboard-page/DashboardPreferenceScope";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  FilePenLine,
  UserCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { FilterSearchInput } from "./FilterBar";
import { FollowupTabs } from "./FollowupTabs";
import { ActivityAssessmentDetails, ActivityAssessmentDraftProvider } from "./ActivityAssessmentDetails";
import { Student360Trigger } from "./Student360Sheet";
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
  DashboardTableColumnHeader,
  DashboardTableShell,
  type DashboardTableColumnDefinition,
  useDashboardTableView,
} from "./dashboard-page";
import type { InvitationAssessorOption } from "./invitation-contract";
import { LearningCheckStatusIcon } from "./LearningCheckStatusIcon";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";
import { TEACHER_ASSESSMENT_OUTCOMES } from "./teacher-assessment-contract";
import { TeacherAssessmentEntryButton } from "./TeacherAssessmentEntryButton";

interface SupportDraft {
  route: ActivityRouteKind | null;
}

const EMPTY_VALUE = "$empty";
type AssessmentTableColumn = "student" | "kind" | "arrangement" | "result" | "teacher" | "status" | "updated";

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

function assessmentConclusion(row: AssessmentWorkbenchRow): string {
  return row.assessment?.teacherObservation
    || row.assessment?.teacherRecommendation
    || row.assessment?.strengths
    || "";
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
  const tableT = useTranslations("school.table");
  const initialDrafts = useMemo(() => Object.fromEntries(
    initialRows.map((row) => [row.id, draftFromRow(row)]),
  ), [initialRows]);
  const [rows, setRows] = useState(initialRows);
  const [drafts, setDrafts] = useState<Record<string, SupportDraft>>(initialDrafts);
  const [query, setQuery] = useDashboardSearchQuery("assessments");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const dateTime = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }), [locale]);

  const scopedRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return rows.filter((row) => {
      if (!needle) return true;
      const assessment = row.assessment;
      return [
        row.name,
        row.phone,
        row.gradeText,
        row.location,
        row.assessorName,
        row.background,
        row.activityTitle,
        assessment?.teacherObservation ?? "",
        assessment?.teacherRecommendation ?? "",
      ].some((value) => value.toLocaleLowerCase(locale).includes(needle));
    });
  }, [locale, query, rows]);
  const dayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const tableColumns = useMemo<Record<AssessmentTableColumn, DashboardTableColumnDefinition<AssessmentWorkbenchRow>>>(() => ({
    kind: {
      filterValues: (row) => ({ value: row.assessmentKind, label: t(`type_${row.assessmentKind}`) }),
      sortValue: (row) => row.assessmentKind,
    },
    student: {
      filterValues: (row) => [
        { value: `name:${row.name}`, label: row.name, group: tableT("fieldName") },
        {
          value: row.phone ? `phone:${row.phone}` : `phone:${EMPTY_VALUE}`,
          label: row.phone || tableT("emptyValue"),
          group: tableT("fieldPhone"),
        },
        {
          value: row.gradeText || row.grade ? `grade:${row.gradeText || row.grade}` : `grade:${EMPTY_VALUE}`,
          label: row.gradeText || (row.grade ? assessmentT("gradeValue", { grade: row.grade }) : assessmentT("gradePending")),
          group: tableT("fieldGrade"),
        },
      ],
      sortValue: (row) => row.name,
    },
    arrangement: {
      filterValues: (row) => [
        {
          value: `time:${row.scheduledAt}`,
          label: dateTime.format(new Date(row.scheduledAt)),
          group: tableT("fieldScheduledTime"),
        },
        {
          value: row.location ? `location:${row.location}` : `location:${EMPTY_VALUE}`,
          label: row.location || assessmentT("locationPending"),
          group: tableT("fieldLocation"),
        },
        {
          value: row.assessorId ? `assessor:${row.assessorId}` : `assessor:${EMPTY_VALUE}`,
          label: row.assessorName || t("assessorPending"),
          group: tableT("fieldAssessor"),
        },
        {
          value: `assessor-source:${row.assessorSource}`,
          label: t(row.assessorSource === "actual" ? "actualAssessor" : "assignedAssessor"),
          group: tableT("fieldAssessorSource"),
        },
      ],
      sortValue: (row) => row.scheduledAt,
    },
    result: {
      filterValues: (row) => {
        const stage = queueFor(row, drafts[row.id]);
        const completed = stage === "feedback" || stage === "handled";
        const score = completed ? row.assessment?.score : null;
        const hasScore = score !== null && score !== undefined;
        return [
          ...(hasScore
            ? [{
                value: `score:${score}`,
                label: row.questionSummary
                  ? t("scoreValue", { score, total: row.questionSummary.totalScore })
                  : t("scoreOnly", { score }),
                group: tableT("fieldScore"),
              }]
            : []),
          ...(row.assessment?.assessmentBand
            ? [{
                value: `band:${row.assessment.assessmentBand}`,
                label: teacherT(`band_${row.assessment.assessmentBand}`),
                group: tableT("fieldBand"),
              }]
            : []),
          ...(!hasScore
            ? [{
                value: row.questionSummary
                  ? `progress:${row.questionSummary.answeredCount}:${row.questionSummary.questionCount}`
                  : `progress:${stage}`,
                label: row.questionSummary
                  ? t("progressValue", {
                      answered: row.questionSummary.answeredCount,
                      total: row.questionSummary.questionCount,
                    })
                  : t(stage === "pending" ? "waitingStart" : "teacherWorking"),
                group: tableT("fieldProgress"),
              }]
            : []),
          {
            value: row.questionSummary?.paperTitle
              ? `paper:${row.questionSummary.paperTitle}`
              : `paper:${EMPTY_VALUE}`,
            label: row.questionSummary?.paperTitle || t("paperPending"),
            group: tableT("fieldPaper"),
          },
        ];
      },
      sortValue: (row) => row.assessment?.score,
    },
    teacher: {
      filterValues: (row) => {
        const conclusion = assessmentConclusion(row);
        return {
          value: conclusion ? `conclusion:${conclusion}` : EMPTY_VALUE,
          label: conclusion || tableT("emptyValue"),
        };
      },
      sortValue: (row) => assessmentConclusion(row),
    },
    status: {
      filterValues: (row) => {
        const stage = queueFor(row, drafts[row.id]);
        return { value: stage, label: t(QUEUE_LABEL_KEYS[stage]) };
      },
      sortValue: (row) => ASSESSMENT_WORKBENCH_QUEUES.indexOf(queueFor(row, drafts[row.id])),
    },
    updated: {
      filterValues: (row) => ({
        value: dayFormatter.format(new Date(row.updatedAt)),
        label: dayFormatter.format(new Date(row.updatedAt)),
      }),
      sortValue: (row) => row.updatedAt,
    },
  }), [assessmentT, dateTime, dayFormatter, drafts, t, tableT, teacherT]);
  const assessmentTable = useDashboardTableView({ rows: scopedRows, columns: tableColumns, locale, persistenceKey: "followup-assessments" });
  const saveRow = (saved: AssessmentWorkbenchRow) => setRows((current) => current.map((row) => row.id === saved.id ? saved : row));

  const updateDraft = (id: string, update: (draft: SupportDraft) => SupportDraft) => {
    setDrafts((current) => ({ ...current, [id]: update(current[id]) }));
  };
  const reassignAssessor = (row: AssessmentWorkbenchRow, assessorId: string) => {
    if (row.assessmentKind !== "one_to_one" || !row.invitationId || assessorId === row.assessorId) return;
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
    }).catch(() => {
      setReassigningId(null);
      setRows((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, ...previous, assessorSource: row.assessorSource } : candidate));
      toast.error(t("reassignFailed"));
    });
  };

  return (
    <DashboardPage
      title={hubT("title")}
      density="compact"
      commandPanel={(
        <DashboardCommandPanel>
          <DashboardCommandState>
            <FollowupTabs />
            <span className="text-xs tabular-nums text-muted">{assessmentTable.visibleRows.length} / {rows.length}</span>
          </DashboardCommandState>
          <DashboardCommandFilters>
            <FilterSearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
            />
            <span className="hidden text-[11px] text-muted xl:inline">{t("keyboardHint")}</span>
          </DashboardCommandFilters>

        </DashboardCommandPanel>
      )}
    >
      {scopedRows.length === 0 ? <DashboardEmptyCard>{t("empty")}</DashboardEmptyCard> : (
        <DashboardTableShell data-assessment-unified-workbench>
          <Table className="min-w-[94rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-11rem)] overflow-auto">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 top-0 z-30 h-9 w-56 border-r border-line bg-card px-2"><DashboardTableColumnHeader label={t("studentColumn")} {...assessmentTable.columnProps("student")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-32 bg-card px-2"><DashboardTableColumnHeader label={t("typeColumn")} {...assessmentTable.columnProps("kind")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-64 bg-card px-2"><DashboardTableColumnHeader label={t("arrangementColumn")} {...assessmentTable.columnProps("arrangement")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-56 bg-card px-2"><DashboardTableColumnHeader label={t("resultColumn")} {...assessmentTable.columnProps("result")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={t("teacherColumn")} {...assessmentTable.columnProps("teacher")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-64 bg-card px-2"><DashboardTableColumnHeader label={t("statusColumn")} {...assessmentTable.columnProps("status")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-28 bg-card px-2"><DashboardTableColumnHeader label={t("updatedColumn")} {...assessmentTable.columnProps("updated")} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assessmentTable.visibleRows.map((row) => {
                const draft = drafts[row.id];
                const active = row.id === activeId;
                const stage = queueFor(row, draft);
                const completed = stage === "feedback" || stage === "handled";
                const conclusion = assessmentConclusion(row);
                return (
                  <ActivityAssessmentDraftProvider key={row.id} row={row}>
                    <TableRow
                      tabIndex={0}
                      aria-expanded={active}
                      aria-controls={active ? `assessment-details-${row.id}` : undefined}
                      aria-selected={active}
                      className={cn("h-16 cursor-pointer focus-visible:bg-blue/10 focus-visible:outline-none", active && "bg-blue/10 hover:bg-blue/10")}
                      onClick={() => setActiveId((current) => current === row.id ? null : row.id)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing || event.repeat) return;
                        if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.repeat) return;
                        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); setActiveId(active ? null : row.id); }
                        if (event.key === "Escape" && active) { event.preventDefault(); setActiveId(null); }
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          const direction = event.key === "ArrowDown" ? "nextElementSibling" : "previousElementSibling";
                          let sibling = event.currentTarget[direction];
                          while (sibling && !sibling.hasAttribute("data-assessment-workbench-row")) sibling = sibling[direction];
                          if (sibling instanceof HTMLElement) sibling.focus();
                        }
                      }}
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
                              <Student360Trigger
                                subject={{ studentId: row.studentId, leadId: row.leadId }}
                                fallback={{
                                  name: row.name,
                                  grade: row.grade,
                                  gradeText: row.gradeText,
                                  phone: row.phone,
                                }}
                                className="truncate"
                              >
                                {row.name}
                              </Student360Trigger>
                              <span className="shrink-0 text-[11px] text-muted">
                                {row.gradeText || (row.grade ? assessmentT("gradeValue", { grade: row.grade }) : assessmentT("gradePending"))}
                              </span>
                            </div>
                            {row.phone ? <a href={`tel:${row.phone}`} className="mt-0.5 block font-mono text-[11px] text-muted hover:underline" onClick={(event) => event.stopPropagation()}>{row.phone}</a> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2"><Badge variant="outline" className="whitespace-nowrap border-line bg-line/20 text-muted">{t(`type_${row.assessmentKind}`)}</Badge></TableCell>
                      <TableCell className="px-2 py-2">
                        <p className="truncate whitespace-nowrap font-medium text-ink">
                          {dateTime.format(new Date(row.scheduledAt))} · {row.location || assessmentT("locationPending")}
                        </p>
                        <div className="mt-1" onClick={(event) => event.stopPropagation()}>
                          {completed || row.assessmentKind !== "one_to_one" || !canManageAssessor || !row.invitationId ? (
                            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                              {row.assessorSource === "actual" ? <UserCheck className="size-3.5 shrink-0 text-leaf-deep" /> : null}
                              <span className="shrink-0">{t(row.assessorSource === "actual" ? "actualAssessor" : "assignedAssessor")}</span>
                              <span className="truncate font-medium text-ink">{row.assessorName || t("assessorPending")}</span>
                            </div>
                          ) : (
                            <div data-assessor-reassignment={row.id}><FollowupChoice
                              value={row.assessorId ?? ""}
                              disabled={reassigningId === row.id}
                              onValueChange={(value) => reassignAssessor(row, value)}
                              className="flex-nowrap [&>button]:min-w-0 [&>button]:truncate"
                              label={t("changeAssessorFor", { name: row.name })}
                              options={assessors.map((assessor) => ({ value: assessor.userId, label: assessor.displayName, tone: "healthy" }))}
                            /></div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {row.assessmentKind === "activity" && !row.publicClassRecord && canAssess ? <ActivityAssessmentDetails row={row} compact disabled={!canAssess} onSaved={saveRow} /> : completed && row.assessment?.score !== null && row.assessment?.score !== undefined ? (
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                              {row.questionSummary
                                ? t("scoreValue", { score: row.assessment.score, total: row.questionSummary.totalScore })
                                : t("scoreOnly", { score: row.assessment.score })}
                            </span>
                            {row.assessment.assessmentBand ? (
                              <Badge variant="outline" className={cn(row.assessment.assessmentBand === "x_plus" || row.assessment.assessmentBand === "below_a" ? "border-rose/30 bg-rose/15 text-rose" : row.assessment.assessmentBand === "g_plus" ? "border-crater/40 bg-moon/40 text-ink" : "border-blue/30 bg-blue/15 text-blue")}>
                                {teacherT(`band_${row.assessment.assessmentBand}`)}
                              </Badge>
                            ) : null}
                          </div>
                        ) : row.questionSummary ? (
                          <p className="font-medium tabular-nums text-ink">{t("progressValue", {
                            answered: row.questionSummary.answeredCount,
                            total: row.questionSummary.questionCount,
                          })}</p>
                        ) : <p className="font-medium text-muted">{completed ? "—" : t(stage === "pending" ? "waitingStart" : "teacherWorking")}</p>}
                        {row.questionSummary?.paperTitle ? <p className="mt-0.5 truncate text-[11px] text-muted">{row.questionSummary.paperTitle}</p> : null}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {row.publicClassRecord && canAssess ? <ActivityAssessmentDetails row={row} compact disabled={!canAssess} onSaved={saveRow} /> : <p className={cn("truncate leading-5", conclusion ? "text-ink" : "text-muted")}>
                          {conclusion || (completed ? t("conclusionPending") : t("teacherWorking"))}
                        </p>}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <StageBadge stage={stage} contacting={false} />
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" aria-label={t("details")} aria-expanded={active} aria-controls={active ? `assessment-details-${row.id}` : undefined} title={`${t("details")} · Enter`} aria-keyshortcuts="Enter" onClick={(event) => { event.stopPropagation(); setActiveId(active ? null : row.id); }}><FilePenLine className="size-3.5" /></Button>
                          {canAssess && row.assessmentKind === "one_to_one" ? (
                            <TeacherAssessmentEntryButton registrationId={row.registrationId} invitationId={row.invitationId} />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2 text-[11px] tabular-nums text-muted">
                        {dateTime.format(new Date(row.updatedAt))}
                      </TableCell>
                    </TableRow>

                    {active ? (
                      <FollowupInlineDetails open={active} onOpenChange={(open) => { if (!open) setActiveId(null); }} title={`${row.name} · ${t(`type_${row.assessmentKind}`)}`} colSpan={7} id={`assessment-details-${row.id}`}>
                        <div className="min-w-0 space-y-3" data-assessment-workbench-detail={row.id}>
                          {row.activityId ? <Link href={`/dashboard/activities/${row.activityId}?${row.publicClassRecord ? `view=onsite&segment=${row.publicClassRecord.segmentId}` : "node=assessment"}`} className="block truncate text-xs text-blue hover:underline">{row.publicClassRecord?.segmentTitle || row.activityTitle} · {t("activityWorkspace")}</Link> : null}
                          {row.assessmentKind === "activity" ? <div className={cn("grid min-w-0 gap-4", canSupport && completed && "xl:grid-cols-[1.4fr_1fr]")}>
                            <div className="min-w-0"><ActivityAssessmentDetails row={row} disabled={!canAssess} onSaved={saveRow} /></div>
                            {canSupport && completed ? <div className="min-w-0"><PostActivityHandoff source={{ registrationId: row.registrationId, invitationId: null }} onSaved={(context) => updateDraft(row.id, (current) => ({ ...current, route: context.route }))} /></div> : null}
                          </div> : !completed ? (
                            <div className="grid min-w-0 items-start gap-4 md:grid-cols-[1fr_auto]">
                              <section className="min-w-0">
                                <h3 className="text-xs font-medium text-ink">{t("backgroundTitle")}</h3>
                                <p className="mt-1 text-xs leading-5 text-muted">{row.background || assessmentT("backgroundEmpty")}</p>
                              </section>
                              <section className="flex min-w-0 items-center gap-3">
                                <Clock3 className="size-5 shrink-0 text-yellow-600" />
                                <div className="min-w-0">
                                  <p className="font-medium text-ink">{t(stage === "pending" ? "waitingAssessment" : "assessmentInProgress")}</p>
                                  {canAssess ? (
                                    <div className="mt-2">
                                      <TeacherAssessmentEntryButton registrationId={row.registrationId} invitationId={row.invitationId} />
                                    </div>
                                  ) : null}
                                </div>
                              </section>
                            </div>
                          ) : (
                            <div className={cn("grid min-w-0 items-start gap-4", canSupport && "xl:grid-cols-[1fr_1.6fr]")}>
                              <section className="min-w-0">
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
                                <section className="min-w-0">
                                  <PostActivityHandoff
                                    source={{ registrationId: row.registrationId, invitationId: row.registrationId ? null : row.invitationId }}
                                    onSaved={(context) => {
                                      updateDraft(row.id, (current) => ({ ...current, route: context.route }));
                                    }}
                                  />
                                </section>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </FollowupInlineDetails>
                    ) : null}
                  </ActivityAssessmentDraftProvider>
                );
              })}
              {assessmentTable.visibleRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-32 px-4 text-center text-sm text-muted">{tableT("filteredEmpty")}</TableCell></TableRow>
              ) : null}
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
          stage === "pending" && "border-line bg-line/20 text-muted",
          stage === "in_progress" && "border-crater/40 bg-moon/40 text-ink",
          stage === "feedback" && "border-crater/40 bg-moon/40 text-ink",
          stage === "handled" && "border-blue/30 bg-blue/15 text-blue",
        )}
      >
        {label}
      </Badge>
    );
  }
}
