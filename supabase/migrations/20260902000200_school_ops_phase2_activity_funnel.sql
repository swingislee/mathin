-- DEV-SCHOOL-OPS-1 / Phase 2: turn one-off activity participation into
-- structured assessment facts and an owned sales opportunity.

create table public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  activity_registration_id uuid not null unique
    references public.activity_registrations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  overall_level text not null
    check (overall_level in ('needs_support', 'developing', 'on_track', 'advanced')),
  score smallint check (score between 0 and 100),
  strengths text not null default '',
  focus_areas text not null default '',
  teacher_recommendation text not null default '',
  assessed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  source_registration_id uuid not null unique
    references public.activity_registrations(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  owner_id uuid references public.profiles(id) on delete set null,
  stage text not null default 'new'
    check (stage in ('new', 'contacting', 'interested', 'won', 'lost')),
  next_action text not null default '',
  next_action_at timestamptz,
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_opportunities_open_next_action_check check (
    stage in ('won', 'lost')
    or (btrim(next_action) <> '' and next_action_at is not null)
  )
);

create index assessment_results_student_idx
  on public.assessment_results(student_id, updated_at desc);
create index sales_opportunities_owner_stage_idx
  on public.sales_opportunities(owner_id, stage, next_action_at);
create index sales_opportunities_student_idx
  on public.sales_opportunities(student_id, updated_at desc);

create trigger assessment_results_set_updated_at
  before update on public.assessment_results
  for each row execute function public.set_updated_at();
create trigger sales_opportunities_set_updated_at
  before update on public.sales_opportunities
  for each row execute function public.set_updated_at();

alter table public.assessment_results enable row level security;
alter table public.sales_opportunities enable row level security;

create policy assessment_results_staff_select
  on public.assessment_results for select to authenticated
  using (public.is_staff((select auth.uid())));

create policy sales_opportunities_followup_select
  on public.sales_opportunities for select to authenticated
  using (
    public.has_perm((select auth.uid()), 'followup.view')
    and public.can_access_student(student_id, (select auth.uid()))
  );

revoke all on public.assessment_results from anon, authenticated;
revoke all on public.sales_opportunities from anon, authenticated;
grant select on public.assessment_results, public.sales_opportunities to authenticated;

create or replace function public.save_activity_assessment(
  p_registration_id uuid,
  p_overall_level text,
  p_score smallint default null,
  p_strengths text default '',
  p_focus_areas text default '',
  p_teacher_recommendation text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  activity_title text;
  participation_status text;
  result_id uuid;
  is_new boolean;
begin
  if uid is null or not (
    public.has_perm(uid, 'activity.register')
    or public.has_perm(uid, 'review.write')
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if p_overall_level not in ('needs_support', 'developing', 'on_track', 'advanced')
     or p_score is not null and p_score not between 0 and 100
     or btrim(coalesce(p_teacher_recommendation, '')) = ''
     or char_length(coalesce(p_strengths, '')) > 2000
     or char_length(coalesce(p_focus_areas, '')) > 2000
     or char_length(coalesce(p_teacher_recommendation, '')) > 2000 then
    raise exception 'INVALID_ASSESSMENT';
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

  is_new := not exists (
    select 1 from public.assessment_results
     where activity_registration_id = p_registration_id
  );

  insert into public.assessment_results (
    activity_registration_id, student_id, overall_level, score, strengths,
    focus_areas, teacher_recommendation, assessed_by
  ) values (
    p_registration_id, sid, p_overall_level, p_score,
    btrim(coalesce(p_strengths, '')),
    btrim(coalesce(p_focus_areas, '')),
    btrim(p_teacher_recommendation), uid
  )
  on conflict (activity_registration_id) do update
    set overall_level = excluded.overall_level,
        score = excluded.score,
        strengths = excluded.strengths,
        focus_areas = excluded.focus_areas,
        teacher_recommendation = excluded.teacher_recommendation,
        assessed_by = excluded.assessed_by
  returning id into result_id;

  if is_new then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (
      sid,
      uid,
      '测评结果：' || activity_title || '；' || btrim(p_teacher_recommendation),
      'activity'
    );
  end if;

  return result_id;
end;
$$;

create or replace function public.list_sales_opportunity_owners()
returns table (user_id uuid, display_name text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select profile.id, profile.display_name
    from public.profiles profile
   where auth.uid() is not null
     and public.has_perm(auth.uid(), 'followup.write')
     and profile.role in ('staff', 'admin')
     and profile.is_active
     and public.has_perm(profile.id, 'followup.write')
   order by profile.display_name, profile.id;
$$;

create or replace function public.create_activity_opportunity(
  p_registration_id uuid,
  p_owner_id uuid,
  p_next_action text,
  p_next_action_at timestamptz,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  activity_title text;
  participation_status text;
  opportunity_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_owner_id is null
     or p_next_action_at is null
     or btrim(coalesce(p_next_action, '')) = ''
     or char_length(coalesce(p_next_action, '')) > 500
     or char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'INVALID_OPPORTUNITY';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = p_owner_id
       and role in ('staff', 'admin')
       and is_active
       and public.has_perm(id, 'followup.write')
  ) then
    raise exception 'INVALID_OWNER';
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
  if not exists (
    select 1 from public.assessment_results
     where activity_registration_id = p_registration_id
  ) then
    raise exception 'ASSESSMENT_REQUIRED';
  end if;

  select id into opportunity_id
    from public.sales_opportunities
   where source_registration_id = p_registration_id;
  if found then return opportunity_id; end if;

  insert into public.sales_opportunities (
    source_registration_id, student_id, owner_id, stage,
    next_action, next_action_at, note, created_by, updated_by
  ) values (
    p_registration_id, sid, p_owner_id, 'new',
    btrim(p_next_action), p_next_action_at, btrim(coalesce(p_note, '')), uid, uid
  ) returning id into opportunity_id;

  update public.students
     set assigned_to = p_owner_id
   where id = sid and deleted_at is null;

  insert into public.student_follow_ups(
    student_id, author_id, content, kind, next_follow_up_at
  )
  values (
    sid,
    uid,
    '建立课程意向：' || activity_title || '；下一动作：' || btrim(p_next_action),
    'activity',
    p_next_action_at
  );

  return opportunity_id;
end;
$$;

create or replace function public.update_sales_opportunity(
  p_opportunity_id uuid,
  p_stage text,
  p_owner_id uuid,
  p_next_action text default '',
  p_next_action_at timestamptz default null,
  p_note text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null or not public.has_perm(uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_stage not in ('new', 'contacting', 'interested', 'won', 'lost')
     or p_owner_id is null
     or char_length(coalesce(p_next_action, '')) > 500
     or char_length(coalesce(p_note, '')) > 2000
     or (
       p_stage not in ('won', 'lost')
       and (btrim(coalesce(p_next_action, '')) = '' or p_next_action_at is null)
     ) then
    raise exception 'INVALID_OPPORTUNITY';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = p_owner_id
       and role in ('staff', 'admin')
       and is_active
       and public.has_perm(id, 'followup.write')
  ) then
    raise exception 'INVALID_OWNER';
  end if;

  select student_id into sid
    from public.sales_opportunities
   where id = p_opportunity_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.can_access_student(sid, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  update public.sales_opportunities
     set stage = p_stage,
         owner_id = p_owner_id,
         next_action = btrim(coalesce(p_next_action, '')),
         next_action_at = p_next_action_at,
         note = btrim(coalesce(p_note, '')),
         updated_by = uid
   where id = p_opportunity_id;

  update public.students
     set assigned_to = p_owner_id
   where id = sid and deleted_at is null;

  insert into public.student_follow_ups(
    student_id, author_id, content, kind, next_follow_up_at
  )
  values (
    sid,
    uid,
    '课程意向进展：' || p_stage ||
      case when btrim(coalesce(p_next_action, '')) <> ''
        then '；下一动作：' || btrim(p_next_action)
        else ''
      end,
    'activity',
    case when p_stage in ('won', 'lost') then null else p_next_action_at end
  );
end;
$$;

revoke all on function public.save_activity_assessment(uuid, text, smallint, text, text, text)
  from public, anon, authenticated;
revoke all on function public.list_sales_opportunity_owners()
  from public, anon, authenticated;
revoke all on function public.create_activity_opportunity(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.update_sales_opportunity(uuid, text, uuid, text, timestamptz, text)
  from public, anon, authenticated;

grant execute on function public.save_activity_assessment(uuid, text, smallint, text, text, text)
  to authenticated;
grant execute on function public.list_sales_opportunity_owners()
  to authenticated;
grant execute on function public.create_activity_opportunity(uuid, uuid, text, timestamptz, text)
  to authenticated;
grant execute on function public.update_sales_opportunity(uuid, text, uuid, text, timestamptz, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
