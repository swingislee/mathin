-- 多人安排逐行保留来源片段，并沿用档案中的推定关联标签。
create table public.history_source_fragments (
  id text primary key check (char_length(id) between 1 and 160),
  source_record_id text not null references public.history_import_records(id) on delete restrict,
  source_payload_sha256 text not null check (source_payload_sha256 ~ '^[a-f0-9]{64}$'),
  source_field_id text not null,
  entry_index integer not null check (entry_index > 0),
  original_text text not null check (btrim(original_text) <> ''),
  student_id uuid references public.students(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete restrict,
  match_state text not null default 'inferred' check (match_state in ('inferred','confirmed')),
  match_reason jsonb not null check (jsonb_typeof(match_reason)='object'),
  business_fields jsonb not null check (jsonb_typeof(business_fields)='array'),
  event_date date,
  created_at timestamptz not null default now(),
  check (num_nonnulls(student_id,lead_id)=1),
  unique (source_record_id,source_field_id,entry_index)
);
create index history_source_fragments_student_idx on public.history_source_fragments(student_id) where student_id is not null;
create index history_source_fragments_lead_idx on public.history_source_fragments(lead_id) where lead_id is not null;
alter table public.history_source_fragments enable row level security;
create policy history_source_fragments_read on public.history_source_fragments for select to authenticated
  using (public.is_staff(auth.uid()) and public.school_support_subject_access(student_id,lead_id,false));
revoke all on public.history_source_fragments from public,anon,authenticated,service_role;
grant select on public.history_source_fragments to authenticated;

create function public.guard_history_source_fragment() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.history_import_records h cross join lateral jsonb_array_elements(h.record_data->'cells') c
    where h.id=new.source_record_id and h.payload_sha256=new.source_payload_sha256 and c->>'fieldId'=new.source_field_id
      and (regexp_split_to_array(c->>'text',E'\r?\n'))[new.entry_index]=new.original_text)
    then raise exception 'SOURCE_FRAGMENT_ORIGINAL_CHANGED'; end if;
  if tg_op='UPDATE' and (new.source_record_id,new.source_payload_sha256,new.source_field_id,new.entry_index,new.original_text,new.business_fields)
    is distinct from (old.source_record_id,old.source_payload_sha256,old.source_field_id,old.entry_index,old.original_text,old.business_fields)
    then raise exception 'SOURCE_FRAGMENT_IMMUTABLE'; end if;
  return new;
end;
$$;
revoke all on function public.guard_history_source_fragment() from public,anon,authenticated,service_role;
create trigger history_source_fragment_guard before insert or update on public.history_source_fragments
  for each row execute function public.guard_history_source_fragment();

create or replace function public.read_school_record_source_context(p_student_id uuid,p_lead_id uuid,p_page integer default 1) returns jsonb
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
  ), original_rows as (
    select h.id,1 as priority,h.source_data->>'format' as format,h.source_data->>'filename' as filename,
      h.record_data->>'tableName' as table_name,h.record_data->>'dateLabel' as date_label,
      case when a.match_state='inferred' then 'inferred' else 'linked' end as association,
      coalesce((select b.fields from public.history_source_business_facts b where b.source_record_id=h.id and b.mapping_version<=3 order by b.mapping_version desc limit 1),'[]'::jsonb) as business_fields,
      (select coalesce(jsonb_agg(jsonb_build_object('id',coalesce(c->>'fieldId',ordinal::text),'name',coalesce(c->>'fieldName',''),'text',c->>'text','type',coalesce(c->>'type','')) order by ordinal),'[]')
        from jsonb_array_elements(h.record_data->'cells') with ordinality cells(c,ordinal)
        where coalesce(c->>'kind','')<>'system' and btrim(coalesce(c->>'text',''))<>'') as cells
    from source_refs r join public.history_import_records h on h.id=r.id
      left join public.history_import_associations a on a.record_id=h.id
    where h.record_data->>'hasContent'='true' and not public.history_source_is_shared(h.record_data)
      and (a.student_id is null or a.student_id=sid) and (h.student_id is null or h.student_id=sid)
  ), fragment_rows as (
    select f.id,0 as priority,h.source_data->>'format' as format,h.source_data->>'filename' as filename,
      coalesce(h.record_data->>'tableName','')||' · 活动安排' as table_name,f.event_date::text as date_label,
      case when f.match_state='inferred' then 'inferred' else 'linked' end as association,f.business_fields,
      jsonb_build_array(jsonb_build_object('id',f.source_field_id,'name',coalesce((select c->>'fieldName' from jsonb_array_elements(h.record_data->'cells') c where c->>'fieldId'=f.source_field_id limit 1),''),'text',f.original_text,'type','Text')) as cells
    from public.history_source_fragments f join public.history_import_records h on h.id=f.source_record_id
    where (f.student_id=sid or f.lead_id in(select id from leads))
      and public.school_support_subject_access(f.student_id,f.lead_id,false)
  ), scoped as materialized (select * from original_rows union all select * from fragment_rows),
  paged as (select * from scoped order by priority,case format when 'feishu-base' then 0 else 1 end,filename desc,table_name,id offset (p_page-1)*10 limit 10)
  select (select count(*) from scoped),coalesce(jsonb_agg(jsonb_build_object('id',id,'table',coalesce(table_name,''),'source',coalesce(filename,''),
    'date',date_label,'association',association,'businessFields',business_fields,'cells',cells)
    order by priority,case format when 'feishu-base' then 0 else 1 end,filename desc,table_name,id),'[]') into total,result from paged;
  return jsonb_build_object('candidates',candidates,'sources',result,'sourceCount',total,'page',p_page,'pageSize',10);
end;
$$;
