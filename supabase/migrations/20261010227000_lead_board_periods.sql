-- 组长观察台的时间维度：按周或按月选择一个时间段，所有状态按该时间段结束时刻（或当前时刻）判断，
-- 工作量只统计时间段内的记录；授课只取该时刻所在学期、未归档未结课的班级。

create function public.get_school_lead_board(p_unit uuid,p_grain text,p_anchor date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_zone text; v_from timestamptz; v_to timestamptz; v_as timestamptz; v_anchor date; v_unit uuid:=p_unit; v_ids uuid[];
  v_units jsonb; v_members jsonb; v_support jsonb; v_teach jsonb; v_assess jsonb; v_rules jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_grain is null or p_grain not in ('week','month') then raise exception 'VALIDATION'; end if;
  v_zone:=public.get_organization_timezone_v2();
  v_anchor:=coalesce(p_anchor,(now() at time zone v_zone)::date);
  if v_anchor<date '2020-01-01' or v_anchor>(now() at time zone v_zone)::date+366 then raise exception 'VALIDATION'; end if;
  v_from:=date_trunc(p_grain,v_anchor::timestamp) at time zone v_zone;
  v_to:=(date_trunc(p_grain,v_anchor::timestamp)+case when p_grain='week' then interval '7 days' else interval '1 month' end) at time zone v_zone;
  v_as:=least(now(),v_to);

  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'parentId',g.parent_id,'kind',g.kind) order by public.school_group_sort_key(g.id)),'[]'::jsonb)
    into v_units from public.school_business_groups g where g.id in(select id from public.school_lead_board_units(v_uid));
  if v_unit is null then v_unit:=(v_units->0->>'id')::uuid; end if;
  if v_unit is null then return jsonb_build_object('units','[]'::jsonb,'unitId',null,'members','[]'::jsonb,'support','[]'::jsonb,'teach','[]'::jsonb,'assess','[]'::jsonb,'rules','{}'::jsonb,
    'period',jsonb_build_object('grain',p_grain,'from',v_from,'to',v_to,'asOf',v_as,'isCurrent',v_to>now())); end if;
  if not public.can_view_school_lead_board(v_uid,v_unit) then raise exception 'FORBIDDEN'; end if;

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
    'weekContacts',(select count(*) from public.lead_communications c where c.recorded_by=p.id and c.occurred_at>=v_from and c.occurred_at<v_as)
      +(select count(*) from public.student_follow_ups f where f.author_id=p.id and f.created_at>=v_from and f.created_at<v_as and f.record_state='current'),
    'weekEffective',(select count(*) from public.lead_communications c where c.recorded_by=p.id and c.occurred_at>=v_from and c.occurred_at<v_as and c.outcome='connected')
      +(select count(*) from public.student_follow_ups f where f.author_id=p.id and f.created_at>=v_from and f.created_at<v_as and f.record_state='current'))
    order by bm.is_lead desc,public.school_group_sort_key(bm.unit_id),p.display_name),'[]'::jsonb)
    into v_members from jsonb_to_recordset(v_members) bm(user_id uuid,unit_id uuid,is_lead boolean) join public.profiles p on p.id=bm.user_id;

  -- 学服：成员当前负责的学生；沟通事实截至所选时刻。
  with idx as materialized (
    select i.* from public.student_stage_workspace_index('all','') i
  ), owned as materialized (
    select i.key,i.student_id,i.lead_id,i.stage,i.detail,coalesce(s.assigned_to,l.owner_id) as owner_id,
      coalesce(s.name,l.provisional_student_name,'') as name
      from idx i left join public.students s on s.id=i.student_id left join public.leads l on l.id=i.lead_id
      where coalesce(s.assigned_to,l.owner_id)=any(v_ids)
  ), subject_leads as materialized (
    select o.key,l.id from owned o join public.leads l on l.id=o.lead_id or (o.student_id is not null and l.student_id=o.student_id)
  ), comms as materialized (
    select sl.key,c.occurred_at as at,c.outcome,coalesce(c.note,'') as note from subject_leads sl join public.lead_communications c on c.lead_id=sl.id
      where not coalesce(c.source_metric_facts->'supersededProjection'='true'::jsonb,false) and c.occurred_at<v_as
    union all select o.key,f.created_at,'connected',coalesce(f.content,'') from owned o join public.student_follow_ups f on f.student_id=o.student_id
      and f.record_state='current' and f.created_at<v_as
  ), last_any as (select distinct on(key) key,at,outcome,note from comms order by key,at desc nulls last),
  last_ok as (select key,max(at) as at from comms where outcome='connected' group by key),
  attempts as (select key,count(*) as n from comms where at>=v_from group by key),
  next_actions as (select sl.key,min(a.due_at) as due_at from subject_leads sl join public.lead_next_actions a on a.lead_id=sl.id
    and (a.status='open' or a.completed_at>v_as) and a.created_at<v_as group by sl.key)
  select coalesce(jsonb_agg(jsonb_build_object('key',o.key,'name',o.name,'ownerId',o.owner_id,'stage',o.stage,'detail',o.detail,
    'sinceContact',case when ok.at is null then null else floor(extract(epoch from v_as-ok.at)/86400)::integer end,
    'sinceAttempt',case when la.at is null then null else floor(extract(epoch from v_as-la.at)/86400)::integer end,
    'lastResult',la.outcome,'summaryLength',char_length(btrim(coalesce(la.note,''))),'attempts7d',coalesce(a.n,0),
    'nextDueInDays',case when na.due_at is null then null else floor(extract(epoch from na.due_at-v_as)/86400)::integer end)),'[]'::jsonb)
    into v_support from owned o left join last_any la on la.key=o.key left join last_ok ok on ok.key=o.key
      left join attempts a on a.key=o.key left join next_actions na on na.key=o.key;

  -- 授课：所选时刻所在学期、未归档未结课班级的在读学生；看时间段内最近一讲的学情登记与个别沟通。
  with classes as materialized (
    select c.id,c.name,t.user_id as owner_id from public.classrooms c
      cross join lateral (select m.user_id from public.classroom_members m where m.classroom_id=c.id and m.role='teacher') t
      where t.user_id=any(v_ids) and c.archived_at is null and c.trashed_at is null and c.operational_status<>'completed'
        and exists(select 1 from public.school_terms st where st.id=c.term_id
          and (v_as at time zone v_zone)::date between coalesce(st.starts_on,'-infinity'::date) and coalesce(st.ends_on,'infinity'::date)
          and (st.starts_on is not null or st.is_current))
  ), latest as (
    select distinct on(s.classroom_id) s.classroom_id,s.id,s.ended_at from public.class_sessions s join classes c on c.id=s.classroom_id
      where s.ended_at>=v_from and s.ended_at<v_as and s.deleted_at is null and s.voided_at is null order by s.classroom_id,s.ended_at desc
  ), roster as (
    select c.id as classroom_id,c.name as class_name,c.owner_id,e.student_id,e.joined_at,st.name,(select x.label from public.class_student_labels x where x.enrollment_id=e.id) as label from classes c
      join public.enrollments e on e.classroom_id=c.id and e.status='active' and e.left_at is null
      join public.students st on st.id=e.student_id and st.deleted_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('key','student:'||r.student_id,'name',r.name,'ownerId',r.owner_id,'classId',r.classroom_id,'className',r.class_name,
    'learningLogged',case when l.id is null or not exists(select 1 from public.session_learning_checks k where k.session_id=l.id) then null
      else exists(select 1 from public.session_learning_checks k join public.session_learning_check_results x on x.check_id=k.id
        where k.session_id=l.id and x.student_id=r.student_id and x.marked_at<v_as) end,
    'hoursSinceLesson',case when l.ended_at is null then null else floor(extract(epoch from v_as-l.ended_at)/3600)::integer end,
    'sinceContact',greatest(0,floor(extract(epoch from v_as-coalesce((select max(f.created_at) from public.student_follow_ups f
      where f.student_id=r.student_id and f.record_state='current' and f.created_at<v_as),r.joined_at))/86400)::integer),
    'label',r.label,'contactedEver',exists(select 1 from public.student_follow_ups f where f.student_id=r.student_id and f.record_state='current' and f.created_at<v_as))
    order by r.class_name,r.name),'[]'::jsonb)
    into v_teach from roster r left join latest l on l.classroom_id=r.classroom_id;

  -- 测评：时间段内的一对一测评，按截至所选时刻的环节和超时小时数。
  with threads as materialized (
    select t.id,t.lead_id,t.scheduled_at,coalesce(t.assessor_id,s.teacher_id) as owner_id,l.student_id,coalesce(st.name,l.provisional_student_name,'') as name
      from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id
      left join public.assessment_slots s on s.id=t.assessment_slot_id left join public.students st on st.id=l.student_id
      where t.kind='assessment_1v1' and t.state<>'cancelled' and t.scheduled_at is not null
        and t.scheduled_at>=v_from and t.scheduled_at<v_to and coalesce(t.assessor_id,s.teacher_id)=any(v_ids)
  ), facts as (
    select t.*,(select min(r.created_at) from public.assessment_results r where (r.lead_id=t.lead_id or (t.student_id is not null and r.student_id=t.student_id))
        and r.created_at>=t.scheduled_at-interval '1 day' and r.created_at<v_as) as result_at,
      (select max(coalesce(w.sent_at,w.contacted_at)) from public.assessment_workflow_states w join public.activity_registrations ar on ar.id=w.registration_id
        where (ar.lead_id=t.lead_id or (t.student_id is not null and ar.student_id=t.student_id)) and coalesce(w.sent_at,w.contacted_at)<v_as) as explained_at
      from threads t
  )
  select coalesce(jsonb_agg(jsonb_build_object('key',coalesce('student:'||f.student_id,'lead:'||f.lead_id),'name',f.name,'ownerId',f.owner_id,
    'scheduledAt',f.scheduled_at,
    'step',case when f.scheduled_at>v_as then 'arrival' when f.result_at is null then 'record' when f.explained_at is null or f.explained_at<f.result_at then 'explain' else 'done' end,
    'hoursOver',case when f.scheduled_at>v_as then 0
      when f.result_at is null then floor(extract(epoch from v_as-f.scheduled_at)/3600)::integer-24
      when f.explained_at is null or f.explained_at<f.result_at then floor(extract(epoch from v_as-f.result_at)/3600)::integer-48 else 0 end)
    order by f.scheduled_at),'[]'::jsonb) into v_assess from facts f;

  select coalesce(jsonb_object_agg(lane,jsonb_build_object('config',config,'unitId',unit_id,'updatedAt',updated_at)),'{}'::jsonb) into v_rules from (
    select distinct on(r.lane) r.lane,r.config,r.unit_id,r.updated_at from public.school_lead_board_rules r
      join unnest(public.school_group_lineage(v_unit)) with ordinality l(id,depth) on l.id=r.unit_id order by r.lane,l.depth) x;

  return jsonb_build_object('units',v_units,'unitId',v_unit,'canManageRules',public.can_view_school_lead_board(v_uid,v_unit),
    'members',v_members,'support',v_support,'teach',v_teach,'assess',v_assess,'rules',v_rules,
    'period',jsonb_build_object('grain',p_grain,'from',v_from,'to',v_to,'asOf',v_as,'isCurrent',v_to>now()));
end $$;

-- 旧签名保留为“本周”。
create or replace function public.get_school_lead_board(p_unit uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select public.get_school_lead_board(p_unit,'week',null);
$$;

revoke all on function public.get_school_lead_board(uuid,text,date) from public,anon,authenticated;
grant execute on function public.get_school_lead_board(uuid,text,date) to authenticated;
select pg_notify('pgrst','reload schema');
