-- R1 teacher trial: keep the frozen snapshot as the classroom authority while
-- allowing an assigned teacher to opt into the existing session-only amendment
-- path from the courseware title bar. This does not grant research staff any
-- preparation or annotation write capability.

begin;

with target as (
  select organization_row.id as organization_id,
         current_row.id as supersedes_id,
         coalesce(history_row.max_version, 0) + 1 as next_version,
         current_row.enabled as currently_enabled
    from public.organizations organization_row
    left join lateral (
      select max(version_row.version) as max_version
        from public.feature_flag_versions version_row
       where version_row.organization_id = organization_row.id
         and version_row.campus_id is null
         and version_row.flag_key = 'teaching.preparation_archive_edit'
    ) history_row on true
    left join lateral (
      select version_row.id, version_row.enabled
        from public.feature_flag_versions version_row
       where version_row.organization_id = organization_row.id
         and version_row.campus_id is null
         and version_row.flag_key = 'teaching.preparation_archive_edit'
         and version_row.effective_from <= now()
         and (version_row.effective_until is null or version_row.effective_until > now())
       order by version_row.effective_from desc, version_row.version desc
       limit 1
    ) current_row on true
   where organization_row.singleton_key = 1
)
insert into public.feature_flag_versions(
  organization_id,
  campus_id,
  flag_key,
  version,
  enabled,
  effective_from,
  supersedes_id,
  reason
)
select target.organization_id,
       null,
       'teaching.preparation_archive_edit',
       target.next_version,
       true,
       now(),
       target.supersedes_id,
       'R1 teacher trial: title-bar unlock for frozen session courseware'
  from target
 where target.currently_enabled is distinct from true;

notify pgrst, 'reload schema';

commit;
