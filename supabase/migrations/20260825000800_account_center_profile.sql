-- POST-LIVE-AUTH-01 phase 1: provider-independent account profile settings.
-- Login identities remain authoritative in auth.users/auth.identities.

alter table public.profiles
  add column if not exists preferred_locale text not null default 'zh';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_preferred_locale_check'
  ) then
    alter table public.profiles
      add constraint profiles_preferred_locale_check
      check (preferred_locale in ('zh', 'en'));
  end if;
end
$$;

insert into public.file_policies(
  bucket_id, purpose, access_mode, upload_protocol, max_bytes,
  owner_quota_bytes, allowed_mime_types, orphan_grace_hours,
  retention_days, malicious_content_policy
) values (
  'profile-avatars', 'Public account avatars normalized to metadata-free WebP.',
  'public', 'standard', 5242880, 20971520, array['image/webp'],
  24, null, 'signature_only'
) on conflict(bucket_id) do update set
  purpose = excluded.purpose,
  access_mode = excluded.access_mode,
  upload_protocol = excluded.upload_protocol,
  max_bytes = excluded.max_bytes,
  owner_quota_bytes = excluded.owner_quota_bytes,
  allowed_mime_types = excluded.allowed_mime_types,
  orphan_grace_hours = excluded.orphan_grace_hours,
  retention_days = excluded.retention_days,
  malicious_content_policy = excluded.malicious_content_policy,
  enabled = true,
  updated_at = now();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 5242880, array['image/webp'])
on conflict(id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_avatars_select_public on storage.objects;
drop policy if exists profile_avatars_insert_own on storage.objects;
drop policy if exists profile_avatars_delete_own on storage.objects;

create policy profile_avatars_select_public on storage.objects
  for select using (bucket_id = 'profile-avatars');

create policy profile_avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and cardinality(storage.foldername(name)) = 1
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) = 'webp'
  );

create policy profile_avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Profile avatars are linked files as soon as Storage accepts them. Without
-- this branch the existing orphan worker would remove a live avatar after its
-- grace period because the bucket participates in file governance.
create or replace function public.capture_managed_storage_object()
returns trigger language plpgsql security definer set search_path = public, storage, pg_temp
as $$
declare policy_row public.file_policies%rowtype; size_value bigint; mime_value text;
  entity_type text; entity_id uuid; linked_time timestamptz;
begin
  select * into policy_row from public.file_policies where bucket_id = new.bucket_id and enabled;
  if policy_row.bucket_id is null or policy_row.upload_protocol = 'service' then return new; end if;
  size_value := case when coalesce(new.metadata ->> 'size', '') ~ '^[0-9]+$' then (new.metadata ->> 'size')::bigint else 0 end;
  mime_value := coalesce(new.metadata ->> 'mimetype', new.metadata ->> 'contentType');
  if new.bucket_id = 'note-assets' and cardinality(storage.foldername(new.name)) >= 2
    and (storage.foldername(new.name))[2] ~ '^[0-9a-f-]{36}$'
    and exists(select 1 from public.notes where id = (storage.foldername(new.name))[2]::uuid) then
    entity_type := 'note'; entity_id := (storage.foldername(new.name))[2]::uuid; linked_time := now();
  elsif new.bucket_id = 'profile-avatars' and cardinality(storage.foldername(new.name)) = 1
    and (storage.foldername(new.name))[1] ~ '^[0-9a-f-]{36}$'
    and exists(select 1 from public.profiles where id = (storage.foldername(new.name))[1]::uuid) then
    entity_type := 'profile_avatar'; entity_id := (storage.foldername(new.name))[1]::uuid; linked_time := now();
  elsif new.bucket_id = 'courseware' and cardinality(storage.foldername(new.name)) >= 1
    and (storage.foldername(new.name))[1] ~ '^[0-9a-f-]{36}$' then
    entity_type := 'classroom'; entity_id := (storage.foldername(new.name))[1]::uuid; linked_time := now();
  elsif new.bucket_id = 'course-assets' and cardinality(storage.foldername(new.name)) >= 1
    and (storage.foldername(new.name))[1] ~ '^[0-9a-f-]{36}$' then
    entity_type := 'course'; entity_id := (storage.foldername(new.name))[1]::uuid; linked_time := now();
  end if;
  insert into public.managed_files(bucket_id, object_path, owner_id, byte_count, mime_type,
    linked_entity_type, linked_entity_id, linked_at, orphan_after, retention_until)
  values(new.bucket_id, new.name,
    case when coalesce(new.owner_id, '') ~ '^[0-9a-f-]{36}$' then new.owner_id::uuid else null end,
    size_value, mime_value,
    entity_type, entity_id, linked_time,
    now() + make_interval(hours => policy_row.orphan_grace_hours),
    case when policy_row.retention_days is null then null else now() + make_interval(days => policy_row.retention_days) end)
  on conflict(bucket_id, object_path) do update set owner_id = excluded.owner_id,
    byte_count = excluded.byte_count, mime_type = excluded.mime_type,
    linked_entity_type = coalesce(public.managed_files.linked_entity_type, excluded.linked_entity_type),
    linked_entity_id = coalesce(public.managed_files.linked_entity_id, excluded.linked_entity_id),
    linked_at = coalesce(public.managed_files.linked_at, excluded.linked_at),
    status = 'uploaded', deleted_at = null, last_error = null;
  return new;
end
$$;

comment on column public.profiles.preferred_locale is
  'Preferred Mathin interface locale; business profile fields remain outside the account profile.';
