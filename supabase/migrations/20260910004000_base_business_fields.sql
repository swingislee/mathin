-- Base 资料按原记录和映射版本保存结构化字段；业务身份、阶段和正式账务继续由领域表管理。
create table public.history_source_business_facts (
  source_record_id text not null references public.history_import_records(id) on delete restrict,
  mapping_version integer not null check (mapping_version > 0),
  source_payload_sha256 text not null check (source_payload_sha256 ~ '^[a-f0-9]{64}$'),
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  created_at timestamptz not null default now(),
  primary key (source_record_id, mapping_version)
);
alter table public.history_source_business_facts enable row level security;
create policy history_source_business_facts_admin_read on public.history_source_business_facts
  for select to authenticated using (public.is_admin(auth.uid()));
revoke all on public.history_source_business_facts from public, anon, authenticated, service_role;
grant select on public.history_source_business_facts to authenticated;
alter table public.history_source_business_facts owner to postgres;

create function public.validate_history_source_business_facts() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare original public.history_import_records;
begin
  select * into original from public.history_import_records where id=new.source_record_id;
  if original.source_data->>'format' is distinct from 'feishu-base'
    or original.payload_sha256 is distinct from new.source_payload_sha256 then raise exception 'BASE_SOURCE_CHANGED'; end if;
  if exists(select 1 from jsonb_array_elements(new.fields) f
    where jsonb_typeof(f) is distinct from 'object' or nullif(f->>'fieldId','') is null
      or not exists(select 1 from jsonb_array_elements(original.record_data->'cells') c
        where c->>'fieldId'=f->>'fieldId' and coalesce(c->>'kind','')<>'system'
          and c->>'fieldName'=f->>'name' and coalesce(c->>'text','')=f->>'originalText'))
    or (select count(*) from jsonb_array_elements(new.fields))<>(select count(distinct f->>'fieldId') from jsonb_array_elements(new.fields) f)
    then raise exception 'BASE_FIELD_SOURCE_MISMATCH'; end if;
  if exists(select 1 from jsonb_array_elements(original.record_data->'cells') c
    where coalesce(c->>'kind','')<>'system' and btrim(coalesce(c->>'text',''))<>''
      and not exists(select 1 from jsonb_array_elements(new.fields) f where f->>'fieldId'=c->>'fieldId'))
    then raise exception 'BASE_FIELD_COVERAGE_MISSING'; end if;
  return new;
end;
$$;
revoke all on function public.validate_history_source_business_facts() from public,anon,authenticated,service_role;
alter function public.validate_history_source_business_facts() owner to postgres;
create trigger history_source_business_facts_source_guard before insert or update on public.history_source_business_facts
  for each row execute function public.validate_history_source_business_facts();

-- 整理脚本与原表导入复用同一写入合同；同版本数据有差异时要求显式升级映射版本。
create function public.store_base_business_fields(p_records jsonb) returns integer
language plpgsql set search_path=public,pg_temp as $$
declare inserted integer;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then raise exception 'BASE_INPUT_INVALID'; end if;
  if exists(select 1 from jsonb_to_recordset(p_records) as i(source_record_id text,mapping_version integer,source_payload_sha256 text,fields jsonb)
    join public.history_source_business_facts b on b.source_record_id=i.source_record_id and b.mapping_version=i.mapping_version
    where b.fields<>i.fields or b.source_payload_sha256<>i.source_payload_sha256) then raise exception 'BASE_MAPPING_VERSION_CHANGED'; end if;
  insert into public.history_source_business_facts(source_record_id,mapping_version,source_payload_sha256,fields)
    select source_record_id,mapping_version,source_payload_sha256,fields from jsonb_to_recordset(p_records)
      as i(source_record_id text,mapping_version integer,source_payload_sha256 text,fields jsonb) on conflict do nothing;
  get diagnostics inserted=row_count;
  return inserted;
end;
$$;
revoke all on function public.store_base_business_fields(jsonb) from public,anon,authenticated,service_role;
alter function public.store_base_business_fields(jsonb) owner to postgres;

create function public.read_base_source_business_fields(p_source_id text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_source_id is null or length(p_source_id) not between 1 and 160 then raise exception 'VALIDATION'; end if;
  return coalesce((select fields from public.history_source_business_facts where source_record_id=p_source_id and mapping_version=1),'[]'::jsonb);
end;
$$;
revoke all on function public.read_base_source_business_fields(text) from public,anon,authenticated,service_role;
grant execute on function public.read_base_source_business_fields(text) to authenticated;
alter function public.read_base_source_business_fields(text) owner to postgres;

-- 沿原有已授权、排除冲突与共享原表的读取范围，附上同一条记录的结构化资料。
do $patch$
declare definition text; before_text text:=$before$'association',case when match_state='inferred' then 'inferred' else 'linked' end,$before$;
begin
  definition:=pg_get_functiondef('public.read_school_record_source_context(uuid,uuid,integer)'::regprocedure);
  if position(before_text in definition)=0 then raise exception 'BASE_SOURCE_CONTEXT_CONTRACT_CHANGED'; end if;
  execute replace(definition,before_text,before_text||$after$
    'businessFields',coalesce((select b.fields from public.history_source_business_facts b where b.source_record_id=paged.id and b.mapping_version=1),'[]'::jsonb),$after$);
end;
$patch$;

create function public.read_base_lead_acquisition(p_lead_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); result jsonb; zone text:=public.get_organization_timezone_v2();
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  if p_lead_ids is null or cardinality(p_lead_ids)>500 or array_position(p_lead_ids,null) is not null then raise exception 'VALIDATION'; end if;
  if exists(select 1 from unnest(p_lead_ids) id where not public.can_access_communication_row('lead:'||id,false)) then raise exception 'FORBIDDEN_SCOPE'; end if;
  with leads as materialized (select l.id,l.student_id,l.source_record_id from public.leads l where l.id=any(p_lead_ids)),
  refs as (
    select l.id as lead_id,l.student_id,h.id from leads l join public.history_import_records h on h.lead_id=l.id
    union select l.id,l.student_id,h.id from leads l join public.history_import_records h on h.id=l.source_record_id
  ), sources as materialized (
    select r.lead_id,h.id,h.record_data,b.fields from refs r join public.history_import_records h on h.id=r.id
      join public.history_source_business_facts b on b.source_record_id=h.id and b.mapping_version=1
      left join public.history_import_associations a on a.record_id=h.id
    where h.record_data->>'tableName'='获客&私域信息登记表1.0-总' and not public.history_source_is_shared(h.record_data)
      and (h.student_id is null or h.student_id=r.student_id) and (a.student_id is null or a.student_id=r.student_id)
  ), extracted as (
    select s.lead_id,s.id,coalesce(public.lead_source_origin_time(s.record_data,zone),
      max(f->'value'->>'text') filter(where f->>'key'='acquired_on' and f->>'status'='normalized' and f->'value'->>'precision'='day')) as acquired_at,
      coalesce(max(f->>'display') filter(where f->>'key'='acquired_on'),'') as date_label,
      coalesce(max(f->>'display') filter(where f->>'key'='location'),'') as location,
      coalesce(max(f->>'display') filter(where f->>'key'='channel'),'') as method,
      coalesce(max(f->>'display') filter(where f->>'key'='promoter'),'') as promoter,
      coalesce(max(f->>'display') filter(where f->>'key'='content'),'') as content,
      coalesce(max(f->>'display') filter(where f->>'key'='group'),'') as source_group
    from sources s left join lateral jsonb_array_elements(s.fields) f on f->>'section'='acquisition'
    group by s.lead_id,s.id,s.record_data
  ) select coalesce(jsonb_agg(jsonb_build_object('leadId',l.id,'sources',coalesce((select jsonb_agg(jsonb_build_object(
      'sourceId',s.id,'acquiredAt',s.acquired_at,'dateLabel',s.date_label,'location',s.location,'method',s.method,
      'promoter',s.promoter,'content',s.content,'group',s.source_group) order by s.acquired_at desc nulls last,s.id)
    from extracted s where s.lead_id=l.id),'[]'::jsonb)) order by l.id),'[]'::jsonb) into result from leads l;
  return result;
end;
$$;
revoke all on function public.read_base_lead_acquisition(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.read_base_lead_acquisition(uuid[]) to authenticated;
alter function public.read_base_lead_acquisition(uuid[]) owner to postgres;

comment on table public.history_source_business_facts is '逐条 Base 来源字段的结构化资料。映射版本与原值共同保留；人员、组别、历史金额和日期不隐式创建账号、关系、收款或当前待办。';
notify pgrst,'reload schema';
