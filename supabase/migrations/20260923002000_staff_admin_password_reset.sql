-- Temporary admin reset for an active staff account that already completed
-- the onboarding password change. The generated credential is only retained
-- as a one-way digest until the employee chooses a new password.

create table public.staff_password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'prepared'
    check (status in ('prepared', 'awaiting_change', 'completed', 'rolled_back')),
  temporary_password_hash text,
  previous_temporary_password_hash text,
  previous_status text check (previous_status is null or previous_status in ('prepared', 'awaiting_change')),
  previous_requested_by uuid references public.profiles(id) on delete restrict,
  previous_initial_password_set_at timestamptz,
  previous_password_changed_at timestamptz,
  created_at timestamptz not null default now(),
  prepared_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint staff_password_reset_requests_state_check check (
    (
      status = 'prepared'
      and temporary_password_hash ~ '^[a-f0-9]{32}$'
      and completed_at is null
      and (
        (previous_temporary_password_hash is null and previous_status is null and previous_requested_by is null)
        or
        (previous_temporary_password_hash ~ '^[a-f0-9]{32}$' and previous_status is not null and previous_status in ('prepared', 'awaiting_change') and previous_requested_by is not null)
      )
    )
    or
    (
      status = 'awaiting_change'
      and temporary_password_hash ~ '^[a-f0-9]{32}$'
      and previous_temporary_password_hash is null
      and previous_status is null
      and previous_requested_by is null
      and previous_initial_password_set_at is null
      and previous_password_changed_at is null
      and completed_at is null
    )
    or
    (
      status in ('completed', 'rolled_back')
      and temporary_password_hash is null
      and previous_temporary_password_hash is null
      and previous_status is null
      and previous_requested_by is null
      and previous_initial_password_set_at is null
      and previous_password_changed_at is null
      and completed_at is not null
    )
  )
);

create unique index staff_password_reset_requests_one_active_target_idx
  on public.staff_password_reset_requests(target_user_id)
  where status in ('prepared', 'awaiting_change');

create index staff_password_reset_requests_actor_created_idx
  on public.staff_password_reset_requests(requested_by, created_at desc);

alter table public.staff_password_reset_requests enable row level security;
revoke all on public.staff_password_reset_requests from public, anon, authenticated;

create or replace function public.prevent_initial_password_reissue_during_staff_reset()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists(
    select 1 from public.staff_password_reset_requests request_row
     where request_row.target_user_id = new.target_user_id
       and request_row.status in ('prepared', 'awaiting_change')
  ) then raise exception 'PASSWORD_RESET_IN_PROGRESS'; end if;
  return new;
end
$$;

create trigger staff_initial_password_reissue_reset_guard
before insert on public.staff_initial_password_reissues
for each row execute function public.prevent_initial_password_reissue_during_staff_reset();

create or replace function public.prepare_staff_password_reset(
  p_actor_id uuid,
  p_user_id uuid,
  p_temporary_password_hash text
) returns table(reset_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile public.profiles%rowtype;
  target_profile public.profiles%rowtype;
  request_row public.staff_password_reset_requests%rowtype;
  new_reset_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_temporary_password_hash is null or p_temporary_password_hash !~ '^[a-f0-9]{32}$' then
    raise exception 'INVALID_TEMPORARY_PASSWORD_HASH';
  end if;

  select * into actor_profile from public.profiles where id = p_actor_id;
  if actor_profile.id is null
     or actor_profile.role <> 'admin'
     or not actor_profile.is_active
     or actor_profile.account_status <> 'active'
     or actor_profile.password_change_required
  then raise exception 'FORBIDDEN'; end if;

  select * into target_profile
    from public.profiles
   where id = p_user_id
   for update;
  if target_profile.id is null
     or target_profile.role <> 'staff'
     or not target_profile.is_active
     or target_profile.account_status <> 'active'
  then raise exception 'TARGET_NOT_RESETTABLE'; end if;

  select * into request_row
    from public.staff_password_reset_requests
   where target_user_id = p_user_id
     and status in ('prepared', 'awaiting_change')
   for update;

  if target_profile.password_change_required then
    if request_row.id is null
       or (request_row.status = 'prepared' and request_row.prepared_at > now() - interval '1 minute')
    then
      raise exception 'PASSWORD_RESET_IN_PROGRESS';
    end if;
    update public.staff_password_reset_requests
       set status = 'prepared',
           prepared_at = now(),
           previous_temporary_password_hash = temporary_password_hash,
           previous_status = status,
           previous_requested_by = requested_by,
           temporary_password_hash = p_temporary_password_hash,
           previous_initial_password_set_at = target_profile.initial_password_set_at,
           previous_password_changed_at = target_profile.password_changed_at,
           requested_by = p_actor_id
     where id = request_row.id
     returning id into new_reset_id;
  else
    if request_row.id is not null then raise exception 'PASSWORD_RESET_IN_PROGRESS'; end if;
    insert into public.staff_password_reset_requests(
      target_user_id,
      requested_by,
      temporary_password_hash,
      previous_initial_password_set_at,
      previous_password_changed_at
    ) values(
      p_user_id,
      p_actor_id,
      p_temporary_password_hash,
      target_profile.initial_password_set_at,
      target_profile.password_changed_at
    ) returning id into new_reset_id;
  end if;

  update public.profiles
     set password_change_required = true,
         initial_password_set_at = now(),
         password_changed_at = null
   where id = p_user_id;

  perform public.emit_domain_event(
    'account.staff_password_reset_prepared',
    'profile',
    p_user_id,
    jsonb_build_object('resetId', new_reset_id),
    p_actor_id,
    null
  );
  return query select new_reset_id;
end
$$;

create or replace function public.rollback_staff_password_reset(
  p_reset_id uuid,
  p_actor_id uuid,
  p_expected_temporary_password_hash text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare request_row public.staff_password_reset_requests%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into request_row
    from public.staff_password_reset_requests
   where id = p_reset_id
   for update;
  if request_row.id is null
     or request_row.status <> 'prepared'
     or request_row.requested_by <> p_actor_id
     or request_row.temporary_password_hash <> p_expected_temporary_password_hash
  then raise exception 'PASSWORD_RESET_ROLLBACK_FAILED'; end if;

  if request_row.previous_temporary_password_hash is not null then
    update public.profiles
       set password_change_required = true,
           initial_password_set_at = request_row.previous_initial_password_set_at,
           password_changed_at = request_row.previous_password_changed_at
     where id = request_row.target_user_id
       and password_change_required;
    if not found then raise exception 'PASSWORD_RESET_ROLLBACK_FAILED'; end if;

    update public.staff_password_reset_requests
       set status = coalesce(request_row.previous_status, 'awaiting_change'),
           temporary_password_hash = previous_temporary_password_hash,
           previous_temporary_password_hash = null,
           previous_status = null,
           requested_by = previous_requested_by,
           previous_requested_by = null,
           previous_initial_password_set_at = null,
           previous_password_changed_at = null,
           completed_at = null
     where id = request_row.id;
  else
    update public.profiles
       set password_change_required = false,
           initial_password_set_at = request_row.previous_initial_password_set_at,
           password_changed_at = request_row.previous_password_changed_at
     where id = request_row.target_user_id
       and password_change_required;
    if not found then raise exception 'PASSWORD_RESET_ROLLBACK_FAILED'; end if;

    update public.staff_password_reset_requests
       set status = 'rolled_back',
           temporary_password_hash = null,
           previous_temporary_password_hash = null,
           previous_status = null,
           previous_requested_by = null,
           previous_initial_password_set_at = null,
           previous_password_changed_at = null,
           completed_at = now()
     where id = request_row.id;
  end if;

  perform public.emit_domain_event(
    'account.staff_password_reset_rolled_back',
    'profile',
    request_row.target_user_id,
    jsonb_build_object('resetId', request_row.id),
    p_actor_id,
    null
  );
end
$$;

create or replace function public.complete_staff_password_reset(
  p_reset_id uuid,
  p_actor_id uuid,
  p_expected_temporary_password_hash text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare request_row public.staff_password_reset_requests%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into request_row
    from public.staff_password_reset_requests
   where id = p_reset_id
   for update;
  if request_row.id is null
     or request_row.status <> 'prepared'
     or request_row.requested_by <> p_actor_id
     or request_row.temporary_password_hash <> p_expected_temporary_password_hash
     or not exists(
       select 1 from public.profiles target_profile
        where target_profile.id = request_row.target_user_id
          and target_profile.password_change_required
     )
  then raise exception 'PASSWORD_RESET_FINALIZE_FAILED'; end if;

  update public.staff_password_reset_requests
     set status = 'awaiting_change',
         previous_temporary_password_hash = null,
         previous_status = null,
         previous_requested_by = null,
         previous_initial_password_set_at = null,
         previous_password_changed_at = null
   where id = request_row.id;

  perform public.emit_domain_event(
    'account.staff_password_reset_issued',
    'profile',
    request_row.target_user_id,
    jsonb_build_object('resetId', request_row.id),
    p_actor_id,
    null
  );
end
$$;

create or replace function public.validate_staff_password_change(
  p_user_id uuid,
  p_candidate_password_hash text
) returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  temporary_password_hash text;
  request_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_candidate_password_hash is null or p_candidate_password_hash !~ '^[a-f0-9]{32}$' then
    raise exception 'INVALID_TEMPORARY_PASSWORD_HASH';
  end if;

  select request_row.temporary_password_hash, request_row.status
    into temporary_password_hash, request_status
    from public.staff_password_reset_requests request_row
    join public.profiles target_profile on target_profile.id = request_row.target_user_id
   where request_row.target_user_id = p_user_id
     and request_row.status in ('prepared', 'awaiting_change')
     and target_profile.password_change_required
   order by request_row.created_at desc
   limit 1;

  if temporary_password_hash is null then return false; end if;
  if request_status = 'prepared' then
    if exists(
      select 1 from public.staff_password_reset_requests request_row
       where request_row.target_user_id = p_user_id
         and request_row.status = 'prepared'
         and request_row.prepared_at > now() - interval '1 minute'
    ) then raise exception 'PASSWORD_RESET_IN_PROGRESS'; end if;
  end if;
  if temporary_password_hash = p_candidate_password_hash then
    raise exception 'SAME_AS_TEMPORARY_PASSWORD';
  end if;
  return true;
end
$$;

create or replace function public.complete_staff_password_change(
  p_user_id uuid,
  p_candidate_password_hash text
) returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  profile_row public.profiles%rowtype;
  request_row public.staff_password_reset_requests%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_candidate_password_hash is null or p_candidate_password_hash !~ '^[a-f0-9]{32}$' then
    raise exception 'INVALID_TEMPORARY_PASSWORD_HASH';
  end if;

  select * into profile_row from public.profiles where id = p_user_id for update;
  if profile_row.id is null then raise exception 'NOT_FOUND'; end if;
  if not profile_row.password_change_required then return false; end if;

  select * into request_row
    from public.staff_password_reset_requests
   where target_user_id = p_user_id
     and status in ('prepared', 'awaiting_change')
   order by created_at desc
   limit 1
   for update;

  if request_row.id is not null then
    if request_row.status = 'prepared'
       and request_row.prepared_at > now() - interval '1 minute'
    then raise exception 'PASSWORD_RESET_IN_PROGRESS'; end if;
    if request_row.temporary_password_hash = p_candidate_password_hash then
      raise exception 'SAME_AS_TEMPORARY_PASSWORD';
    end if;

    update public.profiles
       set password_change_required = false,
           password_changed_at = now()
     where id = p_user_id;

    update public.staff_password_reset_requests
       set status = 'completed',
           temporary_password_hash = null,
           previous_temporary_password_hash = null,
           previous_status = null,
           previous_requested_by = null,
           previous_initial_password_set_at = null,
           previous_password_changed_at = null,
           completed_at = now()
     where id = request_row.id;

    perform public.emit_domain_event(
      'account.staff_password_reset_changed',
      'profile',
      p_user_id,
      jsonb_build_object('resetId', request_row.id, 'completed', true),
      p_user_id,
      null
    );
    return true;
  end if;

  update public.profiles
     set password_change_required = false,
         password_changed_at = now()
   where id = p_user_id;

  perform public.emit_domain_event(
    'account.initial_password_changed',
    'profile',
    p_user_id,
    jsonb_build_object('completed', true),
    p_user_id,
    null
  );
  return false;
end
$$;

create or replace function public.list_staff_password_reset_targets(p_user_ids uuid[])
returns uuid[]
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(request_row.target_user_id), '{}'::uuid[])
    from public.staff_password_reset_requests request_row
    join public.profiles target_profile on target_profile.id = request_row.target_user_id
   where request_row.target_user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
     and request_row.status in ('prepared', 'awaiting_change')
     and target_profile.password_change_required
$$;

revoke all on function public.prepare_staff_password_reset(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.rollback_staff_password_reset(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_staff_password_reset(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.validate_staff_password_change(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_staff_password_change(uuid, text) from public, anon, authenticated;
revoke all on function public.list_staff_password_reset_targets(uuid[]) from public, anon, authenticated;
revoke all on function public.prevent_initial_password_reissue_during_staff_reset() from public, anon, authenticated, service_role;
grant execute on function public.prepare_staff_password_reset(uuid, uuid, text) to service_role;
grant execute on function public.rollback_staff_password_reset(uuid, uuid, text) to service_role;
grant execute on function public.complete_staff_password_reset(uuid, uuid, text) to service_role;
grant execute on function public.validate_staff_password_change(uuid, text) to service_role;
grant execute on function public.complete_staff_password_change(uuid, text) to service_role;
grant execute on function public.list_staff_password_reset_targets(uuid[]) to service_role;
