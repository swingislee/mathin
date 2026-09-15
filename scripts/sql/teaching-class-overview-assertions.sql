set local role authenticated;
do $$
declare result jsonb; metric jsonb; contact jsonb; account_key text; account_id text; class_id text;
begin
  foreach account_key in array array['admin', 'supervisor', 'teacher'] loop
    account_id := current_setting('teaching.test.' || account_key);
    perform set_config('request.jwt.claim.sub', account_id, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', account_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    result := public.get_teaching_class_overview('2040-01-01Z','2040-02-01Z',case when account_key = 'teacher' then 'mine' else 'team' end);
    select value into metric from jsonb_array_elements(result->'metrics') where value->>'sessionId' = current_setting('teaching.test.session');
    if metric is null or (metric->>'checkCount')::int <> 1 or (metric->>'ratedCount')::int <> 1
      or (metric->>'reviewCount')::int <> 1 or jsonb_array_length(metric->'attentionStudents') <> 1
      or metric #>> '{latestReview,content}' <> 'Saved unpublished feedback'
      or (metric #>> '{attendance,present}')::int <> 1 or (metric #>> '{attendance,late}')::int <> 1 then raise exception 'OVERVIEW_METRICS_MISMATCH'; end if;
    select value->>'classroomId' into class_id from jsonb_array_elements(result #> '{workbench,sessions}') where value->>'id' = current_setting('teaching.test.session');
    select value into contact from jsonb_array_elements(result->'classContacts') where value->>'classroomId' = class_id;
    if (result->>'canReadContacts')::boolean and ((contact->>'count')::int <> 21 or (contact->>'studentCount')::int <> 1
      or contact #>> '{latest,content}' <> 'Contact 21') then raise exception 'CLASS_CONTACT_DEDUPLICATION_MISMATCH'; end if;
    if account_key = 'teacher' and exists(select 1 from jsonb_array_elements(result->'metrics') where value->>'sessionId' in (current_setting('teaching.test.other'), current_setting('teaching.test.override'))) then raise exception 'OVERVIEW_TEACHER_SCOPE_MISMATCH'; end if;
    result := public.get_teaching_class_overview('2040-01-05Z','2040-02-01Z',case when account_key = 'teacher' then 'mine' else 'team' end);
    select value into contact from jsonb_array_elements(result->'classContacts') where value->>'classroomId' = class_id;
    if (contact->>'count')::int <> 0 or contact->'latest' <> 'null'::jsonb then raise exception 'CONTACT_PERIOD_MISMATCH'; end if;
  end loop;
  begin perform public.get_teaching_class_overview('2040-01-01Z','2040-02-01Z','team'); raise exception 'TEACHER_TEAM_ALLOWED';
    exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', current_setting('teaching.test.outsider'), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('teaching.test.outsider'),'role','authenticated')::text, true);
  begin perform public.get_teaching_class_overview('2040-01-01Z','2040-02-01Z','mine'); raise exception 'STUDENT_OVERVIEW_ALLOWED';
    exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin perform public.get_teaching_class_overview('2040-01-01Z','2040-02-01Z','mine'); raise exception 'ANONYMOUS_OVERVIEW_ALLOWED';
    exception when raise_exception then if sqlerrm <> 'UNAUTHENTICATED' then raise; end if; end;
  if has_function_privilege('anon','public.get_teaching_class_overview(timestamptz,timestamptz,text)','execute') then raise exception 'ANONYMOUS_OVERVIEW_EXECUTE'; end if;
end;
$$;
reset role;
savepoint overview_contact_permission;
delete from public.role_permissions where perm_key = 'followup.view';
set local role authenticated;
do $$
declare result jsonb; account_id text := current_setting('teaching.test.teacher');
begin
  perform set_config('request.jwt.claim.sub', account_id, true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',account_id,'role','authenticated')::text,true);
  result := public.get_teaching_class_overview('2040-01-01Z','2040-02-01Z','mine');
  if (result->>'canReadContacts')::boolean or result::text like '%Contact 21%' then raise exception 'OVERVIEW_CONTACT_PERMISSION_BYPASSED'; end if;
  if jsonb_array_length(result->'metrics') <> 1 then raise exception 'OVERVIEW_RECORD_SCOPE_CHANGED'; end if;
end;
$$;
reset role;
rollback to overview_contact_permission;
