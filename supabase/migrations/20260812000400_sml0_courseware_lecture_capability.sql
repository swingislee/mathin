-- SML-0：统一课件讲次 capability。
--
-- 这个合同只回答“当前 actor 是否有权在该讲次执行某类课件动作”。它同时检查：
-- 1. 已验证身份；2. RBAC permission；3. course_staff_assignments 的有效责任关系；
-- 4. family / course / lecture 当前状态。
-- 具体 revision、review cycle、release 与 session 状态仍由调用方在同一事务继续校验。

create or replace function public.resolve_cw_lecture_capability_for(
  p_actor_id uuid,
  p_lecture_id uuid,
  p_capability text,
  p_at timestamptz default now()
)
returns table (
  allowed boolean,
  denial_code text,
  actor_id uuid,
  lecture_id uuid,
  course_id uuid,
  family_id uuid,
  required_permission text,
  responsibility text,
  assignment_scope_type text,
  assignment_source_id uuid,
  family_status text,
  course_status text,
  lecture_status text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  capability_permission text;
  allowed_responsibilities text[];
  requires_active_release_context boolean := false;
  lecture_row record;
  matched_responsibility text;
  matched_scope_type text;
  matched_source_id uuid;
  has_effective_relation boolean := false;
begin
  if p_capability = 'page.edit' then
    capability_permission := 'courseware.page.edit';
    allowed_responsibilities := array['owner', 'editor'];
  elsif p_capability = 'review.submit' then
    capability_permission := 'courseware.page.edit';
    allowed_responsibilities := array['owner', 'editor'];
  elsif p_capability = 'review.decide' then
    capability_permission := 'courseware.review';
    allowed_responsibilities := array['owner', 'reviewer'];
  elsif p_capability in ('release.publish', 'release.rollback') then
    capability_permission := 'courseware.release.publish';
    allowed_responsibilities := array['owner', 'editor'];
    requires_active_release_context := true;
  elsif p_capability = 'release.emergency_publish' then
    capability_permission := 'courseware.emergency_publish';
    allowed_responsibilities := array['owner'];
    requires_active_release_context := true;
  else
    raise exception 'INVALID_COURSEWARE_CAPABILITY';
  end if;

  if p_at is null then raise exception 'VALIDATION'; end if;

  allowed := false;
  denial_code := null;
  actor_id := p_actor_id;
  lecture_id := p_lecture_id;
  required_permission := capability_permission;

  if p_actor_id is null then
    denial_code := 'UNAUTHENTICATED';
    return next;
    return;
  end if;

  if not public.is_staff(p_actor_id) then
    denial_code := 'INACTIVE_ACTOR';
    return next;
    return;
  end if;

  -- 权限先于对象查询，避免没有课件权限的身份探测 lecture 是否存在。
  if not public.has_perm(p_actor_id, capability_permission) then
    denial_code := 'MISSING_PERMISSION';
    return next;
    return;
  end if;

  select
    lecture_value.course_id,
    course_value.family_id,
    family_value.status as family_status,
    course_value.status as course_status,
    course_value.trashed_at as course_trashed_at,
    lecture_value.status as lecture_status,
    lecture_value.archived_at as lecture_archived_at
  into lecture_row
  from public.course_lectures lecture_value
  join public.courses course_value on course_value.id = lecture_value.course_id
  join public.course_families family_value on family_value.id = course_value.family_id
  where lecture_value.id = p_lecture_id;

  if not found then
    denial_code := 'LECTURE_NOT_FOUND';
    return next;
    return;
  end if;

  course_id := lecture_row.course_id;
  family_id := lecture_row.family_id;
  family_status := lecture_row.family_status;
  course_status := lecture_row.course_status;
  lecture_status := lecture_row.lecture_status;

  -- owner 只采用当前时刻最靠近讲次的一层；editor / reviewer 从上级向下继承。
  with owner_candidates as (
    select
      assignment_value.responsibility,
      assignment_value.user_id,
      assignment_value.scope_type,
      coalesce(assignment_value.lecture_id, assignment_value.course_id, assignment_value.family_id) as source_id,
      case assignment_value.scope_type when 'lecture' then 1 when 'variant' then 2 when 'family' then 3 end as scope_rank
    from public.course_staff_assignments assignment_value
    where assignment_value.responsibility = 'owner'
      and assignment_value.archived_at is null
      and (assignment_value.starts_at is null or assignment_value.starts_at <= p_at)
      and (assignment_value.ends_at is null or assignment_value.ends_at > p_at)
      and (
        (assignment_value.scope_type = 'lecture' and assignment_value.lecture_id = p_lecture_id) or
        (assignment_value.scope_type = 'variant' and assignment_value.course_id = lecture_row.course_id) or
        (assignment_value.scope_type = 'family' and assignment_value.family_id = lecture_row.family_id)
      )
  ),
  effective_owner as (
    select
      owner_value.responsibility,
      owner_value.user_id,
      owner_value.scope_type,
      owner_value.source_id,
      owner_value.scope_rank
    from owner_candidates owner_value
    order by owner_value.scope_rank
    limit 1
  ),
  collaborators as (
    select
      assignment_value.responsibility,
      assignment_value.user_id,
      assignment_value.scope_type,
      coalesce(assignment_value.lecture_id, assignment_value.course_id, assignment_value.family_id) as source_id,
      case assignment_value.scope_type when 'lecture' then 1 when 'variant' then 2 when 'family' then 3 end as scope_rank
    from public.course_staff_assignments assignment_value
    where assignment_value.responsibility in ('editor', 'reviewer')
      and assignment_value.archived_at is null
      and (assignment_value.starts_at is null or assignment_value.starts_at <= p_at)
      and (assignment_value.ends_at is null or assignment_value.ends_at > p_at)
      and (
        (assignment_value.scope_type = 'lecture' and assignment_value.lecture_id = p_lecture_id) or
        (assignment_value.scope_type = 'variant' and assignment_value.course_id = lecture_row.course_id) or
        (assignment_value.scope_type = 'family' and assignment_value.family_id = lecture_row.family_id)
      )
  ),
  effective_assignments as (
    select * from effective_owner
    union all
    select * from collaborators
  )
  select
    exists(select 1 from effective_assignments where user_id = p_actor_id),
    matched.responsibility,
    matched.scope_type,
    matched.source_id
  into
    has_effective_relation,
    matched_responsibility,
    matched_scope_type,
    matched_source_id
  from (select 1) singleton
  left join lateral (
    select effective_value.responsibility, effective_value.scope_type, effective_value.source_id
    from effective_assignments effective_value
    where effective_value.user_id = p_actor_id
      and effective_value.responsibility = any(allowed_responsibilities)
    order by
      case effective_value.responsibility when 'owner' then 1 else 2 end,
      effective_value.scope_rank,
      effective_value.responsibility,
      effective_value.source_id
    limit 1
  ) matched on true;

  if not has_effective_relation then
    denial_code := 'RELATION_REQUIRED';
    return next;
    return;
  end if;

  if matched_responsibility is null then
    denial_code := 'RESPONSIBILITY_REQUIRED';
    return next;
    return;
  end if;

  responsibility := matched_responsibility;
  assignment_scope_type := matched_scope_type;
  assignment_source_id := matched_source_id;

  if lecture_row.course_trashed_at is not null then
    denial_code := 'COURSE_TRASHED';
  elsif lecture_row.lecture_status = 'archived' or lecture_row.lecture_archived_at is not null then
    denial_code := 'LECTURE_ARCHIVED';
  elsif requires_active_release_context and lecture_row.family_status <> 'enabled' then
    denial_code := 'FAMILY_NOT_ENABLED';
  elsif requires_active_release_context and lecture_row.course_status <> 'enabled' then
    denial_code := 'COURSE_NOT_ENABLED';
  elsif requires_active_release_context and lecture_row.lecture_status <> 'active' then
    denial_code := 'LECTURE_NOT_ACTIVE';
  elsif not requires_active_release_context and lecture_row.family_status = 'disabled' then
    denial_code := 'FAMILY_DISABLED';
  elsif not requires_active_release_context and lecture_row.course_status = 'disabled' then
    denial_code := 'COURSE_DISABLED';
  else
    allowed := true;
  end if;

  return next;
end;
$$;

comment on function public.resolve_cw_lecture_capability_for(uuid, uuid, text, timestamptz) is
  'SML-0 内部 capability resolver：permission × 有效课程责任 × family/course/lecture 状态。p_at 仅供确定性数据库测试与同事务调用。';

revoke all on function public.resolve_cw_lecture_capability_for(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

create or replace function public.resolve_my_cw_lecture_capability(
  p_lecture_id uuid,
  p_capability text
)
returns table (
  allowed boolean,
  denial_code text,
  actor_id uuid,
  lecture_id uuid,
  course_id uuid,
  family_id uuid,
  required_permission text,
  responsibility text,
  assignment_scope_type text,
  assignment_source_id uuid,
  family_status text,
  course_status text,
  lecture_status text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select *
  from public.resolve_cw_lecture_capability_for(auth.uid(), p_lecture_id, p_capability, now())
$$;

comment on function public.resolve_my_cw_lecture_capability(uuid, text) is
  '返回当前登录用户对讲次课件动作的统一 capability；只解析权限，不执行写入。';

revoke all on function public.resolve_my_cw_lecture_capability(uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_my_cw_lecture_capability(uuid, text) to authenticated;

create or replace function public.assert_cw_lecture_capability(
  p_lecture_id uuid,
  p_capability text
)
returns uuid
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  capability_row record;
begin
  select * into capability_row
  from public.resolve_cw_lecture_capability_for(auth.uid(), p_lecture_id, p_capability, now());

  if not capability_row.allowed then
    raise exception '%', capability_row.denial_code using errcode = '42501';
  end if;

  return capability_row.actor_id;
end;
$$;

comment on function public.assert_cw_lecture_capability(uuid, text) is
  '供受控 SECURITY DEFINER 写 RPC 复用；失败时以稳定 denial code 中止同一事务。';

revoke all on function public.assert_cw_lecture_capability(uuid, text)
  from public, anon, authenticated;
