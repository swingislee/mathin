import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { DashboardSection, DashboardTableShell } from './dashboard-page';
import type { BusinessHistoryKind, StudentBusinessHistory } from './student-business-history-contract';
import { getStudentBusinessHistoryMessages } from './student-business-history-messages';
import { hasBusinessFeedbackOwner, historicalAssessmentFeedback, relatedBusinessCommunications, uniqueBusinessFeedback } from './business-record-notes';
import { businessRecordMessages } from './business-record-state-contract';
import { BusinessRecordRevisionButton } from './BusinessRecordRevisionButton';

type SourceReference = { source_record_id: string; source_field_ids: string[] };
export function BusinessHistoryEvidence({ data, reference, locale }: {data: StudentBusinessHistory; reference: SourceReference; locale: string}) {
  const source = data.sources[reference.source_record_id];
  const m = getStudentBusinessHistoryMessages(locale);
  if(!source)return null;
  return <details className="mt-2 text-xs text-muted">
    <summary className="cursor-pointer">{m.source}</summary>
    <p className="mt-2">{source.filename} · {source.tableName}</p>
    <dl className="mt-2 space-y-2">{source.cells.filter(cell=>reference.source_field_ids.includes(cell.fieldId)).map(cell=><div key={cell.fieldId}>
      <dt>{cell.fieldName}</dt><dd className="whitespace-pre-wrap text-ink">{cell.text || m.unknown}</dd>
    </div>)}</dl>
    <Link href={`/dashboard/history-import?record=${encodeURIComponent(reference.source_record_id)}#history-archive-detail`} className="mt-2 inline-block underline underline-offset-4">{m.original}</Link>
  </details>;
}

export function BusinessHistorySections({ data, locale, kind, showStudent = false, query = '' }: {
  data: StudentBusinessHistory; locale: string; kind?: BusinessHistoryKind; showStudent?: boolean; query?: string;
}) {
  const m=getStudentBusinessHistoryMessages(locale);
  const recordM=businessRecordMessages(locale);
  const include=(value:BusinessHistoryKind)=>!kind||kind===value;
  const needle=query.trim().toLocaleLowerCase(locale);
  const visible=<T extends {student_id:string}>(rows:T[])=>rows.filter(row=>!needle||`${data.students[row.student_id]??''} ${JSON.stringify(row)}`.toLocaleLowerCase(locale).includes(needle));
  const renewals=visible(data.renewals), activities=visible(data.activities), assessments=visible(data.assessments), enrollments=visible(data.enrollments);
  const communications=visible(data.communications.filter(row=>kind==='communication'||!hasBusinessFeedbackOwner(data,row)));
  const renewalConversations=visible(data.communications.filter(row=>row.context_kind==='renewal'&&hasBusinessFeedbackOwner(data,row)));
  const studentCell=(studentId:string,currentKind:BusinessHistoryKind)=>showStudent?<TableCell className="align-top"><Link href={`/dashboard/students/${studentId}?tab=history&history=${currentKind}`} className="underline underline-offset-4">{data.students[studentId]??m.unknown}</Link></TableCell>:null;
  const studentHead=showStudent?<TableHead>{m.student}</TableHead>:null;
  const empty=<p className="text-sm text-muted">{m.empty}</p>;

  return <div className="min-w-0 space-y-7" id="student-business-history">
    {include('renewal')&&<DashboardSection title={`${m.renewal} · ${renewals.length}`}>
      {!renewals.length?empty:<DashboardTableShell><Table>
        <TableHeader><TableRow>{studentHead}<TableHead>{m.period}</TableHead><TableHead>{m.intention}</TableHead><TableHead>{m.outcome}</TableHead><TableHead>{m.currentClass}</TableHead></TableRow></TableHeader>
        <TableBody>{renewals.map(row=><TableRow key={row.id} id={row.id}>
          {studentCell(row.student_id,'renewal')}
          <TableCell className="align-top whitespace-nowrap">{row.period_year??m.unknown} {row.period_key==='summer'?m.summer:m.autumn}</TableCell>
          <TableCell className="align-top"><p className="max-w-xl whitespace-pre-wrap leading-6">{row.decision_note}</p><BusinessHistoryEvidence data={data} reference={row} locale={locale}/></TableCell>
          <TableCell className="align-top">{row.outcome==='renewed'?m.renewed:row.outcome==='not_renewed'?m.notRenewed:m.unknown}</TableCell>
          <TableCell className="align-top">{[row.class_label,row.teacher_label].filter(Boolean).join(' · ')||m.unknown}<BusinessRecordRevisionButton kind="renewal" recordId={row.id} subject={data.students[row.student_id]}/></TableCell>
        </TableRow>)}</TableBody>
      </Table></DashboardTableShell>}
    </DashboardSection>}

    {include('renewal')&&renewalConversations.map(row=><section key={row.id} id={row.id}>
      <h3 className="text-sm font-medium">{m.renewalContext}</h3>
      <p className="mt-1 text-xs text-muted">{row.occurred_on??m.dateUnknown} · {m.author}：{row.author_label??m.unknown}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{uniqueBusinessFeedback(row.content)}</p>
      <BusinessHistoryEvidence data={data} reference={row} locale={locale}/>
      <BusinessRecordRevisionButton kind="communication" recordId={row.id} subject={data.students[row.student_id]}/>
    </section>)}

    {include('activity')&&<DashboardSection title={`${m.activity} · ${activities.length}`}>
      {!activities.length?empty:<DashboardTableShell><Table>
        <TableHeader><TableRow>{studentHead}<TableHead>{m.activityName}</TableHead><TableHead>{m.registeredOn}</TableHead><TableHead>{m.participation}</TableHead><TableHead>{m.result}</TableHead></TableRow></TableHeader>
        <TableBody>{activities.map(row=><TableRow key={row.id} id={row.id}>
          {studentCell(row.student_id,'activity')}
          <TableCell className="align-top">{row.activity_name}<p className="mt-1 text-xs text-muted">{m.occurredOn}：{row.occurred_on??m.unknown}</p><BusinessHistoryEvidence data={data} reference={row} locale={locale}/></TableCell>
          <TableCell className="align-top whitespace-nowrap">{row.registered_on??m.unknown}</TableCell>
          <TableCell className="align-top">{row.participation_status==='registered'?m.registered:row.participation_status==='attended'?m.attended:row.participation_status==='no_show'?m.noShow:m.unknown}</TableCell>
          <TableCell className="align-top">{row.reported_result||m.unknown}{row.reported_result&&<p className="mt-1 text-xs text-muted">{m.reportedResult}{row.result_link_status==='edition_unconfirmed'?` · ${m.editionPending}`:''}</p>}
            <BusinessRecordRevisionButton kind="activity" recordId={row.id} subject={data.students[row.student_id]}/>
            {row.result_source_record_id&&<BusinessHistoryEvidence data={data} reference={{source_record_id:row.result_source_record_id,source_field_ids:row.result_field_ids}} locale={locale}/>}
          </TableCell>
        </TableRow>)}</TableBody>
      </Table></DashboardTableShell>}
    </DashboardSection>}

    {include('assessment')&&<DashboardSection title={`${m.assessment} · ${assessments.length}`}>
      {!assessments.length?empty:<DashboardTableShell><Table>
        <TableHeader><TableRow>{studentHead}<TableHead>{m.assessedOn}</TableHead><TableHead>{m.band}</TableHead><TableHead>{recordM.historicalFeedback}</TableHead></TableRow></TableHeader>
        <TableBody>{assessments.map(row=><TableRow key={row.id} id={row.id}>
          {studentCell(row.student_id,'assessment')}
          <TableCell className="align-top whitespace-nowrap">{row.assessed_on??m.unknown}<BusinessHistoryEvidence data={data} reference={row} locale={locale}/></TableCell>
          <TableCell className="align-top">{row.assessment_band}<p className="mt-1 text-xs text-muted">{m.score}：{row.score??m.unknown}</p></TableCell>
          <TableCell className="max-w-xl align-top whitespace-pre-wrap leading-6">{historicalAssessmentFeedback(row,data)||m.unknown}<BusinessRecordRevisionButton kind="assessment" recordId={row.id} subject={data.students[row.student_id]}/></TableCell>
        </TableRow>)}</TableBody>
      </Table></DashboardTableShell>}
    </DashboardSection>}

    {include('enrollment')&&<DashboardSection title={`${m.enrollment} · ${enrollments.length}`}>
      {!enrollments.length?empty:<><DashboardTableShell><Table>
        <TableHeader><TableRow>{studentHead}<TableHead>{m.period}</TableHead><TableHead>{m.registeredOn}</TableHead><TableHead>{m.amount}</TableHead><TableHead>{m.currentClass}</TableHead><TableHead>{m.schedule}</TableHead></TableRow></TableHeader>
        <TableBody>{enrollments.map(row=><TableRow key={row.id} id={row.id}>
          {studentCell(row.student_id,'enrollment')}
          <TableCell className="align-top">{row.period_label}<BusinessHistoryEvidence data={data} reference={row} locale={locale}/></TableCell>
          <TableCell className="align-top whitespace-nowrap">{row.registered_on??m.unknown}</TableCell>
          <TableCell className="align-top">{row.amount===null?row.amount_original||m.unknown:new Intl.NumberFormat(locale).format(row.amount)}</TableCell>
          <TableCell className="align-top">{[row.class_label,row.teacher_label].filter(Boolean).join(' · ')||m.unknown}</TableCell>
          <TableCell className="align-top">{row.schedule_label||m.unknown}{row.room_label&&<p className="mt-1 text-xs text-muted">{m.room} {row.room_label}</p>}<BusinessRecordRevisionButton kind="enrollment" recordId={row.id} subject={data.students[row.student_id]}/></TableCell>
        </TableRow>)}</TableBody>
      </Table></DashboardTableShell><p className="mt-2 text-xs text-muted">{m.enrollmentHint}</p></>}
    </DashboardSection>}

    {include('communication')&&<DashboardSection title={`${m.communication} · ${communications.length}`}>
      {!communications.length?empty:<ol className="space-y-6">{communications.map(row=>{
        const assessment=data.assessments.find(record=>relatedBusinessCommunications(data,record,'assessment').some(contact=>contact.id===row.id));
        return <li key={row.id} id={row.id}>
        {showStudent&&<Link href={`/dashboard/students/${row.student_id}?tab=history&history=communication`} className="mb-2 inline-block text-sm underline underline-offset-4">{data.students[row.student_id]??m.unknown}</Link>}
        <h3 className="text-sm font-medium">{row.context_kind==='renewal'?m.renewalContext:m.assessmentContext}</h3>
        <p className="mt-1 text-xs text-muted">{row.occurred_on??m.dateUnknown} · {m.author}：{row.author_label??m.unknown}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{assessment?historicalAssessmentFeedback(assessment,data):uniqueBusinessFeedback(row.content)}</p>
        <BusinessHistoryEvidence data={data} reference={row} locale={locale}/>
        <BusinessRecordRevisionButton kind={assessment?'assessment':'communication'} recordId={assessment?.id??row.id} subject={data.students[row.student_id]}/>
      </li>;})}</ol>}
    </DashboardSection>}
  </div>;
}
