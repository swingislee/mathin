import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { RenewalWorkspaceData } from './renewals';
import type { RenewalHealthFacts } from './renewal-health-contract';
export interface RenewalPoolSupplement {
  health: RenewalHealthFacts[];
  healthAvailable: boolean;
  payments: {opportunity_id:string;period_count:number;paid_amount:number;note:string}[];
  signals: {student_id:string;recommendation:string;occurred_at:string}[];
  now: number;
  observationMemberships: string[];
}
export async function loadRenewalPoolSupplement(data:RenewalWorkspaceData,actorId:string):Promise<RenewalPoolSupplement> {
  const supabase=await createClient();
  const ids=[...new Set([...data.candidates.map(row=>row.studentId),...data.opportunities.filter(row=>row.cycleId===data.selectedCycleId).map(row=>row.studentId)])];
  const health:RenewalHealthFacts[]=[];
  let healthAvailable=true;
  for(let i=0;i<ids.length;i+=200) {
    const response=await supabase.rpc('get_renewal_health_facts',{p_student_ids:ids.slice(i,i+200)});
    if(response.error) healthAvailable=false;
    else health.push(...response.data as unknown as RenewalHealthFacts[]);
  }
  const opportunityIds=data.opportunities.filter(row=>row.cycleId===data.selectedCycleId).map(row=>row.id);
  const [payments,signals]=await Promise.all([
    opportunityIds.length?supabase.from('renewal_registration_records').select('opportunity_id,period_count,paid_amount,note').in('opportunity_id',opportunityIds):Promise.resolve({data:[],error:null}),
    ids.length?supabase.from('teacher_professional_signals').select('student_id,recommendation,occurred_at').in('student_id',ids).order('occurred_at',{ascending:false}):Promise.resolve({data:[],error:null}),
  ]);
  if(payments.error) throw new Error(payments.error.message);
  if(signals.error) throw new Error(signals.error.message);
  const membershipIds=[...data.candidates.map(row=>row.membershipId),...data.opportunities.filter(row=>row.cycleId===data.selectedCycleId).flatMap(row=>row.sourceMembershipId?[row.sourceMembershipId]:[])];
  const [admin,memberships]=await Promise.all([
    supabase.rpc('is_admin',{uid:actorId}),
    membershipIds.length?supabase.from('enrollments').select('id,classroom_id,status').in('id',membershipIds):Promise.resolve({data:[],error:null}),
  ]);
  if(admin.error) throw new Error(admin.error.message);
  if(memberships.error) throw new Error(memberships.error.message);
  const classes=[...new Set((memberships.data??[]).map(row=>row.classroom_id))];
  const teacherClasses=new Set(await Promise.all(classes.map(async cid=>{
    const {data,error}=await supabase.rpc('is_classroom_teacher',{cid,uid:actorId});
    if(error) throw new Error(error.message);
    return data?cid:null;
  })));
  const observationMemberships=(memberships.data??[]).filter(row=>['active','completed'].includes(row.status)&&(admin.data||teacherClasses.has(row.classroom_id))).map(row=>row.id);
  return {health,healthAvailable,payments:payments.data as RenewalPoolSupplement['payments'],signals:signals.data??[],observationMemberships,now:Date.now()};
}
