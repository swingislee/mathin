-- 活动周视图使用结构化年级范围；历史活动保持待核对，不推断其适配年级。
alter table public.activities add column target_grades smallint[] default null;
alter table public.activities add constraint activities_target_grades_check check (
  target_grades is null or (
    cardinality(target_grades) <= 12
    and coalesce(array_ndims(target_grades), 1) = 1
    and array_position(target_grades, null) is null
    and target_grades <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
  )
);
comment on column public.activities.target_grades is '适用年级：NULL=未标注待核对，空数组=明确不限年级，非空=适用的1至12年级。';

create or replace function public.set_activity_target_grades(p_activity_id uuid, p_target_grades smallint[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'activity.manage') then raise exception 'FORBIDDEN'; end if;
  if p_target_grades is not null and (
    cardinality(p_target_grades) > 12 or coalesce(array_ndims(p_target_grades), 1) <> 1
    or array_position(p_target_grades, null) is not null
    or not (p_target_grades <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])
  ) then raise exception 'INVALID_INPUT'; end if;
  update public.activities set target_grades = case when p_target_grades is null then null
    else array(select distinct grade from unnest(p_target_grades) grade order by grade) end
  where id = p_activity_id and deleted_at is null and source_invitation_id is null;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

revoke all on function public.set_activity_target_grades(uuid,smallint[]) from public,anon,authenticated;
grant execute on function public.set_activity_target_grades(uuid,smallint[]) to authenticated;
select pg_notify('pgrst', 'reload schema');
