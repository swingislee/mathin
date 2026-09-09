import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supportEntryHref, supportEntrySchema, supportProfileValuesSchema, type SupportEntry, type SupportItem } from '@/features/school/school-support-contract';

const fixture=vi.hoisted(()=>({rpc:vi.fn(),revalidate:vi.fn(),permissions:new Set(['followup.view','followup.write','student.edit'])}));
vi.mock('server-only',()=>({}));
vi.mock('next/cache',()=>({revalidatePath:fixture.revalidate}));
vi.mock('@/lib/auth',()=>({getMyPerms:async()=>fixture.permissions}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:fixture.rpc})}));
import { addSupportWorkAction, updateSupportProfileAction, searchSupportSubjectsAction, readSupportFamilyAction } from '@/features/school/school-support-actions';

const student='10000000-0000-4000-8000-000000000001',lead='10000000-0000-4000-8000-000000000002',request='10000000-0000-4000-8000-000000000003';
const item:SupportItem={id:request,workspace:'communication',studentId:student,leadId:lead,name:'Same family child',phone:'600000001',grade:null,
  note:'Call this week',workDate:'2026-09-08',worklistId:request,registrationId:null,courseId:null,termId:null,opportunityId:null,enrollmentId:null,cycleId:null,
  revision:0,closedAt:null,createdAt:'2026-09-08T00:00:00Z',identityPending:false,canWrite:true,courseTitle:'',termName:''};
const input:SupportEntry={workspace:'communication',subject:{studentId:student,leadId:null,version:'profile-version'},newPerson:null,
  acknowledgeDuplicate:false,work:{date:'2026-09-08',note:'Call this week'}};
beforeEach(()=>{vi.clearAllMocks();fixture.permissions=new Set(['followup.view','followup.write','student.edit']);fixture.rpc.mockResolvedValue({data:item,error:null});});

describe('manual entry identity and action boundaries',()=>{
  it('accepts a missing phone or missing name while requiring an identifiable person and explicit profile confirmation',()=>{
    const minimal={...input,subject:null,newPerson:{name:'Known name',phone:'',grade:null,createStudent:false,identityPending:true}};
    expect(supportEntrySchema.safeParse(minimal).success).toBe(true);
    expect(supportEntrySchema.safeParse({...minimal,newPerson:{...minimal.newPerson,name:'',phone:'600000001'}}).success).toBe(true);
    expect(supportEntrySchema.safeParse({...minimal,newPerson:{...minimal.newPerson,name:''}}).success).toBe(false);
    expect(supportEntrySchema.safeParse({...minimal,newPerson:{...minimal.newPerson,createStudent:true}}).success).toBe(false);
    expect(supportEntrySchema.safeParse({...minimal,subject:input.subject}).success).toBe(false);
    expect(supportProfileValuesSchema.safeParse({name:'Name',phone:'',grade:null,remark:'',assignedTo:student}).success).toBe(false);
  });
  it('preserves the selected child and request token across retries, regardless of a shared family phone',async()=>{
    await addSupportWorkAction(request,input);await addSupportWorkAction(request,input);
    expect(fixture.rpc).toHaveBeenNthCalledWith(1,'add_school_support_work_item',{p_request_id:request,p_payload:input});
    expect(fixture.rpc.mock.calls[1]).toEqual(fixture.rpc.mock.calls[0]);
    expect(fixture.revalidate).toHaveBeenCalled();
  });
  it('rejects unauthorized requests before calling the database',async()=>{
    fixture.permissions.clear();
    expect(await addSupportWorkAction(request,input)).toEqual({ok:false,code:'FORBIDDEN'});
    expect(await searchSupportSubjectsAction('Known')).toEqual({ok:false,code:'FORBIDDEN'});
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('returns a concurrent profile change without treating it as saved',async()=>{
    fixture.rpc.mockResolvedValue({data:null,error:{message:'PROFILE_CONFLICT'}});
    expect(await updateSupportProfileAction({studentId:student,leadId:null,version:'previous',values:{name:'Corrected',phone:'',grade:null,remark:''}}))
      .toEqual({ok:false,code:'PROFILE_CONFLICT'});
    expect(fixture.revalidate).not.toHaveBeenCalled();
  });
  it('uses followup handling permission for family review and preserves a scope rejection',async()=>{
    fixture.permissions=new Set(['followup.view','followup.write']);
    fixture.rpc.mockResolvedValue({data:{otherStudentId:lead,otherName:'Sibling',otherPhone:'600000001',otherVersion:'profile-version',version:'family-version',familyId:null,familyName:'Family',alreadyLinked:false,blocker:null},error:null});
    expect((await readSupportFamilyAction(student,lead)).ok).toBe(true);
    expect(fixture.rpc).toHaveBeenCalledWith('preview_school_support_family_link',{p_student_id:student,p_other_student_id:lead});
    fixture.rpc.mockResolvedValue({data:null,error:{message:'FORBIDDEN_SCOPE'}});
    expect(await readSupportFamilyAction(student,lead)).toEqual({ok:false,code:'FORBIDDEN_SCOPE'});
    fixture.rpc.mockClear();
    expect(await addSupportWorkAction(request,{...input,profileEdit:{version:'version',values:{name:'Name',grade:1,phone:'',remark:'',assignedTo:lead}}} as SupportEntry)).toEqual({ok:false,code:'VALIDATION'});
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('opens the persisted worklist with its exact student context and clears incompatible old filters',()=>{
    const url=new URL(supportEntryHref(item),'https://test.invalid');
    expect(url.pathname).toBe('/dashboard/followups/communication');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({worklist:request,lead,view:'worklist',manual:request,date:'2026-09-08'});
    expect(url.searchParams.has('fields')).toBe(false);
    const renewal=new URL(supportEntryHref({...item,workspace:'renewals',worklistId:null,cycleId:lead}),'https://test.invalid');
    expect(renewal.pathname).toBe('/dashboard/followups/renewals');expect(renewal.searchParams.get('manual')).toBe(request);
    expect(renewal.searchParams.get('cycle')).toBe(lead);
  });
});
