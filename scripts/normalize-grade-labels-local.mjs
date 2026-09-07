import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { openHistoryLocalTarget } from "./lib/history-local-target.mjs";
import { textFileSha256 } from "./lib/text-hash.mjs";
import { normalizeGradeLabel, normalizeGradeText } from "../src/lib/grade-format.mjs";

const mode = process.argv[2];
if (!["--preflight", "--check", "--apply"].includes(mode)) throw new Error("Use --preflight, --check or --apply");
const output = path.resolve(".tmp/grade-labels");
fs.mkdirSync(output, { recursive: true });
const { sql: readSql, observed } = openHistoryLocalTarget({
  attestationPath: path.join(output, "preflight.json"), refresh: mode === "--preflight",
  errorFile: path.join(output, "database-error.txt"),
});
const version = "20260907001300_arabic_grade_labels";
const migration = `supabase/migrations/${version}.sql`;
const checksum = textFileSha256(migration);
const targets = [
  ["courses", ["title"]], ["course_families", ["title", "description"]], ["course_catalog_versions", ["title"]],
  ["classrooms", ["name"]], ["class_sessions", ["title"]], ["course_lectures", ["name"]], ["cw_page_docs", ["title"]],
  ["activities", ["title"]], ["organization_academic_grades", ["name_zh"]], ["leads", ["grade_text"]],
  ["teacher_microcourses", ["variant_name"]], ["teacher_microcourse_catalog_courses", ["description", "normalized_name"]],
];
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const snapshotSql = `select jsonb_object_agg(relation, data) from (${targets.map(([table, fields]) => `
  select '${table}' as relation, jsonb_build_object(
    'labels', coalesce(jsonb_agg(jsonb_build_object('id', coalesce(to_jsonb(r)->>'id', to_jsonb(r)->>'course_id'),
      ${fields.map(field => `'${field}', r.${field}`).join(",")}) order by coalesce(to_jsonb(r)->>'id', to_jsonb(r)->>'course_id')), '[]'::jsonb),
    'facts', md5(coalesce(string_agg(md5((to_jsonb(r) - array[${[...fields, "updated_at"].map(field => `'${field}'`).join(",")}])::text), ''
      order by coalesce(to_jsonb(r)->>'id', to_jsonb(r)->>'course_id')), ''))
  ) as data from public.${table} r`).join(" union all ")} ) facts;`;
const protectedSql = `select jsonb_build_object(
  'students', (select md5(coalesce(string_agg(md5(to_jsonb(r)::text), '' order by id), '')) from public.students r),
  'sourceGrades', (select md5(coalesce(string_agg(md5(to_jsonb(r)::text), '' order by id), '')) from public.lead_source_records r),
  'pageRevisions', (select count(*) from public.cw_page_revisions),
  'lectureReleases', (select count(*) from public.cw_lecture_releases));`;
const snapshot = () => {
  const lines = readSql(`begin read only; ${snapshotSql} ${protectedSql} commit;`).split("\n").filter(line => line.startsWith("{"));
  return { business: JSON.parse(lines[0]), protected: JSON.parse(lines[1]) };
};
const sql = statement => {
  try {
    return execFileSync("docker.exe", ["--context", "desktop-linux", "exec", "-i", "supabase-db", "psql", "-X", "-qAt",
      "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: statement, encoding: "utf8", windowsHide: true, maxBuffer: 96 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (error) {
    fs.writeFileSync(path.join(output, "database-error.txt"), String(error.stderr ?? error.message), "utf8");
    throw new Error("GRADE_LABEL_DATABASE_ERROR: inspect private error file");
  }
};
const before = snapshot();
const expected = structuredClone(before);
const affected = {};
for (const [table, fields] of targets) {
  affected[table] = 0;
  for (const row of expected.business[table].labels) {
    let changed = false;
    for (const field of fields) {
      const normalized = row[field] === null ? null : (field === "grade_text" ? normalizeGradeLabel : normalizeGradeText)(row[field]);
      changed ||= normalized !== row[field];
      row[field] = normalized;
    }
    if (changed) affected[table] += 1;
  }
}
const applied = readSql(`begin read only; select count(*) from public.schema_migrations where version='${version}'; commit;`);
if (mode === "--preflight") {
  console.log(JSON.stringify({ host: observed.host, localTargetVerified: true, checksum, applied: Number(applied), affected }));
  process.exit(0);
}
if (applied !== "0") throw new Error("MIGRATION_ALREADY_APPLIED");
const checkFile = path.join(output, "check.json");
if (mode === "--apply") {
  const check = JSON.parse(fs.readFileSync(checkFile, "utf8"));
  if (check.checksum !== checksum || check.beforeHash !== hash(before)) throw new Error("CURRENT_STATE_CHECK_REQUIRED");
  fs.writeFileSync(path.join(output, "before.json"), JSON.stringify(before), "utf8");
}
// 比对放在提交前；函数、写入规则或其他业务事实变化时，整个事务回滚。
const expectedSql = JSON.stringify(expected).replaceAll("'", "''");
const invariants = `do $verify$ declare actual jsonb; protected jsonb; expected jsonb := '${expectedSql}'::jsonb; begin
  ${snapshotSql.replace("select jsonb_object_agg(relation, data) from", "select jsonb_object_agg(relation, data) into actual from")}
  ${protectedSql.replace(/\);$/, ") into protected;")}
  if actual is distinct from expected->'business' or protected is distinct from expected->'protected' then
    raise exception 'GRADE_LABEL_FACTS_CHANGED'; end if;
end $verify$;`;
sql(`begin; set local lock_timeout='5s'; set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('arabic-grade-labels',0));
  ${fs.readFileSync(migration, "utf8")}
  ${invariants}
  ${fs.readFileSync("scripts/sql/grade-labels-assertions.sql", "utf8")}
  ${mode === "--check" ? "rollback;" : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}'); commit;`}`);
const after = snapshot();
if (hash(after) !== hash(mode === "--check" ? before : expected)) throw new Error("GRADE_LABEL_POSTFLIGHT_MISMATCH");
const report = { mode, checksum, beforeHash: hash(before), affected, factsPreserved: true, rollbackVerified: mode === "--check" };
fs.writeFileSync(mode === "--check" ? checkFile : path.join(output, "applied.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
