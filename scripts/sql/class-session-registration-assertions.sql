-- 只操作外层事务刚创建的样例；复用固定身份，全部业务行随后回滚。
do $$
declare sid uuid:=current_setting('teaching.test.session')::uuid; other_sid uuid:=current_setting('teaching.test.other')::uuid;
  cid uuid; temporary_student uuid; membership uuid; teacher uuid:=current_setting('teaching.test.teacher')::uuid;
begin
  select classroom_id into cid from public.class_sessions where id=sid;
  insert into public.classroom_members(classroom_id,user_id,role) values(cid,teacher,'teacher') on conflict(classroom_id,user_id) do nothing;
  select e.id,e.student_id into membership,temporary_student from public.enrollments e
    join public.class_sessions s on s.classroom_id=e.classroom_id where s.id=other_sid limit 1;
  insert into public.session_student_transfers(request_id,membership_id,student_id,from_session_id,to_session_id,target_seat,created_by)
    values(gen_random_uuid(),membership,temporary_student,other_sid,sid,2,teacher);
  perform set_config('teaching.test.temporary',temporary_student::text,true);
  perform set_config('teaching.test.original',(select student_id::text from public.enrollments where classroom_id=cid limit 1),true);
end;
$$;
set local role authenticated;
do $$
declare sid uuid:=current_setting('teaching.test.session')::uuid; teacher uuid:=current_setting('teaching.test.teacher')::uuid;
  temporary_student uuid:=current_setting('teaching.test.temporary')::uuid; result jsonb;
begin
  perform set_config('request.jwt.claim.sub',teacher::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated','aal','aal2')::text,true);
  result:=public.get_teaching_session_records(sid,1);
  if jsonb_array_length(result->'students')<>2 then raise exception 'TEMPORARY_ROSTER_MISSING'; end if;
  perform public.save_session_reviews_v2(sid,jsonb_build_array(jsonb_build_object('studentId',temporary_student,'comment','Temporary feedback')));
  if not exists(select 1 from public.session_reviews where session_id=sid and student_id=temporary_student and comment='Temporary feedback') then raise exception 'TEMPORARY_REVIEW_MISSING'; end if;
  perform public.freeze_session_roster(sid);
end;
$$;
reset role;
do $$
declare sid uuid:=current_setting('teaching.test.session')::uuid; cid uuid; new_student uuid:=gen_random_uuid();
begin
  select classroom_id into cid from public.class_sessions where id=sid;
  update public.enrollments set status='withdrawn',left_at=clock_timestamp()
    where classroom_id=cid and student_id=current_setting('teaching.test.original')::uuid;
  insert into public.students(id,name,bind_code) values(new_student,'Joined after lesson',gen_random_uuid()::text);
  insert into public.enrollments(classroom_id,student_id,status,joined_at) values(cid,new_student,'active',now());
  perform set_config('teaching.test.new',new_student::text,true);
end;
$$;
set local role authenticated;
do $$
declare sid uuid:=current_setting('teaching.test.session')::uuid; original_student uuid:=current_setting('teaching.test.original')::uuid;
  new_student uuid:=current_setting('teaching.test.new')::uuid; result jsonb;
begin
  result:=public.get_teaching_session_records(sid,1);
  if jsonb_array_length(result->'students')<>2 or exists(select 1 from jsonb_array_elements(result->'students') row where row->>'id'=new_student::text) then raise exception 'CURRENT_ROSTER_REPLACED_HISTORY'; end if;
  perform public.save_session_reviews_v2(sid,jsonb_build_array(jsonb_build_object('studentId',original_student,'comment','Historical feedback')));
  begin
    perform public.save_session_reviews_v2(sid,jsonb_build_array(jsonb_build_object('studentId',new_student,'comment','Wrong lesson')));
    raise exception 'CURRENT_ONLY_STUDENT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'STUDENT_NOT_IN_CLASS' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.outsider'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('teaching.test.outsider'),'role','authenticated')::text,true);
  begin
    perform public.save_session_reviews_v2(sid,jsonb_build_array(jsonb_build_object('studentId',original_student,'comment','Unauthorized')));
    raise exception 'OUTSIDER_WRITE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
end;
$$;
reset role;
