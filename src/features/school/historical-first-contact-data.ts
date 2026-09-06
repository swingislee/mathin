import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadStudentBusinessHistory } from './student-business-history-data';
import type { HistoricalFirstContactRow } from './historical-first-contact-contract';

/** 后续历史事实形成查询占位；首联事件和 Lead 身份按真实凭据建立。 */
export async function loadHistoricalFirstContactRows(locale:string,query=''):Promise<HistoricalFirstContactRow[]> {
  const data=await loadStudentBusinessHistory(locale);
  if(!data)return [];
  const ids=Object.keys(data.subjects);
  if(!ids.length)return [];
  const supabase=await createClient();
  const leads=await supabase.from('leads').select('id,student_id,lead_communications(id)').in('student_id',ids);
  if(leads.error)throw new Error(leads.error.message);
  const documented=new Set((leads.data??[]).filter(row=>row.lead_communications.length>0).map(row=>row.student_id));
  const needle=query.trim().toLocaleLowerCase(locale);
  return ids.filter(id=>!documented.has(id)).map(id=>({
    studentId:id,...data.subjects[id],
    context:'',
  })).filter(row=>!needle||[row.name,row.phone,row.context].join(' ').toLocaleLowerCase(locale).includes(needle));
}
