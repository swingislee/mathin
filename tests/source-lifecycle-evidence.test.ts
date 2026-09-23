import { describe, expect, it } from 'vitest';
import { sourceContactEvidence, sourceContactFlags, sourceHasAssessmentResult, sourceNoteIsEffective } from '@/features/school/source-lifecycle-evidence.mjs';
const read = (fields: Record<string,string>) => (name: string) => fields[name] ?? '';
describe('来源阶段证据', () => {
  it('首次未通与后续接通分别保留，导出不是新电话', () => {
    const fields = read({ 确认结果: '未通', 确认月份: '9月', 确认人员: '学服甲', 跟进结果: '加V', 跟进信息: '约周末体验' });
    expect(sourceContactEvidence(fields, 'confirmation')).toMatchObject({outcome:'unreachable',effective:false});
    expect(sourceContactEvidence(fields, 'followup')).toMatchObject({outcome:'connected',effective:true});
  });
  it('一直未接通保留待首联，确认上下文及实质备注参与判断', () => {
    for(const value of ['9.5未接通','电话多次无人接听','今天未接，明天再打','未通','待联系']) {
      expect(sourceNoteIsEffective(value)).toBe(false);
    }
    expect(sourceContactEvidence(read({确认月份:'9月',确认人员:'学服甲'}),'confirmation').effective).toBe(true);
    expect(sourceContactEvidence(read({确认月份:'9月',确认人员:'学服甲',确认信息备注:'电话多次未接通'}),'confirmation').effective).toBe(false);
    expect(sourceContactEvidence(read({确认信息备注:'想周末来体验'}),'confirmation').effective).toBe(true);
  });
  it('加微与诺访兼容真实选项，项目记录保持独立', () => {
    expect(sourceContactFlags(read({'用户当下加V与否':'已加V','诺访与否':'未诺访'}))).toEqual({wechatAdded:true,visitCommitted:false});
    const fields=read({真题拼团沟通:'是',沟通情况:'已经领取试卷'});
    expect(sourceContactEvidence(fields,'project').effective).toBe(true);
    expect(sourceContactEvidence(fields,'followup').effective).toBe(false);
  });
  it('已到和班型都不生成成绩，真实等级或分数才构成测评结果', () => {
    expect(sourceHasAssessmentResult(read({到访与否:'已到',参与内容:'体验课',班型:'A+'}))).toBe(false);
    expect(sourceHasAssessmentResult(read({'测评成绩（分数）':'0'}))).toBe(true);
    expect(sourceHasAssessmentResult(read({'思维测评等级':'未达A'}))).toBe(true);
    expect(sourceHasAssessmentResult(read({'学习力测评等级':'待测'}))).toBe(false);
  });
});
