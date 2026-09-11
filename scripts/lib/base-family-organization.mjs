import { normalizeBaseGrade, normalizeBaseInputText } from './base-value-normalization.mjs';

const fieldName = cell => String(cell.fieldName ?? '').replace(/\s*\[[^\]]+\]$/u, '').trim();
const cellsOf = record => record.record_data?.cells ?? [];
function phonesOf(record) {
  return [...new Set(cellsOf(record).filter(cell => /电话|手机|联系方式/u.test(fieldName(cell))).flatMap(cell =>
    String(cell.text ?? '').normalize('NFKC').split(/[、,，;；/\n]+/u).map(phone => phone.replace(/\D/gu, '')).map(phone =>
      phone.length === 13 && phone.startsWith('86') ? phone.slice(2) : phone.length === 15 && phone.startsWith('0086') ? phone.slice(4) : phone)
      .filter(phone => /^\d{7,20}$/u.test(phone))))];
}
const gradeField = cell => /^年级|^春季年级$/u.test(fieldName(cell));

/** 只补读多孩子来源已经关联的线索凭据，避免把共用电话直接当作同一孩子。 */
export function baseChildEvidenceLeadIds(records) {
  return [...new Set(records.filter(record => record.source_data?.format === 'feishu-base' && record.lead_id
    && cellsOf(record).some(cell => gradeField(cell) && normalizeBaseGrade(normalizeBaseInputText(String(cell.text ?? ''))).value?.children?.length))
    .map(record => record.lead_id))];
}

export function loadBaseChildEvidence(sql, records) {
  const ids = baseChildEvidenceLeadIds(records);
  if (!ids.length) return [];
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  return sql(`begin read only;select to_jsonb(h) from public.history_import_records h where lead_id in (${ids.map(quote).join(',')})
    and source_data->>'format' is distinct from 'feishu-base' order by id;commit;`).split('\n').filter(Boolean).map(JSON.parse);
}

function evidenceIndex(records) {
  const index = new Map();
  for (const record of records) {
    if (!record.lead_id) continue;
    const cells = cellsOf(record);
    const names = [...new Set(cells.filter(cell => /^(?:学员|孩子)?姓名$/u.test(fieldName(cell))).map(cell => String(cell.text ?? '').trim()).filter(Boolean))];
    const grades = [...new Set(cells.filter(gradeField).map(cell => normalizeBaseGrade(String(cell.text ?? '')).value).filter(value => typeof value === 'number'))];
    if (names.length !== 1 || grades.length !== 1 || /[\n、,，]/u.test(names[0])) continue;
    if (!index.has(record.lead_id)) index.set(record.lead_id, []);
    index.get(record.lead_id).push({ sourceId: record.id, sourceHash: record.payload_sha256, name: names[0], grade: grades[0], phones: phonesOf(record), leadId: record.lead_id });
  }
  return index;
}

export function createBaseFamilyOrganizer(evidenceRecords = []) {
  const evidence = evidenceIndex(evidenceRecords);
  return (record, fields) => {
    const multi = fields.filter(field => field.kind === 'grade' && field.value?.children?.length);
    if (!multi.length) return fields;
    const names = fields.filter(field => field.section === 'identity' && field.key === 'name').map(field => field.display).filter(Boolean);
    const sourceLabel = [...new Set(names)].join('、');
    const phones = phonesOf(record);
    const note = cellsOf(record).filter(cell => /备注|信息|情况/u.test(fieldName(cell))).map(cell => String(cell.text ?? '')).join('\n');
    const relations = [...note.matchAll(/(姐姐|妹妹|哥哥|弟弟)\s*([一二三四五六七八九1-9])年级/gu)]
      .map(match => ({ role: match[1], grade: normalizeBaseGrade(match[2]).value }));
    const candidates = (evidence.get(record.lead_id) ?? []).filter(candidate => candidate.sourceId !== record.id
      && candidate.phones.some(phone => phones.includes(phone)) && names.includes(candidate.name));
    return fields.map(field => {
      if (field.section === 'identity' && field.key === 'name') return { ...field, key: 'family_source_label', label: '原线索称呼' };
      if (!multi.includes(field)) return field;
      const children = field.value.children.map(child => {
        const matches = candidates.filter(candidate => candidate.grade === child.grade);
        const matchedNames = [...new Set(matches.map(candidate => candidate.name))];
        const match = matchedNames.length === 1 ? matches[0] : null;
        const roles = [...new Set(relations.filter(relation => relation.grade === child.grade).map(relation => relation.role))];
        return { ...child, childKey: `${record.id}:${field.fieldId}:child:${child.index}`, name: match?.name ?? null,
          nameStatus: match ? 'source_confirmed' : 'information_pending', relation: roles.length === 1 ? roles[0] : null,
          ...(match ? { linkedLeadId: match.leadId, identityEvidence: { sourceId: match.sourceId, sourceHash: match.sourceHash } } : {}) };
      });
      return { ...field, label: '子女资料', value: { familyKey: `${record.id}:family`, sourceLabel, sharedPhones: phones, children, identityStatus: 'structured' }, review: [],
        display: children.map(child => `${child.name ?? `${child.relation ?? `孩子${child.index}`}（姓名：资料待补）`}：${child.gradeLabel}`).join('\n') };
    });
  };
}
