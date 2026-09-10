-- 迁移资料按原记录保留；同名同电话只生成阅读提示，正常业务中再核对身份。
create function public.school_identity_name(p_value text) returns text
language sql immutable parallel safe set search_path=public,pg_temp as $$
  select lower(regexp_replace(normalize(coalesce(p_value,''),NFKC),'[[:space:]]+','','g'));
$$;
create function public.school_identity_phone(p_value text) returns text
language sql immutable parallel safe set search_path=public,pg_temp as $$
  with digits as (select regexp_replace(coalesce(p_value,''),'[^0-9]','','g') as value),
  national as (select case when length(value)=15 and left(value,4)='0086' then substr(value,5)
    when length(value)=13 and left(value,2)='86' then substr(value,3) else value end as value from digits)
  select case when length(value) between 7 and 20 then value else '' end from national;
$$;
create index students_identity_phone_review on public.students(public.school_identity_name(name),public.school_identity_phone(phone)) where deleted_at is null;
create index students_identity_parent_phone_review on public.students(public.school_identity_name(name),public.school_identity_phone(parent_phone)) where deleted_at is null;
create index leads_identity_phone_review on public.leads(public.school_identity_name(provisional_student_name),public.school_identity_phone(phone)) where student_id is null;

create function public.school_duplicate_record_candidates(p_student_id uuid,p_lead_id uuid)
returns table(student_id uuid,lead_id uuid,name text,phone text,grade integer,school text)
language sql stable security definer set search_path=public,pg_temp as $$
  with subject as materialized (
    select coalesce(p_student_id,l.student_id) sid,p_lead_id lid,
      public.school_identity_name(coalesce(s.name,l.provisional_student_name)) label,
      array_remove(array[public.school_identity_phone(s.phone),public.school_identity_phone(s.parent_phone),public.school_identity_phone(l.phone)],'') phones
    from (select 1) seed left join public.leads l on l.id=p_lead_id
      left join public.students s on s.id=coalesce(p_student_id,l.student_id)
  ), candidates as (
    select s.id,null::uuid,s.name,coalesce(nullif(s.phone,''),s.parent_phone,''),s.grade,coalesce(s.school,'')
      from subject x cross join lateral unnest(x.phones) tel(value) join public.students s
        on public.school_identity_name(s.name)=x.label and public.school_identity_phone(s.phone)=tel.value
      where x.label<>'' and s.deleted_at is null and s.id is distinct from x.sid and public.can_view_school_student(s.id,auth.uid())
    union select s.id,null::uuid,s.name,coalesce(nullif(s.phone,''),s.parent_phone,''),s.grade,coalesce(s.school,'')
      from subject x cross join lateral unnest(x.phones) tel(value) join public.students s
        on public.school_identity_name(s.name)=x.label and public.school_identity_phone(s.parent_phone)=tel.value
      where x.label<>'' and s.deleted_at is null and s.id is distinct from x.sid and public.can_view_school_student(s.id,auth.uid())
    union select null::uuid,l.id,l.provisional_student_name,coalesce(l.phone,''),l.grade_hint,''
      from subject x cross join lateral unnest(x.phones) tel(value) join public.leads l
        on public.school_identity_name(l.provisional_student_name)=x.label and public.school_identity_phone(l.phone)=tel.value
      where x.label<>'' and l.student_id is null and l.id is distinct from x.lid and public.can_view_school_lead(l.id,auth.uid())
  ) select * from candidates;
$$;

create function public.read_school_record_hints(p_subjects jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare item jsonb; sid uuid; lid uuid; result jsonb:='[]';
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_subjects is null or jsonb_typeof(p_subjects)<>'array' or jsonb_array_length(p_subjects)>100 then raise exception 'VALIDATION'; end if;
  for item in select value from jsonb_array_elements(p_subjects) loop
    sid:=(item->>'studentId')::uuid;lid:=(item->>'leadId')::uuid;
    if not public.school_support_subject_access(sid,lid,false) then continue; end if;
    result:=result||jsonb_build_array(jsonb_build_object('key',coalesce('student:'||sid,'lead:'||lid),
      'possibleDuplicateCount',(select count(*) from public.school_duplicate_record_candidates(sid,lid))));
  end loop;
  return result;
end;
$$;

create function public.read_school_record_source_context(p_student_id uuid,p_lead_id uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare sid uuid; result jsonb; total bigint; candidates jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(auth.uid()) or not public.school_support_subject_access(p_student_id,p_lead_id,false) then raise exception 'FORBIDDEN'; end if;
  if p_page is null or p_page<1 or p_page>100000 then raise exception 'VALIDATION'; end if;
  sid:=coalesce(p_student_id,(select student_id from public.leads where id=p_lead_id));
  select coalesce(jsonb_agg(jsonb_build_object('studentId',student_id,'leadId',lead_id,'name',name,'phone',phone,'grade',grade,'school',school) order by name,student_id,lead_id),'[]')
    into candidates from public.school_duplicate_record_candidates(p_student_id,p_lead_id);
  with leads as materialized (select l.id,l.source_record_id from public.leads l where l.id=p_lead_id or l.student_id=sid),
  source_refs as (
    select h.id from public.history_import_records h where h.student_id=sid
    union select h.id from leads l join public.history_import_records h on h.lead_id=l.id
    union select source_record_id from leads where source_record_id is not null
    union select record_id from public.history_import_associations where student_id=sid
    union select source_record_id from public.activity_registrations r where source_record_id is not null and r.student_id=sid
    union select r.source_record_id from leads l join public.activity_registrations r on r.lead_id=l.id where r.source_record_id is not null
    union select source_record_id from public.assessment_results where source_record_id is not null and student_id=sid
    union select r.source_record_id from leads l join public.assessment_results r on r.lead_id=l.id where r.source_record_id is not null
    union select source_record_id from public.course_enrollments where source_record_id is not null and student_id=sid
    union select source_record_id from public.course_opportunities where source_record_id is not null and student_id=sid
    union select r.source_record_id from leads l join public.course_opportunities r on r.lead_id=l.id where r.source_record_id is not null
    union select source_record_id from public.student_follow_ups where source_record_id is not null and student_id=sid
    union select c.source_record_id from leads l join public.lead_communications c on c.lead_id=l.id where c.source_record_id is not null
  ), scoped as materialized (
    select h.*,a.match_state from source_refs r join public.history_import_records h on h.id=r.id
      left join public.history_import_associations a on a.record_id=h.id
    where h.record_data->>'hasContent'='true' and not public.history_source_is_shared(h.record_data)
      and (a.student_id is null or a.student_id=sid) and (h.student_id is null or h.student_id=sid)
  ), paged as (
    select * from scoped order by case source_data->>'format' when 'feishu-base' then 0 else 1 end,
      source_data->>'filename' desc,record_data->>'tableName',id offset (p_page-1)*10 limit 10
  ) select (select count(*) from scoped),coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'table',coalesce(record_data->>'tableName',''),'source',coalesce(source_data->>'filename',''),'date',record_data->>'dateLabel',
    'association',case when match_state='inferred' then 'inferred' else 'linked' end,
    'cells',(select coalesce(jsonb_agg(jsonb_build_object('id',coalesce(c->>'fieldId',ordinal::text),'name',coalesce(c->>'fieldName',''),'text',c->>'text','type',coalesce(c->>'type','')) order by ordinal),'[]')
      from jsonb_array_elements(record_data->'cells') with ordinality cells(c,ordinal)
      where coalesce(c->>'kind','')<>'system' and btrim(coalesce(c->>'text',''))<>''))),'[]') into total,result from paged;
  return jsonb_build_object('candidates',candidates,'sources',result,'sourceCount',total,'page',p_page,'pageSize',10);
end;
$$;

revoke all on function public.school_duplicate_record_candidates(uuid,uuid),public.read_school_record_hints(jsonb),
  public.read_school_record_source_context(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.read_school_record_hints(jsonb),public.read_school_record_source_context(uuid,uuid,integer) to authenticated;
