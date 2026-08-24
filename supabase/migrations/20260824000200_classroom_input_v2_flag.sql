begin;

create or replace function public.organization_feature_keys()
returns text[] language sql immutable
as $$
  select array[
    'finance.enabled',
    'notifications.email',
    'notifications.sms',
    'notifications.wechat',
    'public_content.publish',
    'teaching.preparation_archive_edit',
    'teaching.classroom_board_checkpoint_v2',
    'teaching.classroom_input_v2'
  ]::text[]
$$;

insert into public.feature_flag_versions(
  organization_id, flag_key, version, enabled, effective_from, reason
)
select organization_row.id, 'teaching.classroom_input_v2', 1, false, now(),
       'M3a fail-closed default'
  from public.organizations organization_row
 where organization_row.singleton_key = 1
on conflict do nothing;

commit;
