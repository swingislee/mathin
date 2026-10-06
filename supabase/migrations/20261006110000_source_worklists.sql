-- Source position and classifications supplement the existing identity and business facts.
create table public.school_source_worklist_entries (
  logical_key text primary key,
  source_record_id text not null references public.history_import_records(id),
  student_id uuid references public.students(id),
  lead_id uuid references public.leads(id),
  kind text not null check (kind in ('acquisition','assessment','service')),
  group_label text not null,
  subgroup_label text not null,
  group_rank integer not null check (group_rank > 0),
  source_rank integer not null check (source_rank > 0),
  markers jsonb not null default '[]' check (jsonb_typeof(markers)='array'),
  context jsonb not null default '[]' check (jsonb_typeof(context)='array'),
  classifications jsonb not null default '[]' check (jsonb_typeof(classifications)='array'),
  imported_at timestamptz not null default now(),
  check (student_id is not null or lead_id is not null)
);
create index school_source_worklist_order on public.school_source_worklist_entries(kind,group_rank,source_rank,logical_key);
alter table public.school_source_worklist_entries enable row level security;
revoke all on public.school_source_worklist_entries from public,anon,authenticated;
grant all on public.school_source_worklist_entries to service_role;

create function public.school_source_worklist_page(
  p_task text default 'followup', p_scope text default 'mine', p_search text default '',
  p_group text default '', p_marker text default '', p_page integer default 1, p_page_size integer default 50
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
set plan_cache_mode=force_custom_plan as $$
declare
  actor uuid:=auth.uid(); facts public.business_course_enrollment_subjects[]; result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_task is null or p_task not in ('first_contact','followup','assessment','service')
    or p_scope is null or p_scope not in ('mine','all','group','unassigned')
    or p_search is null or length(p_search)>80 or p_group is null or length(p_group)>320
    or p_marker is null or length(p_marker)>80 or p_page is null or p_page not between 1 and 1000000
    or p_page_size is null or p_page_size not in (20,50,100) then raise exception 'VALIDATION'; end if;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts
    from public.business_course_enrollment_subjects e;
  with visible as materialized (
    select * from public.student_record_index_for_population(p_scope,p_search,facts,false)
  ), entries as materialized (
    select v.*,w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.markers,w.context,
      w.group_label||' / '||w.subgroup_label as group_key
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
      join visible v on v.key=coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id)
  ), task_entries as materialized (
    select * from entries where kind=case when p_task in ('first_contact','followup') then 'acquisition' else p_task end
      and (p_task<>'first_contact' or stage='awaiting_first_contact')
  ), filtered as materialized (
    select distinct on(key) * from task_entries where (p_group='' or group_key=p_group)
      and (p_marker='' or exists(select 1 from jsonb_array_elements(markers) m where m->>'key'=p_marker))
    order by key,group_rank,source_rank,logical_key
  ), totals as (select count(*)::integer as n from filtered),
  selected as materialized (
    select * from filtered order by group_rank,source_rank,logical_key
      offset (least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)))-1)*p_page_size limit p_page_size
  ), details as materialized (
    select r from jsonb_array_elements(public.student_record_list_rows(
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,
        'stage',stage,'detail',detail,'created_at',created_at)) from selected),'[]'::jsonb),facts)) r
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(d.r||jsonb_build_object('worklist',jsonb_build_object(
      'id',s.logical_key,'group',s.group_label,'subgroup',s.subgroup_label,'groupKey',s.group_key,
      'rank',s.source_rank,'markers',s.markers,'context',s.context)) order by s.group_rank,s.source_rank,s.logical_key)
      from selected s join details d on d.r->>'key'=s.key),'[]'::jsonb),
    'count',(select n from totals),'page',least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals))),
    'pageSize',p_page_size,'totalPages',greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('key',group_key,'count',n) order by rank) from
      (select group_key,count(distinct key) as n,min(group_rank) as rank from task_entries group by group_key) g),'[]'::jsonb),
    'markers',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'color',color,'count',n) order by key) from
      (select m->>'key' as key,m->>'label' as label,m->>'color' as color,count(distinct t.key) as n
        from task_entries t cross join lateral jsonb_array_elements(t.markers) m
        where p_group='' or t.group_key=p_group group by m->>'key',m->>'label',m->>'color') m),'[]'::jsonb),
    'counts',jsonb_build_object(
      'first_contact',(select count(distinct key) from entries where kind='acquisition' and stage='awaiting_first_contact'),
      'followup',(select count(distinct key) from entries where kind='acquisition'),
      'assessment',(select count(distinct key) from entries where kind='assessment'),
      'service',(select count(distinct key) from entries where kind='service'))
  ) into result;
  return result;
end;
$$;
revoke all on function public.school_source_worklist_page(text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.school_source_worklist_page(text,text,text,text,text,integer,integer) to authenticated;
notify pgrst,'reload schema';
