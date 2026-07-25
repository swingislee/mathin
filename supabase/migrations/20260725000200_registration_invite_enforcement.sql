-- 注册邀请码不能只靠应用 Server Action：直接调用 GoTrue signup 也必须经过数据库闸门。
-- 友好错误仍由应用预校验提供；本触发器是最终一致性与绕过防线。

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  supplied_code text := upper(btrim(coalesce(new.raw_user_meta_data ->> 'registration_invite_code', '')));
begin
  if new.raw_user_meta_data ->> 'privacy_consent' is distinct from 'true'
     or new.raw_user_meta_data ->> 'children_privacy_consent' is distinct from 'true' then
    raise exception 'REGISTRATION_CONSENT_REQUIRED';
  end if;

  if not exists (
    select 1
      from public.registration_invite_settings s
     where s.id = 1
       and s.is_active
       and s.code = supplied_code
  ) then
    raise exception 'INVALID_REGISTRATION_INVITE';
  end if;

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
    now(),
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'auth.users 注册闸门：邀请码启用且匹配、双隐私同意齐全后才创建 profile；阻止绕过应用直接注册。';
