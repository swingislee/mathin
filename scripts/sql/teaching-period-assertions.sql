set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('teaching.test.teacher'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('teaching.test.teacher'),'role','authenticated','aal','aal2')::text,true);
do $$
declare narrow jsonb; wide jsonb;
begin
  narrow:=public.get_teaching_class_overview('2040-01-01Z','2040-02-01Z','mine');
  wide:=public.get_teaching_class_overview('2039-09-01Z','2040-02-01Z','mine');
  if wide<>narrow or jsonb_array_length(wide->'workbench'->'sessions')<>1 then raise exception 'TERM_SCOPE_OR_AGGREGATE_MISMATCH'; end if;
  begin perform public.get_teaching_workbench('2039-01-01Z','2041-01-01Z','mine');raise exception 'RANGE_ACCEPTED';exception when others then if sqlerrm<>'VALIDATION' then raise;end if;end;
  begin perform public.get_teaching_workbench('2040-01-01Z','2040-01-01Z','mine');raise exception 'EMPTY_RANGE_ACCEPTED';exception when others then if sqlerrm<>'VALIDATION' then raise;end if;end;
  begin perform public.get_teaching_workbench('2039-09-01Z','2040-02-01Z','team');raise exception 'TEAM_ACCEPTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('teaching.test.supervisor'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('teaching.test.supervisor'),'role','authenticated','aal','aal2')::text,true);
do $$ begin
  if jsonb_array_length(public.get_teaching_workbench('2039-09-01Z','2040-02-01Z','team')->'sessions')<>3 then raise exception 'MANAGER_SCOPE_MISMATCH';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('teaching.test.student'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('teaching.test.student'),'role','authenticated')::text,true);
do $$ begin
  begin perform public.get_teaching_workbench('2039-09-01Z','2040-02-01Z','mine');raise exception 'STUDENT_ACCEPTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
