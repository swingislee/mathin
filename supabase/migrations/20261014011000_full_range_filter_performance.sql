-- 全量筛选读取：将唯一主体键的分组、学服和字段整理为一次性查找表，避免低估 CTE 行数后反复扫描。
-- 先收集本次主体的历史来源 ID，再解析年级；基准计算和学年投影各执行一次。
-- 保留原权限、候选范围、月份多选、排序和年级优先级；只替换读取函数，不改业务数据。

CREATE OR REPLACE FUNCTION public.school_current_subject_grades(p_subjects jsonb, p_on date)
 RETURNS TABLE(key text, value jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare zone text:=public.get_organization_timezone_v2();
begin
  if p_subjects='[]'::jsonb then return; end if;
  return query
  with subjects as materialized (
    select * from jsonb_to_recordset(p_subjects) as v(key text,"studentId" uuid,"leadId" uuid)
  ), intake as materialized (
    select distinct on(v.key) v.key,r.raw_grade_text,r.submitted_at
    from subjects v join public.leads l on l.id=v."leadId" or l.student_id=v."studentId"
    join public.lead_source_records r on r.lead_id=l.id where nullif(btrim(r.raw_grade_text),'') is not null
    order by v.key,r.submitted_at desc nulls last,r.created_at desc,r.id
  ), history_refs as materialized (
    select distinct v.key,links.source_id
    from subjects v join public.school_source_subject_links links on links.subject_key=coalesce('student:'||v."studentId",'lead:'||v."leadId")
    join public.school_source_current_records cr on cr.id=links.source_id
  ), history_sources as materialized (
    select r.key,h.id,h.record_data,h.source_snapshot_date from history_refs r join public.history_import_records h on h.id=r.source_id
  ), history as materialized (
    select distinct on(h.key) h.key,public.school_source_acquisition_date(h.record_data) as acquired_on,
      fields.grade_text,case when h.record_data->>'tableName'='2026秋季在读学员表格' then 2026 end as school_year
    from history_sources h
    cross join lateral (select btrim(c->>'text') as grade_text from jsonb_array_elements(h.record_data->'cells') c
      where regexp_replace(c->>'fieldName','^A:[[:space:]]*','') in ('当前年级','年级','年级/26级','年级/25级','学生年级')
        and nullif(btrim(c->>'text'),'') is not null
      order by array_position(array['当前年级','年级','年级/26级','年级/25级','学生年级'],regexp_replace(c->>'fieldName','^A:[[:space:]]*','')) limit 1) fields
    order by h.key,public.school_source_acquisition_date(h.record_data) desc nulls last,h.source_snapshot_date desc,h.id
  ), corrections as materialized (
    select distinct on(v.key) v.key,c.after_data->>'grade' as grade_text,c.recorded_at
    from subjects v join public.school_support_change_log c on
      (v."studentId" is not null and c.student_id=v."studentId" or v."studentId" is null and c.lead_id=v."leadId")
    where c.kind='profile' and c.before_data->'grade' is distinct from c.after_data->'grade'
    order by v.key,c.recorded_at desc,c.id desc
  ), student_years as materialized (
    select distinct on(v.key) v.key,y.start_year from subjects v join public.students s on s.id=v."studentId"
    join public.student_school_year_grades g on g.student_id=s.id and g.grade=s.grade
    join public.school_years y on y.id=g.school_year_id order by v.key,y.start_year desc,g.recorded_at desc
  ), source_values as materialized (
    select (select jsonb_object_agg(i.key,to_jsonb(i)-'key') from intake i where i.key is not null) as intake,
      (select jsonb_object_agg(h.key,to_jsonb(h)-'key') from history h where h.key is not null) as history,
      (select jsonb_object_agg(c.key,to_jsonb(c)-'key') from corrections c where c.key is not null) as corrections,
      (select jsonb_object_agg(sy.key,sy.start_year) from student_years sy where sy.key is not null) as student_years
  ), bases as materialized (
    select v.key,
      case when s.grade_basis_year is not null then s.grade_basis_code
        when s.id is null and l.grade_basis_year is not null then l.grade_basis_code
        when (lookup.corrections ? v.key) then (lookup.corrections->v.key->>'grade_text')::integer
        when s.id is not null and s.grade is not null then s.grade
        when l.grade_basis_year is not null then l.grade_basis_code
        when (lookup.intake ? v.key) then public.school_grade_code((lookup.intake->v.key->>'raw_grade_text'))
        when (lookup.history ? v.key) then public.school_grade_code((lookup.history->v.key->>'grade_text'))
        else coalesce(l.grade_hint,public.school_grade_code(l.grade_text)) end as code,
      case when s.grade_basis_year is not null then s.grade_basis_year
        when s.id is null and l.grade_basis_year is not null then l.grade_basis_year
        when (lookup.corrections ? v.key) then public.school_grade_year(((lookup.corrections->v.key->>'recorded_at')::timestamptz at time zone zone)::date)
        when s.id is not null and s.grade is not null then coalesce((lookup.student_years->>v.key)::integer,(select start_year from public.school_years where id=public.current_school_year_id()),public.school_grade_year(p_on))
        when l.grade_basis_year is not null then l.grade_basis_year
        when (lookup.intake ? v.key) then case when (lookup.intake->v.key->>'submitted_at')::timestamptz is not null then greatest(2025,public.school_grade_year(((lookup.intake->v.key->>'submitted_at')::timestamptz at time zone zone)::date)) end
        when (lookup.history ? v.key) then coalesce((lookup.history->v.key->>'school_year')::integer,case when (lookup.history->v.key->>'acquired_on')::date is not null then greatest(2025,public.school_grade_year((lookup.history->v.key->>'acquired_on')::date)) end)
        when l.source_record_id is null then greatest(2025,public.school_grade_year((l.created_at at time zone zone)::date)) end as basis_year,
      coalesce((lookup.intake->v.key->>'raw_grade_text'),(lookup.history->v.key->>'grade_text'),l.grade_text,'') as raw_text
    from subjects v left join public.students s on s.id=v."studentId" left join public.leads l on l.id=v."leadId"
    cross join source_values lookup
  ), projected as materialized (
    select b.key,b.code,b.basis_year,b.raw_text,public.school_grade_projection(b.code,b.basis_year,p_on) as grade from bases b
  ) select p.key,p.grade||jsonb_build_object('gradeText',
    case when p.code is null and p.basis_year is null then p.raw_text else p.grade->>'gradeText' end) from projected p;
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_communication_workbench_page(p_stage text, p_scope text, p_search text, p_group text, p_marker text, p_page integer, p_page_size integer, p_period_field text, p_period text, p_subjects text[], p_batch uuid, p_query jsonb, p_locale text, p_labels jsonb, p_include_facets boolean, p_facets_only boolean, p_interest text, p_channel text)
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
  if p_scope='default' then
    p_scope:=case when public.is_admin(actor) then 'all'
      when exists(select 1 from public.school_group_leader_scope(actor)) then 'group' else 'mine' end;
  end if;
  if p_interest is null or p_interest not in ('','A') or p_channel is null or length(p_channel)>80 then raise exception 'VALIDATION'; end if;
  if p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','former_student')
    or p_scope is null or p_scope not in ('mine','all','group','unassigned')
    or p_search is null or length(p_search)>80 or p_group is null or length(p_group)>320
    or p_marker is null or length(p_marker)>80 or p_page is null or p_page not between 1 and 1000000
    or p_page_size is null or p_page_size not in (20,50,100)
    or p_period_field is null or p_period_field not in ('','acquired','followed','confirmed','arrived','enrolled')
    or p_period is null or (p_period not in ('','all','unknown') and (length(p_period)>100 or p_period !~ '^(unknown|([1-9]|1[0-2])月)(,(unknown|([1-9]|1[0-2])月)){0,12}$'))
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
    where r.source_system in ('xiaoditui','mathin-miniapp') and exists(select 1 from visible v where v.key=coalesce('student:'||l.student_id,'lead:'||r.lead_id))
    order by coalesce('student:'||l.student_id,'lead:'||r.lead_id),r.created_at desc,r.id
  ), worklist as materialized (
    select w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,
      w.markers,w.periods,w.period_defaults,w.context,coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id) as subject_key,
      case when p_stage='awaiting_first_contact' then intake.completed_at end as intake_at,
      w.source_record_id,case when w.miniapp_intake_id is not null then '微信扫码' when w.kind='service' then '历史服务表'
        when w.kind='assessment' then '历史测评表' else '历史获客表' end as channel
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
    left join public.miniapp_intakes intake on intake.id=w.miniapp_intake_id and intake.intake_kind='family'
    union all
    select r.source_system||':'||r.lead_id,'acquisition','未分组',coalesce(r.promoter,''),-2,r.row_no,
      '[]'::jsonb,jsonb_build_object('acquired',case when r.submitted_at is not null then extract(month from r.submitted_at at time zone zone)::integer||'月' end),
      '{}'::jsonb,
      (select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value)),'[]'::jsonb) from
        (values ('来源批次',r.batch_label),('获取地点',r.location_text),('获取方式',r.acquisition_method),('推广兼职',r.promoter),('来源备注',r.remark),('获取信息',r.raw_interest_text),('微信昵称',r.wechat_nickname),('来源年级',r.raw_grade_text)) c(label,value) where nullif(btrim(value),'') is not null),
      r.subject_key,case when p_stage='awaiting_first_contact' then r.created_at end,null::text,case when r.source_system='mathin-miniapp' then '微信扫码' else '小地推' end
    from imported r where not exists(select 1 from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
      where coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id)=r.subject_key)
  ), source_entries as materialized (
    select distinct on(v.key) v.*,coalesce(w.logical_key,v.key) as logical_key,w.kind,
      coalesce(w.group_label,'未分组') as group_label,coalesce(w.subgroup_label,'') as subgroup_label,
      case when w.intake_at is not null then -1 else coalesce(w.group_rank,1000000) end as group_rank,
      coalesce(w.source_rank,1000000) as source_rank,w.intake_at,
      coalesce(w.markers,'[]'::jsonb) as markers,
      coalesce(w.context,'[]'::jsonb) as context,coalesce(w.periods,'{}'::jsonb) as periods,coalesce(w.period_defaults,'{}'::jsonb) as period_defaults,
      coalesce(w.group_label,'未分组')||' / '||coalesce(w.subgroup_label,'') as group_key,w.source_record_id,coalesce(w.channel,'手动登记') as channel
    from visible v left join worklist w on w.subject_key=v.key
    where v.stage=p_stage and (p_batch is null or exists(select 1 from public.lead_source_records r join public.leads l on l.id=r.lead_id
      where r.batch_id=p_batch and coalesce('student:'||l.student_id,'lead:'||l.id)=v.key))
    order by v.key,
      case when w.kind=case v.stage when 'awaiting_first_contact' then 'acquisition' when 'awaiting_assessment' then 'acquisition' when 'awaiting_enrollment' then 'assessment' else 'service' end then 0 else 1 end,
      w.group_rank,w.source_rank,w.logical_key
  ), business_groups as materialized (
    select b.id,b.name,case b.source_code when '1' then 1 when '2' then 2 when '3' then 3 else 1000000+b.sort_order end as rank
    from public.school_business_groups b where b.archived_at is null and b.kind='group'
  ), subject_groups as materialized (
    select coalesce('student:'||sg.student_id,'student:'||gl.student_id,'lead:'||sg.lead_id) as key,b.name,b.rank
    from public.school_subject_groups sg join business_groups b on b.id=sg.group_id left join public.leads gl on gl.id=sg.lead_id
  ), assigned_groups as materialized (
    select distinct on(e.key) e.key,g.name,g.rank from source_entries e join subject_groups g on g.key=e.key
    order by e.key,case when g.name=e.group_label then 0 else 1 end,g.rank,g.name
  ), acquisition_groups as materialized (
    select distinct on(w.subject_key) w.subject_key,b.name,b.rank from worklist w join business_groups b on b.name=w.group_label
    where w.kind='acquisition' order by w.subject_key,w.group_rank,w.logical_key
  ), source_support as materialized (
    select w.subject_key,public.school_worklist_support_name(h.record_data) as name
    from worklist w join public.history_import_records h on h.id=w.source_record_id
    where exists(select 1 from source_entries e where e.key=w.subject_key)
  ), source_owners as materialized (
    select subject_key,case when count(distinct name)=1 then min(name) end as name
    from source_support where nullif(name,'') is not null group by subject_key
  ), entry_lookups as materialized (
    select (select jsonb_object_agg(g.key,jsonb_build_object('name',g.name,'rank',g.rank)) from assigned_groups g where g.key is not null) as assigned,
      (select jsonb_object_agg(g.subject_key,jsonb_build_object('name',g.name,'rank',g.rank)) from acquisition_groups g where g.subject_key is not null) as acquisition,
      (select jsonb_object_agg(o.subject_key,o.name) from source_owners o where o.subject_key is not null) as owners
  ), entries as materialized (
    select e.student_id,e.lead_id,e.key,e.stage,e.detail,e.created_at,e.logical_key,e.kind,
      coalesce((lookup.assigned->e.key->>'name'),(lookup.acquisition->e.key->>'name'),'未分组') as group_label,case when p_stage='awaiting_first_contact' then '' else coalesce(nullif(owner.display_name,''),(lookup.owners->>e.key),'学服待核对') end as subgroup_label,
      coalesce((lookup.assigned->e.key->>'rank')::integer,(lookup.acquisition->e.key->>'rank')::integer,1000000) as group_rank,e.source_rank,e.intake_at,e.markers,e.periods,e.period_defaults,
      coalesce((lookup.assigned->e.key->>'name'),(lookup.acquisition->e.key->>'name'),'未分组')||' / '||case when p_stage='awaiting_first_contact' then '' else coalesce(nullif(owner.display_name,''),(lookup.owners->>e.key),'学服待核对') end as group_key,
      coalesce(s.assigned_to,l.owner_id) as owner_id,coalesce(nullif(owner.display_name,''),(lookup.owners->>e.key),'') as owner_name,
      coalesce(case r.source_system when 'xiaoditui' then '小地推' when 'mathin-miniapp' then '微信扫码' end,e.channel) as channel,
      case when p_stage='awaiting_first_contact' and e.kind='service' and exists(select 1 from public.history_import_records h
        cross join lateral jsonb_array_elements(h.record_data->'cells') c where h.id=e.source_record_id
        and c->>'fieldName'='26秋报名模式' and btrim(c->>'text')='待报')
        then '旧服务表记为“26秋待报”，目前没有有效首联记录。请核对原学服、课程安排和联系电话，再补首联。' else '' end as attention,
      (select coalesce(jsonb_agg(case when c->>'label' in ('获取人员','获取人员兼职','推广兼职','确认人员','跟进人员','跟进人') and c->>'value' in ('章润','王晓妹','邱玮','汪婷婷') then c||jsonb_build_object('label','来源学服') else c end),'[]'::jsonb)
        from jsonb_array_elements(e.context) c)
        ||jsonb_build_array(jsonb_build_object('label','来源渠道','value',coalesce(case r.source_system when 'xiaoditui' then '小地推' when 'mathin-miniapp' then '微信扫码' end,e.channel)))
        ||case when r.id is not null then (select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value)),'[]'::jsonb) from
          (values ('来源批次',r.batch_label),('获取地点',r.location_text),('获取方式',r.acquisition_method),('推广兼职',r.promoter),
            ('来源备注',r.remark),('获取信息',r.raw_interest_text),('微信昵称',r.wechat_nickname),('来源年级',r.raw_grade_text)) c(label,value)
          where nullif(btrim(value),'') is not null) else '[]'::jsonb end
        ||case when e.kind='acquisition' and e.subgroup_label not in ('','未分配','章润','王晓妹','邱玮','汪婷婷') then jsonb_build_array(jsonb_build_object('label','来源经办人','value',e.subgroup_label)) else '[]'::jsonb end
        ||case when e.kind in ('service','assessment') then jsonb_build_array(jsonb_build_object('label',case when e.kind='service' then '原授课老师' else '原学服老师' end,'value',e.group_label)) else '[]'::jsonb end
        ||case when e.kind='service' and e.subgroup_label<>'' then jsonb_build_array(jsonb_build_object('label','原班序','value',e.subgroup_label)) else '[]'::jsonb end as context
    from source_entries e left join public.students s on s.id=e.student_id left join public.leads l on l.id=e.lead_id
    left join imported r on r.subject_key=e.key
    left join public.profiles owner on owner.id=coalesce(s.assigned_to,l.owner_id)
    cross join entry_lookups lookup
  ), interest_subjects as materialized (
    select e.key,e.student_id,e.lead_id from entries e where p_interest<>'' and (p_channel='' or e.channel=p_channel)
  ), interest_leads as materialized (
    select s.key,l.id from interest_subjects s join public.leads l on l.id=s.lead_id or l.student_id=s.student_id
    where public.can_view_school_lead(l.id,actor)
  ), interest_contacts as materialized (
    select ref.key,c.id,
      case when r.effective_patch?'occurredAt' then r.effective_patch->>'occurredAt' else coalesce(c.occurred_on::text,c.occurred_at::text) end as effective_date,
      case when r.effective_patch?'interestLevel' then coalesce(r.effective_patch->>'interestLevel','unknown') else nullif(c.interest_level,'') end as value
    from interest_leads ref join public.business_lead_communications c on c.lead_id=ref.id
    left join lateral (select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1) r on true
    where c.source_record_id is null or r.effective_patch is not null
  ), interest_facts as materialized (
    select v.key,v.fact||jsonb_build_object('sourceId',v.source_id,'recordId',v.source_id) as fact
    from public.school_source_status_facts_for_subjects(array(select s.key from interest_subjects s)) v where v.fact->>'type'='interest'
    union all
    select c.key,jsonb_build_object('type','interest','value',c.value,'field','沟通登记 · 意向','priority',400,'certainty','confirmed',
      'date',c.effective_date,'recordId',c.id::text) from interest_contacts c where c.value is not null
  ), interest_evidence as materialized (
    select f.key,public.school_worklist_interest(jsonb_agg(f.fact)) as interest from interest_facts f group by f.key
  ), task_entries as materialized (
    select e.*,coalesce(nullif(e.periods->>period_field,''),'unknown') as period from entries e
    where (p_channel='' or e.channel=p_channel) and (p_interest='' or exists(select 1 from interest_evidence i where i.key=e.key and i.interest=p_interest))
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
      where (select period from choice)='all' or t.period=any(string_to_array((select period from choice),','))
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
  ), field_payloads as materialized (
    select jsonb_build_object('key',t.key,'ownerId',coalesce(s.assigned_to,l.owner_id),'ownerName',coalesce(p.display_name,''))
      ||coalesce(c.projection,'{}'::jsonb)||coalesce(status.status,'{}'::jsonb) as row_data
    from compact_subjects t left join public.students s on s.id=t.student_id left join public.leads l on l.id=t.lead_id
      left join public.profiles p on p.id=coalesce(s.assigned_to,l.owner_id)
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
  ), field_grades as materialized (
    select g.* from public.school_current_subject_grades(coalesce((select jsonb_agg(jsonb_build_object('key',t.key,'studentId',t.student_id,'leadId',t.lead_id))
      from task_entries t where exists(select 1 from required_fields where id='grade')),'[]'::jsonb),(now() at time zone zone)::date) g
  ), field_rows as materialized (
    select t.key,(coalesce(f.row_data,'{}'::jsonb)||jsonb_build_object('detail',t.detail,'ownerId',t.owner_id,'ownerName',t.owner_name,
      'name',coalesce(s.name,l.provisional_student_name),'phone',coalesce(nullif(s.parent_phone,''),nullif(s.phone,''),l.phone,''),
      'grade',case when grade.value is not null then (grade.value->>'grade')::integer else coalesce(s.grade,l.grade_hint) end,'gradeText',coalesce(grade.value->>'gradeText',l.grade_text,''),
      'note',coalesce(c.summary->>'latestNote',''),
      'lastContactAt',c.summary->>'latestAt',
      'nextContactAt',least(s.next_follow_up_at,(select min(a.due_at) from public.lead_next_actions a
        where a.lead_id=t.lead_id and a.status='open' and a.kind<>'initial_contact')),
      'context',(select string_agg(c->>'value',E'\n') from jsonb_array_elements(t.context) c))) as payload
      from task_entries t left join field_payloads f on f.row_data->>'key'=t.key
      left join public.students s on s.id=t.student_id left join public.leads l on l.id=t.lead_id
      left join contact_summaries c on c.key=t.key left join field_grades grade on grade.key=t.key where needs_fields
  ), field_values as materialized (
    select r.key,(select coalesce(jsonb_object_agg(f.id,case
      when f.id='context' then public.student_list_field(jsonb_build_object('note',r.payload->>'context'),'note',p_labels,actor,zone)
      when f.id='nextContactAt' then public.student_list_field(jsonb_build_object('lastContactAt',r.payload->>'nextContactAt'),'lastContactAt',p_labels,actor,zone)
      else public.student_list_field(r.payload,f.id,p_labels,actor,zone) end),'{}'::jsonb) from required_fields f) as fields
    from field_rows r
  ), field_lookup as materialized (
    select jsonb_object_agg(f.key,f.fields) as items from field_values f
  ), filtered as materialized (
    select t.*,coalesce((f.items->t.key),'{}'::jsonb) as fields from period_entries t cross join field_lookup f where ((select label from group_choice)='all' or group_label=(select label from group_choice) or group_key=(select label from group_choice))
      and not exists(select 1 from jsonb_each(p_query->'filters') filter where not public.student_list_field_matches((f.items->t.key)->filter.key,filter.value))
      and (p_marker='' or exists(select 1 from jsonb_array_elements(markers) m where m->>'key'=p_marker))
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
      period_rank desc,group_rank,group_label,subgroup_label,intake_at desc nulls last,source_rank,logical_key) as ordinal from filtered f
  ), selected as materialized (
    select * from ordered where not p_facets_only order by ordinal
      offset (least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)))-1)*p_page_size limit p_page_size
  ), page_grades as materialized (
    select g.* from field_grades g join selected s using(key)
    union all
    select g.* from public.school_current_subject_grades(coalesce((select jsonb_agg(jsonb_build_object('key',s.key,'studentId',s.student_id,'leadId',s.lead_id))
      from selected s where not exists(select 1 from field_grades f where f.key=s.key)),'[]'::jsonb),(now() at time zone zone)::date) g
  ), details as materialized (
    select r from jsonb_array_elements(public.student_record_list_rows(
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,
        'stage',stage,'detail',detail,'created_at',created_at)) from selected),'[]'::jsonb),facts)) r
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(d.r||coalesce(grade.value-'code'-'basisYear','{}'::jsonb)||jsonb_build_object('ownerId',s.owner_id,'ownerName',s.owner_name,'worklist',jsonb_build_object(
      'id',s.logical_key,'kind',s.kind,'channel',s.channel,'attention',s.attention,'groupMode',case when p_stage='awaiting_first_contact' then 'lead' else 'support' end,'group',s.group_label,'subgroup',s.subgroup_label,'groupKey',s.group_key,
      'rank',s.source_rank,'markers',s.markers,'context',s.context,'period',s.period,'periods',s.periods))
      order by s.ordinal)
      from selected s join details d on d.r->>'key'=s.key left join page_grades grade on grade.key=s.key),'[]'::jsonb),
    'scope',p_scope,'channels',coalesce((select jsonb_agg(jsonb_build_object('key',channel,'count',n) order by channel) from (select channel,count(*) as n from entries group by channel) c),'[]'::jsonb),
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
$function$
;
