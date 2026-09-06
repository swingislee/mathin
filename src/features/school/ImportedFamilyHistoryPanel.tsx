import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { DashboardSection, DashboardTableShell } from './dashboard-page';
import { originalEnrollmentPeriods, originalField, originalFieldName, type ImportedFamilyHistory } from './imported-family-history-contract';
import { getImportedFamilyHistoryMessages } from './imported-family-history-messages';

export function ImportedFamilyHistoryPanel({ data, locale, current }: {
  data: ImportedFamilyHistory; locale: string; current: { status: string; gender: string; grade: number | null };
}) {
  const m = getImportedFamilyHistoryMessages(locale);
  const linked = data.records.filter(record => record.student_id === data.manifest.subject.studentId);
  const recordMap = new Map(data.records.map(record => [record.id, record]));
  const renewal = linked.filter(record => originalField(record, '未报/连报情况'));
  const assessments = linked.filter(record => originalField(record, '思维测评等级'));
  const enrollments = linked.flatMap(record => originalEnrollmentPeriods(record).map(period => ({ ...period, recordId: record.id })));
  const sourceValues = (names: string[]) => [...new Set(linked.flatMap(record => names.map(name => originalField(record, name))).filter(Boolean))].join(' / ') || m.empty;
  const sourceHref = (id: string) => `/dashboard/history-import?record=${encodeURIComponent(id)}#history-archive-detail`;

  return <div className="min-w-0 space-y-6" id="imported-family-history">
    <DashboardSection title={m.title}>
      <p className="text-sm leading-6 text-muted">{m.notesHint}</p>
      {renewal.map(record => <div key={record.id} className="mt-4 space-y-2">
        <h3 className="text-sm font-medium">{m.context} · {record.record_data.tableName}</h3>
        <p className="whitespace-pre-wrap text-sm leading-7">{originalField(record, '未报/连报情况')}</p>
        <Link href={sourceHref(record.id)} className="text-xs text-muted underline underline-offset-4">{m.open}</Link>
      </div>)}
    </DashboardSection>

    <DashboardSection title={m.facts}>
      <div className="space-y-4 text-sm">
        {assessments.map(record => <div key={record.id}>
          <h3 className="font-medium">{m.assessment}</h3>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">{[
            [m.visitDate, originalField(record, '到访日期')], [m.assessmentBand, originalField(record, '思维测评等级')], [m.signup, originalField(record, '报名与否')],
          ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd>{value || m.empty}</dd></div>)}</dl>
        </div>)}
        {enrollments.length > 0 && <div><h3 className="font-medium">{m.enrollment}</h3><ul className="mt-2 space-y-1">{enrollments.map((period, index) => <li key={`${period.recordId}:${index}`}>{period.date || m.empty} · {period.course} · {m.amount} {period.amount || m.empty}</li>)}</ul></div>}
      </div>
    </DashboardSection>

    <DashboardSection title={m.comparison}>
      <DashboardTableShell><Table>
        <TableHeader><TableRow><TableHead>{m.item}</TableHead><TableHead>{m.current}</TableHead><TableHead>{m.original}</TableHead></TableRow></TableHeader>
        <TableBody>{[
          [m.status, current.status, sourceValues(['学生状态'])],
          [m.gender, current.gender || m.empty, sourceValues(['性别'])],
          [m.grade, current.grade ?? m.empty, sourceValues(['年级/25级', '年级', '学生年级', '春季年级'])],
        ].map(([label, value, source]) => <TableRow key={label}><TableCell>{label}</TableCell><TableCell>{value}</TableCell><TableCell>{source}</TableCell></TableRow>)}</TableBody>
      </Table></DashboardTableShell>
      <p className="mt-2 text-xs leading-5 text-muted">{m.compareHint}</p>
    </DashboardSection>

    <DashboardSection title={m.recordCoverage}>
      <p className="text-sm">{m.coverage} {data.manifest.searchedSourceCount} {m.files} · {data.manifest.recordCount} {m.found}</p>
      <p className="mt-1 text-sm">{m.savedBefore} {data.manifest.previousRecordCount} → {m.savedNow} {data.manifest.recordCount}</p>
      <DashboardTableShell className="mt-3"><Table>
        <TableHeader><TableRow><TableHead>{m.source}</TableHead><TableHead>{m.position}</TableHead><TableHead>{m.result}</TableHead></TableRow></TableHeader>
        <TableBody>{data.manifest.coverage.map(item => {
          const record = recordMap.get(item.recordId)!;
          const cells = item.hits.map(hit => hit.fieldId).filter(id => /^[A-Z]+[1-9]\d*$/.test(id));
          return <TableRow key={item.recordId}>
            <TableCell className="align-top"><Link href={sourceHref(record.id)} className="underline underline-offset-4">{record.record_data.tableName}</Link><p className="mt-1 text-xs text-muted">{record.source_data.filename}</p></TableCell>
            <TableCell className="align-top text-xs">{cells.join(' · ') || (record.record_data.sourceRow ? `${record.record_data.sourceRow} ${m.line}` : record.record_data.names.join(' · ') || record.record_data.label)}</TableCell>
            <TableCell className="align-top text-sm">{m[item.category === 'linked' ? 'linked' : item.category === 'roster_mention' ? 'roster' : 'candidate']}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></DashboardTableShell>
      {data.manifest.rosterRecordCount > 0 && <p className="mt-2 text-xs leading-5 text-muted">{m.rosterHint}</p>}
      <p className="mt-2 text-xs leading-5 text-muted">{m.archiveScope}</p>
    </DashboardSection>

    <DashboardSection title={`${m.originals} · ${linked.length}`}>
      <div className="divide-y divide-line">{linked.map(record => <details key={record.id} className="py-3">
        <summary className="cursor-pointer text-sm font-medium">{record.record_data.tableName} · {record.record_data.dateLabel || m.empty}</summary>
        <p className="mt-2 text-xs text-muted">{record.source_data.filename}</p>
        <dl className="mt-3 space-y-3">{record.record_data.cells.filter(cell => cell.kind === 'narrative' && cell.text.trim()).map(cell => <div key={cell.fieldId}><dt className="text-xs text-muted">{originalFieldName(cell.fieldName)}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{cell.text}</dd></div>)}</dl>
        <details className="mt-3"><summary className="cursor-pointer text-xs text-muted">{m.allFields}</summary>
          <DashboardTableShell className="mt-2"><Table><TableHeader><TableRow><TableHead>{m.field}</TableHead><TableHead>{m.value}</TableHead></TableRow></TableHeader>
            <TableBody>{record.record_data.cells.map(cell => <TableRow key={cell.fieldId}><TableCell className="w-44 align-top text-xs">{cell.fieldName}</TableCell><TableCell className="whitespace-pre-wrap break-words text-sm">{cell.text || m.empty}</TableCell></TableRow>)}</TableBody>
          </Table></DashboardTableShell>
        </details>
      </details>)}</div>
    </DashboardSection>
  </div>;
}
