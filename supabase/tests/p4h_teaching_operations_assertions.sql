\set ON_ERROR_STOP on
-- P4H-2：在 CI 一次性数据库中验证状态转换的原子性与历史保留。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
\if :{?admin_id}
\else
  \echo P4H fixtures missing: 测试-管理员
  \quit 1
\endif
\if :{?teacher_id}
\else
  \echo P4H fixtures missing: 测试-教师
  \quit 1
\endif

-- 事务内构造带班级引用、release 引用、历史 event 的最小基线。
insert into public.courses (title, product_code, grade, term, class_type, status, purpose, created_by)
values ('__P4H_AUDIT_COURSE__', '__P4H__' || replace(gen_random_uuid()::text, '-', ''), 1, 1, 'audit', 'draft', 'test', :'admin_id')
returning id as audit_course_id, updated_at as audit_course_updated_at \gset

insert into public.course_lectures (course_id, no, name, objectives, status)
values (:'audit_course_id', 1, '__P4H_AUDIT_LECTURE__', 'original objective', 'active')
returning id as audit_lecture_id \gset

insert into public.classrooms (owner_id, name, invite_code, course_id, purpose, operational_status)
values (:'teacher_id', '__P4H_AUDIT_CLASS__', 'P4H' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)), :'audit_course_id', 'test', 'planning')
returning id as audit_classroom_id \gset

insert into public.classroom_members (classroom_id, user_id, role)
values (:'audit_classroom_id', :'teacher_id', 'teacher')
on conflict do nothing;

insert into public.class_sessions (classroom_id, lecture_id, lecture_no, title)
values (:'audit_classroom_id', :'audit_lecture_id', 1, '__P4H_AUDIT_SESSION__')
returning id as audit_session_id \gset

insert into public.cw_lecture_releases (lecture_id, release_no, snapshot, published_by)
values (:'audit_lecture_id', 1, '[]'::jsonb, :'admin_id')
returning id as audit_release_id \gset
update public.course_lectures set current_release_id = :'audit_release_id' where id = :'audit_lecture_id';

insert into public.class_sessions (classroom_id, title, started_at)
values (:'audit_classroom_id', '__P4H_STARTED_SESSION__', now())
returning id as started_session_id \gset

insert into public.class_sessions (classroom_id, title, started_at, ended_at)
values (:'audit_classroom_id', '__P4H_ENDED_SESSION__', now() - interval '1 hour', now())
returning id as ended_session_id \gset
insert into public.session_events (id, session_id, user_id, device_id, seq, type, payload, at)
values (gen_random_uuid(), :'ended_session_id', :'admin_id', 'p4h-audit-device', 1, 'answer', '{}'::jsonb, now());

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('p4h.audit_course_id', :'audit_course_id', true);
select set_config('p4h.audit_lecture_id', :'audit_lecture_id', true);
select set_config('p4h.audit_classroom_id', :'audit_classroom_id', true);
select set_config('p4h.audit_started_session_id', :'started_session_id', true);
select set_config('p4h.audit_course_updated_at', :'audit_course_updated_at', true);

-- 有班级/release 引用的课程不可进入回收站，影响预览只给计数。
do $$
begin
  begin
    perform public.trash_course(current_setting('p4h.audit_course_id')::uuid);
    raise exception 'P4H_COURSE_TRASH_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'COURSE_IN_USE' then raise; end if;
  end;
end;
$$;
select (lecture_count = 1 and release_count = 1 and classroom_count = 1 and session_count >= 1)
  as p4h_course_impact_ok
from public.get_course_lifecycle_impact(:'audit_course_id') \gset
\if :p4h_course_impact_ok
\else
  \echo P4H lifecycle failed: course impact count mismatch
  \quit 1
\endif

-- 讲次归档/恢复不改变引用、ID 或课件 release。
select public.archive_lecture(:'audit_lecture_id');
select (status = 'archived' and archived_at is not null and current_release_id = :'audit_release_id'::uuid)
  as p4h_lecture_archived
from public.course_lectures where id = :'audit_lecture_id' \gset
\if :p4h_lecture_archived
\else
  \echo P4H lifecycle failed: lecture archive mutated release or status
  \quit 1
\endif
select public.restore_lecture(:'audit_lecture_id');
select (
  (select status = 'active' and current_release_id = :'audit_release_id'::uuid from public.course_lectures where id = :'audit_lecture_id')
  and (select lecture_id = :'audit_lecture_id'::uuid from public.class_sessions where id = :'audit_session_id')
) as p4h_lecture_restored
\gset
\if :p4h_lecture_restored
\else
  \echo P4H lifecycle failed: lecture restore did not preserve identity/reference
  \quit 1
\endif

-- 未开课课次可取消/恢复，已开课课次拒绝取消。
select public.cancel_session(:'audit_session_id', 'audit cancellation');
select (deleted_at is not null and cancelled_by = :'admin_id'::uuid and cancel_reason = 'audit cancellation')
  as p4h_session_cancelled
from public.class_sessions where id = :'audit_session_id' \gset
\if :p4h_session_cancelled
\else
  \echo P4H lifecycle failed: session cancellation not recorded
  \quit 1
\endif
select public.restore_session(:'audit_session_id');
select (deleted_at is null and cancelled_by is null and cancel_reason = '')
  as p4h_session_restored
from public.class_sessions where id = :'audit_session_id' \gset
\if :p4h_session_restored
\else
  \echo P4H lifecycle failed: session restore not recorded
  \quit 1
\endif
do $$
begin
  begin
    perform public.cancel_session(current_setting('p4h.audit_started_session_id')::uuid, 'must fail');
    raise exception 'P4H_STARTED_SESSION_CANCEL_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'SESSION_ALREADY_STARTED' then raise; end if;
  end;
end;
$$;

-- 作废已结束课次时只写 void 元数据，事件流仍在。
select count(*) as before_void_event_count from public.session_events where session_id = :'ended_session_id' \gset
select public.void_session(:'ended_session_id', 'audit void');
select (
  voided_at is not null
  and voided_by = :'admin_id'::uuid
  and void_reason = 'audit void'
  and (select count(*) from public.session_events where session_id = :'ended_session_id') = :before_void_event_count
) as p4h_void_preserves_events
from public.class_sessions where id = :'ended_session_id' \gset
\if :p4h_void_preserves_events
\else
  \echo P4H lifecycle failed: void did not preserve session events
  \quit 1
\endif

-- 有已开始历史的班级绝不能进入回收站。
do $$
begin
  begin
    perform public.trash_classroom(current_setting('p4h.audit_classroom_id')::uuid);
    raise exception 'P4H_HISTORY_CLASSROOM_TRASH_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'CLASSROOM_HAS_HISTORY' then raise; end if;
  end;
end;
$$;

-- stale base 必须在更新任何讲次元数据前失败。
do $$
begin
  begin
    perform public.save_teaching_plan(
      current_setting('p4h.audit_course_id')::uuid,
      current_setting('p4h.audit_course_updated_at')::timestamptz - interval '1 microsecond',
      jsonb_build_array(jsonb_build_object(
        'id', current_setting('p4h.audit_lecture_id'),
        'name', '__P4H_STALE_NAME__',
        'objectives', 'stale objective'
      ))
    );
    raise exception 'P4H_STALE_PLAN_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'STALE_WRITE' then raise; end if;
  end;
end;
$$;
select (name = '__P4H_AUDIT_LECTURE__' and objectives = 'original objective') as p4h_stale_no_partial_write
from public.course_lectures where id = :'audit_lecture_id' \gset
\if :p4h_stale_no_partial_write
\else
  \echo P4H lifecycle failed: stale plan partially wrote lecture metadata
  \quit 1
\endif

rollback;
