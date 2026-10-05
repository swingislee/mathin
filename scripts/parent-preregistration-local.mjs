import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { fixedPreviewActors, previewIdentitySql } from './parent-assessment-fixtures-local.mjs';

const mode = process.argv[2];
if (!['--check','--apply'].includes(mode)) throw new Error('USE_CHECK_OR_APPLY');
const dir = '.tmp/parent-preregistration'; fs.mkdirSync(dir, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: `${dir}/target.json`, refresh: true, errorFile: `${dir}/database-error.txt` });
const testFile = 'supabase/tests/parent_preregistration.sql';
const versions = ['20261005190000_parent_preregistration','20261005191000_parent_registration_activity_schedule'].map(version => {
  const file=`supabase/migrations/${version}.sql`, checksum=textFileSha256(file);
  const recorded=sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
  if(recorded && recorded!==checksum)throw new Error('PREREGISTRATION_LEDGER_MISMATCH');
  return {version,checksum,file,recorded};
});
const pending=versions.filter(v=>!v.recorded);
const migration=pending.map(v=>fs.readFileSync(v.file,'utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,'')).join('\n');
const actors = fixedPreviewActors(fs.readFileSync('.claude/test-accounts.local.md','utf8'));
const hash = createHash('sha256').update(versions.map(v=>v.checksum).join(':')).update(textFileSha256(testFile)).update(JSON.stringify(actors)).digest('hex');
if (mode === '--check') {
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${migration}\n${previewIdentitySql(actors)}\n${fs.readFileSync(testFile,'utf8')}\nrollback;`);
  fs.writeFileSync(`${dir}/checked.json`,JSON.stringify({hash,database:observed.systemIdentifier,at:Date.now()}),'utf8');
  console.log(JSON.stringify({passed:true,transactionRolledBack:true,checks:['class-and-activity-publication','family-and-staff-scope','idempotency','no-formal-enrollment-or-roster-write','advisor-grade-boundary']}));
} else if (!pending.length) console.log(JSON.stringify({alreadyApplied:true}));
else {
  const receipt = JSON.parse(fs.readFileSync(`${dir}/checked.json`,'utf8'));
  if (receipt.hash !== hash || receipt.database !== observed.systemIdentifier || Date.now()-receipt.at>3600000) throw new Error('MATCHING_LOCAL_CHECK_REQUIRED');
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${migration}\n${pending.map(v=>`insert into public.schema_migrations(version,checksum) values('${v.version}','${v.checksum}');`).join('\n')}commit;`);
  console.log(JSON.stringify({applied:true,versions:pending.map(v=>v.version),target:observed.supabaseOrigin}));
}
