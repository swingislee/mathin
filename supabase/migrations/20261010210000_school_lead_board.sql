-- 组长观察台：组长（含上级组织的组长）与主管、管理员可查看组织内各成员负责学生的跟进状态与记录。
-- 点的颜色由“灯规则”在页面上判断；这里提供每名学生的事实字段、成员工作量以及按组织保存的规则配置。

create table public.school_lead_board_rules (
  unit_id uuid not null references public.school_business_groups(id),
  lane text not null check (lane in ('support','teach','assess')),
  config jsonb not null check (jsonb_typeof(config)='object' and pg_column_size(config)<=32768),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (unit_id,lane)
);
alter table public.school_lead_board_rules enable row level security;

-- 组长查看范围：本组织或任一上级组织的组长；主管与管理员可查看全部组织。
create function public.can_view_school_lead_board(p_uid uuid,p_unit uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(p_uid) and exists(select 1 from public.school_business_groups where id=p_unit and archived_at is null)
    and (public.can_manage_school_groups(p_uid) or exists(select 1 from public.school_business_group_members m
      where m.user_id=p_uid and m.removed_at is null and m.is_lead and m.group_id=any(public.school_group_lineage(p_unit))));
$$;

create function public.school_lead_board_units(p_uid uuid) returns table(id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  with recursive led(id,depth) as (
    select g.id,0 from public.school_business_groups g where g.archived_at is null and public.can_manage_school_groups(p_uid)
    union select m.group_id,0 from public.school_business_group_members m join public.school_business_groups g on g.id=m.group_id
      where m.user_id=p_uid and m.removed_at is null and m.is_lead and g.archived_at is null
    union select g.id,led.depth+1 from led join public.school_business_groups g on g.parent_id=led.id where g.archived_at is null and led.depth<64
  ) select distinct id from led;
$$;

create function public.get_school_lead_board(p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_zone text; v_week timestamptz; v_unit uuid:=p_unit; v_ids uuid[]; v_units jsonb; v_members jsonb; v_support jsonb; v_teach jsonb; v_assess jsonb; v_rules jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'parentId',g.parent_id,'kind',g.kind) order by public.school_group_sort_key(g.id)),'[]'::jsonb)
    into v_units from public.school_business_groups g where g.id in(select id from public.school_lead_board_units(v_uid));
  if v_unit is null then v_unit:=(v_units->0->>'id')::uuid; end if;
  if v_unit is null then return jsonb_build_object('units','[]'::jsonb,'unitId',null,'members','[]'::jsonb,'support','[]'::jsonb,'teach','[]'::jsonb,'assess','[]'::jsonb,'rules','{}'::jsonb); end if;
  if not public.can_view_school_lead_board(v_uid,v_unit) then raise exception 'FORBIDDEN'; end if;
  v_zone:=public.get_organization_timezone_v2();
  v_week:=date_trunc('week',now() at time zone v_zone) at time zone v_zone;

  -- 组织及全部下级组织的在职成员；同一人在多处时取最贴近所选组织的一处。
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_members from (
    select distinct on(m.user_id) m.user_id,m.group_id as unit_id,m.is_lead from public.school_business_group_members m
      join public.profiles p on p.id=m.user_id and p.is_active and p.account_status='active'
      join public.school_business_groups g on g.id=m.group_id and g.archived_at is null
      where m.removed_at is null and v_unit=any(public.school_group_lineage(g.id))
      order by m.user_id,(m.group_id=v_unit) desc,m.is_lead desc,m.group_id) x;
  v_ids:=array(select (x->>'user_id')::uuid from jsonb_array_elements(v_members) x);

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'unitId',bm.unit_id,'lead',bm.is_lead,
    'roles',coalesce((select jsonb_agg(r.business_role order by r.business_role) from public.school_staff_business_roles r where r.user_id=p.id),'[]'::jsonb),
    'weekContacts',(select count(*) from public.lead_communications c where c.recorded_by=p.id and c.occurred_at>=v_week)
      +(select count(*) from public.student_follow_ups f where f.author_id=p.id and f.created_at>=v_week and f.record_state='current'),
    'weekEffective',(select count(*) from public.lead_communications c where c.recorded_by=p.id and c.occurred_at>=v_week and c.outcome='connected')
      +(select count(*) from public.student_follow_ups f where f.author_id=p.id and f.created_at>=v_week and f.record_state='current'))
    order by bm.is_lead desc,public.school_group_sort_key(bm.unit_id),p.display_name),'[]'::jsonb)
    into v_members from jsonb_to_recordset(v_members) bm(user_id uuid,unit_id uuid,is_lead boolean) join public.profiles p on p.id=bm.user_id;

  -- 学服：成员负责（学生学服负责人／线索负责人）的学生及其最近沟通事实。
  with idx as materialized (
    select i.* from public.student_stage_workspace_index('all','') i
  ), owned as materialized (
    select i.key,i.student_id,i.lead_id,i.stage,i.detail,coalesce(s.assigned_to,l.owner_id) as owner_id,
      coalesce(s.name,l.provisional_student_name,'') as name
      from idx i left join public.students s on s.id=i.student_id left join public.leads l on l.id=i.lead_id
      where coalesce(s.assigned_to,l.owner_id) =any(v_ids)
  ), subject_leads as materialized (
    select o.key,l.id from owned o join public.leads l on l.id=o.lead_id or (o.student_id is not null and l.student_id=o.student_id)
  ), comms as materialized (
    select sl.key,c.occurred_at as at,c.outcome,coalesce(c.note,'') as note from subject_leads sl join public.lead_communications c on c.lead_id=sl.id
      where not coalesce(c.source_metric_facts->'supersededProjection'='true'::jsonb,false)
    union all select o.key,f.created_at,'connected',coalesce(f.content,'') from owned o join public.student_follow_ups f on f.student_id=o.student_id and f.record_state='current'
  ), last_any as (select distinct on(key) key,at,outcome,note from comms order by key,at desc nulls last),
  last_ok as (select key,max(at) as at from comms where outcome='connected' group by key),
  attempts as (select key,count(*) as n from comms where at>=now()-interval '7 days' group by key),
  next_actions as (select sl.key,min(a.due_at) as due_at from subject_leads sl join public.lead_next_actions a on a.lead_id=sl.id and a.status='open' group by sl.key)
  select coalesce(jsonb_agg(jsonb_build_object('key',o.key,'name',o.name,'ownerId',o.owner_id,'stage',o.stage,'detail',o.detail,
    'sinceContact',case when ok.at is null then null else floor(extract(epoch from now()-ok.at)/86400)::integer end,
    'sinceAttempt',case when la.at is null then null else floor(extract(epoch from now()-la.at)/86400)::integer end,
    'lastResult',la.outcome,'summaryLength',char_length(btrim(coalesce(la.note,''))),'attempts7d',coalesce(a.n,0),
    'nextDueInDays',case when na.due_at is null then null else floor(extract(epoch from na.due_at-now())/86400)::integer end)),'[]'::jsonb)
    into v_support from owned o left join last_any la on la.key=o.key left join last_ok ok on ok.key=o.key
      left join attempts a on a.key=o.key left join next_actions na on na.key=o.key;

  -- 授课：成员负责班级的在读学生；看最近一讲学情是否登记、距上次个别沟通的天数。
  with classes as materialized (
    select c.id,c.name,c.owner_id from public.classrooms c
      where c.owner_id =any(v_ids) and c.archived_at is null and c.trashed_at is null
  ), latest as (
    select distinct on(s.classroom_id) s.classroom_id,s.id,s.ended_at from public.class_sessions s join classes c on c.id=s.classroom_id
      where s.ended_at is not null and s.deleted_at is null and s.voided_at is null order by s.classroom_id,s.ended_at desc
  ), roster as (
    select c.id as classroom_id,c.name as class_name,c.owner_id,e.student_id,e.joined_at,st.name from classes c
      join public.enrollments e on e.classroom_id=c.id and e.status='active' and e.left_at is null
      join public.students st on st.id=e.student_id and st.deleted_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('key','student:'||r.student_id,'name',r.name,'ownerId',r.owner_id,'classId',r.classroom_id,'className',r.class_name,
    'learningLogged',case when l.id is null or not exists(select 1 from public.session_learning_checks k where k.session_id=l.id) then null
      else exists(select 1 from public.session_learning_checks k join public.session_learning_check_results x on x.check_id=k.id
        where k.session_id=l.id and x.student_id=r.student_id) end,
    'hoursSinceLesson',case when l.ended_at is null then null else floor(extract(epoch from now()-l.ended_at)/3600)::integer end,
    'sinceContact',floor(extract(epoch from now()-coalesce((select max(f.created_at) from public.student_follow_ups f
      where f.student_id=r.student_id and f.record_state='current'),r.joined_at))/86400)::integer,
    'contactedEver',exists(select 1 from public.student_follow_ups f where f.student_id=r.student_id and f.record_state='current'))
    order by r.class_name,r.name),'[]'::jsonb)
    into v_teach from roster r left join latest l on l.classroom_id=r.classroom_id;

  -- 测评：成员承担的一对一测评，按预约 → 录入 → 讲解的环节和超时小时数。
  with threads as materialized (
    select t.id,t.lead_id,t.scheduled_at,coalesce(t.assessor_id,s.teacher_id) as owner_id,l.student_id,coalesce(st.name,l.provisional_student_name,'') as name
      from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id
      left join public.assessment_slots s on s.id=t.assessment_slot_id left join public.students st on st.id=l.student_id
      where t.kind='assessment_1v1' and t.state<>'cancelled' and t.scheduled_at is not null
        and t.scheduled_at>=now()-interval '30 days' and t.scheduled_at<now()+interval '14 days'
        and coalesce(t.assessor_id,s.teacher_id) =any(v_ids)
  ), facts as (
    select t.*,(select min(r.created_at) from public.assessment_results r where (r.lead_id=t.lead_id or (t.student_id is not null and r.student_id=t.student_id))
        and r.created_at>=t.scheduled_at-interval '1 day') as result_at,
      (select max(coalesce(w.sent_at,w.contacted_at)) from public.assessment_workflow_states w join public.activity_registrations ar on ar.id=w.registration_id
        where ar.lead_id=t.lead_id or (t.student_id is not null and ar.student_id=t.student_id)) as explained_at
      from threads t
  )
  select coalesce(jsonb_agg(jsonb_build_object('key',coalesce('student:'||f.student_id,'lead:'||f.lead_id),'name',f.name,'ownerId',f.owner_id,
    'scheduledAt',f.scheduled_at,
    'step',case when f.scheduled_at>now() then 'arrival' when f.result_at is null then 'record' when f.explained_at is null or f.explained_at<f.result_at then 'explain' else 'done' end,
    'hoursOver',case when f.scheduled_at>now() then 0
      when f.result_at is null then floor(extract(epoch from now()-f.scheduled_at)/3600)::integer-24
      when f.explained_at is null or f.explained_at<f.result_at then floor(extract(epoch from now()-f.result_at)/3600)::integer-48 else 0 end)
    order by f.scheduled_at),'[]'::jsonb) into v_assess from facts f;

  -- 规则：取本组织或最近的上级组织保存的配置。
  select coalesce(jsonb_object_agg(lane,jsonb_build_object('config',config,'unitId',unit_id,'updatedAt',updated_at)),'{}'::jsonb) into v_rules from (
    select distinct on(r.lane) r.lane,r.config,r.unit_id,r.updated_at from public.school_lead_board_rules r
      join unnest(public.school_group_lineage(v_unit)) with ordinality l(id,depth) on l.id=r.unit_id order by r.lane,l.depth) x;

  return jsonb_build_object('units',v_units,'unitId',v_unit,'canManageRules',public.can_view_school_lead_board(v_uid,v_unit),
    'members',v_members,'support',v_support,'teach',v_teach,'assess',v_assess,'rules',v_rules);
end $$;

-- 单名学生的近期记录：仅当该学生由组织内成员负责时可读。
create function public.get_school_lead_board_subject(p_unit uuid,p_key text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_student uuid; v_lead uuid; v_owner uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_view_school_lead_board(v_uid,p_unit) then raise exception 'FORBIDDEN'; end if;
  if p_key ~ '^student:[0-9a-f-]{36}$' then v_student:=substr(p_key,9)::uuid;
  elsif p_key ~ '^lead:[0-9a-f-]{36}$' then v_lead:=substr(p_key,6)::uuid; else raise exception 'VALIDATION'; end if;
  if not exists(
    select 1 from public.school_business_group_members m where m.removed_at is null
      and m.group_id in(select g.id from public.school_business_groups g where g.archived_at is null and p_unit=any(public.school_group_lineage(g.id)))
      and (m.user_id=(select assigned_to from public.students where id=v_student)
        or m.user_id=(select owner_id from public.leads where id=v_lead)
        or m.user_id in(select l.owner_id from public.leads l where l.student_id=v_student)
        or m.user_id in(select c.owner_id from public.enrollments e join public.classrooms c on c.id=e.classroom_id where e.student_id=v_student and e.status='active')
        or m.user_id in(select coalesce(t.assessor_id,s.teacher_id) from public.lead_invitation_threads t left join public.assessment_slots s on s.id=t.assessment_slot_id
          join public.leads l on l.id=t.lead_id where l.id=v_lead or l.student_id=v_student))) then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('records',coalesce((select jsonb_agg(x order by x->>'at' desc) from (
    select jsonb_build_object('at',c.occurred_at,'kind','contact','outcome',c.outcome,'note',coalesce(c.note,''),'by',p.display_name) as x
      from public.lead_communications c join public.leads l on l.id=c.lead_id left join public.profiles p on p.id=c.recorded_by
      where (l.id=v_lead or (v_student is not null and l.student_id=v_student)) and c.occurred_at is not null
    union all select jsonb_build_object('at',f.created_at,'kind','follow_up','outcome','connected','note',coalesce(f.content,''),'by',coalesce(p.display_name,f.author_label))
      from public.student_follow_ups f left join public.profiles p on p.id=f.author_id where f.student_id=v_student and f.record_state='current'
    order by 1 desc limit 8) r(x)),'[]'::jsonb));
end $$;

create function public.save_school_lead_board_rules(p_unit uuid,p_lane text,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); rule jsonb; cond jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_view_school_lead_board(v_uid,p_unit) then raise exception 'FORBIDDEN'; end if;
  if p_lane is null or p_lane not in ('support','teach','assess') then raise exception 'VALIDATION'; end if;
  if p_config is null then delete from public.school_lead_board_rules where unit_id=p_unit and lane=p_lane; return public.get_school_lead_board(p_unit); end if;
  if jsonb_typeof(p_config)<>'object' or pg_column_size(p_config)>32768 or p_config-array['rules','else','cadence']<>'{}'::jsonb
    or jsonb_typeof(p_config->'rules')<>'array' or jsonb_array_length(p_config->'rules')>30
    or coalesce(p_config->>'else','') not in ('gray','red','orange','yellow','green','blue')
    or (p_config ? 'cadence' and jsonb_typeof(p_config->'cadence')<>'object') then raise exception 'VALIDATION'; end if;
  for rule in select * from jsonb_array_elements(p_config->'rules') loop
    if jsonb_typeof(rule)<>'object' or rule-array['color','all']<>'{}'::jsonb or coalesce(rule->>'color','') not in ('gray','red','orange','yellow','green','blue')
      or jsonb_typeof(rule->'all')<>'array' or jsonb_array_length(rule->'all')>6 then raise exception 'VALIDATION'; end if;
    for cond in select * from jsonb_array_elements(rule->'all') loop
      if jsonb_typeof(cond)<>'array' or jsonb_array_length(cond)<>3 or jsonb_typeof(cond->0)<>'string' or length(cond->>0)>40
        or coalesce(cond->>1,'') not in ('>','>=','<','<=','=','in','notin','is','empty','present')
        or jsonb_typeof(cond->2) not in ('string','number','boolean','null') then raise exception 'VALIDATION'; end if;
    end loop;
  end loop;
  insert into public.school_lead_board_rules(unit_id,lane,config,updated_by) values(p_unit,p_lane,p_config,v_uid)
    on conflict(unit_id,lane) do update set config=excluded.config,updated_by=excluded.updated_by,updated_at=now();
  insert into public.school_collaboration_events(action,subject_id,saved_values,recorded_by)
    values('save_lead_board_rules',p_unit,jsonb_build_object('lane',p_lane,'config',p_config),v_uid);
  return public.get_school_lead_board(p_unit);
end $$;

revoke all on table public.school_lead_board_rules from public,anon,authenticated;
revoke all on function public.can_view_school_lead_board(uuid,uuid),public.school_lead_board_units(uuid),public.get_school_lead_board(uuid),
  public.get_school_lead_board_subject(uuid,text),public.save_school_lead_board_rules(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.get_school_lead_board(uuid),public.get_school_lead_board_subject(uuid,text),public.save_school_lead_board_rules(uuid,text,jsonb) to authenticated;
select pg_notify('pgrst','reload schema');
