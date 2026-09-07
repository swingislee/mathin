-- 月度新增报名目标：老师 × 年级明细求和；Base 快照只作为不可变参考。
create table public.school_monthly_targets (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  revision integer not null default 1 check (revision > 0),
  teacher_grade_targets jsonb not null default '[]'::jsonb,
  enrollment_target integer check (enrollment_target between 0 and 1000000),
  arrival_target integer check (arrival_target between 0 and 1000000),
  invitation_target integer check (invitation_target between 0 and 1000000),
  target_basis text not null default 'source' check (target_basis in ('source', 'teacher_grade')),
  source_snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  check (jsonb_typeof(teacher_grade_targets) = 'array' and octet_length(teacher_grade_targets::text) <= 65536),
  check (jsonb_typeof(source_snapshot) = 'object' and octet_length(source_snapshot::text) <= 65536)
);
alter table public.school_monthly_targets enable row level security;
revoke all on public.school_monthly_targets from anon, authenticated;
grant select on public.school_monthly_targets to authenticated;
create policy school_monthly_targets_read on public.school_monthly_targets for select to authenticated
  using (public.has_perm(auth.uid(), 'organization.settings.manage'));

create function public.initialize_school_monthly_targets(p_month date, p_source jsonb)
returns public.school_monthly_targets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := public.assert_organization_manager();
  result public.school_monthly_targets;
  item jsonb;
begin
  if p_month is null or extract(day from p_month) <> 1 or p_source is null
    or jsonb_typeof(p_source) <> 'object' or octet_length(p_source::text) > 65536
    or coalesce(p_source->>'sha256', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_source->>'capturedOn', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(length(p_source->>'label'), 0) not between 1 and 200
    or jsonb_typeof(p_source->'teachers') is distinct from 'array'
    or jsonb_typeof(p_source->'grades') is distinct from 'array'
    or jsonb_typeof(p_source->'cells') is distinct from 'array' then
    raise exception 'VALIDATION';
  end if;
  if jsonb_array_length(p_source->'teachers') not between 1 and 30
    or jsonb_array_length(p_source->'grades') not between 1 and 16
    or jsonb_array_length(p_source->'cells') > 512 then raise exception 'VALIDATION'; end if;
  if exists(select 1 from jsonb_array_elements((p_source->'teachers') || (p_source->'grades')) value
      where jsonb_typeof(value) <> 'string' or length(btrim(value #>> '{}')) not between 1 and 80)
    or (select count(distinct value) from jsonb_array_elements(p_source->'teachers')) <> jsonb_array_length(p_source->'teachers')
    or (select count(distinct value) from jsonb_array_elements(p_source->'grades')) <> jsonb_array_length(p_source->'grades') then
    raise exception 'VALIDATION';
  end if;
  foreach item in array array[p_source->'enrollments', p_source->'enrollmentTarget', p_source->'arrivals',
      p_source->'arrivalTarget', p_source->'invitations', p_source->'invitationTarget', p_source->'missingDate', p_source->'unassignedTeacher'] loop
    if jsonb_typeof(item) is distinct from 'number' or coalesce(item::text, '') !~ '^\d{1,7}$'
      or item::text::integer > 1000000 then raise exception 'VALIDATION'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_source->'cells') loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'teacher') is distinct from 'string'
      or (item->>'teacher' <> '' and not (p_source->'teachers' ? (item->>'teacher')))
      or not coalesce(p_source->'grades' ? (item->>'grade'), false)
      or jsonb_typeof(item->'actual') is distinct from 'number'
      or coalesce(item->>'actual', '') !~ '^\d{1,6}$'
      or jsonb_typeof(item->'undated') is distinct from 'number'
      or coalesce(item->>'undated', '') !~ '^\d{1,6}$' then raise exception 'VALIDATION'; end if;
    if (item->>'undated')::integer > (item->>'actual')::integer then raise exception 'VALIDATION'; end if;
  end loop;
  if (select count(distinct (value->>'teacher', value->>'grade')) from jsonb_array_elements(p_source->'cells')) <> jsonb_array_length(p_source->'cells')
    or (select coalesce(sum((value->>'actual')::integer), 0) from jsonb_array_elements(p_source->'cells')) <> (p_source->>'enrollments')::integer
    or (select coalesce(sum((value->>'undated')::integer), 0) from jsonb_array_elements(p_source->'cells')) <> (p_source->>'missingDate')::integer
    or (select coalesce(sum((value->>'actual')::integer), 0) from jsonb_array_elements(p_source->'cells') where value->>'teacher' = '') <> (p_source->>'unassignedTeacher')::integer then
    raise exception 'VALIDATION';
  end if;
  insert into public.school_monthly_targets(month, source_snapshot, enrollment_target, arrival_target, invitation_target, updated_by)
    values(p_month, p_source, (p_source->>'enrollmentTarget')::integer,
      (p_source->>'arrivalTarget')::integer, (p_source->>'invitationTarget')::integer, uid)
    returning * into result;
  perform public.emit_domain_event('school_monthly_target.initialized', 'school_monthly_target', result.id,
    jsonb_build_object('month', p_month, 'sourceSha256', p_source->>'sha256', 'referenceTarget', result.enrollment_target));
  return result;
end $$;

create function public.save_school_monthly_targets(
  p_month date, p_revision integer, p_targets jsonb, p_arrival_target integer, p_invitation_target integer
) returns public.school_monthly_targets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := public.assert_organization_manager();
  previous public.school_monthly_targets;
  result public.school_monthly_targets;
  item jsonb;
  total integer;
begin
  select * into previous from public.school_monthly_targets where month = p_month for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_revision is distinct from previous.revision then raise exception 'VERSION_CONFLICT'; end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or octet_length(p_targets::text) > 65536
    or p_arrival_target not between 0 and 1000000 or p_invitation_target not between 0 and 1000000 then
    raise exception 'VALIDATION';
  end if;
  if jsonb_array_length(p_targets) <> jsonb_array_length(previous.source_snapshot->'teachers') * jsonb_array_length(previous.source_snapshot->'grades') then
    raise exception 'VALIDATION';
  end if;
  for item in select value from jsonb_array_elements(p_targets) loop
    if jsonb_typeof(item) <> 'object' or not coalesce(previous.source_snapshot->'teachers' ? (item->>'teacher'), false)
      or not coalesce(previous.source_snapshot->'grades' ? (item->>'grade'), false)
      or not (item ? 'target') or jsonb_typeof(item->'target') not in ('number', 'null') then raise exception 'VALIDATION'; end if;
    if item->'target' <> 'null'::jsonb and (coalesce(item->>'target', '') !~ '^\d{1,4}$'
      or (item->>'target')::integer > 9999) then raise exception 'VALIDATION'; end if;
  end loop;
  if (select count(distinct (value->>'teacher', value->>'grade')) from jsonb_array_elements(p_targets)) <> jsonb_array_length(p_targets) then
    raise exception 'VALIDATION';
  end if;
  select sum((value->>'target')::integer) into total from jsonb_array_elements(p_targets);
  if total > 1000000 then raise exception 'VALIDATION'; end if;
  update public.school_monthly_targets set
    teacher_grade_targets = (select jsonb_agg(jsonb_build_object('teacher', value->>'teacher', 'grade', value->>'grade', 'target', value->'target')) from jsonb_array_elements(p_targets)),
    enrollment_target = coalesce(total, (source_snapshot->>'enrollmentTarget')::integer),
    target_basis = case when total is null then 'source' else 'teacher_grade' end,
    arrival_target = p_arrival_target, invitation_target = p_invitation_target,
    revision = revision + 1, updated_at = now(), updated_by = uid
    where id = previous.id returning * into result;
  perform public.emit_domain_event('school_monthly_target.updated', 'school_monthly_target', result.id,
    jsonb_build_object('month', p_month, 'previousRevision', previous.revision, 'revision', result.revision,
      'previousTargets', previous.teacher_grade_targets, 'targets', result.teacher_grade_targets,
      'previousEnrollmentTarget', previous.enrollment_target, 'enrollmentTarget', result.enrollment_target,
      'previousArrivalTarget', previous.arrival_target, 'arrivalTarget', result.arrival_target,
      'previousInvitationTarget', previous.invitation_target, 'invitationTarget', result.invitation_target));
  return result;
end $$;

revoke all on function public.initialize_school_monthly_targets(date, jsonb) from public, anon;
revoke all on function public.save_school_monthly_targets(date, integer, jsonb, integer, integer) from public, anon;
grant execute on function public.initialize_school_monthly_targets(date, jsonb) to authenticated;
grant execute on function public.save_school_monthly_targets(date, integer, jsonb, integer, integer) to authenticated;
