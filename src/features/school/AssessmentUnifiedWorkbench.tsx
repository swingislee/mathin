"use client";

import { FollowupTableRecord, type FollowupRowState } from "./dashboard-page/FollowupTableRecord";

import { BusinessRecordRevisionButton } from './BusinessRecordRevisionButton';
import {SourceCompletionNotice} from './SourceCompletionNotice';
import {sourceCompletionMessages} from './source-completion-contract';

import { BusinessRecordStateFilter, useBusinessSearchQuery } from './BusinessRecordStateFilter';
import { isCurrentBusinessRecord, matchesBusinessRecordState, type BusinessRecordStateFilter as StateFilter } from './business-record-state-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { FollowupPersonCell } from "./dashboard-page/FollowupPersonCell";
import { followupFocusActivatesRow } from "./followup-keyboard";
import { FollowupTableBody } from "./dashboard-page/FollowupRecordRow";
import { FilterSearchInput } from "./FilterBar";
import { FollowupCommandPanel } from "./FollowupCommandPanel";
import { SchoolSupportTableEntry, SchoolSupportInsertion } from "./SchoolSupportInlineEntry";
import { SchoolSupportPendingRows } from "./SchoolSupportPendingRows";
import { FollowupPrimaryFilter } from "./FollowupPrimaryFilter";
import { ActivityAssessmentDraftProvider } from "./ActivityAssessmentDetails";
import { AssessmentRecordDetails } from "./AssessmentRecordDetails";
import { AssessmentStatusTags } from "./AssessmentStatusTags";
import { TeacherAssessmentEntryButton } from "./TeacherAssessmentEntryButton";
import { reassignAssessmentAssessorAction } from "./assessment-assessor-actions";
import {
  type ActivityRouteKind,
} from "./activity-workflow-contract";
import {
  ASSESSMENT_WORKBENCH_QUEUES,
  assessmentWorkbenchStage,
  assessmentWorkbenchHasFinalResult,
  assessmentWorkbenchHasConfirmedEnrollment,
  assessmentAppointmentClosed,
  nextAssessmentWorkbenchRowId,
  type AssessmentWorkbenchQueue,
  type AssessmentWorkbenchRow,
} from "./assessment-workbench-contract";
import {
  DashboardCommandFilters,
  DashboardPage,
  DashboardTableColumnHeader,
  DashboardTableShell,
} from "./dashboard-page";
import { useDashboardFieldView } from "./dashboard-page/useDashboardFieldView";
import { formatDashboardDate } from "./dashboard-page/dashboard-table-date-contract";
import { dashboardFieldMessages } from "./dashboard-page/dashboard-field-messages";
import {
  ASSESSMENT_TABLE_COLUMNS, assessmentTableFields, assessmentTableBand, assessmentTableScore,
  assessmentScheduledDate, assessmentRecordDate, assessmentTableConclusion as assessmentConclusion,
  formatAssessmentTableScore, migrateAssessmentFieldQuery,
} from "./assessment-table-fields";
import type { InvitationAssessorOption } from "./invitation-contract";
import { LeadPoolPagination } from "./LeadPoolPagination";
import { useFollowupPagination } from "./useFollowupPagination";

interface SupportDraft {
  route: ActivityRouteKind | null;
}

function draftFromRow(row: AssessmentWorkbenchRow): SupportDraft {
  return {
    route: row.route?.route ?? null,
  };
}

function queueFor(
  row: AssessmentWorkbenchRow,
  draft: SupportDraft,
): Exclude<AssessmentWorkbenchQueue, "all"> {
  if (row.workflow) return assessmentWorkbenchStage(row);
  const stage = assessmentWorkbenchStage(row);
  if (draft?.route || stage === "feedback" || stage === "handled") {
    return (draft?.route ?? row.route?.route) ? "handled" : "feedback";
  }
  return stage;
}

const ASSESSMENT_SOURCE_SORT = { field: "scheduledAt", direction: "desc" } as const;

export function AssessmentUnifiedWorkbench({
  initialRows,
  assessors,
  locale,
  canAssess,
  canSupport,
  canManageAssessor,
  canQuickEntry = canAssess,
  initialQuery,
  initialRecordState = 'current',
  timeZone = "Asia/Shanghai",
  now,
}: {
  initialRows: AssessmentWorkbenchRow[];
  assessors: InvitationAssessorOption[];
  locale: string;
  canAssess: boolean;
  canSupport: boolean;
  canManageAssessor: boolean;
  canQuickEntry?: boolean;
  initialQuery?: string;
  initialRecordState?: StateFilter;
  timeZone?: string;
  now?: number;
}) {
  const t = useTranslations("school.supportAssessment");
  const filterT = useTranslations("school.followupFilters");
  const hubT = useTranslations("school.assessmentHub");
  const assessmentT = useTranslations("school.assessments");
  const teacherT = useTranslations("school.teacherAssessment");
  const quickT = useTranslations("school.assessmentQuickEntry");
  const tableT = useTranslations("school.table");
  const initialDrafts = useMemo(() => Object.fromEntries(
    initialRows.map((row) => [row.id, draftFromRow(row)]),
  ), [initialRows]);
  const [currentRows, setRows] = useState(() => initialRows.filter(row => isCurrentBusinessRecord(row.recordState)));
  const [loadedRows,setLoadedRows]=useState(initialRows);
  if(loadedRows!==initialRows){
    setLoadedRows(initialRows);
    setRows(previous=>{
      const saved=new Map(previous.map(row=>[row.id,row]));
      return initialRows.filter(row=>isCurrentBusinessRecord(row.recordState)).map(row=>{
        const local=saved.get(row.id);
        return local&&local.updatedAt>row.updatedAt?local:row;
      });
    });
  }
  const rows = useMemo(() => {
    const currentById = new Map(currentRows.map(row => [row.id, row]));
    return initialRows.map(row => isCurrentBusinessRecord(row.recordState) ? currentById.get(row.id) ?? row : row);
  }, [currentRows, initialRows]);
  const [drafts, setDrafts] = useState<Record<string, SupportDraft>>(initialDrafts);
  const [query, setQuery] = useBusinessSearchQuery("assessments",initialQuery);
  const [recordState, setRecordState] = useState(initialRecordState);
  const [clockNow] = useState(() => now ?? Date.now());
  const dateContext = useMemo(() => ({ locale, timeZone, now: clockNow }), [locale, timeZone, clockNow]);
  const fieldM = useMemo(() => dashboardFieldMessages(locale), [locale]);
  const sourceM=sourceCompletionMessages(locale);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visitedDetails, setVisitedDetails] = useState<Set<string>>(() => new Set());
  const [retainedView, setRetainedView] = useState<{ key: string; ids: string[] } | null>(null);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const scopedRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return rows.filter((row) => {
      if (!matchesBusinessRecordState(row.recordState, recordState)) return false;
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
        assessment?.strengths ?? "",
        assessment?.focusAreas ?? "",
        assessment?.parentConcerns ?? "",
        row.questionSummary?.paperTitle ?? "",
      ].some((value) => value.toLocaleLowerCase(locale).includes(needle));
    });
  }, [locale, query, rows, recordState]);
  const fields = useMemo(() => assessmentTableFields({ locale, timeZone, tableT, assessmentT, t, teacherT, quickT,
    stageFor: row => queueFor(row, drafts[row.id]),
  }), [locale, timeZone, tableT, assessmentT, t, teacherT, quickT, drafts]);
  const assessmentTable = useDashboardFieldView({ rows: scopedRows, fields, columns: ASSESSMENT_TABLE_COLUMNS,
    context: dateContext, persistenceKey: "followup-assessments", migrate: migrateAssessmentFieldQuery,
    sourceSort: ASSESSMENT_SOURCE_SORT });
  const filterKey = JSON.stringify([query, recordState, assessmentTable.filters, assessmentTable.sort]);
  if (retainedView && retainedView.key !== filterKey) setRetainedView(null);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const orderedVisibleRows = useMemo(() => retainedView?.key === filterKey
    ? retainedView.ids.flatMap(id => rowById.has(id) ? [rowById.get(id)!] : []) : assessmentTable.visibleRows, [assessmentTable.visibleRows, filterKey, retainedView, rowById]);
  const pagination = useFollowupPagination(orderedVisibleRows, filterKey);
  const viewKey = JSON.stringify([filterKey, pagination.page, pagination.pageSize]);
  const latestInteraction = useRef({ activeId, expandedId, viewKey });
  useEffect(() => { latestInteraction.current = { activeId, expandedId, viewKey }; }, [activeId, expandedId, viewKey]);
  const visibleRows = pagination.rows;
  const retainCurrentView = useCallback(() => setRetainedView((current) => current?.key === filterKey ? current : { key: filterKey, ids: orderedVisibleRows.map((row) => row.id) }), [filterKey, orderedVisibleRows]);
  const saveRow = useCallback((saved: AssessmentWorkbenchRow) => {
    retainCurrentView();
    setRows((current) => current.map((row) => row.id === saved.id ? saved
      : saved.registrationId && row.registrationId === saved.registrationId ? { ...row, workflow: saved.workflow, participationStatus: saved.participationStatus } : row));
  }, [retainCurrentView]);
  const saveQuickFollowUp = useCallback((row: AssessmentWorkbenchRow, content: string, createdAt: string) => {
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
  }, [retainCurrentView]);
  const changeDetails = useCallback((id: string, open: boolean) => {
    setActiveId(id);
    setExpandedId(open ? id : null);
    if (open) setVisitedDetails((current) => new Set([...current, id]));
  }, []);
  const advanceFrom = useCallback((rowId: string) => {
    // 请求期间用户切换了记录或筛选时，保存只更新原记录，继续尊重用户当前所在位置。
    const latest = latestInteraction.current;
    if (latest.activeId !== rowId || latest.expandedId !== rowId || latest.viewKey !== viewKey) return;
    const nextId = nextAssessmentWorkbenchRowId(visibleRows.map((row) => row.id), rowId);
    if (nextId) changeDetails(nextId, true);
  }, [changeDetails, viewKey, visibleRows]);

  const updateDraft = useCallback((id: string, update: (draft: SupportDraft) => SupportDraft) => {
    retainCurrentView();
    setDrafts((current) => ({ ...current, [id]: update(current[id]) }));
  }, [retainCurrentView]);
  const reassignAssessor = useCallback((row: AssessmentWorkbenchRow, assessorId: string) => {
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
  }, [assessors, retainCurrentView, t]);
  const renderRow = useCallback((row: AssessmentWorkbenchRow, state: FollowupRowState) => {
    const { active, expanded, retained } = state;
    const current = isCurrentBusinessRecord(row.recordState);
    const closed=assessmentAppointmentClosed(row);
    const mayAssess = current && canAssess && !closed;
    const maySupport = current && canSupport;
    const draft = drafts[row.id];
    const stage = queueFor(row, draft);
    const completed = assessmentWorkbenchHasFinalResult(row);
    const conclusion = assessmentConclusion(row);
    const band = assessmentTableBand(row);
    const score = assessmentTableScore(row);
    const scoreDisplay = formatAssessmentTableScore(row, locale);
    const scheduledAt = assessmentScheduledDate(row, timeZone);
    const recordedAt = assessmentRecordDate(row);
    const latestContext = (row.workflow?.contactedAt ?? row.workflow?.finalizedAt) && row.workflow?.parentResponse
      && (row.workflow.contactedAt ?? row.workflow.finalizedAt ?? "") > (row.latestFollowUp?.createdAt ?? "")
      ? row.workflow.parentResponse : row.latestFollowUp?.content;
    return (
      <ActivityAssessmentDraftProvider key={row.id} row={row}>
        <TableRow
          data-record-state={row.recordState ?? "current"}
          data-followup-row-key={row.id}
          data-followup-active={active}
          data-followup-expanded={expanded}
          data-followup-success={assessmentWorkbenchHasConfirmedEnrollment(row)}
          tabIndex={0}
          aria-expanded={expanded}
          aria-controls={`assessment-details-${row.id}`}
          className="h-16 cursor-pointer focus-visible:outline-none [&>td]:min-w-0"
          onFocusCapture={(event) => { if (followupFocusActivatesRow(event)) setActiveId(row.id); }}
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
          <TableCell data-assessment-state-kind className="px-2 py-2">
            <div className="flex min-w-0 flex-col items-start gap-1">
              <AssessmentStatusTags row={row} locale={locale} showStatus={current || closed || Boolean(row.sourceEnrollmentFacts?.confirmed)} />
              {row.assessmentKind !== "one_to_one" ? <Badge variant="outline" className="whitespace-nowrap border-line bg-line/20 text-muted">{t(`type_${row.assessmentKind}`)}</Badge> : null}
            </div>
          </TableCell>
          <TableCell data-assessment-arrangement className="px-2 py-2">
            <p className="truncate font-medium text-ink"><time dateTime={scheduledAt ?? undefined} aria-label={formatDashboardDate(scheduledAt, dateContext, { time: true, full: true })}>{formatDashboardDate(scheduledAt, dateContext, { time: true })}</time></p>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted" data-assessment-support-owner>
              <span className="max-w-[50%] truncate font-medium text-ink" title={fieldM.supportOwner}
                aria-label={`${fieldM.supportOwner}: ${row.supportOwnerName || "—"}`}>{row.supportOwnerName || "—"}</span>
              <span aria-hidden>·</span>
              <span className="truncate" title={row.location || undefined}>{row.location || "—"}</span>
            </div>
          </TableCell>
          <TableCell className="px-2 py-2">
            {closed?<p className="text-muted">—</p>:completed && row.assessment && (score.score !== null || band) ? (
              <div className="flex min-w-0 items-center gap-2">
                {score.score !== null ? <span className={cn("shrink-0 text-sm font-semibold tabular-nums", score.invalid ? "text-rose" : "text-ink")}
                  title={scoreDisplay.hint || undefined} aria-label={`${scoreDisplay.label}${scoreDisplay.hint ? ` · ${scoreDisplay.hint}` : ""}`}>
                  {scoreDisplay.label}
                </span> : null}
                {band ? (
                  <Badge variant="outline" className={cn(band === "x_plus" ? "border-rose/30 bg-cheek/25 text-ink" : band === "g_plus" ? "border-crater/40 bg-moon/40 text-ink" : "border-leaf-deep/35 bg-leaf/20 text-leaf-deep")}>
                    {teacherT(`band_${band}`)}
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
            {current && row.quickEntry && !row.quickEntry.finalizedAt && !row.assessmentCompletedAt ? <p className="mt-1 text-[11px] text-crater" data-assessment-pending-result>
              {quickT("pendingResult")}{row.quickEntry.values.score !== null ? ` · ${row.quickEntry.values.score}` : ""}</p> : null}
            {current && row.assessment?.resultSource && row.assessment.resultSource !== "legacy" ? <p className="mt-1 text-[11px] text-muted">
              {quickT(row.assessment.resultSource === "quick_entry" ? "quickResult" : "teacherResult")}{row.assessment.recordedByName ? ` · ${row.assessment.recordedByName}` : ""}</p> : null}
          </TableCell>
          <TableCell className="px-2 py-2">
            <p className={cn("line-clamp-2 whitespace-normal leading-5", conclusion ? "text-ink" : "text-muted")} title={conclusion || undefined}>
              {conclusion || (closed ? "—" : completed ? t("conclusionPending") : t("stageAssessmentPending"))}
            </p>
          </TableCell>
          <TableCell data-assessment-current-work className="px-2 py-2">
            {current && !closed && row.workflow?.nextContactAt ? <p className="mb-1 text-[11px] text-crater" data-assessment-next-contact>
              <time dateTime={row.workflow.nextContactAt}>{formatDashboardDate(row.workflow.nextContactAt, dateContext, { time: true })}</time>
            </p> : null}
            <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
              <span role="img" title={t(row.assessorSource === "actual" ? "actualAssessor" : "assignedAssessor")}
                aria-label={t(row.assessorSource === "actual" ? "actualAssessor" : "assignedAssessor")} className="shrink-0">
                {row.assessorSource === "actual" ? <UserCheck aria-hidden className="size-4 text-leaf-deep" /> : <CalendarClock aria-hidden className="size-4 text-crater" />}
              </span>
              <span className="truncate font-medium text-ink" title={row.assessorName || undefined}>{row.assessorName || "—"}</span>
              {!current && row.assessment ? <BusinessRecordRevisionButton kind="assessment" recordId={row.assessment.id} subject={row.name}/> : null}
            </div>
            {mayAssess && row.assessmentKind === "one_to_one" ? <div className="mt-1" data-assessment-question-entry
              title={quickT(row.assessmentCompletedAt ? "questionCompleted" : row.assessmentStartedAt ? "questionInProgress" : row.teacherRequired ? "questionRequired" : "questionOptional")}>
              <TeacherAssessmentEntryButton registrationId={row.registrationId} invitationId={row.invitationId} />
            </div> : null}
          </TableCell>
          <TableCell data-assessment-latest-update className="px-2 py-2 text-[11px] text-muted">
            <p className="truncate tabular-nums"><time dateTime={recordedAt ?? undefined} title={formatDashboardDate(recordedAt, dateContext, { time: true, full: true })} aria-label={formatDashboardDate(recordedAt, dateContext, { time: true, full: true })}>{formatDashboardDate(recordedAt, dateContext, { time: true })}</time></p>
            {current && latestContext?.trim() ? <p data-current-situation className="mt-0.5 truncate leading-4">{latestContext}</p> : null}
          </TableCell>
        </TableRow>

        <FollowupInlineDetails open={expanded} keepMounted={retained}
          onOpenChange={(open) => changeDetails(row.id, open)} title={row.name} hideTitle
          active={active} onActivate={() => setActiveId(row.id)} colSpan={7} id={`assessment-details-${row.id}`}>
          {row.sourceCompletion?<div className="px-4 py-3"><SourceCompletionNotice summary={row.sourceCompletion} locale={locale}/></div>:null}
          {closed?<div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-muted">
            <span>{sourceM.closedHint}</span>
            {row.sourceRecordId&&row.registrationId?<BusinessRecordRevisionButton kind="activity" recordId={row.registrationId} subject={row.name}/>:null}
          </div>:null}
          {!closed?<AssessmentRecordDetails row={row} stage={stage} conclusion={conclusion} locale={locale}
            canAssess={mayAssess} canSupport={maySupport} canManageAssessor={canManageAssessor}
            canQuickEntry={current && canQuickEntry} canRoute={current && canManageAssessor}
            assessors={assessors} reassigning={reassigningId === row.id} onReassign={(id) => reassignAssessor(row, id)}
            onSaved={saveRow} onNoteSaved={(entry) => saveQuickFollowUp(row, entry.content, entry.createdAt)}
            onSaveAndNext={nextAssessmentWorkbenchRowId(visibleRows.map((item) => item.id), row.id) ? () => advanceFrom(row.id) : undefined}
            onHandoffSaved={(context) => {
              updateDraft(row.id, (current) => ({ ...current, route: context.route }));
              setRows(current => current.map(candidate => candidate.id === row.id || candidate.registrationId === context.registrationId
                ? { ...candidate, enrollmentId: context.enrollmentId } : candidate));
            }} />:null}
        </FollowupInlineDetails>
      </ActivityAssessmentDraftProvider>
    );
  }, [advanceFrom, assessmentT, assessors, canAssess, canManageAssessor, canQuickEntry, canSupport, changeDetails, dateContext, drafts, fieldM.supportOwner, locale, quickT, reassignAssessor, reassigningId, saveQuickFollowUp, saveRow, sourceM.closedHint, t, teacherT, timeZone, updateDraft, visibleRows]);

  return (
    <DashboardPage
      title={hubT("title")}
      density="compact"
      footer={<LeadPoolPagination baseHref="/dashboard/assessments" currentPage={pagination.page} totalPages={pagination.totalPages}
        totalCount={pagination.count} pageSize={pagination.pageSize} onPageChange={(page, size) => { setRetainedView(null); pagination.onPageChange(page, size); }} />}
      commandPanel={(
        <FollowupCommandPanel>

          <DashboardCommandFilters>
            <BusinessRecordStateFilter value={recordState} onChange={setRecordState} locale={locale} />
            <FollowupPrimaryFilter label={filterT("workQueue")} value={assessmentTable.filters.status?.kind === "enum" ? assessmentTable.filters.status.values[0] : "all"}
              options={[...ASSESSMENT_WORKBENCH_QUEUES.map(value => ({ value, label: filterT(`assessments_${value}`) })),{value:'no_show',label:sourceM.noShow}]}
              onValueChange={value => {
                assessmentTable.setFilter("status", value === "all" ? undefined : { kind: "enum", values: [value] });
              }} />
            <FilterSearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
            />
          </DashboardCommandFilters>
        </FollowupCommandPanel>
      )}
    >
      {
        <SchoolSupportTableEntry workspace="assessments" enabled={canSupport} columns={["name","blank","blank","blank","blank","blank","blank"]}><DashboardTableShell data-assessment-unified-workbench data-followup-workbench data-followup-scroll>
          <Table className="w-full min-w-[68rem] table-fixed text-xs" containerClassName="overflow-auto [scrollbar-gutter:stable]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 top-0 z-30 h-9 w-48 border-r border-line bg-card px-2"><DashboardTableColumnHeader label={t("studentColumn")} {...assessmentTable.columnProps("student")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-28 bg-card px-2"><DashboardTableColumnHeader label={t("typeColumn")} {...assessmentTable.columnProps("kind")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-48 bg-card px-2"><DashboardTableColumnHeader label={t("arrangementColumn")} {...assessmentTable.columnProps("arrangement")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-40 bg-card px-2"><DashboardTableColumnHeader label={t("resultColumn")} {...assessmentTable.columnProps("result")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={t("teacherColumn")} {...assessmentTable.columnProps("teacher")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-40 bg-card px-2"><DashboardTableColumnHeader label={t("statusColumn")} {...assessmentTable.columnProps("status")} /></TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-24 bg-card px-2"><DashboardTableColumnHeader label={fieldM.recordedAt} {...assessmentTable.columnProps("updated")} /></TableHead>
              </TableRow>
            </TableHeader>
            <FollowupTableBody onNavigate={(id) => { setActiveId(id); return true; }}>
              <SchoolSupportInsertion after="start" /><SchoolSupportPendingRows workspace="assessments" colSpan={7} />
              {visibleRows.map((row) => <FollowupTableRecord key={row.id} row={row} active={activeId === row.id} expanded={expandedId === row.id} retained={visitedDetails.has(row.id)} render={renderRow} />)}
              {visibleRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-32 px-4 text-center text-sm text-muted">{tableT("filteredEmpty")}</TableCell></TableRow>
              ) : null}
            </FollowupTableBody>
          </Table>
        </DashboardTableShell></SchoolSupportTableEntry>
      }
    </DashboardPage>
  );

}
