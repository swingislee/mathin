import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractFeishuBase } from './lib/history-archive-source.mjs';
import { buildHistoryIdentityIndex, matchHistoryRecords } from './lib/history-archive-identity.mjs';
import { buildHistoryArchiveDatabase, readHistoryArchivePage } from './lib/history-archive-store.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, part, i, all) => part.startsWith('--') ? [...pairs,[part.slice(2),all[i+1]]] : pairs, []));
for (const required of ['source','snapshot','decisions','python','attestation']) if (!args[required]) throw new Error(`Missing --${required}`);
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const attestation = read(args.attestation);
const root = path.join(repo,'.tmp/history-archive-rehearsal');
if (attestation.host?.toLowerCase() !== os.hostname().toLowerCase()
    || attestation.supabaseOrigin !== 'http://127.0.0.1:35421'
    || path.resolve(attestation.targetDirectory ?? '') !== root
    || !attestation.listeners?.some(l => l.Address === '127.0.0.1' && l.Port === 35421 && l.Process === 'com.docker.backend')
    || !attestation.listeners?.some(l => l.Port === 3130 && l.Process === 'node')
    || Date.now() - Date.parse(attestation.checkedAt) > 3_600_000
    || !Number.isFinite(Date.parse(attestation.checkedAt))) throw new Error('LOCAL_REHEARSAL_PREFLIGHT_REQUIRED');
const env = fs.readFileSync(path.join(repo,'.env.local'),'utf8');
const originMatch = env.match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\r\n"']+)/m);
if (!originMatch || new URL(originMatch[1].trim()).origin !== attestation.supabaseOrigin) throw new Error('LOCAL_REHEARSAL_ORIGIN_CHANGED');
const decisions = read(args.decisions);
if (decisions.classDecision?.status !== 'archive_only_exclude_classroom_creation') throw new Error('LATEST_ARCHIVE_ONLY_DECISION_REQUIRED');
const runName = 'run-' + new Date().toISOString().replace(/[^0-9TZ]/g,'');
const run = path.join(root,runName);
fs.mkdirSync(run,{recursive:true});
if (fs.existsSync(path.join(run,'manifest.json'))) throw new Error('RUN_ALREADY_EXISTS');

const sourceRoot = path.resolve(args.source);
const sourceFiles = [];
function copySources(dir) {
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const original = path.join(dir,entry.name);
    if (entry.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_UNSUPPORTED');
    if (entry.isDirectory()) {copySources(original);continue;}
    if (!entry.isFile() || !/\.(base|xlsx|xls|png)$/i.test(entry.name)) continue;
    const relative = path.relative(sourceRoot,original);
    const destination = path.join(run,'sources',relative);
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.copyFileSync(original,destination,fs.constants.COPYFILE_EXCL);
    const checksum = sha(original);
    if (checksum !== sha(destination)) throw new Error('SOURCE_COPY_CHANGED');
    sourceFiles.push({relative:relative.replaceAll('\\','/'),sha256:checksum,bytes:fs.statSync(destination).size,
      use: /\.(base|xlsx)$/i.test(entry.name) ? 'searchable_archive' : /\.xls$/i.test(entry.name) ? 'preserved_duplicate_export' : 'preserved_image'});
  }
}
copySources(sourceRoot);
fs.copyFileSync(args.decisions,path.join(run,'decisions.json'),fs.constants.COPYFILE_EXCL);
fs.copyFileSync(args.attestation,path.join(run,'attestation.json'),fs.constants.COPYFILE_EXCL);
const excelOutput = path.join(run,'excel-extraction.json');
execFileSync(args.python,[path.join(repo,'scripts/history-archive-excel.py'),'--source',path.join(run,'sources'),'--output',excelOutput],{stdio:['ignore','pipe','pipe'],windowsHide:true});
const packages = read(excelOutput);
for (const source of sourceFiles.filter(s => /\.base$/i.test(s.relative))) packages.push(await extractFeishuBase(path.join(run,'sources',source.relative)));
const tables = Object.fromEntries(read(args.snapshot).map(t => [t.table,t.rows]));
const identities = buildHistoryIdentityIndex({tables,decisions});
const records = packages.flatMap(p => p.records);
const matches = matchHistoryRecords(records,identities);
const database = path.join(run,'archive.sqlite');
const summary = buildHistoryArchiveDatabase(database,{packages,entities:identities.entities,matches,decisions});
const page = readHistoryArchivePage(database,{q:'',status:'all',table:'',page:1,pageSize:25});
if (page.total !== summary.contentRecordCount || summary.matchedCount + summary.reviewCount + summary.unmatchedCount !== page.total) throw new Error('ARCHIVE_RECONCILIATION');
const sourcePackages = packages.map(p => ({source:p.source,tables:p.tables,warnings:p.warnings}));
const manifest = {schemaVersion:1,generatedAt:summary.generatedAt,runName,database:'archive.sqlite',databaseSha256:sha(database),sourceFiles,sourcePackages,
  snapshotHash:textFileSha256(args.snapshot),decisionsHash:textFileSha256(args.decisions),identityDiagnostics:identities.diagnostics,
  implementationHashes: Object.fromEntries(['scripts/history-archive-rehearsal.mjs','scripts/history-archive-excel.py','scripts/lib/history-archive-source.mjs','scripts/lib/history-archive-identity.mjs','scripts/lib/history-archive-store.mjs'].map(file => [file,textFileSha256(path.join(repo,file))])),
  entityCounts:{students:identities.entities.filter(e=>e.kind==='student').length,leads:identities.entities.filter(e=>e.kind==='lead').length},
  summary,mode:'local_archive_rehearsal',businessDatabaseWrites:false,gradeCorrections:'preview_only',classroomCreation:false};
fs.writeFileSync(path.join(run,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(run,'matches.json'),JSON.stringify(matches,null,2)+'\n');
fs.writeFileSync(path.join(run,'entities.json'),JSON.stringify(identities.entities,null,2)+'\n');
const pointer = path.join(root,'current.json');
const nextPointer = pointer + '.next';
fs.writeFileSync(nextPointer,JSON.stringify({schemaVersion:1,database:runName+'/archive.sqlite',manifest:runName+'/manifest.json'})+'\n');
fs.renameSync(nextPointer,pointer);
console.log(JSON.stringify({runName,...Object.fromEntries(Object.entries(summary).filter(([key])=>key!=='tables')),entities:manifest.entityCounts,businessDatabaseWrites:false}));
