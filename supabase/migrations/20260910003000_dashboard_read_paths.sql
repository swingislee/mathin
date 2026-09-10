-- 学生关联用于读取范围和参与经历查询，按学生定位关联 Lead。
-- 业务字段与既有权限辅助函数保持原定义。
create index leads_student_scope_idx on public.leads (student_id, id)
  where student_id is not null;

-- 线索池原有的直接可见分支先按账号求值。其余归属、参与、分组等条件
-- 继续调用原策略。兼容协作版本前后的同一池权限，不修改权限辅助函数。
do $read_paths$
declare
  pool_qual text; enrollment_qual text; student_function text; original_call text;
  access_body text; student_scope text; collaboration boolean;
  original_search_path text := current_setting('search_path');
begin
  perform set_config('search_path','public, pg_temp',true);
  select pg_get_expr(polqual,polrelid) into strict pool_qual from pg_policy
    where polrelid='public.leads'::regclass and polname='leads_select_pool_scope' and polcmd='r';
  if pool_qual is null then
    raise exception 'UNRECOGNIZED_LEAD_READ_POLICY';
  end if;
  if position('can_view_school_lead' in pool_qual)>0 then
    if regexp_replace(pool_qual,'\s','','g') <> 'can_view_school_lead(id,(SELECTauth.uid()ASuid))' then
      raise exception 'UNRECOGNIZED_LEAD_READ_POLICY';
    end if;
    select regexp_replace(prosrc,'\s','','g') into strict access_body
      from pg_proc where oid='public.can_view_school_lead(uuid,uuid)'::regprocedure;
    if access_body <> 'selectpublic.is_staff(p_uid)andexists(select1frompublic.leadslwherel.id=p_lead_idand((public.has_perm(p_uid,''followup.view'')and(l.owner_idisnullorpublic.can_edit_school_lead(l.id,p_uid)orpublic.school_subject_in_my_groups(l.student_id,l.id,p_uid)))orl.created_by=p_uidandpublic.has_perm(p_uid,''student.import'')));' then
      raise exception 'UNRECOGNIZED_LEAD_VIEW_FUNCTION';
    end if;
    select regexp_replace(prosrc,'\s','','g') into strict access_body
      from pg_proc where oid='public.can_edit_school_lead(uuid,uuid)'::regprocedure;
    if access_body <> 'selectpublic.is_staff(p_uid)andexists(select1frompublic.leadslwherel.id=p_lead_idand(l.owner_id=p_uidorpublic.has_perm(p_uid,''student.view.all'')orpublic.school_subject_is_participant(l.student_id,l.id,p_uid)orl.student_idisnotnullandpublic.can_access_student(l.student_id,p_uid)));' then
      raise exception 'UNRECOGNIZED_LEAD_EDIT_FUNCTION';
    end if;
    pool_qual := format('case when (select public.is_staff(auth.uid())) and (
      ((select public.has_perm(auth.uid(), ''followup.view'')) and (
        owner_id is null or owner_id=(select auth.uid())
        or (select public.has_perm(auth.uid(), ''student.view.all''))))
      or (created_by=(select auth.uid()) and (select public.has_perm(auth.uid(), ''student.import'')))
    ) then true else (%s) end', pool_qual);
  elsif position('followup.view' in pool_qual)>0 then
    -- 协作功能前的策略只提升已有 has_perm 求值，不增加任何可见分支。
    pool_qual := regexp_replace(pool_qual,
      'has_perm\(\( SELECT auth.uid\(\) AS uid\), ''([^'']+)''::text\)',
      '(select public.has_perm(auth.uid(), ''\1''))','g');
  else
    raise exception 'UNRECOGNIZED_LEAD_READ_POLICY';
  end if;
  execute format('alter policy leads_select_pool_scope on public.leads using (%s)',pool_qual);

  select pg_get_expr(polqual,polrelid) into strict enrollment_qual from pg_policy
    where polrelid='public.course_enrollments'::regclass and polname='course_enrollments_select_scope' and polcmd='r';
  student_function := case when position('can_view_school_student' in enrollment_qual)>0
    then 'can_view_school_student' else 'can_access_student' end;
  original_call := format('%s(student_id, ( SELECT auth.uid() AS uid))', student_function);
  if position(original_call in enrollment_qual)=0 then raise exception 'UNRECOGNIZED_ENROLLMENT_READ_POLICY'; end if;
  -- 展开已知学生范围表达式，使账号级判断成为查询 InitPlan。
  -- 后续学生范围迁移同时维护这里对应的报名 SELECT 策略。
  -- 按学生判断的归属、授课、学服、参与和分组辅助函数继续沿用原实现。
  select regexp_replace(prosrc,'\s','','g') into strict access_body
    from pg_proc where oid='public.can_access_student(uuid,uuid)'::regprocedure;
  collaboration := access_body = 'selectpublic.is_staff(uid)and(public.is_admin(uid)orpublic.staff_has_perm(uid,''student.view.all'')or(public.staff_has_perm(uid,''student.view.assigned'')and(public.assigned_of_student(sid,uid)orpublic.teacher_of_student(sid,uid)orpublic.support_of_student(sid,uid)))orpublic.school_subject_is_participant(sid,null,uid));';
  if not collaboration and access_body <> 'selectpublic.is_admin(uid)orpublic.staff_has_perm(uid,''student.view.all'')or(public.staff_has_perm(uid,''student.view.assigned'')and(public.assigned_of_student(sid,uid)orpublic.teacher_of_student(sid,uid)orpublic.support_of_student(sid,uid)));' then
    raise exception 'UNRECOGNIZED_STUDENT_ACCESS_FUNCTION';
  end if;
  student_scope := '(select public.is_admin(auth.uid()))
    or (select public.staff_has_perm(auth.uid(), ''student.view.all''))
    or ((select public.staff_has_perm(auth.uid(), ''student.view.assigned'')) and (
      public.assigned_of_student(student_id,(select auth.uid()))
      or public.teacher_of_student(student_id,(select auth.uid()))
      or public.support_of_student(student_id,(select auth.uid()))))';
  if collaboration then
    student_scope := format('(select public.is_staff(auth.uid())) and ((%s)
      or public.school_subject_is_participant(student_id,null,(select auth.uid())))',student_scope);
  end if;
  if student_function = 'can_view_school_student' then
    select regexp_replace(prosrc,'\s','','g') into strict access_body
      from pg_proc where oid='public.can_view_school_student(uuid,uuid)'::regprocedure;
    if access_body <> 'selectpublic.can_access_student(p_student_id,p_uid)or(public.is_staff(p_uid)and(public.has_perm(p_uid,''followup.view'')orpublic.has_perm(p_uid,''student.view.assigned''))andpublic.school_subject_in_my_groups(p_student_id,null,p_uid));' then
      raise exception 'UNRECOGNIZED_STUDENT_VIEW_FUNCTION';
    end if;
    student_scope := format('(%s) or ((select public.is_staff(auth.uid())) and (
      (select public.has_perm(auth.uid(), ''followup.view''))
      or (select public.has_perm(auth.uid(), ''student.view.assigned'')))
      and public.school_subject_in_my_groups(student_id,null,(select auth.uid())))',student_scope);
  end if;
  -- 空 Student 共享原函数的空值结果；非空学生沿用同一布尔表达式。
  enrollment_qual := replace(enrollment_qual,original_call,format(
    '(case when student_id is null then (select public.%1$I(null,auth.uid()))
      else (%2$s) end)',student_function,student_scope));
  enrollment_qual := replace(enrollment_qual,
    'has_perm(( SELECT auth.uid() AS uid), ''enrollment.manage''::text)',
    '(select public.has_perm(auth.uid(), ''enrollment.manage''))');
  execute format('alter policy course_enrollments_select_scope on public.course_enrollments using (%s)',enrollment_qual);
  perform set_config('search_path',original_search_path,true);
end;
$read_paths$;

-- 无入参的 stable 判断在单次查询内结果相同，保留原函数及原来源条件。
alter policy course_enrollments_pending_source_read on public.course_enrollments
  using (student_id is null and source_record_id is not null and (select public.can_confirm_history_source()));
alter policy course_enrollment_assignments_pending_source_read on public.course_enrollment_assignments
  using (source_record_id is not null and (select public.can_confirm_history_source()));
