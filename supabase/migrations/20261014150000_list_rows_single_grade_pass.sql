-- 名单行的当前年级只在批量层推算一次。
-- 待报名、续报、停课及有进行中邀约的行逐行调用完整读取；该读取原先各自推算年级（单人约 40ms），
-- 随后 student_record_list_rows 又对整批统一推算并覆盖同名字段。100 行名单因此多出约 4 秒。
-- 逐行读取拆成不含年级的行构建与单人外壳：单人读取结果不变，名单沿用原批量推算。
do $rows$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.read_student_record_with_context(uuid,uuid,public.business_course_enrollment_subjects[],jsonb)'::regprocedure);
  anchor:='CREATE OR REPLACE FUNCTION public.read_student_record_with_context(';
  if position(anchor in definition)=0 then raise exception 'ROW_READ_NAME_CHANGED'; end if;
  definition:=replace(definition,anchor,'CREATE OR REPLACE FUNCTION public.student_record_row_with_context(');
  anchor:='return (public.school_apply_current_grades(jsonb_build_array(public.school_collaboration_row(jsonb_build_object(';
  if position(anchor in definition)=0 then raise exception 'ROW_READ_START_CHANGED'; end if;
  definition:=replace(definition,anchor,'return public.school_collaboration_row(jsonb_build_object(');
  anchor:=$anchor$'assessmentAt',background->'assessmentAt') else '{}'::jsonb end))))->0;$anchor$;
  if position(anchor in definition)=0 then raise exception 'ROW_READ_END_CHANGED'; end if;
  definition:=replace(definition,anchor,$anchor$'assessmentAt',background->'assessmentAt') else '{}'::jsonb end);$anchor$);
  execute definition;

  definition:=pg_get_functiondef('public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])'::regprocedure);
  anchor:='public.read_student_record_with_context(s.student_id,s.lead_id,p_enrollments,';
  if position(anchor in definition)=0 then raise exception 'LIST_ROW_READ_CHANGED'; end if;
  if position('result:=public.school_apply_current_grades(result);' in definition)=0 then raise exception 'LIST_GRADE_PASS_CHANGED'; end if;
  definition:=replace(definition,anchor,'public.student_record_row_with_context(s.student_id,s.lead_id,p_enrollments,');
  execute definition;
end $rows$;

create or replace function public.read_student_record_with_context(p_student_id uuid,p_lead_id uuid,
  p_enrollments public.business_course_enrollment_subjects[],p_read_context jsonb)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select (public.school_apply_current_grades(jsonb_build_array(
    public.student_record_row_with_context(p_student_id,p_lead_id,p_enrollments,p_read_context))))->0
$$;

revoke all on function public.student_record_row_with_context(uuid,uuid,public.business_course_enrollment_subjects[],jsonb)
  from public,anon,authenticated;
grant execute on function public.student_record_row_with_context(uuid,uuid,public.business_course_enrollment_subjects[],jsonb)
  to service_role;
notify pgrst,'reload schema';
