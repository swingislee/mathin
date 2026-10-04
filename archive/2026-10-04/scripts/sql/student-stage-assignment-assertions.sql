-- 固定开发身份，混合分配与失败回滚都限定在此保存点内。
savepoint student_stage_assignment_contract;
do $test$
#variable_conflict use_variable
declare actor uuid; outsider uuid; sid uuid:=gen_random_uuid(); linked uuid:=gen_random_uuid();
  free_lead uuid:=gen_random_uuid(); historical uuid:=gen_random_uuid(); payload jsonb; result jsonb; before_stage text; error_text text;
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  select id into outsider from auth.users where email='test-student@mathin.local';
  if actor is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.students(id,name,bind_code,source,created_by)
    values(sid,'assignment-contract-'||sid,public.generate_student_bind_code(),'Lead first contact',actor);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,student_id,owner_id,created_by,identity_confirmed_by,identity_confirmed_at)
    values(linked,'assignment-contract-linked','assignment-contract-linked','600000009801','600000009801','uncontacted',sid,null,actor,actor,now()),
      (free_lead,'assignment-contract-free','assignment-contract-free','600000009802','600000009802','uncontacted',null,null,actor,null,null),
      (historical,'assignment-contract-history','assignment-contract-history','600000009803','600000009803','converted',sid,outsider,actor,actor,now());
  before_stage:=public.read_student_stage_subject(sid,linked)->>'stage';
  payload:=jsonb_build_array(jsonb_build_object('studentId',sid,'leadId',linked,'expectedOwnerId',null),
    jsonb_build_object('studentId',null,'leadId',free_lead,'expectedOwnerId',null));

  begin
    perform public.assign_student_stage_subjects(payload,outsider);
    raise exception 'INVALID_TARGET_ACCEPTED';
  exception when others then get stacked diagnostics error_text=message_text; if error_text<>'TARGET_CANNOT_FOLLOW_UP' then raise; end if; end;
  begin
    perform public.assign_student_stage_subjects(payload||jsonb_build_array(payload->0),actor);
    raise exception 'DUPLICATE_ACCEPTED';
  exception when others then get stacked diagnostics error_text=message_text; if error_text<>'INVALID_INPUT' then raise; end if; end;
  begin
    perform public.assign_student_stage_subjects(jsonb_set(payload,'{1,expectedOwnerId}',to_jsonb(actor)),actor);
    raise exception 'STALE_OWNER_ACCEPTED';
  exception when others then get stacked diagnostics error_text=message_text; if error_text<>'ASSIGNMENT_CONFLICT' then raise; end if; end;
  update public.leads set status='invalid' where id=free_lead;
  begin
    perform public.assign_student_stage_subjects(payload,actor);
    raise exception 'CLOSED_LEAD_ACCEPTED';
  exception when others then get stacked diagnostics error_text=message_text; if error_text<>'LEAD_SCOPE_MISMATCH' then raise; end if; end;
  if (select assigned_to from public.students where id=sid) is not null
    or exists(select 1 from public.leads where id in (linked,free_lead) and owner_id is not null) then raise exception 'FAILED_BATCH_PARTIALLY_ASSIGNED'; end if;
  update public.leads set status='uncontacted' where id=free_lead;

  result:=public.assign_student_stage_subjects(payload,actor);
  if jsonb_array_length(result)<>2 or exists(select 1 from jsonb_array_elements(result) item where item->'subject'->>'ownerId'<>actor::text)
    or (select assigned_to from public.students where id=sid) is distinct from actor
    or exists(select 1 from public.leads where id in (linked,free_lead) and owner_id is distinct from actor) then raise exception 'MIXED_ASSIGNMENT_FAILED'; end if;
  if public.read_student_stage_subject(sid,linked)->>'stage'<>before_stage
    or (select owner_id from public.leads where id=historical) is distinct from outsider then raise exception 'ASSIGNMENT_CHANGED_STAGE_OR_HISTORY'; end if;
  if not (public.read_student_stage_subject(sid,linked)->>'canContact')::boolean then raise exception 'NEW_OWNER_CANNOT_CONTACT'; end if;
  payload:=jsonb_set(jsonb_set(payload,'{0,expectedOwnerId}',to_jsonb(actor)),'{1,expectedOwnerId}',to_jsonb(actor));
  perform public.assign_student_stage_subjects(payload,actor);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin
    perform public.assign_student_stage_subjects(payload,actor);
    raise exception 'STUDENT_ASSIGNED';
  exception when others then get stacked diagnostics error_text=message_text; if error_text<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.assign_student_stage_subjects(payload,actor);
    raise exception 'ANONYMOUS_ASSIGNED';
  exception when others then get stacked diagnostics error_text=message_text; if error_text<>'UNAUTHENTICATED' then raise; end if; end;
  if has_function_privilege('anon','public.assign_student_stage_subjects(jsonb,uuid)','execute') then raise exception 'ANONYMOUS_EXECUTE_GRANTED'; end if;
end;
$test$;
rollback to savepoint student_stage_assignment_contract;
