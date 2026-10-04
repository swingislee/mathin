-- 本文件由本机目标守卫在事务中执行，复用固定开发身份，全部夹具随事务回滚。
insert into public.classroom_members(classroom_id,user_id,role) select classroom_id,current_setting('teaching.test.teacher')::uuid,'teacher' from public.class_sessions where id=current_setting('teaching.test.session')::uuid on conflict do nothing;
update public.class_sessions set started_at=now()-interval '2 hours',ended_at=now()-interval '1 hour',postwork_completed_at=now() where id=current_setting('teaching.test.session')::uuid;
set local role authenticated;
do $$
declare sid uuid:=current_setting('teaching.test.session')::uuid; original jsonb; saved jsonb; reviews jsonb; checks jsonb; added uuid:=gen_random_uuid();
begin
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.teacher'),true);
  original:=public.get_session_learning_edit(sid);
  checks:=(original->'checks')||jsonb_build_array(jsonb_build_object('id',added,'title','补录检查点'));
  reviews:=jsonb_build_array((original#>'{reviews,0}')||jsonb_build_object('comment','课后修订','focus',5));
  saved:=public.save_session_learning_edit(sid,original->>'revision',checks,
    jsonb_build_array(jsonb_build_object('checkId',original#>>'{checks,0,id}','studentId',original#>>'{students,0,id}','status','independent')),reviews);
  if saved#>>'{reviews,0,comment}'<>'课后修订' or jsonb_array_length(saved->'checks')<>2
    or saved#>>'{checks,0,id}'<>original#>>'{checks,0,id}' then raise exception 'AMENDMENT_LOST_RECORDS'; end if;
  if not exists(select 1 from public.session_learning_amendments where session_id=sid and before_value=original and after_value=saved) then raise exception 'MISSING_HISTORY'; end if;
  begin perform public.save_session_learning_edit(sid,original->>'revision',checks,'[]','[]'); raise exception 'STALE_WRITE_ALLOWED';
    exception when others then if sqlerrm<>'CONFLICT' then raise; end if; end;
  begin perform public.save_session_learning_edit(sid,saved->>'revision','[]','[]','[]'); raise exception 'CHECK_REMOVAL_ALLOWED';
    exception when others then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin perform public.save_session_learning_edit(sid,saved->>'revision',saved->'checks',jsonb_build_array(jsonb_build_object('checkId',added,'studentId',gen_random_uuid(),'status','explained')),'[]'); raise exception 'OUTSIDER_WRITE_ALLOWED';
    exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.outsider'),true);
  begin perform public.get_session_learning_edit(sid); raise exception 'OUTSIDER_READ_ALLOWED';
    exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  if exists(select 1 from public.session_learning_amendments where session_id=sid) then raise exception 'AUDIT_RLS_LEAK'; end if;
end $$;
reset role;
