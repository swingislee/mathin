\set ON_ERROR_STOP on
-- R1-1：在一次性 CI 库验证默认值、版本/回滚、权限、RLS 与 fail-closed。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
\if :{?admin_id}
\else
  \echo R1 fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo R1 fixtures missing: 测试-教师
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}';
begin
  if (select count(*) from public.organizations) <> 1 then failures := array_append(failures, 'organization singleton missing'); end if;
  if (select count(*) from public.campuses where is_default and status = 'active') <> 1 then failures := array_append(failures, 'default campus missing'); end if;
  if exists(select 1 from public.school_terms where campus_id is null) then failures := array_append(failures, 'term campus backfill missing'); end if;
  -- 只校验 6 个默认版本存在。原断言数的是全部行数，任何一次合法的「创建未来生效版本」
  -- 都会把它打红（人工验收 §9.1 ORG-06 即触发）；与下方 flag 断言一样按 version = 1 收敛。
  if (select count(*) from public.organization_rule_versions where campus_id is null and version = 1) <> 6 then failures := array_append(failures, 'rule defaults incomplete'); end if;
  -- BUG-R1M-022：任一时点最多一个版本生效，区间链不得出现重叠开口。
  if exists(
    select 1 from public.organization_rule_versions a
      join public.organization_rule_versions b
        on b.organization_id = a.organization_id
       and b.campus_id is not distinct from a.campus_id
       and b.domain = a.domain and b.id <> a.id
     where a.effective_until is null and b.effective_until is null
  ) then failures := array_append(failures, 'rule interval chain has multiple open versions'); end if;
  if exists(
    select 1 from public.feature_flag_versions a
      join public.feature_flag_versions b
        on b.organization_id = a.organization_id
       and b.campus_id is not distinct from a.campus_id
       and b.flag_key = a.flag_key and b.id <> a.id
     where a.effective_until is null and b.effective_until is null
  ) then failures := array_append(failures, 'flag interval chain has multiple open versions'); end if;
  if (
    select count(*)
    from public.feature_flag_versions
    where campus_id is null
      and version = 1
      and not enabled
      and flag_key in (
        'finance.enabled',
        'notifications.email',
        'notifications.sms',
        'notifications.wechat',
        'public_content.publish'
      )
  ) <> 5 then failures := array_append(failures, 'flag defaults incomplete'); end if;
  if has_table_privilege('authenticated', 'public.organizations', 'SELECT') then failures := array_append(failures, 'organizations direct SELECT granted'); end if;
  if has_table_privilege('authenticated', 'public.organization_rule_versions', 'INSERT') then failures := array_append(failures, 'rule direct INSERT granted'); end if;
  if has_table_privilege('authenticated', 'public.feature_flag_versions', 'UPDATE') then failures := array_append(failures, 'flag direct UPDATE granted'); end if;
  if not exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'organizations' and policyname = 'organizations_rpc_only') then failures := array_append(failures, 'organization deny policy missing'); end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.organization_rule_versions'::regclass and tgname = 'organization_rule_versions_immutable' and not tgisinternal) then failures := array_append(failures, 'rule immutable trigger missing'); end if;
  if cardinality(failures) > 0 then raise exception 'R1-1 structure assertions failed: %', array_to_string(failures, ', '); end if;
end
$$;

set local role anon;
select (not public.is_feature_enabled('unknown.capability') and not public.is_feature_enabled('finance.enabled')) as r1_anon_fail_closed \gset
\if :r1_anon_fail_closed
\else
  \echo R1-1 fail-closed assertion failed for anon
  select 1 / 0;
\endif
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
do $$
begin
  begin
    perform public.get_organization_settings();
    raise exception 'R1_NON_MANAGER_SETTINGS_READ_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.set_feature_flag('finance.enabled', null, true, now(), 'forbidden test');
    raise exception 'R1_NON_MANAGER_FLAG_WRITE_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claim.sub', :'admin_id', true);
select (
  public.has_perm(auth.uid(), 'organization.settings.manage')
  and not public.has_perm(auth.uid(), 'finance.order.view')
  and jsonb_array_length(public.get_organization_settings() -> 'campuses') >= 1
) as r1_admin_defaults_ok \gset
\if :r1_admin_defaults_ok
\else
  \echo R1-1 admin/default settings assertion failed
  select 1 / 0;
\endif
-- 后续断言以数据库所有者检查不可直接授权的内部历史表；JWT claim 继续保留 admin。
reset role;

insert into public.notes(owner_id, title, document)
values (:'admin_id'::uuid, 'R1 public publish guard', '[]'::jsonb)
returning id as publish_note_id \gset
select id as public_publish_off_id from public.feature_flag_versions
 where flag_key = 'public_content.publish' and campus_id is null order by version desc limit 1 \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('r1.organization_publish_note_id', :'publish_note_id', true);
do $$
begin
  begin
    insert into public.posts(note_id, author_id, title, content, content_html, excerpt)
    select id, auth.uid(), 'R1 blocked publish', '[]'::jsonb, '<p>blocked</p>', 'blocked'
      from public.notes where owner_id = auth.uid() and title = 'R1 public publish guard';
    raise exception 'R1_PUBLIC_PUBLISH_WAS_ACCEPTED_WHILE_DISABLED';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.submit_notebook_post_revision(
      current_setting('r1.organization_publish_note_id')::uuid,
      'R1 blocked publish', '[]'::jsonb, '<p>blocked</p>', 'blocked'
    );
    raise exception 'R1_PUBLIC_PUBLISH_RPC_WAS_ACCEPTED_WHILE_DISABLED';
  exception when others then
    if sqlerrm not like '%PUBLIC_PUBLISHING_DISABLED%' then raise; end if;
  end;
end
$$;
reset role;

select public.set_feature_flag('public_content.publish', null, true, now(), 'CI enable public publishing') as public_publish_on_id \gset
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select (public.submit_notebook_post_revision(
  :'publish_note_id'::uuid,
  'R1 enabled publish',
  '[]'::jsonb,
  '<p>enabled</p>',
  'enabled'
) ->> 'postId') as publish_post_id \gset
select public.review_notebook_post_revision(:'publish_post_id'::uuid, 'approved', 'R1 publish guard approval');
reset role;

select public.rollback_feature_flag(:'public_publish_off_id'::uuid, now(), 'CI rollback public publishing') as public_publish_rollback_id \gset
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('r1.organization_publish_post_id', :'publish_post_id', true);
do $$
begin
  begin
    update public.posts set title = 'R1 blocked update' where author_id = auth.uid() and title = 'R1 enabled publish';
    raise exception 'R1_PUBLIC_UPDATE_WAS_ACCEPTED_WHILE_DISABLED';
  exception when insufficient_privilege then
    null;
  end;
  perform public.withdraw_notebook_post(
    current_setting('r1.organization_publish_post_id')::uuid,
    'R1 flag-off withdrawal'
  );
  if not exists (
    select 1 from public.posts
     where id = current_setting('r1.organization_publish_post_id')::uuid
       and author_id = auth.uid()
       and lifecycle_status = 'withdrawn'
       and hidden
  ) then raise exception 'R1_PUBLIC_WITHDRAWAL_WAS_BLOCKED'; end if;
end
$$;
reset role;


-- 断言写成相对事实：取「当前生效」的版本而不是 max(version)，并用它自己的版本号和值
-- 作为基线。原写法硬编码 version = 2/3 与 teachingWeekStartsOn = '1'，只能在一次性 CI
-- 夹具库成立；开发库上任何一次合法的规则变更都会把它打红（人工验收 §9.1 即触发）。
select id as old_calendar_id, version as old_calendar_version, value ->> 'teachingWeekStartsOn' as old_calendar_start
  from public.organization_rule_versions
 where domain = 'calendar' and campus_id is null
   and effective_from <= now() and (effective_until is null or effective_until > now())
 order by effective_from desc, version desc limit 1 \gset
select coalesce(max(version), 0) as calendar_version_before
  from public.organization_rule_versions where domain = 'calendar' and campus_id is null \gset
select public.set_organization_rule(
  'calendar', null, '{"teachingWeekStartsOn":2,"weekendDays":[0,6]}'::jsonb,
  now(), 'CI change calendar start'
) as new_calendar_id \gset
select (
  (select version = :calendar_version_before + 1 and value ->> 'teachingWeekStartsOn' = '2'
       and supersedes_id = :'old_calendar_id'::uuid
     from public.organization_rule_versions where id = :'new_calendar_id'::uuid)
  and (select payload -> 'oldValue' ->> 'teachingWeekStartsOn' = :'old_calendar_start'
         and payload -> 'newValue' ->> 'teachingWeekStartsOn' = '2'
       from public.domain_events where entity_id = :'new_calendar_id'::uuid and event_type = 'organization_rule.versioned')
  -- BUG-R1M-022：新版本必须把上一版本收口，任一时点只剩一条开口区间。
  and (select effective_until is not null from public.organization_rule_versions where id = :'old_calendar_id'::uuid)
  and (select count(*) = 1 from public.organization_rule_versions
        where domain = 'calendar' and campus_id is null and effective_until is null)
) as r1_rule_version_ok \gset
\if :r1_rule_version_ok
\else
  \echo R1-1 rule version/audit assertion failed
  select 1 / 0;
\endif

select public.rollback_organization_rule(:'old_calendar_id'::uuid, now(), 'CI rollback calendar') as rollback_calendar_id \gset
select (
  (select version = :calendar_version_before + 2 and value ->> 'teachingWeekStartsOn' = :'old_calendar_start'
     from public.organization_rule_versions where id = :'rollback_calendar_id'::uuid)
  and public.get_effective_organization_rule('calendar') ->> 'teachingWeekStartsOn' = :'old_calendar_start'
  and (select count(*) = 1 from public.organization_rule_versions
        where domain = 'calendar' and campus_id is null and effective_until is null)
) as r1_rule_rollback_ok \gset
\if :r1_rule_rollback_ok
\else
  \echo R1-1 rule rollback assertion failed
  select 1 / 0;
\endif

do $$
begin
  begin
    perform public.set_feature_flag('finance.enabled', null, true, now(), 'CI forbidden finance enable');
    raise exception 'R1_FINANCE_ENABLE_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if;
  end;
  if public.is_feature_enabled('finance.enabled')
     or public.has_perm(auth.uid(), 'finance.order.view') then
    raise exception 'R1_FINANCE_RELEASE_GATE_FAILED';
  end if;
end
$$;
select public.create_campus('ci-campus', 'CI Campus', 'Asia/Shanghai') as ci_campus_id \gset
select public.create_campus_room(:'ci_campus_id'::uuid, 'R101', 'Room 101', 30) as ci_room_id \gset
select public.create_school_holiday(:'ci_campus_id'::uuid, 'CI Holiday', 'closed', current_date, current_date) as ci_holiday_id \gset
select (
  (select organization_id = (select id from public.organizations) from public.campuses where id = :'ci_campus_id'::uuid)
  and (select campus_id = :'ci_campus_id'::uuid and is_active from public.campus_rooms where id = :'ci_room_id'::uuid)
  and (select campus_id = :'ci_campus_id'::uuid and archived_at is null from public.school_holidays where id = :'ci_holiday_id'::uuid)
) as r1_campus_objects_ok \gset
\if :r1_campus_objects_ok
\else
  \echo R1-1 campus/room/holiday assertion failed
  select 1 / 0;
\endif

rollback;
\echo R1-1 organization settings assertions passed
