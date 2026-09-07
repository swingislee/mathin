import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CATALOG_BATCHES, HISTORY_CATALOG_VERSION, summarizeHistoryTable } from './lib/history-data-catalog.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
const workspace = process.cwd();
const archiveRoot = path.join(workspace, '.tmp/history-archive-rehearsal');
const outputRoot = path.join(workspace, '.tmp/history-data-catalog');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inside = (root, relative) => {
  const file = path.resolve(root, relative), rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('CATALOG_PATH');
  return file;
};
const pointer = readJson(path.join(archiveRoot, 'current.json'));
const manifest = readJson(inside(archiveRoot, pointer.manifest));
const database = inside(archiveRoot, pointer.database);
const databaseHash = sha256(database);
if (databaseHash !== manifest.databaseSha256) throw new Error('CATALOG_ARCHIVE_CHANGED');
const sourceRoot = path.join(workspace, 'docs/test_material');
const sourceFiles = fs.readdirSync(sourceRoot, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
  .map(entry => path.relative(sourceRoot, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort();
if (JSON.stringify(sourceFiles) !== JSON.stringify(manifest.sourceFiles.map(file => file.relative.replaceAll('\\', '/')).sort())) throw new Error('CATALOG_SOURCE_SET_CHANGED');
const files = manifest.sourceFiles.map((file, i) => {
  const currentHash = sha256(inside(sourceRoot, file.relative));
  if (currentHash !== file.sha256) throw new Error(`CATALOG_SOURCE_CHANGED:${file.relative}`);
  return { sourceCode: `F${String(i + 1).padStart(2, '0')}`, file: file.relative, bytes: file.bytes, sha256: currentHash, use: file.use };
});
const db = new DatabaseSync(database, { readOnly: true });
db.exec('PRAGMA query_only=ON');
let tables, snapshot, cases;
try {
  snapshot = readJsonValue('summary');
  const sources = new Map(db.prepare('SELECT id,data FROM sources').all().map(row => [row.id, JSON.parse(row.data)]));
  const entities = new Map(db.prepare('SELECT key,data FROM entities').all().map(row => [row.key, JSON.parse(row.data)]));
  const stored = db.prepare('SELECT data,match_data FROM records ORDER BY table_id,id').all();
  const records = stored.map(row => JSON.parse(row.data));
  const matches = new Map(stored.map(row => { const m = JSON.parse(row.match_data); return [m.recordId, m]; }));
  tables = db.prepare('SELECT data,source_id FROM source_tables ORDER BY source_id,id').all().map(row => {
    const table = JSON.parse(row.data), source = sources.get(row.source_id);
    return summarizeHistoryTable({ source, table, records: records.filter(r => r.tableId === table.id), matches, entities });
  }).sort((a, b) => a.batch.localeCompare(b.batch) || a.sourceName.localeCompare(b.sourceName, 'zh') || a.tableName.localeCompare(b.tableName, 'zh'));
  tables.forEach((t, i) => { t.code = `T${String(i + 1).padStart(2, '0')}`; t.fields.forEach(f => { f.tableCode = t.code; }); });
  const byTable = new Map(tables.map(t => [t.tableId, t]));
  const read = (r, name) => r.cells.find(c => c.fieldName.replace(/\s*\[[A-Z]+\]$/, '') === name)?.text?.trim() ?? '';
  const nonHeader = records.filter(r => r.hasContent && (r.sourceRow == null || r.sourceRow > byTable.get(r.tableId).headerRow));
  const chosen = [];
  const choose = (purpose, rule, predicate) => {
    const record = nonHeader.find(r => !chosen.some(c => c.recordId === r.id) && predicate(r));
    if (record) chosen.push({ code: `C${String(chosen.length + 1).padStart(2, '0')}`, purpose, rule, recordId: record.id, tableCode: byTable.get(record.tableId).code,
      sourceName: byTable.get(record.tableId).sourceName, tableName: record.tableName, position: record.sourceRow ? `第 ${record.sourceRow} 行` : record.sourceRecordId });
  };
  choose('续报有结果字段、没有备注', '核对最终字段与期别，覆盖旧配方会跳过的记录', r => byTable.get(r.tableId).kind === 'renewal' && read(r, '是否续报') && !read(r, '未报/连报情况'));
  choose('同一学生多期报名', '逐列组核对日期、金额、年份与授课安排', r => byTable.get(r.tableId).kind === 'enrollment' && r.cells.filter(c => /^报课\d*/.test(c.fieldName) && c.text.trim()).length >= 4 && matches.get(r.id)?.status === 'matched');
  choose('思维以外的测评', '学习力与英语测评分别承载，不合并为同一结果', r => byTable.get(r.tableId).kind === 'assessment' && read(r, '学习力测评等级') && read(r, '英语测评成绩（年级限定下）'));
  choose('仅有线索的历史沟通', '复用已有 Lead 身份，保持历史工作范围', r => byTable.get(r.tableId).kind === 'lead' && entities.get(matches.get(r.id)?.entityKey)?.kind === 'lead' && read(r, '沟通情况'));
  choose('同名多个归属候选', '查看候选家庭与原来源，决定归属后再关联', r => byTable.get(r.tableId).identityScope === 'person_row' && matches.get(r.id)?.candidateKeys?.length > 1);
  const phones = new Map();
  for (const r of nonHeader.filter(r => byTable.get(r.tableId).identityScope === 'person_row')) for (const phone of r.phones) {
    const names = phones.get(phone) ?? new Set(); r.names.forEach(name => names.add(name)); phones.set(phone, names);
  }
  choose('同电话出现多个姓名', '核对多孩、昵称或录入差异，保持学生身份独立', r => byTable.get(r.tableId).identityScope === 'person_row' && r.phones.some(phone => phones.get(phone)?.size > 1));
  choose('横向名单', '逐学生位置连同班级块核对', r => byTable.get(r.tableId).kind === 'roster' && r.cells.filter(c => c.text.trim()).length > 20);
  choose('退班与退款原记录', '核对原报名、退款记载与原因', r => byTable.get(r.tableId).kind === 'withdrawal' && read(r, '备注'));
  cases = chosen;
  function readJsonValue(key) { return JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key).value); }
} finally { db.close(); }
const sum = key => tables.reduce((n, t) => n + t.counts[key], 0);
if (sum('rawRows') !== snapshot.recordCount || sum('contentRows') !== snapshot.contentRecordCount || tables.length !== snapshot.tableCount) throw new Error('CATALOG_ARCHIVE_TOTALS');
if (sha256(database) !== databaseHash) throw new Error('CATALOG_ARCHIVE_MUTATED');
const batches = CATALOG_BATCHES.map(([code, title, scope, nextStep]) => ({ code, title, scope, nextStep, tableCount: tables.filter(t => t.batch === code).length,
  dataRows: tables.filter(t => t.batch === code).reduce((n, t) => n + t.counts.dataRows, 0) }));
const activity = tables.find(t => t.kind === 'activity');
const result = { schemaVersion: HISTORY_CATALOG_VERSION, generatedAt: new Date().toISOString(), identitySnapshotAt: snapshot.generatedAt,
  mode: 'read_only_catalog', businessWrites: 0, sourceFiles: files,
  implementationHashes: Object.fromEntries(['scripts/history-data-catalog.mjs', 'scripts/lib/history-data-catalog.mjs'].map(file => [file, textFileSha256(path.join(workspace, file))])),
  totals: { files: files.length, searchableFiles: files.filter(f => f.use === 'searchable_archive').length, tables: tables.length,
    rawRows: sum('rawRows'), contentRows: sum('contentRows'), headerRows: sum('headerRows'), dataRows: sum('dataRows'),
    fieldCount: tables.reduce((n, t) => n + t.fields.length, 0), populatedFields: tables.reduce((n, t) => n + t.fields.filter(f => f.filledCells > 0).length, 0),
    missingFormulaCells: sum('missingFormulaCells'), ignoredSnapshotMatches: sum('ignoredSnapshotMatches'), unclassifiedTables: tables.filter(t => !t.known).length },
  firstBatch: { kind: 'activity', tableCode: activity.code, sourceRows: activity.counts.dataRows, snapshotStudentMatches: activity.counts.matchedStudentRows,
    pendingIdentityRows: activity.counts.reviewRows + activity.counts.unmatchedRows, scope: '含已整理样本；数量为快照候选，正式计划刷新目标身份并扣除已存在记录',
    remaining: ['核对共用活动及届次', '补独立备考字段', '保留既有人工修订', '按目标库刷新身份并预览增量', '批量读取分页'] },
  batches, cases, tables };
fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, 'catalog.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ totals: result.totals, firstBatch: result.firstBatch, batches, cases: cases.length }));
