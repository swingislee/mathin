-- 空白行与原档案详情采用同一组基本资料；待确认身份也保留填写内容。
alter table public.leads add column manual_profile jsonb not null default '{}'::jsonb
  check(jsonb_typeof(manual_profile)='object'
    and manual_profile-array['parentPhone','parentName','school','wechat']='{}'::jsonb
    and coalesce(jsonb_typeof(manual_profile->'parentPhone'),'string')='string'
    and coalesce(jsonb_typeof(manual_profile->'parentName'),'string')='string'
    and coalesce(jsonb_typeof(manual_profile->'school'),'string')='string'
    and coalesce(jsonb_typeof(manual_profile->'wechat'),'string')='string'
    and length(coalesce(manual_profile->>'parentPhone',''))<=40
    and length(coalesce(manual_profile->>'parentName',''))<=100
    and length(coalesce(manual_profile->>'school',''))<=100
    and length(coalesce(manual_profile->>'wechat',''))<=80);

do $details$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.add_school_support_work_item(uuid,jsonb)'::regprocedure);
  anchor:=$old$    if create_student then
      student_id:=public.create_student(name,grade,'','','Manual entry','',''||phone,'');
    end if;$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_CREATE_CONTRACT_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$    if length(coalesce(person->>'parentPhone',''))>40 or length(coalesce(person->>'parentName',''))>100
      or length(coalesce(person->>'school',''))>100 or length(coalesce(person->>'wechat',''))>80
      or length(coalesce(person->>'remark',''))>2000 then raise exception 'VALIDATION'; end if;
    if nullif(public.normalize_school_ops_phone(person->>'parentPhone'),'') is not null
      and not coalesce((p_payload->>'acknowledgeDuplicate')::boolean,false) and (
        exists(select 1 from public.students candidate where candidate.deleted_at is null
          and public.normalize_lead_name(candidate.name)=public.normalize_lead_name(name)
          and public.normalize_school_ops_phone(person->>'parentPhone') in(public.normalize_school_ops_phone(candidate.phone),public.normalize_school_ops_phone(candidate.parent_phone)))
        or exists(select 1 from public.leads candidate where candidate.normalized_name=public.normalize_lead_name(name)
          and public.normalize_school_ops_phone(person->>'parentPhone') in(candidate.phone_normalized,public.normalize_school_ops_phone(candidate.manual_profile->>'parentPhone')))
      ) then raise exception 'POSSIBLE_DUPLICATE'; end if;
    if create_student then
      student_id:=public.create_student(p_name=>name,p_grade=>grade,p_phone=>phone,p_region=>'',p_source=>'Manual entry',
        p_parent_name=>coalesce(person->>'parentName',''),p_parent_phone=>coalesce(nullif(person->>'parentPhone',''),phone),p_remark=>coalesce(person->>'remark',''));
      update public.students set school=coalesce(person->>'school',''),wechat=coalesce(person->>'wechat','') where id=student_id;
    end if;$new$);
  anchor:=$old$      returning id into lead_id;
  end if;
  if lead_id is null$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_INTAKE_CONTRACT_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$      returning id into lead_id;
    update public.leads set note=coalesce(person->>'remark',''),manual_profile=jsonb_build_object(
      'parentPhone',coalesce(person->>'parentPhone',''),'parentName',coalesce(person->>'parentName',''),
      'school',coalesce(person->>'school',''),'wechat',coalesce(person->>'wechat','')) where id=lead_id;
  end if;
  if lead_id is null$new$);
  execute definition;

  definition:=pg_get_functiondef('public.read_school_support_profile(uuid,uuid)'::regprocedure);
  anchor:=$old$    version:=md5(to_jsonb(l)::text);$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_READ_PROFILE_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$    if l.manual_entry then
      fields:=fields||jsonb_build_object('parentPhone',coalesce(l.manual_profile->>'parentPhone',''),
        'parentName',coalesce(l.manual_profile->>'parentName',''),'school',coalesce(l.manual_profile->>'school',''),
        'wechat',coalesce(l.manual_profile->>'wechat',''));
    end if;
    version:=md5(to_jsonb(l)::text);$new$);

  definition:=pg_get_functiondef('public.update_school_support_profile(uuid,uuid,text,jsonb)'::regprocedure);
  anchor:=$old$grade_hint=grade,note=remark,manual_entry=manual_entry or phone='' or name='',updated_at=clock_timestamp() where id=p_lead_id;$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_UPDATE_PROFILE_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$grade_hint=grade,note=remark,
      manual_profile=case when l.manual_entry then jsonb_build_object('parentPhone',parent_phone,
        'parentName',coalesce(p_values->>'parentName',''),'school',coalesce(p_values->>'school',''),
        'wechat',coalesce(p_values->>'wechat','')) else manual_profile end,
      manual_entry=manual_entry or phone='' or name='',updated_at=clock_timestamp() where id=p_lead_id;$new$);

  definition:=pg_get_functiondef('public.confirm_school_support_identity(uuid,text)'::regprocedure);
  anchor:=$old$  target_student:=public.create_student(l.provisional_student_name,l.grade_hint,'','','','',''||l.phone,'');$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_CONFIRM_PROFILE_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$  target_student:=public.create_student(p_name=>l.provisional_student_name,p_grade=>l.grade_hint,p_phone=>l.phone,
    p_region=>'',p_source=>'Manual entry',p_parent_name=>coalesce(l.manual_profile->>'parentName',''),
    p_parent_phone=>coalesce(nullif(l.manual_profile->>'parentPhone',''),l.phone),p_remark=>l.note);
  update public.students set school=coalesce(l.manual_profile->>'school',''),wechat=coalesce(l.manual_profile->>'wechat','') where id=target_student;$new$);

  definition:=pg_get_functiondef('public.search_school_support_subjects(text)'::regprocedure);
  anchor:=$old$l.phone,'','','',l.owner_id$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_SEARCH_PROFILE_CONTRACT_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$l.phone,coalesce(l.manual_profile->>'parentPhone',''),
      coalesce(l.manual_profile->>'parentName',''),coalesce(l.manual_profile->>'school',''),l.owner_id$new$);
  definition:=replace(definition,$old$phone<>'' and l.phone_normalized=phone, l.normalized_name$old$,
    $new$phone<>'' and phone in(l.phone_normalized,public.normalize_school_ops_phone(l.manual_profile->>'parentPhone')), l.normalized_name$new$);
  definition:=replace(definition,$old$concat_ws(' ',l.provisional_student_name,l.phone)$old$,
    $new$concat_ws(' ',l.provisional_student_name,l.phone,l.manual_profile->>'parentPhone',l.manual_profile->>'parentName',l.manual_profile->>'wechat')$new$);
  definition:=replace(definition,$old$or phone<>'' and l.phone_normalized=phone)$old$,
    $new$or phone<>'' and phone in(l.phone_normalized,public.normalize_school_ops_phone(l.manual_profile->>'parentPhone')))$new$);
  execute definition;
end $details$;

notify pgrst,'reload schema';
