-- P4E-O1 §7.3：主监护人与多监护人差异权限管理。

alter table public.student_guardians add column if not exists is_primary boolean not null default false;
create unique index if not exists student_guardians_one_primary
  on public.student_guardians(student_id) where is_primary;

with ranked as (
  select student_id,guardian_id,row_number() over(partition by student_id order by created_at,guardian_id) as rn
    from public.student_guardians
)
update public.student_guardians g set is_primary=true
  from ranked r where r.student_id=g.student_id and r.guardian_id=g.guardian_id and r.rn=1
    and not exists(select 1 from public.student_guardians x where x.student_id=g.student_id and x.is_primary);

create or replace function public.ensure_primary_guardian()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.students where id=new.student_id for update;
  if not exists(select 1 from public.student_guardians where student_id=new.student_id and is_primary) then
    new.is_primary:=true;
  end if;
  return new;
end $$;
drop trigger if exists student_guardians_ensure_primary on public.student_guardians;
create trigger student_guardians_ensure_primary before insert on public.student_guardians
for each row execute function public.ensure_primary_guardian();

create or replace function public.list_student_guardians(p_student_id uuid)
returns table(guardian_id uuid,display_name text,relation text,scope text[],is_primary boolean)
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid();
begin
  if uid is null or not (
    (public.has_perm(uid,'student.edit') and public.can_access_student(p_student_id,uid))
    or exists(select 1 from public.student_guardians where student_id=p_student_id and guardian_id=uid and is_primary)
  ) then raise exception 'FORBIDDEN'; end if;
  return query select g.guardian_id,coalesce(nullif(trim(p.display_name),''),left(g.guardian_id::text,8)),g.relation,g.scope,g.is_primary
    from public.student_guardians g join public.profiles p on p.id=g.guardian_id
   where g.student_id=p_student_id order by g.is_primary desc,g.created_at,g.guardian_id;
end $$;

create or replace function public.set_guardian_scope(p_student_id uuid,p_guardian_id uuid,p_scope text[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); normalized text[];
begin
  select coalesce(array_agg(distinct x order by x),'{}'::text[]) into normalized from unnest(coalesce(p_scope,'{}'::text[])) x;
  if not normalized <@ array['grades','video','finance']::text[] then raise exception 'INVALID_SCOPE'; end if;
  if uid is null or not (
    (public.has_perm(uid,'student.edit') and public.can_access_student(p_student_id,uid))
    or exists(select 1 from public.student_guardians where student_id=p_student_id and guardian_id=uid and is_primary)
  ) then raise exception 'FORBIDDEN'; end if;
  update public.student_guardians set scope=normalized where student_id=p_student_id and guardian_id=p_guardian_id;
  if not found then raise exception 'GUARDIAN_NOT_FOUND'; end if;
  perform public.emit_domain_event('guardian.scope_updated','student',p_student_id,
    jsonb_build_object('guardianId',p_guardian_id,'scope',to_jsonb(normalized)),uid,null);
end $$;

revoke all on function public.ensure_primary_guardian() from public,anon,authenticated;
revoke all on function public.list_student_guardians(uuid) from public,anon,authenticated;
revoke all on function public.set_guardian_scope(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.list_student_guardians(uuid) to authenticated;
grant execute on function public.set_guardian_scope(uuid,uuid,text[]) to authenticated;
