/** 保存最可能的资料归属；证据不足保留疑点，人工修订优先于推定结果。 */
export function inferStudentLearningLinks({ students, leads, records, associations, candidates, currentStudentIds }) {
  const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const phone = value => String(value ?? '').replace(/\D/g, '');
  const current = new Set(currentStudentIds), leadMap = new Map(leads.map(row => [row.id, row]));
  const linked = new Set(associations.map(row => row.record_id));
  const candidateMap = new Map();
  for (const row of candidates) {
    if (!candidateMap.has(row.record_id)) candidateMap.set(row.record_id, new Set());
    candidateMap.get(row.record_id).add(row.student_id);
  }
  const people = students.filter(row => !row.deleted_at).map(row => ({ ...row, normalized: normalize(row.name), phones: [phone(row.phone), phone(row.parent_phone)].filter(Boolean) }));
  return records.flatMap(record => {
    if (record.student_id || leadMap.get(record.lead_id)?.student_id || linked.has(record.id) || record.source_data?.format !== 'feishu-base') return [];
    const names = (record.record_data.names ?? []).map(normalize).filter(Boolean);
    const phones = (record.record_data.phones ?? []).map(phone).filter(Boolean);
    const exactNames = people.filter(person => names.includes(person.normalized));
    const ranked = people.flatMap(person => {
      const sameName = names.includes(person.normalized), samePhone = person.phones.some(value => phones.includes(value));
      if (!sameName && !samePhone) return [];
      const knownCandidate = candidateMap.get(record.id)?.has(person.id) ?? false;
      const reasons = [samePhone ? 'phone_match' : null, sameName ? 'name_match' : null,
        sameName && exactNames.length === 1 ? 'unique_student_name' : null, current.has(person.id) ? 'active_student' : null,
        knownCandidate ? 'existing_candidate' : null].filter(Boolean);
      return [{ studentId: person.id, score: Number(samePhone) * 100 + Number(sameName) * 40 + Number(current.has(person.id)) * 20 + Number(knownCandidate) * 10 + Number(sameName && exactNames.length === 1) * 10, reasons,
        doubts: [!samePhone ? 'phone_not_corroborated' : null, sameName && exactNames.length > 1 ? 'same_name_students' : null,
          sameName && phones.length && person.phones.length && !samePhone ? 'phone_difference' : null].filter(Boolean) }];
    }).sort((a, b) => b.score - a.score || a.studentId.localeCompare(b.studentId));
    if (!ranked.length) return [];
    const best = ranked[0];
    if (ranked[1]?.score === best.score) best.doubts.push('equal_score_candidates');
    return [{ recordId: record.id, studentId: best.studentId, reason: { method: 'evidence_rank_v1', evidence: best.reasons,
      doubts: best.doubts, candidateCount: ranked.length, score: best.score }, candidates: ranked.map(row => row.studentId) }];
  });
}
