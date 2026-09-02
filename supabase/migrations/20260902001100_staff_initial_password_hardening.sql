-- DEV-STAFF-ONBOARD-1 hardening: registration handoff secrets are transient.
--
-- handle_new_user() needs registration_invite_code while the Auth row is being
-- inserted. This later AFTER INSERT trigger runs after on_auth_user_created,
-- then removes the value from Auth metadata in the same transaction. The
-- initial password remains available only in the create action response and in
-- the Auth provider's password hash.

create or replace function public.scrub_auth_registration_invite_secret()
returns trigger
language plpgsql security definer
set search_path = auth, public, pg_temp
as $$
begin
  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'registration_invite_code'
   where id = new.id
     and coalesce(raw_user_meta_data, '{}'::jsonb) ? 'registration_invite_code';
  return new;
end
$$;

drop trigger if exists on_auth_user_invite_secret_scrubbed on auth.users;
create trigger on_auth_user_invite_secret_scrubbed
after insert on auth.users
for each row
when (coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'registration_invite_code')
execute function public.scrub_auth_registration_invite_secret();

revoke all on function public.scrub_auth_registration_invite_secret() from public, anon, authenticated;

-- Remove secrets retained by the earlier registration and staff-claim flows.
-- These values are needed only during INSERT and have no post-registration use.
update auth.users
   set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'registration_invite_code'
 where coalesce(raw_user_meta_data, '{}'::jsonb) ? 'registration_invite_code';
