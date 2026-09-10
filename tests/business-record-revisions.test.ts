import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getBusinessRecordRevisionAction, saveBusinessRecordRevisionAction } from '@/features/school/business-record-revision-actions';
import { businessRevisionChanges, revisionFieldValue, type BusinessRecordRevisionContext } from '@/features/school/business-record-revision-contract';

const db = vi.hoisted(()=>({ rpc:vi.fn(), user:true }));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:db.user?{id:'actor'}:null}})},rpc:db.rpc})}));
const recordId='10000000-0000-4000-8000-000000000001', version='a'.repeat(32);
const assessment = { kind:'assessment' as const,recordId,expectedVersion:version,reason:'更正日期',values:{assessment_results:{assessed_on:'2024-02-29',assessment_band:'a_plus',score:null,strengths:'修订反馈'}} };

beforeEach(()=>{db.user=true;db.rpc.mockReset();vi.stubEnv('NODE_ENV','development');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:35421');});
afterEach(()=>vi.unstubAllEnvs());
describe('historical business revision actions',()=>{
  it('loads the exact record using the authenticated client',async()=>{
    db.rpc.mockResolvedValue({data:{version,sections:[],revisions:[]},error:null});
    expect(await getBusinessRecordRevisionAction({kind:'activity',recordId})).toEqual({ok:true,data:{version,sections:[],revisions:[]}});
    expect(db.rpc).toHaveBeenCalledWith('get_business_record_revision',{p_kind:'activity',p_id:recordId});
  });
  it('saves the expected version and preserves null dates and numeric zero',async()=>{
    db.rpc.mockResolvedValue({data:'revision-id',error:null});
    const input={kind:'enrollment' as const,recordId,expectedVersion:version,reason:'',values:{course_enrollments:{registered_on:null,period_label:'春季',amount:0,amount_original:''}}};
    expect(await saveBusinessRecordRevisionAction(input)).toEqual({ok:true,data:'revision-id'});
    expect(db.rpc).toHaveBeenCalledWith('revise_business_record',{p_kind:'enrollment',p_id:recordId,p_expected_version:version,p_values:input.values,p_reason:''});
  });
  it('accepts existing imported PostgreSQL UUIDs without requiring generated UUID version bits',async()=>{
    db.rpc.mockResolvedValue({data:{version,sections:[],revisions:[]},error:null});
    const importedId='00112233-4455-6677-0011-223344556677';
    expect((await getBusinessRecordRevisionAction({kind:'activity',recordId:importedId})).ok).toBe(true);
    expect(await getBusinessRecordRevisionAction({kind:'activity',recordId:'broken-id'})).toEqual({ok:false,code:'VALIDATION'});
  });
  it('rejects nonexistent calendar dates and unrecognized persisted fields before RPC',async()=>{
    for(const date of ['2025-02-29','2026-02-30','infinity']) {
      expect(await saveBusinessRecordRevisionAction({...assessment,values:{assessment_results:{...assessment.values.assessment_results,assessed_on:date}}})).toEqual({ok:false,code:'VALIDATION'});
    }
    expect(await saveBusinessRecordRevisionAction({...assessment,values:{assessment_results:{...assessment.values.assessment_results,student_id:recordId}}})).toEqual({ok:false,code:'VALIDATION'});
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('returns actionable conflict errors from PostgREST without a second save',async()=>{
    db.rpc.mockResolvedValue({data:null,error:{message:'REVISION_CONFLICT'}});
    expect(await saveBusinessRecordRevisionAction(assessment)).toEqual({ok:false,code:'REVISION_CONFLICT'});
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it('uses authenticated database subject permissions in every deployment environment',async()=>{
    vi.stubEnv('NODE_ENV','production');
    db.rpc.mockResolvedValue({data:'revision-id',error:null});
    expect(await saveBusinessRecordRevisionAction(assessment)).toEqual({ok:true,data:'revision-id'});
    db.rpc.mockResolvedValue({data:null,error:{message:'FORBIDDEN'}});
    expect(await getBusinessRecordRevisionAction({kind:'activity',recordId})).toEqual({ok:false,code:'FORBIDDEN'});
    expect(await saveBusinessRecordRevisionAction(assessment)).toEqual({ok:false,code:'FORBIDDEN'});
    expect(db.rpc).toHaveBeenCalledTimes(3);
  });
  it('rejects unsigned requests',async()=>{
    db.user=false;
    expect(await getBusinessRecordRevisionAction({kind:'activity',recordId})).toEqual({ok:false,code:'UNAUTHENTICATED'});
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
describe('revision history presentation',()=>{
  it('compares business values without exposing implementation metadata as editable fields',()=>{
    const revision:BusinessRecordRevisionContext['revisions'][number]={id:'revision',recorded_at:'2026-09-06T00:00:00Z',recorded_by:'管理员',reason:'更正金额',
      before_data:[{relation:'course_enrollments',id:recordId,data:{amount:1200,history_revision:0,source_record_id:'source'}}],
      after_data:[{relation:'course_enrollments',id:recordId,data:{amount:0,history_revision:1,source_record_id:'source'}}]};
    expect(businessRevisionChanges(revision)).toEqual([{relation:'course_enrollments',key:'amount',before:1200,after:0}]);
    expect(revisionFieldValue('course_enrollments','amount',0,'zh')).toBe('0');
    expect(revisionFieldValue('activity_registrations','status','attended','en')).toBe('Attended');
  });
});
