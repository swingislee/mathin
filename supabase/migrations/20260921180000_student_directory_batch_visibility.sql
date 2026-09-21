-- 名录与旧档案名单共用索引；受限角色的可见集合在查询内计算一次。
do $migration$
declare item record; definition text; owner_name text;
begin
  for item in select * from (values
    ('student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])','0e19daa771f7adae0cb1ec40178a63fc'),
    ('school_list_visibility(uuid)','dc59a4911936bc9234abde9b7bef3fd4'),
    ('can_access_student(uuid,uuid)','2e40802d3656104cdb2efdf0235300d0'),
    ('can_view_school_student(uuid,uuid)','96e5af540df9466ce36d439b5bb016e5'),
    ('can_view_school_lead(uuid,uuid)','be9b8572b0fce994372574a3851c322a'),
    ('can_edit_school_lead(uuid,uuid)','c33b368dee46a10557f195ba5731eeb1'),
    ('school_list_scope_keys(uuid,text)','b9077fb2005df20622843446601039b5'),
    ('assigned_of_student(uuid,uuid)','d1b13dcbe25bfe076d3c14fd5787f9a9'),
    ('teacher_of_student(uuid,uuid)','4fd7ed9e8151c7d90ba122f7282dcc94'),
    ('support_of_student(uuid,uuid)','ca51e32ed61250ca8b1b655493df481d'),
    ('school_subject_participant_rows(uuid,uuid)','75a44c1f2f66bb00ec22aa101c8db666'),
    ('school_subject_group_rows(uuid,uuid)','5d004299db5bd601bcf406b95bd92aea')
  ) expected(signature,hash) loop
    if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=('public.'||item.signature)::regprocedure)
      is distinct from item.hash then raise exception 'DIRECTORY_VISIBILITY_DEPENDENCY_CHANGED: %',item.signature; end if;
  end loop;
  select pg_get_functiondef(oid),pg_get_userbyid(proowner) into definition,owner_name from pg_proc
    where oid='public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])'::regprocedure;
  definition:=replace(definition,'return query with',
    'return query with visibility as materialized (select vis.key,vis.can_view from public.school_list_visibility(actor) vis where not view_all),');
  definition:=replace(definition,'public.can_view_school_student(s.id,actor)',
    'exists(select 1 from visibility v where v.key=''student:''||s.id and v.can_view)');
  definition:=replace(definition,'public.can_view_school_lead(l.id,actor)',
    'exists(select 1 from visibility v where v.key=''lead:''||l.id and v.can_view)');
  if definition not like '%visibility as materialized%' or definition like '%public.can_view_school_%' then
    raise exception 'DIRECTORY_VISIBILITY_REWRITE_FAILED'; end if;
  definition:=replace(definition,'FUNCTION public.student_record_index_with_enrollments(', 'FUNCTION public.student_record_index_for_population(');
  definition:=replace(definition,'p_enrollments business_course_enrollment_subjects[])',
    'p_enrollments business_course_enrollment_subjects[], p_students_only boolean)');
  definition:=replace(definition,'where l.student_id is null and view_followup',
    'where not p_students_only and l.student_id is null and view_followup');
  -- 先限制候选身份，再读取这些身份的报名事实；空搜索结果和教师小范围不扫描全部报名。
  definition:=replace(definition,'select * from public.business_activity_registrations',
    'select r.* from public.business_activity_registrations r where exists(select 1 from subjects s where s.student_id=r.student_id)
      or exists(select 1 from lead_refs l where l.id=r.lead_id)
      or exists(select 1 from source_lead_refs l where l.source_record_id=r.source_record_id)');
  if definition not like '%p_students_only boolean%' then raise exception 'DIRECTORY_POPULATION_REWRITE_FAILED'; end if;
  execute definition;
  execute format('alter function public.student_record_index_for_population(text,text,public.business_course_enrollment_subjects[],boolean) owner to %I',owner_name);
end;
$migration$;
revoke all on function public.student_record_index_for_population(text,text,public.business_course_enrollment_subjects[],boolean) from public,anon,authenticated,service_role;

create or replace function public.student_record_index_with_enrollments(p_scope text,p_search text,p_enrollments public.business_course_enrollment_subjects[])
returns table(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
begin return query select * from public.student_record_index_for_population(p_scope,p_search,p_enrollments,false); end;
$$;
