import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
export const HISTORY_ARCHIVE_SCHEMA_VERSION = 1;
export const normalizeArchiveSearch = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

function openReadOnly(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA query_only=ON');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version !== HISTORY_ARCHIVE_SCHEMA_VERSION) { db.close(); throw new Error('HISTORY_ARCHIVE_VERSION'); }
  return db;
}

export function buildHistoryArchiveDatabase(file, { packages, entities, matches, decisions, generatedAt = new Date().toISOString() }) {
  if (fs.existsSync(file)) throw new Error('HISTORY_ARCHIVE_ALREADY_EXISTS');
  const records = packages.flatMap(p => p.records);
  const matchMap = new Map(matches.map(m => [m.recordId, m]));
  const entityMap = new Map(entities.map(e => [e.key, e]));
  const recordIds = new Set(records.map(r => r.id));
  if (recordIds.size !== records.length || matchMap.size !== records.length || matches.length !== records.length) throw new Error('HISTORY_ARCHIVE_COVERAGE');
  const tableSources = new Map(packages.flatMap(p => p.tables.map(t => [t.id, p.source.id])));
  for (const r of records) {
    const m = matchMap.get(r.id);
    if (!m || !['matched','review','unmatched'].includes(m.status) ||
        (m.status === 'matched' ? !entityMap.has(m.entityKey) : m.entityKey !== null) ||
        !Array.isArray(m.candidateKeys) || m.candidateKeys.some(k => !entityMap.has(k)) ||
        (m.anchorRecordId !== null && !recordIds.has(m.anchorRecordId))) throw new Error('HISTORY_ARCHIVE_IDENTITY_REFERENCE');
    if (tableSources.get(r.tableId) !== r.sourceId) throw new Error('HISTORY_ARCHIVE_SOURCE_REFERENCE');
  }
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA user_version=1;
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE sources(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE source_tables(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), data TEXT NOT NULL);
      CREATE TABLE entities(key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE records(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), table_id TEXT NOT NULL REFERENCES source_tables(id),
        has_content INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('matched','review','unmatched')),
        entity_key TEXT REFERENCES entities(key), anchor_id TEXT, search_text TEXT NOT NULL, data TEXT NOT NULL, match_data TEXT NOT NULL);
      CREATE INDEX record_scope ON records(has_content,status,table_id,id);
      CREATE INDEX record_entity ON records(entity_key,id);
      CREATE INDEX record_anchor ON records(anchor_id,id);
      BEGIN IMMEDIATE;`);
    const sourceInsert = db.prepare('INSERT INTO sources VALUES(?,?)');
    const tableInsert = db.prepare('INSERT INTO source_tables VALUES(?,?,?)');
    for (const p of packages) {
      sourceInsert.run(p.source.id, JSON.stringify(p.source));
      for (const t of p.tables) tableInsert.run(t.id, p.source.id, JSON.stringify(t));
    }
    const entityInsert = db.prepare('INSERT INTO entities VALUES(?,?)');
    for (const e of entities) entityInsert.run(e.key, JSON.stringify(e));
    const insert = db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?)');
    for (const r of records) {
      const m = matchMap.get(r.id);
      if (!m || (m.status === 'matched' && !entityMap.has(m.entityKey)) || m.candidateKeys.some(k => !entityMap.has(k))) throw new Error('HISTORY_ARCHIVE_IDENTITY_REFERENCE');
      const entity = entityMap.get(m.entityKey);
      const candidateEntities = m.candidateKeys.map(key => entityMap.get(key)).filter(Boolean);
      const search = normalizeArchiveSearch([r.label, r.tableName, ...r.names, ...r.phones, ...r.cells.filter(c => c.kind !== 'system').map(c => c.text),
        entity?.name, ...(entity?.phones ?? []), ...candidateEntities.flatMap(candidate => [candidate.name, ...candidate.phones])].join('\n'));
      insert.run(r.id, r.sourceId, r.tableId, Number(r.hasContent), m.status, m.entityKey, m.anchorRecordId, search, JSON.stringify(r), JSON.stringify(m));
    }
    const countStatus = status => records.filter(r => r.hasContent && matchMap.get(r.id).status === status).length;
    const reviewRecords = records.filter(r => r.hasContent && matchMap.get(r.id).status === 'review');
    const summary = {
      available: true, generatedAt, sourceCount: packages.length, tableCount: packages.reduce((n,p) => n+p.tables.length,0), recordCount: records.length,
      contentRecordCount: records.filter(r => r.hasContent).length, matchedCount: countStatus('matched'), reviewCount: countStatus('review'), unmatchedCount: countStatus('unmatched'),
      singleCandidateReviewCount: reviewRecords.filter(r => matchMap.get(r.id).candidateKeys.length === 1).length,
      multipleCandidateReviewCount: reviewRecords.filter(r => matchMap.get(r.id).candidateKeys.length > 1).length,
      gradeCorrectionCount: entities.filter(e => e.gradeCorrection).length,
      excludedCommunicationCount: decisions.communicationDecision?.communicationIds?.length ?? 0,
      archivedClassCount: decisions.classDecision?.sourceRecords?.length ?? decisions.classDecision?.candidates?.length ?? decisions.classDecision?.records?.length ?? 0,
      tables: packages.flatMap(p => p.tables.map(t => ({id:t.id,name:t.name,sourceName:p.source.filename,records:records.filter(r => r.tableId === t.id && r.hasContent).length}))),
    };
    const metaInsert = db.prepare('INSERT INTO meta VALUES(?,?)');
    metaInsert.run('summary', JSON.stringify(summary));
    metaInsert.run('decisions', JSON.stringify(decisions));
    metaInsert.run('extraction_warnings', JSON.stringify(packages.map(p => ({sourceId:p.source.id,warnings:p.warnings}))));
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('HISTORY_ARCHIVE_FOREIGN_KEYS');
    db.exec('COMMIT');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('HISTORY_ARCHIVE_INTEGRITY');
    return summary;
  } finally { db.close(); }
}

function publicEntity(entity) {
  if (!entity) return null;
  // Development UUIDs are retained privately, never presented as production identities.
  return {key:entity.key,kind:entity.kind,name:entity.name,phones:entity.phones,grade:entity.grade,sourceKeys:entity.sourceKeys,gradeCorrection:entity.gradeCorrection};
}

function hydrate(db, stored) {
  const r = JSON.parse(stored.data), m = JSON.parse(stored.match_data);
  const source = JSON.parse(db.prepare('SELECT data FROM sources WHERE id=?').get(r.sourceId).data);
  const entityRow = m.entityKey ? db.prepare('SELECT data FROM entities WHERE key=?').get(m.entityKey) : null;
  const narrative = r.cells.filter(c => c.kind === 'narrative' && c.text.trim()).map(c => `${c.fieldName}：${c.text}`).join('\n');
  const context = r.cells.filter(c => c.kind !== 'system' && c.text.trim()).map(c => `${c.fieldName}：${c.text}`).join('\n');
  return {id:r.id,label:r.label,sourceName:source.filename,tableName:r.tableName,sourceRecordId:r.sourceRecordId,sourceRow:r.sourceRow,dateLabel:r.dateLabel,
    names:r.names,phones:r.phones,excerpt:(narrative || context).slice(0,260),matchStatus:m.status,matchReason:m.reason,
    entity:entityRow ? publicEntity(JSON.parse(entityRow.data)) : null,candidateCount:m.candidateKeys.length,warnings:r.warnings};
}

export function readHistoryArchivePage(file, filters = {}) {
  const db = openReadOnly(file);
  try {
    const summary = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='summary'").get().value);
    const where = ['has_content=1'], values = [];
    if (filters.status && filters.status !== 'all') {where.push('status=?');values.push(filters.status);}
    if (filters.table) {where.push('table_id=?');values.push(filters.table);}
    for (const token of normalizeArchiveSearch(filters.q).split(' ').filter(Boolean)) { where.push('instr(search_text,?)>0'); values.push(token); }
    const clause = where.join(' AND ');
    const total = db.prepare(`SELECT count(*) AS n FROM records WHERE ${clause}`).get(...values).n;
    const pageSize = Number.isSafeInteger(filters.pageSize) && filters.pageSize > 0 ? Math.min(filters.pageSize,100) : 25;
    const requestedPage = Number.isSafeInteger(filters.page) && filters.page > 0 ? filters.page : 1;
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const rows = db.prepare(`SELECT * FROM records WHERE ${clause} ORDER BY table_id,id LIMIT ? OFFSET ?`).all(...values,pageSize,(page-1)*pageSize).map(r => hydrate(db,r));
    return {summary, rows, total, page, pageSize};
  } finally {db.close();}
}

export function readHistoryArchiveDetail(file, id, relatedPage = 1) {
  const db = openReadOnly(file);
  try {
    const stored = db.prepare('SELECT * FROM records WHERE id=?').get(id);
    if (!stored) return null;
    const r = JSON.parse(stored.data), m = JSON.parse(stored.match_data);
    const candidates = m.candidateKeys.map(key => db.prepare('SELECT data FROM entities WHERE key=?').get(key)).filter(Boolean).map(row => publicEntity(JSON.parse(row.data)));
    // Only confirmed preview matches share a local entity. Pending candidates are not merged.
    const relatedTotal = m.status === 'matched' ? db.prepare('SELECT count(*) AS n FROM records WHERE has_content=1 AND status=? AND entity_key=? AND id<>?').get('matched',m.entityKey,id).n : 0;
    const size = 25;
    const requestedPage = Number.isSafeInteger(relatedPage) && relatedPage > 0 ? relatedPage : 1;
    const page = Math.min(requestedPage,Math.max(1,Math.ceil(relatedTotal/size)));
    const related = relatedTotal ? db.prepare('SELECT * FROM records WHERE has_content=1 AND status=? AND entity_key=? AND id<>? ORDER BY table_id,id LIMIT ? OFFSET ?').all('matched',m.entityKey,id,size,(page-1)*size).map(row => hydrate(db,row)) : [];
    const source = JSON.parse(db.prepare('SELECT data FROM sources WHERE id=?').get(r.sourceId).data);
    return {record:hydrate(db,stored),cells:r.cells,candidates,related,relatedTotal,relatedPage:page,relatedPageSize:size,sourceHash:source.sha256};
  } finally {db.close();}
}
