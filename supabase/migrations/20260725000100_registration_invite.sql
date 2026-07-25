-- 注册入口治理：邀请码、隐私同意留痕与主管配置权限。

-- ---------------------------------------------------------------------------
-- 1. 用户同意留痕。注册触发器从 auth.users metadata 写入，只允许受信任后端修改。
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists privacy_consented_at timestamptz,
  add column if not exists children_privacy_consented_at timestamptz;

comment on column public.profiles.privacy_consented_at is '用户注册时同意隐私政策的时间';
comment on column public.profiles.children_privacy_consented_at is '用户注册时同意儿童个人信息保护政策的时间';

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and (
    new.role is distinct from old.role
    or new.privacy_consented_at is distinct from old.privacy_consented_at
    or new.children_privacy_consented_at is distinct from old.children_privacy_consented_at
  ) then
    raise exception 'protected profile fields can only be changed by service role';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    privacy_consented_at,
    children_privacy_consented_at
  )
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1),
      ''
    ),
    case when new.raw_user_meta_data ->> 'privacy_consent' = 'true' then now() end,
    case when new.raw_user_meta_data ->> 'children_privacy_consent' = 'true' then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 独立权限键。主管/校长可配置；admin 由应用与 has_perm() 的管理员分支自动放行。
-- ---------------------------------------------------------------------------
create or replace function public.school_permission_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'courseware.template.edit','courseware.overlay.edit',
    'courseware.page.edit','courseware.asset.manage','courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','registration.invite.manage','audit.view','testdata.purge'
  ]::text[];
$$;

insert into public.role_permissions (role_id, perm_key)
select r.id, 'registration.invite.manage'
  from public.staff_roles r
 where r.key in ('director', 'principal')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. 单例设置表。业务调用只走 security definer RPC；表本身保持 deny-all。
-- ---------------------------------------------------------------------------
create table if not exists public.registration_invite_settings (
  id smallint primary key default 1 check (id = 1),
  code text not null check (code ~ '^[A-Z0-9_-]{6,32}$'),
  is_active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.registration_invite_settings enable row level security;

create policy "registration_invite_settings_rpc_only"
  on public.registration_invite_settings
  for all
  using (false)
  with check (false);

create trigger registration_invite_settings_set_updated_at
  before update on public.registration_invite_settings
  for each row execute function public.set_updated_at();

insert into public.registration_invite_settings (id, code, is_active)
values (1, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), true)
on conflict (id) do nothing;

revoke all on table public.registration_invite_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 最小 RPC 面：管理端可读写配置，注册端只能得到匹配结果。
-- ---------------------------------------------------------------------------
create or replace function public.get_registration_invite_settings()
returns table (
  code text,
  is_active boolean,
  updated_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not public.has_perm(auth.uid(), 'registration.invite.manage') then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select s.code, s.is_active, s.updated_at
    from public.registration_invite_settings s
   where s.id = 1;
end;
$$;

create or replace function public.set_registration_invite(p_code text, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.has_perm(auth.uid(), 'registration.invite.manage') then
    raise exception 'FORBIDDEN';
  end if;

  if clean_code !~ '^[A-Z0-9_-]{6,32}$' then
    raise exception 'INVALID_INVITE_CODE';
  end if;

  insert into public.registration_invite_settings (id, code, is_active, updated_by)
  values (1, clean_code, coalesce(p_is_active, false), auth.uid())
  on conflict (id) do update
    set code = excluded.code,
        is_active = excluded.is_active,
        updated_by = excluded.updated_by;
end;
$$;

create or replace function public.validate_registration_invite(p_code text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.registration_invite_settings s
     where s.id = 1
       and s.is_active
       and s.code = upper(btrim(coalesce(p_code, '')))
  );
$$;

revoke all on function public.get_registration_invite_settings() from public;
revoke all on function public.set_registration_invite(text, boolean) from public;
revoke all on function public.validate_registration_invite(text) from public;

grant execute on function public.get_registration_invite_settings() to authenticated;
grant execute on function public.set_registration_invite(text, boolean) to authenticated;
grant execute on function public.validate_registration_invite(text) to anon, authenticated;
