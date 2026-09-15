-- 逐生沟通沿用学生历史；新增课次关联与工作字段。班级整体沟通单独记录。
alter table public.student_follow_ups
  add column session_id uuid references public.class_sessions(id) on delete restrict,
  add column communication_channel text,
  add column communication_outcome text,
  add column next_action text;
alter table public.student_follow_ups add constraint student_followups_session_context_check check (
  session_id is null or (kind = 'class' and occurred_on is not null
    and communication_channel is not null and communication_channel in ('wechat','phone','in_person','class_group','other')
    and communication_outcome is not null and communication_outcome in ('contacted','follow_up','not_needed')
    and next_action is not null
    and (communication_outcome <> 'follow_up' or (length(btrim(next_action)) > 0 and next_follow_up_at is not null)))
);
create index student_followups_session_idx on public.student_follow_ups(session_id, student_id, created_at desc, id desc) where session_id is not null;

create table public.session_class_communications (
  id uuid primary key,
  session_id uuid not null references public.class_sessions(id) on delete restrict,
  author_id uuid not null references public.profiles(id) on delete restrict,
  content text not null check (length(btrim(content)) between 1 and 2000),
  occurred_on date not null,
  communication_channel text not null check (communication_channel in ('wechat','phone','in_person','class_group','other')),
  communication_outcome text not null check (communication_outcome in ('contacted','follow_up','not_needed')),
  next_action text not null default '' check (length(next_action) <= 1000),
  next_follow_up_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (communication_outcome <> 'follow_up' or (length(btrim(next_action)) > 0 and next_follow_up_at is not null))
);
create index session_class_communications_session_idx on public.session_class_communications(session_id, created_at desc, id desc);
alter table public.session_class_communications enable row level security;

create function public.can_access_session_communications(p_session_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_staff(p_user_id) and exists (
    select 1 from public.class_sessions s join public.classrooms c on c.id=s.classroom_id
    where s.id=p_session_id and s.deleted_at is null
      and c.trashed_at is null
      and (public.has_perm(p_user_id,'class.view.all') or s.teacher_override=p_user_id or exists (
        select 1 from public.classroom_staff_assignments a where a.classroom_id=s.classroom_id and a.user_id=p_user_id
          and (a.responsibility in ('assistant_teacher','learning_support') or (a.responsibility='primary_teacher' and s.teacher_override is null))
      ))
  );
$$;
revoke all on function public.can_access_session_communications(uuid,uuid) from public, anon, authenticated;
grant execute on function public.can_access_session_communications(uuid,uuid) to authenticated;
create policy session_class_communications_read on public.session_class_communications for select to authenticated
  using (public.has_perm((select auth.uid()),'followup.view') and public.can_access_session_communications(session_id,(select auth.uid())));
revoke all on public.session_class_communications from public, anon, authenticated;
grant select on public.session_class_communications to authenticated;

-- 写入口和完成检查使用同一份本课名单，已冻结课次保留当时学生。
create function public.session_communication_student_ids(p_session_id uuid)
returns uuid[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare selected_revision integer; ids uuid[];
begin
  select roster_revision into selected_revision from public.class_sessions where id=p_session_id;
  if selected_revision > 0 then
    select array_agg(student_id order by roster_order) into ids from public.session_roster_entries where session_id=p_session_id and revision=selected_revision;
  else
    select array_agg(student_id order by roster_order) into ids from public.current_session_roster_source(p_session_id);
  end if;
  return coalesce(ids,'{}'::uuid[]);
end;
$$;
revoke all on function public.session_communication_student_ids(uuid) from public, anon, authenticated;

create function public.session_communications_ready(p_session_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from unnest(public.session_communication_student_ids(p_session_id)) sid
    where coalesce((select f.communication_outcome from public.student_follow_ups f where f.session_id=p_session_id and f.student_id=sid
      order by f.created_at desc,f.id desc limit 1),'pending') not in ('contacted','not_needed'))
    and coalesce((select communication_outcome from public.session_class_communications where session_id=p_session_id order by created_at desc,id desc limit 1)<>'follow_up',true);
$$;
revoke all on function public.session_communications_ready(uuid) from public,anon,authenticated;

-- 既有通用任务入口同样遵守已采用课次沟通的完成合同。
create function public.guard_session_communication_completion()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.kind='followup' and new.status='done' and (
    exists(select 1 from public.student_follow_ups where session_id=new.session_id)
    or exists(select 1 from public.session_class_communications where session_id=new.session_id)) then
    if auth.uid() is not null and not public.can_access_session_communications(new.session_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
    if not public.session_communications_ready(new.session_id) then raise exception 'COMMUNICATIONS_PENDING'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_session_communication_completion() from public,anon,authenticated;
create trigger session_communication_completion_guard before insert or update on public.session_completion_tasks
  for each row execute function public.guard_session_communication_completion();

create function public.get_session_communications(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid:=auth.uid(); records jsonb; can_read boolean; can_write boolean;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_access_session_communications(p_session_id,uid) then raise exception 'FORBIDDEN'; end if;
  can_read:=public.has_perm(uid,'followup.view');
  can_write:=can_read and public.has_perm(uid,'followup.write')
    and exists(select 1 from public.class_sessions where id=p_session_id and cancelled_by is null and voided_at is null)
    and not exists (
    select 1 from unnest(public.session_communication_student_ids(p_session_id)) sid where not public.can_access_student(sid,uid));
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'studentId',r.student_id,'content',r.content,'occurredOn',r.occurred_on,
    'channel',r.communication_channel,'outcome',r.communication_outcome,'nextAction',r.next_action,
    'nextFollowUpOn',(r.next_follow_up_at at time zone public.get_organization_timezone_v2())::date,
    'author',coalesce(p.display_name,''),'createdAt',r.created_at) order by r.created_at desc,r.id desc),'[]') into records
    from (
      select f.id,f.student_id,f.author_id,f.content,f.occurred_on,f.communication_channel,f.communication_outcome,f.next_action,f.next_follow_up_at,f.created_at
        from public.student_follow_ups f where can_read and f.session_id=p_session_id and public.can_access_student(f.student_id,uid)
      union all
      select g.id,null::uuid,g.author_id,g.content,g.occurred_on,g.communication_channel,g.communication_outcome,g.next_action,g.next_follow_up_at,g.created_at
        from public.session_class_communications g where can_read and g.session_id=p_session_id
    ) r left join public.profiles p on p.id=r.author_id;
  return jsonb_build_object('canRead',can_read,'canWrite',can_write,'records',records,'completed',public.session_communications_ready(p_session_id) and exists (
    select 1 from public.session_completion_tasks where session_id=p_session_id and kind='followup' and status='done'));
end;
$$;

create function public.record_session_communication(p_id uuid,p_session_id uuid,p_student_id uuid,p_occurred_on date,
  p_channel text,p_outcome text,p_content text,p_next_action text,p_next_follow_up_on date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); existing jsonb; next_at timestamptz; content_value text:=btrim(coalesce(p_content,'')); action_value text:=btrim(coalesce(p_next_action,''));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid,'followup.write') or not public.has_perm(uid,'followup.view')
    or not public.can_access_session_communications(p_session_id,uid) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_occurred_on is null or p_channel is null or p_channel not in ('wechat','phone','in_person','class_group','other')
    or p_outcome is null or p_outcome not in ('contacted','follow_up','not_needed') or length(content_value) not between 1 and 2000
    or length(action_value)>1000 or (p_outcome='follow_up' and (action_value='' or p_next_follow_up_on is null)) then raise exception 'VALIDATION'; end if;
  perform 1 from public.class_sessions where id=p_session_id for update;
  if exists(select 1 from public.class_sessions where id=p_session_id and (cancelled_by is not null or voided_at is not null)) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  if p_student_id is not null and (not (p_student_id=any(public.session_communication_student_ids(p_session_id))) or not public.can_access_student(p_student_id,uid)) then raise exception 'FORBIDDEN'; end if;
  next_at:=case when p_outcome='follow_up' then p_next_follow_up_on::timestamp at time zone public.get_organization_timezone_v2() else null end;
  if p_outcome<>'follow_up' then action_value:=''; end if;
  -- 同一次提交重试只返回原记录；改变内容时使用新的提交 ID。
  select to_jsonb(r) into existing from (
    select id,session_id,student_id,author_id,occurred_on,communication_channel,communication_outcome,content,next_action,next_follow_up_at from public.student_follow_ups where id=p_id
    union all
    select id,session_id,null::uuid,author_id,occurred_on,communication_channel,communication_outcome,content,next_action,next_follow_up_at from public.session_class_communications where id=p_id
  ) r;
  if existing is not null then
    if existing->>'session_id'=p_session_id::text and (existing->>'student_id') is not distinct from p_student_id::text
      and existing->>'author_id'=uid::text and existing->>'occurred_on'=p_occurred_on::text
      and existing->>'communication_channel'=p_channel and existing->>'communication_outcome'=p_outcome
      and existing->>'content'=content_value and existing->>'next_action'=action_value
      and (existing->>'next_follow_up_at')::timestamptz is not distinct from next_at then return public.get_session_communications(p_session_id); end if;
    raise exception 'SUBMISSION_CONFLICT';
  end if;
  if p_student_id is null then
    insert into public.session_class_communications(id,session_id,author_id,content,occurred_on,communication_channel,communication_outcome,next_action,next_follow_up_at)
      values(p_id,p_session_id,uid,content_value,p_occurred_on,p_channel,p_outcome,action_value,next_at);
  else
    insert into public.student_follow_ups(id,session_id,student_id,author_id,content,kind,occurred_on,communication_channel,communication_outcome,next_action,next_follow_up_at,created_at)
      values(p_id,p_session_id,p_student_id,uid,content_value,'class',p_occurred_on,p_channel,p_outcome,action_value,next_at,clock_timestamp());
  end if;
  insert into public.session_completion_tasks(session_id,kind,required,status,assigned_to)
    values(p_session_id,'followup',false,'pending',uid)
    on conflict(session_id,kind) do update set status='pending',completed_at=null,completed_by=null,skip_reason=null,updated_at=now();
  update public.class_sessions set postwork_completed_at=null where id=p_session_id and postwork_completed_at is not null;
  perform public.emit_domain_event('session_communication.recorded','session',p_session_id,
    jsonb_build_object('recordId',p_id,'studentId',p_student_id,'outcome',p_outcome),uid,null);
  return public.get_session_communications(p_session_id);
end;
$$;

create function public.finish_session_communications(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); task_id uuid; ids uuid[];
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid,'followup.write') or not public.has_perm(uid,'followup.view')
    or not public.can_access_session_communications(p_session_id,uid) then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.class_sessions where id=p_session_id for update;
  if exists(select 1 from public.class_sessions where id=p_session_id and (cancelled_by is not null or voided_at is not null)) then raise exception 'FORBIDDEN'; end if;
  ids:=public.session_communication_student_ids(p_session_id);
  if exists(select 1 from unnest(ids) sid where not public.can_access_student(sid,uid)) then raise exception 'FORBIDDEN'; end if;
  if not public.session_communications_ready(p_session_id) then raise exception 'COMMUNICATIONS_PENDING'; end if;
  if exists(select 1 from public.session_completion_tasks where session_id=p_session_id and kind='followup' and status='done') then return public.get_session_communications(p_session_id); end if;
  insert into public.session_completion_tasks(session_id,kind,required,status,assigned_to,completed_by,completed_at)
    values(p_session_id,'followup',false,'done',uid,uid,now())
    on conflict(session_id,kind) do update set status='done',completed_by=uid,completed_at=now(),skip_reason=null,updated_at=now()
    returning id into task_id;
  perform public.emit_domain_event('session_task.completed','session_completion_task',task_id,jsonb_build_object('kind','followup','status','done'),uid,null);
  return public.get_session_communications(p_session_id);
end;
$$;
revoke all on function public.get_session_communications(uuid) from public,anon,authenticated;
revoke all on function public.record_session_communication(uuid,uuid,uuid,date,text,text,text,text,date) from public,anon,authenticated;
revoke all on function public.finish_session_communications(uuid) from public,anon,authenticated;
grant execute on function public.get_session_communications(uuid) to authenticated;
grant execute on function public.record_session_communication(uuid,uuid,uuid,date,text,text,text,text,date) to authenticated;
grant execute on function public.finish_session_communications(uuid) to authenticated;
