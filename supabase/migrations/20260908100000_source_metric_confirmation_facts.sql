-- 历史导入确认标签独立于流程操作时间，保留原始来源月份和确认依据。
do $columns$
declare relation text;
begin
  foreach relation in array array['lead_communications','activity_registrations','course_enrollments'] loop
    execute format('alter table public.%I add column source_metric_facts jsonb',relation);
    execute format('alter table public.%I add constraint %I check (source_metric_facts is null or (
      source_record_id is not null and jsonb_typeof(source_metric_facts)=''object''
      and source_metric_facts @> ''{"version":1}''::jsonb
      and source_metric_facts ?& array[''sourceKey'',''sourceName'',''sourceTable'',''sourceVersion'',''scope'',''confirmed'',''months'',''staff'',''evidence'']
      and jsonb_typeof(source_metric_facts->''sourceKey'')=''string''
      and jsonb_typeof(source_metric_facts->''sourceName'')=''string''
      and jsonb_typeof(source_metric_facts->''sourceTable'')=''string''
      and jsonb_typeof(source_metric_facts->''sourceVersion'')=''string''
      and source_metric_facts->>''scope'' in (''acquisition'',''selection'',''activity'',''other'')
      and jsonb_typeof(source_metric_facts->''confirmed'')=''object''
      and jsonb_typeof(source_metric_facts->''months'')=''object''
      and jsonb_typeof(source_metric_facts->''staff'')=''object''
      and jsonb_typeof(source_metric_facts->''evidence'')=''array''
    ))',relation,relation||'_source_metric_facts_check');
    execute format('grant select(source_metric_facts) on public.%I to authenticated',relation);
  end loop;
end;
$columns$;

create function public.guard_source_metric_facts() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if auth.uid() is not null and (
    (tg_op='INSERT' and new.source_metric_facts is not null)
    or (tg_op='UPDATE' and old.source_metric_facts is distinct from new.source_metric_facts)) then
    raise exception 'SOURCE_FACTS_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_source_metric_facts() from public,anon,authenticated,service_role;
do $guards$
declare relation text;
begin
  foreach relation in array array['lead_communications','activity_registrations','course_enrollments'] loop
    execute format('create trigger source_metric_facts_guard before insert or update of source_metric_facts on public.%I for each row execute function public.guard_source_metric_facts()',relation);
  end loop;
end;
$guards$;

-- 复用现有 RLS、来源权威与当前/历史边界，只向投影追加确认标签。
do $views$
declare relation text; columns text;
begin
  foreach relation in array array['lead_communications','activity_registrations','course_enrollments'] loop
    select string_agg(case when a.attname='record_state' then
      format('case when public.business_source_is_current(r.source_record_id) and public.business_fact_is_current(%L,r.id) then r.record_state else ''historical''::text end as record_state',relation)
      else format('r.%I',a.attname) end,',' order by a.attnum) into columns
      from pg_attribute a where a.attrelid=('public.'||relation)::regclass and a.attnum>0 and not a.attisdropped;
    execute format('create or replace view public.%I with (security_invoker=true) as select %s from public.%I r where public.business_source_is_authoritative(r.source_record_id)',
      'business_'||relation,columns,relation);
  end loop;
end;
$views$;
