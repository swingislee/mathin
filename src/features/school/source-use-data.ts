import 'server-only';
import { requireDashboardEnvironment } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isLocalHistoryArchiveEnvironment } from './history-archive-contract';
import type { SourceUseContext, StudentSourceArchive } from './source-use-contract';

async function sourceClient(locale:string) {
  if(!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV,process.env.NEXT_PUBLIC_SUPABASE_URL))throw new Error('LOCAL_ONLY');
  await requireDashboardEnvironment(locale,['staff']);
  return createClient();
}
export async function loadStudentSourceArchive(locale:string,studentId:string,page=1):Promise<StudentSourceArchive> {
  const client=await sourceClient(locale);
  const {data,error}=await client.rpc('get_student_source_archive',{p_student_id:studentId,p_page:page});
  if(error)throw new Error('STUDENT_SOURCE_ARCHIVE_READ');
  return data as unknown as StudentSourceArchive;
}
export async function loadStudentSourceContext(locale:string,studentId:string,recordId:string):Promise<SourceUseContext|null> {
  const client=await sourceClient(locale);
  const {data,error}=await client.rpc('get_history_source_context',{p_record_id:recordId,p_student_id:studentId});
  if(error)return null;
  const context=data as unknown as SourceUseContext;
  return context.studentId===studentId?context:null;
}
