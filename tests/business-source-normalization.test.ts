import { describe, expect, it } from 'vitest';
import { ASSESSMENT_BANDS } from '../src/features/school/activity-workflow-contract';
import { normalizeSourceAssessmentBand, normalizeSourceContact, sourceAssessmentNote, sourceScore, sourceVisitKinds, hasSourceAssessmentConclusion, resolveSourceStaffId, sourceLeadContactFacts } from '../src/features/school/business-source-contract';

describe('source expressions use the existing business vocabulary', () => {
  it('maps only the six supported assessment bands', () => {
    expect(['X+', 'G+', 'A', 'A+', 'S', 'C'].map(normalizeSourceAssessmentBand)).toEqual([...ASSESSMENT_BANDS]);
    expect(normalizeSourceAssessmentBand(' A ＋ ')).toBe('a_plus');
    for (const value of ['未达A', 'below_a']) {
      expect(normalizeSourceAssessmentBand(value)).toBe('x_plus');
      expect(sourceAssessmentNote(value)).toContain('原测评等级：未达A');
    }
    for (const value of ['优秀', 'B', '基础', '培优']) {
      expect(normalizeSourceAssessmentBand(value)).toBeNull();
      expect(sourceAssessmentNote(value)).toContain(value === 'below_a' ? '未达A' : value);
    }
  });
  it('keeps contradictory and unknown contact expressions in notes', () => {
    expect(normalizeSourceContact('未通')).toMatchObject({ outcome: 'unreachable' });
    expect(normalizeSourceContact('加V、诺访')).toMatchObject({ outcome: 'connected', wechatAdded: true, visitCommitted: true });
    expect(normalizeSourceContact('下期次再联系')).toMatchObject({ outcome: 'declined' });
    expect(normalizeSourceContact('暂无结果')).toMatchObject({ outcome: null, note: '原联系结果：暂无结果' });
    expect(normalizeSourceContact('未通、加V')).toMatchObject({ outcome: null, note: '原联系结果：未通、加V' });
  });
  it('requires an explicit denominator and never invents a maximum score', () => {
    expect(sourceScore('83')).toEqual({ score: 83, maxScore: null, note: '' });
    expect(sourceScore('83/120')).toEqual({ score: 83, maxScore: 120, note: '' });
    expect(sourceScore('')).toEqual({ score: null, maxScore: null, note: '' });
    expect(sourceScore('备考83，英语90')).toMatchObject({ score: null, maxScore: null });
    expect(sourceScore('120/100')).toMatchObject({ score: null, maxScore: null });
  });
  it('uses 1v1 for individual visits and keeps completion separate from participation',()=>{
    for(const content of ['一对一沟通','散测',''])expect(sourceVisitKinds(content,'','','')).toEqual(['assessment_1v1']);
    expect(sourceVisitKinds('思闯','','','')).toEqual(['competition']);
    expect(sourceVisitKinds('随堂试听','','','')).toEqual(['trial_class']);
    expect(hasSourceAssessmentConclusion({strengths:'家长关注点：希望提升专注力'})).toBe(false);
    expect(hasSourceAssessmentConclusion({strengths:'原测评等级：未达A'})).toBe(true);
    expect(hasSourceAssessmentConclusion({score:0})).toBe(true);
  });
  it('links only a unique active staff identity',()=>{
    const profile={id:'staff',display_name:'示例老师',role:'staff',is_active:true,account_status:'active'};
    expect(resolveSourceStaffId('示例老师',[profile])).toBe('staff');
    expect(resolveSourceStaffId('示例老师',[profile,{...profile,id:'another'}])).toBeNull();
    expect(resolveSourceStaffId('示例老师',[{...profile,is_active:false}])).toBeNull();
    expect(resolveSourceStaffId('示例老师',[{...profile,role:'parent'}])).toBeNull();
  });
  it('retains explicit negative contact facts and interest without inventing a conversation',()=>{
    expect(sourceLeadContactFacts('用户当下加V与否：未\n诺访与否：否\n意向分类：C')).toEqual({wechatAdded:false,visitCommitted:false,interestLevel:'C'});
    expect(sourceLeadContactFacts('意向分类：A\n意向分类：C')).toEqual({wechatAdded:null,visitCommitted:null,interestLevel:null});
  });
});
