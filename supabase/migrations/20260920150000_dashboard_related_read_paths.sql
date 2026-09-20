-- 学生、课程意向、班级、课次与活动的账号级判断在一次查询内求值。
-- 原权限函数及逐对象范围继续保留；后续权限规则变更须同步核对展开的学生 SELECT。
do $read_paths$
declare
  item record;
  actual_body text;
  actual_qual text;
  optimized_qual text;
  original_search_path text := current_setting('search_path');
begin
  perform set_config('search_path', 'public, pg_temp', true);

  for item in select * from (values
    ('public.can_access_student(uuid,uuid)',
      'select public.is_staff(uid) and (public.is_admin(uid) or public.staff_has_perm(uid,''student.view.all'')
        or (public.staff_has_perm(uid,''student.view.assigned'') and (
          public.assigned_of_student(sid,uid) or public.teacher_of_student(sid,uid) or public.support_of_student(sid,uid)))
        or public.school_subject_is_participant(sid,null,uid));'),
    ('public.can_view_school_student(uuid,uuid)',
      'select public.can_access_student(p_student_id,p_uid) or
        (public.is_staff(p_uid) and (public.has_perm(p_uid,''followup.view'') or public.has_perm(p_uid,''student.view.assigned''))
          and public.school_subject_in_my_groups(p_student_id,null,p_uid));'),
    ('public.can_access_course_opportunity_subject(uuid,uuid,uuid,uuid)',
      'select p_uid is not null and (
        public.is_admin(p_uid)
        or public.has_perm(p_uid, ''enrollment.manage'')
        or (
          public.has_perm(p_uid, ''followup.view'')
          and (
            p_owner_id = p_uid
            or public.has_perm(p_uid, ''student.view.all'')
            or (p_student_id is not null and public.can_access_student(p_student_id, p_uid))
            or (
              p_lead_id is not null
              and exists (
                select 1 from public.leads lead
                 where lead.id = p_lead_id
                   and (lead.owner_id is null or public.can_edit_school_lead(lead.id,p_uid))
              )
            )
          )
        )
      )')
  ) as known(signature, body) loop
    select prosrc into strict actual_body from pg_proc
      where oid=item.signature::regprocedure and provolatile='s' and prosecdef;
    if regexp_replace(actual_body, '\s', '', 'g') <> regexp_replace(item.body, '\s', '', 'g') then
      raise exception 'DASHBOARD_READ_FUNCTION_CHANGED: %', item.signature;
    end if;
  end loop;

  -- 仅处理明确列出的 SELECT 策略；表、角色、组合方式或表达式漂移时停止迁移。
  for item in select * from (values
    ('students', 'students_select_staff_scope', 'can_view_school_student(id, ( SELECT auth.uid() AS uid))'),
    ('course_opportunities', 'course_opportunities_select_scope',
      'can_access_course_opportunity_subject(student_id, lead_id, owner_id, ( SELECT auth.uid() AS uid))'),
    ('classrooms', 'classrooms_select_schedule_view_all', 'staff_has_perm(( SELECT auth.uid() AS uid), ''schedule.view.all''::text)'),
    ('classrooms', 'classrooms_select_view_all', '(is_admin(( SELECT auth.uid() AS uid)) OR staff_has_perm(( SELECT auth.uid() AS uid), ''class.view.all''::text))'),
    ('classrooms', 'classrooms_select_student_scope', '(is_staff(( SELECT auth.uid() AS uid)) AND staff_linked_classroom(id, ( SELECT auth.uid() AS uid)))'),
    ('class_sessions', 'sessions_select_schedule_view_all', 'staff_has_perm(( SELECT auth.uid() AS uid), ''schedule.view.all''::text)'),
    ('class_sessions', 'sessions_select_view_all', '(is_admin(( SELECT auth.uid() AS uid)) OR staff_has_perm(( SELECT auth.uid() AS uid), ''class.view.all''::text))'),
    ('class_sessions', 'sessions_select_student_scope', '(is_staff(( SELECT auth.uid() AS uid)) AND staff_linked_classroom(classroom_id, ( SELECT auth.uid() AS uid)))'),
    ('activities', 'activities_staff_select', 'is_staff(( SELECT auth.uid() AS uid))'),
    ('activity_registrations', 'activity_registrations_staff_select', 'is_staff(( SELECT auth.uid() AS uid))'),
    ('assessment_results', 'assessment_results_staff_select', 'is_staff(( SELECT auth.uid() AS uid))')
  ) as known(relation, name, qual) loop
    select pg_get_expr(polqual, polrelid) into strict actual_qual from pg_policy
      where polrelid=format('public.%I',item.relation)::regclass and polname=item.name and polcmd='r'
        and polpermissive and polroles=array[(select oid from pg_roles where rolname='authenticated')];
    if regexp_replace(actual_qual, '\s', '', 'g') <> regexp_replace(item.qual, '\s', '', 'g') then
      raise exception 'DASHBOARD_READ_POLICY_CHANGED: %.%', item.relation, item.name;
    end if;
    if item.relation='students' then
      optimized_qual := $student$
        (select public.is_staff(auth.uid())) and (
          (select public.is_admin(auth.uid())) or (select public.staff_has_perm(auth.uid(),'student.view.all'))
          or ((select public.staff_has_perm(auth.uid(),'student.view.assigned')) and (
            public.assigned_of_student(id,(select auth.uid()))
            or public.teacher_of_student(id,(select auth.uid()))
            or public.support_of_student(id,(select auth.uid()))))
          or public.school_subject_is_participant(id,null,(select auth.uid()))
          or (((select public.has_perm(auth.uid(),'followup.view')) or (select public.has_perm(auth.uid(),'student.view.assigned')))
            and public.school_subject_in_my_groups(id,null,(select auth.uid())))
        )
      $student$;
    elsif item.relation='course_opportunities' then
      optimized_qual := format($opportunity$
        case when (select auth.uid() is not null and (public.is_admin(auth.uid()) or public.has_perm(auth.uid(),'enrollment.manage'))) then true
          when (select public.has_perm(auth.uid(),'followup.view')) then (%s)
          else false end
      $opportunity$,actual_qual);
    else
      optimized_qual := regexp_replace(actual_qual,
        '(is_staff|is_admin)\(\( SELECT auth.uid\(\) AS uid\)\)', '(select public.\1(auth.uid()))','g');
      optimized_qual := regexp_replace(optimized_qual,
        'staff_has_perm\(\( SELECT auth.uid\(\) AS uid\), ''([^'']+)''::text\)',
        '(select public.staff_has_perm(auth.uid(), ''\1''))','g');
    end if;
    if optimized_qual=actual_qual then raise exception 'DASHBOARD_READ_POLICY_UNCHANGED: %',item.name; end if;
    execute format('ALTER POLICY %I ON public.%I USING (%s)',item.name,item.relation,optimized_qual);
  end loop;
  perform set_config('search_path',original_search_path,true);
end;
$read_paths$;
