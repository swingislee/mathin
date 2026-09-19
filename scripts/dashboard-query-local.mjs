import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw new Error('Use --check or --apply');
const source = path.resolve(process.argv[3] ?? '.');
const output = path.resolve(process.env.QUERY_AUDIT_OUTPUT ?? '.tmp/dashboard-query-local');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'),
  refresh: true, errorFile: path.join(output, 'database-error.txt') });
const versions = ['20260919100000_dashboard_asset_query', '20260919101000_session_event_student_lookup',
  '20260919102000_courseware_progress_summary'];
const migrations = versions.map(version => {
  const file = path.join(source, 'supabase/migrations', `${version}.sql`);
  return { version, checksum: textFileSha256(file), sql: fs.readFileSync(file, 'utf8') };
});
const recorded = JSON.parse(sql(`begin read only; select coalesce(jsonb_object_agg(version,checksum),'{}')
  from public.schema_migrations where version in (${versions.map(version => `'${version}'`).join(',')}); rollback;`));
for (const migration of migrations) if (recorded[migration.version] && recorded[migration.version] !== migration.checksum)
  throw new Error('QUERY_AUDIT_CHECKSUM_MISMATCH');
if (Object.keys(recorded).length) throw new Error('QUERY_AUDIT_ALREADY_INSTALLED_OR_PARTIAL');
const fingerprint = () => sql(`begin read only;
  select jsonb_build_object('functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'|' order by p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
    'policies',(select md5(string_agg(row_to_json(p)::text,'|' order by p.schemaname,p.tablename,p.policyname)) from pg_policies p where p.schemaname='public'),
    'ledger',(select count(*) from public.schema_migrations)); rollback;`);
const invariant = () => sql(`begin read only; select jsonb_build_object(
  'students',(select md5(string_agg(row_to_json(s)::text,'|' order by id)) from public.students s),
  'guardians',(select count(*) from public.student_guardians),
  'classes',(select count(*) from public.classrooms), 'sessions',(select count(*) from public.class_sessions),
  'events',(select count(*) from public.session_events),'roster',(select count(*) from public.session_roster_entries),
  'bindings',(select count(*) from public.cw_page_asset_bindings),'releases',(select count(*) from public.cw_lecture_releases),
  'revisions',(select count(*) from public.cw_page_revisions),'profiles',(select count(*) from public.profiles)); rollback;`);
const checksums = Object.fromEntries(migrations.map(({ version, checksum }) => [version, checksum]));
const change = migrations.map(migration => migration.sql).join('\n');
if (mode === '--check') {
  const before = fingerprint(), dataBefore = invariant();
  const emails = [...new Set(fs.readFileSync('.claude/test-accounts.local.md', 'utf8').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g))];
  const actorSql = `select set_config('mathin.query_audit.actors', jsonb_object_agg(role,id)::text,true) as actors from
    (select distinct on(p.role) p.role,p.id from public.profiles p join auth.users u on u.id=p.id
     where p.is_active and p.account_status='active' and not p.password_change_required
       and u.email in (${emails.map(email => `'${email.replaceAll("'", "''")}'`).join(',')}) order by p.role,p.id) actor \\gset
    do $$ begin if (select count(*) from jsonb_object_keys(current_setting('mathin.query_audit.actors')::jsonb)) <> 4
      then raise exception 'QUERY_AUDIT_FIXED_ROLES_REQUIRED'; end if; end $$;`;
  const assertions = fs.readFileSync(path.join(source, 'supabase/tests/dashboard_query_policy_assertions.sql'), 'utf8');
  let result;
  try {
    result = sql(`begin; set local lock_timeout='5s'; set local statement_timeout='90s';
      ${actorSql}\n${assertions}\n${change}
      select pg_temp.capture_query_audit('after','admin');
      select pg_temp.capture_query_audit('after','staff');
      select pg_temp.capture_query_audit('after','parent');
      select pg_temp.capture_query_audit('after','student');
      do $$ begin if exists (select actor,labels from query_audit_results where phase='before'
        except select actor,labels from query_audit_results where phase='after')
        then raise exception 'QUERY_AUDIT_EVENT_SCOPE_CHANGED'; end if; end $$;
      select jsonb_build_object('actor',actor,'visibleEvents',cardinality(labels),'equivalent',true)
        from query_audit_results where phase='after' order by actor;
      -- 名册旧账号在原有成员可见范围内仍可反查到学生。
      do $$ declare actor text; actor_id text; predicate text; visible boolean;
      begin
        select pg_get_expr(polqual,polrelid) into predicate from pg_policy where polrelid='public.session_events'::regclass and polname='events_select_student_scope';
        for actor,actor_id in select key,value from jsonb_each_text(current_setting('mathin.query_audit.actors')::jsonb) loop
          perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated','aal','aal2')::text,true);
          set local role authenticated;
          execute format('select (%s) is true from query_audit_events session_events where label=''legacy-roster''',predicate) into visible;
          reset role;
          if visible is distinct from (actor in ('admin','staff')) then raise exception 'QUERY_AUDIT_LEGACY_ROSTER_SCOPE: %',actor; end if;
        end loop;
      end $$;
      select jsonb_build_object('legacyRoster','PASS','migrationCompilation','PASS'); rollback;`);
  } finally {
    if (fingerprint() !== before || invariant() !== dataBefore) throw new Error('QUERY_AUDIT_ROLLBACK_FAILED');
  }
  const check = { checksums, host: observed.host, checkedAt: new Date().toISOString(), permissions: 'PASS', rollback: 'PASS' };
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify(check, null, 2) + '\n');
  console.log(result);
  console.log('Local migration compilation, event visibility for four roles, malformed payloads, legacy roster and full rollback PASS');
} else {
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (JSON.stringify(check.checksums) !== JSON.stringify(checksums) || check.host !== observed.host || check.rollback !== 'PASS')
    throw new Error('QUERY_AUDIT_CHECK_REQUIRED');
  const before = invariant();
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${change}
    ${migrations.map(({ version, checksum }) => `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');`).join('\n')}
    notify pgrst, 'reload schema'; commit;`);
  if (invariant() !== before) throw new Error('QUERY_AUDIT_APPLY_DATA_DRIFT');
  fs.writeFileSync(path.join(output, 'apply.json'), JSON.stringify({ checksums, host: observed.host, appliedAt: new Date().toISOString(), dataPreserved: true }, null, 2) + '\n');
  console.log('Three query migrations installed on the verified local development database; business data unchanged.');
}
