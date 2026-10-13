create function public.school_worklist_support_name(p_record jsonb) returns text
language sql stable set search_path=public,pg_temp as $$
  select btrim(c->>'text') from jsonb_array_elements(coalesce(p_record->'cells','[]'::jsonb)) c
  where nullif(btrim(c->>'text'),'') is not null and (
    c->>'fieldName' in ('学服老师','主线服务老师','报名服务老师','非在读-学服')
    or c->>'fieldName' in ('确认人员','跟进人员','跟进人','获取人员','获取人员兼职') and btrim(c->>'text') in ('章润','王晓妹','邱玮','汪婷婷'))
  order by array_position(array['学服老师','主线服务老师','报名服务老师','非在读-学服','确认人员','跟进人员','跟进人','获取人员','获取人员兼职'],c->>'fieldName') limit 1
$$;
revoke all on function public.school_worklist_support_name(jsonb) from public,anon,authenticated,service_role;

-- 定向更新当前函数，保留月份多选等独立增量。
do $summary$
declare definition text;
begin
  definition:=pg_get_functiondef('public.school_communication_workbench_page(text,text,text,text,text,integer,integer,text,text,text[],uuid,jsonb,text,jsonb,boolean,boolean,text,text)'::regprocedure);
  if position($anchor$  ), entries as materialized ($anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_0_CHANGED'; end if;
  definition:=replace(definition,$anchor$  ), entries as materialized ($anchor$,$value$  ), source_support as materialized (
    select w.subject_key,public.school_worklist_support_name(h.record_data) as name
    from worklist w join public.history_import_records h on h.id=w.source_record_id
    where exists(select 1 from source_entries e where e.key=w.subject_key)
  ), source_owners as materialized (
    select subject_key,case when count(distinct name)=1 then min(name) end as name
    from source_support where nullif(name,'') is not null group by subject_key
  ), entries as materialized ($value$);
  if position($anchor$coalesce(nullif(owner.display_name,''),'待分配')$anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_1_CHANGED'; end if;
  definition:=replace(definition,$anchor$coalesce(nullif(owner.display_name,''),'待分配')$anchor$,$value$coalesce(nullif(owner.display_name,''),so.name,'学服待核对')$value$);
  if position($anchor$coalesce(owner.display_name,'') as owner_name$anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_2_CHANGED'; end if;
  definition:=replace(definition,$anchor$coalesce(owner.display_name,'') as owner_name$anchor$,$value$coalesce(nullif(owner.display_name,''),so.name,'') as owner_name$value$);
  if position($anchor$case when c->>'label' in ('确认人员','跟进人员') then c||jsonb_build_object('label','推广兼职') else c end$anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_3_CHANGED'; end if;
  definition:=replace(definition,$anchor$case when c->>'label' in ('确认人员','跟进人员') then c||jsonb_build_object('label','推广兼职') else c end$anchor$,$value$case when c->>'label' in ('获取人员','获取人员兼职','推广兼职','确认人员','跟进人员','跟进人') and c->>'value' in ('章润','王晓妹','邱玮','汪婷婷') then c||jsonb_build_object('label','来源学服') else c end$value$);
  if position($anchor$||case when e.kind='acquisition' and e.subgroup_label<>'' then jsonb_build_array(jsonb_build_object('label','推广兼职','value',e.subgroup_label)) else '[]'::jsonb end$anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_4_CHANGED'; end if;
  definition:=replace(definition,$anchor$||case when e.kind='acquisition' and e.subgroup_label<>'' then jsonb_build_array(jsonb_build_object('label','推广兼职','value',e.subgroup_label)) else '[]'::jsonb end$anchor$,$value$||case when e.kind='acquisition' and e.subgroup_label not in ('','未分配','章润','王晓妹','邱玮','汪婷婷') then jsonb_build_array(jsonb_build_object('label','来源经办人','value',e.subgroup_label)) else '[]'::jsonb end$value$);
  if position($anchor$    left join imported r on r.subject_key=e.key$anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_5_CHANGED'; end if;
  definition:=replace(definition,$anchor$    left join imported r on r.subject_key=e.key$anchor$,$value$    left join imported r on r.subject_key=e.key
    left join source_owners so on so.subject_key=e.key$value$);
  if position($anchor$  ), field_rows as materialized ($anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_6_CHANGED'; end if;
  definition:=replace(definition,$anchor$  ), field_rows as materialized ($anchor$,$value$  ), field_grades as materialized (
    select g.* from public.school_current_subject_grades(coalesce((select jsonb_agg(jsonb_build_object('key',t.key,'studentId',t.student_id,'leadId',t.lead_id))
      from task_entries t where exists(select 1 from required_fields where id='grade')),'[]'::jsonb),(now() at time zone zone)::date) g
  ), field_rows as materialized ($value$);
  if position($anchor$'grade',coalesce(s.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),$anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_7_CHANGED'; end if;
  definition:=replace(definition,$anchor$'grade',coalesce(s.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),$anchor$,$value$'grade',case when grade.value is not null then (grade.value->>'grade')::integer else coalesce(s.grade,l.grade_hint) end,'gradeText',coalesce(grade.value->>'gradeText',l.grade_text,''),$value$);
  if position($anchor$      left join contact_summaries c on c.key=t.key where needs_fields$anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_8_CHANGED'; end if;
  definition:=replace(definition,$anchor$      left join contact_summaries c on c.key=t.key where needs_fields$anchor$,$value$      left join contact_summaries c on c.key=t.key left join field_grades grade on grade.key=t.key where needs_fields$value$);
  if position($anchor$  ), details as materialized ($anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_9_CHANGED'; end if;
  definition:=replace(definition,$anchor$  ), details as materialized ($anchor$,$value$  ), page_grades as materialized (
    select g.* from field_grades g join selected s using(key)
    union all
    select g.* from public.school_current_subject_grades(coalesce((select jsonb_agg(jsonb_build_object('key',s.key,'studentId',s.student_id,'leadId',s.lead_id))
      from selected s where not exists(select 1 from field_grades f where f.key=s.key)),'[]'::jsonb),(now() at time zone zone)::date) g
  ), details as materialized ($value$);
  if position($anchor$jsonb_agg(d.r||jsonb_build_object('ownerId',s.owner_id$anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_10_CHANGED'; end if;
  definition:=replace(definition,$anchor$jsonb_agg(d.r||jsonb_build_object('ownerId',s.owner_id$anchor$,$value$jsonb_agg(d.r||coalesce(grade.value-'code'-'basisYear','{}'::jsonb)||jsonb_build_object('ownerId',s.owner_id$value$);
  if position($anchor$from selected s join details d on d.r->>'key'=s.key$anchor$ in definition)=0 then raise exception 'SUMMARY_ANCHOR_11_CHANGED'; end if;
  definition:=replace(definition,$anchor$from selected s join details d on d.r->>'key'=s.key$anchor$,$value$from selected s join details d on d.r->>'key'=s.key left join page_grades grade on grade.key=s.key$value$);
  execute definition;
end $summary$;
notify pgrst,'reload schema';
