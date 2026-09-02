-- DEV-STAFF-ONBOARD-1: reissue a lost initial password without turning the
-- onboarding control into a general staff password-reset surface.

create table public.staff_initial_password_reissues (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  invitation_id uuid not null references public.staff_invitations(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'prepared'
    check (status in ('prepared','completed','rolled_back','expired')),
  previous_code_hash text,
  next_code_hash text,
  previous_initial_password_set_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  completed_at timestamptz,
  constraint staff_initial_password_reissues_state_check check (
    (
      status = 'prepared'
      and previous_code_hash ~ '^[a-f0-9]{32}$'
      and next_code_hash ~ '^[a-f0-9]{32}$'
      and previous_initial_password_set_at is not null
      and completed_at is null
    )
    or
    (
      status <> 'prepared'
      and previous_code_hash is null
      and next_code_hash is null
      and previous_initial_password_set_at is null
      and completed_at is not null
    )
  )
);

create unique index staff_initial_password_reissues_one_active_target_idx
  on public.staff_initial_password_reissues(target_user_id)
  where status = 'prepared';

create index staff_initial_password_reissues_actor_created_idx
  on public.staff_initial_password_reissues(requested_by, created_at desc);

alter table public.staff_initial_password_reissues enable row level security;
revoke all on public.staff_initial_password_reissues from public, anon, authenticated;

create or replace function public.prepare_staff_initial_password_reissue(
  p_actor_id uuid,
  p_user_id uuid,
  p_code_hash text
) returns table(reissue_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile public.profiles%rowtype;
  target_profile public.profiles%rowtype;
  invitation_row public.staff_invitations%rowtype;
  new_reissue_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{32}$' then
    raise exception 'INVALID_INITIAL_PASSWORD_HASH';
  end if;

  select * into actor_profile from public.profiles where id = p_actor_id;
  if actor_profile.id is null
     or actor_profile.role not in ('staff','admin')
     or not actor_profile.is_active
     or actor_profile.account_status <> 'active'
     or actor_profile.password_change_required
     or not public.has_perm(p_actor_id, 'staff.invite')
  then raise exception 'FORBIDDEN'; end if;

  select * into target_profile
    from public.profiles
   where id = p_user_id
   for update;
  if target_profile.id is null
     or target_profile.role not in ('staff','admin')
     or not target_profile.is_active
     or target_profile.account_status <> 'active'
     or not target_profile.password_change_required
  then raise exception 'INITIAL_PASSWORD_NOT_REQUIRED'; end if;

  update public.staff_initial_password_reissues request_row
     set status = 'expired',
         previous_code_hash = null,
         next_code_hash = null,
         previous_initial_password_set_at = null,
         completed_at = now()
   where request_row.target_user_id = p_user_id
     and request_row.status = 'prepared'
     and request_row.expires_at <= now();

  if exists(
    select 1 from public.staff_initial_password_reissues request_row
     where request_row.target_user_id = p_user_id
       and request_row.status = 'prepared'
  ) then raise exception 'PASSWORD_REISSUE_IN_PROGRESS'; end if;

  select * into invitation_row
    from public.staff_invitations candidate
   where candidate.accepted_by = p_user_id
     and candidate.provisioning_mode = 'direct'
     and candidate.status = 'accepted'
   order by candidate.accepted_at desc nulls last, candidate.created_at desc
   limit 1
   for update;
  if invitation_row.id is null then raise exception 'INITIAL_PASSWORD_RECORD_MISSING'; end if;
  if invitation_row.code_hash = p_code_hash then raise exception 'PASSWORD_REISSUE_FINALIZE_FAILED'; end if;

  insert into public.staff_initial_password_reissues(
    target_user_id,
    invitation_id,
    requested_by,
    previous_code_hash,
    next_code_hash,
    previous_initial_password_set_at
  ) values(
    p_user_id,
    invitation_row.id,
    p_actor_id,
    invitation_row.code_hash,
    p_code_hash,
    target_profile.initial_password_set_at
  ) returning id into new_reissue_id;

  update public.staff_invitations
     set code_hash = p_code_hash
   where id = invitation_row.id;
  update public.profiles
     set initial_password_set_at = now(), password_changed_at = null
   where id = p_user_id;

  perform public.emit_domain_event(
    'account.initial_password_reissue_prepared',
    'profile',
    p_user_id,
    jsonb_build_object('reissueId', new_reissue_id),
    p_actor_id,
    null
  );
  return query select new_reissue_id;
end
$$;

create or replace function public.rollback_staff_initial_password_reissue(
  p_reissue_id uuid,
  p_actor_id uuid,
  p_expected_code_hash text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare request_row public.staff_initial_password_reissues%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into request_row
    from public.staff_initial_password_reissues
   where id = p_reissue_id
   for update;
  if request_row.id is null
     or request_row.status <> 'prepared'
     or request_row.requested_by <> p_actor_id
     or request_row.next_code_hash <> p_expected_code_hash
  then raise exception 'PASSWORD_REISSUE_ROLLBACK_FAILED'; end if;

  update public.staff_invitations
     set code_hash = request_row.previous_code_hash
   where id = request_row.invitation_id
     and code_hash = request_row.next_code_hash;
  if not found then raise exception 'PASSWORD_REISSUE_ROLLBACK_FAILED'; end if;

  update public.profiles
     set initial_password_set_at = request_row.previous_initial_password_set_at
   where id = request_row.target_user_id
     and password_change_required;

  update public.staff_initial_password_reissues
     set status = 'rolled_back',
         previous_code_hash = null,
         next_code_hash = null,
         previous_initial_password_set_at = null,
         completed_at = now()
   where id = request_row.id;

  perform public.emit_domain_event(
    'account.initial_password_reissue_rolled_back',
    'profile',
    request_row.target_user_id,
    jsonb_build_object('reissueId', request_row.id),
    p_actor_id,
    null
  );
end
$$;

create or replace function public.complete_staff_initial_password_reissue(
  p_reissue_id uuid,
  p_actor_id uuid,
  p_expected_code_hash text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare request_row public.staff_initial_password_reissues%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into request_row
    from public.staff_initial_password_reissues
   where id = p_reissue_id
   for update;
  if request_row.id is null
     or request_row.status <> 'prepared'
     or request_row.requested_by <> p_actor_id
     or request_row.next_code_hash <> p_expected_code_hash
     or not exists(
       select 1 from public.profiles target_profile
        where target_profile.id = request_row.target_user_id
          and target_profile.password_change_required
     )
     or not exists(
       select 1 from public.staff_invitations invitation_row
        where invitation_row.id = request_row.invitation_id
          and invitation_row.code_hash = request_row.next_code_hash
     )
  then raise exception 'PASSWORD_REISSUE_FINALIZE_FAILED'; end if;

  update public.staff_initial_password_reissues
     set status = 'completed',
         previous_code_hash = null,
         next_code_hash = null,
         previous_initial_password_set_at = null,
         completed_at = now()
   where id = request_row.id;

  perform public.emit_domain_event(
    'account.initial_password_reissued',
    'profile',
    request_row.target_user_id,
    jsonb_build_object('reissueId', request_row.id),
    p_actor_id,
    null
  );
end
$$;

-- If the Auth password update succeeded but the completion acknowledgement was
-- interrupted, the employee's mandatory first-password change still closes the
-- prepared reservation and removes its temporary comparison hashes.
create or replace function public.complete_initial_password_change(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  update public.profiles
     set password_change_required = false, password_changed_at = now()
   where id = p_user_id and password_change_required;
  if found then
    update public.staff_initial_password_reissues
       set status = 'completed',
           previous_code_hash = null,
           next_code_hash = null,
           previous_initial_password_set_at = null,
           completed_at = now()
     where target_user_id = p_user_id and status = 'prepared';

    perform public.emit_domain_event(
      'account.initial_password_changed', 'profile', p_user_id,
      jsonb_build_object('completed', true), p_user_id, null
    );
  end if;
end
$$;

revoke all on function public.prepare_staff_initial_password_reissue(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.rollback_staff_initial_password_reissue(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_staff_initial_password_reissue(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_initial_password_change(uuid) from public, anon, authenticated;
grant execute on function public.prepare_staff_initial_password_reissue(uuid, uuid, text) to service_role;
grant execute on function public.rollback_staff_initial_password_reissue(uuid, uuid, text) to service_role;
grant execute on function public.complete_staff_initial_password_reissue(uuid, uuid, text) to service_role;
grant execute on function public.complete_initial_password_change(uuid) to service_role;
