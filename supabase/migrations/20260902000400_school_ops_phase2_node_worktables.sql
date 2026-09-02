-- DEV-SCHOOL-OPS-1 / Phase 2 redo: preserve spreadsheet-speed entry while
-- writing each business node to its own structured fact.

alter table public.assessment_results
  alter column overall_level drop not null,
  add column assessment_band text
    check (assessment_band in ('below_a', 'a', 'a_plus', 'g_plus', 's', 'x_plus')),
  add column parent_concerns text not null default '',
  add column recommended_class text not null default '';

create table public.activity_routes (
  id uuid primary key default gen_random_uuid(),
  activity_registration_id uuid not null unique
    references public.activity_registrations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  route text not null
    check (route in ('continue_follow_up', 'await_product', 'closed')),
  note text not null default '',
  routed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index activity_routes_route_updated_idx
  on public.activity_routes(route, updated_at desc);
create index activity_routes_student_idx
  on public.activity_routes(student_id, updated_at desc);

create trigger activity_routes_set_updated_at
  before update on public.activity_routes
  for each row execute function public.set_updated_at();

alter table public.activity_routes enable row level security;

create policy activity_routes_followup_select
  on public.activity_routes for select to authenticated
  using (
    public.has_perm((select auth.uid()), 'followup.view')
    and public.can_access_student(student_id, (select auth.uid()))
  );

revoke all on public.activity_routes from anon, authenticated;
grant select on public.activity_routes to authenticated;

-- Booking and attendance remain Participation facts. They no longer mutate a
-- single global student follow-up status that mixes unrelated business nodes.
create or replace function public.book_activity(
  p_activity_id uuid,
  p_student_id uuid
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cap smallint;
  used integer;
  activity_title text;
  registration_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'activity.register') then raise exception 'FORBIDDEN'; end if;
  if not public.can_access_student(p_student_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  select capacity, title into cap, activity_title
    from public.activities
   where id = p_activity_id and deleted_at is null
   for update;
  if activity_title is null then raise exception 'ACTIVITY_NOT_FOUND'; end if;

  select count(*) into used
    from public.activity_registrations
   where activity_id = p_activity_id and status in ('booked', 'attended');
  if cap is not null and used >= cap and not exists (
    select 1 from public.activity_registrations
     where activity_id = p_activity_id
       and student_id = p_student_id
       and status in ('booked', 'attended')
  ) then
    raise exception 'ACTIVITY_FULL';
  end if;

  insert into public.activity_registrations(activity_id, student_id, status, operated_by)
  values (p_activity_id, p_student_id, 'booked', uid)
  on conflict(activity_id, student_id) do update
    set status = 'booked', outcome = '', operated_by = uid
  returning id into registration_id;

  insert into public.student_follow_ups(student_id, author_id, content, kind)
  values (p_student_id, uid, '加入活动名单：' || activity_title, 'activity');
  return registration_id;
end;
$$;

create or replace function public.begin_activity_assessment(p_registration_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  activity_title text;
  participation_status text;
begin
  if uid is null or not (
    public.has_perm(uid, 'activity.register')
    or public.has_perm(uid, 'review.write')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select registration.student_id, registration.status, activity.title
    into sid, participation_status, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
     and activity.deleted_at is null
   for update of registration;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.has_perm(uid, 'review.write')
     and not public.can_access_student(sid, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if participation_status = 'cancelled' then raise exception 'PARTICIPATION_CANCELLED'; end if;
  if participation_status = 'attended' then return; end if;

  update public.activity_registrations
     set status = 'attended', operated_by = uid
   where id = p_registration_id;

  insert into public.student_follow_ups(student_id, author_id, content, kind)
  values (sid, uid, '活动到场：' || activity_title, 'activity');
end;
$$;

create or replace function public.mark_activity_result(
  p_registration_id uuid,
  p_status text,
  p_outcome text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  activity_title text;
begin
  if uid is null or not public.has_perm(uid, 'activity.register') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('attended', 'no_show', 'cancelled') then raise exception 'INVALID_STATUS'; end if;

  select registration.student_id, activity.title
    into sid, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id;
  if sid is null then raise exception 'NOT_FOUND'; end if;
  if not public.can_access_student(sid, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  update public.activity_registrations
     set status = p_status,
         outcome = left(btrim(coalesce(p_outcome, '')), 1000),
         operated_by = uid
   where id = p_registration_id;

  insert into public.student_follow_ups(student_id, author_id, content, kind)
  values (
    sid,
    uid,
    case p_status
      when 'attended' then '活动到场：'
      when 'no_show' then '活动未到：'
      else '取消活动：'
    end || activity_title || case
      when btrim(coalesce(p_outcome, '')) <> '' then '；' || left(btrim(p_outcome), 1000)
      else ''
    end,
    'activity'
  );
end;
$$;

create or replace function public.save_activity_assessment_row(
  p_registration_id uuid,
  p_assessment_band text default null,
  p_score smallint default null,
  p_strengths text default '',
  p_focus_areas text default '',
  p_parent_concerns text default '',
  p_teacher_recommendation text default '',
  p_recommended_class text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  activity_title text;
  result_id uuid;
  is_new boolean;
begin
  if uid is null or not (
    public.has_perm(uid, 'activity.register')
    or public.has_perm(uid, 'review.write')
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if p_assessment_band is not null
       and p_assessment_band not in ('below_a', 'a', 'a_plus', 'g_plus', 's', 'x_plus')
     or p_score is not null and p_score not between 0 and 100
     or char_length(coalesce(p_strengths, '')) > 2000
     or char_length(coalesce(p_focus_areas, '')) > 2000
     or char_length(coalesce(p_parent_concerns, '')) > 2000
     or char_length(coalesce(p_teacher_recommendation, '')) > 2000
     or char_length(coalesce(p_recommended_class, '')) > 200 then
    raise exception 'INVALID_ASSESSMENT';
  end if;

  perform public.begin_activity_assessment(p_registration_id);

  select registration.student_id, activity.title
    into sid, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
     and activity.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;

  is_new := not exists (
    select 1 from public.assessment_results
     where activity_registration_id = p_registration_id
  );

  insert into public.assessment_results (
    activity_registration_id, student_id, overall_level, assessment_band, score,
    strengths, focus_areas, parent_concerns, teacher_recommendation,
    recommended_class, assessed_by
  ) values (
    p_registration_id, sid, null, p_assessment_band, p_score,
    btrim(coalesce(p_strengths, '')),
    btrim(coalesce(p_focus_areas, '')),
    btrim(coalesce(p_parent_concerns, '')),
    btrim(coalesce(p_teacher_recommendation, '')),
    btrim(coalesce(p_recommended_class, '')),
    uid
  )
  on conflict (activity_registration_id) do update
    set assessment_band = excluded.assessment_band,
        score = excluded.score,
        strengths = excluded.strengths,
        focus_areas = excluded.focus_areas,
        parent_concerns = excluded.parent_concerns,
        teacher_recommendation = excluded.teacher_recommendation,
        recommended_class = excluded.recommended_class,
        assessed_by = excluded.assessed_by
  returning id into result_id;

  if is_new then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (sid, uid, '已填写测评记录：' || activity_title, 'activity');
  end if;

  return result_id;
end;
$$;

create or replace function public.save_activity_route(
  p_registration_id uuid,
  p_route text,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  participation_status text;
  activity_title text;
  previous_route text;
  route_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_route not in ('continue_follow_up', 'await_product', 'closed')
     or char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'INVALID_ACTIVITY_ROUTE';
  end if;

  select registration.student_id, registration.status, activity.title
    into sid, participation_status, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
     and activity.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if participation_status <> 'attended' then raise exception 'PARTICIPATION_NOT_ATTENDED'; end if;
  if not public.can_access_student(sid, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  select route into previous_route
    from public.activity_routes
   where activity_registration_id = p_registration_id;

  insert into public.activity_routes (
    activity_registration_id, student_id, route, note, routed_by
  ) values (
    p_registration_id, sid, p_route, btrim(coalesce(p_note, '')), uid
  )
  on conflict (activity_registration_id) do update
    set route = excluded.route,
        note = excluded.note,
        routed_by = excluded.routed_by
  returning id into route_id;

  if previous_route is distinct from p_route then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (
      sid,
      uid,
      '到访后归类：' || activity_title || '；' || case p_route
        when 'continue_follow_up' then '未报名，继续沟通'
        when 'await_product' then '待产品投放'
        else '本轮结束'
      end,
      'activity'
    );
  end if;

  return route_id;
end;
$$;

revoke all on function public.save_activity_assessment_row(uuid, text, smallint, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.save_activity_route(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.save_activity_assessment_row(uuid, text, smallint, text, text, text, text, text)
  to authenticated;
grant execute on function public.save_activity_route(uuid, text, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
