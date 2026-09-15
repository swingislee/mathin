import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";
import { textFileSha256 } from "../scripts/lib/text-hash.mjs";
import { followupFieldPage } from "@/features/school/followup-table-page";
import { studentStageTableFields, studentStageFieldScope } from "@/features/school/student-stage-table-fields";
import { studentListFacets, studentListFieldLabels, studentListRpcQuery } from "@/features/school/student-list-query-contract";
import type { StudentStageRow } from "@/features/school/student-stage-contract";
import type { DashboardFieldQuery } from "@/features/school/dashboard-page/dashboard-table-field-contract";

const migrationPath = "supabase/migrations/20260915002000_student_recontact_pages.sql";
const root = ".tmp/student-recontact-pages";
const literal = (v: unknown) => `'${String(v).replaceAll("'", "''")}'`;
const base: StudentStageRow = { key: "student:000", studentId: "000", leadId: null, name: "Student 2", phone: "123", grade: 3, gradeText: "3年级",
  ownerId: "owner-a", ownerName: "同名", teacherId: "teacher-a", teacherName: "Teacher 2", stage: "awaiting_enrollment", detail: "assessed",
  note: "Alpha", lastContactAt: "2026-09-07T16:30:00Z", nextContactAt: null, score: 10, assessmentBand: "a_plus", assessmentAt: "2026-09-08",
  registrationId: null, courseTitle: "课程2", termName: "秋季", courseId: "course-a", termId: "term-a", createdAt: "2026-09-01T00:00:00Z",
  participants: [], groups: [], isParticipant: false, inMyGroups: false, canWrite: false, canContact: false, invitation: null,
  recontactReason: "dormant", sharedPhoneCount: 1 };
const rows: StudentStageRow[] = Array.from({ length: 123 }, (_, i) => ({ ...base, key: `student:${String(i).padStart(3, "0")}`, studentId: String(i),
  name: ["学生10", "学生2", "École", "ecole", "Zebra", "学生1"][i % 6], grade: i % 4 ? 3 : 10,
  gradeText: i % 4 ? "3年级" : "10年级", ownerId: i % 5 ? i % 4 ? "owner-a" : "owner-b" : null, ownerName: i % 7 ? "同名" : "",
  teacherId: i % 3 ? "teacher-a" : null, teacherName: i % 3 ? "Teacher 2" : "", detail: i % 2 ? "assessed" : "considering",
  note: i % 2 ? "Alpha\t记录" : i % 4 ? " \t\n\u00a0\ufeff" : "", lastContactAt: i % 3 ? "2026-09-07T16:30:00Z" : null,
  assessmentAt: i % 3 ? "2026-09-07T16:01:00Z" : "2026-09-08", courseId: i % 3 ? "course-a" : null,
  courseTitle: i % 3 ? "课程2" : "", assessmentBand: i % 2 ? "a_plus" : null,
  isParticipant: i % 4 === 0, inMyGroups: i % 6 === 0, groups: i % 6 === 0 ? [{ id: "group-a", name: "一组" }] : [],
})).sort((a, b) => a.lastContactAt === b.lastContactAt ? a.key.localeCompare(b.key)
  : a.lastContactAt === null ? 1 : b.lastContactAt === null ? -1 : b.lastContactAt.localeCompare(a.lastContactAt));

describe.skipIf(process.env.MATHIN_RECONTACT_DB_TEST !== "1")("recontact database field contract", () => {
  it("matches shared filtering, stable sorting, self-excluding facets and page clamping in zh/en", () => {
    fs.mkdirSync(root, { recursive: true });
    fs.rmSync(`${root}/field-contract.json`, { force: true });
    openHistoryLocalTarget({ attestationPath: `${root}/target.json`, refresh: true, errorFile: `${root}/error.txt` });
    const queries: DashboardFieldQuery[] = [{ version: 2, filters: {}, sort: null }];
    const fields = studentStageTableFields("zh", "awaiting_enrollment", "actor");
    for (const [id, field] of Object.entries(fields)) {
      if (field.sortable !== false) for (const direction of ["asc", "desc"] as const) queries.push({ version: 2, filters: {}, sort: { field: id, direction } });
      for (const value of ["present", "missing"] as const) queries.push({ version: 2, filters: { [id]: { kind: "presence", value } }, sort: null });
    }
    for (const scope of ["mine", "group", "unassigned"]) queries.push({ version: 2, filters: { scope: { kind: "enum", values: [scope] } }, sort: null });
    queries.push({ version: 2, filters: { note: { kind: "text", query: "  ALpHA  " }, owner: { kind: "enum", values: ["owner-b"] },
      assessmentAt: { kind: "date", from: "2026-09-08", to: "2026-09-08" } }, sort: { field: "name", direction: "desc" } },
    { version: 2, filters: { owner: { kind: "enum", values: ["missing-owner"] }, grade: { kind: "enum", values: ["3"] } }, sort: null });
    const cases = ["zh", "en"].flatMap(locale => queries.map((query, index) => ({ locale, query, page: index % 3 === 0 ? 999 : 2 })));
    // 事务内的临时事实只测试分页算法。真实业务范围和 ACL 由独立的读取验证脚本覆盖。
    let sql = `begin;set local lock_timeout='3s';set local statement_timeout='90s';${fs.readFileSync(migrationPath, "utf8")}
      create temporary table recontact_field_rows as select value as payload from jsonb_array_elements(${literal(JSON.stringify(rows))}::jsonb);
      create or replace function public.student_recontact_candidates(p_scope text,p_search text,p_facts public.business_course_enrollment_subjects[])
      returns jsonb language sql stable security definer set search_path=public,pg_temp as $fixture$
      select coalesce(jsonb_agg(jsonb_build_object('key',payload->>'key','student_id',null,'lead_id',null,'stage',payload->>'stage','phone',payload->>'phone',
        'last_contact_at',payload->'lastContactAt','reason','dormant','shared_phone_count',1) order by payload->>'lastContactAt' desc nulls last,payload->>'key'),'[]')
      from pg_temp.recontact_field_rows where p_scope='all' or p_scope='mine' and (payload->>'isParticipant')::boolean
        or p_scope='group' and (payload->>'inMyGroups')::boolean or p_scope='unassigned' and payload->>'ownerId' is null;$fixture$;
      create or replace function public.student_list_query_facts(p_scope text,p_search text,p_population text,p_stage text,p_subjects jsonb)
      returns table(row_data jsonb,index_stage text) language sql stable security definer set search_path=public,pg_temp as $fixture$
      select payload,payload->>'stage' from pg_temp.recontact_field_rows f where (p_subjects is null or exists(select 1 from jsonb_array_elements(p_subjects) s where s->>'key'=f.payload->>'key'))
        and (p_scope='all' or p_scope='mine' and (payload->>'isParticipant')::boolean or p_scope='group' and (payload->>'inMyGroups')::boolean or p_scope='unassigned' and payload->>'ownerId' is null);$fixture$;
      create or replace function public.student_list_row_permissions(p_row jsonb,p_actor uuid,p_view_all boolean,p_write_followup boolean)
      returns jsonb language sql stable security definer set search_path=public,pg_temp as $fixture$select p_row;$fixture$;
      create or replace function public.student_record_list_rows(p_subjects jsonb,p_enrollments public.business_course_enrollment_subjects[])
      returns jsonb language sql stable security definer set search_path=public,pg_temp as $fixture$
      select coalesce(jsonb_agg(payload),'[]') from pg_temp.recontact_field_rows f where exists(select 1 from jsonb_array_elements(p_subjects) s where s->>'key'=f.payload->>'key');$fixture$;
      do $$begin perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated','aal','aal2')::text,true);end $$;`;
    for (const [index, value] of cases.entries()) {
      const labels = studentListFieldLabels(studentStageTableFields(value.locale, "awaiting_enrollment", "actor"));
      sql += `select jsonb_build_object('index',${index},'kind','recontact','zone',public.get_organization_timezone_v2(),'page',public.list_student_recontact_page(
        '${studentStageFieldScope(value.query)}','','dormant',${value.page},20,${literal(JSON.stringify(studentListRpcQuery(value.query)))}::jsonb,'${value.locale}',${literal(JSON.stringify(labels))}::jsonb));`;
      sql += `select jsonb_build_object('index',${index},'kind','records','zone',public.get_organization_timezone_v2(),'page',public.list_student_records_page(
        'awaiting_enrollment','${studentStageFieldScope(value.query)}','','records',${value.page},20,${literal(JSON.stringify(studentListRpcQuery(value.query)))}::jsonb,'${value.locale}',${literal(JSON.stringify(labels))}::jsonb));`;
    }
    sql += "rollback;";
    let output: string;
    try { output = execFileSync("docker.exe", ["--context", "desktop-linux", "exec", "-i", "supabase-db", "psql", "-X", "-qAt", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
      { input: sql, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { fs.writeFileSync(`${root}/field-error.txt`, String((error as { stderr?: string }).stderr ?? error)); throw new Error("RECONTACT_FIELD_CONTRACT_FAILED"); }
    const actual = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    expect(actual).toHaveLength(cases.length * 2);
    for (const result of actual) {
      const value = cases[result.index], scope = studentStageFieldScope(value.query);
      const ordered = result.kind === "records" ? [...rows].sort((a, b) => a.key.localeCompare(b.key)) : rows;
      const source = ordered.filter(row => scope === "all" || scope === "mine" && row.isParticipant || scope === "group" && row.inMyGroups || scope === "unassigned" && !row.ownerId);
      const definitions = studentStageTableFields(value.locale, "awaiting_enrollment", "actor");
      const expected = followupFieldPage(source, definitions, value.query, { locale: value.locale, timeZone: result.zone, now: Date.parse(base.createdAt) }, value.page, 20);
      expect({ index: result.index, kind: result.kind, count: result.page.count, page: result.page.page, pages: result.page.totalPages,
        keys: result.page.rows.map((row: StudentStageRow) => row.key), facets: studentListFacets(result.page.facets, definitions, value.locale) })
        .toEqual({ index: result.index, kind: result.kind, count: expected.count, page: expected.page, pages: expected.totalPages,
          keys: expected.rows.map(row => row.key), facets: expected.fieldView.facets });
    }
    fs.writeFileSync(`${root}/field-contract.json`, JSON.stringify({ checksum: textFileSha256(migrationPath), passed: true, cases: cases.length * 2 }) + "\n");
  }, 180_000);
});
