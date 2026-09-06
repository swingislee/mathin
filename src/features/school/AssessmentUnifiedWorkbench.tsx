"use client";


import { BusinessRecordStateFilter, HistoricalRecordBadge, useBusinessSearchQuery } from './BusinessRecordStateFilter';
import { businessRecordMessages, isCurrentBusinessRecord, matchesBusinessRecordState, type BusinessRecordStateFilter as StateFilter } from './business-record-state-contract';
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilePenLine,
  UserCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { FollowupPersonCell } from "./dashboard-page/FollowupPersonCell";
import { navigateFollowupTable } from "./followup-keyboard";
import { FilterSearchInput } from "./FilterBar";
import { FollowupTabs } from "./FollowupTabs";
import { ActivityAssessmentDraftProvider } from "./ActivityAssessmentDetails";
import { AssessmentRecordDetails } from "./AssessmentRecordDetails";
import { reassignAssessmentAssessorAction } from "./assessment-assessor-actions";
import {
  type ActivityRouteKind,
} from "./activity-workflow-contract";
import {
  ASSESSMENT_WORKBENCH_QUEUES,
  assessmentWorkbenchStage,
  nextAssessmentWorkbenchRowId,
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
    return (draft?.route ?? row.route?.route) ? "handled" : "feedback";
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
  initialQuery,
  initialRecordState = 'all',
}: {
  initialRows: AssessmentWorkbenchRow[];
  assessors: InvitationAssessorOption[];
  locale: string;
  canAssess: boolean;
  canSupport: boolean;
  canManageAssessor: boolean;
  initialQuery?: string;
  initialRecordState?: StateFilter;
}) {
  const t = useTranslations("school.supportAssessment");
  const hubT = useTranslations("school.assessmentHub");
  const assessmentT = useTranslations("school.assessments");
  const teacherT = useTranslations("school.teacherAssessment");
  const tableT = useTranslations("school.table");
  const initialDrafts = useMemo(() => Object.fromEntries(
    initialRows.map((row) => [row.id, draftFromRow(row)]),
  ), [initialRows]);
  const [currentRows, setRows] = useState(() => initialRows.filter(row => isCurrentBusinessRecord(row.recordState)));
  const rows = useMemo(() => [...currentRows, ...initialRows.filter(row => !isCurrentBusinessRecord(row.recordState))], [currentRows, initialRows]);
  const [drafts, setDrafts] = useState<Record<string, SupportDraft>>(initialDrafts);
  const [query, setQuery] = useBusinessSearchQuery("assessments",initialQuery);
  const [recordState,setRecordState]=useState(initialRecordState);
  const recordM=businessRecordMessages(locale);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visitedDetails, setVisitedDetails] = useState<Set<string>>(() => new Set());
  const [retainedView, setRetainedView] = useState<{ key: string; ids: string[] } | null>(null);
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
      if(!matchesBusinessRecordState(row.recordState,recordState)) return false;
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
  }, [locale, query, rows, recordState]);
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
          label: row.recordState==='historical' ? row.occurredOn??recordM.unknown : dateTime.format(new Date(row.scheduledAt)),
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
        if(row.recordState==='historical') return {value:'historical',label:recordM.historical};
        return { value: stage, label: t(QUEUE_LABEL_KEYS[stage]) };
      },
      sortValue: (row) => ASSESSMENT_WORKBENCH_QUEUES.indexOf(queueFor(row, drafts[row.id])),
    },
    updated: {
      filterValues: (row) => ({
        value: row.recordState==='historical'?row.occurredOn??EMPTY_VALUE:dayFormatter.format(new Date(row.updatedAt)),
        label: row.recordState==='historical'?row.occurredOn??recordM.unknown:dayFormatter.format(new Date(row.updatedAt)),
      }),
      sortValue: (row) => row.updatedAt,
    },
  }), [assessmentT, dateTime, dayFormatter, drafts, t, tableT, teacherT,recordM.unknown,recordM.historical]);
  const assessmentTable = useDashboardTableView({ rows: scopedRows, columns: tableColumns, locale, persistenceKey: "followup-assessments" });
  const viewKey = JSON.stringify([query, recordState, assessmentTable.filters, assessmentTable.sort]);
  const latestInteraction = useRef({ activeId, expandedId, viewKey });
  useEffect(() => { latestInteraction.current = { activeId, expandedId, viewKey }; }, [activeId, expandedId, viewKey]);
  if (retainedView && retainedView.key !== viewKey) setRetainedView(null);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const visibleRows = retainedView?.key === viewKey
    ? retainedView.ids.flatMap((id) => rowById.has(id) ? [rowById.get(id)!] : [])
    : assessmentTable.visibleRows;
  const retainCurrentView = () => setRetainedView((current) => current?.key === viewKey ? current : { key: viewKey, ids: visibleRows.map((row) => row.id) });
  const saveRow = (saved: AssessmentWorkbenchRow) => {
    retainCurrentView();
    setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
  };
  const saveQuickFollowUp = (row: AssessmentWorkbenchRow, content: string, createdAt: string) => {
    retainCurrentView();
    setRows((current) => current.map((candidate) => candidate.id === row.id ? {
    ...candidate,
    latestFollowUp: {
      id: `local:${createdAt}`,
      content,
      kind: "note",
      createdAt,
      nextFollowUpAt: null,
      statusAfter: null,
    },
    } : candidate));
  };
  const changeDetails = (id: string, open: boolean) => {
    setActiveId(id);
    setExpandedId(open ? id : null);
    if (open) setVisitedDetails((current) => new Set([...current, id]));
  };
  const advanceFrom = (rowId: string) => {
    // 请求期间用户切换了记录或筛选时，保存只更新原记录，继续尊重用户当前所在位置。
    const latest = latestInteraction.current;
    if (latest.activeId !== rowId || latest.expandedId !== rowId || latest.viewKey !== viewKey) return;
    const nextId = nextAssessmentWorkbenchRowId(visibleRows.map((row) => row.id), rowId);
    if (nextId) changeDetails(nextId, true);
  };

  const updateDraft = (id: string, update: (draft: SupportDraft) => SupportDraft) => {
    retainCurrentView();
    setDrafts((current) => ({ ...current, [id]: update(current[id]) }));
  };
  const reassignAssessor = (row: AssessmentWorkbenchRow, assessorId: string) => {
    if (row.assessmentKind !== "one_to_one" || !row.invitationId || assessorId === row.assessorId) return;
    const option = assessors.find((candidate) => candidate.userId === assessorId);
    if (!option) return;
    retainCurrentView();
    setReassigningId(row.id);
    void reassignAssessmentAssessorAction(row.invitationId, assessorId).then((result) => {
      setReassigningId(null);
      if (result.ok) {
        setRows((current) => current.map((candidate) => candidate.id === row.id ? {
          ...candidate, assessorId, assessorName: option.displayName, assessorSource: "assigned", updatedAt: new Date().toISOString(),
        } : candidate));
        toast.success(t("reassignSuccess", { assessor: option.displayName }));
        return;
      }
      toast.error(t("reassignFailed"));
    }).catch(() => {
      setReassigningId(null);
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
            <span className="text-xs tabular-nums text-muted">{visibleRows.length} / {rows.length}</span>
          </DashboardCommandState>
          <DashboardCommandFilters>
            <BusinessRecordStateFilter value={recordState} onChange={setRecordState} locale={locale}/>
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
      {rows.length === 0 ? <DashboardEmptyCard>{t("empty")}</DashboardEmptyCard> : (
        <DashboardTableShell data-assessment-unified-workbench data-followup-workbench data-followup-scroll>
          <Table className="w-full min-w-[68rem] table-fixed text-xs" containerClassName="overflow-auto [scrollbar-gutter:stable]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 top-0 z-30 h-9 w-48 border-r border-line bg-card px-2"><DashboardTableColumnHeader label={t("studentColumn")} {...assessmentTable.columnProps("student")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-20 bg-card px-2"><DashboardTableColumnHeader label={t("typeColumn")} {...assessmentTable.columnProps("kind")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-48 bg-card px-2"><DashboardTableColumnHeader label={t("arrangementColumn")} {...assessmentTable.columnProps("arrangement")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-40 bg-card px-2"><DashboardTableColumnHeader label={t("resultColumn")} {...assessmentTable.columnProps("result")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={t("teacherColumn")} {...assessmentTable.columnProps("teacher")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-40 bg-card px-2"><DashboardTableColumnHeader label={t("statusColumn")} {...assessmentTable.columnProps("status")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-24 bg-card px-2"><DashboardTableColumnHeader label={t("updatedColumn")} {...assessmentTable.columnProps("updated")} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody onKeyDown={(event) => navigateFollowupTable(event, (id) => { setActiveId(id); return true; })}>
              {visibleRows.map((row) => {
                const current = isCurrentBusinessRecord(row.recordState);
                const mayAssess = current && canAssess;
                const maySupport = current && canSupport;
                const draft = drafts[row.id];
                const active = row.id === activeId;
                const expanded = row.id === expandedId;
                const stage = queueFor(row, draft);
                const completed = stage === "feedback" || stage === "handled";
                const conclusion = assessmentConclusion(row);
                return (
                  <ActivityAssessmentDraftProvider key={row.id} row={row}>
                    <TableRow
                      data-record-state={row.recordState ?? "current"}
                      data-followup-row-key={row.id}
                      data-followup-active={active}
                      data-followup-expanded={expanded}
                      tabIndex={0}
                      aria-expanded={expanded}
                      aria-controls={`assessment-details-${row.id}`}
                      className="h-16 cursor-pointer focus-visible:outline-none [&>td]:min-w-0"
                      onFocusCapture={() => setActiveId(row.id)}
                      onClick={(event) => {
                        setActiveId(row.id);
                        if (!(event.target as HTMLElement).closest("button,a,input,textarea,[role='combobox'],[role='option'],[role='checkbox']")) changeDetails(row.id, !expanded);
                      }}
                      onKeyDown={(event) => {
                        if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat || event.target !== event.currentTarget) return;
                        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); changeDetails(row.id, !expanded); }
                        if (event.key === "Escape" && expanded) { event.preventDefault(); changeDetails(row.id, false); }
                      }}
                      data-assessment-workbench-row={row.id}
                    >
                      <TableCell
                        className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2"
                      >
                        <FollowupPersonCell name={row.name} phone={row.phone}
                          grade={row.gradeText || (row.grade ? assessmentT("gradeValue", { grade: row.grade }) : assessmentT("gradePending"))}
                          studentGrade={row.grade} expanded={expanded} detailsId={`assessment-details-${row.id}`}
                          onToggle={() => changeDetails(row.id, !expanded)}
                          subject={{ studentId: row.studentId, leadId: row.leadId }} />
                      </TableCell>
                      <TableCell className="px-2 py-2"><Badge variant="outline" className="whitespace-nowrap border-line bg-line/20 text-muted">{t(`type_${row.assessmentKind}`)}</Badge></TableCell>
                      <TableCell className="px-2 py-2">
                        <p className="truncate font-medium text-ink">{current ? dateTime.format(new Date(row.scheduledAt)) : row.occurredOn ?? recordM.unknown}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted" title={row.location}>{row.location || (current ? assessmentT("locationPending") : recordM.unknown)}</p>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                          {row.assessorSource === "actual" ? <UserCheck className="size-3.5 shrink-0 text-leaf-deep" /> : null}
                          <span className="shrink-0">{t(row.assessorSource === "actual" ? "actualAssessor" : "assignedAssessor")}</span>
                          <span className="truncate font-medium text-ink">{row.assessorName || (current ? t("assessorPending") : recordM.unknown)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {completed && row.assessment && (row.assessment.score !== null || row.assessment.assessmentBand) ? (
                          <div className="flex min-w-0 items-center gap-2">
                            {row.assessment.score !== null ? <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                              {row.questionSummary
                                ? t("scoreValue", { score: row.assessment.score, total: row.questionSummary.totalScore })
                                : t("scoreOnly", { score: row.assessment.score })}
                            </span> : null}
                            {row.assessment.assessmentBand ? (
                              <Badge variant="outline" className={cn(row.assessment.assessmentBand === "x_plus" || row.assessment.assessmentBand === "below_a" ? "border-rose/30 bg-cheek/25 text-ink" : row.assessment.assessmentBand === "g_plus" ? "border-crater/40 bg-moon/40 text-ink" : "border-leaf-deep/35 bg-leaf/20 text-leaf-deep")}>
                                {teacherT(`band_${row.assessment.assessmentBand}`)}
                              </Badge>
                            ) : null}
                          </div>
                        ) : row.questionSummary ? (
                          <p className="font-medium tabular-nums text-ink">{t("progressValue", {
                            answered: row.questionSummary.answeredCount,
                            total: row.questionSummary.questionCount,
                          })}</p>
                        ) : <p className="truncate font-medium text-muted">{completed ? "—" : t(stage === "pending" ? "waitingStart" : "stageInProgress")}</p>}
                        {row.questionSummary?.paperTitle ? <p className="mt-0.5 truncate text-[11px] text-muted">{row.questionSummary.paperTitle}</p> : null}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <p className={cn("line-clamp-2 whitespace-normal leading-5", conclusion ? "text-ink" : "text-muted")} title={!current && expanded ? undefined : conclusion}>
                          {!current && expanded ? recordM.historicalFeedback : conclusion || (completed ? t("conclusionPending") : t("stageAssessmentPending"))}
                        </p>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          {current ? <StageBadge stage={stage} contacting={false} /> : <HistoricalRecordBadge locale={locale} />}
                          <Button type="button" variant="ghost" size="sm" className="h-auto min-h-7 whitespace-normal rounded-md px-1.5 py-1 text-[11px]" aria-expanded={expanded} aria-controls={`assessment-details-${row.id}`} title={`${t("details")} · Enter`} aria-keyshortcuts="Enter" onClick={(event) => { event.stopPropagation(); changeDetails(row.id, !expanded); }}><FilePenLine className="size-3.5" />{t("details")}</Button>
                          {mayAssess && row.assessmentKind === "one_to_one" ? (
                            <TeacherAssessmentEntryButton registrationId={row.registrationId} invitationId={row.invitationId} />
                          ) : null}
                        </div>
                        {current && row.latestFollowUp?.content ? <p data-current-situation className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted" title={row.latestFollowUp.content}>{row.latestFollowUp.content}</p> : null}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-[11px] tabular-nums text-muted">
                        {current ? dateTime.format(new Date(row.updatedAt)) : row.occurredOn ?? recordM.unknown}
                      </TableCell>
                    </TableRow>

                    <FollowupInlineDetails open={expanded} keepMounted={visitedDetails.has(row.id)}
                      onOpenChange={(open) => changeDetails(row.id, open)} title={row.name} hideTitle
                      active={active} onActivate={() => setActiveId(row.id)} colSpan={7} id={`assessment-details-${row.id}`}>
                      <AssessmentRecordDetails row={row} stage={stage} conclusion={conclusion} locale={locale}
                        canAssess={mayAssess} canSupport={maySupport} canManageAssessor={canManageAssessor}
                        assessors={assessors} reassigning={reassigningId === row.id} onReassign={(id) => reassignAssessor(row, id)}
                        onSaved={saveRow} onNoteSaved={(entry) => saveQuickFollowUp(row, entry.content, entry.createdAt)}
                        onSaveAndNext={nextAssessmentWorkbenchRowId(visibleRows.map((item) => item.id), row.id) ? () => advanceFrom(row.id) : undefined}
                        onHandoffSaved={(context) => updateDraft(row.id, (current) => ({ ...current, route: context.route }))} />
                    </FollowupInlineDetails>
                  </ActivityAssessmentDraftProvider>
                );
              })}
              {visibleRows.length === 0 ? (
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
          "max-w-full whitespace-normal rounded-md px-1.5 text-[11px]",
          stage === "pending" && "border-line bg-line/20 text-muted",
          stage === "in_progress" && "border-crater/40 bg-moon/40 text-ink",
          stage === "feedback" && "border-crater/40 bg-moon/40 text-ink",
          stage === "handled" && "border-leaf-deep/35 bg-leaf/20 text-leaf-deep",
        )}
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
        {label}
      </Badge>
    );
  }
}
