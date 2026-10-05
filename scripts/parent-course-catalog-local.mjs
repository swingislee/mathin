import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { fixedPreviewActors, previewIdentitySql } from './parent-assessment-fixtures-local.mjs';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw new Error('USE_CHECK_OR_APPLY');
fs.mkdirSync('.tmp/parent-course-catalog', { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: '.tmp/parent-course-catalog/target.json', refresh: true, errorFile: '.tmp/parent-course-catalog/database-error.txt' });
const version = '20261005000600_parent_course_catalog';
const file = `supabase/migrations/${version}.sql`;
const checksum = textFileSha256(file);
const recorded = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (recorded && recorded !== checksum) throw new Error('COURSE_CATALOG_LEDGER_MISMATCH');
const migration = recorded ? '' : fs.readFileSync(file, 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '');
const testFile = 'supabase/tests/parent_course_catalog.sql';
const actors = fixedPreviewActors(fs.readFileSync('.claude/test-accounts.local.md', 'utf8'));
const hash = createHash('sha256').update(checksum).update(textFileSha256(testFile)).update(JSON.stringify(actors)).digest('hex');
const receipt = '.tmp/parent-course-catalog/checked.json';
if (mode === '--check') {
  const tables = ['students','student_guardians','classrooms','enrollments','course_enrollments','course_enrollment_assignments','course_opportunities','course_enrollment_events','course_opportunity_events','domain_events'];
  const snapshot = () => sql(`begin read only;select md5(string_agg(name||':'||digest,'|' order by name)) from (${tables.map(t => `select '${t}' name,md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' order by md5(to_jsonb(x)::text)),'')) digest from public.${t} x`).join(' union all ')}) s;commit;`);
  const before = snapshot();
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${migration}\n${previewIdentitySql(actors)}\n${fs.readFileSync(testFile, 'utf8')}\nrollback;`);
  if (snapshot() !== before) throw new Error('COURSE_CATALOG_ROLLBACK_CHANGED_DATA');
  fs.writeFileSync(receipt, JSON.stringify({ hash, database: observed.systemIdentifier, at: Date.now() }), 'utf8');
  console.log(JSON.stringify({ passed: true, transactionRolledBack: true, checks: ['publication', 'family-scope', 'staff-permissions', 'idempotency', 'quote-revision', 'capacity', 'formal-enrollment-and-placement', 'atomic-confirmation'] }));
} else if (recorded) console.log(JSON.stringify({ alreadyApplied: true }));
else {
  const check = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  if (check.hash !== hash || check.database !== observed.systemIdentifier || Date.now() - check.at > 3600000) throw new Error('MATCHING_LOCAL_COURSE_CHECK_REQUIRED');
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${migration}\ninsert into public.schema_migrations(version,checksum) values('${version}','${checksum}');commit;`);
  console.log(JSON.stringify({ applied: true, version, target: observed.supabaseOrigin, businessRowsWritten: 0 }));
}
