import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { postgrestFilterBatches } from '@/lib/supabase/postgrest-batches';
import type { RenewalWorkspaceData } from './renewals';
import type { RenewalHealthFacts } from './renewal-health-contract';
import { DEFAULT_RENEWAL_HEALTH_POLICY, isRenewalHealthPolicy, type RenewalHealthPolicy } from './renewal-health-policy';
import type { RenewalPayment, RenewalWorkbenchRecord } from './renewal-workbench-contract';
export interface RenewalPoolSupplement {
  health: RenewalHealthFacts[];
  healthAvailable: boolean;
  healthPolicy: RenewalHealthPolicy;
  healthPolicyRevision: number;
  payments: RenewalPayment[];
  signals: {student_id:string;source_class_membership_id:string;recommendation:string;occurred_at:string}[];
  records: RenewalWorkbenchRecord[];
  students: {id:string;phone:string}[];
  membershipTeachers: {membershipId:string;name:string;classroomId?:string;teachers?:{id:string;name:string}[]}[];
  now: number;
  observationMemberships: string[];
}
export async function loadRenewalPoolSupplement(data:RenewalWorkspaceData,actorId:string):Promise<RenewalPoolSupplement> {
  const supabase=await createClient();
  const policyResult=data.selectedCycleId?await supabase.from('renewal_cycles').select('health_policy,health_policy_revision').eq('id',data.selectedCycleId).single():null;
  if(policyResult?.error) throw new Error(policyResult.error.message);
  const healthPolicy=policyResult?.data?.health_policy??DEFAULT_RENEWAL_HEALTH_POLICY;
  if(!isRenewalHealthPolicy(healthPolicy)) throw new Error('Invalid renewal health policy');
  const ids=[...new Set([...data.candidates.map(row=>row.studentId),...data.opportunities.filter(row=>row.cycleId===data.selectedCycleId).map(row=>row.studentId)])];
  const health:RenewalHealthFacts[]=[];
  let healthAvailable=true;
  for(let i=0;i<ids.length;i+=200) {
    const response=await supabase.rpc('get_renewal_health_facts',{p_student_ids:ids.slice(i,i+200)});
    if(response.error) healthAvailable=false;
    else health.push(...response.data as unknown as RenewalHealthFacts[]);
  }
  const opportunityIds=data.opportunities.filter(row=>row.cycleId===data.selectedCycleId).map(row=>row.id);
  const [payments,signals,details,students]=await Promise.all([
    opportunityIds.length?supabase.from('renewal_registration_records').select('opportunity_id,period_count,paid_amount,note').in('opportunity_id',opportunityIds):Promise.resolve({data:[],error:null}),
    ids.length?supabase.from('teacher_professional_signals').select('student_id,source_class_membership_id,recommendation,occurred_at').in('student_id',ids).order('occurred_at',{ascending:false}):Promise.resolve({data:[],error:null}),
    opportunityIds.length?supabase.from('renewal_workbench_details').select('opportunity_id,revision,contact_method,seasons,paid_on,payment_method,updated_at').in('opportunity_id',opportunityIds):Promise.resolve({data:[],error:null}),
    ids.length?supabase.from('students').select('id,phone').in('id',ids):Promise.resolve({data:[],error:null}),
  ]);
  if(payments.error) throw new Error(payments.error.message);
  if(signals.error) throw new Error(signals.error.message);
  if(details.error) throw new Error(details.error.message);
  if(students.error) throw new Error(students.error.message);
  const membershipIds=[...data.candidates.map(row=>row.membershipId),...data.opportunities.filter(row=>row.cycleId===data.selectedCycleId).flatMap(row=>row.sourceMembershipId?[row.sourceMembershipId]:[])];
  const [admin,memberships]=await Promise.all([
    supabase.rpc('is_admin',{uid:actorId}),
    membershipIds.length?supabase.from('enrollments').select('id,classroom_id,status').in('id',membershipIds):Promise.resolve({data:[],error:null}),
  ]);
  if(admin.error) throw new Error(admin.error.message);
  if(memberships.error) throw new Error(memberships.error.message);
  const classes=[...new Set((memberships.data??[]).map(row=>row.classroom_id))];
  const teachers=classes.length?await supabase.from('classroom_staff_assignments')
    .select('classroom_id,user_id,profiles!classroom_staff_assignments_user_id_fkey(display_name)')
    .in('classroom_id',classes).eq('responsibility','primary_teacher'): {data:[],error:null};
  if(teachers.error) throw new Error(teachers.error.message);
  const teacherNames=new Map((teachers.data??[]).map(row=>[row.classroom_id,row.profiles?.display_name??'']));
  const teacherClasses=new Set<string>();
  // 管理员的观察范围已由 is_admin 确认；其他员工沿用逐班授权，并限制同时发出的请求。
  if(!admin.data) for(const batch of postgrestFilterBatches(classes,4)) {
    const results=await Promise.all(batch.map(async cid=>{
      const {data,error}=await supabase.rpc('is_classroom_teacher',{cid,uid:actorId});
      if(error) throw new Error(error.message);
      return data?cid:null;
    }));
    for(const cid of results) if(cid) teacherClasses.add(cid);
  }
  const observationMemberships=(memberships.data??[]).filter(row=>['active','completed'].includes(row.status)&&(admin.data||teacherClasses.has(row.classroom_id))).map(row=>row.id);
  const records=(details.data??[]).map(row=>({opportunityId:row.opportunity_id,revision:row.revision,
    contactMethod:row.contact_method,seasons:row.seasons,paidOn:row.paid_on,paymentMethod:row.payment_method,updatedAt:row.updated_at})) as RenewalWorkbenchRecord[];
  return {health,healthAvailable,healthPolicy,healthPolicyRevision:policyResult?.data?.health_policy_revision??0,
    payments:payments.data as RenewalPoolSupplement['payments'],signals:signals.data??[],records,
    students:(students.data??[]).map(row=>({id:row.id,phone:row.phone??''})),
    membershipTeachers:(memberships.data??[]).map(row=>({membershipId:row.id,name:teacherNames.get(row.classroom_id)??'',classroomId:row.classroom_id,
      teachers:(teachers.data??[]).filter(item=>item.classroom_id===row.classroom_id).map(item=>({id:item.user_id,name:item.profiles?.display_name??''}))})),
    observationMemberships,now:Date.now()};
}
