import { describe, expect, it } from 'vitest';
import { buildAutumnIdentityReview } from '../scripts/lib/autumn-identity-review.mjs';

function fixture() {
  const student = { id: 'student-1', name: '林小安', phones: ['13811112222'], phone: '13811112222', parent_phone: '', grade: 1, school: '小学', deleted_at: null as string | null };
  const row = { key: 'feishu:autumn:one', sourceRecordId: 'one', name: student.name, businessState: 'in_study', grade: '1年级', campus: '紫辰', mode: 'A+',
    teacher: '陈老师', teacherMatch: { identityKey: 'teacher:1', canonicalName: '陈小薇', status: 'current' }, weekday: '周六', time: '9:00-11:00',
    classCandidateIds: ['300'], sameNameContactCandidates: [] as string[], match: { status: 'matched', personId: '100', candidateIds: ['100'] } };
  const source = { mode: 'source_reconciliation_preview', businessWrites: 0, currentAutumn: [row], sourceFiles: [], referenceBases: [],
    people: [] as { key: string; sourcePath: string; tableName: string; sourceRecordId: string }[],
    contactGroups: [] as { key: string; phones: string[]; sourceKeys: string[] }[],
    magic: { students: [{ id: '100', name: student.name, phones: student.phones }], classes: [] },
    policy: { businessAuthority: '主表.base', confirmedStaffDecisions: [], confirmedStaffAliases: [] },
    totals: { employees: { current: 1, placeholder: 0 }, currentAutumn: { teachers: { current: 1 } } } };
  const tables = { students: [student], leads: [] as { id: string; provisional_student_name: string; phone: string; phone_normalized: string; student_id: string | null }[],
    contacts: [] as { id: string; phone: string }[], student_contacts: [] as { student_id: string; contact_id: string }[],
    family_students: [] as { student_id: string; family_id: string }[], family_contacts: [] as { family_id: string; contact_id: string }[],
    data_import_batches: [{ id: 'batch', source_system: 'mofaxiao', import_kind: 'students', status: 'completed' }],
    data_import_rows: [{ batch_id: 'batch', normalized_key: 'mofaxiao:id:100', row_status: 'inserted', target_id: student.id }],
    history_import_records: [] as { source_table_id: string; source_record_id: string; student_id: string; match_status: string }[],
    classrooms: [{ id: 'class-1', name: '1年级秋季班', archived_at: null, trashed_at: null }],
    enrollments: [] as { student_id: string; classroom_id: string; left_at: string | null; status: string }[],
    course_enrollments: [] as { id: string; student_id: string; history_revision: number; record_state: string }[],
    course_enrollment_assignments: [] as { id: string; course_enrollment_id: string; history_revision: number; record_state: string }[],
    business_record_revisions: [] as { id: string; record_id: string }[] };
  return { source, snapshot: { capturedAt: '2026-09-07T00:00:00Z', tables } };
}

describe('autumn student review', () => {
  it('links verified source IDs to the actual target while preserving raw inputs and missing grade', () => {
    const input = fixture(); Object.assign(input.snapshot.tables.students[0], { grade: null });
    const before = structuredClone(input);
    const result = buildAutumnIdentityReview(input.source, input.snapshot);
    expect(result.rows[0]).toMatchObject({ decision: 'link_existing', targetId: 'student-1', targetGradeMissing: true, gradeDifference: false });
    expect(result.totals).toMatchObject({ sourceRows: 1, uniqueLinkedStudents: 1, targetGradesMissing: 1, gradeDifferences: 0 });
    expect(input).toEqual(before);
    expect(result.businessWrites).toBe(0);
  });
  it('does not turn same-name contact candidates into a verified autumn identity', () => {
    const { source, snapshot } = fixture();
    source.currentAutumn[0].match = { status: 'review', personId: '', candidateIds: ['100'] };
    source.currentAutumn[0].sameNameContactCandidates = ['contact'];
    source.contactGroups = [{ key: 'contact', phones: ['13811112222'], sourceKeys: ['history-row'] }];
    source.people = [{ key: 'history-row', sourcePath: '历史.base', tableName: '历史表', sourceRecordId: 'history-one' }];
    snapshot.tables.students.push({ ...snapshot.tables.students[0], id: 'sibling', name: '林小宁' });
    const result = buildAutumnIdentityReview(source, snapshot).rows[0];
    expect(result).toMatchObject({ decision: 'needs_review', targetId: null });
    expect(result.studentCandidates.map((row: { id: string }) => row.id)).toEqual(['student-1', 'sibling']);
    expect(result.contactCandidates[0].sourcePositions).toEqual(['历史.base / 历史表 / history-one']);
  });
  it('keeps conflicting source owners, renamed targets and deleted students for review', () => {
    for (const scenario of ['duplicate', 'renamed', 'deleted']) {
      const { source, snapshot } = fixture();
      if (scenario === 'duplicate') snapshot.tables.data_import_rows.push({ ...snapshot.tables.data_import_rows[0], target_id: 'other' });
      if (scenario === 'renamed') snapshot.tables.students[0].name = '林小宁';
      if (scenario === 'deleted') snapshot.tables.students[0].deleted_at = '2026-01-01';
      expect(buildAutumnIdentityReview(source, snapshot).rows[0], scenario).toMatchObject({ decision: 'needs_review', targetId: null });
    }
  });
  it('does not treat uncompleted ledgers as identity confirmation', () => {
    const { source, snapshot } = fixture();
    snapshot.tables.data_import_batches[0].status = 'validated'; source.magic.students[0].phones = [];
    expect(buildAutumnIdentityReview(source, snapshot).rows[0]).toMatchObject({ decision: 'needs_review', targetId: null });
  });
  it('uses direct and family contact links only with verified class identity', () => {
    const { source, snapshot } = fixture(); snapshot.tables.data_import_rows = [];
    snapshot.tables.students[0].phone = '';
    snapshot.tables.contacts.push({ id: 'contact', phone: '13811112222' });
    snapshot.tables.family_students.push({ student_id: 'student-1', family_id: 'family' });
    snapshot.tables.family_contacts.push({ family_id: 'family', contact_id: 'contact' });
    expect(buildAutumnIdentityReview(source, snapshot).rows[0]).toMatchObject({ decision: 'link_existing', method: 'verified_class_identity_and_target_contact' });
  });
  it('separates new-record candidates, existing leads and empty source records', () => {
    const { source, snapshot } = fixture();
    source.currentAutumn[0].name = '陈小贝'; source.currentAutumn[0].match = { status: 'unmatched', personId: '', candidateIds: [] };
    expect(buildAutumnIdentityReview(source, snapshot).rows[0]).toMatchObject({ decision: 'create_candidate', targetId: null });
    snapshot.tables.leads.push({ id: 'lead', provisional_student_name: '陈小贝', phone: '', phone_normalized: '', student_id: null });
    expect(buildAutumnIdentityReview(source, snapshot).rows[0]).toMatchObject({ decision: 'needs_review', targetId: null });
    source.currentAutumn[0].name = '';
    expect(buildAutumnIdentityReview(source, snapshot).rows[0]).toMatchObject({ decision: 'source_incomplete', targetId: null, studentCandidates: [] });
  });
  it('retains canonical business rows and revision counts instead of proposing replacements', () => {
    const { source, snapshot } = fixture();
    snapshot.tables.course_enrollments.push({ id: 'enrollment', student_id: 'student-1', record_state: 'historical', history_revision: 0 });
    snapshot.tables.course_enrollment_assignments.push({ id: 'assignment', course_enrollment_id: 'enrollment', record_state: 'historical', history_revision: 1 });
    expect(buildAutumnIdentityReview(source, snapshot).rows[0].existingBusiness).toEqual({ total: 2, historical: 2, revised: 1 });
  });
  it('matches current class source mappings and keeps missing schedules separate', () => {
    const { source, snapshot } = fixture();
    snapshot.tables.data_import_batches.push({ id: 'classes', source_system: 'mofaxiao', import_kind: 'classes', status: 'completed' });
    snapshot.tables.data_import_rows.push({ batch_id: 'classes', normalized_key: 'mofaxiao:class:id:300', target_id: 'class-1', row_status: 'inserted' });
    snapshot.tables.enrollments.push({ student_id: 'student-1', classroom_id: 'class-1', left_at: null, status: 'active' });
    const result = buildAutumnIdentityReview(source, snapshot);
    expect(result.classes[0]).toMatchObject({ status: 'link_existing', targetClassIds: ['class-1'] });
    expect(result.rows[0].alreadyInTargetClass).toBe(true);
    source.currentAutumn[0].time = '';
    expect(buildAutumnIdentityReview(source, snapshot).classes[0].status).toBe('source_incomplete');
  });
});
