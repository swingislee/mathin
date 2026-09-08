import { beforeEach, expect, it, vi } from 'vitest';
const calls=vi.hoisted(()=>({rpc:vi.fn(),revalidate:vi.fn(),permissions:new Set(['student.edit'])}));
vi.mock('server-only',()=>({}));
vi.mock('next/cache',()=>({revalidatePath:calls.revalidate}));
vi.mock('@/lib/auth',()=>({getMyPerms:async()=>calls.permissions}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:calls.rpc})}));
import { confirmStudentMergeAction, previewStudentMergeAction, searchStudentMergeCandidatesAction } from '@/features/school/student-merge-actions';
const kept='10000000-0000-4000-8000-000000000001',merged='10000000-0000-4000-8000-000000000002',mergeId='10000000-0000-4000-8000-000000000003';
const input={keptId:kept,mergedId:merged,token:'a'.repeat(32),choices:{phone:'merged' as const},reason:'Same child'};
beforeEach(()=>{vi.clearAllMocks();calls.permissions=new Set(['student.edit']);calls.rpc.mockResolvedValue({data:{keptId:kept,mergedId:merged,mergeId},error:null});});
it('requires edit permission and validated choices before calling a merge RPC',async()=>{
  calls.permissions.clear();
  expect(await confirmStudentMergeAction(input)).toEqual({ok:false,code:'FORBIDDEN'});
  expect(await searchStudentMergeCandidatesAction(kept,'Phone')).toEqual({ok:false,code:'FORBIDDEN'});
  expect(calls.rpc).not.toHaveBeenCalled();
  calls.permissions.add('student.edit');
  expect(await confirmStudentMergeAction({...input,choices:{phone:'arbitrary text'} as never})).toEqual({ok:false,code:'VALIDATION'});
  expect(await confirmStudentMergeAction({...input,reason:' '})).toEqual({ok:false,code:'VALIDATION'});
  expect(calls.rpc).not.toHaveBeenCalled();
});
it('passes the reviewed pair and token without calling the old unreviewed merge',async()=>{
  expect(await confirmStudentMergeAction(input)).toEqual({ok:true,data:{keptId:kept,mergedId:merged,mergeId}});
  expect(calls.rpc).toHaveBeenCalledWith('confirm_student_merge',{p_kept_id:kept,p_merged_id:merged,p_expected_token:input.token,p_choices:input.choices,p_reason:'Same child'});
  expect(calls.revalidate).toHaveBeenCalled();
});
it('returns stale and overlapping record failures without invalidating pages as a success',async()=>{
  calls.rpc.mockResolvedValue({data:null,error:{message:'MERGE_CHANGED'}});
  expect(await confirmStudentMergeAction(input)).toEqual({ok:false,code:'MERGE_CHANGED'});
  calls.rpc.mockResolvedValue({data:null,error:{message:'FORBIDDEN_SCOPE'}});
  expect(await previewStudentMergeAction(kept,merged)).toEqual({ok:false,code:'FORBIDDEN_SCOPE'});
  expect(calls.revalidate).not.toHaveBeenCalled();
});
