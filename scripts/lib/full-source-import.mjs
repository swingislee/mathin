import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractFeishuBase } from './history-archive-source.mjs';
import { buildHistoryIdentityIndex, matchHistoryRecords } from './history-archive-identity.mjs';
import { buildHistoryTrialPayload, historyPayloadHash } from './history-import-trial.mjs';

export const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** 同时验证当前资料与冻结副本；Excel 提取复用已校验的同一份字节。 */
export async function readCompleteSources(snapshotRoot, currentRoot) {
  const manifest = json(path.join(snapshotRoot, 'manifest.json'));
  const excel = json(path.join(snapshotRoot, 'excel-extraction.json'));
  const files = [], packages = [];
  const current = [];
  function list(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('FULL_SOURCE_SYMLINK');
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) list(file);
      else if (/\.(base|xlsx)$/iu.test(entry.name)) current.push(path.relative(currentRoot, file).replaceAll('\\', '/'));
    }
  }
  list(currentRoot);
  if (JSON.stringify(current.sort()) !== JSON.stringify(manifest.sourceFiles.map(file => file.path).sort())) throw new Error('FULL_SOURCE_FILE_SET_CHANGED');
  for (const file of manifest.sourceFiles) {
    const relative = file.path;
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) throw new Error('FULL_SOURCE_PATH');
    const sourcePath = path.join(snapshotRoot, 'sources', relative);
    const bytes = fs.readFileSync(sourcePath);
    if (bytes.length !== file.bytes || bytesHash(bytes) !== file.sha256 || bytesHash(fs.readFileSync(path.join(currentRoot, relative))) !== file.sha256) throw new Error('FULL_SOURCE_BYTES_CHANGED');
    let extracted;
    if (/\.base$/iu.test(relative)) extracted = await extractFeishuBase(sourcePath);
    else {
      const candidates = excel.filter(item => item.source.sha256 === file.sha256);
      extracted = candidates.find(item => item.source.filename === relative || item.source.filename === path.basename(relative)) ?? (candidates.length === 1 ? candidates[0] : null);
      if (!extracted) throw new Error('FULL_SOURCE_EXTRACTION_MISSING');
    }
    const sourceId = `archive-source:${historyPayloadHash([relative, file.sha256])}`;
    const source = { ...extracted.source, id: sourceId, filename: relative, sha256: file.sha256, logicalSourceId: extracted.source.id };
    const records = extracted.records.map(record => ({ ...record,
      id: `source-record:${historyPayloadHash([sourceId, record.id])}`, sourceId,
    }));
    packages.push({ ...extracted, source, records });
    files.push({ path: relative, sha256: file.sha256, bytes: bytes.length, contentBase64: bytes.toString('base64'),
      metadata: { source, tables: extracted.tables, warnings: extracted.warnings } });
  }
  return { files, packages, sourceAt: manifest.at };
}

/** 不完整的归属也是可保存的数据；完整入库不以身份确认完成为前置条件。 */
export function buildCompleteSourcePayload({ files, packages, tables, sourceAt }) {
  const identities = buildHistoryIdentityIndex({ tables });
  const records = packages.flatMap(item => item.records);
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('FULL_SOURCE_DUPLICATE_RECORD');
  const staffRecords = new Set(packages.filter(item => /(?:^|\/)员工管理\.xlsx$/u.test(item.source.filename)).flatMap(item => item.records.map(record => record.id)));
  const matches = matchHistoryRecords(records, identities).map(match => staffRecords.has(match.recordId)
    ? { ...match, status:'unmatched', entityKey:null, candidateKeys:[], reason:'non_student_source', anchorRecordId:null }
    : match);
  const matchMap = new Map(matches.map(match => [match.recordId, match]));
  const sources = packages.map(item => item.source);
  const imported = [];
  for (let offset = 0; offset < records.length; offset += 250) {
    const chunk = records.slice(offset, offset + 250);
    const payload = buildHistoryTrialPayload({ records: chunk, matches: chunk.map(record => matchMap.get(record.id)),
      entities: identities.entities, sources, cases: [{ key: 'complete_source', recordIds: chunk.map(record => record.id) }] });
    imported.push(...payload.records);
  }
  const summary = {
    available: true, generatedAt: sourceAt, sourceCount: files.length,
    tableCount: packages.reduce((count, item) => count + item.tables.length, 0), recordCount: records.length,
    contentRecordCount: records.filter(record => record.hasContent).length,
    matchedCount: 0, reviewCount: 0, unmatchedCount: 0, singleCandidateReviewCount: 0, multipleCandidateReviewCount: 0,
    unmatchedWithIdentityCount: 0, unmatchedWithoutIdentityCount: 0, gradeCorrectionCount: 0, excludedCommunicationCount: 0, archivedClassCount: 0,
    tables: packages.flatMap(item => item.tables.map(table => ({ id: `${item.source.id}:${table.id}`, name: table.name,
      sourceName: item.source.filename, records: table.contentRowCount }))),
  };
  for (const row of imported) {
    if (!row.record_data.hasContent) continue;
    summary[`${row.match_status}Count`]++;
    if (row.match_status === 'review') {
      if (row.candidate_data.length === 1) summary.singleCandidateReviewCount++;
      else if (row.candidate_data.length > 1) summary.multipleCandidateReviewCount++;
    }
    if (row.match_status === 'unmatched') summary[row.record_data.names.length || row.record_data.phones.length ? 'unmatchedWithIdentityCount' : 'unmatchedWithoutIdentityCount']++;
  }
  const rows = imported.map(row => {
    // 文件版本、表和记录三者共同标识原文，旧批次继续保留。
    const value = { ...row, source_table_id: `${row.source_data.id}:${row.source_table_id}` };
    delete value.payload_sha256;
    return { ...value, payload_sha256: historyPayloadHash(value) };
  });
  const manifest = { schemaVersion: 1, mode: 'complete_source_import', workScope: 'history_only', sourceAt, summary,
    sourceCount: files.length, tableCount: summary.tableCount, recordCount: rows.length,
    sourceBytes: files.reduce((count, file) => count + file.bytes, 0),
    deferredAssociation: true, identityDiagnostics: identities.diagnostics };
  const payloadHash = historyPayloadHash({ manifest, files: files.map(file => ({path:file.path,sha256:file.sha256,bytes:file.bytes,metadata:file.metadata})), records: rows });
  return { batchKey: `complete-source-${payloadHash.slice(0, 32)}`, payloadHash, manifest, files, records: rows,
    identities: identities.entities };
}
