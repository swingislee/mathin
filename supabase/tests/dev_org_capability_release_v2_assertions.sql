\set ON_ERROR_STOP on
-- DEV-ORG-1: organization-only capability release permissions and DTO.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset

-- Make the fixed teacher audit-only for this rollback transaction. This proves
-- history read does not accidentally grant either write RPC.
insert into public.role_permissions(role_id, perm_key)
select member_row.role_id, 'audit.view'
  from public.staff_role_members member_row
 where member_row.user_id = :'teacher_id'::uuid
on conflict do nothing;
delete from public.role_permissions permission_row
using public.staff_role_members member_row
where permission_row.role_id = member_row.role_id
  and member_row.user_id = :'teacher_id'::uuid
  and permission_row.perm_key = 'system.operations.manage';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.list_capability_release_v2()::text as audit_dto \gset
select (
  :'audit_dto' not like '%"campusId"%'
  and :'audit_dto' not like '%"code"%'
  and :'audit_dto' like '%"financeReleaseLocked": true%'
) as audit_dto_ok \gset
\if :audit_dto_ok
\else
  \echo DEV-ORG-1 capability audit DTO leaked compatibility scope or omitted finance lock
  select 1 / 0;
\endif
do $$
begin
  begin
    perform public.set_feature_flag_v2(
      'notifications.email', true, now(), 'Audit-only write must fail'
    );
    raise exception 'AUDIT_ONLY_CAPABILITY_WRITE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
do $$
begin
  begin
    perform public.set_feature_flag_v2(
      'finance.enabled', false, now(), 'Finance is read-only in capability release'
    );
    raise exception 'FINANCE_CAPABILITY_WRITE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'FINANCE_RELEASE_CLOSED' then raise; end if;
  end;
end
$$;

select public.set_feature_flag_v2(
  'notifications.email', true, now(), 'Verified organization capability release'
) as version_id \gset
select public.list_capability_release_v2()::text as capability_dto_after_write \gset
reset role;
select (
  exists(select 1 from public.feature_flag_versions
    where id = :'version_id'::uuid and campus_id is null and enabled)
  and exists(select 1 from public.domain_events
    where entity_id = :'version_id'::uuid
      and event_type = 'feature_flag.versioned'
      and payload ->> 'scope' = 'organization')
  and :'capability_dto_after_write' like '%Verified organization capability release%'
) as version_write_ok \gset
\if :version_write_ok
\else
  \echo DEV-ORG-1 capability V2 did not create an organization version/event
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.rollback_feature_flag_v2(
  :'version_id'::uuid, now() + interval '1 minute', 'Verified rollback version'
) as rollback_id \gset
reset role;
select exists(select 1 from public.feature_flag_versions
  where id = :'rollback_id'::uuid and campus_id is null) as rollback_ok \gset
\if :rollback_ok
\else
  \echo DEV-ORG-1 capability rollback did not create an organization version
  select 1 / 0;
\endif

select (
  to_regprocedure('public.set_feature_flag(text,uuid,boolean,timestamptz,text)') is not null
  and to_regprocedure('public.rollback_feature_flag(uuid,timestamptz,text)') is not null
) as legacy_rpc_ok \gset
\if :legacy_rpc_ok
\else
  \echo DEV-ORG-1 legacy feature-flag rollback-window RPCs were removed
  select 1 / 0;
\endif

rollback;
\echo DEV-ORG-1 capability release V2 assertions passed
