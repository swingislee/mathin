-- Keep each source month fact separate; these columns only organize the working list.
alter table public.school_source_worklist_entries
  add column periods jsonb not null default '{}' check (jsonb_typeof(periods)='object'),
  add column period_defaults jsonb not null default '{}' check (jsonb_typeof(period_defaults)='object');

create function public.school_source_worklist_page_v2(
  p_task text default 'followup', p_scope text default 'mine', p_search text default '',
  p_group text default '', p_marker text default '', p_page integer default 1, p_page_size integer default 50,
  p_period_field text default '', p_period text default ''
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
set plan_cache_mode=force_custom_plan as $$
declare
  actor uuid:=auth.uid(); facts public.business_course_enrollment_subjects[]; result jsonb; period_field text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_task is null or p_task not in ('first_contact','followup','assessment','service')
    or p_scope is null or p_scope not in ('mine','all','group','unassigned')
    or p_search is null or length(p_search)>80 or p_group is null or length(p_group)>320
    or p_marker is null or length(p_marker)>80 or p_page is null or p_page not between 1 and 1000000
    or p_page_size is null or p_page_size not in (20,50,100)
    or p_period_field is null or p_period_field not in ('','acquired','followed','confirmed','arrived','enrolled')
    or p_period is null or (p_period not in ('','all','unknown') and p_period !~ '^([1-9]|1[0-2])月$')
    then raise exception 'VALIDATION'; end if;
  period_field:=case when p_task='service' then '' when p_period_field<>'' then p_period_field
    when p_task='assessment' then 'arrived' else 'acquired' end;
  if (p_task in ('first_contact','followup') and period_field not in ('acquired','followed','confirmed'))
    or (p_task='assessment' and period_field not in ('arrived','confirmed','enrolled')) then raise exception 'VALIDATION'; end if;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts
    from public.business_course_enrollment_subjects e;
  with visible as materialized (
    select * from public.student_record_index_for_population(p_scope,p_search,facts,false)
  ), entries as materialized (
    select v.*,w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.markers,w.context,
      w.periods,w.period_defaults,w.group_label||' / '||w.subgroup_label as group_key
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
      join visible v on v.key=coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id)
  ), task_entries as materialized (
    select *,coalesce(nullif(periods->>period_field,''),'unknown') as period
    from entries where kind=case when p_task in ('first_contact','followup') then 'acquisition' else p_task end
      and (p_task<>'first_contact' or stage='awaiting_first_contact')
  ), defaults as (
    select coalesce(max(period_defaults->>'month'),'12月') as preferred,max(period_defaults->>'group') as preferred_group from task_entries
  ), period_totals as materialized (
    select period,count(distinct key)::integer as n,
      case when period ~ '^([1-9]|1[0-2])月$' then
        (replace(period,'月','')::integer - coalesce(nullif(regexp_replace((select preferred from defaults),'[^0-9]','','g'),''),'12')::integer + 11) % 12
        else -1 end as rank
    from task_entries group by period
  ), choice as (
    select case when p_task='service' then 'all' else coalesce(nullif(p_period,''),
      (select period from period_totals where period=(select preferred from defaults)),
      (select period from period_totals order by rank desc limit 1),'unknown') end as period
  ), period_entries as materialized (
    select t.*,pt.rank as period_rank from task_entries t join period_totals pt using(period)
      where (select period from choice)='all' or t.period=(select period from choice)
  ), group_choice as (
    select coalesce(nullif(p_group,''),(select group_label from period_entries where group_label=(select preferred_group from defaults) limit 1),'all') as label
  ), filtered as materialized (
    select distinct on(key) * from period_entries where ((select label from group_choice)='all' or group_label=(select label from group_choice) or group_key=(select label from group_choice))
      and (p_marker='' or exists(select 1 from jsonb_array_elements(markers) m where m->>'key'=p_marker))
    order by key,period_rank desc,group_rank,source_rank,logical_key
  ), totals as (select count(*)::integer as n from filtered),
  selected as materialized (
    select * from filtered order by period_rank desc,group_rank,source_rank,logical_key
      offset (least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)))-1)*p_page_size limit p_page_size
  ), details as materialized (
    select r from jsonb_array_elements(public.student_record_list_rows(
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,
        'stage',stage,'detail',detail,'created_at',created_at)) from selected),'[]'::jsonb),facts)) r
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(d.r||jsonb_build_object('worklist',jsonb_build_object(
      'id',s.logical_key,'group',s.group_label,'subgroup',s.subgroup_label,'groupKey',s.group_key,
      'rank',s.source_rank,'markers',s.markers,'context',s.context,'period',s.period,'periods',s.periods))
      order by s.period_rank desc,s.group_rank,s.source_rank,s.logical_key)
      from selected s join details d on d.r->>'key'=s.key),'[]'::jsonb),
    'count',(select n from totals),'page',least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals))),
    'pageSize',p_page_size,'totalPages',greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)),
    'periodField',period_field,'period',(select period from choice),'group',(select label from group_choice),
    'periods',case when p_task='service' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('key',period,'count',n) order by rank desc) from period_totals),'[]'::jsonb) end,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('key',group_label,'count',n,'subgroups',
      coalesce((select jsonb_agg(jsonb_build_object('key',subgroup_label,'count',n) order by rank) from
        (select subgroup_label,count(distinct key)::integer as n,min(group_rank) as rank from period_entries t where t.group_label=g.group_label group by subgroup_label) sub),'[]'::jsonb)) order by rank) from
      (select group_label,count(distinct key)::integer as n,min(group_rank) as rank from period_entries group by group_label) g),'[]'::jsonb),
    'markers',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'color',color,'count',n) order by key) from
      (select m->>'key' as key,m->>'label' as label,m->>'color' as color,count(distinct t.key) as n
        from period_entries t cross join lateral jsonb_array_elements(t.markers) m
        where (select label from group_choice)='all' or t.group_label=(select label from group_choice) or t.group_key=(select label from group_choice) group by m->>'key',m->>'label',m->>'color') m),'[]'::jsonb),
    'counts',jsonb_build_object(
      'first_contact',(select count(distinct key) from entries where kind='acquisition' and stage='awaiting_first_contact'),
      'followup',(select count(distinct key) from entries where kind='acquisition'),
      'assessment',(select count(distinct key) from entries where kind='assessment'),
      'service',(select count(distinct key) from entries where kind='service'))
  ) into result;
  return result;
end;
$$;
revoke all on function public.school_source_worklist_page_v2(text,text,text,text,text,integer,integer,text,text) from public,anon;
grant execute on function public.school_source_worklist_page_v2(text,text,text,text,text,integer,integer,text,text) to authenticated;
notify pgrst,'reload schema';
