import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";

describe.skipIf(process.env.MATHIN_TABLE_PAGE_DB_TEST !== "1")("communication page before enrichment", () => {
  it("matches complete authorized facts on first, next and clamped pages for all four scopes and fixed staff roles", () => {
    const folder = ".tmp/table-page-optimization";
    openHistoryLocalTarget({ attestationPath: `${folder}/target.json`, refresh: true, errorFile: `${folder}/communication-test-error.txt` });
    let queries = "begin read only;set local statement_timeout='30s';";
    for (const role of ["admin", "teacher"]) {
      queries += `select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='test-${role}@mathin.local'),true) is not null;`;
      for (const scope of ["all", "mine", "group", "unassigned"]) for (const page of [1, 2, 999999]) {
        const query = { version: 2, filters: scope === "all" ? {} : { scope: { kind: "enum", values: [scope] } }, sort: null, includeFacets: false };
        queries += `with facts as materialized(select * from public.student_list_base_facts('${scope}','','records','awaiting_first_contact')),
          rows as materialized(select row_data as payload from facts where row_data is not null),
          totals as(select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/50)::integer) as pages from rows),
          page_rows as(select payload from rows order by (payload->>'createdAt')::timestamptz desc,payload->>'key' limit 50 offset (least(${page},(select pages from totals))-1)*50),
          expected as(select jsonb_build_object('rows',coalesce((select jsonb_agg(public.student_list_row_permissions(payload,auth.uid(),public.has_perm(auth.uid(),'student.view.all'),public.has_perm(auth.uid(),'followup.write')) order by (payload->>'createdAt')::timestamptz desc,payload->>'key') from page_rows),'[]'::jsonb),
            'count',t.count,'page',least(${page},t.pages),'pageSize',50,'totalPages',t.pages,
            'counts',coalesce((select jsonb_object_agg(index_stage,n) from(select index_stage,count(*) n from facts group by index_stage) c),'{}'::jsonb),'facets','{}'::jsonb) as data from totals t),
          actual as(select public.list_student_records_page('awaiting_first_contact','${scope}','','records',${page},50,'${JSON.stringify(query)}','zh','{}') as data)
          select jsonb_build_object('case','${role}/${scope}/${page}','equal',expected.data=actual.data,'bounded',jsonb_array_length(actual.data->'rows')<=50) from expected,actual;`;
      }
    }
    queries += `select jsonb_build_object('private',not has_function_privilege('authenticated','public.student_first_contact_page_facts(text,integer,integer)','EXECUTE')
      and not has_function_privilege('anon','public.student_first_contact_page_facts(text,integer,integer)','EXECUTE'));rollback;`;
    const log = fs.openSync(`${folder}/communication-test-error.txt`, "w");
    try {
      const output = execFileSync("docker.exe", ["--context", "desktop-linux", "exec", "-i", "supabase-db", "psql", "-X", "-qAt", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        { input: queries, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", log] });
      const results = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
      expect(results).toHaveLength(25);
      for (const result of results.slice(0, -1)) expect({ equal: result.equal, bounded: result.bounded }, result.case).toEqual({ equal: true, bounded: true });
      expect(results.at(-1)).toEqual({ private: true });
    } finally { fs.closeSync(log); }
  }, 120000);
});
