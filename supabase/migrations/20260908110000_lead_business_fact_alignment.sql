-- 学服姓名、联系结果和到场经历共同表达当前情况；来源日期独立于导入时间。
create function public.student_first_contact_detail(p_owner_id uuid,p_owner_name text,p_status text,p_outcome text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case when p_status='invalid' or p_outcome='invalid_number' then 'invalid_number'
    when p_outcome='unreachable' then 'unreachable'
    when p_owner_id is null and nullif(btrim(p_owner_name),'') is null then 'unassigned' else 'not_contacted' end;
$$;
revoke all on function public.student_first_contact_detail(uuid,text,text,text) from public,anon,authenticated,service_role;
alter function public.student_first_contact_detail(uuid,text,text,text) owner to postgres;

-- 原表只给出日期时保留日期精度；缺少年份或无效日期继续留空。
create function public.lead_source_origin_time(p_record jsonb,p_zone text)
returns text language plpgsql stable set search_path=public,pg_temp as $$
declare cell jsonb; value text; parts text[]; day date; moment timestamptz;
begin
  for cell in select c from jsonb_array_elements(coalesce(p_record->'cells','[]'::jsonb)) c
    where c->>'fieldName' in ('提交时间','提交日期','获取时间','获取日期')
    order by case c->>'fieldName' when '提交时间' then 1 when '提交日期' then 2 when '获取时间' then 3 else 4 end loop
    value:=btrim(cell->>'text');
    parts:=regexp_match(value,'^([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})(?:[ T]([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?)?$');
    if parts is null then continue; end if;
    begin
      day:=make_date(parts[1]::integer,parts[2]::integer,parts[3]::integer);
      if parts[4] is null then return day::text; end if;
      if parts[4]::integer>23 or parts[5]::integer>59 or coalesce(parts[6]::integer,0)>59 then continue; end if;
      moment:=make_timestamp(parts[1]::integer,parts[2]::integer,parts[3]::integer,parts[4]::integer,parts[5]::integer,coalesce(parts[6]::integer,0)) at time zone p_zone;
      return to_jsonb(moment)#>>'{}';
    exception when datetime_field_overflow then continue;
    end;
  end loop;
  return null;
end;
$$;
revoke all on function public.lead_source_origin_time(jsonb,text) from public,anon,authenticated,service_role;
alter function public.lead_source_origin_time(jsonb,text) owner to postgres;

create function public.get_lead_origin_events(p_lead_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); zone text:=public.get_organization_timezone_v2(); result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  if p_lead_ids is null or cardinality(p_lead_ids)>500 or array_position(p_lead_ids,null) is not null then raise exception 'VALIDATION'; end if;
  if exists(select 1 from unnest(p_lead_ids) id where not public.can_access_communication_row('lead:'||id,false)) then raise exception 'FORBIDDEN_SCOPE'; end if;
  with leads as materialized (select * from public.leads where id=any(p_lead_ids)),
  source_refs as (
    select l.id as lead_id,h.id,h.record_data from leads l join public.history_import_records h on h.id=l.source_record_id
    union select l.id,h.id,h.record_data from leads l join public.history_import_records h on h.lead_id=l.id
  ), dates as (
    select lead_id,public.lead_source_origin_time(record_data,zone) as value from source_refs
    union all select s.lead_id,to_jsonb(s.submitted_at)#>>'{}' from public.lead_source_records s join leads l on l.id=s.lead_id
  ), origins as (
    select lead_id,(array_agg(value order by case when length(value)=10 then value::date::timestamp at time zone zone else value::timestamptz end))[1] as occurred_at
      from dates where value is not null group by lead_id
  ), named as (
    select distinct on(ref.lead_id) ref.lead_id,btrim(c->>'text') as owner_name from source_refs ref
      cross join lateral jsonb_array_elements(coalesce(ref.record_data->'cells','[]'::jsonb)) c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员','跟进人') and nullif(btrim(c->>'text'),'') is not null
      order by ref.lead_id,case c->>'fieldName' when '报名服务老师' then 1 when '学服老师' then 2 when '确认人员' then 3 else 4 end,ref.id
  ) select coalesce(jsonb_agg(jsonb_build_object('leadId',l.id,'occurredAt',coalesce(o.occurred_at,
      case when l.source_record_id is null and not exists(select 1 from source_refs ref where ref.lead_id=l.id)
        and not exists(select 1 from public.lead_source_records s where s.lead_id=l.id) then to_jsonb(l.created_at)#>>'{}' end),
      'sourceOwnerName',n.owner_name,'imported',l.source_record_id is not null or exists(select 1 from source_refs ref where ref.lead_id=l.id)) order by l.id),'[]'::jsonb)
    into result from leads l left join origins o on o.lead_id=l.id left join named n on n.lead_id=l.id;
  return result;
end;
$$;
revoke all on function public.get_lead_origin_events(uuid[]) from public,anon,authenticated;
grant execute on function public.get_lead_origin_events(uuid[]) to authenticated;
alter function public.get_lead_origin_events(uuid[]) owner to postgres;

-- 保持各入口既有的权限、分页和业务写入合同，只调整事实投影。
do $alignment$
declare definition text; patch record;
begin
  for patch in select * from (values
    ('public.student_list_facts(text,text,text,text)',$before0$), contact_flags as (select key from contacts where outcome in ('connected','declined') group by key),$before0$,$after0$), attendance_flags as (
    select ref.key from registration_refs ref join registrations r on r.id=ref.id
      join public.business_activities a on a.id=r.activity_id where r.status='attended' and a.deleted_at is null group by ref.key
  ), contact_flags as (select key from contacts where outcome in ('connected','declined') group by key union select key from attendance_flags),$after0$),
    ('public.student_list_facts(text,text,text,text)',$before1$case when l.status='invalid' then 'invalid_number'
        when coalesce(st.assigned_to,l.owner_id) is null then 'unassigned' when lc.outcome='unreachable' then 'unreachable' else 'not_contacted' end$before1$,$after1$public.student_first_contact_detail(coalesce(st.assigned_to,l.owner_id),coalesce(p.display_name,b.owner_name),l.status,lc.outcome)$after1$),
    ('public.student_list_facts(text,text,text,text)',$before2$when a.status='attended' or a.assessment_started_at is not null then 'in_progress'$before2$,$after2$when a.assessment_started_at is not null then 'in_progress' when a.status='attended' then 'attended_without_result'$after2$),
    ('public.student_list_facts(text,text,text,text)',$before3$when a.status='booked' then 'booked' else 'not_booked' end$before3$,$after3$when a.status='booked' then 'booked' when exists(select 1 from attendance_flags reached where reached.key=s.key) then 'attended_without_result' else 'not_booked' end$after3$),
    ('public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])',$before4$), enrollment_facts as ($before4$,$after4$), attendance_flags as (
    select ref.key from registration_refs ref join stage_registrations r on r.id=ref.id
      join public.business_activities a on a.id=r.activity_id where r.status='attended' and a.deleted_at is null group by ref.key
  ), source_owner_flags as (
    select distinct ref.key from source_lead_refs ref join public.history_import_records h on h.id=ref.source_record_id
      cross join lateral jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员') and nullif(btrim(c->>'text'),'') is not null
  ), enrollment_facts as ($after4$),
    ('public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])',$before5$when c.key is not null then 'awaiting_assessment'$before5$,$after5$when c.key is not null or reached.key is not null then 'awaiting_assessment'$after5$),
    ('public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])',$before6$left join contact_flags c on c.key=s.key$before6$,$after6$left join contact_flags c on c.key=s.key left join attendance_flags reached on reached.key=s.key$after6$),
    ('public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])',$before7$case when l.status='invalid' then 'invalid_number'
        when coalesce(s.owner_id,l.owner_id) is null then 'unassigned' when c.outcome='unreachable' then 'unreachable' else 'not_contacted' end$before7$,$after7$public.student_first_contact_detail(coalesce(s.owner_id,l.owner_id),case when exists(select 1 from source_owner_flags owned where owned.key=s.key) then 'source' end,l.status,c.outcome)$after7$),
    ('public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])',$before8$when a.status='attended' or a.assessment_started_at is not null then 'in_progress'$before8$,$after8$when a.assessment_started_at is not null then 'in_progress' when a.status='attended' then 'attended_without_result'$after8$),
    ('public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])',$before9$when a.status='booked' then 'booked' else 'not_booked' end$before9$,$after9$when a.status='booked' then 'booked' when exists(select 1 from attendance_flags reached where reached.key=s.key) then 'attended_without_result' else 'not_booked' end$after9$),
    ('public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])',$before10$has_contact boolean;$before10$,$after10$has_contact boolean;
  has_attendance boolean;$after10$),
    ('public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])',$before11$owner_id := coalesce(student.assigned_to,lead.owner_id);$before11$,$after11$select exists(select 1 from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
    where r.id=any(subject_registration_ids) and r.status='attended' and a.deleted_at is null) into has_attendance;
  owner_id := coalesce(student.assigned_to,lead.owner_id);$after11$),
    ('public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])',$before12$when has_contact then 'awaiting_assessment'$before12$,$after12$when has_contact or has_attendance then 'awaiting_assessment'$after12$),
    ('public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])',$before13$when appointment.status='attended' or appointment.assessment_started_at is not null then 'in_progress'$before13$,$after13$when appointment.assessment_started_at is not null then 'in_progress' when appointment.status='attended' then 'attended_without_result'$after13$),
    ('public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])',$before14$when appointment.status='booked' then 'booked' else 'not_booked' end$before14$,$after14$when appointment.status='booked' then 'booked' when has_attendance then 'attended_without_result' else 'not_booked' end$after14$),
    ('public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])',$before15$'stage',stage,'detail',detail$before15$,$after15$'stage',stage,'detail',case when stage='awaiting_first_contact' then public.student_first_contact_detail(owner_id,coalesce(owner_name,background->>'ownerName'),lead.status,contact.effective_outcome) else detail end$after15$),
    ('public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])',$before16$coalesce(r.effective_patch->>'note',c.note) as note$before16$,$after16$coalesce(r.effective_patch->>'note',c.note) as note,coalesce(r.effective_patch->>'outcome',c.outcome) as outcome$after16$),
    ('public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])',$before17$key,source_record_id,occurred_at from contacts$before17$,$after17$key,source_record_id,occurred_at,outcome from contacts$after17$),
    ('public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])',$before18$'stage',s.stage,'detail',s.detail$before18$,$after18$'stage',s.stage,'detail',case when s.stage='awaiting_first_contact' then public.student_first_contact_detail(coalesce(st.assigned_to,l.owner_id),coalesce(p.display_name,so.owner_name),l.status,c.outcome) else s.detail end$after18$),
    ('public.get_student_lifecycle(uuid,uuid)',$before19$  if exists(
    select 1 from public.business_lead_communications communication$before19$,$after19$  if exists(select 1 from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
    where (r.student_id=v_student_id or r.lead_id=any(v_lead_ids) or r.source_record_id in (
      select h.id from public.history_import_records h where h.lead_id=any(v_lead_ids)
        or h.id in(select source_record_id from public.leads where id=any(v_lead_ids))))
      and r.status='attended' and a.deleted_at is null) then return 'awaiting_assessment'; end if;
  if exists(
    select 1 from public.business_lead_communications communication$after19$)
  ) p(signature,before_text,after_text) loop
    definition:=pg_get_functiondef(patch.signature::regprocedure);
    if position(patch.before_text in definition)=0 then raise exception 'LEAD_FACT_CONTRACT_CHANGED: %',patch.signature; end if;
    execute replace(definition,patch.before_text,patch.after_text);
  end loop;
end;
$alignment$;
notify pgrst,'reload schema';
