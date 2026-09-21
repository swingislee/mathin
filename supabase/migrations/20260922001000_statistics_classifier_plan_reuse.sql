-- 统计资格保留即时判定与原有权限；复用语句计划，跳过不存在的关联。
-- SQL SECURITY DEFINER 的复合查询在逐行调用时重复规划；PL/pgSQL 为各静态语句复用计划。
create or replace function public.statistics_identity_included(p_student uuid default null,p_lead uuid default null,p_staff uuid default null)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if p_staff is not null and exists(select 1 from public.profiles p where p.id=p_staff and p.purpose='test') then
    return false;
  end if;
  if p_student is not null and exists(select 1 from public.students s left join public.profiles p on p.id=s.user_id
    where s.id=p_student and (s.purpose='test' or p.purpose='test')) then
    return false;
  end if;
  if p_lead is not null and exists(select 1 from public.leads l
    left join public.profiles owner_profile on owner_profile.id=l.owner_id
    left join public.students s on s.id=l.student_id
    left join public.profiles student_profile on student_profile.id=s.user_id
    where l.id=p_lead and (l.purpose='test' or owner_profile.purpose='test' or s.purpose='test' or student_profile.purpose='test')) then
    return false;
  end if;
  return true;
end;$$;

create or replace function public.statistics_staff_label_included(p_label text) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if coalesce(p_label,'') like '%测试%' then return false;end if;
  if p_label is null then return true;end if;
  return not exists(select 1 from public.profiles p where p.purpose='test'
    and (btrim(p.display_name)=btrim(p_label) or btrim(p_label)=any(p.staff_aliases)));
end;$$;

create or replace function public.statistics_source_included(p_source text,p_facts jsonb default null) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare source_row record;cell jsonb;label text;
begin
  if p_source is not null then
    select h.student_id,h.lead_id,h.record_data->'cells' as cells into source_row
      from public.history_import_records h where h.id=p_source;
    if found then
      if not public.statistics_identity_included(source_row.student_id,source_row.lead_id) then return false;end if;
      for cell in select value from jsonb_array_elements(case when jsonb_typeof(source_row.cells)='array' then source_row.cells else '[]'::jsonb end) loop
        if cell->>'fieldName' in ('学员姓名','学生姓名') and cell->>'text' like '%测试%' then return false;end if;
        if cell->>'fieldName' in ('确认人员','跟进人','沟通人员','学科老师','学服老师')
          and not public.statistics_staff_label_included(cell->>'text') then return false;end if;
      end loop;
    end if;
  end if;
  for label in select value from jsonb_each_text(case when jsonb_typeof(p_facts->'staff')='object' then p_facts->'staff' else '{}'::jsonb end) loop
    if not public.statistics_staff_label_included(label) then return false;end if;
  end loop;
  return true;
end;$$;

-- CREATE OR REPLACE 保持已有 owner、ACL、函数签名、视图和 RLS。

-- 与单条资格函数相同，仅返回调用者提供的候选 ID，不枚举额外身份或历史档案。
-- 候选由 security_invoker 视图在调用者 RLS 下产生，批量分类不授予业务可见性。
create function public.statistics_included_candidates_v2(p_candidates jsonb) returns setof text
language sql stable security definer set search_path=public,pg_temp as $$
  with candidates as materialized (
    select * from jsonb_to_recordset(p_candidates) as r(id text,student_id uuid,lead_id uuid,staff_ids uuid[],source_id text,staff_labels jsonb)
  ), test_staff as materialized (
    select id,display_name,staff_aliases from public.profiles where purpose='test'
  ), test_students as materialized (
    select s.id from public.students s where s.purpose='test' or s.user_id in(select id from test_staff)
  ), test_leads as materialized (
    select l.id from public.leads l where l.purpose='test' or l.owner_id in(select id from test_staff)
      or l.student_id in(select id from test_students)
  ), test_labels as materialized (
    select btrim(display_name) as label from test_staff union select unnest(staff_aliases) from test_staff
  ), source_ids as materialized (
    select distinct source_id from candidates where source_id is not null
  ), excluded_sources as materialized (
    select h.id from public.history_import_records h join source_ids i on i.source_id=h.id
    where h.student_id in(select id from test_students) or h.lead_id in(select id from test_leads)
      or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(h.record_data->'cells')='array' then h.record_data->'cells' else '[]'::jsonb end)c
        where (c->>'fieldName' in ('学员姓名','学生姓名') and c->>'text' like '%测试%')
          or (c->>'fieldName' in ('确认人员','跟进人','沟通人员','学科老师','学服老师')
            and (c->>'text' like '%测试%' or btrim(c->>'text') in(select label from test_labels))))
  )
  select c.id from candidates c
  where not exists(select 1 from test_students s where s.id=c.student_id)
    and not exists(select 1 from test_leads l where l.id=c.lead_id)
    and not exists(select 1 from test_staff p where p.id=any(c.staff_ids))
    and not exists(select 1 from excluded_sources s where s.id=c.source_id)
    and not exists(select 1 from jsonb_each_text(case when jsonb_typeof(c.staff_labels)='object' then c.staff_labels else '{}'::jsonb end) f
      where f.value like '%测试%' or btrim(f.value) in(select label from test_labels));
$$;
do $$ begin
  execute format('alter function public.statistics_included_candidates_v2(jsonb) owner to %I',
    (select pg_get_userbyid(proowner) from pg_proc where oid='public.statistics_source_included(text,jsonb)'::regprocedure));
end;$$;
revoke all on function public.statistics_included_candidates_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.statistics_included_candidates_v2(jsonb) to authenticated,service_role;

-- 只分类当前调用者可见的窄候选，保留原列顺序、嵌套业务关系和底层 RLS。
-- 外层继续从原业务视图取字段，避免将完整事实正文复制进分类集合。
do $views$
declare spec record;columns_sql text;candidate_sql text;view_name text;
begin
  for spec in select * from (values
    ('students','students','c.id','null','null','null','null',''),
    ('leads','leads','null','c.id','null','null','null',''),
    ('lead_source_records','lead_source_records','null','c.lead_id','null','null','null',''),
    ('lead_next_actions','lead_next_actions','null','c.lead_id','null','null','null',''),
    ('operational_leads','operational_leads','null','c.id','null','null','null',''),
    ('lead_communications','business_lead_communications','null','c.lead_id','array[c.owner_id_at_contact]','c.source_record_id','c.source_metric_facts->''staff''',''),
    ('lead_invitation_threads','lead_invitation_threads','null','c.lead_id','array[c.owner_id_at_open,c.assessor_id]','null','null',''),
    ('activities','business_activities','null','null','null','c.source_record_id','null',
      'and (r.source_invitation_id is null or r.source_invitation_id in(select id from public.statistics_lead_invitation_threads))'),
    ('activity_registrations','business_activity_registrations','c.student_id','c.lead_id','null','c.source_record_id','c.source_metric_facts->''staff''',
      'and r.activity_id in(select id from public.statistics_activities)'),
    ('assessment_results','business_assessment_results','c.student_id','c.lead_id','array[c.assessed_by]','c.source_record_id','null',
      'and (r.activity_registration_id is null or r.activity_registration_id in(select id from public.statistics_activity_registrations))'),
    ('course_opportunities','course_opportunities','c.student_id','c.lead_id','array[c.owner_id]','c.source_record_id','null',''),
    ('course_enrollments','business_course_enrollments','c.student_id','null','null','c.source_record_id','c.source_metric_facts->''staff''',
      'and (r.opportunity_id is null or r.opportunity_id in(select id from public.statistics_course_opportunities))')
  ) as definitions(relation,base,student,lead,staff,source,labels,related) loop
    view_name:='statistics_'||spec.relation;
    if not exists(select 1 from pg_class where oid=('public.'||view_name)::regclass and relkind='v'
      and reloptions @> array['security_invoker=true']) then raise exception 'STATISTICS_VIEW_CONTRACT_CHANGED: %',view_name;end if;
    select string_agg(format('r.%I',attname),',' order by attnum) into columns_sql
      from pg_attribute where attrelid=('public.'||view_name)::regclass and attnum>0 and not attisdropped;
    candidate_sql:=format('select public.statistics_included_candidates_v2(coalesce(jsonb_agg(jsonb_build_object(
      ''id'',c.id,''student_id'',%s,''lead_id'',%s,''staff_ids'',%s,''source_id'',%s,''staff_labels'',%s)),''[]''::jsonb))
      as id from public.%I c',spec.student,spec.lead,spec.staff,spec.source,spec.labels,spec.base);
    execute format('create or replace view public.%I with(security_invoker=true) as
      with eligible as materialized (%s)
      select %s from public.%I r where r.id::text in (select id from eligible) %s',view_name,candidate_sql,columns_sql,spec.base,spec.related);
  end loop;
end;
$views$;

-- 保留先选最新版本、后分类的顺序；单次快照和聚合出口共同切换。
do $readers$
declare signature text;body text;original text;
begin
  foreach signature in array array['public.list_current_staff_overview_acquisition_sources(text,integer)',
    'public.staff_overview_acquisition_contact_facts_v2(text,text)'] loop
    body:=pg_get_functiondef(signature::regprocedure);original:=body;
    body:=replace(body,'public.statistics_source_included(id)',
      'id in (select public.statistics_included_candidates_v2(coalesce(jsonb_agg(jsonb_build_object(''id'',x.id,''source_id'',x.id)),''[]''::jsonb)) from latest x)');
    if body=original then raise exception 'STATISTICS_READER_SHAPE_CHANGED: %',signature;end if;
    execute body;
  end loop;
end;
$readers$;
