-- DEV-SCHOOL-OPS-1 / public-class run continuity.
--
-- The rows in public_class_segments remain reusable agenda/content blocks, but
-- on-site teaching is started and ended once for the whole public-class event.
-- Trial lesson pages and parent-talk pages are frozen in the same transaction;
-- the group-assessment block is a parallel recording surface and has no
-- independent teaching lifecycle.

begin;

create or replace function public.can_teach_public_class_segment(
  p_segment_id uuid,
  p_uid uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'activity.manage')
    or exists (
      select 1
      from public.public_class_segments target
      join public.activities activity
        on activity.id = target.activity_id
       and activity.kind = 'public_class'
       and activity.deleted_at is null
      where target.id = p_segment_id
        and (
          p_uid in (target.primary_teacher_id, target.assistant_teacher_id)
          or exists (
            select 1
            from public.public_class_segments host_block
            where host_block.activity_id = target.activity_id
              and host_block.kind in ('trial_lesson', 'parent_talk')
              and p_uid in (host_block.primary_teacher_id, host_block.assistant_teacher_id)
          )
        )
    )
  )
$$;

create or replace function public.can_teach_public_class_run(
  p_activity_id uuid,
  p_uid uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null
    and exists (
      select 1
      from public.activities activity
      where activity.id = p_activity_id
        and activity.kind = 'public_class'
        and activity.deleted_at is null
    )
    and (
      public.is_admin(p_uid)
      or public.has_perm(p_uid, 'activity.manage')
      or exists (
        select 1
        from public.public_class_segments host_block
        where host_block.activity_id = p_activity_id
          and host_block.kind in ('trial_lesson', 'parent_talk')
          and p_uid in (host_block.primary_teacher_id, host_block.assistant_teacher_id)
      )
    )
$$;

create or replace function public.start_public_class_run(p_activity_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_block record;
  v_started_count integer := 0;
begin
  if not public.can_teach_public_class_run(p_activity_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (
    select 1
    from public.public_class_segments block
    where block.activity_id = p_activity_id
      and block.kind = 'trial_lesson'
      and block.microcourse_lecture_id is not null
  ) then raise exception 'PUBLIC_CLASS_COURSEWARE_REQUIRED'; end if;

  -- The surrounding function transaction makes the whole freeze all-or-nothing.
  for v_block in
    select block.id
    from public.public_class_segments block
    where block.activity_id = p_activity_id
      and block.kind in ('trial_lesson', 'parent_talk')
      and block.microcourse_lecture_id is not null
    order by block.scheduled_at, block.position, block.id
  loop
    perform public.start_public_class_segment_teaching(v_block.id);
    v_started_count := v_started_count + 1;
  end loop;

  if v_started_count = 0 then raise exception 'PUBLIC_CLASS_COURSEWARE_REQUIRED'; end if;
  perform public.emit_domain_event(
    'public_class.run.started', 'activity', p_activity_id,
    jsonb_build_object('presentationBlockCount', v_started_count), null, null
  );
end;
$$;

create or replace function public.end_public_class_run(p_activity_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_block record;
  v_ended_count integer := 0;
begin
  if not public.can_teach_public_class_run(p_activity_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (
    select 1
    from public.public_class_segments block
    where block.activity_id = p_activity_id
      and block.kind in ('trial_lesson', 'parent_talk')
      and block.teaching_started_at is not null
  ) then raise exception 'PUBLIC_CLASS_TEACHING_NOT_STARTED'; end if;

  for v_block in
    select block.id
    from public.public_class_segments block
    where block.activity_id = p_activity_id
      and block.kind in ('trial_lesson', 'parent_talk')
      and block.teaching_started_at is not null
      and block.teaching_ended_at is null
    order by block.scheduled_at, block.position, block.id
  loop
    perform public.end_public_class_segment_teaching(v_block.id);
    v_ended_count := v_ended_count + 1;
  end loop;

  if v_ended_count > 0 then
    perform public.emit_domain_event(
      'public_class.run.ended', 'activity', p_activity_id,
      jsonb_build_object('presentationBlockCount', v_ended_count), null, null
    );
  end if;
end;
$$;

revoke all on function public.can_teach_public_class_run(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.start_public_class_run(uuid)
  from public, anon, authenticated;
revoke all on function public.end_public_class_run(uuid)
  from public, anon, authenticated;

grant execute on function public.can_teach_public_class_run(uuid, uuid) to authenticated;
grant execute on function public.start_public_class_run(uuid) to authenticated;
grant execute on function public.end_public_class_run(uuid) to authenticated;

comment on function public.start_public_class_run(uuid) is
  'Atomically freezes and starts every presentation block in one public-class event.';
comment on function public.end_public_class_run(uuid) is
  'Ends the event presentation run without creating per-segment user workflow steps.';

notify pgrst, 'reload schema';

commit;
