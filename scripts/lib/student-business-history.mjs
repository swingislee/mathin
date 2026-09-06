import { historyPayloadHash } from './history-import-trial.mjs';

export const HISTORY_BUSINESS_TABLES = ['student_renewal_history', 'student_activity_history', 'student_assessment_history', 'student_enrollment_history', 'student_communication_history'];
export const historyFieldName = name => name.replace(/\s*\[[A-Z]+\]$/, '').trim();
const cellsOf = record => record.record_data.cells.filter(cell => cell.kind !== 'system');
const field = (record, name) => cellsOf(record).find(cell => historyFieldName(cell.fieldName) === name);
const value = (record, name) => field(record, name)?.text.trim() ?? '';
const ids = (record, names) => cellsOf(record).filter(cell => names.includes(historyFieldName(cell.fieldName))).map(cell => cell.fieldId);

export function historicalDate(text) {
  const match = text?.trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (!match) return null;
  const formatted = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const date = new Date(`${formatted}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === formatted ? formatted : null;
}

/** 逐个报课列形成独立报名；金额、日期和课表字段只取该期所在的列组。 */
export function historicalEnrollmentPeriods(record) {
  const cells = cellsOf(record);
  return cells.flatMap((cell, index) => {
    if (!/^报课\d*$/.test(historyFieldName(cell.fieldName)) || !cell.text.trim()) return [];
    const next = cells.findIndex((item, position) => position > index && /^报课\d*$/.test(historyFieldName(item.fieldName)));
    const group = cells.slice(index, next < 0 ? cells.length : next);
    const read = name => group.find(item => historyFieldName(item.fieldName) === name)?.text.trim() ?? '';
    const period = cell.text.trim();
    const scheduleStart = cells.findIndex(item => historyFieldName(item.fieldName) === '学期' && item.text.trim() === period);
    const scheduleEnd = cells.findIndex((item, position) => position > scheduleStart && historyFieldName(item.fieldName) === '学期');
    const schedule = scheduleStart < 0 ? [] : cells.slice(scheduleStart, scheduleEnd < 0 ? cells.length : scheduleEnd);
    const scheduleValue = name => schedule.find(item => historyFieldName(item.fieldName) === name)?.text.trim() ?? '';
    const amountOriginal = read('缴费金额');
    return [{
      slot: cell.fieldId, period_label: period, registered_on: historicalDate(read('报名日期')),
      amount: /^\d{1,12}(\.\d{1,2})?$/.test(amountOriginal) ? Number(amountOriginal) : null,
      amount_original: amountOriginal, class_label: scheduleValue('班型'), teacher_label: scheduleValue('老师'),
      room_label: scheduleValue('教室'), schedule_label: [scheduleValue('期别/周别'), scheduleValue('时段')].filter(Boolean).join(' · '),
      source_field_ids: [...new Set([cell.fieldId, ...group.filter(item => ['报名日期', '缴费金额'].includes(historyFieldName(item.fieldName))).map(item => item.fieldId),
        ...schedule.filter(item => ['学期','班型','老师','教室','期别/周别','时段'].includes(historyFieldName(item.fieldName))).map(item => item.fieldId)])],
    }];
  });
}

/** 首个业务转换配方：只接收已经确切关联到同一 Student 的来源记录。 */
export function buildStudentBusinessHistory(family) {
  const studentId = family.manifest?.subject?.studentId;
  if (!studentId || family.manifest.mode !== 'local_family_audit') throw new Error('HISTORY_BUSINESS_FAMILY_REQUIRED');
  const linked = family.records.filter(record => record.student_id === studentId && record.match_status === 'matched');
  const rows = Object.fromEntries(HISTORY_BUSINESS_TABLES.map(table => [table, []]));
  const add = (table, source, slot, fields, data) => {
    if (!fields.length) throw new Error('HISTORY_BUSINESS_FIELD_EVIDENCE_REQUIRED');
    const row = { id: `history:${historyPayloadHash([table, source.id, slot])}`, student_id: studentId,
      source_record_id: source.id, source_field_ids: [...new Set(fields)], ...data };
    row.payload_sha256 = historyPayloadHash(row);
    rows[table].push(row);
  };
  const renewals = linked.filter(record => /^\d{4}暑秋续报数据表$/.test(record.record_data.tableName));
  for (const source of renewals) {
    const content = value(source, '未报/连报情况');
    if (!content) continue;
    const noteIds = ids(source, ['未报/连报情况']);
    const clauses = content.split(/[，。！？\n]+/).map(text => text.trim()).filter(Boolean);
    for (const [period, pattern] of [['summer', /暑假|暑季|所有课都停/], ['autumn', /秋季|秋课/]]) {
      const note = clauses.filter(clause => pattern.test(clause)).join('，');
      if (!note) continue;
      add('student_renewal_history', source, period, [...noteIds, ...ids(source, ['春季班型','带课老师'])], {
        period_year: Number(source.record_data.tableName.slice(0, 4)), period_key: period,
        decision_note: note, outcome: 'unknown', class_label: value(source, '春季班型'), teacher_label: value(source, '带课老师'),
      });
    }
    add('student_communication_history', source, 'renewal', noteIds, {
      occurred_on: null, context_kind: 'renewal', content, author_label: null, date_basis: 'unknown',
    });
  }
  const activitySources = linked.filter(record => record.record_data.tableName === '袋鼠报名与备考信息表');
  for (const source of activitySources) {
    const resultCandidates = renewals.flatMap(record => value(record, '未报/连报情况').split(/[，。！？\n]+/)
      .flatMap(clause => { const hit = clause.trim().match(/^袋鼠竞赛(金奖|银奖|铜奖)$/); return hit ? [{ record, result: hit[1] }] : []; }));
    // 报名与沟通的届次尚未由原资料确认，先作为待核对的结果线索保存。
    const reported = activitySources.length === 1 && resultCandidates.length === 1 ? resultCandidates[0] : null;
    add('student_activity_history', source, 'kangaroo', ids(source, ['报名日期','真题领取','填写与否']), {
      activity_name: '袋鼠竞赛', activity_kind: 'competition', registered_on: historicalDate(value(source, '报名日期')),
      occurred_on: null, participation_status: value(source, '报名日期') ? 'registered' : 'unknown',
      reported_result: reported?.result ?? '', result_link_status: reported ? 'edition_unconfirmed' : 'none',
      result_source_record_id: reported?.record.id ?? null, result_field_ids: reported ? ids(reported.record, ['未报/连报情况']) : [],
    });
  }
  for (const source of linked.filter(record => record.record_data.tableName === '到访数据与信息表1.0-总')) {
    const learningNames = ['学员情况','学员情况2'];
    const parentNames = ['家长情况','家长情况2','家长理念'];
    const learning = [...new Set(learningNames.map(name => value(source, name)).filter(Boolean))].join('\n');
    const parents = [...new Set(parentNames.map(name => value(source, name)).filter(Boolean))].join('\n');
    if (value(source, '思维测评等级')) add('student_assessment_history', source, 'assessment', ids(source, ['到访日期','思维测评等级',...learningNames,...parentNames]), {
      assessed_on: historicalDate(value(source, '到访日期')), assessment_band: value(source, '思维测评等级'),
      score: null, learning_notes: learning, parent_notes: parents,
    });
    const notes = [...new Set([...learningNames,...parentNames].map(name => value(source, name)).filter(Boolean))].join('\n\n');
    if (notes) add('student_communication_history', source, 'assessment', ids(source, [...learningNames,...parentNames]), {
      occurred_on: null, context_kind: 'assessment', content: notes, author_label: null, date_basis: 'unknown',
    });
  }
  for (const source of linked.filter(record => record.record_data.tableName === '学员报名信息')) {
    for (const { slot, source_field_ids, ...data } of historicalEnrollmentPeriods(source)) add('student_enrollment_history', source, slot, source_field_ids, data);
  }
  const usedSources = [...new Set(Object.values(rows).flat().map(row => row.source_record_id))];
  const manifest = { schemaVersion: 1, mode: 'local_business_history', workScope: 'history_only',
    subject: structuredClone(family.manifest.subject), parentPayloadHash: family.payloadHash,
    counts: Object.fromEntries(Object.entries(rows).map(([table, records]) => [table, records.length])),
    sourceRecordIds: usedSources,
    retainedForReview: family.records.filter(record => !usedSources.includes(record.id)).map(record => ({ recordId: record.id, matchStatus: record.match_status })),
  };
  return structuredClone({ batchKey: `business-history-v1-${historyPayloadHash(studentId).slice(0, 16)}`, manifest, rows,
    payloadHash: historyPayloadHash({ manifest, rows }) });
}
