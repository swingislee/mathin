-- DEV-ORG-1: retain legacy raw rule versions as audit-only history.

begin;

create or replace function public.list_legacy_organization_rule_history_v2()
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
      'id', version_row.id,
      'domain', version_row.domain,
      'version', version_row.version,
      'value', version_row.value,
      'effectiveFrom', version_row.effective_from,
      'effectiveUntil', version_row.effective_until,
      'reason', version_row.reason,
      'createdAt', version_row.created_at,
      'createdBy', coalesce(profile_row.display_name, ''),
      'legacyCampusName', campus_row.name
    ) order by version_row.domain, version_row.version desc)
      from public.organization_rule_versions version_row
      left join public.profiles profile_row on profile_row.id = version_row.created_by
      left join public.campuses campus_row on campus_row.id = version_row.campus_id
     where version_row.organization_id = organization_id_value
  ), '[]'::jsonb);
end
$$;

revoke all on function public.list_legacy_organization_rule_history_v2()
  from public, anon, authenticated;
grant execute on function public.list_legacy_organization_rule_history_v2()
  to authenticated;

comment on function public.list_legacy_organization_rule_history_v2() is
  'Audit-only legacy raw rule history; there is intentionally no V2 write or rollback RPC';

select pg_notify('pgrst', 'reload schema');

commit;
