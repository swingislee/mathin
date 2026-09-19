-- 学生名录以已建档身份为单位；阶段、协作范围和办理能力复用既有业务事实。
create function public.list_student_directory(
  p_scope text default 'mine', p_search text default '', p_stage text default 'all',
  p_group_by text default 'classroom', p_group text default '',
  p_page integer default 1, p_page_size integer default 100, p_selected uuid[] default null
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set jit=off as $$
declare actor uuid:=auth.uid(); facts public.business_course_enrollment_subjects[]; subjects jsonb;
  result jsonb; today date:=(now() at time zone public.get_organization_timezone_v2())::date;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all') or public.has_perm(actor,'student.view.assigned')) then
    raise exception 'FORBIDDEN'; end if;
  if p_scope is null or p_scope not in ('all','mine','group','unassigned')
    or p_stage is null or p_stage not in ('all','awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')
    or p_group_by is null or p_group_by not in ('classroom','grade','owner','group','none')
    or p_search is null or length(p_search)>80 or p_group is null or length(p_group)>100
    or p_page is null or p_page<1 or p_page>1000000 or p_page_size is null or p_page_size not in (20,50,100)
    or (p_selected is not null and (cardinality(p_selected)<1 or cardinality(p_selected)>100 or array_position(p_selected,null) is not null)) then
    raise exception 'VALIDATION'; end if;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts from public.business_course_enrollment_subjects e;
  -- 身份去重、可见范围和五阶段在筛选与分页前完成；纯线索不进入名录。
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into subjects
    from public.student_record_index_with_enrollments(p_scope,p_search,facts) s
    where s.student_id is not null and (p_selected is null or s.student_id=any(p_selected));
  with identities as materialized (
    select s.*,st.name,st.grade,st.assigned_to,p.display_name as owner_name,c.projection
    from jsonb_to_recordset(subjects) s(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)
    join public.students st on st.id=s.student_id and st.deleted_at is null
    left join public.profiles p on p.id=st.assigned_to
    join public.school_list_collaboration(subjects,actor) c using(key)
  ), class_refs as materialized (
    select distinct e.student_id,c.id,c.name from public.enrollments e join public.classrooms c on c.id=e.classroom_id
    left join public.school_terms t on t.id=c.term_id
    where e.status='active' and e.left_at is null and e.joined_at<=now()
      and c.trashed_at is null and c.archived_at is null and (t.ends_on is null or t.ends_on>=today)
      and exists(select 1 from identities s where s.student_id=e.student_id)
  ), group_refs as materialized (
    select s.key,c.id::text as id,c.name from identities s join class_refs c using(student_id) where p_group_by='classroom'
    union all select s.key,s.grade::text,s.grade::text from identities s where p_group_by='grade' and s.grade is not null
    union all select s.key,p->>'userId',p->>'name' from identities s cross join lateral jsonb_array_elements(s.projection->'participants') p
      where p_group_by='owner' and p->>'role'='school_support'
    union all select s.key,s.assigned_to::text,s.owner_name from identities s where p_group_by='owner' and s.assigned_to is not null
      and not exists(select 1 from jsonb_array_elements(s.projection->'participants') p where p->>'role'='school_support')
    union all select s.key,g->>'id',g->>'name' from identities s cross join lateral jsonb_array_elements(s.projection->'groups') g where p_group_by='group'
    union all select s.key,'all','' from identities s where p_group_by='none'
  ), groups_by_student as materialized (
    select s.key,coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',coalesce(g.name,'')) order by g.name,g.id)
      from (select distinct id,name from group_refs where key=s.key) g),'[{"id":"unassigned","name":""}]'::jsonb) as items
      from identities s
  ), scoped as materialized (
    select s.*,g.items from identities s join groups_by_student g using(key) where p_stage='all' or s.stage=p_stage
  ), filtered as materialized (
    select * from scoped s where p_group='' or exists(select 1 from jsonb_array_elements(s.items) g where g->>'id'=p_group)
  ), totals as (select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as pages from filtered),
  ordered as materialized (
    select s.*,row_number() over(order by
      case when p_selected is not null then array_position(p_selected,s.student_id) end,
      case when p_group_by='grade' then s.grade end nulls last,
      case when p_group_by<>'none' then s.items->0->>'name' end,s.name,s.student_id) as ordinal from filtered s
  ), page_rows as materialized (
    select * from ordered order by ordinal limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size
  ), details as materialized (
    select r from jsonb_array_elements(public.student_record_list_rows(
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,'stage',stage,'detail',detail,'created_at',created_at)) from page_rows),'[]'::jsonb),facts)) r
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(d.r||jsonb_build_object('directoryGroups',s.items) order by s.ordinal) from page_rows s join details d on d.r->>'key'=s.key),'[]'::jsonb),
    'count',(select count from totals),'page',least(p_page,(select pages from totals)),
    'pageSize',p_page_size,'totalPages',(select pages from totals),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'count',n) order by name,id) from (
      select g->>'id' as id,g->>'name' as name,count(distinct s.student_id)::integer as n
        from scoped s cross join lateral jsonb_array_elements(s.items) g group by g->>'id',g->>'name') v),'[]'::jsonb),
    'counts',coalesce((select jsonb_object_agg(stage,n) from(select stage,count(*)::integer as n from identities group by stage) v),'{}'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.list_student_directory(text,text,text,text,text,integer,integer,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.list_student_directory(text,text,text,text,text,integer,integer,uuid[]) to authenticated;
notify pgrst,'reload schema';
