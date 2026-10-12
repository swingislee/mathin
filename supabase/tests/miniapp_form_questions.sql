-- Synthetic forms and pending intakes only; the identified development runner rolls back this transaction.
do $$
declare actor uuid; outsider uuid; scene text; state jsonb; config jsonb; published jsonb; question jsonb;
  answers jsonb; receipt jsonb; snapshot jsonb; lease uuid:=gen_random_uuid(); version integer;
begin
  select id into actor from profiles where purpose='test' and id=(select id from auth.users where email='test-admin@mathin.local');
  select id into outsider from profiles where purpose='test' and id=(select id from auth.users where email='test-parent@mathin.local');
  if actor is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  if has_table_privilege('anon','public.miniapp_family_form_drafts','select') or has_table_privilege('authenticated','public.miniapp_family_form_history','select,insert,update,delete')
    or has_function_privilege('anon','public.save_miniapp_family_form_draft(text,integer,integer,jsonb,boolean)','execute') then raise exception 'PRIVATE_FORM_ACCESS'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  scene:=public.miniapp_manage_promotion(null,'Question snapshot check',true);
  state:=public.miniapp_family_form_workbench(scene); version:=(state->>'version')::integer;
  question:='{"id":"q_visit","type":"select","label":{"zh":"参加目的","en":"Purpose"},"required":true,"options":[{"id":"try","label":{"zh":"体验","en":"Try"}},{"id":"learn","label":{"zh":"学习","en":"Learn"}}]}'::jsonb;
  config:=state-'slug'-'version'-'editorRevision'-'pending'-'history';
  config:=jsonb_set(config,'{fields}',(select jsonb_agg(jsonb_set(f,'{mode}','"optional"')) from jsonb_array_elements(config->'fields') f));
  config:=config||jsonb_build_object('questions',jsonb_build_array(question));
  state:=public.save_miniapp_family_form_draft(scene,version,0,config,false);
  if state->>'pending'<>'true' or public.miniapp_read_family_form(scene)->'questions'<>'[]'::jsonb then raise exception 'PRIVATE_DRAFT_PUBLISHED'; end if;
  begin perform public.save_miniapp_family_form_draft(scene,version,0,config,true); raise exception 'STALE_EDITOR_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise; end if; end;
  state:=public.save_miniapp_family_form_draft(scene,version,1,config,true);
  if state->>'pending'<>'false' or jsonb_array_length(state->'history')<>2 then raise exception 'FORM_NOT_PUBLISHED'; end if;
  published:=public.miniapp_read_family_form(scene);
  answers:=jsonb_build_object('parentName','Fixture contact','relation','guardian','childName','Fixture participant','grade',3,'gender','','school','','interests','[]'::jsonb,
    'location',jsonb_build_object('status','declined'),'consent',true,'formVersion',published->'version',
    'privacyVersion',(select p.version from consent_policies p where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select p.version from consent_policies p where policy_kind='children_privacy' and required));
  if exists(select 1 from miniapp_intakes where verified_phone='+8615500094931') then raise exception 'FIXTURE_PHONE_ALREADY_USED'; end if;
  begin perform public.miniapp_prepare_family('fixture:questions:'||scene,'+8615500094931','15500094931',scene,answers,lease); raise exception 'REQUIRED_QUESTION_SKIPPED';
    exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin perform mathin_internal.validate_miniapp_answers(config->'questions','{"q_visit":"unknown"}'); raise exception 'UNKNOWN_OPTION_ALLOWED';
    exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin perform mathin_internal.validate_miniapp_answers(config->'questions','{"q_visit":["try"],"unknown":"value"}'); raise exception 'UNKNOWN_FIELD_ALLOWED';
    exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  answers:=answers||'{"extraAnswers":{"q_visit":"try"}}'::jsonb;
  receipt:=public.miniapp_prepare_family('fixture:questions:'||scene,'+8615500094931','15500094931',scene,answers,lease);
  select form_snapshot into snapshot from miniapp_intakes where id=(receipt->>'id')::uuid;
  if snapshot#>>'{questions,0,label,zh}'<>'参加目的' or (receipt#>>'{family,extraAnswers,q_visit}')<>'try' then raise exception 'ANSWER_SNAPSHOT_MISSING'; end if;
  config:=jsonb_set(config,'{questions,0,label,zh}','"更新的问题"');
  state:=public.save_miniapp_family_form_draft(scene,(state->>'version')::integer,(state->>'editorRevision')::integer,config,true);
  if (select form_snapshot from miniapp_intakes where id=(receipt->>'id')::uuid)<>snapshot then raise exception 'OLD_SNAPSHOT_REWRITTEN'; end if;
  state:=public.restore_miniapp_family_form(scene,version,(state->>'version')::integer,(state->>'editorRevision')::integer);
  if state->>'pending'<>'true' or public.miniapp_read_family_form(scene)#>>'{questions,0,label,zh}'<>'更新的问题' then raise exception 'RESTORE_CHANGED_PUBLICATION'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin perform public.miniapp_family_form_workbench(scene); raise exception 'OUTSIDER_READ_DRAFT';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin perform public.restore_miniapp_family_form(scene,version,(state->>'version')::integer,(state->>'editorRevision')::integer); raise exception 'OUTSIDER_RESTORE';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
end $$;
