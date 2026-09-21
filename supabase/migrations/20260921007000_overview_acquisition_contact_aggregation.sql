-- 总览首批聚合：单行转换在写入时生成，事实归并与统计继续使用调用者 RLS。
create function public.overview_trim_v2(value text) returns text
language sql immutable parallel safe security invoker set search_path=public,pg_temp as $$
  select btrim(value,E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;

create function public.overview_date_v2(value text) returns date
language plpgsql immutable parallel safe security invoker set search_path=public,pg_temp as $$
declare parts text[];
begin
  parts:=regexp_match(value,'^([0-9]{4})[./年-]([0-9]{1,2})[./月-]([0-9]{1,2})(日)?($|[ T][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})?$)');
  if parts is null or parts[1]::integer<100 then return null;end if;
  return make_date(parts[1]::integer,parts[2]::integer,parts[3]::integer);
exception when datetime_field_overflow then return null;
end;
$$;

create type public.overview_acquisition_fields_v2 as (
  valid boolean, meaningful boolean, acquired_on date, staff_label text, source_name text
);
create function public.project_overview_acquisition_v2(value jsonb)
returns public.overview_acquisition_fields_v2
language plpgsql immutable parallel safe security invoker set search_path=public,pg_temp as $$
declare cells jsonb; raw_date text; registered text; name text; phone text; staff text; acquired date; anchor date; parts text[]; key text; field jsonb;
begin
  cells:=public.project_staff_overview_acquisition_cells(value);
  -- 保留畸形原文的导入能力；读取时显式报告，避免把非字符串转换成新的业务事实。
  foreach key in array array['获取日期','登记日期（此列不用填，自动生成）','学员姓名','家长电话','确认人员','跟进人','沟通人员'] loop
    select c->'text' into field from jsonb_array_elements(cells)c where c->>'fieldName'=key limit 1;
    if found and jsonb_typeof(field) is distinct from 'string' then return row(false,null,null,null,null)::public.overview_acquisition_fields_v2;end if;
  end loop;
  select public.overview_trim_v2((select c->>'text' from jsonb_array_elements(cells)c where c->>'fieldName'='获取日期' limit 1)),
    public.overview_trim_v2((select c->>'text' from jsonb_array_elements(cells)c where c->>'fieldName'='登记日期（此列不用填，自动生成）' limit 1)),
    public.overview_trim_v2((select c->>'text' from jsonb_array_elements(cells)c where c->>'fieldName'='学员姓名' limit 1)),
    public.overview_trim_v2((select c->>'text' from jsonb_array_elements(cells)c where c->>'fieldName'='家长电话' limit 1)),
    coalesce(nullif(public.overview_trim_v2((select c->>'text' from jsonb_array_elements(cells)c where c->>'fieldName'='确认人员' limit 1)),''),
      nullif(public.overview_trim_v2((select c->>'text' from jsonb_array_elements(cells)c where c->>'fieldName'='跟进人' limit 1)),''),
      nullif(public.overview_trim_v2((select c->>'text' from jsonb_array_elements(cells)c where c->>'fieldName'='沟通人员' limit 1)),''))
    into raw_date,registered,name,phone,staff;
  acquired:=public.overview_date_v2(raw_date);
  if acquired is null and registered ~ '^[0-9]{4}[./年-][0-9]{1,2}[./月-][0-9]{1,2}日?$' then
    parts:=regexp_match(raw_date,'^([0-9]{1,2})[./月-]([0-9]{1,2})日?$');
    anchor:=public.overview_date_v2(registered);
    if parts is not null and anchor is not null and parts[1]::integer=extract(month from anchor) then
      acquired:=public.overview_date_v2(extract(year from anchor)::text||'-'||parts[1]||'-'||parts[2]);
      if anchor-acquired not between 0 and 7 then acquired:=null;end if;
    end if;
  end if;
  return row(true,coalesce(raw_date,'')<>'' or coalesce(name,'')<>'' or coalesce(phone,'')<>'',acquired,staff,name);
end;
$$;

create type public.overview_contact_fields_v2 as (
  source_key text, source_version text, source_scope text, confirmed boolean,
  month_state smallint, reporting_month text, staff_label text
);
create function public.project_overview_contact_v2(value jsonb)
returns public.overview_contact_fields_v2
language plpgsql immutable parallel safe security invoker set search_path=public,pg_temp as $$
declare key text; flag jsonb; month jsonb; person jsonb;
begin
  if value is null or jsonb_typeof(value)<>'object' or value->'version' is distinct from '1'::jsonb
    or jsonb_typeof(value->'sourceKey') is distinct from 'string' or value->>'sourceKey'=''
    or jsonb_typeof(value->'sourceName') is distinct from 'string'
    or jsonb_typeof(value->'sourceTable') is distinct from 'string'
    or jsonb_typeof(value->'sourceVersion') is distinct from 'string'
    or coalesce(value->>'scope','') not in ('acquisition','selection','activity','other')
    or coalesce(jsonb_typeof(value->'confirmed'),'null') not in ('object','array')
    or coalesce(jsonb_typeof(value->'months'),'null') not in ('object','array')
    or coalesce(jsonb_typeof(value->'staff'),'null') not in ('object','array')
    or jsonb_typeof(value->'evidence') is distinct from 'array' then return null;end if;
  foreach key in array array['contacts','invitations','arrivals','assessments','enrollments','activityRegistrations'] loop
    flag:=value->'confirmed'->key;month:=value->'months'->key;person:=value->'staff'->key;
    if flag is not null and jsonb_typeof(flag)<>'boolean'
      or month is not null and month<>'null'::jsonb and (jsonb_typeof(month)<>'string' or month#>>'{}' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
      or person is not null and jsonb_typeof(person)<>'string' then return null;end if;
  end loop;
  return row(value->>'sourceKey',value->>'sourceVersion',value->>'scope',(value->'confirmed'->>'contacts')::boolean,
    (case when value->'months'->'contacts' is null then 0 when value->'months'->'contacts'='null'::jsonb then 1 else 2 end)::smallint,
    value->'months'->>'contacts',coalesce(value->'staff'->>'contacts',''));
end;
$$;

alter table public.history_import_records add column overview_acquisition_v2 public.overview_acquisition_fields_v2
generated always as (case when source_data->>'format'='feishu-base'
  and coalesce(source_data->>'logicalSourceId',source_data->>'id')='feishu-base:28a6f6af56504cab716f01eead37d73b5098d0830ed4b02b55c06dc93e135dc6'
  and record_data->>'tableId'='tblzwPK2XgJa14EC'
  then public.project_overview_acquisition_v2(record_data) end) stored;
alter table public.lead_communications add column overview_contact_v2 public.overview_contact_fields_v2
generated always as (public.project_overview_contact_v2(source_metric_facts)) stored;
alter table public.activity_registrations add column overview_contact_v2 public.overview_contact_fields_v2
generated always as (public.project_overview_contact_v2(source_metric_facts)) stored;
grant select(overview_contact_v2) on public.lead_communications,public.activity_registrations to authenticated;

-- 仅在原视图 SELECT 末尾追加派生字段，保留来源权威、current/historical 与 invoker 属性。
do $views$
declare relation text; definition text; marker text;
begin
  foreach relation in array array['lead_communications','activity_registrations'] loop
    if not exists(select 1 from pg_class where oid=('public.business_'||relation)::regclass and reloptions @> array['security_invoker=true']) then
      raise exception 'OVERVIEW_BUSINESS_VIEW_CHANGED';end if;
    definition:=pg_get_viewdef(('public.business_'||relation)::regclass,true);
    marker:=E'\n   FROM '||relation||' r';
    if strpos(definition,marker)=0 or strpos(definition,'overview_contact_v2')>0 then raise exception 'OVERVIEW_VIEW_SHAPE_CHANGED';end if;
    execute 'create or replace view public.business_'||relation||' with(security_invoker=true) as '
      ||replace(definition,marker,E',\n    r.overview_contact_v2'||marker);
  end loop;
end;
$views$;

-- 原单条判定允许调用者核对给定来源 ID；批量版本只返回输入中通过同一条件的 ID。
-- 历史档案本身仍为管理员可读，员工只取得业务视图原本使用的存在性结果。
do $guard$
declare relation text;
begin
  if md5(replace((select prosrc from pg_proc where oid='public.business_source_is_authoritative(text)'::regprocedure),chr(13),''))<>
    md5(E'\n  select p_record_id is null or exists(select 1 from public.history_import_records r\n    where r.id=p_record_id and r.source_data->>''format''=''feishu-base'');\n')
    then raise exception 'OVERVIEW_SOURCE_AUTHORITY_CHANGED';end if;
  if not exists(select 1 from pg_proc where oid='public.business_source_is_authoritative(text)'::regprocedure and prosecdef and provolatile='s')
    then raise exception 'OVERVIEW_SOURCE_AUTHORITY_ACCESS_CHANGED';end if;
  foreach relation in array array['lead_communications','activity_registrations','assessment_results','activities'] loop
    if pg_get_viewdef(('public.business_'||relation)::regclass,true) !~ 'WHERE business_source_is_authoritative\(r.source_record_id\);$'
      or not exists(select 1 from pg_class where oid=('public.business_'||relation)::regclass and reloptions @> array['security_invoker=true'])
      then raise exception 'OVERVIEW_BUSINESS_SCOPE_CHANGED';end if;
  end loop;
end;
$guard$;
create function public.business_authoritative_source_ids_v2(p_ids text[]) returns setof text
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  -- 来源数随权限范围变化，按实际数组规划；SQL 固定，数据只通过绑定参数传入。
  return query execute 'select r.id from public.history_import_records r where r.id=any($1) and r.source_data->>''format''=''feishu-base''' using p_ids;
end;
$$;
do $owner$
begin
  execute format('alter function public.business_authoritative_source_ids_v2(text[]) owner to %I',
    (select pg_get_userbyid(proowner) from pg_proc where oid='public.business_source_is_authoritative(text)'::regprocedure));
end;
$owner$;
revoke all on function public.business_authoritative_source_ids_v2(text[]) from public,anon,authenticated,service_role;
grant execute on function public.business_authoritative_source_ids_v2(text[]) to authenticated,service_role;

create function public.overview_encode_component_v2(value text) returns text
language plpgsql immutable parallel safe security invoker set search_path=public,pg_temp as $$
declare bytes bytea:=convert_to(value,'UTF8');result text:='';b integer;
begin
  if value is null then return null;end if;
  for i in 0..length(bytes)-1 loop
    b:=get_byte(bytes,i);
    result:=result||case when b between 48 and 57 or b between 65 and 90 or b between 97 and 122 or b in (33,39,40,41,42,45,46,95,126)
      then chr(b) else '%'||upper(lpad(to_hex(b),2,'0')) end;
  end loop;
  return result;
end;
$$;

-- 窄事实供汇总及后续分页共用；不下载原文、证据或别名数组。
create function public.staff_overview_acquisition_contact_facts_v2(p_grain text,p_zone text)
returns table(metric text,id text,event_at timestamptz,month_state smallint,reporting_month text,person_id text,subject_id text)
language sql stable security invoker set search_path=public,pg_temp as $$
with actor as materialized (select public.is_staff(auth.uid()) as allowed),
lead_rows as materialized (
  select l.id,l.student_id,l.owner_id,l.source_record_id,l.created_at from public.leads l where (select allowed from actor)
), communication_candidates as materialized (
  select c.id,c.lead_id,c.occurred_at,c.occurred_on,c.outcome,c.owner_id_at_contact,c.recorded_by,c.source_record_id,c.source_key,c.overview_contact_v2
  from public.lead_communications c where (select allowed from actor)
), registration_candidates as materialized (
  select r.id,r.activity_id,r.lead_id,r.student_id,r.source_record_id,r.registered_on,r.overview_contact_v2
  from public.activity_registrations r where (select allowed from actor)
), assessment_candidates as materialized (
  select a.source_record_id,a.lead_id from public.assessment_results a where (select allowed from actor)
), activity_candidates as materialized (
  select a.id,a.source_record_id from public.activities a where a.deleted_at is null and (select allowed from actor)
), source_ids as materialized (
  select source_record_id as id from communication_candidates union select source_record_id from registration_candidates
  union select source_record_id from assessment_candidates union select source_record_id from activity_candidates
), authoritative as materialized (
  select public.business_authoritative_source_ids_v2(array(select id from source_ids where id is not null)) as id
), communications as materialized (
  select c.* from communication_candidates c where c.source_record_id is null or exists(select 1 from authoritative a where a.id=c.source_record_id)
), registrations as materialized (
  select r.* from registration_candidates r where r.source_record_id is null or exists(select 1 from authoritative a where a.id=r.source_record_id)
), versions as materialized (
  select h.id,h.lead_id,h.source_record_id,h.imported_at,h.overview_acquisition_v2,
    coalesce(substring(h.source_data->>'snapshotDate' from '^([0-9]{4}-[0-9]{2}-[0-9]{2})$'),
      substring(h.source_data->>'filename' from '^([0-9]{4}-[0-9]{2}-[0-9]{2})'),to_char(h.imported_at at time zone 'Asia/Shanghai','YYYY-MM-DD')) as version
  from public.history_import_records h where (h.overview_acquisition_v2).valid is not null and (select allowed from actor)
), latest as materialized (
  select distinct on(source_record_id) * from versions order by source_record_id,version desc,imported_at desc,id desc
), aliases as materialized (
  select v.id,l.id as current_id from versions v join latest l on l.source_record_id=v.source_record_id
  union select id,id from latest
), links as materialized (
  select source_record_id as source_id,id as lead_id from lead_rows
  union select id,lead_id from latest
  union select source_record_id,lead_id from communications
  union select source_record_id,lead_id from registrations
  union select source_record_id,lead_id from assessment_candidates c where c.source_record_id is null or exists(select 1 from authoritative a where a.id=c.source_record_id)
), source_leads as materialized (
  select distinct coalesce(a.current_id,k.source_id) as source_id,l.id as lead_id,l.owner_id
  from links k join lead_rows l on l.id=k.lead_id left join aliases a on a.id=k.source_id where k.source_id is not null
), primary_leads as materialized (select distinct source_leads.lead_id from source_leads join latest on latest.id=source_leads.source_id),
submissions as materialized (
  select s.lead_id,min(s.submitted_at) as submitted_at from public.lead_source_records s where (select allowed from actor) group by s.lead_id
), acquisition as (
  select case when (h.overview_acquisition_v2).valid then 'leads' else 'invalid-source' end as metric,h.id,(h.overview_acquisition_v2).acquired_on::timestamp at time zone p_zone as event_at,
    0::smallint as month_state,null::text as reporting_month,(h.overview_acquisition_v2).staff_label as label,
    case when count(sl.lead_id)=1 then min(sl.owner_id::text) end as fallback_person,null::text as subject_id
  from latest h left join source_leads sl on sl.source_id=h.id where (h.overview_acquisition_v2).meaningful or not (h.overview_acquisition_v2).valid
  group by h.id,h.overview_acquisition_v2
  union all
  select 'leads','submission:'||l.id,s.submitted_at,0::smallint,null,null,l.owner_id::text,null
  from submissions s join lead_rows l on l.id=s.lead_id where not exists(select 1 from primary_leads p where p.lead_id=l.id)
  union all
  select 'leads',l.id::text,case when l.source_record_id is null then l.created_at end,0::smallint,null,null,l.owner_id::text,null
  from lead_rows l where not exists(select 1 from primary_leads p where p.lead_id=l.id) and not exists(select 1 from submissions s where s.lead_id=l.id)
), contact_ranked as materialized (
  select c.*,row_number() over(partition by coalesce((overview_contact_v2).source_key,id::text)
    order by coalesce((overview_contact_v2).source_version,'') collate "C" desc,id) as ordinal
  from communications c where p_grain<>'month' or coalesce(source_key,'') not like '%:followup'
), contact as (
  select 'contacts'::text as metric,c.id::text,coalesce(c.occurred_at,c.occurred_on::timestamp at time zone p_zone) as event_at,
    coalesce((c.overview_contact_v2).month_state,0)::smallint as month_state,(c.overview_contact_v2).reporting_month,
    (c.overview_contact_v2).staff_label as label,
    case when (c.overview_contact_v2).source_key is null then coalesce(c.owner_id_at_contact,
      case when c.source_record_id is not null then coalesce(c.recorded_by,l.owner_id) end)::text end as fallback_person,
    coalesce(l.student_id::text,'lead:'||c.lead_id) as subject_id
  from contact_ranked c left join lead_rows l on l.id=c.lead_id
  where (p_grain<>'month' or ordinal=1) and case when p_grain='month' and (c.overview_contact_v2).source_key is not null
    then (c.overview_contact_v2).confirmed is true else c.outcome in ('connected','declined') end
), tagged as materialized (
  select distinct on((overview_contact_v2).source_key) * from registrations where (overview_contact_v2).source_key is not null
  order by (overview_contact_v2).source_key,(overview_contact_v2).source_version collate "C" desc,id
), confirmed as (
  select 'contacts'::text as metric,'source-contacts:'||(r.overview_contact_v2).source_key as id,r.registered_on::timestamp at time zone p_zone as event_at,
    (r.overview_contact_v2).month_state,(r.overview_contact_v2).reporting_month,(r.overview_contact_v2).staff_label as label,
    null::text as fallback_person,coalesce(r.student_id::text,l.student_id::text,case when r.lead_id is not null then 'lead:'||r.lead_id end,
      'record:source-contacts:'||(r.overview_contact_v2).source_key) as subject_id
  from tagged r left join lead_rows l on l.id=r.lead_id
  where (r.overview_contact_v2).confirmed is true and exists(select 1 from activity_candidates a where a.id=r.activity_id
    and (a.source_record_id is null or exists(select 1 from authoritative s where s.id=a.source_record_id)))
), raw as materialized (
  select *,false as supplement from acquisition union all select *,false from contact union all select *,true from confirmed
), labels as materialized (
  select label,case when count(p.id)=1 then min(p.id::text) else 'source-staff:'||public.overview_encode_component_v2(label) end as person_id
  from (select distinct label from raw where label is not null and label<>'') names
  left join public.profiles p on public.overview_trim_v2(p.display_name)=public.overview_trim_v2(names.label)
    and p.role in ('staff','admin') and p.is_active and public.overview_trim_v2(names.label)<>'' group by label
), attributed as materialized (
  select r.*,case when r.label is not null then l.person_id else r.fallback_person end as person_id,
    case when p_grain='month' then coalesce(r.reporting_month,to_char(r.event_at at time zone p_zone,'YYYY-MM'))
      else to_char(r.event_at at time zone p_zone,'YYYY-MM-DD') end as contact_period
  from raw r left join labels l on l.label=r.label
)
select a.metric,a.id,a.event_at,a.month_state,a.reporting_month,a.person_id,a.subject_id from attributed a
where not a.supplement or not exists(select 1 from attributed c where c.metric='contacts' and not c.supplement
  and c.subject_id=a.subject_id and c.person_id=a.person_id and c.contact_period=a.contact_period);
$$;

-- 时间窗由已有共享日历合同生成；查询只读取小参数并返回两个指标的汇总。
create function public.get_staff_overview_acquisition_contacts_v2(p_window jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare grain text:=p_window->>'grain';zone text;cs timestamptz;ce timestamptz;cc timestamptz;ps timestamptz;pe timestamptz;pc timestamptz;answer jsonb;
begin
  if not public.is_staff(auth.uid()) then raise exception 'FORBIDDEN';end if;
  zone:=public.get_organization_timezone_v2();
  if grain is null or grain not in ('week','month') or p_window->>'timeZone' is distinct from zone then raise exception 'VALIDATION';end if;
  cs:=(p_window->>'currentStart')::timestamptz;ce:=(p_window->>'currentEnd')::timestamptz;cc:=(p_window->>'currentCutoff')::timestamptz;
  ps:=(p_window->>'previousStart')::timestamptz;pe:=(p_window->>'previousEnd')::timestamptz;pc:=(p_window->>'previousCutoff')::timestamptz;
  if cs is null or ce is null or cc is null or ps is null or pe is null or pc is null
    or not (isfinite(cs) and isfinite(ce) and isfinite(cc) and isfinite(ps) and isfinite(pe) and isfinite(pc))
    or cs<>pe or cc<cs or cc>ce or pc<ps or pc>pe or cs>=ce or ps>=pe or ce-cs>interval '32 days' or pe-ps>interval '32 days'
    then raise exception 'VALIDATION';end if;
  with facts as materialized (select * from public.staff_overview_acquisition_contact_facts_v2(grain,zone)),
  availability as (
    select not (not exists(select 1 from public.history_import_records where (overview_acquisition_v2).valid is not null)
      and exists(select 1 from public.leads where source_record_id is not null)) as leads
  ), marked as materialized (
    select f.*,case when grain='month' and month_state>0 then reporting_month=to_char(cs at time zone zone,'YYYY-MM') else event_at>=cs and event_at<cc end as in_current,
      case when grain='month' and month_state>0 then reporting_month=to_char(ps at time zone zone,'YYYY-MM') else event_at>=ps and event_at<pc end as in_previous,
      event_at>=ps and event_at<(case when grain='month' then pe else pc end) as in_previous_trend,
      event_at at time zone zone as local_at
    from facts f where event_at is not null or grain='month' and reporting_month is not null
  ), dates as (
    select i,(cs at time zone zone)::date+i as current_day,(ps at time zone zone)::date+i as previous_day
    from generate_series(0,greatest((ce at time zone zone)::date-(cs at time zone zone)::date,(pe at time zone zone)::date-(ps at time zone zone)::date)-1)i
  ), metrics as (select unnest(array['leads','contacts']) as key),
  totals as (
    select metric,count(*) filter(where in_current) as current,count(*) filter(where in_previous) as previous from marked group by metric
  ), daily as (
    select metric,local_at::date as day,count(*) filter(where in_current) as current,
      count(*) filter(where not coalesce(in_current,false) and (in_previous or in_previous_trend)) as previous
    from marked where (in_current or in_previous or in_previous_trend)
      and (grain<>'month' or month_state=0 or to_char(local_at,'YYYY-MM')=reporting_month) group by metric,local_at::date
  ), trends as (
    select m.key,jsonb_agg(jsonb_build_object(
      'currentDate',case when d.current_day<(ce at time zone zone)::date then to_char(d.current_day::timestamp at time zone zone at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'previousDate',case when d.previous_day<(pe at time zone zone)::date then to_char(d.previous_day::timestamp at time zone zone at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'current',case when d.current_day<(ce at time zone zone)::date and (d.current_day::timestamp at time zone zone<cc or coalesce(c.current,0)>0) then coalesce(c.current,0) end,
      'previous',case when d.previous_day<(pe at time zone zone)::date and (d.previous_day::timestamp at time zone zone<(case when grain='month' then pe else pc end) or coalesce(p.previous,0)>0) then coalesce(p.previous,0) end
    ) order by d.i) as trend from metrics m cross join dates d left join daily c on c.metric=m.key and c.day=d.current_day left join daily p on p.metric=m.key and p.day=d.previous_day group by m.key
  ), people as (
    select metric,person_id,count(*) filter(where in_current) as current,count(*) filter(where in_previous) as previous
    from marked where in_current or in_previous group by metric,person_id
  )
  select jsonb_build_object('schemaVersion',2,'integrityValid',not exists(select 1 from facts where metric='invalid-source'),'metrics',jsonb_object_agg(m.key,jsonb_build_object(
    'available',m.key<>'leads' or a.leads,'missingDates',(select count(*) from facts where metric=m.key and event_at is null),
    'comparison',case when m.key<>'leads' or a.leads then jsonb_build_object('current',coalesce(t.current,0),'previous',coalesce(t.previous,0),'trend',tr.trend) end,
    'people',case when m.key<>'leads' or a.leads then coalesce((select jsonb_agg(jsonb_build_object('personId',person_id,'current',current,'previous',previous) order by person_id nulls last) from people where metric=m.key),'[]'::jsonb) else '[]'::jsonb end
  ))) into answer from metrics m cross join availability a left join totals t on t.metric=m.key join trends tr on tr.key=m.key;
  if answer->'integrityValid'='false'::jsonb then raise exception 'OVERVIEW_ACQUISITION_SOURCE_INVALID';end if;
  return answer-'integrityValid';
end;
$$;

revoke all on function public.overview_trim_v2(text),public.overview_date_v2(text),public.project_overview_acquisition_v2(jsonb),
  public.project_overview_contact_v2(jsonb),public.overview_encode_component_v2(text),
  public.staff_overview_acquisition_contact_facts_v2(text,text),public.get_staff_overview_acquisition_contacts_v2(jsonb) from public,anon,authenticated,service_role;
-- 纯转换函数不读取表；实际员工写入生成列也需要其执行权限。
grant execute on function public.overview_trim_v2(text),public.overview_date_v2(text),public.project_overview_contact_v2(jsonb),
  public.overview_encode_component_v2(text),public.staff_overview_acquisition_contact_facts_v2(text,text),
  public.get_staff_overview_acquisition_contacts_v2(jsonb) to authenticated;
grant execute on function public.overview_trim_v2(text),public.overview_date_v2(text),public.project_overview_contact_v2(jsonb) to service_role;
-- 历史导入继续由原投影函数的维护 owner 执行，不把导入能力授予员工/API 角色。
do $import_owner$
begin
  execute format('alter function public.project_overview_acquisition_v2(jsonb) owner to %I',
    (select pg_get_userbyid(proowner) from pg_proc where oid='public.project_staff_overview_acquisition_cells(jsonb)'::regprocedure));
end;
$import_owner$;
analyze public.history_import_records (overview_acquisition_v2);
analyze public.lead_communications (overview_contact_v2);
analyze public.activity_registrations (overview_contact_v2);
