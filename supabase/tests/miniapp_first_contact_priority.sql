-- Isolated rollback transaction. Only synthetic intake/lead records are added.
do $$
declare
  actor uuid; scoped_staff uuid; outsider uuid; item integer; lid uuid; intake uuid;
  lead_ids uuid[]:='{}'; label text:='首联队列回滚'||left(gen_random_uuid()::text,8);
  registered_at timestamptz; result jsonb; family jsonb; form public.miniapp_forms%rowtype;
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  select id into scoped_staff from auth.users where email='test-sales@mathin.local';
  select id into outsider from auth.users where email='test-parent-unbound@mathin.local';
  if actor is null or scoped_staff is null or outsider is null
    or public.has_perm(scoped_staff,'student.view.all') then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  select * into strict form from public.miniapp_forms where slug='family-onboarding';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);

  for item in 1..4 loop
    insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
      values(label||item,public.normalize_lead_name(label||item),'1550009143'||item,'1550009143'||item,'uncontacted',actor,actor)
      returning id into lid;
    lead_ids:=array_append(lead_ids,lid);
    registered_at:=case item when 1 then '2026-09-08 02:00:00+00'::timestamptz
      when 2 then '2026-10-01 02:00:00+00'::timestamptz when 3 then '2026-10-09 02:00:00+00'::timestamptz end;
    family:=jsonb_build_object('parentName','回滚家长','relation','guardian','childName',label||item,'grade',3,'school','',
      'gender','','interests','[]'::jsonb,'location',jsonb_build_object('status','unavailable'),'children',
      jsonb_build_array(jsonb_build_object('key','child-1','childName',label||item,'grade',3,'school','','gender','','interests','[]'::jsonb)));
    insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,intake_kind,
      registration_user_id,wechat_subject,verified_phone,local_phone,completed_at,lead_id,child_leads)
      values(gen_random_uuid(),form.slug,form.version,to_jsonb(form),family,case when item<4 then 'family' else 'generic' end,
        gen_random_uuid(),'fixture:first-contact:'||label||item,'+861550009143'||item,'1550009143'||item,registered_at,lid,
        jsonb_build_object('child-1',lid)) returning id into intake;
    if item=4 then
      insert into public.school_source_worklist_entries(logical_key,miniapp_intake_id,lead_id,kind,group_label,subgroup_label,
        group_rank,source_rank,periods,period_defaults)
        values('fixture:first-contact:'||intake,intake,lid,'acquisition','一组','',100,1,
          '{"acquired":"9月"}','{"month":"9月","group":"一组"}');
    end if;
  end loop;

  result:=public.school_communication_page('awaiting_first_contact','all',label);
  if result->>'period'<>'10月' or result->>'group'<>'all' or (result->>'count')::integer<>2
    or result#>>'{rows,0,leadId}'<>lead_ids[3]::text or result#>>'{rows,1,leadId}'<>lead_ids[2]::text then
    raise exception 'NEW_REGISTRATION_HIDDEN_OR_NOT_PRIORITIZED';
  end if;
  result:=public.school_communication_page('awaiting_first_contact','all',label,'','',1,20,'acquired','all');
  if result->>'group'<>'all' or (result->>'count')::integer<>4
    or result#>>'{rows,0,leadId}'<>lead_ids[3]::text then raise exception 'ALL_MONTHS_RESTORED_OLD_GROUP'; end if;
  result:=public.school_communication_page('awaiting_first_contact','all',label,'一组','',1,20,'acquired','9月');
  if (result->>'count')::integer<>1 or result#>>'{rows,0,leadId}'<>lead_ids[4]::text then
    raise exception 'EXPLICIT_FILTER_CHANGED';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',scoped_staff,'role','authenticated')::text,true);
  result:=public.school_communication_page('awaiting_first_contact','all',label,'','',1,20,'acquired','all');
  if (result->>'count')::integer<>0 then raise exception 'OTHER_STAFF_LEADS_EXPOSED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin
    perform public.school_communication_page('awaiting_first_contact','all',label);
    raise exception 'PARENT_READ_FIRST_CONTACT_QUEUE';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform public.record_lead_contact_v4(lead_ids[3],'connected','回滚事务：真实首联后接续原阶段',null,null,null,null,null,null,'{}','{}',null,'',null);
  result:=public.school_communication_page('awaiting_first_contact','all',label,'','',1,20,'acquired','all');
  if (result->>'count')::integer<>3 or exists(select 1 from jsonb_array_elements(result->'rows') row where row->>'leadId'=lead_ids[3]::text)
    or public.read_student_record_subject(null,lead_ids[3])->>'stage'<>'awaiting_assessment' then
    raise exception 'CONTACTED_REGISTRATION_STAYED_IN_FIRST_CONTACT';
  end if;
end $$;
