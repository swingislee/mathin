-- Intended for one rollback transaction in the identified development database.
create function pg_temp.expect_experience_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
create function pg_temp.experience_fixture() returns jsonb language sql as $fixture$
select '{"version":1,"homePageId":"public-page","pages":[
{"id":"public-page","version":1,"title":{"zh":"公开页面","en":"Public"},"description":{"zh":"","en":""},"purpose":"page","audience":"all","enabled":true,"layout":"reading","blocks":[{"id":"text","version":1,"kind":"paragraph","visible":true,"text":{"zh":"Published public text","en":""},"binding":"","tone":"neutral"}]},
{"id":"private-page","version":1,"title":{"zh":"授权内容","en":"Protected"},"description":{"zh":"","en":""},"purpose":"report","audience":"participants","enabled":true,"layout":"reading","blocks":[{"id":"text","version":1,"kind":"paragraph","visible":true,"text":{"zh":"PROTECTED_FIXTURE_BODY","en":""},"binding":"","tone":"neutral"}]}],
"forms":[{"id":"request-form","version":1,"title":{"zh":"意向资料","en":"Intake"},"introduction":{"zh":"","en":""},"submitLabel":{"zh":"提交","en":"Submit"},"successMessage":{"zh":"收到","en":"Received"},"audience":"signedIn","enabled":true,"purpose":"request","groups":[{"id":"details","title":{"zh":"资料","en":"Details"},"description":{"zh":"","en":""},"repeat":false,"minEntries":1,"maxEntries":1,"fields":[{"id":"name","type":"text","label":{"zh":"名称","en":"Name"},"help":{"zh":"","en":""},"placeholder":{"zh":"","en":""},"required":true,"options":[]},{"id":"choice","type":"select","label":{"zh":"选择","en":"Choice"},"help":{"zh":"","en":""},"placeholder":{"zh":"","en":""},"required":true,"options":[{"id":"yes","label":{"zh":"是","en":"Yes"}},{"id":"no","label":{"zh":"否","en":"No"}}]},{"id":"note","type":"textarea","label":{"zh":"说明","en":"Note"},"help":{"zh":"","en":""},"placeholder":{"zh":"","en":""},"required":true,"options":[],"visibleWhen":{"fieldId":"choice","operator":"equals","value":"yes"}}]}]}],
"services":[{"id":"fixture-request","name":{"zh":"服务意向","en":"Service request"},"summary":{"zh":"","en":""},"image":"","enabled":true,"categoryId":"","audienceTags":[],"durationMinutes":0,"detailPageId":"public-page","flowId":"request-flow","resourceIds":[],"binding":{"adapter":"request","target":"","connectionId":""},"price":{"mode":"free","amountMinor":0,"currency":"CNY","note":{"zh":"","en":""}}}],
"flows":[{"id":"request-flow","name":{"zh":"申请流程","en":"Request flow"},"mode":"request","formId":"request-form","preparationPageId":"","confirmationPageId":"public-page","requireParticipant":true,"allowMultipleParticipants":false,"policyId":"","consentDocumentIds":[],"completionAction":{"kind":"none","target":"","label":{"zh":"","en":""}}}],
"destinations":[],"dictionaries":[],"resources":[],"policies":[],"connections":[],"reportBindings":[{"kind":"assessment","pageId":"private-page","serviceId":"","enabled":true}],
"notifications":[{"id":"receipt","name":{"zh":"收到申请","en":"Receipt"},"event":"request.created","channel":"inApp","enabled":true,"connectionId":"","templateKey":"","serviceIds":[],"offsetMinutes":0,"title":{"zh":"申请已收到","en":"Request received"},"body":{"zh":"{{service}}","en":"{{service}}"}}]}'::jsonb;
$fixture$;
do $check$
#variable_conflict use_variable
declare actor uuid; parent_id uuid; outsider uuid; student uuid:=gen_random_uuid(); another uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
  activity uuid:=gen_random_uuid(); registration uuid:=gen_random_uuid(); report_id uuid:=gen_random_uuid();
  config jsonb; experience jsonb:=pg_temp.experience_fixture(); revision integer; answer jsonb:='{"details":[{"name":"Synthetic fixture","choice":"no"}]}';
  receipt jsonb; original jsonb; docs jsonb; remote_id uuid:=gen_random_uuid(); remote_snapshot jsonb; remote_result jsonb; notice_id uuid:=gen_random_uuid();
begin
  select id into actor from profiles where purpose='test' and id=(select id from auth.users where email='test-admin@mathin.local');
  select id into parent_id from profiles where purpose='test' and id=(select id from auth.users where email='test-parent@mathin.local');
  select id into outsider from profiles where purpose='test' and id=(select id from auth.users where email='test-parent-unbound@mathin.local');
  if actor is null or parent_id is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  config:=public.miniapp_settings_workbench()->'draft'; revision:=(public.miniapp_settings_workbench()->>'revision')::integer;
  if config is null or config='null' then
    config:=jsonb_build_object('version',1,'brand',jsonb_build_object('name',jsonb_build_object('zh','Fixture','en','Fixture'),'introduction',jsonb_build_object('zh','','en',''),'image','','theme','paper'),
      'home','[]'::jsonb,'floating','[]'::jsonb,'accountGroups','[]'::jsonb,'stages',jsonb_build_array(jsonb_build_object('id','all','label',jsonb_build_object('zh','阶段','en','Stages'),
      'stages',(select jsonb_agg(jsonb_build_object('id',case when n<1 then 'k'||(n+3)::text else 'g'||n::text end,'stageNumber',n,'label',jsonb_build_object('zh',n::text,'en',n::text),'visible',true)) from generate_series(-1,12) n))));
  end if;
  config:=config||jsonb_build_object('experience',experience);
  if not mathin_internal.valid_miniapp_settings(config) then raise exception 'FIXTURE_SCHEMA_INVALID base=% experience-fields=%',mathin_internal.valid_miniapp_settings_before_experience(config-'experience'),
    (select jsonb_agg(key) from jsonb_each(experience) where not mathin_internal.experience_schema_valid(value,mathin_internal.miniapp_experience_schema()->'properties'->key)); end if;
  if mathin_internal.valid_miniapp_settings(jsonb_set(config,'{experience,pages,0,blocks,0,script}','"alert(1)"')) then raise exception 'EXECUTABLE_PROPERTY_ACCEPTED'; end if;
  if mathin_internal.valid_miniapp_settings(jsonb_set(config,'{experience,forms,0,groups,0,fields,0,id}','"__proto__"')) then raise exception 'RESERVED_FIELD_ACCEPTED'; end if;
  original:=public.miniapp_settings_publication();
  perform public.save_miniapp_settings(config,revision,false);
  if public.miniapp_settings_publication()<>original then raise exception 'DRAFT_VISIBLE'; end if;
  perform public.save_miniapp_settings(config,revision+1,true); revision:=revision+2;
  if public.miniapp_settings_publication()::text like '%PROTECTED_FIXTURE_BODY%' then raise exception 'PROTECTED_CONTENT_IN_MANIFEST'; end if;
  insert into students(id,name,bind_code,created_by,assigned_to) values(student,'Experience synthetic fixture',student::text,actor,actor),(another,'Unrelated synthetic fixture',another::text,actor,actor);
  insert into student_guardians(student_id,guardian_id,relation,scope,is_primary) values(student,parent_id,'监护人',array['grades','activities'],true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  docs:=public.miniapp_consent_documents(); perform public.miniapp_accept_consent_documents(docs->>'privacyVersion',docs->>'childrenPrivacyVersion');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  config:=jsonb_set(config,'{experience,notifications}',(config#>'{experience,notifications}')||jsonb_build_array((config#>'{experience,notifications,0}')||'{"id":"report-notice","event":"report.published"}'));
  perform public.save_miniapp_settings(config,revision,true); revision:=revision+1;
  -- New report documents are frozen, and the wrapper keeps the independent validity result.
  insert into activities(id,kind,title,scheduled_at,capacity,created_by) values(activity,'lecture','Experience fixture',now(),20,actor);
  insert into activity_registrations(id,activity_id,student_id,operated_by) values(registration,activity,student,actor);
  insert into assessment_reports(id,registration_id,version,payload,content_hash,created_by) values(report_id,registration,1,'{"activityTitle":"Fixture","teacherObservation":"Observation","assessedAt":"2026-10-01","score":0,"totalScore":10}',report_id::text,actor);
  insert into assessment_workflow_states(registration_id,stage,report_id,sent_report_id,sent_at,sent_by,updated_by) values(registration,'feedback',report_id,report_id,now(),actor,actor);
  if (select count(*) from miniapp_notification_outbox where source_id=report_id and owner_id=parent_id)<>1 then raise exception 'REPORT_NOTIFICATION_MISSING'; end if;
  perform set_config('request.jwt.claims','{}',true);
  perform public.miniapp_experience_document('page','public-page');
  perform pg_temp.expect_experience_error('select public.miniapp_experience_document(''page'',''private-page'')','FORBIDDEN');
  perform pg_temp.expect_experience_error('select public.miniapp_experience_document(''form'',''request-form'')','FORBIDDEN');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  docs:=public.miniapp_consent_documents(); perform public.miniapp_accept_consent_documents(docs->>'privacyVersion',docs->>'childrenPrivacyVersion');
  perform public.miniapp_experience_document('page','private-page');
  update student_guardians set scope=array['activities'] where student_id=student and guardian_id=parent_id;
  if exists(select 1 from jsonb_array_elements(public.miniapp_notifications()) n join miniapp_notification_outbox o on o.id=(n->>'id')::uuid where o.source_id=report_id) then raise exception 'REVOKED_REPORT_PERMISSION_NOTIFICATION'; end if;
  if public.miniapp_can_participate(student,'grades') or not public.miniapp_can_participate(student,'activities') then raise exception 'PARTICIPATION_SCOPE_FIXTURE'; end if;
  perform public.miniapp_assert_experience_participants(array[student]);
  perform public.miniapp_submit_experience_request(gen_random_uuid(),'fixture-request','request-form',revision,answer,array[student],'{}');
  if exists(select 1 from jsonb_array_elements(public.miniapp_assessment_reports()) r where r->>'id'=report_id::text) then raise exception 'SERVICE_SCOPE_GRANTED_REPORT_ACCESS'; end if;
  perform pg_temp.expect_experience_error(format('select public.miniapp_assert_experience_participants(array[%L]::uuid[])',another),'FORBIDDEN');
  perform pg_temp.expect_experience_error(format('select public.miniapp_assert_experience_participants(array[%L,%L]::uuid[])',student,student),'FORBIDDEN');
  update student_guardians set scope=array['finance'] where student_id=student and guardian_id=parent_id;
  perform pg_temp.expect_experience_error(format('select public.miniapp_assert_experience_participants(array[%L]::uuid[])',student),'FORBIDDEN');
  perform pg_temp.expect_experience_error(format('select public.miniapp_submit_experience_request(%L,''fixture-request'',''request-form'',%s,%L,array[%L]::uuid[],''{}'')',gen_random_uuid(),revision,answer,student),'FORBIDDEN');
  update student_guardians set scope=array['grades'] where student_id=student and guardian_id=parent_id;
  perform public.miniapp_assert_experience_participants(array[student]);
  perform pg_temp.expect_experience_error(format('select public.miniapp_submit_experience_request(%L,''fixture-request'',''request-form'',%s,%L,array[%L]::uuid[],''{}'')',gen_random_uuid(),revision,answer,another),'FORBIDDEN');
  perform pg_temp.expect_experience_error(format('select public.miniapp_submit_experience_request(%L,''fixture-request'',''request-form'',%s,%L,array[%L]::uuid[],''{}'')',gen_random_uuid(),revision,'{"details":[{"choice":"no"}]}',student),'VALIDATION');
  perform pg_temp.expect_experience_error(format('select public.miniapp_submit_experience_request(%L,''fixture-request'',''request-form'',%s,%L,array[%L]::uuid[],''{}'')',gen_random_uuid(),revision,'{"details":[{"name":"Fixture","choice":"no","note":"HIDDEN"}]}',student),'VALIDATION');
  perform pg_temp.expect_experience_error(format('select public.miniapp_submit_experience_request(%L,''fixture-request'',''request-form'',%s,%L,array[%L]::uuid[],''{}'')',gen_random_uuid(),revision,'{"details":[{"name":"Fixture","choice":"yes"}]}',student),'VALIDATION');
  receipt:=public.miniapp_submit_experience_request(request_id,'fixture-request','request-form',revision,answer,array[student],'{}');
  if public.miniapp_submit_experience_request(request_id,'fixture-request','request-form',revision,answer,array[student],'{}')<>receipt then raise exception 'RETRY_NOT_IDEMPOTENT'; end if;
  if (select count(*) from miniapp_experience_events e where e.request_id=request_id)<>1 then raise exception 'DUPLICATE_EVENT'; end if;
  if (select count(*) from miniapp_notification_outbox where source_id=request_id)<>1 then raise exception 'DUPLICATE_NOTIFICATION'; end if;
  if not exists(select 1 from jsonb_array_elements(public.miniapp_notifications()) r where r->>'serviceId'='fixture-request') then raise exception 'NOTIFICATION_MISSING'; end if;
  remote_snapshot:=jsonb_build_object('actor','fixture-actor','service',jsonb_build_object('name',jsonb_build_object('zh','Fixture','en','Fixture')),'command',jsonb_build_object('participantIds',jsonb_build_array(student)));
  perform public.miniapp_remote_booking_reserve(remote_id,parent_id,'remote-fixture','fixture-hash',remote_snapshot,2);
  perform pg_temp.expect_experience_error(format('select public.miniapp_remote_booking_reserve(%L,%L,''remote-fixture'',''other-hash'',%L,2)',remote_id,parent_id,remote_snapshot),'CONFLICT');
  remote_result:=jsonb_build_object('id','fixture-provider-booking','actor','fixture-actor','version',1,'status','confirmed','startsAt',now()+interval '3 days');
  perform public.miniapp_remote_booking_store(remote_id,parent_id,remote_result);
  perform public.miniapp_remote_booking_store(remote_id,parent_id,remote_result||'{"version":2,"status":"cancelled"}'::jsonb);
  perform public.miniapp_remote_booking_store(remote_id,parent_id,remote_result);
  if (select result->>'status' from miniapp_remote_bookings where id=remote_id)<>'cancelled' then raise exception 'STALE_PROVIDER_OVERWROTE_CANCELLATION'; end if;
  perform pg_temp.expect_experience_error(format('select public.miniapp_remote_booking_store(%L,%L,%L)',remote_id,parent_id,remote_result||'{"actor":"wrong-actor","version":3}'::jsonb),'CONFLICT');
  original:=receipt->'form';
  if not exists(select 1 from jsonb_array_elements(public.miniapp_assessment_reports()) r where r->>'id'=report_id::text and r ? 'referenceValidity' and r->'contentDocument' is not null) then raise exception 'REPORT_PROJECTION_LOST'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated','aal','aal1')::text,true);
  perform public.miniapp_accept_consent_documents(docs->>'privacyVersion',docs->>'childrenPrivacyVersion');
  if exists(select 1 from jsonb_array_elements(public.miniapp_experience_requests()) r where r->>'id'=request_id::text) then raise exception 'OTHER_OWNER_READ'; end if;
  if exists(select 1 from jsonb_array_elements(public.miniapp_remote_bookings_read()) r where r->>'id'=remote_id::text)
    or exists(select 1 from jsonb_array_elements(public.miniapp_notifications()) r where r->>'serviceId'='fixture-request') then raise exception 'OTHER_OWNER_BOOKING_OR_NOTIFICATION'; end if;
  perform pg_temp.expect_experience_error(format('select public.miniapp_update_experience_request(%L,1,''cancelled'','''')',request_id),'NOT_FOUND');
  perform pg_temp.expect_experience_error(format('select public.miniapp_submit_experience_request(%L,''fixture-request'',''request-form'',%s,%L,array[%L]::uuid[],''{}'')',request_id,revision,answer,student),'CONFLICT');
  perform pg_temp.expect_experience_error(format('insert into public.miniapp_experience_requests(id,owner_id,service_id,form_id,publication_revision,participant_ids,form_snapshot,answers,confirmation_snapshot,request_hash) values(%L,%L,'''',''request-form'',%s,''{}'',%L,%L,%L,''fixture-confirmation'')',
    gen_random_uuid(),outsider,revision,experience#>'{forms,0}',answer,experience#>'{pages,1}'),'FORBIDDEN');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  config:=jsonb_set(jsonb_set(config,'{experience,forms,0,title,zh}','"New form version"'),'{experience,pages,1,blocks,0,text,zh}','"NEW_REPORT_TEMPLATE"');
  perform public.save_miniapp_settings(config,revision,true);
  if (select miniapp_report_document#>>'{blocks,0,text,zh}' from assessment_reports where id=report_id)<>'PROTECTED_FIXTURE_BODY' then raise exception 'FROZEN_REPORT_REWRITTEN'; end if;
  perform public.miniapp_update_experience_request(request_id,1,'confirmed','A response visible only to the requester');
  perform pg_temp.expect_experience_error(format('select public.miniapp_update_experience_request(%L,1,''declined'','''')',request_id),'FORM_CHANGED');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  receipt:=public.miniapp_submit_experience_request(request_id,'fixture-request','request-form',revision,answer,array[student],'{}');
  if receipt->'form'<>original or receipt->>'status'<>'confirmed' then raise exception 'HISTORICAL_REQUEST_CHANGED'; end if;
  perform pg_temp.expect_experience_error(format('select public.miniapp_submit_experience_request(%L,''fixture-request'',''request-form'',%s,%L,array[%L]::uuid[],''{}'')',gen_random_uuid(),revision,answer,student),'FORM_CHANGED');
  perform public.miniapp_update_experience_request(request_id,2,'cancelled','');
  perform pg_temp.expect_experience_error(format('select public.miniapp_update_experience_request(%L,3,''confirmed'','''')',request_id),'FORBIDDEN');
  insert into miniapp_notification_outbox(id,owner_id,source_key,source_id,rule_id,event,service_id,connection_id,channel,template_key,title,body,data,due_at,status)
    values(notice_id,parent_id,'fixture-outbox',remote_id,'fixture-delivery','booking.created','remote-fixture','fixture-connection','email','','{}','{}','{}',now(),'queued');
  if not exists(select 1 from jsonb_array_elements(public.miniapp_notification_claim()) n where n->>'id'=notice_id::text and n->>'attempts'='1') then raise exception 'OUTBOX_CLAIM'; end if;
  if exists(select 1 from jsonb_array_elements(public.miniapp_notification_claim()) n where n->>'id'=notice_id::text) then raise exception 'OUTBOX_LEASE_DUPLICATE'; end if;
  perform public.miniapp_notification_ack(notice_id,2,true);
  if (select status from miniapp_notification_outbox where id=notice_id)<>'dispatching' then raise exception 'OUTBOX_STALE_ACK'; end if;
  perform public.miniapp_notification_ack(notice_id,1,false);
  if not exists(select 1 from miniapp_notification_outbox where id=notice_id and status='queued' and due_at>now()) then raise exception 'OUTBOX_BACKOFF'; end if;
  update miniapp_notification_outbox set status='dispatching',attempts=8,lease_until=now()-interval '1 minute' where id=notice_id;
  perform public.miniapp_notification_claim();
  if (select status from miniapp_notification_outbox where id=notice_id)<>'failed' then raise exception 'OUTBOX_EXHAUSTED_LEASE'; end if;
  if has_table_privilege('authenticated','miniapp_experience_requests','SELECT') or has_table_privilege('authenticated','miniapp_remote_bookings','INSERT')
    or has_function_privilege('authenticated','public.miniapp_remote_booking_store(uuid,uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.miniapp_submit_experience_request(uuid,text,text,integer,jsonb,uuid[],jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.miniapp_notification_claim()','EXECUTE') then raise exception 'EXPERIENCE_ACL'; end if;
end $check$;
