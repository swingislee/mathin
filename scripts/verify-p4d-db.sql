\set ON_ERROR_STOP on
begin;

select id as admin_id from public.profiles where display_name='测试-管理员' \gset
select id as teacher_id from public.profiles where display_name='测试-教师' \gset
select id as sales_id from public.profiles where display_name='测试-学辅' \gset
select id as student_user_id from public.profiles where display_name='测试-学生' \gset
select id as parent_id from public.profiles where display_name='测试-家长' \gset
select id as student_id from public.students where user_id=:'student_user_id' \gset
select cs.id as session_id
  from public.class_sessions cs
  join public.enrollments e on e.classroom_id=cs.classroom_id and e.student_id=:'student_id'
 where cs.deleted_at is null and cs.scheduled_at<now()
 order by cs.scheduled_at limit 1 \gset

insert into public.students(name,assigned_to,created_by,bind_code,follow_up_status)
values('__P4D_AUDIT_TEMP__',:'sales_id',:'admin_id','p4daudit','pending') returning id as temp_student_id \gset
update public.students set follow_up_status='pending' where id=:'student_id';

set local role authenticated;
select set_config('request.jwt.claim.sub',:'admin_id',true);
select public.create_activity('trial_class','__P4D_AUDIT__',now()+interval '1 day',60::smallint,'audit',1::smallint,'') as activity_id \gset
select set_config('app.audit_activity_id',:'activity_id',true);
select set_config('app.audit_temp_student_id',:'temp_student_id',true);

select set_config('request.jwt.claim.sub',:'sales_id',true);
select public.book_activity(:'activity_id',:'student_id') as registration_id \gset
do $$
begin
  begin
    perform public.book_activity(current_setting('app.audit_activity_id')::uuid,current_setting('app.audit_temp_student_id')::uuid);
    raise exception 'CAPACITY_CHECK_DID_NOT_FIRE';
  exception when others then
    if sqlerrm='CAPACITY_CHECK_DID_NOT_FIRE' or position('ACTIVITY_FULL' in sqlerrm)=0 then raise; end if;
  end;
end $$;
select public.mark_activity_result(:'registration_id','attended','audit result');
reset role;
select follow_up_status as audited_follow_up_status from public.students where id=:'student_id';
select ((select follow_up_status from public.students where id=:'student_id')='trialed') as audit_ok \gset
\if :audit_ok
\else
  \echo P4D audit failed: student follow-up status was not advanced
  \quit 1
\endif
select exists(select 1 from public.student_follow_ups where student_id=:'student_id' and kind='activity') as audit_ok \gset
\if :audit_ok
\else
  \echo P4D audit failed: activity follow-up entry was not appended
  \quit 1
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub',:'teacher_id',true);
select public.save_session_reviews(:'session_id','audit summary',jsonb_build_array(jsonb_build_object('studentId',:'student_id','entryScore',80,'exitScore',90,'focus',4,'participation',5,'mastery',4,'comment','audit')));
reset role;
select exists(select 1 from public.session_reviews where session_id=:'session_id' and student_id=:'student_id' and exit_score=90) as audit_ok \gset
\if :audit_ok
\else
  \echo P4D audit failed: teacher review was not saved
  \quit 1
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub',:'student_user_id',true);
select ((select count(*) from public.get_my_session_reviews(now()-interval '1 year',now()+interval '1 day'))>0) as audit_ok \gset
\if :audit_ok
\else
  \echo P4D audit failed: student could not read own review
  \quit 1
\endif
select set_config('request.jwt.claim.sub',:'parent_id',true);
select ((select count(*) from public.get_my_session_reviews(now()-interval '1 year',now()+interval '1 day'))>0) as audit_ok \gset
\if :audit_ok
\else
  \echo P4D audit failed: parent could not read child review
  \quit 1
\endif

rollback;
\echo P4D database transaction audit passed
