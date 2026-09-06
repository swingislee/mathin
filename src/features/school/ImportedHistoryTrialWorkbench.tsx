import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState, DashboardEmptyState, DashboardSection, DashboardTableShell } from './dashboard-page';
import { historyTrialHref, normalizeHistoryTrialSearch, type ImportedHistoryTrial } from './history-import-trial-contract';
import type { HistoryImportTrialMessages } from './history-import-trial-messages';

export function ImportedHistoryTrialCommands({ locale, q, messages: m }: { locale: string; q: string; messages: HistoryImportTrialMessages }) {
  return <DashboardCommandPanel>
    <DashboardCommandState><Badge variant="outline">{m.local}</Badge></DashboardCommandState>
    <DashboardCommandFilters>
      <form action={`/${locale}/dashboard/history-import/test`} className="flex flex-wrap items-center gap-2">
        <Label htmlFor="history-trial-search" className="sr-only">{m.search}</Label>
        <Input id="history-trial-search" name="q" defaultValue={q} maxLength={200} placeholder={m.placeholder} className="w-72 max-w-full" />
        <Button type="submit" variant="secondary" size="sm">{m.searchAction}</Button>
      </form>
    </DashboardCommandFilters>
    <DashboardCommandActions>
      <Link href={historyTrialHref()} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{m.reset}</Link>
      <Link href="/dashboard/history-import" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{m.preview}</Link>
    </DashboardCommandActions>
  </DashboardCommandPanel>;
}

export function ImportedHistoryTrialWorkbench({ data, q, selectedCase, messages: m }: {
  data: ImportedHistoryTrial | null; q: string; selectedCase: string; messages: HistoryImportTrialMessages;
}) {
  if (!data) return <DashboardEmptyState>{m.unavailable}</DashboardEmptyState>;
  const tokens = normalizeHistoryTrialSearch(q).split(' ').filter(Boolean);
  const recordMap = new Map(data.records.map(record => [record.id, record]));
  const cases = data.manifest.cases.filter(item => !tokens.length || item.recordIds.some(id => {
    const record = recordMap.get(id);
    return record && tokens.every(token => record.search_text.includes(token));
  }));
  const activeCase = cases.find(item => item.key === selectedCase) ?? cases[0];
  const originals = activeCase?.recordIds.flatMap(id => recordMap.get(id) ?? []) ?? [];
  const candidateMap = new Map(originals.flatMap(record => record.candidate_data).map(entity => [entity.key, entity]));
  const existingStudent = originals.find(record => record.student_id)?.student_id;
  const metrics = [
    [m.records, data.manifest.recordCount], [m.linked, data.manifest.linkedIdentities],
    [m.review, data.manifest.reviewCases], [m.unmatched, data.manifest.unmatchedCases],
    [m.replay, data.verification.attempts >= 2 ? data.verification.insertedRecords : m.notVerified],
    [m.work, data.verification.currentWorkUnchanged ? 0 : m.notVerified],
  ];
  return <div className="min-w-0 space-y-6">
    <p className="text-sm leading-6 text-muted">{m.scope}</p>
    <dl className="flex flex-wrap gap-x-7 gap-y-3">
      {metrics.map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-lg tabular-nums text-ink">{value}</dd></div>)}
    </dl>
    <DashboardSection title={`${m.sampleList} · ${cases.length}`}>
      <DashboardTableShell>
        <Table>
          <TableHeader><TableRow><TableHead>{m.object}</TableHead><TableHead>{m.identity}</TableHead><TableHead>{m.sourceCount}</TableHead><TableHead><span className="sr-only">{m.open}</span></TableHead></TableRow></TableHeader>
          <TableBody>{cases.map(item => <TableRow key={item.key} data-state={item.key === activeCase?.key ? 'selected' : undefined}>
            <TableCell><div className="font-medium">{item.label}</div><div className="text-xs text-muted">{item.phones.join(' · ')}</div></TableCell>
            <TableCell>{item.kind === 'matched' ? `${m.matched} · ${item.entityKind === 'student' ? m.student : m.lead}` : item.kind === 'review' ? m.pending : m.unlinked}</TableCell>
            <TableCell className="tabular-nums">{item.recordIds.length}</TableCell>
            <TableCell><Link href={`${historyTrialHref(q, item.key)}#imported-history-originals`} className="underline underline-offset-4">{m.open}</Link></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </DashboardTableShell>
      {!cases.length && <DashboardEmptyState>{m.noResults}</DashboardEmptyState>}
    </DashboardSection>
    {activeCase && <div id="imported-history-originals" className="scroll-mt-6 space-y-5">
      <DashboardSection title={`${activeCase.label} · ${m.history}`}>
        <p className="text-xs leading-5 text-muted">{m.sourceLanguage} {data.verification.originalsEqual ? m.sourceEqual : ''}</p>
        {existingStudent && <p className="mt-2 text-sm"><Link href={`/dashboard/students/${existingStudent}?tab=followups`} className="underline underline-offset-4">{m.studentProfile}</Link></p>}
        {activeCase.kind === 'review' && candidateMap.size > 0 && <div className="mt-3 space-y-2 text-sm">
          <p className="font-medium">{m.candidates}</p><p className="text-muted">{m.candidateHint}</p>
          <ul className="space-y-1">{[...candidateMap.values()].map(entity => <li key={entity.key}>{entity.name} · {entity.kind === 'student' ? m.student : m.lead} · {entity.phones.join(' · ')}</li>)}</ul>
        </div>}
      </DashboardSection>
      {originals.map((stored, index) => {
        const record = stored.record_data;
        const narratives = record.cells.filter(cell => cell.kind === 'narrative' && cell.text.trim());
        return <DashboardSection key={stored.id} title={`${index + 1}. ${record.tableName}`}>
          <div className="space-y-1 text-xs text-muted">
            <p>{m.source}：{stored.source_data.filename}</p>
            <p>{m.date}：{record.dateLabel || m.noDate}</p>
            <p className="break-all">{m.recordId}：{record.sourceRecordId}</p>
          </div>
          <dl className="mt-3 space-y-3">{narratives.map(cell => <div key={cell.fieldId}><dt className="text-xs text-muted">{cell.fieldName}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{cell.text}</dd></div>)}</dl>
          <details className="mt-4" open={!narratives.length}>
            <summary className="cursor-pointer text-sm font-medium">{m.original} · {record.cells.length}</summary>
            <DashboardTableShell className="mt-2">
              <Table><TableHeader><TableRow><TableHead>{m.field}</TableHead><TableHead>{m.text}</TableHead></TableRow></TableHeader>
                <TableBody>{record.cells.map(cell => <TableRow key={cell.fieldId}>
                  <TableCell className="w-44 align-top text-xs">{cell.fieldName}</TableCell>
                  <TableCell className="whitespace-pre-wrap break-words text-sm leading-6">{cell.text || m.empty}
                    {cell.rawValue !== null && cell.rawValue !== undefined && <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">{m.nonText}</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(cell.rawValue, null, 2)}</pre></details>}
                  </TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </DashboardTableShell>
          </details>
        </DashboardSection>;
      })}
    </div>}
    <DashboardSection title={m.checkTitle}>
      <p className="mb-3 text-xs leading-5 text-muted">{m.checkHint}</p>
      <DashboardTableShell><Table>
        <TableHeader><TableRow><TableHead>{m.item}</TableHead><TableHead>{m.before}</TableHead><TableHead>{m.after}</TableHead></TableRow></TableHeader>
        <TableBody>{[
          ['students', m.students], ['leads', m.leads], ['families', m.families], ['lead_next_actions', m.nextActions],
          ['course_opportunities', m.opportunities], ['renewal_cycle_entries', m.renewals], ['class_support_tasks', m.supportTasks],
        ].map(([table, label]) => <TableRow key={table}><TableCell>{label}</TableCell><TableCell>{data.verification.before?.[table] ?? m.notVerified}</TableCell><TableCell>{data.verification.after?.[table] ?? m.notVerified}</TableCell></TableRow>)}</TableBody>
      </Table></DashboardTableShell>
    </DashboardSection>
  </div>;
}
