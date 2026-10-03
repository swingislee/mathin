import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { mergeGeneratedDatabaseTypes } from './lib/scoped-database-types.mjs';
import { DIGEST_PREFIX, migrationsDigest } from './lib/migrations-digest.mjs';

const mode = process.argv[2] ?? 'preflight';
if (!['preflight', 'check', 'apply', 'types'].includes(mode)) throw new Error('INVALID_MODE');
const privateDir = path.resolve('.tmp/class-material');
fs.mkdirSync(privateDir, { recursive: true });
const target = openHistoryLocalTarget({
  attestationPath: path.join(privateDir, 'target.json'), refresh: true,
  errorFile: path.join(privateDir, 'database-error.log'),
});
console.log(JSON.stringify({ mode, ...target.observed }));
if (mode !== 'preflight') {
  const migration = fs.readFileSync('supabase/migrations/20261003010000_class_material_rules.sql', 'utf8');
  const assertions = fs.readFileSync('scripts/sql/class-material-assertions.sql', 'utf8');
  const checksum = createHash('sha256').update(migration).update(assertions).digest('hex');
  const receipt = path.join(privateDir, 'checked.json');
  const body = migration.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
  const version = '20261003010000_class_material_rules';
  const recorded = target.sql("begin read only; select checksum from public.schema_migrations where version='" + version + "'; commit;");
  if (mode === 'types') {
    if (recorded !== textFileSha256('supabase/migrations/' + version + '.sql')) throw new Error('MATCHING_LOCAL_MIGRATION_REQUIRED');
    const generated = target.docker(['exec','supabase-meta','node','--input-type=module','-e',
      'const r=await fetch("http://127.0.0.1:8080/generators/typescript?included_schemas=public"); if(!r.ok) process.exit(1); process.stdout.write(await r.text());']);
    const file = 'src/lib/database.types.ts';
    const scopes = {
      Tables: ['course_material_rules','course_material_rule_revisions','classroom_material_settings','classroom_material_changes'],
      Functions: ['get_course_material_options','save_course_material_rule','preview_classroom_material_change',
        'apply_classroom_material_change','get_classroom_material_workspace','create_class_with_material'],
    };
    const output = mergeGeneratedDatabaseTypes(fs.readFileSync(file,'utf8'), generated, scopes)
      .replace(new RegExp('^' + DIGEST_PREFIX + '.*$', 'm'), DIGEST_PREFIX + migrationsDigest());
    fs.writeFileSync(file,output,'utf8');
    fs.writeFileSync(path.join(privateDir,'types-generated.ts'),generated,'utf8');
    console.log('Merged database-generated types for four tables and six RPCs');
  } else if (mode === 'check') {
    if (recorded) throw new Error('MIGRATION_ALREADY_APPLIED');
    const fingerprint = () => target.sql("begin read only; select to_regclass('public.classroom_material_settings') is null; commit;");
    const before = fingerprint();
    const result = target.sql("begin; set local lock_timeout='5s'; set local statement_timeout='45s';\n" + body + '\n' + assertions + '\nrollback;');
    if (fingerprint() !== before) throw new Error('ROLLBACK_FAILED');
    fs.writeFileSync(receipt, JSON.stringify({ checksum, checkedAt: new Date().toISOString(), result }), 'utf8');
    console.log(result);
    console.log('PASS: migration and assertions rolled back');
  } else {
    if (recorded) throw new Error('MIGRATION_ALREADY_APPLIED');
    if (JSON.parse(fs.readFileSync(receipt, 'utf8')).checksum !== checksum) throw new Error('MATCHING_CHECK_REQUIRED');
    target.sql("begin; set local lock_timeout='5s';\n" + body
      + "\ninsert into public.schema_migrations(version,checksum) values('" + version + "','" + textFileSha256('supabase/migrations/' + version + '.sql') + "');\nnotify pgrst, 'reload schema'; commit;");
    console.log('APPLIED: local additive migration; no existing classroom selections rewritten');
  }
}
