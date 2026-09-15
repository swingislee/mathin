import 'server-only';
import { requireDashboardEnvironment } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { businessSubjectKey, type BusinessHistoryKind, type StudentBusinessHistory } from './student-business-history-contract';
import { normalizeSourceAssessmentBand, mergeSourceNotes, sourceAssessmentNote } from './business-source-contract';

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
  await requireDashboardEnvironment(locale, ['staff']);
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('can_confirm_history_source');
  if(error)throw new Error(error.message);
  return data===true;
}

/** 学生档案与工作表复用现有业务记录，来源锚点支持归属尚待确认的行。 */
export async function loadStudentBusinessHistory(locale: string, options: {studentId?: string; kind?: BusinessHistoryKind; projection?: 'full' | 'workbench'} = {}): Promise<StudentBusinessHistory | null> {
  if (!await canReadStudentBusinessHistory(locale)) return null;
  const supabase = await createClient();
  const { studentId, kind } = options;
  // 工作台使用名单事实及身份标签；档案与首联继续读取完整来源和关联沟通。
  const fullContext = options.projection !== 'workbench';
  const include = (current: BusinessHistoryKind) => !kind || kind === current;
  const renewalsQuery = supabase.from('business_course_opportunities' as 'course_opportunities').select('*').not('source_record_id','is',null).eq('opportunity_type','renewal').order('period_year', {ascending:false}).order('period_key').order('id');
  const activitiesQuery = supabase.from('business_activity_registrations' as 'activity_registrations').select('*,activities!inner(id,title,kind,occurred_on)').not('source_record_id','is',null).neq('activities.kind','assessment_1v1').order('registered_on', {ascending:false, nullsFirst:false}).order('id');
  const assessmentsQuery = supabase.from('business_assessment_results' as 'assessment_results').select('*,activity_registrations!inner(activities!inner(deleted_at))').is('activity_registrations.activities.deleted_at',null).not('source_record_id','is',null).order('assessed_on', {ascending:false, nullsFirst:false}).order('id');
  const enrollmentsQuery = supabase.from('business_course_enrollments' as 'course_enrollments').select('*,course_enrollment_assignments(*)').not('source_record_id','is',null).order('registered_on', {ascending:false, nullsFirst:false}).order('id');
  const communicationQuery = supabase.from('business_student_follow_ups' as 'student_follow_ups').select('*').not('source_record_id','is',null).order('occurred_on', {ascending:false, nullsFirst:false}).order('id');
  const none = {data:[],error:null};
  const responses = await Promise.all([
    include('renewal') ? historyPages(studentId ? renewalsQuery.eq('student_id',studentId) : renewalsQuery) : none,
    include('activity') ? historyPages(studentId ? activitiesQuery.eq('student_id',studentId) : activitiesQuery) : none,
    include('assessment') || (fullContext && kind==='communication') ? historyPages(studentId ? assessmentsQuery.eq('student_id',studentId) : assessmentsQuery) : none,
    include('enrollment') ? historyPages(studentId ? enrollmentsQuery.eq('student_id',studentId) : enrollmentsQuery) : none,
    include('communication') || (fullContext && (kind==='renewal' || kind==='activity')) ? historyPages(studentId ? communicationQuery.eq('student_id',studentId) : communicationQuery) : none,
  ]);
  const source = (row: {id:string;student_id:string|null;lead_id?:string|null;source_record_id:string|null;source_field_ids:string[];record_state?:string}) => {
    if(!row.source_record_id) throw new Error('BUSINESS_HISTORY_SOURCE_REQUIRED');
    return {id:row.id,student_id:row.student_id,lead_id:row.lead_id??null,source_record_id:row.source_record_id,source_field_ids:row.source_field_ids,record_state:row.record_state==='current'?'current' as const:'historical' as const};
  };
  const bands: Record<string,string> = {a_plus:'A+',a:'A',s:'S',c:'C',g_plus:'G+',x_plus:'X+'};
  const data: StudentBusinessHistory = {
    renewals:(responses[0].data??[]).map(row=>({...source(row),period_year:row.period_year,period_key:row.period_key??'',period_label:row.term_label,decision_note:row.note,outcome:row.stage==='enrolled'?'renewed':row.stage==='not_enrolled'?'not_renewed':'unknown',class_label:row.class_label,teacher_label:row.teacher_label})),
    activities:(responses[1].data??[]).map(row=>({...source(row),activity_id:row.activity_id,activity_name:row.activities.title,activity_kind:row.activities.kind,registered_on:row.registered_on,occurred_on:row.activities.occurred_on,participation_status:row.status==='booked'?'registered':row.status,reported_result:row.reported_result,result_link_status:row.result_link_status,result_source_record_id:row.result_source_record_id,result_field_ids:row.result_field_ids})),
    assessments:(responses[2].data??[]).map(row=>({...source(row),history_revision:row.history_revision,activity_registration_id:row.activity_registration_id,assessed_on:row.assessed_on,assessment_band:bands[normalizeSourceAssessmentBand(row.assessment_band)??'']??'',score:row.score,learning_notes:mergeSourceNotes(row.strengths,sourceAssessmentNote(row.assessment_band)),parent_notes:row.parent_concerns})),
    enrollments:(responses[3].data??[]).map(row=>{const assignment=row.course_enrollment_assignments.find(item=>item.source_record_id!==null);return {...source(row),course_enrollment_id:row.id,registered_on:row.registered_on,period_label:row.period_label,amount:row.amount,amount_original:row.amount_original,class_label:assignment?.class_label??'',teacher_label:assignment?.teacher_label??'',room_label:assignment?.room_label??'',schedule_label:assignment?.schedule_label??'',note:mergeSourceNotes(row.note,assignment?.note)};}),
    communications:(responses[4].data??[]).map(row=>({...source(row),occurred_on:row.occurred_on,context_kind:row.context_kind,content:row.content,author_label:row.author_label})),
    students:{},subjects:{},sources:{},
  };
  const allRows=[...data.renewals,...data.activities,...data.assessments,...data.enrollments,...data.communications];
  if(!allRows.length)return data;
  const studentIds=[...new Set(allRows.flatMap(row=>row.student_id?[row.student_id]:[]))];
  const sourceIds=[...new Set(fullContext
    ? [...allRows.map(row=>row.source_record_id),...data.activities.flatMap(row=>row.result_source_record_id?[row.result_source_record_id]:[])]
    : allRows.filter(row=>!row.student_id).map(row=>row.source_record_id))];
  const [students,sources]=await Promise.all([
    contextChunks(studentIds,ids=>supabase.from('students').select('id,name,phone,parent_phone,grade').in('id',ids)),
    contextChunks(sourceIds,ids=>supabase.rpc('get_business_source_records',{p_ids:ids})),
  ]);
  if(students.error||sources.error)throw new Error('STUDENT_BUSINESS_HISTORY_CONTEXT');
  data.students=Object.fromEntries((students.data??[]).map(student=>[student.id,student.name]));
  data.subjects=Object.fromEntries((students.data??[]).map(student=>[student.id,{name:student.name,phone:student.parent_phone||student.phone,grade:student.grade}]));
  data.sources=fullContext ? Object.fromEntries((sources.data??[]).map(source=>{
    const sourceData=source.source_data as {filename:string};
    const record=source.record_data as {tableName:string;cells:StudentBusinessHistory['sources'][string]['cells']};
    return [source.id,{filename:sourceData.filename,tableName:record.tableName,cells:record.cells}];
  })) : {};
  for(const row of allRows.filter(row=>!row.student_id)) {
    const raw=sources.data.find(source=>source.id===row.source_record_id)?.record_data as {names?:string[];phones?:string[];tableName?:string;cells?:{fieldName:string;text:string}[]}|undefined;
    const name=raw?.names?.[0]??'—',key=businessSubjectKey(row);
    const grade=raw?.tableName==='2026秋季在读学员表格'?Number(raw.cells?.find(cell=>cell.fieldName==='年级')?.text):null;
    data.students[key]=name;
    data.subjects[key]={name,phone:raw?.phones?.[0]??'',grade:grade&&Number.isInteger(grade)&&grade>=1&&grade<=12?grade:null};
  }
  return data;
}
