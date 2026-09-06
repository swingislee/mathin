import { TableCell, TableRow } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { HistoricalRecordBadge } from './BusinessRecordStateFilter';
import { businessRecordMessages } from './business-record-state-contract';
import type { HistoricalFirstContactRow } from './historical-first-contact-contract';
import { Student360Trigger } from './Student360Sheet';

export function HistoricalFirstContactRows({rows,locale}:{rows:HistoricalFirstContactRow[];locale:string}) {
  const m=businessRecordMessages(locale);
  return rows.map(row=><TableRow key={`student:${row.studentId}`} data-record-state="historical" data-first-contact-missing={row.studentId} className="align-top [&>td]:px-2 [&>td]:py-3">
    <TableCell className="sticky left-0 z-10 border-r border-line bg-card"><Student360Trigger subject={{studentId:row.studentId,leadId:null}} fallback={{name:row.name,phone:row.phone,grade:row.grade}}/><p className="mt-1 font-mono text-[11px] text-muted">{row.phone}</p></TableCell>
    <TableCell><HistoricalRecordBadge locale={locale}/><p className="mt-2 font-medium">{m.firstContactMissing}</p></TableCell>
    <TableCell><p className="text-xs leading-6 text-muted">{m.firstContactHint}</p><details className="mt-2"><summary className="cursor-pointer text-xs">{m.recordedOnly}</summary><p className="mt-2 whitespace-pre-wrap leading-6">{row.context||m.unknown}</p></details><Link href={`/dashboard/students/${row.studentId}?tab=history`} className="mt-2 inline-block text-xs underline">{m.viewStudent}</Link></TableCell>
    <TableCell>{m.unknown}</TableCell>
  </TableRow>);
}
