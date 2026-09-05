import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardEmptyState,
  DashboardSection,
  DashboardTableShell,
} from "./dashboard-page";
import { HistoryArchiveColumnFilter, HistoryArchivePagination, HistoryArchiveSearch } from "./HistoryArchiveFilters";
import {
  historyArchiveHref,
  type HistoryArchiveCell,
  type HistoryArchiveDetail,
  type HistoryArchiveEntity,
  type HistoryArchiveFilters,
  type HistoryArchivePageData,
  type HistoryArchiveRow,
  type HistoryMatchStatus,
} from "./history-archive-contract";
import { historyArchiveMatchExplanation, historyArchiveWarningExplanation, type HistoryArchiveMessages } from "./history-archive-messages";

export function HistoryArchiveCommandBar({ filters, messages }: { filters: HistoryArchiveFilters; messages: HistoryArchiveMessages }) {
  return (
    <DashboardCommandPanel>
      <DashboardCommandState><Badge variant="outline">{messages.preview}</Badge></DashboardCommandState>
      <DashboardCommandFilters>
        <HistoryArchiveSearch key={filters.q} filters={filters} messages={messages} />
      </DashboardCommandFilters>
      <DashboardCommandActions>
        <Link href="/dashboard/history-import" className={buttonVariants({ variant: "ghost", size: "sm" })}>{messages.reset}</Link>
        {filters.record ? <Link href={historyArchiveHref(filters, { record: "", relatedPage: 1 })} className={buttonVariants({ variant: "ghost", size: "sm" })}>{messages.closeDetail}</Link> : null}
      </DashboardCommandActions>
    </DashboardCommandPanel>
  );
}

function MatchBadge({ status, messages }: { status: HistoryMatchStatus; messages: HistoryArchiveMessages }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", status === "matched" && "text-leaf-deep", status === "review" && "border-crater text-ink")}>
      {messages[status]}
    </Badge>
  );
}

function RecordLink({ record, filters, children }: { record: HistoryArchiveRow; filters: HistoryArchiveFilters; children: React.ReactNode }) {
  return <Link href={`${historyArchiveHref(filters, { record: record.id, relatedPage: 1 })}#history-archive-detail`} className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-rose">{children}</Link>;
}

export function HistoryArchiveWorkbench({ data, detail, filters, messages }: {
  data: HistoryArchivePageData;
  detail: HistoryArchiveDetail | null;
  filters: HistoryArchiveFilters;
  messages: HistoryArchiveMessages;
}) {
  const { summary } = data;
  if (!summary.available) {
    return <DashboardSection title={messages.unavailableTitle}><DashboardEmptyState>{messages.unavailableHint}</DashboardEmptyState></DashboardSection>;
  }

  const metrics = [
    [messages.sources, summary.sourceCount],
    [messages.tables, summary.tableCount],
    [messages.records, summary.recordCount],
    [messages.contentRecords, summary.contentRecordCount],
    [messages.matched, summary.matchedCount],
    [messages.singleCandidate, summary.singleCandidateReviewCount],
    [messages.multipleCandidates, summary.multipleCandidateReviewCount],
    [messages.unmatched, summary.unmatchedCount],
  ] as const;

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0 space-y-3">
        <p className="text-sm leading-6 text-muted">{messages.previewHint}</p>
        <dl className="flex flex-wrap gap-x-7 gap-y-3">
          {metrics.map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-lg tabular-nums text-ink">{value.toLocaleString()}</dd></div>)}
        </dl>
        <p className="text-xs leading-5 text-muted">{messages.exclusions}：{messages.excludedCommunications} {summary.excludedCommunicationCount} · {messages.correctedGrades} {summary.gradeCorrectionCount} · {messages.archivedClasses} {summary.archivedClassCount}</p>
        <p className="text-xs leading-5 text-muted">{messages.sourceLanguage}</p>
        {summary.generatedAt ? <p className="text-xs text-muted">{messages.snapshotTime}：<time dateTime={summary.generatedAt}>{summary.generatedAt}</time></p> : null}
      </div>

      <div className={cn("grid min-w-0 gap-7", filters.record && "2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]")}>
        <DashboardSection title={`${messages.filteredRecords} · ${data.total.toLocaleString()}`}>
          <DashboardTableShell>
            <Table containerClassName="max-h-[65vh] overflow-auto" className="min-w-[42rem]">
              <TableHeader className="sticky top-0 z-10 bg-paper">
                <TableRow>
                  <TableHead className="w-[44%]">{messages.rowLabel}</TableHead>
                  <TableHead className="w-[27%] py-2">
                    <HistoryArchiveColumnFilter
                      filters={filters}
                      field="table"
                      label={messages.source}
                      options={[{ value: "__all__", label: messages.allTables }, ...summary.tables.map((table) => ({ value: table.id, label: `${table.name} · ${table.sourceName} (${table.records.toLocaleString()})` }))]}
                    />
                  </TableHead>
                  <TableHead className="w-[29%] py-2">
                    <HistoryArchiveColumnFilter filters={filters} field="status" label={messages.status} options={[
                      { value: "all", label: messages.allStatuses },
                      { value: "matched", label: messages.matched },
                      { value: "review", label: messages.review },
                      { value: "unmatched", label: messages.unmatched },
                    ]} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.length ? data.rows.map((row) => (
                  <TableRow key={row.id} aria-selected={row.id === filters.record} className={cn("align-top", row.id === filters.record && "bg-moon/30")}>
                    <TableCell className="align-top">
                      <RecordLink record={row} filters={filters}>{row.label || row.names.join("、") || messages.noName}</RecordLink>
                      {row.phones.length ? <p className="mt-1 break-words text-xs text-muted">{row.phones.join(" · ")}</p> : null}
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-muted">{row.excerpt || messages.noText}</p>
                    </TableCell>
                    <TableCell className="align-top">
                      <p className="break-words text-xs text-ink">{row.tableName}</p>
                      <p className="mt-1 break-words text-xs text-muted">{row.sourceName}</p>
                      <p className="mt-2 break-words text-xs text-muted">{messages.date}：{row.dateLabel || messages.noDate}</p>
                    </TableCell>
                    <TableCell className="align-top">
                      <MatchBadge status={row.matchStatus} messages={messages} />
                      {row.entity ? <p className="mt-2 text-xs">{messages[row.entity.kind]} · {row.entity.name}</p> : null}
                      {row.candidateCount > 0 && row.matchStatus !== "matched" ? <p className="mt-2 text-xs text-muted">{messages.candidateCount} {row.candidateCount}</p> : null}
                      <p className="mt-2 line-clamp-3 break-words text-xs leading-5 text-muted">{historyArchiveMatchExplanation(row.matchReason, messages)}</p>
                    </TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={3}><DashboardEmptyState>{messages.noResults}</DashboardEmptyState></TableCell></TableRow>}
              </TableBody>
            </Table>
          </DashboardTableShell>
          <HistoryArchivePagination filters={filters} page={data.page} pageSize={data.pageSize} total={data.total} messages={messages} />
        </DashboardSection>

        {filters.record ? (
          <aside id="history-archive-detail" aria-label={messages.detail} className="min-w-0 scroll-mt-24 2xl:border-l 2xl:border-line 2xl:pl-7">
            {detail ? <ArchiveDetail detail={detail} filters={filters} messages={messages} /> : <DashboardEmptyState>{messages.missingRecord}</DashboardEmptyState>}
          </aside>
        ) : <p className="text-sm text-muted">{messages.selectHint}</p>}
      </div>
    </div>
  );
}

function EntitySummary({ entity, messages }: { entity: HistoryArchiveEntity; messages: HistoryArchiveMessages }) {
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <p className="font-medium text-ink">{messages[entity.kind]} · {entity.name}</p>
      {entity.phones.length ? <p className="break-words text-xs text-muted">{entity.phones.join(" · ")}</p> : null}
      <p className="text-xs text-muted">{entity.grade === null ? messages.gradeMissing : `${messages.grade} ${entity.grade}`}</p>
      {entity.gradeCorrection ? <p className="text-xs leading-5 text-muted">{messages.gradeCorrection} · {messages.gradeCorrectionHint}</p> : null}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer py-1">{messages.entityKeys}</summary>
        <ul className="space-y-1 pl-4">{entity.sourceKeys.map((key) => <li key={key} className="break-all font-mono">{key}</li>)}</ul>
      </details>
    </div>
  );
}

function ArchiveDetail({ detail, filters, messages }: { detail: HistoryArchiveDetail; filters: HistoryArchiveFilters; messages: HistoryArchiveMessages }) {
  const { record } = detail;
  const originalFields = detail.cells.filter((cell) => cell.kind !== "system");
  const systemFields = detail.cells.filter((cell) => cell.kind === "system");
  const warnings = [...new Set(record.warnings.map((warning) => historyArchiveWarningExplanation(warning, messages)))];
  return (
    <div className="space-y-7">
      <DashboardSection title={record.label || record.names.join("、") || messages.detail} description={messages.detail}>
        <div className="space-y-3">
          <MatchBadge status={record.matchStatus} messages={messages} />
          <p className="whitespace-pre-wrap break-words text-sm leading-6"><span className="text-muted">{messages.matchReason}：</span>{historyArchiveMatchExplanation(record.matchReason, messages)}</p>
          {record.entity ? <div><h3 className="mb-2 text-xs text-muted">{messages.matchedEntity}</h3><EntitySummary entity={record.entity} messages={messages} /></div> : null}
          {record.matchStatus !== "matched" ? <div className="space-y-3">
            <h3 className="text-sm font-medium">{messages.candidates}</h3>
            <p className="text-xs leading-5 text-muted">{messages.candidateHint}</p>
            {detail.candidates.length ? detail.candidates.map((candidate) => <EntitySummary key={candidate.key} entity={candidate} messages={messages} />) : <p className="text-xs leading-5 text-muted">{messages.noCandidates}</p>}
          </div> : null}
          {warnings.length ? <div className="space-y-2"><h3 className="text-xs text-muted">{messages.warnings}</h3><ul className="list-disc space-y-1 pl-4 text-xs leading-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
        </div>
      </DashboardSection>

      <DashboardSection title={messages.fields} description={messages.sourceLanguage}>
        <dl className="space-y-5">
          {originalFields.map((cell, index) => <ArchiveField key={`${cell.fieldId}-${index}`} cell={cell} messages={messages} />)}
        </dl>
        {systemFields.length ? <details className="mt-5 min-w-0">
          <summary className="cursor-pointer py-1 text-sm font-medium">{messages.systemFields} · {systemFields.length}</summary>
          <p className="mt-1 text-xs leading-5 text-muted">{messages.systemFieldsHint}</p>
          <dl className="mt-4 space-y-5">{systemFields.map((cell, index) => <ArchiveField key={`${cell.fieldId}-${index}`} cell={cell} messages={messages} />)}</dl>
        </details> : null}
      </DashboardSection>

      <DashboardSection title={messages.provenance}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs leading-5">
          <dt className="text-muted">{messages.sourceFile}</dt><dd className="break-words">{record.sourceName}</dd>
          <dt className="text-muted">{messages.source}</dt><dd className="break-words">{record.tableName}</dd>
          <dt className="text-muted">{messages.rowNumber}</dt><dd>{record.sourceRow ?? messages.noSourceRow}</dd>
          <dt className="text-muted">{messages.recordId}</dt><dd className="break-all font-mono">{record.sourceRecordId}</dd>
          <dt className="text-muted">{messages.archiveId}</dt><dd className="break-all font-mono">{record.id}</dd>
          <dt className="text-muted">{messages.date}</dt><dd className="whitespace-pre-wrap break-words">{record.dateLabel || messages.noDate}</dd>
          <dt className="text-muted">{messages.sourceHash}</dt><dd className="break-all font-mono">{detail.sourceHash}</dd>
        </dl>
        <p className="mt-3 text-xs leading-5 text-muted">{messages.dateHint}</p>
      </DashboardSection>

      {record.entity && record.matchStatus === "matched" ? <DashboardSection title={messages.related} description={messages.relatedHint}>
        {detail.related.length ? (
          <>
            <ul className="space-y-4">
              {detail.related.map((row) => <li key={row.id} className="min-w-0 text-sm">
                <RecordLink record={row} filters={filters}>{row.label || row.tableName}</RecordLink>
                <p className="mt-1 break-words text-xs text-muted">{row.tableName} · {row.dateLabel || messages.noDate}</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-muted">{row.excerpt || messages.noText}</p>
              </li>)}
            </ul>
            <HistoryArchivePagination related filters={filters} page={detail.relatedPage} pageSize={detail.relatedPageSize} total={detail.relatedTotal} messages={messages} />
          </>
        ) : <p className="text-xs leading-5 text-muted">{messages.noRelated}</p>}
      </DashboardSection> : null}
    </div>
  );
}

function ArchiveField({ cell, messages }: { cell: HistoryArchiveCell; messages: HistoryArchiveMessages }) {
  return (
    <div className="min-w-0">
      <dt className="flex flex-wrap items-baseline gap-2 text-sm font-medium"><span>{cell.fieldName}</span><span className="text-xs font-normal text-muted">{messages[cell.kind]}</span></dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-7">{cell.text || <span className="text-muted">{messages.emptyValue}</span>}</dd>
      <dd className="mt-1">
        <details className="min-w-0 text-xs text-muted">
          <summary className="cursor-pointer py-1">{messages.rawValue}</summary>
          <p className="break-all py-1">{messages.fieldId}：{cell.fieldId} · {messages.fieldType}：{cell.type ?? messages.emptyValue}</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all py-2 font-mono text-xs leading-5">{JSON.stringify(cell.rawValue, null, 2) ?? "null"}</pre>
        </details>
      </dd>
    </div>
  );
}
