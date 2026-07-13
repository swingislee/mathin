-- P4D-1：讲次创建/删除/重排的事务边界。课程与班级基础字段继续走既有 RLS。

create or replace function public.create_course_lecture(p_course_id uuid, p_name text, p_objectives text default '')
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  next_no smallint;
  lecture_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'EMPTY_NAME'; end if;
  perform 1 from public.courses where id = p_course_id for update;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  select (coalesce(max(no), 0) + 1)::smallint into next_no from public.course_lectures where course_id = p_course_id;
  insert into public.course_lectures(course_id, no, name, objectives)
  values (p_course_id, next_no, left(trim(p_name), 100), left(trim(coalesce(p_objectives, '')), 2000))
  returning id into lecture_id;
  return lecture_id;
end;
$$;

create or replace function public.delete_course_lecture(p_lecture_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null or not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;
  select course_id into cid from public.course_lectures where id = p_lecture_id for update;
  if cid is null then raise exception 'LECTURE_NOT_FOUND'; end if;
  if exists(select 1 from public.class_sessions where lecture_id = p_lecture_id) then raise exception 'LECTURE_IN_USE'; end if;
  delete from public.course_lectures where id = p_lecture_id;
  update public.course_lectures set no = -no where course_id = cid;
  with ordered as (
    select id, row_number() over(order by -no)::smallint as new_no from public.course_lectures where course_id = cid
  )
  update public.course_lectures cl set no = ordered.new_no from ordered where cl.id = ordered.id;
end;
$$;

create or replace function public.reorder_course_lectures(p_course_id uuid, p_lecture_ids uuid[])
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); expected int; supplied int;
begin
  if uid is null or not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.courses where id = p_course_id for update;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  select count(*) into expected from public.course_lectures where course_id = p_course_id;
  select count(distinct u.lecture_id) into supplied
    from unnest(coalesce(p_lecture_ids, '{}'::uuid[])) as u(lecture_id);
  if supplied <> expected or cardinality(coalesce(p_lecture_ids, '{}'::uuid[])) <> expected
     or exists(select 1 from unnest(coalesce(p_lecture_ids, '{}'::uuid[])) as u(lecture_id)
                where not exists(select 1 from public.course_lectures cl where cl.id=u.lecture_id and cl.course_id=p_course_id))
  then raise exception 'INVALID_LECTURE_ORDER'; end if;
  update public.course_lectures set no = -no where course_id = p_course_id;
  update public.course_lectures cl set no = ordered.no::smallint
    from unnest(p_lecture_ids) with ordinality ordered(id, no)
   where cl.id = ordered.id and cl.course_id = p_course_id;
end;
$$;

revoke all on function public.create_course_lecture(uuid,text,text) from public, anon, authenticated;
revoke all on function public.delete_course_lecture(uuid) from public, anon, authenticated;
revoke all on function public.reorder_course_lectures(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.create_course_lecture(uuid,text,text) to authenticated;
grant execute on function public.delete_course_lecture(uuid) to authenticated;
grant execute on function public.reorder_course_lectures(uuid,uuid[]) to authenticated;
