-- 当前小团队：调班两端有一端是本人任课班级即可；管理岗继续使用原有管理范围。
-- 班级编辑、商业报名确认和退课仍使用各自权限。任课规则集中在 can_transfer_enrollment。
create function public.can_access_enrollment_placement()
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
  select public.is_staff(auth.uid()) and (
    public.has_perm(auth.uid(),'enrollment.manage') or exists(
      select 1 from public.classroom_members m join public.classrooms c on c.id=m.classroom_id
      where m.user_id=auth.uid() and m.role='teacher' and c.archived_at is null and c.trashed_at is null
        and c.purpose='production' and c.offering_type='long_term_formal'
    )
  );
$$;
revoke all on function public.can_access_enrollment_placement() from public,anon,authenticated;
grant execute on function public.can_access_enrollment_placement() to authenticated;
grant execute on function public.can_access_enrollment_placement() to postgres;

create function mathin_internal.can_transfer_enrollment(p_from uuid,p_to uuid)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
  select public.is_staff(auth.uid()) and (
    (public.has_perm(auth.uid(),'enrollment.manage')
      and (p_from is null or public.can_manage_classroom(p_from,auth.uid()))
      and (p_to is null or public.can_manage_classroom(p_to,auth.uid())))
    or exists(
      select 1 from public.classroom_members m join public.classrooms c on c.id=m.classroom_id
      where m.user_id=auth.uid() and m.role='teacher' and m.classroom_id in(p_from,p_to)
        and c.archived_at is null and c.trashed_at is null
        and c.purpose='production' and c.offering_type='long_term_formal'
    )
  );
$$;
revoke all on function mathin_internal.can_transfer_enrollment(uuid,uuid) from public,anon,authenticated;
grant execute on function mathin_internal.can_transfer_enrollment(uuid,uuid) to postgres;

create function mathin_internal.enrollment_placement_access()
returns jsonb language sql security definer stable set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'canManageEnrollments',public.has_perm(auth.uid(),'enrollment.manage'),
    'teacherClassroomIds',coalesce(jsonb_agg(c.id) filter(where public.is_classroom_teacher(c.id,auth.uid())),'[]'::jsonb),
    'managedClassroomIds',coalesce(jsonb_agg(c.id) filter(where public.has_perm(auth.uid(),'enrollment.manage') and public.can_manage_classroom(c.id,auth.uid())),'[]'::jsonb)
  ) from public.classrooms c where c.archived_at is null and c.trashed_at is null
    and c.purpose='production' and c.offering_type='long_term_formal';
$$;
revoke all on function mathin_internal.enrollment_placement_access() from public,anon,authenticated;
grant execute on function mathin_internal.enrollment_placement_access() to postgres;

-- 老师需要选择转入班和转出学生；只提供当前分班表所需字段，不扩大档案与历史表的 RLS。
create function mathin_internal.get_teacher_enrollment_placement_board()
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare options jsonb;
begin
  if not public.can_access_enrollment_placement() then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'courses',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'productCode',c.product_code,'grade',c.grade,'classType',c.class_type) order by c.grade,c.title,c.id)
      from public.courses c where c.status='enabled' and c.purpose='production' and c.course_kind='curriculum' and c.trashed_at is null),'[]'::jsonb),
    'terms',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'isCurrent',t.is_current,'startsOn',t.starts_on,'endsOn',t.ends_on) order by t.is_current desc,t.starts_on desc nulls last,t.id)
      from public.school_terms t),'[]'::jsonb),
    'classrooms',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'courseId',c.course_id,'termId',c.term_id,'capacity',c.capacity,'operationalStatus',c.operational_status,
      'activeCount',(select count(*) from public.enrollments e where e.classroom_id=c.id and e.status='active'),
      'teacherNames',coalesce((select string_agg(p.display_name,' / ' order by a.responsibility,p.display_name) from public.classroom_staff_assignments a join public.profiles p on p.id=a.user_id where a.classroom_id=c.id and a.responsibility in('primary_teacher','assistant_teacher')),''),
      'teachers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) order by a.responsibility,p.id) from public.classroom_staff_assignments a join public.profiles p on p.id=a.user_id where a.classroom_id=c.id and a.responsibility in('primary_teacher','assistant_teacher')),'[]'::jsonb),
      'sessions',coalesce((select jsonb_agg(jsonb_build_object('at',s.scheduled_at,'duration',s.duration_min) order by s.scheduled_at) from (
        select scheduled_at,duration_min from public.class_sessions where classroom_id=c.id and deleted_at is null and cancelled_by is null and voided_at is null and scheduled_at>=now() order by scheduled_at limit 8
      ) s),'[]'::jsonb)
    ) order by c.name,c.id) from public.classrooms c where c.archived_at is null and c.trashed_at is null and c.operational_status in('planning','active')
      and c.purpose='production' and c.offering_type='long_term_formal' and c.course_id is not null and c.term_id is not null),'[]'::jsonb)
  ) into options;
  return jsonb_build_object('access',mathin_internal.enrollment_placement_access(),'options',options,
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'membershipId',r.id,'studentId',s.id,'name',s.name,'phone',case when public.can_access_student(s.id,auth.uid()) then coalesce(s.phone,'') else '' end,
      'classroomId',r.classroom_id,'enrollmentId',a.course_enrollment_id,'seat',r.placement_seat,
      'status',case when s.status='paused' then 'paused' else 'active' end,'note','','recommendation','',
      'canViewDetails',public.can_access_student(s.id,auth.uid())
    ) order by r.joined_at,r.id) from public.enrollments r join public.students s on s.id=r.student_id
      left join public.course_enrollment_assignments a on a.classroom_membership_id=r.id and a.status='active'
      where r.status='active' and s.deleted_at is null and exists(select 1 from jsonb_array_elements(options->'classrooms') c where c->>'id'=r.classroom_id::text)),'[]'::jsonb),
    'enrollments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'opportunityId',e.opportunity_id,'studentId',s.id,'studentName',s.name,
      'studentPhone',case when public.can_access_student(s.id,auth.uid()) then coalesce(s.phone,'') else '' end,
      'courseId',c.id,'courseTitle',c.title,'termId',t.id,'termName',t.name,'status',e.status,'note','',
      'confirmedAt',e.confirmed_at,'confirmedByName','','cancelledAt',null,'cancelledByName',null,
      'assignmentId',null,'classroomId',null,'classroomName',null,'membershipId',null,'assignedAt',null,
      'claimableClassroomIds','[]'::jsonb,'updatedAt',e.updated_at,'canViewDetails',public.can_access_student(s.id,auth.uid())
    ) order by e.confirmed_at desc,e.id) from public.business_course_enrollments e join public.students s on s.id=e.student_id
      join public.courses c on c.id=e.course_id join public.school_terms t on t.id=e.term_id
      where e.record_state='current' and e.status='active' and s.deleted_at is null and e.opportunity_id is not null and e.confirmed_at is not null
        and not exists(select 1 from public.course_enrollment_assignments a where a.course_enrollment_id=e.id and a.status='active')
        and not exists(select 1 from public.enrollments r join public.classrooms cl on cl.id=r.classroom_id where r.student_id=e.student_id and r.status='active' and cl.course_id=e.course_id and cl.term_id=e.term_id)),'[]'::jsonb)
  );
end $$;
revoke all on function mathin_internal.get_teacher_enrollment_placement_board() from public,anon,authenticated;
grant execute on function mathin_internal.get_teacher_enrollment_placement_board() to postgres;

-- 精确修改现行函数的授权段，保留已有历史边界、事务、班额、冻结、事件和幂等实现。
-- 每个替换必须命中预期次数，版本漂移时整笔迁移回滚。
create function pg_temp.patch_placement_function(signature regprocedure,old_text text,new_text text,expected integer default 1)
returns void language plpgsql as $$
declare definition text:=replace(pg_get_functiondef(signature),E'\r\n',E'\n');
begin
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>expected then
    raise exception 'PLACEMENT_FUNCTION_BASELINE_CHANGED: %',signature;
  end if;
  execute replace(definition,old_text,new_text);
end $$;

-- 花名册首次调整需要补齐商业报名关联。公共确认入口继续验 enrollment.manage，
-- 内部核心仅由已经核对实际花名册及调班两端的 move_enrollment_placement 调用。
do $migration$
declare definition text:=pg_get_functiondef('public.confirm_course_enrollment(uuid,text)'::regprocedure);
begin
  if position('FUNCTION public.confirm_course_enrollment(' in definition)=0 then raise exception 'CONFIRM_FUNCTION_BASELINE_CHANGED'; end if;
  execute replace(definition,'FUNCTION public.confirm_course_enrollment(','FUNCTION mathin_internal.confirm_course_enrollment(');
end $migration$;
select pg_temp.patch_placement_function('mathin_internal.confirm_course_enrollment(uuid,text)',
  'if not public.has_perm(v_uid, ''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;',
  'if not public.can_access_enrollment_placement() then raise exception ''FORBIDDEN''; end if;');
revoke all on function mathin_internal.confirm_course_enrollment(uuid,text) from public,anon,authenticated;
grant execute on function mathin_internal.confirm_course_enrollment(uuid,text) to postgres;
create or replace function public.confirm_course_enrollment(p_opportunity_id uuid,p_note text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  return mathin_internal.confirm_course_enrollment(p_opportunity_id,p_note);
end $$;

select pg_temp.patch_placement_function('mathin_internal.assign_course_enrollment(uuid,uuid,text,timestamptz,boolean)',
  'if not public.has_perm(v_uid, ''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;',
  'if not public.can_access_enrollment_placement() then raise exception ''FORBIDDEN''; end if;');
select pg_temp.patch_placement_function('mathin_internal.assign_course_enrollment(uuid,uuid,text,timestamptz,boolean)',
  'if not public.can_manage_classroom(v_classroom.id, v_uid) then raise exception ''FORBIDDEN_SCOPE''; end if;',
  '-- 公开 assign 入口或内部 move 已核对真实分班两端；内部函数不对 authenticated 授权。');
create or replace function public.assign_course_enrollment(p_course_enrollment_id uuid,p_classroom_id uuid,p_note text,p_effective_at timestamptz default now())
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_access_enrollment_placement() then raise exception 'FORBIDDEN'; end if;
  if not mathin_internal.can_transfer_enrollment(null,p_classroom_id) then raise exception 'FORBIDDEN_SCOPE'; end if;
  return mathin_internal.assign_course_enrollment(p_course_enrollment_id,p_classroom_id,p_note,p_effective_at,false);
end $$;

select pg_temp.patch_placement_function('mathin_internal.transfer_course_enrollment(uuid,uuid,text,timestamptz,boolean)',
  'if not public.has_perm(v_uid, ''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;',
  'if not public.can_access_enrollment_placement() then raise exception ''FORBIDDEN''; end if;');
select pg_temp.patch_placement_function('mathin_internal.transfer_course_enrollment(uuid,uuid,text,timestamptz,boolean)',
  'if not public.can_manage_classroom(v_assignment.classroom_id, v_uid) then raise exception ''FORBIDDEN_SCOPE''; end if;',
  'if not mathin_internal.can_transfer_enrollment(v_assignment.classroom_id,p_to_classroom_id) then raise exception ''FORBIDDEN_SCOPE''; end if;');
select pg_temp.patch_placement_function('mathin_internal.transfer_course_enrollment(uuid,uuid,text,timestamptz,boolean)',
  'if not public.can_manage_classroom(v_target.id, v_uid) then raise exception ''FORBIDDEN_SCOPE''; end if;',
  '-- 上方已按真实原班及目标班核对调班授权。');

select pg_temp.patch_placement_function('mathin_internal.move_enrollment_placement(uuid,uuid,uuid,uuid,boolean,text)',
  'if not public.has_perm(v_uid,''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;',
  'if not public.can_access_enrollment_placement() then raise exception ''FORBIDDEN''; end if;
  if not mathin_internal.can_transfer_enrollment(p_from_classroom_id,p_to_classroom_id) then raise exception ''FORBIDDEN_SCOPE''; end if;');
select pg_temp.patch_placement_function('mathin_internal.move_enrollment_placement(uuid,uuid,uuid,uuid,boolean,text)',
  'if not public.can_manage_classroom(v_member.classroom_id,v_uid) then raise exception ''FORBIDDEN_SCOPE''; end if;',
  'if not mathin_internal.can_transfer_enrollment(v_member.classroom_id,p_to_classroom_id) then raise exception ''FORBIDDEN_SCOPE''; end if;');
select pg_temp.patch_placement_function('mathin_internal.move_enrollment_placement(uuid,uuid,uuid,uuid,boolean,text)',
  'v_enrollment:=public.confirm_course_enrollment(v_opportunity,',
  'v_enrollment:=mathin_internal.confirm_course_enrollment(v_opportunity,');
select pg_temp.patch_placement_function('mathin_internal.move_enrollment_placement(uuid,uuid,uuid,uuid,boolean,text)',
  'perform public.assign_course_enrollment(v_enrollment,v_member.classroom_id,''关联已有班级花名册'',v_now);',
  'perform mathin_internal.assign_course_enrollment(v_enrollment,v_member.classroom_id,''关联已有班级花名册'',v_now,false);');
select pg_temp.patch_placement_function('mathin_internal.move_enrollment_placement(uuid,uuid,uuid,uuid,boolean,text)',
  'if v_assignment.classroom_id is not distinct from p_to_classroom_id then return v_enrollment; end if;
  if v_assignment.classroom_id is distinct from p_from_classroom_id then raise exception ''PLACEMENT_CHANGED''; end if;',
  'if v_assignment.classroom_id is distinct from p_from_classroom_id then raise exception ''PLACEMENT_CHANGED''; end if;
  if v_assignment.classroom_id is not distinct from p_to_classroom_id then return v_enrollment; end if;');
select pg_temp.patch_placement_function('mathin_internal.move_enrollment_placement(uuid,uuid,uuid,uuid,boolean,text)',
  'if not public.can_manage_classroom(v_assignment.classroom_id,v_uid) then raise exception ''FORBIDDEN_SCOPE''; end if;',
  'if not mathin_internal.can_transfer_enrollment(v_assignment.classroom_id,null) then raise exception ''FORBIDDEN_SCOPE''; end if;');

select pg_temp.patch_placement_function('mathin_internal.move_enrollment_to_seat(uuid,uuid,uuid,uuid,integer,integer,boolean,text)',
  'if not public.has_perm(auth.uid(),''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;',
  'if not public.can_access_enrollment_placement() then raise exception ''FORBIDDEN''; end if;
  if not mathin_internal.can_transfer_enrollment(p_from_classroom_id,p_to_classroom_id) then raise exception ''FORBIDDEN_SCOPE''; end if;');
select pg_temp.patch_placement_function('mathin_internal.move_enrollment_to_seat(uuid,uuid,uuid,uuid,integer,integer,boolean,text)',
  'if not public.can_manage_classroom(v_class,auth.uid()) then raise exception ''FORBIDDEN_SCOPE''; end if;',
  '-- 保留两端锁顺序；授权已按原班或目标班核对。');

select pg_temp.patch_placement_function('mathin_internal.preview_enrollment_session_transfer(uuid,uuid,integer,boolean)',
  'if not public.has_perm(auth.uid(),''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;',
  'if not public.can_access_enrollment_placement() then raise exception ''FORBIDDEN''; end if;');
select pg_temp.patch_placement_function('mathin_internal.preview_enrollment_session_transfer(uuid,uuid,integer,boolean)',
  'if not public.can_manage_classroom(m.classroom_id,auth.uid()) or not public.can_manage_classroom(p_to_classroom_id,auth.uid()) then raise exception ''FORBIDDEN_SCOPE''; end if;',
  'if not mathin_internal.can_transfer_enrollment(m.classroom_id,p_to_classroom_id) then raise exception ''FORBIDDEN_SCOPE''; end if;');

select pg_temp.patch_placement_function('public.change_enrollment_placement(uuid,jsonb)',
  'if not public.has_perm(actor,''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;',
  'if not public.can_access_enrollment_placement() then raise exception ''FORBIDDEN''; end if;
  if mode=''withdraw'' and not public.has_perm(actor,''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;
  if not mathin_internal.can_transfer_enrollment(from_id,to_id) then raise exception ''FORBIDDEN_SCOPE''; end if;');
select pg_temp.patch_placement_function('public.change_enrollment_placement(uuid,jsonb)',
  'if not public.can_manage_classroom(c,actor) then raise exception ''FORBIDDEN_SCOPE''; end if;',
  '-- 保留两端锁顺序；授权已按原班或目标班核对。');
select pg_temp.patch_placement_function('public.change_enrollment_placement(uuid,jsonb)',
  'if not public.can_manage_classroom(m.classroom_id,actor) then raise exception ''FORBIDDEN_SCOPE''; end if;',
  'if not mathin_internal.can_transfer_enrollment(m.classroom_id,to_id) then raise exception ''FORBIDDEN_SCOPE''; end if;');
select pg_temp.patch_placement_function('public.change_enrollment_placement(uuid,jsonb)',
  'where e.id=enrollment_id and public.can_access_student(e.student_id,actor))',
  'where e.id=enrollment_id and (public.can_access_student(e.student_id,actor) or (mode=''permanent'' and public.is_classroom_teacher(to_id,actor))))');
select pg_temp.patch_placement_function('public.change_enrollment_placement(uuid,jsonb)',
  'where t.id=transfer_id and t.membership_id=member_id and public.can_manage_classroom(s.classroom_id,actor))',
  'where t.id=transfer_id and t.membership_id=member_id and s.classroom_id=to_id
        and exists(select 1 from public.class_sessions origin where origin.id=t.from_session_id and origin.classroom_id=from_id)
        and mathin_internal.can_transfer_enrollment(from_id,s.classroom_id))');

select pg_temp.patch_placement_function('public.get_enrollment_session_transfers()',
  'if not public.has_perm(auth.uid(),''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;',
  'if not public.can_access_enrollment_placement() then raise exception ''FORBIDDEN''; end if;');
select pg_temp.patch_placement_function('public.get_enrollment_session_transfers()',
  'and public.can_manage_classroom(s.classroom_id,auth.uid()) and public.can_manage_classroom(d.classroom_id,auth.uid())',
  'and mathin_internal.can_transfer_enrollment(s.classroom_id,d.classroom_id)');
select pg_temp.patch_placement_function('public.get_enrollment_placement_board()',
  'if not public.has_perm(auth.uid(),''enrollment.manage'') then raise exception ''FORBIDDEN''; end if;',
  'if not public.can_access_enrollment_placement() then raise exception ''FORBIDDEN''; end if;
  if not public.has_perm(auth.uid(),''enrollment.manage'') then return mathin_internal.get_teacher_enrollment_placement_board(); end if;');
select pg_temp.patch_placement_function('public.get_enrollment_placement_board()',
  'return jsonb_build_object(''options'',v_options,',
  'return jsonb_build_object(''access'',mathin_internal.enrollment_placement_access(),''options'',v_options,');

drop function pg_temp.patch_placement_function(regprocedure,text,text,integer);
notify pgrst,'reload schema';
