import { describe, expect, it } from 'vitest';
import { buildHistoryTrialPayload, historyPayloadHash, validateHistoryTrialTarget } from '../scripts/lib/history-import-trial.mjs';

const now = Date.parse('2026-09-06T08:00:00Z');
const target = { host: 'WHITEHOUSE', envOrigin: 'http://127.0.0.1:35421', now, dockerEndpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine', systemIdentifier: '123456' };
const attestation = { host: 'WHITEHOUSE', checkedAt: '2026-09-06T07:59:00Z', supabaseOrigin: target.envOrigin, systemIdentifier: '123456',
  listeners: [{ Address: '127.0.0.1', Port: 35421, Process: 'com.docker.backend' }, { Port: 3130, Process: 'node' }] };

describe('actual history import local boundary', () => {
  it('requires the verified local host, API origin, Docker endpoint, fingerprint and listeners', () => {
    expect(() => validateHistoryTrialTarget(attestation, target)).not.toThrow();
    for (const change of [{ host: 'xiaomi' }, { envOrigin: 'https://supabase.mathin.club' }, { dockerEndpoint: 'ssh://xiaomi' }, { systemIdentifier: 'different' }]) {
      expect(() => validateHistoryTrialTarget(attestation, { ...target, ...change })).toThrow('LOCAL_PREFLIGHT');
    }
    expect(() => validateHistoryTrialTarget({ ...attestation, listeners: [] }, target)).toThrow('LOCAL_PREFLIGHT');
    expect(() => validateHistoryTrialTarget({ ...attestation, systemIdentifier: 'different' }, target)).toThrow('LOCAL_PREFLIGHT');
  });
  it('rejects stale, invalid and future attestations', () => {
    for (const checkedAt of ['invalid', '2026-09-06T06:00:00Z', '2026-09-06T08:01:00Z']) {
      expect(() => validateHistoryTrialTarget({ ...attestation, checkedAt }, target)).toThrow('LOCAL_PREFLIGHT');
    }
  });
});

function fixture() {
  const entity = { key: 'history:student:one', kind: 'student', localId: 'local-student', name: '示例孩子', phones: ['13800000000'], sourceKeys: ['mofaxiao:id:1'] };
  const record = { id: 'record-one', sourceId: 'source-one', tableId: 'table-one', sourceRecordId: 'original-one', label: '示例孩子', tableName: '来源表', names: ['示例孩子'], phones: ['13800000000'], dateLabel: null,
    cells: [{ fieldId: 'notes', fieldName: '历史沟通', kind: 'narrative', text: '原文第一行\n没有准确日期，也保留全部内容。', rawValue: { text: '原文第一行\n没有准确日期，也保留全部内容。', unknown: true } }] };
  return { records: [record], entities: [entity], sources: [{ id: 'source-one', filename: 'synthetic.base', sha256: 'a'.repeat(64) }],
    matches: [{ recordId: record.id, status: 'matched', entityKey: entity.key, candidateKeys: [entity.key], reason: 'name_and_phone' }],
    cases: [{ key: entity.key, label: entity.name, kind: 'matched', entityKind: 'student', phones: entity.phones, recordIds: [record.id] }] };
}

describe('immutable historical payload', () => {
  it('retains original values and unknown dates without manufacturing communications or current tasks', () => {
    const input = fixture();
    const result = buildHistoryTrialPayload(input);
    expect(result.records[0].record_data).toEqual(input.records[0]);
    expect(result.records[0].record_data.dateLabel).toBeNull();
    expect(result.records[0]).toMatchObject({ student_id: 'local-student', lead_id: null });
    expect(result.manifest.workScope).toBe('history_only');
    expect(result.records[0]).not.toHaveProperty('next_action');
    expect(result.records[0]).not.toHaveProperty('occurred_at');
  });
  it('keeps ambiguous candidates unlinked, including a phone shared by different children', () => {
    const input = fixture();
    input.entities.push({ ...input.entities[0], key: 'history:student:sibling', localId: 'sibling', name: '示例妹妹' });
    input.matches[0] = { ...input.matches[0], status: 'review', entityKey: '', candidateKeys: input.entities.map(entity => entity.key) };
    const row = buildHistoryTrialPayload(input).records[0];
    expect(row.student_id).toBeNull();
    expect(row.lead_id).toBeNull();
    expect(row.entity_data).toBeNull();
    expect(row.candidate_data).toHaveLength(2);
  });
  it('rejects missing sources, unresolved identity references and duplicate case membership', () => {
    const input = fixture();
    expect(() => buildHistoryTrialPayload({ ...input, sources: [] })).toThrow('SOURCE_REFERENCE');
    expect(() => buildHistoryTrialPayload({ ...input, entities: [] })).toThrow('IDENTITY_REFERENCE');
    expect(() => buildHistoryTrialPayload({ ...input, cases: [...input.cases, ...input.cases] })).toThrow('DUPLICATE_CASE_RECORD');
  });
  it('replays identically and changes the fingerprint when a source value changes', () => {
    const input = fixture();
    const first = buildHistoryTrialPayload(input);
    expect(buildHistoryTrialPayload(fixture()).payloadHash).toBe(first.payloadHash);
    input.records[0].cells[0].text = '已修订的来源文本';
    expect(buildHistoryTrialPayload(input).payloadHash).not.toBe(first.payloadHash);
    expect(first.payloadHash).toBe(historyPayloadHash({ manifest: first.manifest, records: first.records }));
  });
});
