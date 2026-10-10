-- 组长观察台：授课按班级成员中的授课老师归属（没有登记授课老师时才用班级创建人），并排除已结课班级。
do $wire$
declare v_def text; v_before text; v_after text; v_sig text;
begin
  for v_sig,v_before,v_after in select * from (values
    ('public.get_school_lead_board(uuid)',
     '    select c.id,c.name,c.owner_id from public.classrooms c
      where c.owner_id =any(v_ids) and c.archived_at is null and c.trashed_at is null',
     '    select c.id,c.name,t.user_id as owner_id from public.classrooms c
      cross join lateral (select m.user_id from public.classroom_members m where m.classroom_id=c.id and m.role=''teacher''
        union select c.owner_id where not exists(select 1 from public.classroom_members m where m.classroom_id=c.id and m.role=''teacher'')) t
      where t.user_id =any(v_ids) and c.archived_at is null and c.trashed_at is null and c.operational_status<>''completed'''),
    ('public.get_school_lead_board_subject(uuid,text)',
     'or m.user_id in(select c.owner_id from public.enrollments e join public.classrooms c on c.id=e.classroom_id where e.student_id=v_student and e.status=''active'')',
     'or m.user_id in(select c.owner_id from public.enrollments e join public.classrooms c on c.id=e.classroom_id where e.student_id=v_student and e.status=''active'')
        or m.user_id in(select cm.user_id from public.enrollments e join public.classroom_members cm on cm.classroom_id=e.classroom_id and cm.role=''teacher''
          where e.student_id=v_student and e.status=''active'')')
  ) changes(sig,b,a) loop
    v_def:=pg_get_functiondef(v_sig::regprocedure);
    if position(v_before in v_def)=0 then raise exception 'LEAD_TEACHER_ANCHOR_MISSING: %',v_sig; end if;
    execute replace(v_def,v_before,v_after);
  end loop;
end $wire$;
select pg_notify('pgrst','reload schema');
