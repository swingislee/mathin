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
  const versions = ['20261003010000_class_material_rules', '20261003010100_class_material_inheritance'];
  const migrations = versions.map(version => {
    const file = 'supabase/migrations/' + version + '.sql';
    const content = fs.readFileSync(file, 'utf8');
    const checksum = textFileSha256(file);
    const recorded = target.sql("begin read only; select checksum from public.schema_migrations where version='" + version + "'; commit;");
    if (recorded && recorded !== checksum) throw new Error('APPLIED_MIGRATION_CHECKSUM_MISMATCH');
    return { version, checksum, recorded, content, body: content.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '') };
  });
  const pending = migrations.filter(migration => !migration.recorded);
  const assertions = fs.readFileSync('scripts/sql/class-material-assertions.sql', 'utf8');
  const checksum = createHash('sha256').update(migrations.map(migration => migration.content).join('\n')).update(assertions).digest('hex');
  const receipt = path.join(privateDir, 'checked.json');
  const body = pending.map(migration => migration.body).join('\n');
  if (mode === 'types') {
    if (pending.length) throw new Error('MATCHING_LOCAL_MIGRATION_REQUIRED');
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
    const fingerprint = () => target.sql("begin read only; select md5(coalesce(string_agg(pg_get_functiondef(p.oid),'|' order by p.oid),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','mathin_internal') and p.prokind='f' and p.proname like '%material%'; commit;");
    const before = fingerprint();
    const result = target.sql("begin; set local lock_timeout='5s'; set local statement_timeout='45s';\n" + body + '\n' + assertions + '\nrollback;');
    if (fingerprint() !== before) throw new Error('ROLLBACK_FAILED');
    fs.writeFileSync(receipt, JSON.stringify({ checksum, checkedAt: new Date().toISOString(), result }), 'utf8');
    console.log(result);
    console.log('PASS: migration and assertions rolled back');
  } else {
    if (!pending.length) throw new Error('MIGRATIONS_ALREADY_APPLIED');
    if (JSON.parse(fs.readFileSync(receipt, 'utf8')).checksum !== checksum) throw new Error('MATCHING_CHECK_REQUIRED');
    target.sql("begin; set local lock_timeout='5s';\n" + body
      + '\n' + pending.map(migration => "insert into public.schema_migrations(version,checksum) values('" + migration.version + "','" + migration.checksum + "');").join('\n')
      + "\nnotify pgrst, 'reload schema'; commit;");
    console.log('APPLIED: local additive migration; no existing classroom selections rewritten');
  }
}
