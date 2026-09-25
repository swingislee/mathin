-- 自动保存复用课次沟通权限、名单与完成规则；版本锁保护同一条记录的连续编辑。
alter table public.student_follow_ups add column communication_revision integer not null default 0 check (communication_revision >= 0);
alter table public.session_class_communications add column communication_revision integer not null default 0 check (communication_revision >= 0);

create function public.save_session_communication(p_id uuid,p_session_id uuid,p_student_id uuid,p_occurred_on date,
  p_channel text,p_outcome text,p_content text,p_next_action text,p_next_follow_up_on date,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); existing jsonb; updated jsonb; result jsonb; revision integer;
  next_at timestamptz; content_value text:=btrim(coalesce(p_content,'')); action_value text:=btrim(coalesce(p_next_action,''));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid,'followup.write') or not public.has_perm(uid,'followup.view')
    or not public.can_access_session_communications(p_session_id,uid) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 0 or p_occurred_on is null
    or p_channel is null or p_channel not in ('wechat','phone','in_person','class_group','other')
    or p_outcome is null or p_outcome not in ('contacted','follow_up','not_needed') or length(content_value) not between 1 and 2000
    or length(action_value)>1000 or (p_outcome='follow_up' and (action_value='' or p_next_follow_up_on is null)) then raise exception 'VALIDATION'; end if;
  perform 1 from public.class_sessions where id=p_session_id for update;
  if exists(select 1 from public.class_sessions where id=p_session_id and (cancelled_by is not null or voided_at is not null)) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  if p_student_id is not null and (not (p_student_id=any(public.session_communication_student_ids(p_session_id))) or not public.can_access_student(p_student_id,uid)) then raise exception 'FORBIDDEN'; end if;
  next_at:=case when p_outcome='follow_up' then p_next_follow_up_on::timestamp at time zone public.get_organization_timezone_v2() else null end;
  if p_outcome<>'follow_up' then action_value:=''; end if;
  select to_jsonb(r) into existing from (
    select id,session_id,student_id,author_id,occurred_on,communication_channel,communication_outcome,content,next_action,next_follow_up_at,communication_revision from public.student_follow_ups where id=p_id
    union all
    select id,session_id,null::uuid,author_id,occurred_on,communication_channel,communication_outcome,content,next_action,next_follow_up_at,communication_revision from public.session_class_communications where id=p_id
  ) r;
  if existing is null then
    if p_expected_revision<>0 then raise exception 'SUBMISSION_CONFLICT'; end if;
    perform public.record_session_communication(p_id,p_session_id,p_student_id,p_occurred_on,p_channel,p_outcome,p_content,p_next_action,p_next_follow_up_on);
    revision:=1;
  else
    if existing->>'session_id' is distinct from p_session_id::text or (existing->>'student_id') is distinct from p_student_id::text
      or existing->>'author_id' is distinct from uid::text then raise exception 'FORBIDDEN'; end if;
    revision:=(existing->>'communication_revision')::integer;
    -- 已有历史保持原状；此入口只继续编辑自动保存建立的记录。
    if revision=0 then raise exception 'SUBMISSION_CONFLICT'; end if;
    updated:=existing || jsonb_build_object('occurred_on',p_occurred_on,'communication_channel',p_channel,'communication_outcome',p_outcome,
      'content',content_value,'next_action',action_value,'next_follow_up_at',next_at);
    if updated is distinct from existing then
      if p_expected_revision<>revision then raise exception 'SUBMISSION_CONFLICT'; end if;
      revision:=revision+1;
      -- 保存修改前后的事实；记录 ID 和首次录入时间保持稳定。
      perform public.emit_domain_event('session_communication.revised','session',p_session_id,
        jsonb_build_object('recordId',p_id,'before',existing,'after',updated || jsonb_build_object('communication_revision',revision)),uid,null);
    end if;
  end if;
  if p_student_id is null then
    update public.session_class_communications set content=content_value,occurred_on=p_occurred_on,communication_channel=p_channel,
      communication_outcome=p_outcome,next_action=action_value,next_follow_up_at=next_at,communication_revision=revision where id=p_id;
  else
    update public.student_follow_ups set content=content_value,occurred_on=p_occurred_on,communication_channel=p_channel,
      communication_outcome=p_outcome,next_action=action_value,next_follow_up_at=next_at,communication_revision=revision where id=p_id;
  end if;
  result:=public.get_session_communications(p_session_id);
  if public.session_communications_ready(p_session_id) and (result->>'canWrite')::boolean then
    result:=public.finish_session_communications(p_session_id);
  elsif not public.session_communications_ready(p_session_id) then
    update public.session_completion_tasks set status='pending',completed_at=null,completed_by=null,skip_reason=null,updated_at=now()
      where session_id=p_session_id and kind='followup' and status<>'pending';
    update public.class_sessions set postwork_completed_at=null where id=p_session_id and postwork_completed_at is not null;
  end if;
  return jsonb_build_object('communications',result,'revision',revision);
end;
$$;
revoke all on function public.save_session_communication(uuid,uuid,uuid,date,text,text,text,text,date,integer) from public,anon,authenticated;
grant execute on function public.save_session_communication(uuid,uuid,uuid,date,text,text,text,text,date,integer) to authenticated;
