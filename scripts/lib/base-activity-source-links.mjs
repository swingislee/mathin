import { normalizeBaseGrade, normalizeBaseInputText } from './base-value-normalization.mjs';
import { historyPayloadHash } from './history-import-trial.mjs';

const normalized = value => normalizeBaseInputText(String(value ?? '')).normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const cellsOf = record => record.record_data?.cells ?? [];
const valuesOf = (record, names) => cellsOf(record).filter(cell => names.includes(cell.fieldName)).map(cell => String(cell.text ?? '').trim()).filter(Boolean);
const phonesOf = record => valuesOf(record, ['手机号', '家长电话', '电话', '联系电话']).flatMap(value => value.split(/[、,，;；/\n]+/u)).map(normalizedPhone);
const normalizedPhone = value => String(value ?? '').replace(/\D/gu, '').replace(/^(?:0086|86)(?=1\d{10}$)/u, '');
const dateOf = record => valuesOf(record, ['到访日期'])[0]?.replaceAll('/', '-');
const timeOf = value => normalizeBaseInputText(String(value ?? '')).normalize('NFKC').replace(/^(\d):/u, '0$1:');
const gradeOf = value => normalizeBaseGrade(normalizeBaseInputText(String(value ?? ''))).value;
const sourceNames = record => [...new Set([...(record.record_data?.names ?? []), ...valuesOf(record, ['学员姓名', '学生姓名', '姓名'])].map(normalized).filter(Boolean))];

/** 将完整的逐人安排拆成来源片段，保留所在字段、原始行和行号。 */
export function parseBaseActivityEntries(source) {
  const groups = cellsOf(source).flatMap(cell => {
    if (cell.kind === 'system' || typeof cell.text !== 'string') return [];
    const rows = cell.text.split(/\r?\n/u).map((originalText, index) => ({ originalText, line: index + 1 })).filter(row => row.originalText.trim());
    if (rows.length < 2) return [];
    const entries = rows.map(row => {
      const text = normalizeBaseInputText(row.originalText).normalize('NFKC').replace(/^\d+[.、．]\s*/u, '');
      const match = text.match(/^(.+?)\s*(大升一|[一二三四五六七八九\d]+升[一二三四五六七八九\d]+|[一二三四五六七八九\d]+年级)\s*(.*?)周([一二三四五六日天])\s*(\d{1,2}:\d{2})\s*(.*)$/u);
      if (!match || !/^[\p{L}·]{2,20}$/u.test(match[1].trim())) return null;
      const grade = gradeOf(match[2]);
      if (typeof grade !== 'number') return null;
      const time = timeOf(match[5]);
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)) return null;
      return { fieldId: cell.fieldId, fieldName: cell.fieldName, line: row.line, originalText: row.originalText,
        name: match[1].trim(), gradeText: match[2], grade, previousGrade: match[2].includes('升') ? gradeOf(match[2].split('升')[0]) : null,
        activity: [match[3], match[6]].filter(Boolean).join(' ').trim(), weekday: match[4], time };
    });
    return entries.every(Boolean) ? [{ entries }] : [];
  });
  if (groups.length !== 1) throw new Error('ONE_COMPLETE_ACTIVITY_LIST_REQUIRED');
  return groups[0].entries;
}

function sourceScore(source, parent, entry, targetGrade) {
  const reasons = ['same_name'];
  let score = 100;
  const add = (condition, points, reason) => { if (condition) { score += points; reasons.push(reason); } };
  const recordGrade = valuesOf(source, ['年级/25级', '年级', '年级/26级']).map(gradeOf).find(value => typeof value === 'number') ?? targetGrade;
  const compatible = typeof recordGrade === 'number' && (recordGrade === entry.grade || recordGrade === entry.previousGrade);
  add(compatible, 15, 'compatible_grade');
  if (typeof recordGrade === 'number' && !compatible) { score -= 20; reasons.push('different_grade'); }
  add(Boolean(dateOf(parent)) && dateOf(source) === dateOf(parent), 80, 'same_visit_date');
  add(valuesOf(source, ['到访时段']).map(timeOf).includes(entry.time), 40, 'same_visit_time');
  const parentStaff = valuesOf(parent, ['学服老师']);
  add(valuesOf(source, ['学服老师']).some(value => parentStaff.includes(value)), 15, 'same_staff');
  add(source.id === parent.id, 30, 'original_named_record');
  return { score, reasons, sourceId: source.id, sourceHash: source.payload_sha256 };
}

/** 每个候选使用一条独立个人来源评分，重复快照不会累加权重。 */
export function buildBaseActivitySourceLinks(source, leads, students, records) {
  const entries = parseBaseActivityEntries(source);
  const targets = [
    ...leads.filter(lead => !lead.student_id).map(lead => ({ id: lead.id, type: 'lead', name: lead.provisional_student_name,
      grade: lead.grade_hint ?? gradeOf(lead.grade_text), phone: normalizedPhone(lead.phone), sourceId: lead.source_record_id })),
    ...students.filter(student => !student.deleted_at).map(student => ({ id: student.id, type: 'student', name: student.name,
      grade: student.grade, phone: normalizedPhone(student.parent_phone || student.phone), sourceId: null })),
  ];
  const links = entries.map(entry => {
    const candidates = targets.filter(target => normalized(target.name) === normalized(entry.name)).map(target => {
      const evidence = records.filter(record => sourceNames(record).length === 1 && sourceNames(record)[0] === normalized(entry.name)
        && (record.id === target.sourceId || (target.type === 'lead' ? record.lead_id === target.id : record.student_id === target.id)
          || Boolean(target.phone) && phonesOf(record).includes(target.phone)))
        .map(record => sourceScore(record, source, entry, target.grade)).sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId));
      const best = evidence[0] ?? { score: 100, reasons: ['same_name'], sourceId: null, sourceHash: null };
      return { target, ...best };
    }).sort((a, b) => b.score - a.score || a.target.id.localeCompare(b.target.id));
    if (!candidates.length) throw new Error(`ACTIVITY_TARGET_REQUIRED:${entry.line}`);
    const best = candidates[0];
    const id = `source-fragment:${historyPayloadHash([source.id, entry.fieldId, entry.line])}`;
    const display = `${entry.name} · ${entry.grade}年级 · ${entry.activity || '活动内容：资料待补'} · 周${entry.weekday} ${entry.time}`;
    return { id, source_record_id: source.id, source_payload_sha256: source.payload_sha256, source_field_id: entry.fieldId,
      entry_index: entry.line, original_text: entry.originalText, student_id: best.target.type === 'student' ? best.target.id : null,
      lead_id: best.target.type === 'lead' ? best.target.id : null, match_state: 'inferred', event_date: dateOf(source) ?? null,
      match_reason: { method: 'activity_evidence_rank_v1', entry, score: best.score, reasons: best.reasons,
        evidenceSourceId: best.sourceId, evidenceSourceHash: best.sourceHash, tied: candidates.length > 1 && candidates[1].score === best.score,
        candidates: candidates.map(candidate => ({ type: candidate.target.type, id: candidate.target.id, score: candidate.score,
          reasons: candidate.reasons, sourceId: candidate.sourceId, sourceHash: candidate.sourceHash })) },
      business_fields: [{ fieldId: `${entry.fieldId}:entry:${entry.line}`, name: entry.fieldName, label: '活动安排', section: 'notes', key: 'activity_arrangements',
        kind: 'text', value: { name: entry.name, grade: entry.grade, activity: entry.activity || null, weekday: entry.weekday, time: entry.time }, display,
        originalText: entry.originalText, sourceType: 'Text', status: 'text', rawHasContent: true }] };
  });
  return { sourceId: source.id, sourceHash: source.payload_sha256, links,
    summary: { arrangements: entries.length, inferredLinks: links.length, uniqueTargets: new Set(links.map(link => link.student_id ?? link.lead_id)).size,
      ambiguousTopRanks: links.filter(link => link.match_reason.tied).length } };
}
