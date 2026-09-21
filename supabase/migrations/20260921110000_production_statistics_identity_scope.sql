-- 人员沿用班级的数据用途；统计投影与业务档案、账号权限分别维护。
alter table public.profiles add column purpose text not null default 'production' check (purpose in ('production','test'));
alter table public.profiles add column staff_aliases text[] not null default '{}';
alter table public.students add column purpose text not null default 'production' check (purpose in ('production','test'));
alter table public.leads add column purpose text not null default 'production' check (purpose in ('production','test'));
grant select(purpose,staff_aliases) on public.profiles to authenticated;
grant select(purpose) on public.students,public.leads to authenticated;

create function public.preserve_identity_classification() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare label text;
begin
  label:=case tg_table_name when 'profiles' then to_jsonb(new)->>'display_name'
    when 'students' then to_jsonb(new)->>'name' else to_jsonb(new)->>'provisional_student_name' end;
  -- 导入与改名延续已确认分类；管理员可显式纠正分类，普通资料编辑不能取消标记。
  if tg_op='UPDATE' and new.purpose is distinct from old.purpose
    and current_user in ('authenticated','anon') and not public.is_admin(auth.uid()) then
    raise exception 'IDENTITY_PURPOSE_ADMIN_REQUIRED';
  end if;
  if label like '%测试%' then new.purpose:='test';end if;
  if tg_table_name='students' and new.purpose='test' then
    new.tags:=array(select distinct unnest(coalesce(new.tags,'{}')||array['测试']));
  end if;
  if tg_table_name='profiles' and tg_op='UPDATE' then
    if new.staff_aliases is distinct from old.staff_aliases
      and current_user in ('authenticated','anon') and not public.is_admin(auth.uid()) then
      raise exception 'STAFF_ALIAS_ADMIN_REQUIRED';
    end if;
    -- 已确认别称回流时维持默认姓名，保留同一账号及岗位关联。
    if new.display_name=any(old.staff_aliases) then new.display_name:=old.display_name;end if;
  end if;
  return new;
end;$$;
create trigger preserve_profile_classification before insert or update on public.profiles
  for each row execute function public.preserve_identity_classification();
create trigger preserve_student_classification before insert or update on public.students
  for each row execute function public.preserve_identity_classification();
create trigger preserve_lead_classification before insert or update on public.leads
  for each row execute function public.preserve_identity_classification();

-- 只返回给定关联的统计资格；领域视图继续使用调用者 RLS，分类不授予任何业务权限。
create function public.statistics_identity_included(p_student uuid default null,p_lead uuid default null,p_staff uuid default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.profiles p where p.id=p_staff and p.purpose='test')
    and not exists(select 1 from public.leads l where l.id=p_lead and (l.purpose='test'
      or exists(select 1 from public.profiles p where p.id=l.owner_id and p.purpose='test')
      or exists(select 1 from public.students s left join public.profiles p on p.id=s.user_id
        where s.id=l.student_id and (s.purpose='test' or p.purpose='test'))))
    and not exists(select 1 from public.students s left join public.profiles p on p.id=s.user_id
      where s.id=p_student and (s.purpose='test' or p.purpose='test'));
$$;
create function public.statistics_staff_label_included(p_label text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(p_label,'') not like '%测试%' and not exists(select 1 from public.profiles p
    where p.purpose='test' and (btrim(p.display_name)=btrim(p_label) or btrim(p_label)=any(p.staff_aliases)));
$$;
create function public.statistics_source_included(p_source text,p_facts jsonb default null) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.history_import_records h where h.id=p_source and (
    not public.statistics_identity_included(h.student_id,h.lead_id)
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(h.record_data->'cells')='array' then h.record_data->'cells' else '[]' end)c
      where (c->>'fieldName' in ('学员姓名','学生姓名') and c->>'text' like '%测试%')
        or (c->>'fieldName' in ('确认人员','跟进人','沟通人员','学科老师','学服老师') and not public.statistics_staff_label_included(c->>'text')))))
    and not exists(select 1 from jsonb_each_text(case when jsonb_typeof(p_facts->'staff')='object' then p_facts->'staff' else '{}' end)f
      where not public.statistics_staff_label_included(f.value));
$$;
revoke all on function public.preserve_identity_classification(),public.statistics_identity_included(uuid,uuid,uuid),
  public.statistics_staff_label_included(text),public.statistics_source_included(text,jsonb) from public,anon;
grant execute on function public.statistics_identity_included(uuid,uuid,uuid),public.statistics_staff_label_included(text),
  public.statistics_source_included(text,jsonb) to authenticated,service_role;

-- 名称明确包含“测试”的新增与现存记录均归入测试；特殊身份在环境内审计后按 ID 标记。
update public.profiles set purpose='test' where display_name like '%测试%';
update public.students set purpose='test' where name like '%测试%';
update public.leads set purpose='test' where provisional_student_name like '%测试%';

create view public.statistics_profiles with(security_invoker=true) as select r.* from public.profiles r where r.purpose='production';
create view public.statistics_students with(security_invoker=true) as select r.* from public.students r where public.statistics_identity_included(r.id);
create view public.statistics_leads with(security_invoker=true) as select r.* from public.leads r where public.statistics_identity_included(null,r.id);
-- 班级令牌和 term_id 仍沿用专用 RPC 的列权限；统计投影只声明实际需要的列。
create view public.statistics_classrooms with(security_invoker=true) as
  select r.id,r.name,r.grade,r.capacity,r.archived_at,r.trashed_at,r.purpose,r.course_id from public.classrooms r where r.purpose='production';
create view public.statistics_enrollments with(security_invoker=true) as select r.* from public.enrollments r
  where public.statistics_identity_included(r.student_id) and exists(select 1 from public.statistics_classrooms c where c.id=r.classroom_id);
create view public.statistics_classroom_staff_assignments with(security_invoker=true) as select r.* from public.classroom_staff_assignments r
  where public.statistics_identity_included(null,null,r.user_id) and exists(select 1 from public.statistics_classrooms c where c.id=r.classroom_id);
create view public.statistics_staff_role_members with(security_invoker=true) as select r.* from public.staff_role_members r where public.statistics_identity_included(null,null,r.user_id);
create view public.statistics_lead_source_records with(security_invoker=true) as select r.* from public.lead_source_records r where public.statistics_identity_included(null,r.lead_id);
create view public.statistics_lead_next_actions with(security_invoker=true) as select r.* from public.lead_next_actions r where public.statistics_identity_included(null,r.lead_id);
create view public.statistics_operational_leads with(security_invoker=true) as select r.* from public.operational_leads r where public.statistics_identity_included(null,r.id);
create view public.statistics_lead_communications with(security_invoker=true) as select r.* from public.business_lead_communications r
  where public.statistics_identity_included(null,r.lead_id,r.owner_id_at_contact) and public.statistics_source_included(r.source_record_id,r.source_metric_facts);
create view public.statistics_lead_invitation_threads with(security_invoker=true) as select r.* from public.lead_invitation_threads r
  where public.statistics_identity_included(null,r.lead_id,r.owner_id_at_open) and public.statistics_identity_included(null,null,r.assessor_id);
create view public.statistics_lead_invitation_events with(security_invoker=true) as select r.* from public.lead_invitation_events r
  where exists(select 1 from public.statistics_lead_invitation_threads t where t.id=r.invitation_id);
create view public.statistics_activities with(security_invoker=true) as select r.* from public.business_activities r
  where public.statistics_source_included(r.source_record_id)
    and (r.source_invitation_id is null or exists(select 1 from public.statistics_lead_invitation_threads t where t.id=r.source_invitation_id));
create view public.statistics_activity_registrations with(security_invoker=true) as select r.* from public.business_activity_registrations r
  where public.statistics_identity_included(r.student_id,r.lead_id) and public.statistics_source_included(r.source_record_id,r.source_metric_facts)
    and exists(select 1 from public.statistics_activities a where a.id=r.activity_id);
create view public.statistics_assessment_results with(security_invoker=true) as select r.* from public.business_assessment_results r
  where public.statistics_identity_included(r.student_id,r.lead_id,r.assessed_by) and public.statistics_source_included(r.source_record_id)
    and (r.activity_registration_id is null or exists(select 1 from public.statistics_activity_registrations a where a.id=r.activity_registration_id));
create view public.statistics_course_opportunities with(security_invoker=true) as select r.* from public.course_opportunities r
  where public.statistics_identity_included(r.student_id,r.lead_id,r.owner_id) and public.statistics_source_included(r.source_record_id);
create view public.statistics_course_enrollments with(security_invoker=true) as select r.* from public.business_course_enrollments r
  where public.statistics_identity_included(r.student_id) and public.statistics_source_included(r.source_record_id,r.source_metric_facts)
    and (r.opportunity_id is null or exists(select 1 from public.statistics_course_opportunities o where o.id=r.opportunity_id));
create view public.statistics_class_sessions with(security_invoker=true) as select r.* from public.class_sessions r
  where exists(select 1 from public.statistics_classrooms c where c.id=r.classroom_id) and public.statistics_identity_included(null,null,r.teacher_override);
create view public.statistics_session_attendance with(security_invoker=true) as select r.* from public.session_attendance r
  where public.statistics_identity_included(r.student_id) and exists(select 1 from public.statistics_class_sessions s where s.id=r.session_id);
create view public.statistics_class_support_tasks with(security_invoker=true) as select r.* from public.class_support_tasks r
  where public.statistics_identity_included(r.student_id,null,r.assigned_to) and exists(select 1 from public.statistics_classrooms c where c.id=r.classroom_id);
create view public.statistics_classroom_members with(security_invoker=true) as select r.* from public.classroom_members r
  where public.statistics_identity_included(null,null,r.user_id) and exists(select 1 from public.statistics_classrooms c where c.id=r.classroom_id)
    and not exists(select 1 from public.students s where s.user_id=r.user_id and not public.statistics_identity_included(s.id));
create view public.statistics_orders with(security_invoker=true) as select r.* from public.orders r
  where public.statistics_identity_included(r.student_id) and (r.classroom_id is null or exists(select 1 from public.statistics_classrooms c where c.id=r.classroom_id));
create view public.statistics_payments with(security_invoker=true) as select r.* from public.payments r where exists(select 1 from public.statistics_orders o where o.id=r.order_id);
create view public.statistics_refunds with(security_invoker=true) as select r.* from public.refunds r where exists(select 1 from public.statistics_orders o where o.id=r.order_id);

do $$ declare relation regclass;begin
  for relation in select oid::regclass from pg_class where relnamespace='public'::regnamespace and relkind='v' and relname like 'statistics_%' loop
    execute format('revoke all on %s from public,anon; grant select on %s to authenticated,service_role',relation,relation);
  end loop;
end;$$;

-- 兼容已发布分页读取与后续聚合读取：先选最新来源，再应用分类，避免旧版本复活。
do $$ declare signature text; body text; original text;relation text;begin
  foreach signature in array array['public.list_current_staff_overview_acquisition_sources(text,integer)',
    'public.staff_overview_acquisition_contact_facts_v2(text,text)'] loop
    if to_regprocedure(signature) is null then continue;end if;
    body:=pg_get_functiondef(to_regprocedure(signature));original:=body;
    if signature like '%list_current_%' then
      body:=replace(body,'select * from latest where p_after is null or id > p_after',
        'select * from latest where public.statistics_source_included(id) and (p_after is null or id > p_after)');
      body:=replace(body,'select * from latest order by id',
        'select * from latest where public.statistics_source_included(id) order by id');
    else
      foreach relation in array array['leads','lead_communications','activity_registrations','assessment_results','activities','lead_source_records','profiles'] loop
        body:=replace(body,'public.'||relation||' ','public.statistics_'||relation||' ');
      end loop;
      body:=replace(body,'from latest h left join source_leads','from (select * from latest where public.statistics_source_included(id)) h left join source_leads');
      -- 别称匹配由下方独立规则替换精确姓名条件；保留聚合的唯一匹配限制。
      body:=replace(body,'public.overview_trim_v2(p.display_name)=public.overview_trim_v2(names.label)',
        '(public.overview_trim_v2(p.display_name)=public.overview_trim_v2(names.label) or public.overview_trim_v2(names.label)=any(p.staff_aliases))');
    end if;
    if body=original then raise exception 'STATISTICS_READER_SHAPE_CHANGED: %',signature;end if;
    execute body;
  end loop;
end;$$;

-- 班级列表的正式人数与教学统计共用人员口径，测试班仍可查看完整测试花名册。
do $$ declare body text;begin
  body:=pg_get_functiondef('public.list_classrooms_for_scope(text,jsonb,integer)'::regprocedure);
  if strpos(body,'enrollment_row.status = ''active''')=0 then raise exception 'CLASS_LIST_SHAPE_CHANGED';end if;
  body:=replace(body,'enrollment_row.status = ''active''','enrollment_row.status = ''active'' and (candidate_row.purpose=''test'' or public.statistics_identity_included(enrollment_row.student_id))');
  execute body;
  body:=pg_get_functiondef('public.get_teaching_class_overview(timestamptz,timestamptz,text)'::regprocedure);
  body:=replace(body,'where s.roster_revision > 0','where s.roster_revision > 0 and public.statistics_identity_included(r.student_id)');
  body:=replace(body,'where s.roster_revision = 0','where s.roster_revision = 0 and public.statistics_identity_included(r.student_id)');
  execute body;
end;$$;
