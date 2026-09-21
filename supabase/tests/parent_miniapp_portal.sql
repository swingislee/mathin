-- 此文件由本机保护脚本放入事务，所有测试行与新增 schema 均先回滚验证。
select set_config('miniapp.test.parent',(select id::text from auth.users where email='test-parent@mathin.local'),true);
select set_config('miniapp.test.outsider',(select id::text from auth.users where email='test-parent-unbound@mathin.local'),true);
select set_config('miniapp.test.admin',(select id::text from auth.users where email='test-admin@mathin.local'),true);
select set_config('miniapp.test.student',(select student_id::text from public.student_guardians where guardian_id=current_setting('miniapp.test.parent')::uuid and 'grades'=any(scope) and 'video'=any(scope) limit 1),true);
select set_config('miniapp.test.student2',(select student_id::text from public.student_guardians where guardian_id=current_setting('miniapp.test.parent')::uuid and student_id<>current_setting('miniapp.test.student')::uuid and 'grades'=any(scope) limit 1),true);
do $$begin
  if nullif(current_setting('miniapp.test.student',true),'') is null then raise exception 'FIXED_BOUND_PARENT_REQUIRED'; end if;
end $$;
insert into public.miniapp_forms(slug,title,description,privacy_notice,fields,enabled) values('portal-check','{"zh":"登记","en":"Register"}','{"zh":"说明","en":"About"}','{"zh":"隐私","en":"Privacy"}',
  '[{"id":"name","type":"text","label":{"zh":"称呼","en":"Name"},"required":true},{"id":"interest","type":"select","label":{"zh":"兴趣","en":"Interest"},"required":true,"options":[{"id":"logic","label":{"zh":"推理","en":"Reasoning"}}]}]',true);
do $$declare first_id uuid; second_id uuid;
begin
  first_id:=public.miniapp_submit_intake('16a0c671-9000-4000-8000-000000000001','portal-check',1,'{"name":"接口测试","interest":"logic"}','test');
  second_id:=public.miniapp_submit_intake('16a0c671-9000-4000-8000-000000000001','portal-check',1,'{"name":"接口测试","interest":"logic"}','test');
  if first_id<>second_id then raise exception 'INTAKE_RETRY_DUPLICATED'; end if;
  begin perform public.miniapp_submit_intake(gen_random_uuid(),'portal-check',1,'{"name":"测试","interest":"invalid"}','test');raise exception 'INVALID_OPTION_ALLOWED';exception when raise_exception then if sqlerrm<>'VALIDATION' then raise;end if;end;
  begin perform public.miniapp_submit_intake(gen_random_uuid(),'portal-check',2,'{"name":"测试","interest":"logic"}','test');raise exception 'STALE_FORM_ALLOWED';exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise;end if;end;
end $$;
insert into public.activities(id,kind,title,scheduled_at,capacity,created_by) values('16a0c671-9000-4000-8000-000000000002','lecture','事务联调活动',now()+interval '3 days',1,current_setting('miniapp.test.admin')::uuid);
insert into public.miniapp_activity_publications(activity_id,title,description,enabled) values('16a0c671-9000-4000-8000-000000000002','{"zh":"思维探索","en":"Explore"}','{"zh":"活动说明","en":"Description"}',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('miniapp.test.parent'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$declare a uuid;b uuid;
begin
  if not public.miniapp_family_ready() then raise exception 'FIXED_PARENT_NOT_READY';end if;
  a:=public.miniapp_book_activity('16a0c671-9000-4000-8000-000000000002',current_setting('miniapp.test.student')::uuid);
  b:=public.miniapp_book_activity('16a0c671-9000-4000-8000-000000000002',current_setting('miniapp.test.student')::uuid);
  if a<>b then raise exception 'BOOKING_RETRY_DUPLICATED';end if;
  begin perform public.miniapp_book_activity('16a0c671-9000-4000-8000-000000000002',current_setting('miniapp.test.student2')::uuid);raise exception 'CAPACITY_EXCEEDED';exception when raise_exception then if sqlerrm<>'ACTIVITY_FULL' then raise;end if;end;
  if not exists(select 1 from jsonb_array_elements(public.miniapp_my_bookings()) x where x->>'id'=a::text) then raise exception 'OWN_BOOKING_MISSING';end if;
  perform public.miniapp_cancel_booking(a);
  perform public.miniapp_book_activity('16a0c671-9000-4000-8000-000000000002',current_setting('miniapp.test.student')::uuid);
end $$;
reset role;
select set_config('miniapp.test.registration',(select id::text from public.activity_registrations where activity_id='16a0c671-9000-4000-8000-000000000002' and student_id=current_setting('miniapp.test.student')::uuid),true);
insert into public.assessment_reports(id,registration_id,version,payload,content_hash,created_by) values('16a0c671-9000-4000-8000-000000000005',current_setting('miniapp.test.registration')::uuid,1,'{"activityTitle":"测试报告","teacherObservation":"已确认的反馈","score":80,"totalScore":100}','miniapp-transaction-check',current_setting('miniapp.test.admin')::uuid);
insert into public.assessment_workflow_states(registration_id,stage,report_id,updated_by) values(current_setting('miniapp.test.registration')::uuid,'feedback','16a0c671-9000-4000-8000-000000000005',current_setting('miniapp.test.admin')::uuid);
set local role authenticated;
do $$begin if exists(select 1 from jsonb_array_elements(public.miniapp_assessment_reports()) x where x->>'id'='16a0c671-9000-4000-8000-000000000005') then raise exception 'DRAFT_REPORT_LEAK';end if;end $$;
reset role;
update public.assessment_workflow_states set sent_report_id=report_id,sent_at=now(),sent_by=current_setting('miniapp.test.admin')::uuid where registration_id=current_setting('miniapp.test.registration')::uuid;
set local role authenticated;
do $$begin if not exists(select 1 from jsonb_array_elements(public.miniapp_assessment_reports()) x where x->>'id'='16a0c671-9000-4000-8000-000000000005') then raise exception 'PUBLISHED_REPORT_MISSING';end if;end $$;
reset role;
select set_config('miniapp.test.assignment',(select a.id::text from public.assignments a join public.enrollments e on e.classroom_id=a.classroom_id where e.student_id=current_setting('miniapp.test.student')::uuid and e.status='active' limit 1),true);
do $$begin if nullif(current_setting('miniapp.test.assignment',true),'') is null then raise exception 'FIXED_ASSIGNMENT_REQUIRED';end if;end $$;
insert into public.miniapp_practice_uploads(id,assignment_id,student_id,owner_id,object_path,name,kind,mime_type,bytes,ready) values(
  '16a0c671-9000-4000-8000-000000000003',current_setting('miniapp.test.assignment')::uuid,current_setting('miniapp.test.student')::uuid,current_setting('miniapp.test.parent')::uuid,
  'transaction-check/only.png','测试.png','image','image/png',128,true);
insert into storage.objects(bucket_id,name) values('miniapp-practice','transaction-check/only.png');
set local role authenticated;
do $$declare a uuid;b uuid;
begin
  if not exists(select 1 from storage.objects where bucket_id='miniapp-practice' and name='transaction-check/only.png') then raise exception 'OWN_STORAGE_OBJECT_UNREADABLE';end if;
  a:=public.miniapp_submit_practice('16a0c671-9000-4000-8000-000000000004',current_setting('miniapp.test.assignment')::uuid,current_setting('miniapp.test.student')::uuid,'测试',array['16a0c671-9000-4000-8000-000000000003'::uuid]);
  b:=public.miniapp_submit_practice('16a0c671-9000-4000-8000-000000000004',current_setting('miniapp.test.assignment')::uuid,current_setting('miniapp.test.student')::uuid,'测试',array['16a0c671-9000-4000-8000-000000000003'::uuid]);
  if a<>b then raise exception 'SUBMISSION_RETRY_DUPLICATED';end if;
  begin perform public.miniapp_reserve_upload(gen_random_uuid(),current_setting('miniapp.test.assignment')::uuid,current_setting('miniapp.test.student')::uuid,'wrong/path.png','测试','image','image/png',12);raise exception 'FORGED_PATH_ALLOWED';exception when raise_exception then if sqlerrm<>'VALIDATION' then raise;end if;end;
  begin perform public.miniapp_submit_practice(gen_random_uuid(),current_setting('miniapp.test.assignment')::uuid,current_setting('miniapp.test.student')::uuid,'伪造附件',array[gen_random_uuid()]);raise exception 'FORGED_UPLOAD_ALLOWED';exception when raise_exception then if sqlerrm<>'VALIDATION' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('miniapp.test.outsider'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$begin
  if public.miniapp_my_bookings()<>'[]'::jsonb or public.miniapp_assessment_reports()<>'[]'::jsonb or public.miniapp_my_practices()<>'[]'::jsonb then raise exception 'OUTSIDER_DATA_LEAK';end if;
  if exists(select 1 from public.miniapp_practice_uploads) or exists(select 1 from public.miniapp_practice_submissions) then raise exception 'OUTSIDER_MEDIA_LEAK';end if;
  begin perform public.miniapp_book_activity('16a0c671-9000-4000-8000-000000000002',current_setting('miniapp.test.student')::uuid);raise exception 'OUTSIDER_BOOKING_ALLOWED';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
  begin perform public.miniapp_submit_practice(gen_random_uuid(),current_setting('miniapp.test.assignment')::uuid,current_setting('miniapp.test.student')::uuid,'测试',array['16a0c671-9000-4000-8000-000000000003'::uuid]);raise exception 'OUTSIDER_SUBMISSION_ALLOWED';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$begin
  if not exists(select 1 from public.miniapp_forms where slug='portal-check') then raise exception 'PUBLIC_FORM_MISSING';end if;
  begin perform * from public.miniapp_intakes;raise exception 'ANON_INTAKE_LEAK';exception when insufficient_privilege then null;end;
  begin perform public.miniapp_submit_intake(gen_random_uuid(),'portal-check',1,'{}','');raise exception 'ANON_DIRECT_WRITE_ALLOWED';exception when insufficient_privilege then null;end;
end $$;
reset role;
