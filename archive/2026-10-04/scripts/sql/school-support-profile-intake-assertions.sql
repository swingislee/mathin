savepoint support_profile_details;
do $test$
#variable_conflict use_variable
declare actor uuid:=current_setting('manual_entry_test.admin')::uuid;
  request uuid:=gen_random_uuid(); payload jsonb; item jsonb; delayed jsonb; profile jsonb; result jsonb;
  person jsonb; err text; saved_count bigint;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  person:=jsonb_build_object('name','Detailed student '||request,'phone','600000009511','grade',3,'parentPhone','600000009512',
    'parentName','Detailed parent','school','Detailed school','wechat','detail-'||request,'remark','Original profile note',
    'createStudent',true,'identityPending',false);
  payload:=jsonb_build_object('workspace','students','subject',null,'newPerson',person,'work',jsonb_build_object('note','Current work'),'acknowledgeDuplicate',false);
  item:=public.add_school_support_work_item(request,payload);
  profile:=public.read_school_support_profile((item->>'studentId')::uuid,null);
  if profile->'values'->>'parentName'<>'Detailed parent' or profile->'values'->>'parentPhone'<>'600000009512'
    or profile->'values'->>'school'<>'Detailed school' or profile->'values'->>'wechat'<>'detail-'||request
    or profile->'values'->>'remark'<>'Original profile note' then raise exception 'CONFIRMED_PROFILE_FIELDS_LOST'; end if;
  if public.add_school_support_work_item(request,payload) is distinct from item then raise exception 'PROFILE_INTAKE_RETRY_CHANGED'; end if;
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload||jsonb_build_object('newPerson',person||'{"phone":""}'));
    raise exception 'PARENT_PHONE_DUPLICATE_IGNORED'; exception when others then get stacked diagnostics err=message_text; if err<>'POSSIBLE_DUPLICATE' then raise; end if; end;
  person:=person||jsonb_build_object('name','Pending student '||request,'phone','600000009513','parentPhone','600000009514',
    'wechat','pending-'||request,'createStudent',false,'identityPending',true);
  payload:=payload||jsonb_build_object('newPerson',person);
  delayed:=public.add_school_support_work_item(gen_random_uuid(),payload);
  profile:=public.read_school_support_profile(null,(delayed->>'leadId')::uuid);
  if profile->'studentId'<>'null'::jsonb or profile->'values'->>'school'<>'Detailed school' or profile->'values'->>'remark'<>'Original profile note'
    or profile->'values'->>'parentPhone'<>'600000009514' then raise exception 'PENDING_PROFILE_FIELDS_LOST'; end if;
  if not exists(select 1 from jsonb_array_elements(public.search_school_support_subjects('pending-'||request)) r where r->>'leadId'=delayed->>'leadId'
    and r->>'parentName'='Detailed parent' and r->>'school'='Detailed school') then raise exception 'PENDING_WECHAT_MATCH_MISSING'; end if;
  if not exists(select 1 from jsonb_array_elements(public.search_school_support_subjects('600000009514')) r where r->>'leadId'=delayed->>'leadId') then raise exception 'PENDING_PARENT_PHONE_MATCH_MISSING'; end if;
  result:=public.update_school_support_profile(null,(delayed->>'leadId')::uuid,profile->>'version',profile->'values'||'{"school":"Updated school"}');
  if result->'values'->>'school'<>'Updated school' or jsonb_array_length(result->'changes')<>1 then raise exception 'PENDING_PROFILE_REVISION_LOST'; end if;
  result:=public.confirm_school_support_identity((delayed->>'leadId')::uuid,result->>'version');
  if result->'studentId'='null'::jsonb or result->'values'->>'school'<>'Updated school' or result->'values'->>'parentPhone'<>'600000009514'
    or result->'values'->>'wechat'<>'pending-'||request or result->'values'->>'remark'<>'Original profile note' then raise exception 'DEFERRED_PROFILE_FIELDS_LOST'; end if;
  execute 'reset role';
  select count(*) into saved_count from public.school_support_work_items;
  execute 'set local role authenticated';
  payload:=payload||jsonb_build_object('newPerson',person||jsonb_build_object('name','Invalid '||request,'phone','600000009515','school',repeat('x',101)));
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'OVERSIZED_PROFILE_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'VALIDATION' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from public.school_support_work_items)<>saved_count then raise exception 'INVALID_PROFILE_PARTIAL_WRITE'; end if;
end $test$;
rollback to savepoint support_profile_details;
release savepoint support_profile_details;
