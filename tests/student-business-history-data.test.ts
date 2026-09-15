import {beforeEach, describe, expect, it, vi} from 'vitest';
import {loadStudentBusinessHistory} from '@/features/school/student-business-history-data';

const mock=vi.hoisted(()=>({allowed:true,queries:[] as string[],sourceRequests:[] as string[][],sourceMissing:false}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth',()=>({requireDashboardEnvironment:async()=>({})}));
const base={lead_id:null,source_field_ids:['field'],record_state:'historical'};
const renewal=(student_id:string|null,id:string)=>({...base,id,student_id,source_record_id:id,period_year:2026,period_key:'autumn',term_label:'秋季',note:'保留备注',stage:'enrolled',class_label:'班级',teacher_label:'老师'});
const enrollment=(student_id:string|null,id:string)=>({...base,id,student_id,source_record_id:id,registered_on:null,period_label:'秋季',amount:100,amount_original:'100',note:'报名备注',course_enrollment_assignments:[{source_record_id:id,class_label:'班级',teacher_label:'老师',room_label:'教室',schedule_label:'周六',note:'分班备注'}]});
const sources=['linked','unlinked','communication'].map(id=>({id,source_data:{filename:'来源'},record_data:{tableName:'2026秋季在读学员表格',names:['待确认姓名'],phones:['10000'],cells:[{fieldName:'年级',fieldId:'grade',text:'3'}]}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 rpc:async(name:string,args?:{p_ids:string[]})=>{
  if(name==='can_confirm_history_source')return {data:mock.allowed,error:null};
  mock.sourceRequests.push(args!.p_ids);
  return {data:mock.sourceMissing?[]:sources.filter(s=>args!.p_ids.includes(s.id)),error:null};
 },
 from:(table:string)=>{
  const query={select:()=>query,not:()=>query,eq:()=>query,neq:()=>query,is:()=>query,order:()=>query,
   in:()=>Promise.resolve({data:[{id:'student',name:'正式姓名',phone:'10001',parent_phone:'',grade:2}],error:null}),
   range:async()=>{mock.queries.push(table);return {data:table==='business_course_opportunities'?[renewal('student','linked'),renewal(null,'unlinked')]
    :table==='business_course_enrollments'?[enrollment('student','linked'),enrollment(null,'unlinked')]
    :table==='business_student_follow_ups'?[{...base,id:'communication',student_id:'student',source_record_id:'communication',occurred_on:null,context_kind:'renewal',content:'原始沟通',author_label:null}]:[],error:null};}};
  return query;
 },
})}));
beforeEach(()=>{mock.allowed=true;mock.queries=[];mock.sourceRequests=[];mock.sourceMissing=false;});

describe('business workbench history projection',()=>{
 it.each(['renewal','enrollment'] as const)('preserves every %s row and identity label while omitting unused source cells',async kind=>{
  const full=await loadStudentBusinessHistory('zh',{kind});
  mock.queries=[];mock.sourceRequests=[];
  const compact=await loadStudentBusinessHistory('zh',{kind,projection:'workbench'});
  const rows=kind==='renewal'?'renewals':'enrollments';
  expect(compact?.[rows]).toEqual(full?.[rows]);
  expect(compact?.students).toEqual(full?.students);
  expect(compact?.subjects).toEqual(full?.subjects);
  expect(compact?.subjects.unlinked).toEqual({name:'待确认姓名',phone:'10000',grade:3});
  expect(compact?.sources).toEqual({});
  expect(compact?.communications).toEqual([]);
  expect(mock.sourceRequests).toEqual([['unlinked']]);
  expect(mock.queries).not.toContain('business_student_follow_ups');
 });
 it('keeps linked sources and associated communications in the default profile projection',async()=>{
  const full=await loadStudentBusinessHistory('zh',{kind:'renewal'});
  expect(full?.communications).toHaveLength(1);
  expect(Object.keys(full!.sources)).toEqual(['linked','unlinked','communication']);
 });
 it('keeps the permission gate and missing-identity failure',async()=>{
  mock.allowed=false;
  expect(await loadStudentBusinessHistory('zh',{kind:'enrollment',projection:'workbench'})).toBeNull();
  expect(mock.queries).toEqual([]);
  mock.allowed=true;mock.sourceMissing=true;
  await expect(loadStudentBusinessHistory('zh',{kind:'renewal',projection:'workbench'})).rejects.toThrow('STUDENT_BUSINESS_HISTORY_CONTEXT_COVERAGE');
 });
});
