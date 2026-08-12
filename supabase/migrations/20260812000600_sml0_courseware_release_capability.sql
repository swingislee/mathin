-- SML-0：把课件发布、紧急发布与 release rollback 接入统一 lecture capability。
--
-- freeze_session_courseware 故意不在本迁移改用 course_staff_assignments：课堂教师/代课
-- 教师由 is_session_teacher 授权，课程研发 owner/editor/reviewer 是另一条责任边界。
-- 空间页的双 head / 双 release 原子映射将在后续 migration 独立收口。

begin;

alter function public.publish_cw_track_release(uuid, text, text)
  rename to publish_cw_track_release_pre_sml0_impl;
alter function public.rollback_cw_track_release(uuid, text, uuid, text)
  rename to rollback_cw_track_release_pre_sml0_impl;
alter function public.publish_cw_review_cycle(uuid, text, text)
  rename to publish_cw_review_cycle_pre_sml0_impl;
alter function public.emergency_publish_cw_review(uuid, text, text, text)
  rename to emergency_publish_cw_review_pre_sml0_impl;
alter function public.rollback_cw_lecture_release(uuid, uuid, text)
  rename to rollback_cw_lecture_release_pre_sml0_impl;
alter function public.publish_cw_adapt_releases(uuid[], text)
  rename to publish_cw_adapt_releases_pre_sml0_impl;

revoke all on function public.publish_cw_track_release_pre_sml0_impl(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.rollback_cw_track_release_pre_sml0_impl(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.publish_cw_review_cycle_pre_sml0_impl(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.emergency_publish_cw_review_pre_sml0_impl(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.rollback_cw_lecture_release_pre_sml0_impl(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.publish_cw_adapt_releases_pre_sml0_impl(uuid[], text)
  from public, anon, authenticated;

create function public.publish_cw_track_release(
  p_lecture_id uuid,
  p_track text,
  p_note text default ''
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.publish');
  return public.publish_cw_track_release_pre_sml0_impl(p_lecture_id, p_track, p_note);
end;
$$;

create function public.rollback_cw_track_release(
  p_lecture_id uuid,
  p_track text,
  p_release_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.rollback');
  return public.rollback_cw_track_release_pre_sml0_impl(
    p_lecture_id,
    p_track,
    p_release_id,
    p_note
  );
end;
$$;

create function public.publish_cw_review_cycle(
  p_lecture_id uuid,
  p_track text,
  p_note text default ''
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.publish');
  return public.publish_cw_review_cycle_pre_sml0_impl(p_lecture_id, p_track, p_note);
end;
$$;

create function public.emergency_publish_cw_review(
  p_lecture_id uuid,
  p_track text,
  p_reason text,
  p_note text default ''
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.emergency_publish');
  return public.emergency_publish_cw_review_pre_sml0_impl(
    p_lecture_id,
    p_track,
    p_reason,
    p_note
  );
end;
$$;

-- 旧签名没有 track。先以统一 capability 做 permission-first 断言，再从不可变
-- source release 解析真实 track，并委托当前 track rollback 实现；不再维护第二套旧头逻辑。
create function public.rollback_cw_lecture_release(
  p_lecture_id uuid,
  p_release_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  release_track text;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.rollback');

  select release_value.track into release_track
  from public.cw_lecture_releases release_value
  where release_value.id = p_release_id
    and release_value.lecture_id = p_lecture_id;

  if not found then raise exception 'RELEASE_NOT_FOUND'; end if;

  return public.rollback_cw_track_release_pre_sml0_impl(
    p_lecture_id,
    release_track,
    p_release_id,
    p_note
  );
end;
$$;

-- 批量发布先验证整批每个 lecture 的 capability，再进入旧实现。这样即使第一个讲次
-- 可发布、后续讲次没有责任关系，也不会在执行发布循环后才暴露对象状态。
create function public.publish_cw_adapt_releases(
  p_lecture_ids uuid[],
  p_note text default ''
)
returns table (lecture_id uuid, release_id uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  preflight record;
  requested_count integer := coalesce(cardinality(p_lecture_ids), 0);
  requested_lecture_id uuid;
begin
  select * into preflight
  from public.resolve_cw_lecture_capability_for(
    auth.uid(),
    null,
    'release.publish',
    now()
  );

  if preflight.denial_code is distinct from 'LECTURE_NOT_FOUND' then
    raise exception '%', preflight.denial_code using errcode = '42501';
  end if;

  if requested_count < 1 or requested_count > 30
     or (select count(distinct item) from unnest(p_lecture_ids) item) <> requested_count then
    raise exception 'INVALID_LECTURE_SELECTION';
  end if;

  foreach requested_lecture_id in array p_lecture_ids loop
    perform public.assert_cw_lecture_capability(requested_lecture_id, 'release.publish');
  end loop;

  return query
  select result.lecture_id, result.release_id
  from public.publish_cw_adapt_releases_pre_sml0_impl(p_lecture_ids, p_note) result;
end;
$$;

revoke all on function public.publish_cw_track_release(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.rollback_cw_track_release(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.publish_cw_review_cycle(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.emergency_publish_cw_review(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.rollback_cw_lecture_release(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.publish_cw_adapt_releases(uuid[], text)
  from public, anon, authenticated;

grant execute on function public.publish_cw_track_release(uuid, text, text) to authenticated;
grant execute on function public.rollback_cw_track_release(uuid, text, uuid, text) to authenticated;
grant execute on function public.publish_cw_review_cycle(uuid, text, text) to authenticated;
grant execute on function public.emergency_publish_cw_review(uuid, text, text, text) to authenticated;
grant execute on function public.rollback_cw_lecture_release(uuid, uuid, text) to authenticated;
grant execute on function public.publish_cw_adapt_releases(uuid[], text) to authenticated;

comment on function public.publish_cw_track_release(uuid, text, text) is
  'SML-0 capability 包装：release.publish × owner/editor × active lecture context。';
comment on function public.emergency_publish_cw_review(uuid, text, text, text) is
  'SML-0 capability 包装：release.emergency_publish × effective owner × active lecture context。';
comment on function public.publish_cw_adapt_releases(uuid[], text) is
  'SML-0 批量发布包装：在任何发布前原子验证整批 lecture 的 release.publish capability。';

commit;
