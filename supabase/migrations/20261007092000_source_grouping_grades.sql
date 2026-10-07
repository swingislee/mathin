-- Known source grades and source-table organization are shared across workspaces.
create function public.school_source_grade_number(p_text text) returns integer
language plpgsql immutable strict set search_path=public,pg_temp as $$
declare value text:=regexp_replace(normalize(p_text,NFKC),'[[:space:]]','','g'); n integer; stage text; ordinal text;
  words text[]:=array['一','二','三','四','五','六','七','八','九','十','十一','十二'];
begin
  value:=regexp_replace(value,'(年级){2,}$','年级');
  stage:=substring(value from '^(小学|初中|高中|小|初|高)');
  if stage is not null then value:=substring(value from length(stage)+1); end if;
  ordinal:=regexp_replace(regexp_replace(value,'^第',''),'年级$','');
  n:=array_position(words,ordinal);
  if n is null and ordinal ~ '^[0-9]{1,2}$' then n:=ordinal::integer; end if;
  if n is null or n<1 then return null; end if;
  if stage in ('小学','小') then return case when n<=6 then n end;
  elsif stage in ('初中','初') then return case when n<=3 then n+6 end;
  elsif stage in ('高中','高') then return case when n<=3 then n+9 end;
  else return case when n<=12 then n end; end if;
end;
$$;
revoke all on function public.school_source_grade_number(text) from public,anon,authenticated;

-- Fill only absent structured values from an unambiguous existing grade label.
-- Existing formal student grades, source labels, and raw source records stay intact.
update public.leads set grade_hint=public.school_source_grade_number(grade_text)
where grade_hint is null and source_record_id is not null and public.school_source_grade_number(grade_text) is not null;

create function public.school_visible_source_layout(p_kind text)
returns table(logical_key text,source_record_id text,student_id uuid,lead_id uuid,kind text,
  group_label text,subgroup_label text,group_rank integer,source_rank integer,periods jsonb,period_defaults jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); view_all boolean;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'review.write') or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('acquisition','assessment','service') or p_kind is null then raise exception 'VALIDATION'; end if;
  view_all:=public.has_perm(actor,'student.view.all');
  return query select w.logical_key,w.source_record_id,coalesce(l.student_id,w.student_id),w.lead_id,w.kind,
    w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.periods,w.period_defaults
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
    where w.kind=p_kind and (view_all or case when coalesce(l.student_id,w.student_id) is not null
      then public.can_view_school_student(coalesce(l.student_id,w.student_id),actor)
      else public.can_view_school_lead(w.lead_id,actor) end);
end;
$$;
revoke all on function public.school_visible_source_layout(text) from public,anon;
grant execute on function public.school_visible_source_layout(text) to authenticated;

CREATE OR REPLACE FUNCTION public.school_communication_page(p_stage text DEFAULT 'awaiting_assessment'::text, p_scope text DEFAULT 'mine'::text, p_search text DEFAULT ''::text, p_group text DEFAULT ''::text, p_marker text DEFAULT ''::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_period_field text DEFAULT ''::text, p_period text DEFAULT ''::text, p_subjects text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  actor uuid:=auth.uid(); facts public.business_course_enrollment_subjects[]; result jsonb; period_field text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','former_student')
    or p_scope is null or p_scope not in ('mine','all','group','unassigned')
    or p_search is null or length(p_search)>80 or p_group is null or length(p_group)>320
    or p_marker is null or length(p_marker)>80 or p_page is null or p_page not between 1 and 1000000
    or p_page_size is null or p_page_size not in (20,50,100)
    or p_period_field is null or p_period_field not in ('','acquired','followed','confirmed','arrived','enrolled')
    or p_period is null or (p_period not in ('','all','unknown') and p_period !~ '^([1-9]|1[0-2])月$')
    or (p_subjects is not null and (cardinality(p_subjects)>200 or exists(select 1 from unnest(p_subjects) k where k !~ '^(student|lead):[0-9a-fA-F-]{36}$')))
    then raise exception 'VALIDATION'; end if;
  period_field:=case when p_stage='former_student' then '' when p_period_field<>'' then p_period_field
    when p_stage='awaiting_enrollment' then 'arrived' else 'acquired' end;
  if (p_stage in ('awaiting_first_contact','awaiting_assessment') and period_field not in ('acquired','followed','confirmed'))
    or (p_stage='awaiting_enrollment' and period_field not in ('arrived','confirmed','enrolled')) then raise exception 'VALIDATION'; end if;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts
    from public.business_course_enrollment_subjects e;
  with visible as materialized (
    select v.* from public.student_record_index_for_population(p_scope,p_search,facts,false) v where p_subjects is null or v.key=any(p_subjects)
  ), worklist as materialized (
    select w.*,coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id) as subject_key
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
  ), entries as materialized (
    select distinct on(v.key) v.*,coalesce(w.logical_key,v.key) as logical_key,w.kind,
      coalesce(w.group_label,'未分组') as group_label,coalesce(w.subgroup_label,'') as subgroup_label,
      coalesce(w.group_rank,1000000) as group_rank,coalesce(w.source_rank,1000000) as source_rank,
      coalesce(w.markers,'[]'::jsonb) as markers,coalesce(w.context,'[]'::jsonb) as context,
      coalesce(w.periods,'{}'::jsonb) as periods,coalesce(w.period_defaults,'{}'::jsonb) as period_defaults,
      coalesce(w.group_label,'未分组')||' / '||coalesce(w.subgroup_label,'') as group_key
    from visible v left join worklist w on w.subject_key=v.key
    where v.stage=p_stage
    order by v.key,
      case when w.kind=case v.stage when 'awaiting_first_contact' then 'acquisition' when 'awaiting_assessment' then 'acquisition' when 'awaiting_enrollment' then 'assessment' else 'service' end then 0 else 1 end,
      w.group_rank,w.source_rank,w.logical_key
  ), task_entries as materialized (
    select *,coalesce(nullif(periods->>period_field,''),'unknown') as period
    from entries where stage=p_stage and (p_subjects is null or key=any(p_subjects))
  ), defaults as (
    select coalesce(max(period_defaults->>'month'),'12月') as preferred,max(period_defaults->>'group') as preferred_group from task_entries
  ), period_totals as materialized (
    select period,count(distinct key)::integer as n,
      case when period ~ '^([1-9]|1[0-2])月$' then
        (replace(period,'月','')::integer - coalesce(nullif(regexp_replace((select preferred from defaults),'[^0-9]','','g'),''),'12')::integer + 11) % 12
        else -1 end as rank
    from task_entries group by period
  ), choice as (
    select case when p_stage='former_student' then 'all' else coalesce(nullif(p_period,''),
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
      'id',s.logical_key,'kind',s.kind,'group',s.group_label,'subgroup',s.subgroup_label,'groupKey',s.group_key,
      'rank',s.source_rank,'markers',s.markers,'context',s.context,'period',s.period,'periods',s.periods))
      order by s.period_rank desc,s.group_rank,s.source_rank,s.logical_key)
      from selected s join details d on d.r->>'key'=s.key),'[]'::jsonb),
    'count',(select n from totals),'page',least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals))),
    'pageSize',p_page_size,'totalPages',greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)),
    'periodField',period_field,'period',(select period from choice),'group',(select label from group_choice),
    'periods',case when p_stage='former_student' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('key',period,'count',n) order by rank desc) from period_totals),'[]'::jsonb) end,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('key',group_label,'count',n,'subgroups',
      coalesce((select jsonb_agg(jsonb_build_object('key',subgroup_label,'count',n) order by rank) from
        (select subgroup_label,count(distinct key)::integer as n,min(group_rank) as rank from period_entries t where t.group_label=g.group_label group by subgroup_label) sub),'[]'::jsonb)) order by rank) from
      (select group_label,count(distinct key)::integer as n,min(group_rank) as rank from period_entries group by group_label) g),'[]'::jsonb),
    'markers',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'color',color,'count',n) order by key) from
      (select m->>'key' as key,m->>'label' as label,m->>'color' as color,count(distinct t.key) as n
        from period_entries t cross join lateral jsonb_array_elements(t.markers) m
        where (select label from group_choice)='all' or t.group_label=(select label from group_choice) or t.group_key=(select label from group_choice) group by m->>'key',m->>'label',m->>'color') m),'[]'::jsonb),
    'counts',jsonb_build_object(
      'awaiting_first_contact',(select count(distinct key) from visible where stage='awaiting_first_contact'),
      'awaiting_assessment',(select count(*) from visible where stage='awaiting_assessment'),
      'awaiting_enrollment',(select count(*) from visible where stage='awaiting_enrollment'),
      'former_student',(select count(*) from visible where stage='former_student'),
      'awaiting_renewal',(select count(*) from visible where stage='awaiting_renewal'))
  ) into result;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_assessment_workbench_page(p_state text, p_search text, p_page integer, p_page_size integer, p_query jsonb, p_locale text, p_labels jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare zone text; item record; kind text; sort_field text:=p_query->'sort'->>'field'; direction text:=p_query->'sort'->>'direction';result jsonb;
  enum_fields text[]:=array['grade','kind','location','assessor','supportOwner','assessorSource','paper','band','resultSource','status','substatus'];
  date_fields text[]:=array['scheduledAt','recordedAt'];numeric_fields text[]:=array['grade','score','scoreRate','progress','band','status','substatus'];
  allowed text[]:=array['name','phone','grade','kind','scheduledAt','location','assessor','supportOwner','assessorSource','paper','score','scoreRate','band','progress','resultSource','conclusion','status','substatus','recordedAt'];
  source_mode boolean := p_query ? 'sourceLayout';
  source_field text := coalesce(nullif(p_query->'sourceLayout'->>'periodField',''),'arrived');
  source_period text := coalesce(p_query->'sourceLayout'->>'period','');
  source_group text := coalesce(nullif(p_query->'sourceLayout'->>'group',''),'all');
begin
  if source_mode and (source_field not in ('arrived','confirmed','enrolled') or length(source_group)>320
    or (source_period not in ('','all','unknown') and source_period !~ '^([1-9]|1[0-2])月$')) then raise exception 'VALIDATION'; end if;
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (public.has_perm(auth.uid(),'review.write') or public.has_perm(auth.uid(),'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_state is null or p_state not in ('current','historical','all') or p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not in (20,50,100)
    or p_locale is null or p_locale not in ('zh','en') or length(coalesce(p_search,''))>100 or p_query is null or p_query->>'version' is distinct from '2'
    or jsonb_typeof(p_query->'filters') is distinct from 'object' or pg_column_size(p_query)>32768
    or p_labels is null or jsonb_typeof(p_labels)<>'object' or pg_column_size(p_labels)>32768 then raise exception 'VALIDATION'; end if;
  for item in select * from jsonb_each(p_query->'filters') loop
    kind:=item.value->>'kind';
    if not item.key=any(allowed) or kind is null then raise exception 'VALIDATION'; end if;
    if kind='presence' then
      if item.value->>'value' is null or item.value->>'value' not in ('present','missing') then raise exception 'VALIDATION'; end if;
    elsif kind='enum' and item.key=any(enum_fields) then
      if jsonb_typeof(item.value->'values') is distinct from 'array' then raise exception 'VALIDATION'; end if;
      if jsonb_array_length(item.value->'values') not between 1 and 100 or exists(select 1 from jsonb_array_elements(item.value->'values') v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 160) then raise exception 'VALIDATION'; end if;
    elsif kind='text' and item.key in ('name','phone','conclusion') then
      if jsonb_typeof(item.value->'query') is distinct from 'string' or length(item.value->>'query')>160 then raise exception 'VALIDATION'; end if;
    elsif kind='number' and item.key in ('score','scoreRate','progress') then
      if (item.value->>'min' is null and item.value->>'max' is null) or (item.value->>'min' is not null and jsonb_typeof(item.value->'min')<>'number')
        or (item.value->>'max' is not null and jsonb_typeof(item.value->'max')<>'number') or (item.value->>'min')::numeric>(item.value->>'max')::numeric then raise exception 'VALIDATION'; end if;
    elsif kind='date' and item.key=any(date_fields) then
      if coalesce(item.value->>'from','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(item.value->>'to','')!~'^\d{4}-\d{2}-\d{2}$' or item.value->>'from'>item.value->>'to' then raise exception 'VALIDATION'; end if;
      begin perform (item.value->>'from')::date,(item.value->>'to')::date;
        exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION'; end;
    else raise exception 'VALIDATION'; end if;
  end loop;
  if p_query->'sort' is not null and p_query->'sort'<>'null'::jsonb and
    (sort_field is null or not sort_field=any(allowed) or sort_field='conclusion' or direction is null or direction not in ('asc','desc')) then raise exception 'VALIDATION'; end if;
  -- 原分只有选中单一试卷后才可比较，与前端字段合同一致。
  if coalesce(p_query->'filters'->'paper'->>'kind','')<>'enum' or jsonb_array_length(coalesce(p_query->'filters'->'paper'->'values','[]'::jsonb))<>1 then
    p_query:=jsonb_set(p_query,'{filters}',(p_query->'filters')-'score'); if sort_field='score' then sort_field:=null; end if;
  end if;
  if sort_field='scheduledAt' and direction='desc' then sort_field:=null; end if;
  zone:=public.get_organization_timezone_v2();
  with source_layout as materialized (
    select * from public.school_visible_source_layout('assessment') where source_mode
  ), base_rows as materialized (
    select r.* from public.assessment_list_rows(p_state) r
      where coalesce(public.assessment_list_trim(p_search),'')='' or exists(select 1 from unnest(array[
        payload->>'name',payload->>'phone',payload->>'gradeText',payload->>'location',payload->>'assessorName',payload->>'background',payload->>'activityTitle',
        payload->'assessment'->>'teacherObservation',payload->'assessment'->>'teacherRecommendation',payload->'assessment'->>'strengths',payload->'assessment'->>'focusAreas',payload->'assessment'->>'parentConcerns',payload->'questionSummary'->>'paperTitle'
      ]) value where position(lower(public.assessment_list_trim(p_search)) in lower(value))>0)
  ), placed as materialized (
    select distinct on(r.payload->>'id') r.*,w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.periods,w.period_defaults
    from base_rows r left join source_layout w on w.source_record_id=r.payload->>'sourceRecordId'
      or (w.student_id::text=r.payload->>'studentId') or (w.lead_id::text=r.payload->>'leadId')
    order by r.payload->>'id',case when w.source_record_id=r.payload->>'sourceRecordId' then 0 else 1 end,w.group_rank,w.source_rank,w.logical_key
  ), source_preference as (
    select coalesce(max(period_defaults->>'month'),'12月') as preferred from placed
  ), layout_rows as materialized (
    select p.payload || case when source_mode then jsonb_build_object('worklist',jsonb_build_object(
        'id',coalesce(logical_key,p.payload->>'id'),'kind',coalesce(p.kind,'assessment'),
        'group',coalesce(group_label,'未分组'),'subgroup',coalesce(subgroup_label,''),
        'groupKey',coalesce(group_label,'未分组')||' / '||coalesce(subgroup_label,''),
        'rank',coalesce(source_rank,1000000),'markers','[]'::jsonb,'context','[]'::jsonb,
        'period',coalesce(nullif(periods->>source_field,''),'unknown'),'periods',coalesce(periods,'{}'::jsonb))) else '{}'::jsonb end as payload,
      assessment_at,coalesce(group_label,'未分组') as group_label,coalesce(group_rank,1000000) as group_rank,
      coalesce(source_rank,1000000) as source_rank,coalesce(logical_key,p.payload->>'id') as logical_key,
      coalesce(nullif(periods->>source_field,''),'unknown') as period,
      case when periods->>source_field ~ '^([1-9]|1[0-2])月$' then
        (replace(periods->>source_field,'月','')::integer - coalesce(nullif(regexp_replace((select preferred from source_preference),'[^0-9]','','g'),''),'12')::integer + 11) % 12 else -1 end as period_rank
    from placed p
  ), rows as materialized (
    select r.*,row_number() over(order by
      case when source_mode then period_rank end desc,
      case when source_mode then group_rank end,case when source_mode then source_rank end,
      case when source_mode then logical_key end,
      case when not source_mode then assessment_at end desc nulls last,payload->>'id') as default_ordinal
    from layout_rows r
  ), fields as materialized (select payload->>'id' as key,default_ordinal,public.assessment_list_fields(payload,p_labels,zone) as fields from rows r),
  evaluated as materialized (select r.*,array(select f.key from jsonb_each(p_query->'filters') f where not public.dashboard_list_field_matches(r.fields->f.key,f.value)) as misses from fields r),
  source_periods as materialized (
    select r.period,count(*)::integer as n,min(r.period_rank) as rank from rows r join evaluated e on e.key=r.payload->>'id'
      where cardinality(e.misses)=0 group by r.period
  ), source_choice as (
    select coalesce(nullif(source_period,''),
      (select period from source_periods where period=(select preferred from source_preference)),
      (select period from source_periods order by rank desc limit 1),'unknown') as period
  ), source_groups as materialized (
    select r.group_label,count(*)::integer as n,min(r.group_rank) as rank from rows r join evaluated e on e.key=r.payload->>'id'
      where cardinality(e.misses)=0 and ((select period from source_choice)='all' or r.period=(select period from source_choice)) group by r.group_label
  ), filtered as not materialized (
    select e.* from evaluated e join rows r on r.payload->>'id'=e.key where cardinality(e.misses)=0
      and (not source_mode or (((select period from source_choice)='all' or r.period=(select period from source_choice))
        and (source_group='all' or r.group_label=source_group)))
  ),
  totals as (select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as pages from filtered),
  ordered as (
    select f.*,row_number() over(order by
      case when sort_field is not null then coalesce((fields->sort_field->>'sortMissing')::boolean,(fields->sort_field->>'missing')::boolean,true) end,
      case when sort_field=any(numeric_fields||date_fields) and direction='asc' then (fields->sort_field->>'sort')::numeric end asc,
      case when sort_field=any(numeric_fields||date_fields) and direction='desc' then (fields->sort_field->>'sort')::numeric end desc,
      case when not sort_field=any(numeric_fields||date_fields) and direction='asc' and p_locale='zh' then fields->sort_field->>'sort' end collate public.student_list_sort_zh asc,
      case when not sort_field=any(numeric_fields||date_fields) and direction='desc' and p_locale='zh' then fields->sort_field->>'sort' end collate public.student_list_sort_zh desc,
      case when not sort_field=any(numeric_fields||date_fields) and direction='asc' and p_locale='en' then fields->sort_field->>'sort' end collate public.student_list_sort_en asc,
      case when not sort_field=any(numeric_fields||date_fields) and direction='desc' and p_locale='en' then fields->sort_field->>'sort' end collate public.student_list_sort_en desc,
      default_ordinal) as ordinal from filtered f
  ), page_keys as materialized (select key,ordinal from ordered order by ordinal limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size),
  page_rows as (select r.payload,p.ordinal from page_keys p join rows r on r.payload->>'id'=p.key),
  all_options as materialized (
    select distinct on(f.id,v.value) f.id,v.value,coalesce(p_labels->f.id->>v.value,e.fields->f.id->>'label',v.value) as label
    from evaluated e cross join unnest(enum_fields) f(id) cross join lateral jsonb_array_elements_text(e.fields->f.id->'values') v(value) order by f.id,v.value,e.default_ordinal
  ), option_refs as (
    select f.id,v.value from evaluated e cross join unnest(enum_fields) f(id) cross join lateral jsonb_array_elements_text(e.fields->f.id->'values') v(value) where e.misses<@array[f.id]
    union select f.key,v.value from jsonb_each(p_query->'filters') f cross join lateral jsonb_array_elements_text(case when f.value->>'kind'='enum' then f.value->'values' else '[]'::jsonb end) v(value)
  ), option_facets as (
    select f.id,jsonb_build_object('options',coalesce(jsonb_agg(jsonb_build_object('value',a.value,'label',coalesce(o.label,a.value))) filter(where a.value is not null),'[]'::jsonb),'days','[]'::jsonb) as data
      from unnest(enum_fields) f(id) left join option_refs a on a.id=f.id left join all_options o on o.id=a.id and o.value=a.value group by f.id
  ), date_facets as (
    select f.id,jsonb_build_object('options','[]'::jsonb,'days',coalesce(jsonb_agg(distinct e.fields->f.id->>'day' order by e.fields->f.id->>'day' desc) filter(where e.fields->f.id->>'day' is not null),'[]'::jsonb)) as data
    from unnest(date_fields) f(id) left join evaluated e on e.misses<@array[f.id] group by f.id
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(payload order by ordinal) from page_rows),'[]'::jsonb),
    'count',t.count,'page',least(p_page,t.pages),'pageSize',p_page_size,'totalPages',t.pages,
    'sourceLayout',jsonb_build_object('periodField',source_field,'period',(select period from source_choice),'group',source_group,
      'periods',coalesce((select jsonb_agg(jsonb_build_object('key',period,'count',n) order by rank desc) from source_periods),'[]'::jsonb),
      'groups',coalesce((select jsonb_agg(jsonb_build_object('key',group_label,'count',n) order by rank) from source_groups),'[]'::jsonb)),
    'facets',coalesce((select jsonb_object_agg(id,data) from(select * from option_facets union all select * from date_facets) f),'{}'::jsonb)) into result from totals t;
  return result;
end;
$function$
;
notify pgrst,'reload schema';
