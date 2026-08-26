-- B3: immutable-package H5 input capability authority.
-- Raw third-party HTML declarations are stripped at delivery time. Only an
-- active, versioned registry row may opt a package into the classroom bridge.

begin;

create table public.cw_h5_input_profiles (
  id uuid primary key default gen_random_uuid(),
  package_sha256 text not null references public.cw_asset_objects(sha256) on delete restrict,
  profile_revision integer not null check (profile_revision > 0),
  profile_schema text not null check (profile_schema = 'mathin-classroom-h5-input-profile-v1'),
  provider_schema text not null check (provider_schema = 'mathin-classroom-input'),
  provider_version smallint not null check (provider_version = 1),
  default_capability text not null check (default_capability in ('click', 'drag', 'native', 'ink', 'unknown')),
  engine_family text not null check (length(trim(engine_family)) between 1 and 80),
  audit_method text not null check (length(trim(audit_method)) between 1 and 160),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  registered_export_id text not null check (length(trim(registered_export_id)) between 1 and 160),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (package_sha256, profile_revision),
  constraint cw_h5_input_profiles_revocation_complete check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create unique index cw_h5_input_profiles_one_active_idx
  on public.cw_h5_input_profiles(package_sha256)
  where status = 'active';

alter table public.cw_h5_input_profiles enable row level security;

-- Profiles contain no lesson content or identity data. The public H5 delivery
-- route needs only active rows; all writes remain migration/import-service only.
create policy cw_h5_input_profiles_select_active
on public.cw_h5_input_profiles
for select to anon, authenticated
using (status = 'active');

revoke all on public.cw_h5_input_profiles from anon, authenticated;
grant select (
  package_sha256,
  profile_schema,
  provider_schema,
  provider_version,
  default_capability,
  status
) on public.cw_h5_input_profiles to anon, authenticated;

notify pgrst, 'reload schema';

commit;
