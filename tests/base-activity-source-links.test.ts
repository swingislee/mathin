import { describe, expect, it } from 'vitest';
import { buildBaseActivitySourceLinks, parseBaseActivityEntries } from '../scripts/lib/base-activity-source-links.mjs';

const cell = (fieldId: string, fieldName: string, text: string) => ({ fieldId, fieldName, text, kind: 'context' });
const parent = { id: 'source-parent', payload_sha256: 'a'.repeat(64), record_data: { names: ['示例乙'], cells: [
  cell('arrangements', '就读学校', '示例甲大升一公开课周六 10:00\n2. 示例乙四升五周六 9:30 测评'),
  cell('date', '到访日期', '2026/08/22'), cell('staff', '学服老师', '示例老师'),
] } };
const lead = (id: string, name: string, grade: string, sourceId: string) => ({ id, provisional_student_name: name, grade_text: grade, phone: '', source_record_id: sourceId });
const evidence = (id: string, name: string, date: string, time: string, grade: string) => ({ id, payload_sha256: 'b'.repeat(64), record_data: { names: [name], cells: [
  cell('date', '到访日期', date), cell('time', '到访时段', time), cell('grade', '年级/25级', grade), cell('staff', '学服老师', '示例老师'),
] } });
const leads = [lead('first', '示例甲', '1年级', 'same-visit'), lead('other', '示例甲', '1年级', 'other-visit'), lead('second', '示例乙', '4年级', 'second-visit')];
const records = [evidence('same-visit', '示例甲', '2026/08/22', '10：00', '1年级'), evidence('other-visit', '示例甲', '2026/08/29', '15:00', '1年级'),
  evidence('second-visit', '示例乙', '2026/08/22', '9：30', '4年级')];
type ActivityEntry = { name: string; grade: number; time: string; activity: string };
type InferredLink = { lead_id: string | null; match_state: string };

describe('shared activity source associations', () => {
  it('preserves each exact source line and interprets the destination grade', () => {
    const entries = parseBaseActivityEntries(parent);
    expect(entries.map((entry: ActivityEntry) => [entry.name, entry.grade, entry.time, entry.activity])).toEqual([
      ['示例甲', 1, '10:00', '公开课'], ['示例乙', 5, '09:30', '测评'],
    ]);
    expect(entries[1].originalText).toBe('2. 示例乙四升五周六 9:30 测评');
    expect(entries[1].previousGrade).toBe(4);
  });
  it('uses the same visit to distinguish namesakes and retains an inferred state', () => {
    const result = buildBaseActivitySourceLinks(parent, leads, [], records);
    expect(result.links.map((link: InferredLink) => link.lead_id)).toEqual(['first', 'second']);
    expect(result.links.every((link: InferredLink) => link.match_state === 'inferred')).toBe(true);
    expect(result.links[0].match_reason.reasons).toContain('same_visit_date');
    expect(result.links[0].match_reason.reasons).toContain('same_visit_time');
    expect(result.links[1].business_fields[0].display).toContain('5年级');
    expect(result.links[0].business_fields[0].display).not.toContain('示例乙');
    expect(result.summary.ambiguousTopRanks).toBe(0);
  });
  it('keeps stable fragment keys and scores when duplicate source snapshots are present', () => {
    const original = buildBaseActivitySourceLinks(parent, leads, [], records);
    const replay = buildBaseActivitySourceLinks(parent, [...leads].reverse(), [], [...records, ...records]);
    expect(replay).toEqual(original);
  });
  it('keeps equal top scores visible and does not create an identity without a candidate', () => {
    const tied = buildBaseActivitySourceLinks(parent, [lead('a', '示例甲', '1年级', ''), lead('b', '示例甲', '1年级', ''), leads[2]], [], records);
    expect(tied.links[0].match_reason.tied).toBe(true);
    expect(() => buildBaseActivitySourceLinks(parent, [], [], records)).toThrow('ACTIVITY_TARGET_REQUIRED');
  });
  it('requires a complete parse and excludes source records for another named child', () => {
    const malformed = structuredClone(parent);
    malformed.record_data.cells[0].text += '\n另一个未识别的安排';
    expect(() => parseBaseActivityEntries(malformed)).toThrow('ONE_COMPLETE_ACTIVITY_LIST_REQUIRED');
    const wrongName = records.map(record => ({ ...record, record_data: { ...record.record_data, names: ['别的孩子'] } }));
    const result = buildBaseActivitySourceLinks(parent, leads, [], wrongName);
    expect(result.links[0].match_reason.evidenceSourceId).toBeNull();
  });
});
