-- R1-1 缺口修复（BUG-R1M-022）：规则域与功能开关的版本链会出现多个同时开口的区间。
--
-- 人工验收 §9.1 实测两种触发方式，都不是边缘场景：
--   · 同分钟内连续创建两个版本（`datetime-local` 只有分钟精度）：v3、v4 的
--     `effective_from` 相等，`set_organization_rule` / `set_feature_flag` 的收口条件是严格
--     `previous_row.effective_from < p_effective_from`，v3 不被收口，两行 `effective_until`
--     同为 NULL，UI 两行同显「当前生效」且两行 rollback 均被禁用。
--   · 回滚到比某个未来生效版本更早的时点：calendar v2 生效于 2029-12-31、v3 生效于
--     2026-08-03，两者都开口；以 2030-06-01 为时点查询会同时命中 2 条。
--
-- 修复三部分：
--   1. 收口条件改为 `<=`，并允许 `effective_until = effective_from` 表示「尚未生效即被取代」
--      的空窗口（原约束是严格 `>`，无法表达该状态）。
--   2. 新版本插入时，若已存在更晚生效的版本，把新行收口到最早的那个未来生效时刻，
--      使回滚不会盖过已排期的未来版本。
--   3. 回填历史数据：把每条版本的 `effective_until` 重算为「严格更晚的下一版本的
--      effective_from」。`effective_until` 是本表唯一可变边界，append-only 语义不变。
--
-- 运行期取值不受影响：解析器一直用 `order by effective_from desc, version desc limit 1`，
-- 回填只是让区间链与解析结果一致，从而让审计可读、rollback 控件可用。

begin;

alter table public.organization_rule_versions
  drop constraint organization_rule_effective_range,
  add constraint organization_rule_effective_range
    check (effective_until is null or effective_until >= effective_from);

alter table public.feature_flag_versions
  drop constraint feature_flag_effective_range,
  add constraint feature_flag_effective_range
    check (effective_until is null or effective_until >= effective_from);

-- ---------------------------------------------------------------------------
-- 1. 回填历史区间链
-- ---------------------------------------------------------------------------

with recomputed as (
  select
    current_row.id,
    (
      select min(later_row.effective_from)
        from public.organization_rule_versions later_row
       where later_row.organization_id = current_row.organization_id
         and later_row.campus_id is not distinct from current_row.campus_id
         and later_row.domain = current_row.domain
         and (later_row.effective_from > current_row.effective_from
              or (later_row.effective_from = current_row.effective_from and later_row.version > current_row.version))
    ) as next_effective_from
  from public.organization_rule_versions current_row
)
update public.organization_rule_versions target
   set effective_until = recomputed.next_effective_from
  from recomputed
 where target.id = recomputed.id
   and target.effective_until is distinct from recomputed.next_effective_from;

with recomputed as (
  select
    current_row.id,
    (
      select min(later_row.effective_from)
        from public.feature_flag_versions later_row
       where later_row.organization_id = current_row.organization_id
         and later_row.campus_id is not distinct from current_row.campus_id
         and later_row.flag_key = current_row.flag_key
         and (later_row.effective_from > current_row.effective_from
              or (later_row.effective_from = current_row.effective_from and later_row.version > current_row.version))
    ) as next_effective_from
  from public.feature_flag_versions current_row
)
update public.feature_flag_versions target
   set effective_until = recomputed.next_effective_from
  from recomputed
 where target.id = recomputed.id
   and target.effective_until is distinct from recomputed.next_effective_from;

-- ---------------------------------------------------------------------------
-- 2. 写入路径：双向收口
-- ---------------------------------------------------------------------------

create or replace function public.set_organization_rule(
  p_domain text, p_campus_id uuid, p_value jsonb, p_effective_from timestamptz, p_reason text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := public.assert_organization_manager();
  organization_uuid uuid;
  previous_row public.organization_rule_versions;
  next_effective_from timestamptz;
  next_version integer;
  new_id uuid;
begin
  if not public.validate_organization_rule(p_domain, p_value)
     or p_effective_from < now() - interval '5 minutes'
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 200 then raise exception 'INVALID_RULE'; end if;
  if p_campus_id is not null and not exists(select 1 from public.campuses where id = p_campus_id) then raise exception 'INVALID_CAMPUS'; end if;
  select id into organization_uuid from public.organizations where singleton_key = 1;
  perform pg_advisory_xact_lock(hashtext('organization-rule:' || p_domain || ':' || coalesce(p_campus_id::text, 'global')));
  select * into previous_row from public.organization_rule_versions
   where organization_id = organization_uuid and campus_id is not distinct from p_campus_id
     and domain = p_domain and effective_from <= p_effective_from
     and (effective_until is null or effective_until > p_effective_from)
   order by effective_from desc, version desc limit 1;
  select coalesce(max(version), 0) + 1 into next_version from public.organization_rule_versions
   where organization_id = organization_uuid and campus_id is not distinct from p_campus_id and domain = p_domain;
  -- `<=`：同一时刻的旧版本也要收口，空窗口表示「尚未生效即被取代」。
  if previous_row.id is not null and previous_row.effective_from <= p_effective_from then
    update public.organization_rule_versions set effective_until = p_effective_from where id = previous_row.id;
  end if;
  -- 已排期的未来版本仍然接管：新行收口到最早的那个未来生效时刻。
  select min(later_row.effective_from) into next_effective_from
    from public.organization_rule_versions later_row
   where later_row.organization_id = organization_uuid
     and later_row.campus_id is not distinct from p_campus_id
     and later_row.domain = p_domain
     and later_row.effective_from > p_effective_from;
  insert into public.organization_rule_versions(organization_id, campus_id, domain, version, value, effective_from, effective_until, supersedes_id, reason, created_by)
  values(organization_uuid, p_campus_id, p_domain, next_version, p_value, p_effective_from, next_effective_from, previous_row.id, btrim(p_reason), uid)
  returning id into new_id;
  perform public.emit_domain_event('organization_rule.versioned', 'organization_rule', new_id,
    jsonb_build_object('domain', p_domain, 'campusId', p_campus_id, 'version', next_version, 'effectiveFrom', p_effective_from,
      'oldValue', previous_row.value, 'newValue', p_value, 'reason', btrim(p_reason)), null, null);
  return new_id;
end
$$;

create or replace function public.set_feature_flag(
  p_flag_key text, p_campus_id uuid, p_enabled boolean, p_effective_from timestamptz, p_reason text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := public.assert_organization_manager();
  organization_uuid uuid;
  previous_row public.feature_flag_versions;
  next_effective_from timestamptz;
  next_version integer;
  new_id uuid;
begin
  if not (p_flag_key = any(public.organization_feature_keys()))
     or p_effective_from < now() - interval '5 minutes'
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 200 then raise exception 'INVALID_FEATURE_FLAG'; end if;
  if p_campus_id is not null and not exists(select 1 from public.campuses where id = p_campus_id) then raise exception 'INVALID_CAMPUS'; end if;
  select id into organization_uuid from public.organizations where singleton_key = 1;
  perform pg_advisory_xact_lock(hashtext('feature-flag:' || p_flag_key || ':' || coalesce(p_campus_id::text, 'global')));
  select * into previous_row from public.feature_flag_versions
   where organization_id = organization_uuid and campus_id is not distinct from p_campus_id
     and flag_key = p_flag_key and effective_from <= p_effective_from
     and (effective_until is null or effective_until > p_effective_from)
   order by effective_from desc, version desc limit 1;
  select coalesce(max(version), 0) + 1 into next_version from public.feature_flag_versions
   where organization_id = organization_uuid and campus_id is not distinct from p_campus_id and flag_key = p_flag_key;
  if previous_row.id is not null and previous_row.effective_from <= p_effective_from then
    update public.feature_flag_versions set effective_until = p_effective_from where id = previous_row.id;
  end if;
  select min(later_row.effective_from) into next_effective_from
    from public.feature_flag_versions later_row
   where later_row.organization_id = organization_uuid
     and later_row.campus_id is not distinct from p_campus_id
     and later_row.flag_key = p_flag_key
     and later_row.effective_from > p_effective_from;
  insert into public.feature_flag_versions(organization_id, campus_id, flag_key, version, enabled, effective_from, effective_until, supersedes_id, reason, created_by)
  values(organization_uuid, p_campus_id, p_flag_key, next_version, coalesce(p_enabled, false), p_effective_from, next_effective_from, previous_row.id, btrim(p_reason), uid)
  returning id into new_id;
  perform public.emit_domain_event('feature_flag.versioned', 'feature_flag', new_id,
    jsonb_build_object('flagKey', p_flag_key, 'campusId', p_campus_id, 'version', next_version, 'effectiveFrom', p_effective_from,
      'oldValue', previous_row.enabled, 'newValue', coalesce(p_enabled, false), 'reason', btrim(p_reason)), null, null);
  return new_id;
end
$$;

commit;
