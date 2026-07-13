-- 修复 list_student_guardians 里 guardian_id 列引用歧义：returns table 的 OUT 参数
-- guardian_id 与 EXISTS 子查询里未限定前缀的 guardian_id 列同名，PL/pgSQL 报
-- "column reference \"guardian_id\" is ambiguous"，导致 GuardianScopePanel 恒失败。

create or replace function public.list_student_guardians(p_student_id uuid)
returns table(guardian_id uuid,display_name text,relation text,scope text[],is_primary boolean)
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid();
begin
  if uid is null or not (
    (public.has_perm(uid,'student.edit') and public.can_access_student(p_student_id,uid))
    or exists(select 1 from public.student_guardians sg where sg.student_id=p_student_id and sg.guardian_id=uid and sg.is_primary)
  ) then raise exception 'FORBIDDEN'; end if;
  return query select g.guardian_id,coalesce(nullif(trim(p.display_name),''),left(g.guardian_id::text,8)),g.relation,g.scope,g.is_primary
    from public.student_guardians g join public.profiles p on p.id=g.guardian_id
   where g.student_id=p_student_id order by g.is_primary desc,g.created_at,g.guardian_id;
end $$;
