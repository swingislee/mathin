import {describe,expect,it,vi} from 'vitest';
import {listAssessmentWorkbenchRows} from '@/features/school/assessment-workbench-data';

const db=vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
  rpc:async()=>({data:false,error:null}),
  from(table:string){
    let rows=db.tables[table]??[];
    const query={
      select:()=>query,order:()=>query,returns:()=>query,
      is:(field:string,value:unknown)=>{rows=rows.filter(row=>(row[field]??null)===value);return query;},
      eq:(field:string,value:unknown)=>{rows=rows.filter(row=>row[field]===value);return query;},
      in:(field:string,values:unknown[])=>{rows=rows.filter(row=>values.includes(row[field]));return query;},
      range:(start:number,end:number)=>{rows=rows.slice(start,end+1);return query;},
      then:(resolve:(result:{data:Record<string,unknown>[];error:null})=>unknown)=>Promise.resolve(resolve({data:rows,error:null})),
    };
    return query;
  },
})}));

describe('assessment support owner reads',()=>{
  it('uses the linked student owner for a confirmed invitation before the activity exists',async()=>{
    db.tables={
      profiles:[{id:'student-owner',display_name:'现负责老师',role:'staff',is_active:true,account_status:'active'},{id:'lead-owner',display_name:'原线索老师',role:'staff',is_active:true,account_status:'active'}],
      students:[{id:'linked-student',assigned_to:'student-owner'}],
      lead_invitation_threads:[{id:'invitation',kind:'assessment_1v1',state:'confirmed',lead_id:'lead',assessor_id:null,scheduled_at:'2026-09-08T08:00:00Z',location_text:'',summary:'',updated_at:'2026-09-07T00:00:00Z',leads:{id:'lead',provisional_student_name:'示例学生',phone:'',grade_hint:3,grade_text:'',student_id:'linked-student',owner_id:'lead-owner'}}],
    };
    const rows=await listAssessmentWorkbenchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({id:'invitation:invitation',supportOwnerId:'student-owner',supportOwnerName:'现负责老师'});
  });
  it('prefers the current student owner, then Lead owner, and uses only a unique active source staff match',async()=>{
    const staff=(id:string,name:string)=>({id,display_name:name,role:'staff',is_active:true,account_status:'active'});
    db.tables={
      profiles:[staff('student-owner','档案负责人'),staff('lead-owner','线索负责人'),staff('source-owner','来源学服'),staff('duplicate-1','同名学服'),staff('duplicate-2','同名学服')],
      activities:[0,1,2,3].map(index=>({id:`activity-${index}`,kind:'assessment_1v1',title:'测评',scheduled_at:null,occurred_on:null,record_state:'current',location:'',source_invitation_id:null,remark:index===2?'学服老师：来源学服':index===3?'学服老师：同名学服':''})),
      activity_registrations:[0,1,2,3].map(index=>({id:`registration-${index}`,activity_id:`activity-${index}`,source_record_id:`source-${index}`,student_id:index===0?'student':null,lead_id:`lead-${index}`,status:'booked',outcome:'',assessment_paper_version_id:null,assessment_started_at:null,assessment_completed_at:null,updated_at:'2026-09-07T00:00:00Z',students:index===0?{id:'student',name:'示例学生',phone:'',parent_phone:'',grade:3,remark:'',assigned_to:'student-owner'}:null,leads:{id:`lead-${index}`,provisional_student_name:'示例线索',phone:'',grade_hint:null,grade_text:'',student_id:null,owner_id:index<2?'lead-owner':null}})),
    };
    const rows=await listAssessmentWorkbenchRows();
    expect(rows.map(row=>[row.supportOwnerId,row.supportOwnerName])).toEqual([
      ['student-owner','档案负责人'],['lead-owner','线索负责人'],['source-owner','来源学服'],[null,''],
    ]);
  });
});
