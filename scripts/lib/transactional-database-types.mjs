import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assertNonProductionWriteTarget } from "./r1-write-target-policy.mjs";

// 候选函数只在一条连接的事务中可见，生成类型后回滚；不改当前开发 schema。
export function generateTransactionalDatabaseTypes() {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  assertNonProductionWriteTarget({ operation: "db:transactional-types", supabaseUrl: origin });
  const url = new URL(origin);
  if (url.hostname !== "127.0.0.1" || process.env.SUPABASE_META_DOCKER !== "supabase-meta") throw new Error("LOCAL_META_REQUIRED");
  const docker = (args, input) => {
    const r = spawnSync("docker", args, { input, encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0 || r.error) throw new Error("TRANSACTIONAL_TYPES_COMMAND_FAILED");
    return r.stdout.trim();
  };
  if (docker(["context", "show"]) !== "desktop-linux"
    || !docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).startsWith("npipe://")
    || docker(["port", "supabase-envoy", "8000/tcp"]) !== "127.0.0.1:" + url.port) throw new Error("LOCAL_META_TARGET_MISMATCH");
  const psql = (sql) => docker(["exec", "-i", "supabase-db", "psql", "-U", "supabase_admin", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], sql);
  const fingerprint = psql("begin read only; select encode(sha256(system_identifier::text::bytea),'hex') from pg_control_system(); rollback;");
  if (fingerprint !== process.env.MATHIN_WRITE_TARGET_FINGERPRINT) throw new Error("LOCAL_META_FINGERPRINT_MISMATCH");
  const files = process.env.SUPABASE_META_MIGRATIONS.split(",");
  if (!files.length || files.some((file) => !/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(file))) throw new Error("MIGRATION_FILENAME_INVALID");
  const migration = files.map((file) => readFileSync("supabase/migrations/" + file, "utf8")).join("\n");
  const snapshotSql = "begin isolation level repeatable read read only; select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''), '|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'; rollback;";
  const before = psql(snapshotSql);
  const script = [
    "import { PostgresMeta } from '/usr/src/app/dist/lib/index.js';",
    "import { PG_CONNECTION, POSTGREST_VERSION } from '/usr/src/app/dist/server/constants.js';",
    "import { apply } from '/usr/src/app/dist/server/templates/typescript.js';",
    "const meta = new PostgresMeta({ connectionString: PG_CONNECTION, max: 1, idleTimeoutMillis: 0 });",
    "const query = async (sql) => { const r = await meta.query(sql, { trackQueryInSentry: false }); if (r.error) throw Error('TYPE_QUERY_FAILED'); return r.data; };",
    "let output;",
    "try {",
    "const actual = await query(\"select encode(sha256(system_identifier::text::bytea),'hex') fingerprint from pg_control_system()\");",
    "if (actual[0].fingerprint !== " + JSON.stringify(fingerprint) + ") throw Error('META_FINGERPRINT_MISMATCH');",
    "await query(\"begin isolation level serializable; set local statement_timeout='90s';\");",
    "const pid = (await query('select pg_backend_pid() pid'))[0].pid;",
    "await query(Buffer.from(" + JSON.stringify(Buffer.from(migration).toString("base64")) + ", 'base64').toString('utf8'));",
    "const scoped = { includedSchemas: ['public'], includeColumns: false };",
    "const names = ['schemas','tables','foreignTables','views','materializedViews','columns','relationships','functions','types'];",
    "const results = await Promise.all([meta.schemas.list(), meta.tables.list(scoped), meta.foreignTables.list(scoped),",
    "meta.views.list(scoped), meta.materializedViews.list(scoped), meta.columns.list({includedSchemas:['public']}),",
    "meta.relationships.list(), meta.functions.list({includedSchemas:['public']}),",
    "meta.types.list({includeTableTypes:true,includeArrayTypes:true,includeSystemSchemas:true})]);",
    "if (results.some(r => r.error)) throw Error('TYPE_METADATA_FAILED');",
    "if ((await query('select pg_backend_pid() pid'))[0].pid !== pid) throw Error('TYPE_CONNECTION_CHANGED');",
    "const config = Object.fromEntries(names.map((name,i)=>[name,results[i].data]));",
    "config.schemas = config.schemas.filter(s => s.name === 'public');",
    "config.functions = config.functions.filter(f => !['trigger','event_trigger'].includes(f.return_type));",
    "output = await apply({...config,detectOneToOneRelationships:false,postgrestVersion:POSTGREST_VERSION});",
    "} finally { await query('rollback'); await meta.end(); }",
    "process.stdout.write(output);",
  ].join("\n");
  let generated;
  try {
    generated = docker(["exec", "-i", "-e", "SENTRY_DSN=", "supabase-meta", "node", "--input-type=module"], script);
  } finally {
    if (psql(snapshotSql) !== before) throw new Error("TYPE_GENERATION_ROLLBACK_MISMATCH");
  }
  return { status: 0, stdout: generated + "\n", stderr: "" };
}
