-- P4H-3 forward compatibility: 旧课程页在 P4H-4 收口前仍须原子创建 legacy family + variant。

create or replace function public.create_legacy_course(
  p_title text,
  p_product_code text,
  p_grade smallint,
  p_course_season smallint,
  p_class_type text,
  p_status text default 'enabled'
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  course_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;
  if length(trim(coalesce(p_title, ''))) = 0
     or p_grade not between 1 and 9
     or p_course_season not between 1 and 4
     or p_status not in ('draft','enabled','disabled') then
    raise exception 'VALIDATION';
  end if;

  insert into public.courses (title,product_code,grade,term,class_type,status,purpose,created_by)
  values (
    left(trim(p_title), 100),
    nullif(left(trim(coalesce(p_product_code, '')), 40), ''),
    p_grade,
    p_course_season,
    left(trim(coalesce(p_class_type, '')), 20),
    p_status,
    'production',
    uid
  )
  returning id into course_id;
  return course_id;
end;
$$;

revoke all on function public.create_legacy_course(text,text,smallint,smallint,text,text) from public, anon, authenticated;
grant execute on function public.create_legacy_course(text,text,smallint,smallint,text,text) to authenticated;
