-- 小地推来源实时补入工作名单，保留既有来源位置；不重导入、不创建或合并档案。
-- 列条件在完整权限集合内筛选/排序后分页；候选独立按需读取，覆盖该阶段全部可能值。
CREATE OR REPLACE FUNCTION public.school_communication_workbench_page(p_stage text DEFAULT 'awaiting_assessment'::text, p_scope text DEFAULT 'mine'::text, p_search text DEFAULT ''::text, p_group text DEFAULT ''::text, p_marker text DEFAULT ''::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_period_field text DEFAULT ''::text, p_period text DEFAULT ''::text, p_subjects text[] DEFAULT NULL::text[], p_batch uuid DEFAULT NULL,
  p_query jsonb DEFAULT '{"version":2,"filters":{},"sort":null}'::jsonb,
  p_locale text DEFAULT 'zh', p_labels jsonb DEFAULT '{}'::jsonb, p_include_facets boolean DEFAULT false, p_facets_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  actor uuid:=auth.uid(); facts public.business_course_enrollment_subjects[]; result jsonb; period_field text; zone text; item record; kind text; sort_field text; direction text; needs_fields boolean;
  enum_fields text[]:=array['grade','detail','owner','group','scope','sourceReview','sourceArrangement'];
  date_fields text[]:=array['lastContactAt','nextContactAt'];
  text_fields text[]:=array['name','phone','note','context']; allowed text[];
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
  zone:=public.get_organization_timezone_v2();
  allowed:=enum_fields||date_fields||text_fields;
  if p_locale is null or p_locale not in ('zh','en') or p_include_facets is null or p_facets_only is null or p_query is null
    or jsonb_typeof(p_query)<>'object' or p_query->>'version' is distinct from '2'
    or jsonb_typeof(p_query->'filters') is distinct from 'object' or pg_column_size(p_query)>32768
    or p_labels is null or jsonb_typeof(p_labels)<>'object' or pg_column_size(p_labels)>32768 then raise exception 'VALIDATION'; end if;
  for item in select * from jsonb_each(p_query->'filters') loop
    kind:=item.value->>'kind';
    if not item.key=any(allowed) or jsonb_typeof(item.value)<>'object' or kind is null then raise exception 'VALIDATION'; end if;
    if kind='presence' then
      if item.value->>'value' is null or item.value->>'value' not in ('present','missing') then raise exception 'VALIDATION'; end if;
    elsif kind='enum' and item.key=any(enum_fields) then
      if jsonb_typeof(item.value->'values') is distinct from 'array' then raise exception 'VALIDATION'; end if;
      if jsonb_array_length(item.value->'values') not between 1 and 100 or exists(select 1 from jsonb_array_elements(item.value->'values') v
        where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 160) then raise exception 'VALIDATION'; end if;
    elsif kind='text' and item.key=any(text_fields) then
      if jsonb_typeof(item.value->'query') is distinct from 'string' or length(item.value->>'query')>160 then raise exception 'VALIDATION'; end if;
    elsif kind='date' and item.key=any(date_fields) then
      if coalesce(item.value->>'from','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(item.value->>'to','')!~'^\d{4}-\d{2}-\d{2}$'
        or item.value->>'from'>item.value->>'to' then raise exception 'VALIDATION'; end if;
      begin perform (item.value->>'from')::date; perform (item.value->>'to')::date;
        exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION'; end;
    else raise exception 'VALIDATION'; end if;
  end loop;
  sort_field:=p_query->'sort'->>'field'; direction:=p_query->'sort'->>'direction';
  if p_query->'sort' is distinct from 'null'::jsonb and p_query->'sort' is not null and
    (sort_field is null or not sort_field=any(allowed) or sort_field in ('note','context','scope','sourceReview','sourceArrangement')
      or direction is null or direction not in ('asc','desc')) then raise exception 'VALIDATION'; end if;
  needs_fields:=p_include_facets or p_query->'filters'<>'{}'::jsonb or sort_field is not null;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts
    from public.business_course_enrollment_subjects e;
  with visible as materialized (
    select v.* from public.student_record_index_for_population(p_scope,p_search,facts,false) v where p_subjects is null or v.key=any(p_subjects)
  ), imported as materialized (
    select distinct on(coalesce('student:'||l.student_id,'lead:'||r.lead_id)) r.*,
      coalesce('student:'||l.student_id,'lead:'||r.lead_id) as subject_key
    from public.lead_source_records r join public.leads l on l.id=r.lead_id
    where r.source_system='xiaoditui' and exists(select 1 from visible v where v.key=coalesce('student:'||l.student_id,'lead:'||r.lead_id))
    order by coalesce('student:'||l.student_id,'lead:'||r.lead_id),r.created_at desc,r.id
  ), worklist as materialized (
    select w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,
      w.markers,w.periods,w.period_defaults,w.context,coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id) as subject_key,
      case when p_stage='awaiting_first_contact' then intake.completed_at end as intake_at
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
    left join public.miniapp_intakes intake on intake.id=w.miniapp_intake_id and intake.intake_kind='family'
    union all
    select 'xiaoditui:'||r.lead_id,'acquisition','小地推 · '||r.batch_label,coalesce(r.promoter,''),-2,r.row_no,
      '[]'::jsonb,jsonb_build_object('acquired',case when r.submitted_at is not null then extract(month from r.submitted_at at time zone zone)::integer||'月' end),
      '{}'::jsonb,
      (select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value)),'[]'::jsonb) from
        (values ('来源批次',r.batch_label),('获取地点',r.location_text),('获取方式',r.acquisition_method),('推广员',r.promoter),('来源备注',r.remark)) c(label,value) where nullif(btrim(value),'') is not null),
      r.subject_key,case when p_stage='awaiting_first_contact' then r.created_at end
    from imported r where not exists(select 1 from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
      where coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id)=r.subject_key)
  ), entries as materialized (
    select distinct on(v.key) v.*,coalesce(w.logical_key,v.key) as logical_key,w.kind,
      coalesce(w.group_label,'未分组') as group_label,coalesce(w.subgroup_label,'') as subgroup_label,
      case when w.intake_at is not null then -1 else coalesce(w.group_rank,1000000) end as group_rank,
      coalesce(w.source_rank,1000000) as source_rank,w.intake_at,
      coalesce(w.markers,'[]'::jsonb) as markers,
      coalesce(w.context,'[]'::jsonb) as context,coalesce(w.periods,'{}'::jsonb) as periods,coalesce(w.period_defaults,'{}'::jsonb) as period_defaults,
      coalesce(w.group_label,'未分组')||' / '||coalesce(w.subgroup_label,'') as group_key
    from visible v left join worklist w on w.subject_key=v.key
    where v.stage=p_stage and (p_batch is null or exists(select 1 from public.lead_source_records r join public.leads l on l.id=r.lead_id
      where r.batch_id=p_batch and coalesce('student:'||l.student_id,'lead:'||l.id)=v.key))
    order by v.key,
      case when w.kind=case v.stage when 'awaiting_first_contact' then 'acquisition' when 'awaiting_assessment' then 'acquisition' when 'awaiting_enrollment' then 'assessment' else 'service' end then 0 else 1 end,
      w.group_rank,w.source_rank,w.logical_key
  ), task_entries as materialized (
    select *,coalesce(nullif(periods->>period_field,''),'unknown') as period
    from entries where stage=p_stage and (p_subjects is null or key=any(p_subjects))
  ), defaults as (
    select coalesce(
      case when p_stage='awaiting_first_contact' and period_field='acquired' then
        (select period from task_entries where intake_at is not null and period<>'unknown'
          order by intake_at desc,key limit 1) end,
      max(period_defaults->>'month'),'12月') as preferred,
      case when p_stage<>'awaiting_first_contact' then max(period_defaults->>'group') end as preferred_group
    from task_entries
  ), period_totals as materialized (
    select period,count(distinct key)::integer as n,
      case when period ~ '^([1-9]|1[0-2])月$' then
        (replace(period,'月','')::integer - coalesce(nullif(regexp_replace((select preferred from defaults),'[^0-9]','','g'),''),'12')::integer + 11) % 12
        else -1 end as rank
    from task_entries group by period
  ), choice as (
    select case when p_stage='former_student' then 'all' else coalesce(nullif(p_period,''),'all') end as period
  ), period_entries as materialized (
    select t.*,pt.rank as period_rank from task_entries t join period_totals pt using(period)
      where (select period from choice)='all' or t.period=(select period from choice)
  ), group_choice as (
    select coalesce(nullif(p_group,''),'all') as label
  ), required_fields as materialized (
    select unnest(enum_fields||date_fields) as id where p_include_facets
    union select jsonb_object_keys(p_query->'filters') union select sort_field where sort_field is not null
  ), compact_subjects as materialized (
    select t.* from task_entries t where needs_fields and p_stage in ('awaiting_first_contact','awaiting_assessment')
  ), compact_payload as materialized (
    select coalesce(jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,'studentId',student_id,'leadId',lead_id)),'[]'::jsonb) as items from compact_subjects
  ), compact_collaboration as materialized (
    select c.* from public.school_list_collaboration((select items from compact_payload),actor) c
      where exists(select 1 from required_fields where id in ('group','scope'))
  ), compact_statuses as materialized (
    select s.* from public.school_source_statuses((select items from compact_payload)) s
      where exists(select 1 from required_fields where id in ('sourceReview','sourceArrangement'))
  ), compact_lead_refs as materialized (
    select s.key,l.id from compact_subjects s join public.leads l on l.id=s.lead_id or l.student_id=s.student_id
      where (select public.has_perm(actor,'student.view.all')) or l.owner_id is null or l.owner_id=actor or public.can_view_school_lead(l.id,actor)
  ), compact_recent_contact as materialized (
    select distinct on(ref.key) ref.key,c.source_record_id from compact_lead_refs ref join public.business_lead_communications c on c.lead_id=ref.id
      where exists(select 1 from required_fields where id='owner')
      order by ref.key,c.occurred_at desc nulls last,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) desc,c.id
  ), compact_source_refs as materialized (
    select s.key,h.id from compact_subjects s join public.history_import_records h on h.student_id=s.student_id
    union select l.key,h.id from compact_lead_refs l join public.history_import_records h on h.lead_id=l.id
    union select s.key,a.record_id from compact_subjects s join public.history_import_associations a on a.student_id=s.student_id
    union select ref.key,l.source_record_id from compact_lead_refs ref join public.leads l on l.id=ref.id
    union select ref.key,c.source_record_id from compact_lead_refs ref join public.lead_communications c on c.lead_id=ref.id
    union select s.key,r.source_record_id from compact_subjects s join public.activity_registrations r on r.student_id=s.student_id
    union select ref.key,r.source_record_id from compact_lead_refs ref join public.activity_registrations r on r.lead_id=ref.id
    union select s.key,a.source_record_id from compact_subjects s join public.assessment_results a on a.student_id=s.student_id
    union select ref.key,a.source_record_id from compact_lead_refs ref join public.assessment_results a on a.lead_id=ref.id
    union select s.key,e.source_record_id from compact_subjects s join public.course_enrollments e on e.student_id=s.student_id
  ), compact_source_names as materialized (
    select h.id,current_source.id is not null as current_source,
      coalesce(f.fields->>'报名服务老师',f.fields->>'学服老师',f.fields->>'确认人员') as owner_name
    from public.history_import_records h left join public.school_source_current_records current_source on current_source.id=h.id
    cross join lateral (select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员') and nullif(btrim(c->>'text'),'') is not null) f
    where h.source_format='feishu-base' and exists(select 1 from required_fields where id='owner')
      and exists(select 1 from compact_source_refs ref where ref.id=h.id)
  ), compact_owners as materialized (
    select distinct on(ref.key) ref.key,n.owner_name from compact_source_refs ref join compact_source_names n on n.id=ref.id
      left join compact_recent_contact c on c.key=ref.key where n.owner_name is not null
      order by ref.key,case when p_stage='awaiting_assessment' and c.source_record_id=ref.id then 1 when n.current_source then 2 else 3 end,ref.id
  ), field_payloads as materialized (
    select jsonb_build_object('key',t.key,'ownerId',coalesce(s.assigned_to,l.owner_id),'ownerName',coalesce(p.display_name,o.owner_name,''))
      ||coalesce(c.projection,'{}'::jsonb)||coalesce(status.status,'{}'::jsonb) as row_data
    from compact_subjects t left join public.students s on s.id=t.student_id left join public.leads l on l.id=t.lead_id
      left join public.profiles p on p.id=coalesce(s.assigned_to,l.owner_id) left join compact_owners o using(key)
      left join compact_collaboration c using(key) left join compact_statuses status using(key)
    union all
    select f.row_data from public.student_list_query_facts(p_scope,p_search,'records',p_stage,
      coalesce((select jsonb_agg(jsonb_build_object('key',t.key)) from task_entries t where needs_fields and p_stage not in ('awaiting_first_contact','awaiting_assessment')),'[]'::jsonb)) f
      where needs_fields and f.row_data is not null
  ), contact_summaries as materialized (
    select c.* from public.school_record_communication_summaries(coalesce((
      select jsonb_agg(jsonb_build_object('key',t.key,'student_id',t.student_id,'lead_id',t.lead_id)) from task_entries t
      where exists(select 1 from required_fields where id in ('note','lastContactAt'))
    ),'[]'::jsonb)) c
  ), field_rows as materialized (
    select t.key,(coalesce(f.row_data,'{}'::jsonb)||jsonb_build_object('detail',t.detail,
      'name',coalesce(s.name,l.provisional_student_name),'phone',coalesce(nullif(s.parent_phone,''),nullif(s.phone,''),l.phone,''),
      'grade',coalesce(s.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
      'note',coalesce(c.summary->>'latestNote',''),
      'lastContactAt',c.summary->>'latestAt',
      'nextContactAt',least(s.next_follow_up_at,(select min(a.due_at) from public.lead_next_actions a
        where a.lead_id=t.lead_id and a.status='open' and a.kind<>'initial_contact')),
      'context',(select string_agg(c->>'value',E'\n') from jsonb_array_elements(t.context) c))) as payload
      from task_entries t left join field_payloads f on f.row_data->>'key'=t.key
      left join public.students s on s.id=t.student_id left join public.leads l on l.id=t.lead_id
      left join contact_summaries c on c.key=t.key where needs_fields
  ), field_values as materialized (
    select r.key,(select coalesce(jsonb_object_agg(f.id,case
      when f.id='context' then public.student_list_field(jsonb_build_object('note',r.payload->>'context'),'note',p_labels,actor,zone)
      when f.id='nextContactAt' then public.student_list_field(jsonb_build_object('lastContactAt',r.payload->>'nextContactAt'),'lastContactAt',p_labels,actor,zone)
      else public.student_list_field(r.payload,f.id,p_labels,actor,zone) end),'{}'::jsonb) from required_fields f) as fields
    from field_rows r
  ), filtered as materialized (
    select distinct on(t.key) t.*,coalesce(f.fields,'{}'::jsonb) as fields from period_entries t left join field_values f using(key) where ((select label from group_choice)='all' or group_label=(select label from group_choice) or group_key=(select label from group_choice))
      and not exists(select 1 from jsonb_each(p_query->'filters') filter where not public.student_list_field_matches(f.fields->filter.key,filter.value))
      and (p_marker='' or exists(select 1 from jsonb_array_elements(markers) m where m->>'key'=p_marker))
    order by key,period_rank desc,group_rank,source_rank,logical_key
  ), totals as (select count(*)::integer as n from filtered),
  ordered as materialized (
    select f.*,row_number() over(order by
      case when sort_field is not null then coalesce((fields->sort_field->>'sortMissing')::boolean,(fields->sort_field->>'missing')::boolean,true) end,
      case when sort_field=any(date_fields) and direction='asc' then (fields->sort_field->>'sort')::numeric end asc,
      case when sort_field=any(date_fields) and direction='desc' then (fields->sort_field->>'sort')::numeric end desc,
      case when not sort_field=any(date_fields) and direction='asc' and p_locale='zh' then fields->sort_field->>'sort' end collate public.student_list_sort_zh asc,
      case when not sort_field=any(date_fields) and direction='desc' and p_locale='zh' then fields->sort_field->>'sort' end collate public.student_list_sort_zh desc,
      case when not sort_field=any(date_fields) and direction='asc' and p_locale='en' then fields->sort_field->>'sort' end collate public.student_list_sort_en asc,
      case when not sort_field=any(date_fields) and direction='desc' and p_locale='en' then fields->sort_field->>'sort' end collate public.student_list_sort_en desc,
      period_rank desc,group_rank,intake_at desc nulls last,source_rank,logical_key) as ordinal from filtered f
  ), selected as materialized (
    select * from ordered where not p_facets_only order by ordinal
      offset (least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)))-1)*p_page_size limit p_page_size
  ), details as materialized (
    select r from jsonb_array_elements(public.student_record_list_rows(
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,
        'stage',stage,'detail',detail,'created_at',created_at)) from selected),'[]'::jsonb),facts)) r
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(d.r||jsonb_build_object('worklist',jsonb_build_object(
      'id',s.logical_key,'kind',s.kind,'group',s.group_label,'subgroup',s.subgroup_label,'groupKey',s.group_key,
      'rank',s.source_rank,'markers',s.markers,'context',s.context,'period',s.period,'periods',s.periods))
      order by s.ordinal)
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
    'facets',case when not p_include_facets then '{}'::jsonb else
      (select jsonb_object_agg(f.id,jsonb_build_object('options',case when f.id=any(enum_fields) then
        coalesce((select jsonb_agg(jsonb_build_object('value',o.value,'label',o.label) order by o.label,o.value) from
          (select distinct on(v.value) v.value,coalesce(p_labels->f.id->>v.value,
            case when f.id='group' then (select name from public.school_business_groups where id::text=v.value)
              when f.id in ('owner','teacher') then (select display_name from public.profiles where id::text=v.value) end,
            e.fields->f.id->>'label',v.value) as label
            from field_values e cross join lateral jsonb_array_elements_text(e.fields->f.id->'values') v(value)
            order by v.value,e.key) o),'[]'::jsonb) else '[]'::jsonb end,
        'days',case when f.id=any(date_fields) then coalesce((select jsonb_agg(distinct e.fields->f.id->>'day' order by e.fields->f.id->>'day' desc)
          from field_values e where e.fields->f.id->>'day' is not null),'[]'::jsonb) else '[]'::jsonb end)) from required_fields f where f.id=any(enum_fields||date_fields)) end,
    'batches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'label',b.batch_label,'createdAt',b.created_at) order by b.created_at desc)
      from public.data_import_batches b where b.status='completed' and b.import_kind='leads' and exists(
        select 1 from public.lead_source_records r join public.leads l on l.id=r.lead_id join visible v on v.key=coalesce('student:'||l.student_id,'lead:'||l.id) where r.batch_id=b.id)),'[]'::jsonb),
    'counts',jsonb_build_object(
      'awaiting_first_contact',(select count(distinct key) from visible where stage='awaiting_first_contact'),
      'awaiting_assessment',(select count(*) from visible where stage='awaiting_assessment'),
      'awaiting_enrollment',(select count(*) from visible where stage='awaiting_enrollment'),
      'former_student',(select count(*) from visible where stage='former_student'),
      'awaiting_renewal',(select count(*) from visible where stage='awaiting_renewal'))
  ) into result;
  return result;
end;
$function$;

revoke all on function public.school_communication_workbench_page(text,text,text,text,text,integer,integer,text,text,text[],uuid,jsonb,text,jsonb,boolean,boolean) from public,anon;
grant execute on function public.school_communication_workbench_page(text,text,text,text,text,integer,integer,text,text,text[],uuid,jsonb,text,jsonb,boolean,boolean) to authenticated;
select pg_notify('pgrst','reload schema');
