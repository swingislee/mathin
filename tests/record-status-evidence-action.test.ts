import { beforeEach, describe, expect, it, vi } from 'vitest';
const dependencies = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/features/school/actions/guards', () => ({ authorizedClient: dependencies.authorize }));
vi.mock('@/features/school/student-stage-data', () => ({ studentStageRpc: dependencies.rpc }));
import { getRecordStatusEvidenceAction } from '@/features/school/record-status/actions';

const subject = { studentId: '00000000-0000-4000-8000-000000000001', leadId: null };
beforeEach(() => {
  vi.clearAllMocks();
  dependencies.authorize.mockResolvedValue({ supabase: {} });
  dependencies.rpc.mockResolvedValue([]);
});
describe('状态依据读取权限', () => {
  it('只需查看权限，并将主体交给现有 RPC 再检查范围', async () => {
    expect(await getRecordStatusEvidenceAction(subject)).toEqual({ ok: true, data: [] });
    expect(dependencies.authorize).toHaveBeenCalledWith('followup.view');
    expect(dependencies.rpc).toHaveBeenCalledWith({}, 'school_record_status_evidence', {
      p_student_id: subject.studentId, p_lead_id: null,
    });
  });
  it('功能权限失败时不调用数据读取', async () => {
    dependencies.authorize.mockRejectedValueOnce(new Error('FORBIDDEN'));
    expect(await getRecordStatusEvidenceAction(subject)).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(dependencies.rpc).not.toHaveBeenCalled();
  });
  it('对象范围失败时不返回原文', async () => {
    dependencies.rpc.mockRejectedValueOnce(new Error('FORBIDDEN_SCOPE'));
    expect(await getRecordStatusEvidenceAction(subject)).toMatchObject({ ok: false });
  });
  it('缺少主体时在读取前拒绝', async () => {
    expect(await getRecordStatusEvidenceAction({ studentId: null, leadId: null })).toMatchObject({ ok: false });
    expect(dependencies.authorize).not.toHaveBeenCalled();
    expect(dependencies.rpc).not.toHaveBeenCalled();
  });
});
