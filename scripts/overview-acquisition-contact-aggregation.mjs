import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openOverviewAggregateLocal, aggregateRoot as root, aggregateVersion as version, aggregateMigration as migration, aggregateAssertions as assertions } from './lib/overview-aggregate-local.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

if (process.argv[2] !== '--apply') throw Error('Run the opt-in database test first, then use --apply for this local migration');
const { sql, observed, footprint, businessFingerprint } = openOverviewAggregateLocal();
const checksum = textFileSha256(migration);
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied) {
  assert.equal(applied, checksum, 'MIGRATION_CHECKSUM_CHANGED');
  console.log(JSON.stringify({ alreadyApplied: true }));
} else {
  const check = JSON.parse(fs.readFileSync(`${root}/check.json`, 'utf8'));
  assert.equal(check.checksum, checksum);
  assert.equal(check.assertionsChecksum, textFileSha256(assertions));
  assert.equal(check.before, footprint(), 'DATABASE_CHANGED_SINCE_CHECK');
  assert.equal(check.rollbackUnchanged, true);
  assert.equal(check.safetyPassed, true);
  assert.deepEqual(check.differences, []);
  const businessBefore = businessFingerprint();
  const storage = () => JSON.parse(sql(`begin read only;select jsonb_build_object('wal',pg_current_wal_insert_lsn()::text,'bytes',
    (select sum(pg_total_relation_size(oid)) from pg_class where oid in ('public.history_import_records'::regclass,'public.lead_communications'::regclass,'public.activity_registrations'::regclass)));commit;`));
  const storageBefore = storage();
  const started = performance.now();
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='90s';${fs.readFileSync(migration, 'utf8')}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);
  const migrationMs = performance.now() - started;
  const storageAfter = storage();
  assert.match(storageBefore.wal, /^[0-9A-F]+\/[0-9A-F]+$/);
  assert.match(storageAfter.wal, /^[0-9A-F]+\/[0-9A-F]+$/);
  const walBytes = Number(sql(`begin read only;select pg_wal_lsn_diff('${storageAfter.wal}'::pg_lsn,'${storageBefore.wal}'::pg_lsn);commit;`));
  assert.equal(businessFingerprint(), businessBefore, 'BUSINESS_FINGERPRINT_CHANGED');
  const report = { applied: true, checkedAt: new Date().toISOString(), host: observed.host, origin: observed.supabaseOrigin, checksum, migrationMs,
    relationBytesBefore: storageBefore.bytes, relationBytesAfter: storageAfter.bytes, walBytesDuringWindow: walBytes, businessUnchanged: true };
  fs.writeFileSync(`${root}/apply.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
