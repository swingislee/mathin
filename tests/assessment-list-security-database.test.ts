import { describe, expect, it } from "vitest";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";

describe.skipIf(process.env.MATHIN_TABLE_PAGE_DB_TEST !== "1")("assessment database page security", () => {
  it("keeps RLS invoker execution, rejects anonymous calls and validates page/filter inputs", () => {
    const { sql } = openHistoryLocalTarget({ attestationPath: ".tmp/table-page-optimization/target.json", refresh: true,
      errorFile: ".tmp/table-page-optimization/security-error.txt" });
    const output = sql(`begin read only;
      do $probe$ declare bad jsonb; begin
        if has_function_privilege('anon','public.list_assessment_workbench_page(text,text,integer,integer,jsonb,text,jsonb)','EXECUTE')
          or exists(select 1 from pg_proc where oid in ('public.list_assessment_workbench_page(text,text,integer,integer,jsonb,text,jsonb)'::regprocedure,
            'public.assessment_list_rows(text)'::regprocedure) and prosecdef) then raise exception 'RLS_BOUNDARY_CHANGED'; end if;
        perform set_config('request.jwt.claims','{}',true);perform set_config('request.jwt.claim.sub','',true);
        begin perform public.list_assessment_workbench_page('all','',1,50,'{"version":2,"filters":{},"sort":null}','zh','{}');
          raise exception 'ANONYMOUS_ALLOWED'; exception when raise_exception then if sqlerrm<>'UNAUTHENTICATED' then raise; end if; end;
        perform set_config('request.jwt.claim.sub',(select id::text from auth.users where email='test-admin@mathin.local'),true);
        foreach bad in array array['{"version":2,"filters":{"private":{"kind":"text","query":"x"}}}'::jsonb,
          '{"version":2,"filters":{"scoreRate":{"kind":"number","min":"malformed"}}}'::jsonb,
          '{"version":2,"filters":{"scheduledAt":{"kind":"date","from":"2026-02-30","to":"2026-03-01"}}}'::jsonb,
          '{"version":2,"filters":{},"sort":{"field":"private","direction":"asc"}}'::jsonb] loop
          begin perform public.list_assessment_workbench_page('all','',1,50,bad,'zh','{}');
            raise exception 'INVALID_QUERY_ALLOWED'; exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
        end loop;
        begin perform public.list_assessment_workbench_page('all','',1,5000,'{"version":2,"filters":{},"sort":null}','zh','{}');
          raise exception 'UNBOUNDED_PAGE_ALLOWED'; exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
      end; $probe$; select 'security passed'; rollback;`);
    expect(output.trim()).toBe("security passed");
  }, 30000);
});
