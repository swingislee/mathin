import { describe, expect, it } from 'vitest';
import { ASSESSMENT_BANDS } from '../src/features/school/activity-workflow-contract';
import { normalizeSourceAssessmentBand, normalizeSourceContact, sourceAssessmentNote, sourceScore } from '../src/features/school/business-source-contract';

describe('source expressions use the existing business vocabulary', () => {
  it('maps only the six supported assessment bands', () => {
    expect(['X+', 'G+', 'A', 'A+', 'S', 'C'].map(normalizeSourceAssessmentBand)).toEqual([...ASSESSMENT_BANDS]);
    expect(normalizeSourceAssessmentBand(' A ＋ ')).toBe('a_plus');
    for (const value of ['未达A', 'below_a', '优秀', 'B', '基础', '培优']) {
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
});
