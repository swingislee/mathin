import { createHash } from 'node:crypto';
import { normalizeNewlines } from './text-hash.mjs';
import { normalizeArchiveSearch } from './history-archive-store.mjs';

export const HISTORY_TRIAL_BATCH_KEY = 'history-trial-20260906-v1';
export const historyPayloadHash = value => createHash('sha256').update(normalizeNewlines(JSON.stringify(value))).digest('hex');
const publicEntity = entity => entity ? {
  key: entity.key, kind: entity.kind, name: entity.name, phones: entity.phones, sourceKeys: entity.sourceKeys,
} : null;
const narrativeSize = record => record.cells.filter(cell => cell.kind === 'narrative').reduce((n, cell) => n + cell.text.length, 0);
const BUSINESS_TABLES = new Set([
  '到访数据与信息表1.0-总', '获客&私域信息登记表1.0-总', '2026暑秋续报数据表',
  '袋鼠报名与备考信息表', '（老数据）各选拔产品协作信息表-总',
]);

/** 按来源事实选取可阅读的小批样本，不把表格行数解释成人数或推断生命周期。 */
export function selectHistoryTrialCases(records, matches, entities) {
  const entityMap = new Map(entities.map(entity => [entity.key, entity]));
  const matchMap = new Map(matches.map(match => [match.recordId, match]));
  const eligible = records.filter(record => record.hasContent && record.sourceId.startsWith('feishu-base:') && BUSINESS_TABLES.has(record.tableName));
  const groups = new Map();
  for (const record of eligible) {
    const match = matchMap.get(record.id);
    if (match?.status !== 'matched' || !entityMap.has(match.entityKey)) continue;
    if (!groups.has(match.entityKey)) groups.set(match.entityKey, []);
    groups.get(match.entityKey).push(record);
  }
  const ranked = [...groups].map(([key, rows]) => ({ key, rows, entity: entityMap.get(key), size: rows.reduce((n, row) => n + narrativeSize(row), 0) }))
    .sort((a, b) => b.size - a.size || a.key.localeCompare(b.key));
  const selected = [];
  const renewal = ranked.find(group => group.entity.kind === 'student' && group.rows.some(row => row.tableName === '2026暑秋续报数据表') && group.size > 0);
  if (renewal) selected.push(renewal);
  for (const kind of ['student', 'lead']) {
    for (const group of ranked.filter(group => group.entity.kind === kind && group.size > 0)) {
      if (selected.filter(item => item.entity.kind === kind).length >= 3) break;
      if (!selected.includes(group)) selected.push(group);
    }
  }
  const cases = selected.map(group => ({
    key: group.key, label: group.entity.name, kind: 'matched', entityKind: group.entity.kind,
    phones: group.entity.phones, recordIds: group.rows.map(row => row.id).sort(),
  }));
  const pending = eligible.filter(record => record.names.length && narrativeSize(record) > 30)
    .sort((a, b) => narrativeSize(b) - narrativeSize(a) || a.id.localeCompare(b.id));
  const usedNames = new Set(cases.map(item => item.label));
  for (const category of ['single', 'multiple', 'unmatched', 'unmatched']) {
    const record = pending.find(row => {
      const match = matchMap.get(row.id);
      if (usedNames.has(row.names[0])) return false;
      if (category === 'unmatched') return match.status === 'unmatched' && row.phones.length;
      return match.status === 'review' && (category === 'single' ? match.candidateKeys.length === 1 : match.candidateKeys.length > 1);
    });
    if (!record) throw new Error(`HISTORY_TRIAL_SAMPLE_MISSING_${category}`);
    usedNames.add(record.names[0]);
    cases.push({ key: record.id, label: record.names[0], kind: matchMap.get(record.id).status, entityKind: null, phones: record.phones, recordIds: [record.id] });
  }
  if (cases.length !== 10) throw new Error('HISTORY_TRIAL_NEEDS_SIX_MATCHED_FOUR_PENDING');
  return cases;
}

export function buildHistoryTrialPayload({ records, matches, entities, sources, cases }) {
  const recordMap = new Map(records.map(record => [record.id, record]));
  const matchMap = new Map(matches.map(match => [match.recordId, match]));
  const entityMap = new Map(entities.map(entity => [entity.key, entity]));
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const selected = [];
  const seen = new Set();
  for (const item of cases) for (const id of item.recordIds) {
    if (seen.has(id)) throw new Error('HISTORY_TRIAL_DUPLICATE_CASE_RECORD');
    seen.add(id);
    const record = recordMap.get(id), match = matchMap.get(id), source = sourceMap.get(record?.sourceId);
    if (!record || !match || !source || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('HISTORY_TRIAL_SOURCE_REFERENCE');
    const entity = match.status === 'matched' ? entityMap.get(match.entityKey) : null;
    if (match.status === 'matched' && !entity?.localId) throw new Error('HISTORY_TRIAL_IDENTITY_REFERENCE');
    const candidates = match.candidateKeys.map(key => {
      if (!entityMap.has(key)) throw new Error('HISTORY_TRIAL_CANDIDATE_REFERENCE');
      return publicEntity(entityMap.get(key));
    });
    const row = {
      id, source_sha256: source.sha256, source_table_id: record.tableId, source_record_id: record.sourceRecordId,
      source_data: source, record_data: record, match_status: match.status, match_data: match,
      entity_data: publicEntity(entity), candidate_data: candidates,
      student_id: entity?.kind === 'student' ? entity.localId : null,
      lead_id: entity?.kind === 'lead' ? entity.localId : null,
      search_text: normalizeArchiveSearch([record.label, record.tableName, ...record.names, ...record.phones,
        ...record.cells.filter(cell => cell.kind !== 'system').map(cell => cell.text),
        entity?.name, ...(entity?.phones ?? []), ...candidates.flatMap(candidate => [candidate.name, ...candidate.phones])].join('\n')),
    };
    selected.push({ ...row, payload_sha256: historyPayloadHash(row), case_key: item.key });
  }
  selected.sort((a, b) => a.id.localeCompare(b.id));
  if (!selected.length || selected.length > 250) throw new Error('HISTORY_TRIAL_SAMPLE_LIMIT');
  const manifest = {
    schemaVersion: 1, mode: 'local_trial', workScope: 'history_only', cases,
    sourceCount: new Set(selected.map(row => row.source_sha256)).size,
    tableCount: new Set(selected.map(row => row.source_table_id)).size,
    recordCount: selected.length,
    linkedIdentities: cases.filter(item => item.kind === 'matched').length,
    reviewCases: cases.filter(item => item.kind === 'review').length,
    unmatchedCases: cases.filter(item => item.kind === 'unmatched').length,
  };
  return structuredClone({ batchKey: HISTORY_TRIAL_BATCH_KEY, manifest, records: selected, payloadHash: historyPayloadHash({ manifest, records: selected }) });
}

export function validateHistoryTrialTarget(attestation, { host, envOrigin, now = Date.now(), dockerEndpoint, systemIdentifier }) {
  const checkedAt = Date.parse(attestation?.checkedAt);
  if (host?.toLowerCase() !== attestation?.host?.toLowerCase() || host?.toLowerCase() !== 'whitehouse'
    || envOrigin !== 'http://127.0.0.1:35421' || attestation.supabaseOrigin !== envOrigin
    || dockerEndpoint !== 'npipe:////./pipe/dockerDesktopLinuxEngine'
    || systemIdentifier !== attestation.systemIdentifier
    || !/^[0-9]+$/.test(systemIdentifier ?? '')
    || !Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > 3_600_000
    || !attestation.listeners?.some(item => item.Address === '127.0.0.1' && item.Port === 35421 && item.Process === 'com.docker.backend')
    || !attestation.listeners?.some(item => item.Port === 3130 && item.Process === 'node')) throw new Error('HISTORY_TRIAL_LOCAL_PREFLIGHT_REQUIRED');
}
