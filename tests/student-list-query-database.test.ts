import { describe, expect, it } from "vitest";
import { runStudentListQueryTrial, studentListSqlLiteral as literal } from "../scripts/lib/student-list-query-trial.mjs";
import { followupFieldPage } from "@/features/school/followup-table-page";
import { studentStageTableFields } from "@/features/school/student-stage-table-fields";
import { studentListFacets, studentListFieldLabels, studentListRpcQuery } from "@/features/school/student-list-query-contract";
import { STUDENT_STAGE_TABS, type StudentStageRow } from "@/features/school/student-stage-contract";
import type { DashboardFieldQuery } from "@/features/school/dashboard-page/dashboard-table-field-contract";

const base: StudentStageRow = {
  key: "student:1", studentId: "1", leadId: null, name: "学生2", phone: "123", grade: 2, gradeText: "二年级",
  ownerId: "owner-a", ownerName: "同名负责", teacherId: "teacher-a", teacherName: "教师2", stage: "awaiting_renewal", detail: "attending",
  note: "Alpha\t记录", lastContactAt: "2026-09-07T16:30:00Z", nextContactAt: null, score: 10, assessmentBand: "a_plus", assessmentAt: "2026-09-08",
  registrationId: null, courseTitle: "课程2", termName: "秋季", courseId: "course-a", termId: "term-a", createdAt: "2026-09-08T01:00:00Z",
  canWrite: true, canContact: true, invitation: null,
};
// 包含数字自然序、同名不同编号、重音/大小写、缺失排序和跨组织日边界。
const rows: StudentStageRow[] = Array.from({ length: 123 }, (_, i) => ({ ...base, key: `student:${String(i).padStart(3, "0")}`, studentId: String(i),
  name: ["学生10", "学生2", "École", "ecole", "Zebra", "学生1"][i % 6], grade: i % 4 ? 3 : 10,
  gradeText: i % 4 ? "三年级" : "十年级", ownerId: i % 4 ? "owner-a" : "owner-b", ownerName: i % 7 ? "同名负责" : "",
  detail: i % 3 ? "attending" : "awaiting_class", teacherId: i % 3 ? "teacher-a" : null, teacherName: i % 3 ? "教师2" : "",
  note: i % 2 ? "Alpha\t记录" : i % 4 ? " \t\n\u00a0\ufeff" : "v", lastContactAt: i % 3 ? "2026-09-07T16:30:00Z" : null,
  assessmentAt: i % 3 ? "2026-09-07T16:01:00Z" : "2026-09-08", courseId: i % 3 ? "course-a" : null,
  courseTitle: i % 3 ? "课程2" : "", assessmentBand: i % 2 ? "a_plus" : null,
}));

describe.skipIf(process.env.MATHIN_STUDENT_LIST_DB_TEST !== "1")("student list SQL field contract on the guarded local database", () => {
  it("preserves existing visible records, fields and counts for staff scopes and populations", () => {
    let sql = "";
    const cases: string[] = [];
    for (const actor of ["admin", "teacher"]) {
      sql += `select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-${actor}@mathin.local'),'role','authenticated')::text,true) is not null;`;
      for (const population of ["work", "records"]) for (const stage of STUDENT_STAGE_TABS) {
        const name = `${actor}:${population}:${stage}`; cases.push(name);
        sql += `with expected as materialized (select public.list_student_record_summaries('${stage}','all','','${population}') as data),
          facts as materialized (select * from public.student_list_facts('all','','${population}','${stage}')),
          differences as (select distinct f.key as field from expected e cross join lateral jsonb_array_elements(e.data->'rows') old
            left join facts a on a.row_data->>'key'=old->>'key' cross join lateral jsonb_each(old) f
            where f.key not in ('invitation','nextContactAt') and (old->>'stage' not in ('awaiting_first_contact','awaiting_assessment')
              or f.key not in ('score','assessmentBand','assessmentAt','registrationId','courseTitle','termName','courseId','termId'))
            and case when f.key='inferredSourceIds' then
              (select jsonb_agg(v order by v) from jsonb_array_elements(f.value) v) is distinct from
              (select jsonb_agg(v order by v) from jsonb_array_elements(a.row_data->f.key) v)
              else f.value is distinct from a.row_data->f.key end)
          select jsonb_build_object('case','${name}','fields',(select coalesce(jsonb_agg(field),'[]'::jsonb) from differences),
            'sameRows',jsonb_array_length(e.data->'rows')=(select count(*) from facts where row_data is not null),
            'sameCounts',e.data->'counts'=coalesce((select jsonb_object_agg(index_stage,n) from(select index_stage,count(*) n from facts group by index_stage) c),'{}'::jsonb)) from expected e;`;
      }
    }
    expect(runStudentListQueryTrial(sql)).toEqual(cases.map(value => ({ case: value, fields: [], sameRows: true, sameCounts: true })));
  }, 180_000);

  it("enforces authentication, staff permission, private helper ACLs and validated query fields", () => {
    const sql = `do $checks$ declare bad jsonb; begin
      if has_function_privilege('anon','public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb)','EXECUTE')
        or not has_function_privilege('authenticated','public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb)','EXECUTE')
        or has_function_privilege('authenticated','public.student_list_facts(text,text,text,text)','EXECUTE')
        or has_function_privilege('authenticated','public.student_list_field(jsonb,text,jsonb,uuid,text)','EXECUTE')
        or has_function_privilege('authenticated','public.student_list_field_matches(jsonb,jsonb)','EXECUTE') then raise exception 'ACL_CHANGED'; end if;
      if has_function_privilege('authenticated','public.student_list_is_blank(text)','EXECUTE') then raise exception 'PRIVATE_HELPER_EXPOSED'; end if;
      perform set_config('request.jwt.claims','{}',true);
      begin perform public.list_student_records_page('awaiting_renewal','all','','work',1,20,'{"version":2,"filters":{},"sort":null}','zh','{}');
        raise exception 'ANONYMOUS_ALLOWED'; exception when raise_exception then if sqlerrm<>'UNAUTHENTICATED' then raise; end if; end;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-student@mathin.local'),'role','authenticated')::text,true);
      begin perform public.list_student_records_page('awaiting_renewal','all','','work',1,20,'{"version":2,"filters":{},"sort":null}','zh','{}');
        raise exception 'STUDENT_ALLOWED'; exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated')::text,true);
      foreach bad in array array['{"version":2,"filters":{"secret":{"kind":"text","query":"x"}}}'::jsonb,
        '{"version":2,"filters":{"owner":{"kind":"text","query":"x"}}}'::jsonb,
        '{"version":2,"filters":{"assessmentAt":{"kind":"date","from":"2026-02-30","to":"2026-03-01"}}}'::jsonb,
        '{"version":2,"filters":{},"sort":{"field":"scope","direction":"asc"}}'::jsonb] loop
        begin perform public.list_student_records_page('awaiting_renewal','all','','work',1,20,bad,'zh','{}');
          raise exception 'INVALID_QUERY_ALLOWED'; exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
      end loop;
    end; $checks$; select '{"security":"pass"}'::jsonb;`;
    expect(runStudentListQueryTrial(sql)).toEqual([{ security: "pass" }]);
  }, 30_000);

  it("matches shared filtering, natural sorting, facets and page clamping in zh/en", () => {
    const queries: DashboardFieldQuery[] = [{ version: 2, filters: {}, sort: null }];
    const fields = studentStageTableFields("zh", "awaiting_renewal", "actor");
    for (const [id, field] of Object.entries(fields)) {
      if (field.sortable !== false) for (const direction of ["asc", "desc"] as const) queries.push({ version: 2, filters: {}, sort: { field: id, direction } });
      for (const value of ["present", "missing"] as const) queries.push({ version: 2, filters: { [id]: { kind: "presence", value } }, sort: null });
    }
    queries.push({ version: 2, filters: { note: { kind: "text", query: "  ALpHA  " }, owner: { kind: "enum", values: ["owner-b"] },
      assessmentAt: { kind: "date", from: "2026-09-08", to: "2026-09-08" } }, sort: { field: "name", direction: "desc" } },
    { version: 2, filters: { owner: { kind: "enum", values: ["unknown-owner"] }, grade: { kind: "enum", values: ["3"] } }, sort: null });
    let sql = `select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated')::text,true) is not null;
      create temporary table student_list_test_rows as select value as data from jsonb_array_elements(${literal(JSON.stringify(rows))}::jsonb);
      create or replace function public.student_list_facts(p_scope text,p_search text,p_population text,p_stage text)
      returns table(row_data jsonb,index_stage text) language sql stable security definer set search_path=public,pg_temp as $fixture$
      select data,data->>'stage' from pg_temp.student_list_test_rows; $fixture$;`;
    const cases = ["zh", "en"].flatMap(locale => queries.map((query, index) => ({ locale, query, page: index % 3 === 0 ? 999 : 2 })));
    for (const [index, value] of cases.entries()) {
      const labels = studentListFieldLabels(studentStageTableFields(value.locale, "awaiting_renewal", "actor"));
      sql += `select jsonb_build_object('index',${index},'page',public.list_student_records_page('awaiting_renewal','all','','work',${value.page},20,
        ${literal(JSON.stringify(studentListRpcQuery(value.query)))}::jsonb,'${value.locale}',${literal(JSON.stringify(labels))}::jsonb));`;
    }
    const actual = runStudentListQueryTrial(sql);
    expect(actual).toHaveLength(cases.length);
    for (const result of actual) {
      const value = cases[result.index], context = { locale: value.locale, timeZone: "Asia/Shanghai", now: Date.parse(base.createdAt) };
      const definitions = studentStageTableFields(value.locale, "awaiting_renewal", "actor");
      const expected = followupFieldPage(rows, definitions, value.query, context, value.page, 20);
      expect({ index: result.index, count: result.page.count, page: result.page.page, pages: result.page.totalPages,
        keys: result.page.rows.map((row: StudentStageRow) => row.key), facets: studentListFacets(result.page.facets, definitions, value.locale) })
        .toEqual({ index: result.index, count: expected.count, page: expected.page, pages: expected.totalPages,
          keys: expected.rows.map(row => row.key), facets: expected.fieldView.facets });
    }
  }, 120_000);
});
