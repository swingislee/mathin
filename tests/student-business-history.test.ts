import { describe, expect, it } from 'vitest';
import { buildStudentBusinessHistory, historicalDate, historicalEnrollmentPeriods } from '../scripts/lib/student-business-history.mjs';

const cell = (fieldName: string, text: string, fieldId = fieldName) => ({ fieldName, text, fieldId, kind: 'text' });
const source = (id: string, tableName: string, cells: ReturnType<typeof cell>[], linked = true) => ({
  id, student_id: linked ? 'student-one' : null, match_status: linked ? 'matched' : 'review',
  record_data: { tableName, cells },
});
const family = (records: ReturnType<typeof source>[]) => ({ manifest: { mode: 'local_family_audit', subject: {studentId: 'student-one'} }, payloadHash: 'parent-hash', records });

describe('historical business conversion', () => {
  it('splits summer and autumn intentions while keeping the final outcome and conversation date unknown', () => {
    const content = '暑假要出去玩，把所有课都停了。妈妈表示秋季课程现在不着急报。';
    const result = buildStudentBusinessHistory(family([source('renewal', '2026暑秋续报数据表', [cell('未报/连报情况', content)])]));
    expect(result.rows.student_renewal_history.map((row: {period_key:string;outcome:string}) => [row.period_key,row.outcome])).toEqual([['summer','unknown'],['autumn','unknown']]);
    expect(result.rows.student_communication_history).toHaveLength(1);
    expect(result.rows.student_communication_history[0]).toMatchObject({content,occurred_on:null,author_label:null});
  });
  it('keeps a reported competition award pending edition confirmation and never fabricates attendance', () => {
    const result = buildStudentBusinessHistory(family([
      source('competition','袋鼠报名与备考信息表',[cell('报名日期','2026/03/15')]),
      source('renewal','2026暑秋续报数据表',[cell('未报/连报情况','孩子学的挺好的，袋鼠竞赛银奖，暑假要出去玩。')]),
    ]));
    expect(result.rows.student_activity_history[0]).toMatchObject({registered_on:'2026-03-15',occurred_on:null,participation_status:'registered',reported_result:'银奖',result_link_status:'edition_unconfirmed',result_source_record_id:'renewal'});
  });
  it('does not turn an aspiration, negation or ambiguous competition edition into an award', () => {
    for(const content of ['争取袋鼠竞赛银奖，暑假考虑续报。','没有获得袋鼠竞赛银奖。']) {
      const result = buildStudentBusinessHistory(family([source('competition','袋鼠报名与备考信息表',[cell('报名日期','2026/03/15')]),source('renewal','2026暑秋续报数据表',[cell('未报/连报情况',content)])]));
      expect(result.rows.student_activity_history[0]).toMatchObject({reported_result:''});
    }
  });
  it('splits repeated enrollment groups without borrowing another period fee or class', () => {
    const record = source('enrollment','学员报名信息',[
      cell('报课7 [AK]','寒假','AK346'),cell('报名日期 [AL]','2025.12.29','AL346'),cell('缴费金额 [AN]','1260','AN346'),
      cell('报课8 [AP]','春季','AP346'),cell('报名日期 [AQ]','2025.12.29','AQ346'),cell('缴费金额 [AS]','','AS346'),
      cell('学期 [DB]','寒假','DB346'),cell('班型 [DC]','A+','DC346'),cell('老师 [DF]','教师甲','DF346'),
      cell('学期 [DJ]','春季','DJ346'),cell('班型 [DK]','G+','DK346'),cell('老师 [DN]','教师乙','DN346'),
    ]);
    const rows = historicalEnrollmentPeriods(record);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({period_label:'寒假',amount:1260,class_label:'A+',teacher_label:'教师甲'});
    expect(rows[1]).toMatchObject({period_label:'春季',amount:null,class_label:'G+',teacher_label:'教师乙'});
    expect(rows[0].source_field_ids).not.toContain('AS346');
    expect(rows[1].source_field_ids).not.toContain('AN346');
  });
  it('retains name-only and roster candidates for review without adding student business facts', () => {
    const result = buildStudentBusinessHistory(family([source('candidate','2026暑秋续报数据表',[cell('未报/连报情况','暑假暂停')],false)]));
    expect(Object.values(result.rows).flat()).toHaveLength(0);
    expect(result.manifest.retainedForReview).toHaveLength(1);
  });
  it('keeps assessment labels and source notes without inventing a numeric score', () => {
    const result = buildStudentBusinessHistory(family([source('assessment','到访数据与信息表1.0-总',[cell('到访日期','2025/12/29'),cell('思维测评等级','A+'),cell('学员情况','计算表现较好'),cell('家长情况','家长希望先了解课程')])]));
    expect(result.rows.student_assessment_history[0]).toMatchObject({assessed_on:'2025-12-29',assessment_band:'A+',score:null,learning_notes:'计算表现较好',parent_notes:'家长希望先了解课程'});
  });
  it('has deterministic identities and hashes without mutating the preserved source', () => {
    const input=family([source('renewal','2026暑秋续报数据表',[cell('未报/连报情况','暑假暂停课程')])]);
    const before=structuredClone(input);
    expect(buildStudentBusinessHistory(input)).toEqual(buildStudentBusinessHistory(input));
    expect(input).toEqual(before);
  });
  it('accepts only complete, valid source dates', () => {
    expect(historicalDate('2026/02/29')).toBeNull();
    expect(historicalDate('12月29日')).toBeNull();
    expect(historicalDate('2024.2.29')).toBe('2024-02-29');
  });
});
