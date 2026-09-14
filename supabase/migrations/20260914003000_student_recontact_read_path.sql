-- 再联系与旧摘要入口复用已计算的账号权限，逐条协作范围沿用原函数。
do $recontact_read_path$
declare item record; definition text; body text; original_body text; access_body text;
  anchor text := 'view_followup and public.can_view_school_lead(l.id,actor)';
  replacement text := 'view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else public.can_view_school_lead(l.id,actor) end';
  latest_anchor text := $latest$  ), latest as (
    select distinct on(s.key) s.key,c.outcome,c.note,c.occurred_at from subjects s join contacts c
      on c.lead_id=s.lead_id or s.student_id is not null and c.student_id=s.student_id
      where c.outcome is not null order by s.key,c.occurred_at desc nulls last,c.order_at desc nulls last,c.id
$latest$;
  latest_replacement text := $latest$  ), contact_matches as (
    select s.key,c.id,c.outcome,c.note,c.occurred_at,c.order_at from subjects s join contacts c on c.lead_id=s.lead_id where c.outcome is not null
    union all
    select s.key,c.id,c.outcome,c.note,c.occurred_at,c.order_at from subjects s join contacts c on c.student_id=s.student_id where s.student_id is not null and c.outcome is not null
  ), latest as (
    select distinct on(key) key,outcome,note,occurred_at from contact_matches
      order by key,occurred_at desc nulls last,order_at desc nulls last,id
$latest$;
begin
  select regexp_replace(prosrc,'\s','','g') into strict access_body from pg_proc
    where oid='public.can_view_school_lead(uuid,uuid)'::regprocedure;
  if access_body <> 'selectpublic.is_staff(p_uid)andexists(select1frompublic.leadslwherel.id=p_lead_idand((public.has_perm(p_uid,''followup.view'')and(l.owner_idisnullorpublic.can_edit_school_lead(l.id,p_uid)orpublic.school_subject_in_my_groups(l.student_id,l.id,p_uid)))orl.created_by=p_uidandpublic.has_perm(p_uid,''student.import'')));' then
    raise exception 'UNRECOGNIZED_RECONTACT_LEAD_VIEW_FUNCTION';
  end if;
  select regexp_replace(prosrc,'\s','','g') into strict access_body from pg_proc
    where oid='public.can_edit_school_lead(uuid,uuid)'::regprocedure;
  if access_body <> 'selectpublic.is_staff(p_uid)andexists(select1frompublic.leadslwherel.id=p_lead_idand(l.owner_id=p_uidorpublic.has_perm(p_uid,''student.view.all'')orpublic.school_subject_is_participant(l.student_id,l.id,p_uid)orl.student_idisnotnullandpublic.can_access_student(l.student_id,p_uid)));' then
    raise exception 'UNRECOGNIZED_RECONTACT_LEAD_EDIT_FUNCTION';
  end if;
  for item in select * from (values
    ('public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])','a23d24048ff7d25213d910309e6bd0da',3),
    ('public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])','c540c095f4dd8db629f7d917a6238831',1)
  ) r(signature,expected_hash,calls) loop
    select prosrc,pg_get_functiondef(oid) into strict body,definition from pg_proc where oid=item.signature::regprocedure;
    original_body:=replace(body,replacement,anchor);
    if md5(original_body)<>item.expected_hash or array_length(string_to_array(original_body,anchor),1)<>item.calls+1
      or array_length(string_to_array(definition,body),1)<>2 then raise exception 'RECONTACT_READ_DEFINITION_CHANGED: %',item.signature;end if;
    execute replace(definition,body,replace(original_body,anchor,replacement));
    execute format('alter function %s set plan_cache_mode=force_custom_plan',item.signature);
  end loop;
  -- 同一联系可能匹配两个分支；沿用原 DISTINCT ON 和排序，重复项的事实相同。
  select prosrc,pg_get_functiondef(oid) into strict body,definition from pg_proc
    where oid='public.student_recontact_candidates(text,text,public.business_course_enrollment_subjects[])'::regprocedure;
  original_body:=replace(body,latest_replacement,latest_anchor);
  if md5(original_body)<>'907d850876eea8fbcb7801a9dc2d85b7'
    or array_length(string_to_array(original_body,latest_anchor),1)<>2
    or array_length(string_to_array(definition,body),1)<>2 then raise exception 'RECONTACT_CANDIDATE_DEFINITION_CHANGED';end if;
  execute replace(definition,body,replace(original_body,latest_anchor,latest_replacement));
  alter function public.student_recontact_candidates(text,text,public.business_course_enrollment_subjects[]) set plan_cache_mode=force_custom_plan;
  for item in select * from (values
    ('public.list_student_recontact_summaries(text,text,text)','36f698d6ae191038570ddc691f5fe7bc')
  ) r(signature,expected_hash) loop
    if (select md5(prosrc) from pg_proc where oid=item.signature::regprocedure) is distinct from item.expected_hash then
      raise exception 'RECONTACT_QUERY_DEFINITION_CHANGED: %',item.signature;
    end if;
    execute format('alter function %s set plan_cache_mode=force_custom_plan',item.signature);
  end loop;
end;
$recontact_read_path$;
