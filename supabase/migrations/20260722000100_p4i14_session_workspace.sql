-- P4I-14：课次工作区「完成备课」编排 + 备课复制候选 + 空白课堂降级留痕。
-- 关键判断：不修改既有 freeze_session_courseware（P6，guard 是
-- started_at is null and courseware_frozen_at is null，同一条 UPDATE 里把两者一起写死，
-- 专门服务"课中未备课自动冻结"这条路径）。课前"完成备课"需要能在 started_at 仍为 null 时
-- 反复调用（首次=完成备课，之后=采纳新 release），因此单独开一条 guard 只看 started_at 的
-- RPC；freeze_session_courseware 与本迁移互不影响——startClassSession 会先判
-- courseware_frozen_at 是否已非空，已被本迁移的 RPC 冻结过的课次会跳过它的冻结分支，
-- 只补 started_at（详见 .claude/p4i-0-baseline.md「P4I-14 执行记录」）。
--
-- gate 一律用 is_session_teacher（course_lectures/class_sessions.teacher_override 感知，
-- 与既有 freeze_session_courseware/resolve_session_courseware_release 同一个 gate），
-- 不用 is_classroom_teacher——核实过 create_class/assign_classroom_staff 对
-- primary_teacher/assistant_teacher 均会同时写 classroom_staff_assignments 与
-- classroom_members(role='teacher')（20260720000800_p4h_class_builder.sql:310-314、
-- 20260720000200_p4h_lifecycle_rpcs.sql:565-578），两个 gate 在当前数据下等价，
-- 选 is_session_teacher 是因为它额外认 teacher_override（代课老师），覆盖面更宽。

create or replace function public.save_session_prepared_courseware(
  p_session_id uuid,
  p_courseware jsonb,
  p_courseware_resolved jsonb
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  started timestamptz;
  expected_release uuid;
  expected_track text;
  session_lecture uuid;
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_courseware) is distinct from 'array' or octet_length(p_courseware::text) > 1048576
     or jsonb_typeof(p_courseware_resolved) is distinct from 'object'
     or p_courseware_resolved->>'version' is distinct from 'cw-session-resolved-v1'
     or jsonb_typeof(p_courseware_resolved->'bindings') is distinct from 'array'
     or octet_length(p_courseware_resolved::text) > 1048576 then raise exception 'INVALID_COURSEWARE_FREEZE'; end if;

  select session.started_at, session.lecture_id, coalesce(session.courseware_track_override, classroom.courseware_track)
    into started, session_lecture, expected_track
    from public.class_sessions session join public.classrooms classroom on classroom.id = session.classroom_id
   where session.id = p_session_id and session.deleted_at is null
   for update of session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if started is not null then raise exception 'ALREADY_STARTED'; end if;

  if session_lecture is not null then
    select current_release_id into expected_release
      from public.cw_lecture_track_heads where lecture_id = session_lecture and track = expected_track;
  end if;
  if p_courseware_resolved->>'track' is distinct from expected_track then raise exception 'TRACK_MISMATCH'; end if;
  if (p_courseware_resolved->>'releaseId') is distinct from expected_release::text then raise exception 'RELEASE_MISMATCH'; end if;

  update public.class_sessions
     set courseware = p_courseware,
         courseware_resolved = p_courseware_resolved,
         courseware_frozen_at = now()
   where id = p_session_id;

  insert into public.session_preparations (
    session_id, status, source_release_id, track, prepared_by, prepared_at, auto_frozen, last_contributor_id
  )
  values (p_session_id, 'ready', expected_release, expected_track, uid, now(), false, uid)
  on conflict (session_id) do update
     set status = 'ready',
         source_release_id = excluded.source_release_id,
         track = excluded.track,
         prepared_by = uid,
         prepared_at = now(),
         auto_frozen = false,
         last_contributor_id = uid,
         updated_at = now();
end;
$$;

revoke all on function public.save_session_prepared_courseware(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_session_prepared_courseware(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 无 release 时的空白课堂降级留痕（doc19 §14.7）：不新增列，直接走既有
-- emit_domain_event，P4I-13 的 list_classroom_operational_events 已经按
-- entity_type='class_session' 收录本班级课次事件，本迁移只需要产生这一条事件类型。
-- ---------------------------------------------------------------------------

create or replace function public.record_session_blank_fallback(p_session_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from public.class_sessions where id = p_session_id and deleted_at is null) then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  perform public.emit_domain_event(
    'session.courseware.blank_fallback', 'class_session', p_session_id,
    jsonb_build_object('reason', left(btrim(p_reason), 1000)), uid, null
  );
end;
$$;

revoke all on function public.record_session_blank_fallback(uuid, text) from public, anon, authenticated;
grant execute on function public.record_session_blank_fallback(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 备课复制候选（doc19 §14.5）：允许跨班级复制同讲次的已就绪备课，
-- session_preparations 的 RLS 只认 is_classroom_staff_assigned（本班级），
-- 教师看不到自己不任教班级的备课行——security definer 绕过，复用 P4I-13
-- 「专用 RPC 绕过分裂 RLS 假设」的模式（get_classroom_roster_signals 同理）。
-- ---------------------------------------------------------------------------

create or replace function public.list_session_preparation_copy_candidates(p_session_id uuid)
returns table(
  session_id uuid,
  classroom_name text,
  scheduled_at timestamptz,
  track text,
  release_no integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  target_lecture uuid;
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select lecture_id into target_lecture from public.class_sessions where id = p_session_id and deleted_at is null;
  if target_lecture is null then return; end if;

  return query
  select cs.id, c.name, cs.scheduled_at, sp.track, r.release_no
    from public.class_sessions cs
    join public.classrooms c on c.id = cs.classroom_id
    join public.session_preparations sp on sp.session_id = cs.id and sp.status = 'ready'
    left join public.cw_lecture_releases r on r.id = sp.source_release_id
   where cs.lecture_id = target_lecture and cs.id <> p_session_id and cs.deleted_at is null
   order by cs.scheduled_at desc nulls last
   limit 20;
end;
$$;

revoke all on function public.list_session_preparation_copy_candidates(uuid) from public, anon, authenticated;
grant execute on function public.list_session_preparation_copy_candidates(uuid) to authenticated;
