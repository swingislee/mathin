import 'server-only';
import { getProfile, requireDashboardEnvironment } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isLocalHistoryArchiveEnvironment } from './history-archive-contract';
import type { BusinessHistoryKind, StudentBusinessHistory } from './student-business-history-contract';

async function historyPages<T>(query: {range:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:{code:string}|null}>}) {
  const rows:T[]=[];
  for(let offset=0;;offset+=500) {
    const result=await query.range(offset,offset+499);
    if(result.error)throw new Error(`STUDENT_BUSINESS_HISTORY_${result.error.code}`);
    rows.push(...result.data??[]);
    if((result.data?.length??0)<500)return {data:rows,error:null};
  }
}

async function contextChunks<T>(ids:string[],load:(chunk:string[])=>PromiseLike<{data:T[]|null;error:unknown}>) {
  const results=await Promise.all(Array.from({length:Math.ceil(ids.length/100)},(_,index)=>load(ids.slice(index*100,(index+1)*100))));
  if(results.some(result=>result.error))throw new Error('STUDENT_BUSINESS_HISTORY_CONTEXT');
  const data=results.flatMap(result=>result.data??[]);
  if(data.length!==ids.length)throw new Error('STUDENT_BUSINESS_HISTORY_CONTEXT_COVERAGE');
  return {data,error:null};
}

export async function canReadStudentBusinessHistory(locale: string): Promise<boolean> {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) return false;
  const { user } = await requireDashboardEnvironment(locale, ['staff']);
  return (await getProfile(user.id))?.role === 'admin';
}

/** 学生档案与各业务表格复用现有业务表中的历史状态事实。 */
export async function loadStudentBusinessHistory(locale: string, options: {studentId?: string; kind?: BusinessHistoryKind} = {}): Promise<StudentBusinessHistory | null> {
  if (!await canReadStudentBusinessHistory(locale)) return null;
  const supabase = await createClient();
  const { studentId, kind } = options;
  const include = (current: BusinessHistoryKind) => !kind || kind === current;
  const renewalsQuery = supabase.from('course_opportunities').select('*').eq('record_state','historical').eq('opportunity_type','renewal').order('period_year', {ascending:false}).order('period_key').order('id');
  const activitiesQuery = supabase.from('activity_registrations').select('*,activities!inner(id,title,kind,occurred_on)').eq('record_state','historical').neq('activities.kind','assessment_1v1').order('registered_on', {ascending:false, nullsFirst:false}).order('id');
  const assessmentsQuery = supabase.from('assessment_results').select('*').eq('record_state','historical').order('assessed_on', {ascending:false, nullsFirst:false}).order('id');
  const enrollmentsQuery = supabase.from('course_enrollments').select('*,course_enrollment_assignments(*)').eq('record_state','historical').order('registered_on', {ascending:false, nullsFirst:false}).order('id');
  const communicationQuery = supabase.from('student_follow_ups').select('*').eq('record_state','historical').order('occurred_on', {ascending:false, nullsFirst:false}).order('id');
  const none = {data:[],error:null};
  const responses = await Promise.all([
    include('renewal') ? historyPages(studentId ? renewalsQuery.eq('student_id',studentId) : renewalsQuery) : none,
    include('activity') ? historyPages(studentId ? activitiesQuery.eq('student_id',studentId) : activitiesQuery) : none,
    include('assessment') || kind==='communication' ? historyPages(studentId ? assessmentsQuery.eq('student_id',studentId) : assessmentsQuery) : none,
    include('enrollment') ? historyPages(studentId ? enrollmentsQuery.eq('student_id',studentId) : enrollmentsQuery) : none,
    include('communication') || kind==='renewal' || kind==='activity' ? historyPages(studentId ? communicationQuery.eq('student_id',studentId) : communicationQuery) : none,
  ]);
  const source = (row: {id:string;student_id:string|null;source_record_id:string|null;source_field_ids:string[]}) => {
    if(!row.student_id || !row.source_record_id) throw new Error('BUSINESS_HISTORY_SOURCE_REQUIRED');
    return {id:row.id,student_id:row.student_id,source_record_id:row.source_record_id,source_field_ids:row.source_field_ids};
  };
  const bands: Record<string,string> = {a_plus:'A+',a:'A',s:'S',c:'C',g_plus:'G+',x_plus:'X+',below_a:'A 以下'};
  const data: StudentBusinessHistory = {
    renewals:(responses[0].data??[]).map(row=>({...source(row),period_year:row.period_year,period_key:row.period_key??'',period_label:row.term_label,decision_note:row.note,outcome:row.stage==='enrolled'?'renewed':row.stage==='not_enrolled'?'not_renewed':'unknown',class_label:row.class_label,teacher_label:row.teacher_label})),
    activities:(responses[1].data??[]).map(row=>({...source(row),activity_id:row.activity_id,activity_name:row.activities.title,activity_kind:row.activities.kind,registered_on:row.registered_on,occurred_on:row.activities.occurred_on,participation_status:row.status==='booked'?'registered':row.status,reported_result:row.reported_result,result_link_status:row.result_link_status,result_source_record_id:row.result_source_record_id,result_field_ids:row.result_field_ids})),
    assessments:(responses[2].data??[]).map(row=>({...source(row),history_revision:row.history_revision,activity_registration_id:row.activity_registration_id,assessed_on:row.assessed_on,assessment_band:bands[row.assessment_band??'']??row.assessment_band??'',score:row.score,learning_notes:row.strengths,parent_notes:row.parent_concerns})),
    enrollments:(responses[3].data??[]).map(row=>{const assignment=row.course_enrollment_assignments.find(item=>item.record_state==='historical');return {...source(row),course_enrollment_id:row.id,registered_on:row.registered_on,period_label:row.period_label,amount:row.amount,amount_original:row.amount_original,class_label:assignment?.class_label??'',teacher_label:assignment?.teacher_label??'',room_label:assignment?.room_label??'',schedule_label:assignment?.schedule_label??''};}),
    communications:(responses[4].data??[]).map(row=>({...source(row),occurred_on:row.occurred_on,context_kind:row.context_kind,content:row.content,author_label:row.author_label})),
    students:{},subjects:{},sources:{},
  };
  const allRows=[...data.renewals,...data.activities,...data.assessments,...data.enrollments,...data.communications];
  if(!allRows.length)return data;
  const studentIds=[...new Set(allRows.map(row=>row.student_id))];
  const sourceIds=[...new Set([...allRows.map(row=>row.source_record_id),...data.activities.flatMap(row=>row.result_source_record_id?[row.result_source_record_id]:[])])];
  const [students,sources]=await Promise.all([
    contextChunks(studentIds,ids=>supabase.from('students').select('id,name,phone,parent_phone,grade').in('id',ids)),
    contextChunks(sourceIds,ids=>supabase.from('history_import_records').select('id,source_data,record_data').in('id',ids)),
  ]);
  if(students.error||sources.error)throw new Error('STUDENT_BUSINESS_HISTORY_CONTEXT');
  data.students=Object.fromEntries((students.data??[]).map(student=>[student.id,student.name]));
  data.subjects=Object.fromEntries((students.data??[]).map(student=>[student.id,{name:student.name,phone:student.parent_phone||student.phone,grade:student.grade}]));
  data.sources=Object.fromEntries((sources.data??[]).map(source=>{
    const sourceData=source.source_data as {filename:string};
    const record=source.record_data as {tableName:string;cells:StudentBusinessHistory['sources'][string]['cells']};
    return [source.id,{filename:sourceData.filename,tableName:record.tableName,cells:record.cells}];
  }));
  return data;
}
