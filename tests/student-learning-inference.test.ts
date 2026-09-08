import { describe, expect, it } from 'vitest';
import { inferStudentLearningLinks } from '../scripts/lib/student-learning-inference.mjs';
const people = [
  { id: 'a', name: '小明', phone: '13800000001' },
  { id: 'b', name: '小明', parent_phone: '13800000002' },
  { id: 'c', name: '小红' },
];
const record = (names: string[], phones: string[] = []) => ({ id: 'source', source_data: { format: 'feishu-base' }, record_data: { names, phones } });
const input = (r: ReturnType<typeof record>) => ({ students: people, records: [r], leads: [], associations: [], candidates: [], currentStudentIds: ['a'] });
describe('automatic learning record associations', () => {
  it('prefers matching phone evidence over same-name active status', () => {
    expect(inferStudentLearningLinks(input(record(['小明'], ['13800000002'])))[0].studentId).toBe('b');
  });
  it('saves the likely student while retaining missing-phone and same-name doubts', () => {
    const [link] = inferStudentLearningLinks(input(record(['小明'])));
    expect(link.studentId).toBe('a');
    expect(link.reason.doubts).toEqual(['phone_not_corroborated', 'same_name_students']);
  });
  it('links a unique name without requiring advance confirmation', () => {
    const [link] = inferStudentLearningLinks(input(record(['小 红'])));
    expect(link.studentId).toBe('c');
    expect(link.reason.evidence).toContain('unique_student_name');
  });
  it('preserves existing confirmed or imported associations and skips unsupported matches', () => {
    expect(inferStudentLearningLinks({ ...input(record(['小明'])), associations: [{ record_id: 'source' }] })).toEqual([]);
    expect(inferStudentLearningLinks({ ...input(record(['小明'])), records: [{ ...record(['小明']), student_id: 'c' }] })).toEqual([]);
    expect(inferStudentLearningLinks(input(record(['陌生人'])))).toEqual([]);
  });
});
