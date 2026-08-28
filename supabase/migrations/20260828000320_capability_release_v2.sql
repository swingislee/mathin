-- DEV-ORG-1: organization-only capability release surface.
--
-- Campus-scoped feature flags remain in the compatibility table for one
-- rollback window, but current V2 reads and writes use only organization rows.
-- The legacy RPCs remain callable by the previous application version.

begin;

do $$
begin
  if exists (
    select 1 from public.feature_flag_versions
     where campus_id is not null
       and effective_from <= now()
       and (effective_until is null or effective_until > now())
  ) then
    raise exception 'ACTIVE_CAMPUS_FLAG_OVERRIDE_REQUIRES_MAPPING';
  end if;
end
$$;

create or replace function public.list_capability_release_v2()
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); organization_id_value uuid;
begin
  if uid is null or not (
    public.has_perm(uid, 'audit.view')
    or public.has_perm(uid, 'system.operations.manage')
  ) then raise exception 'FORBIDDEN'; end if;

  select id into organization_id_value from public.organizations where singleton_key = 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'flagKey', capability.flag_key_value,
      'enabled', case when capability.flag_key_value = 'finance.enabled'
        then false else coalesce(effective_row.enabled, false) end,
      'effectiveVersionId', effective_row.id,
      'financeReleaseLocked', capability.flag_key_value = 'finance.enabled',
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', version_row.id,
          'version', version_row.version,
          'enabled', version_row.enabled,
          'effectiveFrom', version_row.effective_from,
          'effectiveUntil', version_row.effective_until,
          'reason', version_row.reason,
          'createdAt', version_row.created_at,
          'createdBy', coalesce(profile_row.display_name, ''),
          'isEffective', version_row.effective_from <= now()
            and (version_row.effective_until is null or version_row.effective_until > now())
        ) order by version_row.version desc)
          from public.feature_flag_versions version_row
          left join public.profiles profile_row on profile_row.id = version_row.created_by
         where version_row.organization_id = organization_id_value
           and version_row.campus_id is null
           and version_row.flag_key = capability.flag_key_value
      ), '[]'::jsonb)
    ) order by capability.flag_key_value)
      from unnest(public.organization_feature_keys()) capability(flag_key_value)
      left join lateral (
        select version_row.id, version_row.enabled
          from public.feature_flag_versions version_row
         where version_row.organization_id = organization_id_value
           and version_row.campus_id is null
           and version_row.flag_key = capability.flag_key_value
           and version_row.effective_from <= now()
           and (version_row.effective_until is null or version_row.effective_until > now())
         order by version_row.effective_from desc, version_row.version desc
         limit 1
      ) effective_row on true
  ), '[]'::jsonb);
end
$$;

create or replace function public.set_feature_flag_v2(
  p_flag_key text,
  p_enabled boolean,
  p_effective_from timestamptz,
  p_reason text
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  organization_id_value uuid;
  previous_row public.feature_flag_versions;
  next_effective_from timestamptz;
  next_version integer;
  new_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'system.operations.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if p_flag_key = 'finance.enabled' then raise exception 'FINANCE_RELEASE_CLOSED'; end if;
  if not (p_flag_key = any(public.organization_feature_keys()))
     or p_enabled is null
     or p_effective_from is null
     or p_effective_from < now() - interval '5 minutes'
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 200 then
    raise exception 'INVALID_FEATURE_FLAG';
  end if;

  select id into organization_id_value from public.organizations where singleton_key = 1;
  perform pg_advisory_xact_lock(hashtext('feature-flag-v2:' || p_flag_key));

  select * into previous_row
    from public.feature_flag_versions version_row
   where version_row.organization_id = organization_id_value
     and version_row.campus_id is null
     and version_row.flag_key = p_flag_key
     and version_row.effective_from <= p_effective_from
     and (version_row.effective_until is null or version_row.effective_until > p_effective_from)
   order by version_row.effective_from desc, version_row.version desc
   limit 1;

  select coalesce(max(version_row.version), 0) + 1 into next_version
    from public.feature_flag_versions version_row
   where version_row.organization_id = organization_id_value
     and version_row.campus_id is null
     and version_row.flag_key = p_flag_key;

  if previous_row.id is not null and previous_row.effective_from <= p_effective_from then
    update public.feature_flag_versions
       set effective_until = p_effective_from
     where id = previous_row.id;
  end if;

  select min(version_row.effective_from) into next_effective_from
    from public.feature_flag_versions version_row
   where version_row.organization_id = organization_id_value
     and version_row.campus_id is null
     and version_row.flag_key = p_flag_key
     and version_row.effective_from > p_effective_from;

  insert into public.feature_flag_versions(
    organization_id, campus_id, flag_key, version, enabled,
    effective_from, effective_until, supersedes_id, reason, created_by
  ) values (
    organization_id_value, null, p_flag_key, next_version, p_enabled,
    p_effective_from, next_effective_from, previous_row.id, btrim(p_reason), uid
  ) returning id into new_id;

  perform public.emit_domain_event(
    'feature_flag.versioned', 'feature_flag', new_id,
    jsonb_build_object(
      'flagKey', p_flag_key,
      'scope', 'organization',
      'version', next_version,
      'effectiveFrom', p_effective_from,
      'oldValue', previous_row.enabled,
      'newValue', p_enabled,
      'reason', btrim(p_reason)
    ), null, null
  );
  return new_id;
end
$$;

create or replace function public.rollback_feature_flag_v2(
  p_version_id uuid,
  p_effective_from timestamptz,
  p_reason text
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.feature_flag_versions;
begin
  if uid is null or not public.has_perm(uid, 'system.operations.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select * into target
    from public.feature_flag_versions version_row
   where version_row.id = p_version_id
     and version_row.organization_id = (select id from public.organizations where singleton_key = 1)
     and version_row.campus_id is null;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  return public.set_feature_flag_v2(target.flag_key, target.enabled, p_effective_from, p_reason);
end
$$;

revoke all on function public.list_capability_release_v2() from public, anon, authenticated;
revoke all on function public.set_feature_flag_v2(text, boolean, timestamptz, text) from public, anon, authenticated;
revoke all on function public.rollback_feature_flag_v2(uuid, timestamptz, text) from public, anon, authenticated;

grant execute on function public.list_capability_release_v2() to authenticated;
grant execute on function public.set_feature_flag_v2(text, boolean, timestamptz, text) to authenticated;
grant execute on function public.rollback_feature_flag_v2(uuid, timestamptz, text) to authenticated;

comment on function public.list_capability_release_v2() is
  'Organization-only capability state/history DTO; audit viewers can read and no campus fields are exposed';
comment on function public.set_feature_flag_v2(text, boolean, timestamptz, text) is
  'Version an organization capability; only system.operations.manage may write and finance is read-only closed';

select pg_notify('pgrst', 'reload schema');

commit;
