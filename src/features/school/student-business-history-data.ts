import 'server-only';
import { getProfile, requireDashboardEnvironment } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isLocalHistoryArchiveEnvironment } from './history-archive-contract';
import type { BusinessHistoryKind, StudentBusinessHistory } from './student-business-history-contract';

export async function canReadStudentBusinessHistory(locale: string): Promise<boolean> {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) return false;
  const { user } = await requireDashboardEnvironment(locale, ['staff']);
  return (await getProfile(user.id))?.role === 'admin';
}

/** 各业务入口直接读取历史领域列；原始文件只用于展开的来源依据。 */
export async function loadStudentBusinessHistory(locale: string, options: {studentId?: string; kind?: BusinessHistoryKind} = {}): Promise<StudentBusinessHistory | null> {
  if (!await canReadStudentBusinessHistory(locale)) return null;
  const supabase = await createClient();
  const { studentId, kind } = options;
  const include = (current: BusinessHistoryKind) => !kind || kind === current;
  const renewalsQuery = supabase.from('student_renewal_history').select('*').order('period_year', {ascending:false}).order('period_key').limit(251);
  const activitiesQuery = supabase.from('student_activity_history').select('*').order('registered_on', {ascending:false, nullsFirst:false}).limit(251);
  const assessmentsQuery = supabase.from('student_assessment_history').select('*').order('assessed_on', {ascending:false, nullsFirst:false}).limit(251);
  const enrollmentsQuery = supabase.from('student_enrollment_history').select('*').order('registered_on', {ascending:false, nullsFirst:false}).order('id').limit(251);
  const communicationQuery = supabase.from('student_communication_history').select('*').order('occurred_on', {ascending:false, nullsFirst:false}).order('id').limit(251);
  const none = {data:[],error:null};
  const responses = await Promise.all([
    include('renewal') ? studentId ? renewalsQuery.eq('student_id',studentId) : renewalsQuery : none,
    include('activity') ? studentId ? activitiesQuery.eq('student_id',studentId) : activitiesQuery : none,
    include('assessment') ? studentId ? assessmentsQuery.eq('student_id',studentId) : assessmentsQuery : none,
    include('enrollment') ? studentId ? enrollmentsQuery.eq('student_id',studentId) : enrollmentsQuery : none,
    include('communication') || kind==='renewal' || kind==='activity' ? studentId ? communicationQuery.eq('student_id',studentId) : communicationQuery : none,
  ]);
  for (const response of responses) {
    if(response.error) throw new Error(`STUDENT_BUSINESS_HISTORY_${response.error.code}`);
    if((response.data?.length ?? 0)>250) throw new Error('STUDENT_BUSINESS_HISTORY_PAGE_REQUIRED');
  }
  const data: StudentBusinessHistory = {
    renewals:responses[0].data??[],activities:responses[1].data??[],assessments:responses[2].data??[],
    enrollments:responses[3].data??[],communications:responses[4].data??[],students:{},sources:{},
  };
  const allRows=[...data.renewals,...data.activities,...data.assessments,...data.enrollments,...data.communications];
  if(!allRows.length)return data;
  const studentIds=[...new Set(allRows.map(row=>row.student_id))];
  const sourceIds=[...new Set([...allRows.map(row=>row.source_record_id),...data.activities.flatMap(row=>row.result_source_record_id?[row.result_source_record_id]:[])])];
  const [students,sources]=await Promise.all([
    supabase.from('students').select('id,name').in('id',studentIds),
    supabase.from('history_import_records').select('id,source_data,record_data').in('id',sourceIds),
  ]);
  if(students.error||sources.error)throw new Error('STUDENT_BUSINESS_HISTORY_CONTEXT');
  data.students=Object.fromEntries((students.data??[]).map(student=>[student.id,student.name]));
  data.sources=Object.fromEntries((sources.data??[]).map(source=>{
    const sourceData=source.source_data as {filename:string};
    const record=source.record_data as {tableName:string;cells:StudentBusinessHistory['sources'][string]['cells']};
    return [source.id,{filename:sourceData.filename,tableName:record.tableName,cells:record.cells}];
  }));
  return data;
}
