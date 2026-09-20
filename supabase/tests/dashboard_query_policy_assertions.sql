-- 仅供已核对目标的本地事务验证使用。固定账号由运行器传入，所有样本与迁移均回滚。
create temp table query_audit_context as
select gen_random_uuid() as classroom_id, gen_random_uuid() as session_id,
  gen_random_uuid() as student_id, gen_random_uuid() as unrelated_student_id,
  current_setting('mathin.query_audit.actors')::jsonb as actors;

-- 复用固定学生账号；已有映射在事务结束时恢复，与课堂名册回归配方一致。
update public.students set user_id = null
where user_id = (current_setting('mathin.query_audit.actors')::jsonb ->> 'student')::uuid;
insert into public.students(id, name, bind_code, user_id, assigned_to)
select student_id, '__QUERY_AUDIT_OWN__', student_id::text,
  (actors ->> 'student')::uuid, (actors ->> 'staff')::uuid from query_audit_context
union all
select unrelated_student_id, '__QUERY_AUDIT_OTHER__', unrelated_student_id::text,
  null::uuid, null::uuid from query_audit_context;
insert into public.student_guardians(student_id, guardian_id)
select student_id, (actors ->> 'parent')::uuid from query_audit_context;
insert into public.classrooms(id, owner_id, name, invite_code)
select classroom_id, (actors ->> 'admin')::uuid, '__QUERY_AUDIT_CLASS__',
  upper(left(replace(classroom_id::text, '-', ''), 8)) from query_audit_context;
insert into public.classroom_members(classroom_id, user_id, role)
select classroom_id, (actors ->> 'staff')::uuid, 'teacher' from query_audit_context;
insert into public.class_sessions(id, classroom_id, title)
select session_id, classroom_id, '__QUERY_AUDIT_SESSION__' from query_audit_context;
insert into public.session_roster_revisions(session_id, revision, source_hash, reason, created_by)
select session_id, 1, repeat('0', 64), 'start', (actors ->> 'admin')::uuid from query_audit_context;
insert into public.session_roster_entries(session_id, revision, student_id, name, user_id, roster_order)
select session_id, 1, student_id, '__QUERY_AUDIT_SNAPSHOT__', (actors ->> 'admin')::uuid, 0
from query_audit_context;

create temp table query_audit_events as
select gen_random_uuid() as id, context.session_id, event.label, event.type, event.payload
from query_audit_context context cross join lateral (values
  ('v2-own', 'star', jsonb_build_object('schemaVersion', 2, 'studentId', student_id)),
  ('v2-undo', 'star_undo', jsonb_build_object('schemaVersion', 2, 'studentId', student_id)),
  ('v2-other', 'star', jsonb_build_object('schemaVersion', 2, 'studentId', unrelated_student_id)),
  ('legacy-account', 'star', jsonb_build_object('studentId', actors ->> 'student')),
  ('legacy-v1', 'star', jsonb_build_object('schemaVersion', 1, 'studentId', actors ->> 'student')),
  ('legacy-roster', 'star', jsonb_build_object('studentId', actors ->> 'admin')),
  ('uppercase', 'star', jsonb_build_object('schemaVersion', 2, 'studentId', upper(student_id::text))),
  ('malformed', 'star', jsonb_build_object('schemaVersion', 2, 'studentId', 'not-a-uuid')),
  ('string-version', 'star', jsonb_build_object('schemaVersion', '2', 'studentId', student_id)),
  ('null-version', 'star', jsonb_build_object('schemaVersion', null, 'studentId', student_id)),
  ('null-student', 'star', jsonb_build_object('schemaVersion', 2, 'studentId', null)),
  ('non-star', 'hand', jsonb_build_object('schemaVersion', 2, 'studentId', student_id))
) event(label, type, payload);
insert into public.session_events(id, session_id, user_id, device_id, seq, type, payload, at)
select id, session_id, (current_setting('mathin.query_audit.actors')::jsonb ->> 'admin')::uuid,
  'query-audit', row_number() over (order by label), type, payload, now() from query_audit_events
where label in ('v2-own','v2-other','legacy-account','legacy-roster');
grant select on query_audit_context, query_audit_events to authenticated;
create temp table query_audit_results(phase text, actor text, labels text[]);

-- 将真实 session_events 的所有读策略一起比较；单独的学生策略也验证正例和畸形负例。
create function pg_temp.capture_query_audit(p_phase text, p_actor text) returns void language plpgsql as $$
declare actor text; actor_id text; labels text[]; predicate text; own_visible boolean; invalid_visible boolean;
begin
  for actor, actor_id in select key, value from jsonb_each_text(current_setting('mathin.query_audit.actors')::jsonb) where key=p_actor loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    select pg_get_expr(polqual, polrelid) into predicate from pg_policy
      where polrelid = 'public.session_events'::regclass and polname = 'events_select_student_scope';
    set local role authenticated;
    select coalesce(array_agg(fixture.label order by fixture.label), '{}') into labels
      from public.session_events event join query_audit_events fixture on fixture.id = event.id
      where event.session_id=(select session_id from query_audit_context);
    if p_phase='after' then
      execute format('select bool_or(label = ''v2-own'' and (%1$s) is true),
      bool_or(label in (''uppercase'',''malformed'',''string-version'',''null-version'',''null-student'',''non-star'') and (%1$s) is true)
        from query_audit_events session_events', predicate) into own_visible, invalid_visible;
    end if;
    reset role;
    if p_phase='after' and (own_visible is distinct from (actor in ('admin','staff')) or invalid_visible is distinct from false) then
      raise exception 'QUERY_AUDIT_POLICY_POSITIVE_OR_NEGATIVE: % %', p_phase, actor;
    end if;
    -- 现有 students RLS 面向员工；家庭使用 family_students。此补丁保持嵌套 RLS 的拒绝范围。
    if actor in ('student', 'parent') and labels is distinct from '{}'::text[] then
      raise exception 'QUERY_AUDIT_FAMILY_SCOPE: % %', p_phase, actor;
    end if;
    insert into query_audit_results values(p_phase, actor, labels);
  end loop;
end;
$$;
select pg_temp.capture_query_audit('before','admin');
select pg_temp.capture_query_audit('before','staff');
select pg_temp.capture_query_audit('before','parent');
select pg_temp.capture_query_audit('before','student');
