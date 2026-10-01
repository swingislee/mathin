-- 家长独立 1 对 1 测评复用邀约协调事实；具体时间由双方候选格确认。
-- 请求元数据与可修改的协调字段分开保存，供同一客户端 UUID 原子重放。
alter table public.lead_invitation_threads
  add column parent_request_actor uuid references public.profiles(id) on delete restrict,
  add column parent_request_payload jsonb,
  add constraint lead_invitation_threads_parent_request_check check (
    (parent_request_actor is null and parent_request_payload is null)
    or (
      parent_request_actor is not null and parent_request_payload is not null
      and kind = 'assessment_1v1'
      and jsonb_typeof(parent_request_payload) = 'object'
      and parent_request_payload ?& array['version','studentId','assessorId','parentTimeOptions']
      and parent_request_payload->>'version' = '1'
      and jsonb_typeof(parent_request_payload->'studentId') = 'string'
      and jsonb_typeof(parent_request_payload->'assessorId') = 'string'
      and jsonb_typeof(parent_request_payload->'parentTimeOptions') = 'array'
    )
  );

comment on column public.lead_invitation_threads.parent_request_actor is
  '首次家长请求的账号；与初始 payload 一同保持不可变。邀约 id 同时作为客户端请求 UUID。';
comment on column public.lead_invitation_threads.parent_request_payload is
  '版本、已授权学生 UUID、教师 UUID 和排序后的初始候选格；仅用于幂等核对，不向家长接口暴露。';

create function public.guard_parent_assessment_request_metadata() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.parent_request_actor is distinct from old.parent_request_actor
    or new.parent_request_payload is distinct from old.parent_request_payload then
    raise exception 'PARENT_REQUEST_IMMUTABLE';
  end if;
  return new;
end
$$;

create trigger lead_invitation_threads_parent_request_immutable
  before update of parent_request_actor,parent_request_payload on public.lead_invitation_threads
  for each row execute function public.guard_parent_assessment_request_metadata();

-- 严格解析现有时间格：非法日历日期和“放学后”均不转换为预约时间。
create function public.parent_assessment_time_at(p_time_option text) returns timestamptz
language plpgsql immutable set search_path=public,pg_temp as $$
declare v_date date;
begin
  if p_time_option is null or p_time_option !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}@(09:50|10:00|14:00|16:00|17:00|17:30|19:20)$' then
    return null;
  end if;
  begin
    v_date := split_part(p_time_option,'@',1)::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    return null;
  end;
  if to_char(v_date,'YYYY-MM-DD') <> split_part(p_time_option,'@',1) then return null; end if;
  return (v_date + split_part(p_time_option,'@',2)::time) at time zone 'Asia/Shanghai';
end
$$;

-- 当前报名与真实教学责任限定教师范围；历史参与留痕不授予新邀约资格。
create function public.parent_assessment_eligible_teachers(p_student_id uuid)
returns table(id uuid,display_name text)
language sql security definer stable set search_path=public,pg_temp as $$
  select p.id,p.display_name from public.profiles p
  where p.role in ('staff','admin') and p.is_active and p.account_status='active'
    and public.has_perm(p.id,'review.write')
    and exists (
      select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
      where e.student_id=p_student_id and e.status='active' and e.left_at is null
        and c.operational_status='active' and c.archived_at is null and c.trashed_at is null
        and (c.owner_id=p.id or exists (
          select 1 from public.classroom_staff_assignments a
          where a.classroom_id=c.id and a.user_id=p.id
            and a.responsibility in ('primary_teacher','assistant_teacher')
        ))
    )
  order by p.display_name,p.id limit 100;
$$;

create function public.parent_assessment_request_blocker(p_student_id uuid) returns text
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_count bigint; v_status text;
begin
  select count(*),min(l.status) into v_count,v_status from public.leads l where l.student_id=p_student_id;
  if v_count=0 then return 'NO_LINKED_LEAD'; end if;
  if v_count>1 then return 'AMBIGUOUS_LINKED_LEAD'; end if;
  if v_status='invalid' then return 'LEAD_UNAVAILABLE'; end if;
  if exists (
    select 1 from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id
    where l.student_id=p_student_id and t.state not in ('completed','cancelled')
  ) then return 'ACTIVE_INVITATION'; end if;
  if not exists(select 1 from public.parent_assessment_eligible_teachers(p_student_id)) then
    return 'NO_ELIGIBLE_TEACHER';
  end if;
  return null;
end
$$;

-- 私有安全投影；只由已完成当前亲子授权的入口调用。
create function public.parent_assessment_request_projection(p_invitation_id uuid,p_student_id uuid) returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'id',t.id,'participantId',l.student_id,
    'teacher',case when p.id is null then null else jsonb_build_object('id',p.id,'displayName',p.display_name) end,
    'state',t.state,'parentTimeOptions',to_jsonb(t.parent_time_options),
    'teacherTimeOptions',to_jsonb(t.assessor_time_options),'sharedTimeOptions',to_jsonb(shared.options),
    'proposedStartsAt',case when t.state='awaiting_parent' then t.scheduled_at else null end,
    'scheduledAt',case when t.state in ('confirmed','completed') then t.scheduled_at else null end,
    'updatedAt',t.updated_at,
    'canConfirm',coalesce(t.state='awaiting_parent' and l.status<>'invalid'
      and p.role in ('staff','admin') and p.is_active and p.account_status='active'
      and public.has_perm(p.id,'review.write') and cardinality(shared.options)>0,false)
  )
  from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id
  left join public.profiles p on p.id=t.assessor_id
  cross join lateral (
    select array(
      select distinct option_value from unnest(t.parent_time_options) option_value
      where option_value=any(t.assessor_time_options) and public.parent_assessment_time_at(option_value)>now()
      order by option_value
    ) options
  ) shared
  where t.id=p_invitation_id and l.student_id=p_student_id and t.kind='assessment_1v1';
$$;

create function public.parent_assessment_overview(p_student_id uuid) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_blocker text; v_teachers jsonb; v_requests jsonb;
begin
  if not public.miniapp_can_participate(p_student_id,'grades')
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'FORBIDDEN'; end if;
  v_blocker := public.parent_assessment_request_blocker(p_student_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'displayName',t.display_name) order by t.display_name,t.id),'[]'::jsonb)
    into v_teachers from public.parent_assessment_eligible_teachers(p_student_id) t;
  select coalesce(jsonb_agg(public.parent_assessment_request_projection(t.id,p_student_id) order by t.updated_at desc,t.id desc),'[]'::jsonb)
    into v_requests from (
      select t.id,t.updated_at from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id
      where l.student_id=p_student_id and t.kind='assessment_1v1'
      order by t.updated_at desc,t.id desc limit 100
    ) t;
  return jsonb_build_object('participantId',p_student_id,'timeZone','Asia/Shanghai',
    'eligibility',jsonb_build_object('canRequest',v_blocker is null,'reason',v_blocker),
    'teachers',v_teachers,'requests',v_requests);
end
$$;

create function public.request_parent_assessment(
  p_request_id uuid,p_student_id uuid,p_assessor_id uuid,p_parent_time_options text[]
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_options text[]; v_payload jsonb; v_blocker text;
  v_invitation public.lead_invitation_threads%rowtype; v_lead public.leads%rowtype;
  v_option text; v_time timestamptz;
begin
  if not public.miniapp_can_participate(p_student_id,'grades')
    or not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null or p_assessor_id is null or p_parent_time_options is null
    or cardinality(p_parent_time_options) not between 1 and 84 or array_ndims(p_parent_time_options)<>1
    then raise exception 'VALIDATION'; end if;
  if array_position(p_parent_time_options,null) is not null then raise exception 'VALIDATION'; end if;
  v_options := array(select distinct option_value from unnest(p_parent_time_options) option_value order by option_value);
  if cardinality(v_options)<>cardinality(p_parent_time_options) then raise exception 'VALIDATION'; end if;
  v_payload := jsonb_build_object('version',1,'studentId',p_student_id,'assessorId',p_assessor_id,'parentTimeOptions',to_jsonb(v_options));

  perform pg_advisory_xact_lock(hashtextextended('parent-assessment-request:'||p_request_id::text,0));
  select * into v_invitation from public.lead_invitation_threads where id=p_request_id for update;
  if found then
    if not public.miniapp_can_participate(p_student_id,'grades')
      or not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'FORBIDDEN'; end if;
    if v_invitation.parent_request_actor is distinct from v_uid
      or v_invitation.parent_request_payload is distinct from v_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    -- 已保存的请求先重放；后续协调修改、教师调岗或时间经过均不创建第二条邀约。
    if not exists(select 1 from public.leads where id=v_invitation.lead_id and student_id=p_student_id)
      then raise exception 'NOT_FOUND'; end if;
    return public.parent_assessment_request_projection(v_invitation.id,p_student_id);
  end if;

  -- 串行化同一学生的新请求，并锁定作为身份桥梁的既有 lead。
  perform 1 from public.students where id=p_student_id for update;
  select * into v_lead from public.leads where student_id=p_student_id order by id limit 1 for update;
  if not public.miniapp_can_participate(p_student_id,'grades')
    or not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'FORBIDDEN'; end if;
  v_blocker := public.parent_assessment_request_blocker(p_student_id);
  if v_blocker is not null then raise exception '%',v_blocker; end if;
  if not exists(select 1 from public.parent_assessment_eligible_teachers(p_student_id) where id=p_assessor_id)
    then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  if not public.valid_assessment_time_options(v_options) then raise exception 'VALIDATION'; end if;
  foreach v_option in array v_options loop
    v_time := public.parent_assessment_time_at(replace(v_option,'@after_school','@19:20'));
    if v_time is null then raise exception 'VALIDATION'; end if;
    if (v_option like '%@after_school' and (v_time at time zone 'Asia/Shanghai')::date<(now() at time zone 'Asia/Shanghai')::date)
      or (v_option not like '%@after_school' and v_time<=now()) then raise exception 'TIME_UNAVAILABLE'; end if;
  end loop;

  begin
    insert into public.lead_invitation_threads(
      id,lead_id,kind,state,assessor_id,parent_time_options,owner_id_at_open,created_by,updated_by,parent_request_actor,parent_request_payload
    ) values (
      p_request_id,v_lead.id,'assessment_1v1','awaiting_teacher',p_assessor_id,v_options,v_lead.owner_id,v_uid,v_uid,v_uid,v_payload
    );
  exception when unique_violation then
    -- 既有学服流程也可能同时建立该 lead 的当前邀约。
    raise exception 'ACTIVE_INVITATION';
  end;
  insert into public.lead_invitation_events(invitation_id,from_state,to_state,channel,note,recorded_by)
    values(p_request_id,null,'awaiting_teacher','other','',v_uid);
  perform public.emit_domain_event('parent.assessment.requested','lead_invitation',p_request_id,
    jsonb_build_object('studentId',p_student_id,'assessorId',p_assessor_id,'parentOptionCount',cardinality(v_options)),p_assessor_id,null);
  return public.parent_assessment_request_projection(p_request_id,p_student_id);
end
$$;

create function public.confirm_parent_assessment(
  p_invitation_id uuid,p_student_id uuid,p_time_option text,p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_invitation public.lead_invitation_threads%rowtype;
  v_time timestamptz; v_lead_status text;
begin
  if not public.miniapp_can_participate(p_student_id,'grades')
    or not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'FORBIDDEN'; end if;
  if p_invitation_id is null or p_time_option is null or p_expected_updated_at is null then raise exception 'VALIDATION'; end if;
  -- 与新请求保持 lead 在 thread 之前；确认不再取得学生行锁。
  select l.status into v_lead_status from public.leads l join public.lead_invitation_threads t on t.lead_id=l.id
    where t.id=p_invitation_id and t.kind='assessment_1v1' and l.student_id=p_student_id for share of l;
  if not found then raise exception 'NOT_FOUND'; end if;
  select t.* into v_invitation from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id
    where t.id=p_invitation_id and t.kind='assessment_1v1' and l.student_id=p_student_id for update of t;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.miniapp_can_participate(p_student_id,'grades')
    or not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'FORBIDDEN'; end if;
  v_time := public.parent_assessment_time_at(p_time_option);
  if v_time is null then raise exception 'TIME_UNAVAILABLE'; end if;
  -- 成功后的同时间重试先返回现态，避免时间经过或 updated_at 改变造成假失败。
  if v_invitation.state in ('confirmed','completed') and v_invitation.scheduled_at=v_time then
    return public.parent_assessment_request_projection(v_invitation.id,p_student_id);
  end if;
  if v_invitation.state<>'awaiting_parent' or v_invitation.updated_at is distinct from p_expected_updated_at then raise exception 'CONFLICT'; end if;
  if v_lead_status='invalid' then raise exception 'LEAD_UNAVAILABLE'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_invitation.assessor_id
    and p.role in ('staff','admin') and p.is_active and p.account_status='active' and public.has_perm(p.id,'review.write'))
    then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  if v_time<=now() or not (p_time_option=any(v_invitation.parent_time_options))
    or not (p_time_option=any(v_invitation.assessor_time_options)) then raise exception 'TIME_UNAVAILABLE'; end if;

  update public.lead_invitation_threads set state='confirmed',scheduled_at=v_time,updated_by=v_uid where id=v_invitation.id;
  insert into public.lead_invitation_events(invitation_id,from_state,to_state,channel,note,recorded_by)
    values(v_invitation.id,v_invitation.state,'confirmed','other','',v_uid);
  perform public.emit_domain_event('parent.assessment.confirmed','lead_invitation',v_invitation.id,
    jsonb_build_object('studentId',p_student_id,'scheduledAt',v_time),v_invitation.assessor_id,null);
  return public.parent_assessment_request_projection(v_invitation.id,p_student_id);
end
$$;

revoke all on function public.guard_parent_assessment_request_metadata() from public,anon,authenticated;
revoke all on function public.parent_assessment_time_at(text) from public,anon,authenticated;
revoke all on function public.parent_assessment_eligible_teachers(uuid) from public,anon,authenticated;
revoke all on function public.parent_assessment_request_blocker(uuid) from public,anon,authenticated;
revoke all on function public.parent_assessment_request_projection(uuid,uuid) from public,anon,authenticated;
revoke all on function public.parent_assessment_overview(uuid) from public,anon,authenticated;
revoke all on function public.request_parent_assessment(uuid,uuid,uuid,text[]) from public,anon,authenticated;
revoke all on function public.confirm_parent_assessment(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.parent_assessment_overview(uuid) to authenticated;
grant execute on function public.request_parent_assessment(uuid,uuid,uuid,text[]) to authenticated;
grant execute on function public.confirm_parent_assessment(uuid,uuid,text,timestamptz) to authenticated;

select pg_notify('pgrst','reload schema');
