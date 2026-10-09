-- Run in the verified local transaction; all fixture accounts and registrations roll back.
do $$
declare admin_id uuid; parent_id uuid; first_scene text; other_scene text; config jsonb; form jsonb; saved jsonb;
  family jsonb; children jsonb; reservation jsonb; uid uuid; intake uuid; lease uuid:=gen_random_uuid();
  result jsonb; first_student uuid; second_student uuid; details jsonb; verified_time timestamptz; dash jsonb;
  blank_family jsonb; blank_reservation jsonb; blank_uid uuid; blank_intake uuid; blank_lease uuid:=gen_random_uuid();
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into parent_id from auth.users where email='test-parent-unbound@mathin.local';
  if admin_id is null or parent_id is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  if has_function_privilege('anon','public.miniapp_read_family_form(text)','execute')
    or has_function_privilege('anon','public.miniapp_save_family_form(text,integer,jsonb)','execute')
    or has_function_privilege('authenticated','public.miniapp_attach_family_child(uuid,jsonb,text,text,boolean)','execute')
    or has_function_privilege('authenticated','public.miniapp_record_promotion_touch(text,uuid,jsonb)','execute') then raise exception 'PRIVATE_FUNCTION_EXPOSED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated')::text,true);
  begin perform public.miniapp_read_family_form(null); raise exception 'PARENT_CAN_READ_FORM_SETTINGS';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin perform public.miniapp_save_family_form(null,1,'{}'); raise exception 'PARENT_CAN_EDIT_FORM_SETTINGS';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  first_scene:=public.miniapp_manage_promotion(null,'事务验证阅读场景',true);
  other_scene:=public.miniapp_manage_promotion(null,'事务验证独立场景',true);
  form:=public.miniapp_read_family_form(first_scene);
  config:=form-'slug'-'version';
  config:=jsonb_set(config,'{fields}',(select jsonb_agg(case when value->>'id'='interests'
    then jsonb_set(value,'{options}','[{"id":"reading","label":{"zh":"阅读","en":"Reading"}}]')
    when value->>'id' in ('childName','grade','relation') then jsonb_set(value,'{mode}','"optional"') else value end)
    from jsonb_array_elements(config->'fields')));
  saved:=public.miniapp_save_family_form(first_scene,(form->>'version')::integer,config);
  if saved->'fields'<>config->'fields' or (saved->>'version')::integer<=(form->>'version')::integer then raise exception 'CONFIG_NOT_SAVED'; end if;
  if public.miniapp_read_family_form(other_scene)->'fields'=saved->'fields' then raise exception 'PROMOTION_CONFIG_CROSSED'; end if;
  begin perform public.miniapp_save_family_form(first_scene,(form->>'version')::integer,config); raise exception 'STALE_CONFIG_OVERWROTE';
    exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise; end if; end;

  children:='[{"key":"child-1","childName":"小太阳","grade":3,"school":"自填学校","gender":"","interests":["reading"]},
    {"key":"child-2","childName":"小月亮","grade":5,"school":"","gender":"","interests":["reading"]}]';
  family:=jsonb_build_object('parentName','家长称呼','relation','mother','childName','小太阳','grade',3,'school','自填学校','gender','',
    'interests',jsonb_build_array('reading'),'children',children,'formVersion',saved->'version',
    'location',jsonb_build_object('status','granted','latitude',30,'longitude',120,'accuracy',10,
      'enteredAt','2026-10-09T02:00:00.000Z','capturedAt','2026-10-09T02:00:02.000Z'),
    'privacyVersion',(select version from public.consent_policies where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select version from public.consent_policies where policy_kind='children_privacy' and required),'consent',true);
  begin perform public.miniapp_prepare_family('fixture:form-family','+8615500090911','15500090911',first_scene,
    jsonb_set(family,'{children,0,interests}','["math"]'),lease); raise exception 'OTHER_PROMOTION_OPTIONS_ACCEPTED';
    exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin perform public.miniapp_prepare_family('fixture:form-family','+8615500090911','15500090911',first_scene,
    jsonb_set(family,'{formVersion}',form->'version'),lease); raise exception 'STALE_FORM_ACCEPTED';
    exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise; end if; end;
  reservation:=public.miniapp_prepare_family('fixture:form-family','+8615500090911','15500090911',first_scene,family,lease);
  uid:=(reservation->>'userId')::uuid; intake:=(reservation->>'id')::uuid;
  insert into auth.users(id,instance_id,aud,role,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','8615500090911',now(),
      jsonb_build_object('miniapp_registration_id',intake,'provider','phone','providers',jsonb_build_array('phone')),'{}',now(),now());
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),uid,'custom:wechat','fixture:form-family','{"sub":"fixture:form-family"}');
  result:=public.miniapp_complete_family(intake,'fixture:form-family',lease);
  if jsonb_array_length(result->'participantIds')<>2 or (select count(*) from public.student_guardians where guardian_id=uid)<>2 then raise exception 'SIBLINGS_NOT_IN_ONE_FAMILY'; end if;
  select (child_participants->>'child-1')::uuid,(child_participants->>'child-2')::uuid into first_student,second_student from public.miniapp_intakes where id=intake;
  if first_student=second_student or (select count(distinct family_id) from public.family_students where student_id in (first_student,second_student))<>1 then raise exception 'FAMILY_LINK_INVALID'; end if;
  if (select answers#>>'{children,0,childName}' from public.miniapp_intakes where id=intake)<>'小太阳' then raise exception 'SELF_REPORTED_NAME_LOST'; end if;
  if (select verified_at from public.miniapp_intakes where id=intake) is not null then raise exception 'SELF_REPORTED_NAME_MARKED_VERIFIED'; end if;

  details:=jsonb_build_object('parentName','沟通核实家长','children',jsonb_set(children,'{0,childName}','"沟通核实孩子"'));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated')::text,true);
  begin perform public.miniapp_verify_family(intake,null,details); raise exception 'PARENT_CAN_VERIFY_STAFF_DATA';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform public.miniapp_verify_family(intake,null,details);
  if (select name from public.students where id=first_student)<>'沟通核实孩子'
    or (select answers#>>'{children,0,childName}' from public.miniapp_intakes where id=intake)<>'小太阳'
    or (select child_participants->>'child-1' from public.miniapp_intakes where id=intake)<>first_student::text then raise exception 'VERIFICATION_REPLACED_IDENTITY_OR_SOURCE'; end if;
  begin perform public.miniapp_verify_family(intake,null,details); raise exception 'STALE_VERIFICATION_OVERWROTE';
    exception when raise_exception then if sqlerrm<>'CONFLICT' then raise; end if; end;
  select verified_at into verified_time from public.miniapp_intakes where id=intake;
  details:=jsonb_set(details,'{children}',details->'children'||'[{"key":"staff-child-3","childName":"后来了解到的孩子","grade":1,"school":"","gender":"","interests":[]}]');
  perform public.miniapp_verify_family(intake,verified_time,details);
  if (select count(*) from public.student_guardians where guardian_id=uid)<>3 then raise exception 'LATER_CHILD_NOT_ATTACHED'; end if;
  if (select jsonb_array_length(answers->'children') from public.miniapp_intakes where id=intake)<>2 then raise exception 'LATER_CHILD_REWROTE_ORIGINAL_FORM'; end if;
  if exists(select 1 from public.student_guardians where guardian_id=uid and scope<>array['activities']) then raise exception 'LATER_CHILD_GAINED_EXTRA_ACCESS'; end if;
  perform public.miniapp_record_promotion_touch(other_scene,uid,'{"status":"granted","latitude":31,"longitude":121,"accuracy":20,"enteredAt":"2026-10-09T03:00:00.000Z","capturedAt":"2026-10-09T03:00:01.000Z"}');
  dash:=public.miniapp_promotion_dashboard(null,1);
  if not exists(select 1 from jsonb_array_elements(dash->'promotions') value where value->>'scene'=first_scene and (value->>'newCount')::integer=1)
    or not exists(select 1 from jsonb_array_elements(dash->'promotions') value where value->>'scene'=other_scene and (value->>'newCount')::integer=0 and (value->>'repeatCount')::integer=1) then raise exception 'CHILDREN_INFLATED_FAMILY_ACQUISITION'; end if;
  if not exists(select 1 from jsonb_array_elements(dash->'records') value where value->>'state'='registered' and value->>'registrationId'=intake::text and value#>>'{location,latitude}'='31')
    or (select answers#>>'{location,latitude}' from public.miniapp_intakes where id=intake)<>'30' then raise exception 'REPEAT_SCAN_REUSED_OLD_LOCATION'; end if;

  blank_family:=family||'{"parentName":"","relation":"","childName":"","grade":null,"school":"","children":[{"key":"child-1","childName":"","grade":null,"school":"","gender":"","interests":["reading"]}]}';
  blank_reservation:=public.miniapp_prepare_family('fixture:blank-family','+8615500090912','15500090912',first_scene,blank_family,blank_lease);
  blank_uid:=(blank_reservation->>'userId')::uuid; blank_intake:=(blank_reservation->>'id')::uuid;
  insert into auth.users(id,instance_id,aud,role,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(blank_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','8615500090912',now(),
      jsonb_build_object('miniapp_registration_id',blank_intake,'provider','phone','providers',jsonb_build_array('phone')),'{}',now(),now());
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),blank_uid,'custom:wechat','fixture:blank-family','{"sub":"fixture:blank-family"}');
  result:=public.miniapp_complete_family(blank_intake,'fixture:blank-family',blank_lease);
  if result->>'studentId' is not null or exists(select 1 from public.student_guardians where guardian_id=blank_uid) then raise exception 'BLANK_NAME_CREATED_FAKE_STUDENT'; end if;
  perform public.miniapp_verify_family(blank_intake,null,'{"parentName":"后续核实家长","children":[{"key":"child-1","childName":"后续核实孩子","grade":3,"school":"","gender":"","interests":[]}]}');
  if (select count(*) from public.student_guardians where guardian_id=blank_uid)<>1 then raise exception 'OPTIONAL_NAME_CANNOT_BE_COMPLETED_LATER'; end if;
end $$;
