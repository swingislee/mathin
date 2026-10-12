-- Run in an identified isolated development transaction; caller rolls back every fixture.
do $$
declare actor uuid; outsider uuid; participant uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); application uuid:=gen_random_uuid();
  page jsonb; offer jsonb; receipt uuid; snapshot jsonb; row_json jsonb;
begin
  select id into actor from profiles where purpose='test' and id=(select id from auth.users where email='test-admin@mathin.local');
  select id into outsider from profiles where purpose='test' and id=(select id from auth.users where email='test-parent-unbound@mathin.local');
  if actor is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  if has_function_privilege('authenticated','mathin_internal.participant_apply_registration_base(uuid,uuid,integer,uuid)','execute')
    or has_function_privilege('anon','public.miniapp_registration_answers(uuid)','execute') then raise exception 'PRIVATE_FUNCTION_EXPOSED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  insert into consent_records(actor_user_id,subject_user_id,policy_kind,policy_version,scope,decision,source)
    select account,account,policy_kind,version,'account','granted','registration' from consent_policies cross join unnest(array[actor,outsider]) account where required;
  insert into students(id,name,bind_code,created_by,assigned_to) values(participant,'Question fixture participant',participant::text,actor,actor);
  insert into student_guardians(student_id,guardian_id,relation,scope,is_primary) values(participant,actor,'监护人',array['activities'],true);
  insert into activities(id,kind,title,scheduled_at,capacity,created_by,target_grades)
    values(target,'public_class','Question fixture activity',now()+interval '7 days',20,actor,array[3]::smallint[]);
  perform public.save_parent_registration_publication('activity',target,'Question fixture activity','',now()+interval '6 days',true,0);
  select x into offer from jsonb_array_elements(public.miniapp_participant_activity_catalog()) x where x->>'id'=target::text;
  page:='{"version":1,"layout":"cards","cover":"","blocks":[],"questions":[{"id":"q_purpose","type":"select","label":{"zh":"参加目的","en":"Purpose"},"required":true,"options":[{"id":"learn","label":{"zh":"学习","en":"Learn"}}]}]}'::jsonb;
  perform public.save_miniapp_activity_page('activity',target,page,0,true);
  if public.miniapp_activity_detail(target)->>'pageRevision'<>'1' then raise exception 'PUBLIC_FORM_VERSION_MISSING'; end if;
  begin perform public.miniapp_participant_apply_registration(application,target,(offer->>'revision')::integer,participant); raise exception 'OLD_CLIENT_SKIPPED_QUESTIONS';
    exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise; end if; end;
  begin perform public.miniapp_participant_apply_registration_form(application,target,(offer->>'revision')::integer,participant,1,'{}'); raise exception 'MISSING_REQUIRED_ANSWER';
    exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin perform public.miniapp_participant_apply_registration_form(application,target,(offer->>'revision')::integer,participant,0,'{"q_purpose":"learn"}'); raise exception 'STALE_FORM_ACCEPTED';
    exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise; end if; end;
  receipt:=public.miniapp_participant_apply_registration_form(application,target,(offer->>'revision')::integer,participant,1,'{"q_purpose":"learn"}');
  snapshot:=public.miniapp_registration_answers(receipt);
  if receipt<>application or snapshot#>>'{fields,0,label,zh}'<>'参加目的' or snapshot#>>'{answers,q_purpose}'<>'learn' then raise exception 'SNAPSHOT_MISSING'; end if;
  select x into row_json from jsonb_array_elements(public.miniapp_participant_registration_applications()) x where x->>'id'=application::text;
  if row_json->>'hasAnswers'<>'true' or row_json->>'canCancel'<>'true' or row_json ? 'registrationForm' or row_json ? 'answers' then raise exception 'LIST_PAYLOAD_OR_ACTION'; end if;
  perform public.save_miniapp_activity_page('activity',target,jsonb_set(page,'{questions,0,label,zh}','"新的题目"'),1,true);
  if public.miniapp_registration_answers(receipt)<>snapshot or public.miniapp_participant_apply_registration_form(application,target,(offer->>'revision')::integer,participant,1,'{"q_purpose":"learn"}')<>receipt then raise exception 'SAVED_RETRY_CHANGED'; end if;
  begin perform public.miniapp_participant_apply_registration_form(application,target,(offer->>'revision')::integer,participant,1,'{"q_purpose":"changed"}'); raise exception 'CHANGED_RETRY_ALLOWED';
    exception when raise_exception then if sqlerrm<>'CONFLICT' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin perform public.miniapp_registration_answers(receipt); raise exception 'OUTSIDER_READ_ANSWERS';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin perform public.miniapp_participant_apply_registration_form(gen_random_uuid(),target,(offer->>'revision')::integer,participant,2,'{"q_purpose":"learn"}'); raise exception 'FOREIGN_PARTICIPANT_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  perform public.miniapp_participant_cancel_registration(receipt);
  select x into row_json from jsonb_array_elements(public.miniapp_participant_registration_applications()) x where x->>'id'=receipt::text;
  if row_json->>'canCancel'<>'false' then raise exception 'CANCEL_CAPABILITY_STALE'; end if;
end $$;
