-- 提前排除只作用于工作列表，并涵盖通过任一关联线索恢复的学生。
-- 穷举暂停、最终选中线索、本人/关联线索工作单组合：原结果保留的身份必须进入候选集。
do $candidate_truth_table$
declare population text; own_paused boolean; lead_paused boolean; own_scheduled boolean;
  selected_scheduled boolean; other_scheduled boolean; original_keeps boolean; candidate_keeps boolean;
begin
  foreach population in array array['work','records'] loop
    foreach own_paused in array array[false,true] loop
      foreach lead_paused in array array[false,true] loop
        foreach own_scheduled in array array[false,true] loop
          foreach selected_scheduled in array array[false,true] loop
            foreach other_scheduled in array array[false,true] loop
              original_keeps := population='records' or not own_paused and not lead_paused or own_scheduled or selected_scheduled;
              candidate_keeps := population='records' or not own_paused or own_scheduled or selected_scheduled or other_scheduled;
              if original_keeps and not candidate_keeps then raise exception 'STUDENT_CANDIDATE_EXCLUDED_VISIBLE_SUBJECT'; end if;
            end loop;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
end;
$candidate_truth_table$;

do $access_checks$
declare actor uuid;
begin
  if has_function_privilege('anon','public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.student_list_facts(text,text,text,text)','EXECUTE') then raise exception 'HELPER_ACL_CHANGED'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.list_student_records_page('awaiting_first_contact','all','','work',1,20,'{"version":2,"filters":{}}','zh','{}');
    raise exception 'ANONYMOUS_ALLOWED';
  exception when raise_exception then if sqlerrm<>'UNAUTHENTICATED' then raise; end if; end;
  for actor in select id from auth.users where email in ('test-student@mathin.local','test-parent@mathin.local') loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    begin
      perform public.list_student_records_page('awaiting_first_contact','all','','work',1,20,'{"version":2,"filters":{}}','zh','{}');
      raise exception 'NON_STAFF_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims','{}',true);
end;
$access_checks$;
