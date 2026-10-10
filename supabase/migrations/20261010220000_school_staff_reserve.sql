-- 备用账号：测试、测评与占位用的员工身份单独保管，不进入组织画板与名册的日常列表。
-- 仅影响组织与分工的展示；岗位权限、负责关系与历史记录保持原样。测试用途账号自动归入。

create table public.school_staff_reserve (
  user_id uuid primary key references public.profiles(id),
  reason text not null check (reason in ('test','assessment','placeholder','other')),
  set_by uuid not null references public.profiles(id),
  set_at timestamptz not null default now()
);
alter table public.school_staff_reserve enable row level security;
revoke all on table public.school_staff_reserve from public,anon,authenticated;

create function public.set_school_staff_reserve(p_user_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); prior jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_manage_school_groups() then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and role in ('staff','admin'))
    or (p_reason is not null and p_reason not in ('test','assessment','placeholder','other')) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('school-organization',0));
  select to_jsonb(r) into prior from public.school_staff_reserve r where user_id=p_user_id;
  if p_reason is null then
    delete from public.school_staff_reserve where user_id=p_user_id;
  else
    if exists(select 1 from public.school_business_group_members where user_id=p_user_id and removed_at is null) then raise exception 'STAFF_IN_ORGANIZATION'; end if;
    insert into public.school_staff_reserve(user_id,reason,set_by) values(p_user_id,p_reason,v_uid)
      on conflict(user_id) do update set reason=excluded.reason,set_by=excluded.set_by,set_at=now();
  end if;
  insert into public.school_collaboration_events(action,subject_id,previous_values,saved_values,recorded_by)
    values('set_staff_reserve',p_user_id,prior,jsonb_build_object('reason',p_reason),v_uid);
  return public.read_school_collaboration_settings();
end $$;

do $wire$
declare v_def text; v_before text:='''canFollowUp'',public.has_perm(p.id,''followup.write''),';
begin
  v_def:=pg_get_functiondef('public.read_school_collaboration_settings()'::regprocedure);
  if position(v_before in v_def)=0 then raise exception 'RESERVE_ANCHOR_MISSING'; end if;
  execute replace(v_def,v_before,'''reserve'',case when p.purpose=''test'' then ''test'' else (select r.reason from public.school_staff_reserve r where r.user_id=p.id) end,'
    ||'''fixedTest'',p.purpose=''test'','||v_before);
end $wire$;

revoke all on function public.set_school_staff_reserve(uuid,text) from public,anon,authenticated;
grant execute on function public.set_school_staff_reserve(uuid,text) to authenticated;
select pg_notify('pgrst','reload schema');
