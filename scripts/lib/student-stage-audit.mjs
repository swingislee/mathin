// 审计只陈述已有记录及关联；姓名电话候选不改变身份或主阶段。
export function analyzeStudentStageSnapshot(data) {
  const today = new Date(new Date(data.capturedAt).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sourceValue = (record, name) => (record.record_data.cells ?? []).find(cell => cell.fieldName.replace(/\s*\[[A-Z]+\]$/u, '').trim() === name)?.text.trim() ?? '';
  const sourceDate = value => {
    const match = value.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/u);
    if (!match) return null;
    const iso = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
  };
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const students = index(data.students), leads = index(data.leads), registrations = index(data.activity_registrations);
  const activities = index(data.activities), sources = index(data.history_import_records);
  const byKey = new Map(data.stages.map(row => [row.key, { ...row, name: row.student_id ? students.get(row.student_id)?.name : leads.get(row.lead_id)?.provisional_student_name,
    phone: row.student_id ? students.get(row.student_id)?.parent_phone || students.get(row.student_id)?.phone : leads.get(row.lead_id)?.phone,
    sourceIds: new Set(), contacts: [], registrations: [], assessments: [], enrollments: [], memberships: [], opportunities: [], notes: [], leadIds: new Set(), candidates: [] }]));
  const studentKey = id => id ? `student:${id}` : null;
  const leadKey = id => id ? studentKey(leads.get(id)?.student_id) ?? `lead:${id}` : null;
  const sourceKeys = new Map();
  const addSource = (sourceId, key) => {
    if (!sourceId || !byKey.has(key)) return;
    if (!sourceKeys.has(sourceId)) sourceKeys.set(sourceId, new Set());
    sourceKeys.get(sourceId).add(key); byKey.get(key).sourceIds.add(sourceId);
  };
  const associations = new Map(data.history_import_associations.map(row => [row.record_id, row.student_id]));
  for (const row of data.history_import_records) addSource(row.id, studentKey(associations.get(row.id) ?? row.student_id) ?? leadKey(row.lead_id));
  for (const row of data.leads) { const key = leadKey(row.id); addSource(row.source_record_id, key); byKey.get(key)?.leadIds.add(row.id); }
  // 同一源行的报名可能尚无 student_id，而课程机会已显式关联 Lead；先收集全部直接来源关联。
  for (const collection of ['lead_communications','activity_registrations','assessment_results','course_enrollments','course_opportunities','student_follow_ups']) {
    for (const row of data[collection]) {
      addSource(row.source_record_id,studentKey(row.student_id));
      addSource(row.source_record_id,leadKey(row.lead_id));
    }
  }
  const refs = row => {
    const keys = new Set([studentKey(row.student_id), leadKey(row.lead_id)].filter(key => byKey.has(key)));
    const sourceSubjects = sourceKeys.get(row.source_record_id);
    if (!keys.size && sourceSubjects?.size === 1) for (const key of sourceSubjects) keys.add(key);
    return keys;
  };
  const add = (row, collection, keys = refs(row)) => { for (const key of keys) { byKey.get(key)?.[collection].push(row); addSource(row.source_record_id, key); } };
  for (const row of data.lead_communications) add(row, 'contacts');
  for (const row of data.activity_registrations) add(row, 'registrations');
  for (const row of data.assessment_results) add(row, 'assessments', new Set([...refs(row), ...refs(registrations.get(row.activity_registration_id) ?? {})]));
  for (const row of data.course_enrollments) add(row, 'enrollments');
  for (const row of data.enrollments) add(row, 'memberships');
  for (const row of data.course_opportunities) add(row, 'opportunities');
  for (const row of data.student_follow_ups) add(row, 'notes');
  const normalizedName = value => (value ?? '').normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('zh');
  const normalizedPhone = value => (value ?? '').replace(/\D/gu, '');
  const studentIdentities = new Map();
  for (const row of data.students.filter(row => !row.deleted_at)) {
    for (const phone of new Set([row.phone, row.parent_phone].filter(value => !/[*＊xX]/u.test(value ?? '')).map(normalizedPhone).filter(value => /^\d{6,20}$/u.test(value)))) {
      const key = `${normalizedName(row.name)}:${phone}`;
      if (!studentIdentities.has(key)) studentIdentities.set(key, new Set());
      studentIdentities.get(key).add(row.id);
    }
  }
  const countBy = (rows, key) => Object.entries(rows.reduce((counts, row) => { const value = key(row); counts[value] = (counts[value] ?? 0) + 1; return counts; }, {}))
    .map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  const rows = [...byKey.values()].map(row => {
    const sourceRows = [...row.sourceIds].map(id => sources.get(id)).filter(Boolean);
    const cells = sourceRows.flatMap(source => source.record_data.cells ?? []);
    const academic = row.assessments.filter(result => result.score !== null || result.assessment_band
      || /(?:原测评等级|学习力测评等级)：/u.test(result.strengths ?? ''));
    const assessmentAttended = row.registrations.filter(registration => registration.status === 'attended'
      && ['assessment','assessment_1v1'].includes(activities.get(registration.activity_id)?.kind));
    const renewalSources = sourceRows.filter(source => /续报|窗口期/u.test(source.record_data.tableName ?? ''));
    const rosterSources = sourceRows.filter(source => source.source_data.format === 'xlsx' && sourceValue(source,'班级名称') && sourceValue(source,'学生ID')
      && ['在班学生','历史在班学生'].includes(sourceValue(source,'状态')));
    const datedRosters = rosterSources.map(source => ({ id: source.id, status: sourceValue(source,'状态'),
      startsOn: sourceDate(sourceValue(source,'开课日期')), endsOn: sourceDate(sourceValue(source,'结束日期')) }));
    const exactStudents = !row.student_id && normalizedPhone(row.phone) && !/[*＊xX]/u.test(row.phone ?? '')
      ? [...studentIdentities.get(`${normalizedName(row.name)}:${normalizedPhone(row.phone)}`) ?? []] : [];
    const flags = {
      enrolledFact: row.enrollments.length > 0,
      courseWithoutTerm: row.enrollments.some(enrollment => !enrollment.term_id),
      courseWithoutStudent: row.enrollments.some(enrollment => !enrollment.student_id),
      membershipFact: row.memberships.length > 0,
      sourceClassRoster: rosterSources.length > 0,
      sourceClassCurrentDate: datedRosters.some(roster => roster.status === '在班学生' && roster.endsOn && roster.endsOn >= today),
      sourceClassEnded: datedRosters.some(roster => roster.status === '历史在班学生' || roster.endsOn && roster.endsOn < today),
      sourceClassDateMissing: datedRosters.some(roster => roster.status === '在班学生' && !roster.endsOn),
      sourceMasterHistory: sourceRows.some(source => source.source_data.format === 'xlsx' && sourceValue(source,'学生状态') === '历史'),
      sourceMasterCurrent: sourceRows.some(source => source.source_data.format === 'xlsx' && sourceValue(source,'学生状态') === '在读'),
      academicResult: academic.length > 0,
      assessmentAttended: assessmentAttended.length > 0,
      appointmentRecord: row.registrations.length > 0,
      renewalRecord: row.opportunities.some(opportunity => opportunity.opportunity_type === 'renewal') || renewalSources.length > 0,
      connectedResult: row.contacts.some(contact => ['connected','declined'].includes(contact.outcome)),
      unspecifiedContact: row.contacts.some(contact => contact.outcome === null),
      unreachableOnly: row.contacts.length > 0 && row.contacts.every(contact => ['unreachable','invalid_number'].includes(contact.outcome)),
      noteRecord: row.notes.length > 0,
      explicitVisitSource: cells.some(cell => cell.fieldName === '到访与否' && cell.text === '已到'),
      explicitPaidSource: cells.some(cell => ['报名与否','是否续报','续报与否'].includes(cell.fieldName) && ['已报名','已报','是','已续','新报','已缴费','新报（不用续报）'].includes(cell.text)),
      refundSource: cells.some(cell => ['续报与否','是否续报','报名与否'].includes(cell.fieldName) && ['已退费','已退款','已退课'].includes(cell.text)),
      exactStudentCandidate: exactStudents.length > 0,
      sourceIdentityConflict: [...row.sourceIds].some(id => sourceKeys.get(id)?.size > 1),
      usablePhoneMissing: !/^\d{6,20}$/u.test(normalizedPhone(row.phone)) || /[*＊xX]/u.test(row.phone ?? ''),
    };
    const bucket = flags.enrolledFact || flags.membershipFact ? 'has_enrollment_or_class_fact'
      : flags.sourceClassRoster ? 'has_class_roster_source'
      : flags.academicResult ? 'has_academic_result' : flags.assessmentAttended || flags.explicitVisitSource ? 'has_attendance_fact'
      : flags.renewalRecord || flags.explicitPaidSource || flags.refundSource ? 'has_renewal_or_payment_source'
      : flags.appointmentRecord ? 'has_activity_registration' : flags.unspecifiedContact ? 'contact_result_unspecified'
      : flags.connectedResult ? 'has_effective_contact' : flags.noteRecord ? 'has_followup_note'
      : flags.unreachableOnly ? 'only_unsuccessful_contact' : 'no_later_business_fact_located';
    return { key: row.key, studentId: row.student_id, leadId: row.lead_id, name: row.name,
      maskedPhone: row.phone ? `${row.phone.slice(0,3)}****${row.phone.slice(-4)}` : '', stage: row.stage, detail: row.detail, bucket, flags,
      enrollmentIds: row.enrollments.map(item => item.id), assessmentIds: academic.map(item => item.id), registrationIds: row.registrations.map(item => item.id),
      contactIds: row.contacts.map(item => item.id), noteIds: row.notes.map(item => item.id), opportunityIds: row.opportunities.map(item => item.id),
      sourceIds: [...row.sourceIds], sourceTables: [...new Set(sourceRows.map(source => source.record_data.tableName))],
      rosterSources: datedRosters, exactStudentCandidates: exactStudents };
  });
  const first = rows.filter(row => row.stage === 'awaiting_first_contact');
  const summary = { capturedAt: data.capturedAt, subjects: rows.length, awaitingFirstContact: first.length,
    firstContactBuckets: countBy(first, row => row.bucket), firstContactFlags: Object.fromEntries(Object.keys(first[0]?.flags ?? {})
      .map(flag => [flag, first.filter(row => row.flags[flag]).length])),
    stageBySubjectKind: countBy(rows, row => `${row.stage}|${row.studentId ? 'student' : 'unlinked_lead'}`),
    exactStudentCandidates: countBy(first.filter(row => row.flags.exactStudentCandidate), row => String(row.exactStudentCandidates.length)),
    allExactStudentCandidates: rows.filter(row => row.flags.exactStudentCandidate).length,
    conflictingSourceSubjects: [...sourceKeys.values()].filter(keys => keys.size > 1).length,
    unattachedBusinessRecords: Object.fromEntries([
      ['course_enrollments','enrollments'],['assessment_results','assessments'],['activity_registrations','registrations'],
      ['course_opportunities','opportunities'],['student_follow_ups','notes'],['lead_communications','contacts'],
    ].map(([table,collection]) => {
      const attached = new Set([...byKey.values()].flatMap(row => row[collection].map(item => item.id)));
      return [table,data[table].filter(row => !attached.has(row.id)).length];
    })),
    currentSubjectKeysUnique: new Set(rows.map(row => row.key)).size === rows.length,
  };
  if (summary.firstContactBuckets.reduce((sum, group) => sum + group.count, 0) !== first.length) throw new Error('AUDIT_PARTITION_MISMATCH');
  return { summary, rows };
}
