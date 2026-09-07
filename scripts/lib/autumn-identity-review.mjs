import { createHash } from 'node:crypto';
import { normalizeName, normalizeCampus, normalizeTime, phonesIn } from './source-reconciliation.mjs';

const unique = values => [...new Set(values.filter(Boolean))];
const countBy = (rows, select) => rows.reduce((counts, row) => { const key = select(row); counts[key] = (counts[key] ?? 0) + 1; return counts; }, {});
const add = (map, key, value) => { const values = map.get(key) ?? new Set(); values.add(value); map.set(key, values); };
const shortHash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const sourcePosition = row => `${row.sourcePath} / ${row.tableName} / ${row.cell || row.sourceRecordId || `第${row.sourceRow}行`}`;
const gradeNumber = value => /^([1-9])年级$/u.exec(value)?.[1] ?? null;

/** 当前秋季业务保持来源状态；其他同名资料只提供核对证据，确认后的关联才可进入导入批次。 */
export function buildAutumnIdentityReview(source, snapshot) {
  if (source.mode !== 'source_reconciliation_preview' || source.businessWrites !== 0 || !snapshot.capturedAt) throw new Error('AUTUMN_REVIEW_INPUT_INVALID');
  if (new Set(source.currentAutumn.map(row => row.key)).size !== source.currentAutumn.length) throw new Error('AUTUMN_SOURCE_KEY_DUPLICATED');
  const tables = snapshot.tables;
  const students = new Map(tables.students.map(row => [row.id, row]));
  const contacts = new Map((tables.contacts ?? []).map(row => [row.id, row]));
  const studentPhones = student => {
    const families = (tables.family_students ?? []).filter(row => row.student_id === student.id).map(row => row.family_id);
    const contactIds = unique([...(tables.student_contacts ?? []).filter(row => row.student_id === student.id).map(row => row.contact_id),
      ...(tables.family_contacts ?? []).filter(row => families.includes(row.family_id)).map(row => row.contact_id)]);
    return unique([student.phone, student.parent_phone, ...contactIds.flatMap(id => [contacts.get(id)?.phone, contacts.get(id)?.phone_normalized])].flatMap(phonesIn));
  };
  const targetStudents = [...students.values()].map(row => ({ ...row, phones: studentPhones(row) }));
  const targetById = new Map(targetStudents.map(row => [row.id, row]));
  const nameIndex = new Map(), phoneIndex = new Map();
  for (const student of targetStudents) {
    add(nameIndex, normalizeName(student.name), student.id);
    for (const phone of student.phones) add(phoneIndex, phone, student.id);
  }
  const batches = new Map(tables.data_import_batches.filter(row => row.status === 'completed').map(row => [row.id, row]));
  const magicOwners = new Map(), classOwners = new Map();
  for (const row of tables.data_import_rows) {
    const batch = batches.get(row.batch_id);
    if (!batch || batch.source_system !== 'mofaxiao' || row.row_status !== 'inserted' || !row.target_id) continue;
    const studentId = /^mofaxiao:id:(\d+)$/u.exec(row.normalized_key)?.[1];
    const classId = /^mofaxiao:class:id:(\d+)$/u.exec(row.normalized_key)?.[1];
    if (batch.import_kind === 'students' && studentId) add(magicOwners, studentId, row.target_id);
    if (batch.import_kind === 'classes' && classId) add(classOwners, classId, row.target_id);
  }
  const sourceOwners = new Map();
  for (const row of tables.history_import_records ?? []) if (row.student_id && row.match_status === 'matched') {
    add(sourceOwners, `feishu:${row.source_table_id}:${row.source_record_id}`, row.student_id);
  }
  const magicById = new Map(source.magic.students.map(row => [row.id, row]));
  const contactByKey = new Map(source.contactGroups.map(row => [row.key, row]));
  const sourcePeople = new Map(source.people.map(row => [row.key, row]));
  const targetClasses = new Map((tables.classrooms ?? []).map(row => [row.id, row]));
  const classGroups = new Map();
  for (const row of source.currentAutumn) {
    const values = [row.grade, row.campus, row.mode, row.teacherMatch.identityKey, row.weekday, normalizeTime(row.time)];
    const key = shortHash(JSON.stringify(values));
    const group = classGroups.get(key) ?? { key, grade: row.grade, campus: row.campus, mode: row.mode, teacher: row.teacherMatch.canonicalName || row.teacher,
      teacherStatus: row.teacherMatch.status, weekday: row.weekday, time: row.time, sourceKeys: [], referenceClassIds: [] };
    group.sourceKeys.push(row.key); group.referenceClassIds.push(...row.classCandidateIds); classGroups.set(key, group);
  }
  const classes = [...classGroups.values()].map((group, index) => {
    const referenceIds = unique(group.referenceClassIds);
    const targetIds = unique(referenceIds.flatMap(id => [...(classOwners.get(id) ?? [])]));
    const liveTargets = targetIds.filter(id => targetClasses.has(id) && !targetClasses.get(id).trashed_at && !targetClasses.get(id).archived_at);
    const complete = [group.grade, group.campus, group.mode, group.teacher, group.weekday, group.time].every(Boolean);
    const status = !complete ? 'source_incomplete' : referenceIds.length !== 1 || targetIds.length > 1 || liveTargets.length !== targetIds.length ? 'needs_review'
      : liveTargets.length === 1 ? 'link_existing' : 'reference_only';
    const nearby = referenceIds.length ? [] : source.magic.classes.filter(item => item.term === '秋季' && item.starts.startsWith('2026-')
      && normalizeName(item.grade) === normalizeName(group.grade) && normalizeCampus(item.campus) === normalizeCampus(group.campus) && normalizeName(item.mode) === normalizeName(group.mode))
      .map(item => ({ id: item.id, name: item.name, teacher: item.teacherMatch.canonicalName || item.teacher, weekday: item.weekday, time: item.time,
        differences: [normalizeName(item.teacherMatch.canonicalName || item.teacher) !== normalizeName(group.teacher) ? '老师' : '', item.weekday !== group.weekday ? '周次' : '',
          normalizeTime(item.time) !== normalizeTime(group.time) ? '时段' : ''].filter(Boolean) }));
    return { ...group, code: `B${String(index + 1).padStart(2, '0')}`, referenceClassIds: referenceIds, targetClassIds: targetIds,
      targetClasses: targetIds.map(id => targetClasses.get(id)).filter(Boolean), status, nearby,
      question: status === 'link_existing' ? '' : !complete ? '请补齐班级的年级、校区、班型、老师、周次或时段。'
        : status === 'reference_only' ? '魔法校有对应班级，请确认开发端应关联的班级或新建班级。'
          : nearby.length ? '请核对参考班级的老师、周次或时段差异。' : '请确认该班级的名称及当前排课，准备建立对应班级。' };
  });
  const classBySource = new Map(classes.flatMap(group => group.sourceKeys.map(key => [key, group])));
  const businessByStudent = new Map();
  const enrollmentOwners = new Map((tables.course_enrollments ?? []).map(row => [row.id, row.student_id]));
  const revisions = new Set((tables.business_record_revisions ?? []).map(row => row.record_id));
  const revisedActivities = new Set((tables.activities ?? []).filter(row => row.history_revision > 0).map(row => row.id));
  for (const table of ['activity_registrations', 'assessment_results', 'course_enrollments', 'course_enrollment_assignments', 'course_opportunities', 'student_follow_ups']) {
    for (const row of tables[table] ?? []) {
      const id = row.student_id || enrollmentOwners.get(row.course_enrollment_id);
      if (!id) continue;
      const counts = businessByStudent.get(id) ?? { total: 0, historical: 0, revised: 0 };
      counts.total += 1; if (row.record_state === 'historical') counts.historical += 1;
      if (row.history_revision > 0 || revisions.has(row.id) || revisedActivities.has(row.activity_id)) counts.revised += 1;
      businessByStudent.set(id, counts);
    }
  }
  const rows = source.currentAutumn.map((row, index) => {
    const contacts = row.sameNameContactCandidates.map(key => contactByKey.get(key)).filter(Boolean).map(group => ({ ...group,
      sourcePositions: unique(group.sourceKeys.map(key => sourcePeople.get(key)).filter(Boolean).map(sourcePosition)) }));
    const ref = row.match.status === 'matched' ? magicById.get(row.match.personId) : null;
    const candidatePhones = unique([...contacts.flatMap(group => group.phones), ...(ref?.phones ?? [])]);
    const strongIds = unique([...(row.match.status === 'matched' ? [...(magicOwners.get(row.match.personId) ?? [])] : []), ...(sourceOwners.get(row.key) ?? [])]);
    const sameNameIds = [...(nameIndex.get(normalizeName(row.name)) ?? [])];
    const phoneIds = unique(candidatePhones.flatMap(phone => [...(phoneIndex.get(phone) ?? [])]));
    const refCandidateIds = unique((row.match.candidateIds ?? []).flatMap(id => [...(magicOwners.get(id) ?? [])]));
    const ids = row.name ? unique([...strongIds, ...sameNameIds, ...refCandidateIds, ...phoneIds]) : [];
    const candidates = ids.map(id => targetById.get(id)).filter(Boolean).map(student => ({ id: student.id, name: student.name, phones: student.phones,
      grade: student.grade, school: student.school, deleted: Boolean(student.deleted_at),
      sameName: normalizeName(student.name) === normalizeName(row.name), matchingPhones: student.phones.filter(phone => candidatePhones.includes(phone)),
      sourceIdMatched: strongIds.includes(student.id), existingBusiness: businessByStudent.get(student.id) ?? { total: 0, historical: 0, revised: 0 } }));
    const leads = row.name ? (tables.leads ?? []).filter(lead => normalizeName(lead.provisional_student_name) === normalizeName(row.name)
      || phonesIn(lead.phone_normalized || lead.phone).some(phone => candidatePhones.includes(phone))).map(lead => ({ id: lead.id, name: lead.provisional_student_name,
      phones: phonesIn(lead.phone_normalized || lead.phone), studentId: lead.student_id, sameName: normalizeName(lead.provisional_student_name) === normalizeName(row.name) })) : [];
    let decision = 'needs_review', targetId = null, method = null;
    if (!row.name) decision = 'source_incomplete';
    else if (strongIds.length === 1) {
      const target = targetById.get(strongIds[0]);
      if (target && !target.deleted_at && normalizeName(target.name) === normalizeName(row.name)) {
        decision = 'link_existing'; targetId = target.id; method = 'verified_source_mapping';
      }
    } else if (strongIds.length === 0 && ref?.phones.length) {
      const exact = candidates.filter(candidate => candidate.sameName && !candidate.deleted && ref.phones.every(phone => candidate.phones.includes(phone)));
      if (exact.length === 1) { decision = 'link_existing'; targetId = exact[0].id; method = 'verified_class_identity_and_target_contact'; }
    }
    if (decision === 'needs_review' && !ids.length && !leads.length && !row.match.candidateIds.length && contacts.length <= 1
      && /^[\p{Script=Han}]{2,6}$/u.test(row.name)) decision = 'create_candidate';
    const exactCandidates = candidates.filter(candidate => candidate.sameName);
    let question = '';
    if (decision === 'source_incomplete') question = '请补充这条秋季记录的学生姓名和业务状态。';
    else if (decision === 'create_candidate') question = candidatePhones.length ? '未找到已有主档，请确认联系方式及是否新建学生档案。' : '未找到已有主档，请补充家庭联系方式，并确认是否新建学生档案。';
    else if (decision === 'needs_review') {
      if (strongIds.length) question = '来源 ID 的已有归属存在姓名、删除状态或多重关联问题，请核对目标主档。';
      else if (exactCandidates.length > 1) question = '已有多条同名学生主档，请用家庭联系方式确认对应学生。';
      else if (exactCandidates.length === 1) question = contacts.length > 1 ? '已有同名主档，但来源有多组联系方式，请确认本条秋季学员及其家庭电话。'
        : '已有同名主档，请确认本条秋季学员是否为该候选，并核对家庭联系方式。';
      else if (leads.some(lead => lead.sameName)) question = '已有同名线索，请确认是否为同一孩子及应关联或建立的学生主档。';
      else if (candidates.length || leads.length) question = '候选仅有电话或来源 ID 关联，姓名不同，请确认孩子姓名及家庭关系。';
      else question = '来源有多组联系信息或特殊姓名，请补充可确认的姓名与家庭联系方式。';
    }
    const target = targetId ? targetById.get(targetId) : null;
    const group = classBySource.get(row.key);
    const currentMemberships = targetId ? (tables.enrollments ?? []).filter(item => item.student_id === targetId && !item.left_at && item.status === 'active') : [];
    const sourceGrade = gradeNumber(row.grade);
    return { code: `S${String(index + 1).padStart(3, '0')}`, sourceKey: row.key, sourceRecordId: row.sourceRecordId, name: row.name, businessState: row.businessState,
      grade: row.grade, campus: row.campus, classCode: group.code, teacher: row.teacherMatch.canonicalName || row.teacher, decision, targetId, method, question,
      candidatePhones, contactCandidates: contacts, studentCandidates: candidates, leadCandidates: leads,
      referenceMatch: row.match, referenceCandidates: (row.match.candidateIds ?? []).map(id => magicById.get(id)).filter(Boolean),
      targetGrade: target?.grade ?? null, targetGradeMissing: Boolean(target && sourceGrade !== null && target.grade === null),
      gradeDifference: Boolean(target && sourceGrade !== null && target.grade !== null && Number(sourceGrade) !== target.grade),
      existingBusiness: targetId ? businessByStudent.get(targetId) ?? { total: 0, historical: 0, revised: 0 } : null,
      alreadyInTargetClass: currentMemberships.some(item => group.targetClassIds.includes(item.classroom_id)),
      duplicateAutumnSourceKeys: source.currentAutumn.filter(other => other.key !== row.key && normalizeName(other.name) === normalizeName(row.name)).map(other => other.key) };
  });
  return { schemaVersion: 1, mode: 'autumn_identity_review', generatedAt: new Date().toISOString(), targetSnapshotAt: snapshot.capturedAt, businessWrites: 0,
    policy: { currentBusinessAuthority: source.policy.businessAuthority, otherSameNameSourcesAreCandidates: true, currentStateUpdates: false },
    rows, classes, staffDecisions: source.policy.confirmedStaffDecisions, priorStaffAliases: source.policy.confirmedStaffAliases,
    sourceSummary: { files: source.sourceFiles.length, currentEmployees: source.totals.employees.current, placeholderEmployees: source.totals.employees.placeholder,
      currentAutumnTeachers: source.totals.currentAutumn.teachers, referenceBases: source.referenceBases },
    totals: { sourceRows: rows.length, businessStates: countBy(rows, row => row.businessState), decisions: countBy(rows, row => row.decision),
      uniqueLinkedStudents: new Set(rows.map(row => row.targetId).filter(Boolean)).size, classGroups: classes.length, classDecisions: countBy(classes, row => row.status),
      rowsWithCandidateContacts: rows.filter(row => row.contactCandidates.length).length, gradeDifferences: rows.filter(row => row.gradeDifference).length,
      targetGradesMissing: rows.filter(row => row.targetGradeMissing).length,
      rowsAlreadyInTargetClass: rows.filter(row => row.alreadyInTargetClass).length, revisedBusinessRecords: (tables.business_record_revisions ?? []).length,
      targetStudents: targetStudents.length, targetLeads: (tables.leads ?? []).length } };
}
