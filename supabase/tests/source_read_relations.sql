\set ON_ERROR_STOP on
-- Run only against an identified isolated development database. Reuse existing
-- development roles; every source, student and business fixture rolls back.
begin;
set local role postgres;

create function pg_temp.assert_source_read(ok boolean,message text)
returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message;end if;end;
$$;

do $fixture$
declare
  actor uuid; outsider uuid; scoped_staff uuid;
  student_a uuid:=gen_random_uuid(); student_b uuid:=gen_random_uuid();
  lead_a uuid:=gen_random_uuid(); lead_b uuid:=gen_random_uuid();
  activity_id uuid:=gen_random_uuid(); registration_id uuid:=gen_random_uuid(); assessment_id uuid:=gen_random_uuid();
  batch_id uuid:=gen_random_uuid();
  table_key text:='source-read-'||gen_random_uuid();
  old_id text:='source-read-old-'||gen_random_uuid(); new_id text:='source-read-new-'||gen_random_uuid();
  single_facts jsonb; batch_facts jsonb;
begin
  select id into actor from public.profiles where role='admin' and is_active order by created_at,id limit 1;
  select id into outsider from public.profiles where role in ('parent','student') and is_active order by created_at,id limit 1;
  select id into scoped_staff from public.profiles where role='staff' and is_active
    and public.has_perm(id,'followup.view') and not public.has_perm(id,'student.view.all') order by created_at,id limit 1;
  if actor is null or outsider is null or scoped_staff is null then raise exception 'DEVELOPMENT_ADMIN_SCOPED_STAFF_AND_OUTSIDER_REQUIRED';end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  insert into public.students(id,name,bind_code,purpose,assigned_to)
  values(student_a,'Source read fixture A',upper(left(replace(student_a::text,'-',''),8)),'test',actor),
    (student_b,'Source read fixture B',upper(left(replace(student_b::text,'-',''),8)),'test',actor);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,owner_id,created_by,purpose)
  values(lead_a,'Source read fixture A',lead_a::text,'000000','000000',actor,actor,'test'),
    (lead_b,'Source read fixture B',lead_b::text,'000000','000000',actor,actor,'test');
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,
    source_data,record_data,match_status,match_data,entity_data,lead_id,search_text,imported_at)
  values(old_id,repeat('a',64),table_key,'row-1',repeat('a',64),
    '{"format":"feishu-base","filename":"2026-10-01-fixture.json"}',
    jsonb_build_object('tableId',table_key,'sourceRecordId','row-1','cells','[]'::jsonb),'matched','{}','{}',lead_a,'source read fixture',now()),
    (new_id,repeat('b',64),table_key,'row-1',repeat('b',64),
    '{"format":"feishu-base","filename":"2026-10-02-fixture.json"}',
    jsonb_build_object('tableId',table_key,'sourceRecordId','row-1','cells','[]'::jsonb),'unmatched','{}',null,null,'source read fixture',now());
  insert into public.school_source_status_evidence(source_record_id,payload_sha256,facts)
  values(old_id,repeat('a',64),'[{"type":"wechat","value":"no","priority":100,"certainty":"confirmed"}]'),
    (new_id,repeat('b',64),'[{"type":"wechat","value":"yes","priority":100,"certainty":"confirmed"},{"type":"assessment","value":"complete","priority":140,"certainty":"confirmed"}]');

  perform pg_temp.assert_source_read(
    (select count(*)=2 and bool_and(source_id=new_id) from public.school_source_status_facts_for_subject('lead:'||lead_a)),
    'LATEST_VERSION_MUST_INHERIT_EXISTING_IDENTITY');
  perform pg_temp.assert_source_read(
    exists(select 1 from public.school_source_completed_assessments() where key='lead:'||lead_a),
    'CURRENT_CONFIRMED_ASSESSMENT_MISSING');

  -- The generated version key changes in the same write as the source JSON.
  update public.history_import_records set source_data=jsonb_set(source_data,'{filename}','"2026-10-03-fixture.json"') where id=old_id;
  perform pg_temp.assert_source_read(
    (select source_snapshot_date='2026-10-03' from public.history_import_records where id=old_id)
      and (select count(*)=1 and bool_and(source_id=old_id) from public.school_source_status_facts_for_subject('lead:'||lead_a)),
    'SOURCE_DATE_UPDATE_DID_NOT_CHANGE_CURRENT_VERSION');
  perform pg_temp.assert_source_read(
    not exists(select 1 from public.school_source_completed_assessments() where key='lead:'||lead_a),
    'OLDER_ASSESSMENT_WAS_REINTRODUCED');
  update public.history_import_records set source_data=jsonb_set(source_data,'{filename}','"2026-10-01-fixture.json"') where id=old_id;
  update public.history_import_records set payload_sha256=repeat('c',64) where id=new_id;
  perform pg_temp.assert_source_read(
    not exists(select 1 from public.school_source_status_facts_for_subject('lead:'||lead_a)),
    'STALE_PAYLOAD_EVIDENCE_WAS_READ');
  update public.school_source_status_evidence set payload_sha256=repeat('c',64) where source_record_id=new_id;
  perform pg_temp.assert_source_read(
    (select count(*)=2 from public.school_source_status_facts_for_subject('lead:'||lead_a)),
    'REFRESHED_PAYLOAD_EVIDENCE_NOT_VISIBLE');

  -- Formal lead conversion remains live; there is no stale per-person cache.
  update public.leads set student_id=student_a,identity_confirmed_by=actor,identity_confirmed_at=now(),status='converted' where id=lead_a;
  perform pg_temp.assert_source_read(
    not exists(select 1 from public.school_source_status_facts_for_subject('lead:'||lead_a))
      and (select count(*)=2 from public.school_source_status_facts_for_subject('student:'||student_a)),
    'LEAD_CONVERSION_DID_NOT_MOVE_SOURCE_IDENTITY');
  update public.leads set source_record_id=new_id where id=lead_b;
  perform pg_temp.assert_source_read(
    not exists(select 1 from public.school_source_status_subjects where source_id=new_id),
    'CONFLICTING_UNCONFIRMED_IDENTITIES_WERE_MERGED');
  insert into public.history_import_associations(record_id,student_id,version,context,confirmed_by,match_state)
  values(new_id,student_a,1,'assessment',actor,'confirmed');
  perform pg_temp.assert_source_read(
    (select count(*)=2 from public.school_source_status_facts_for_subject('student:'||student_a)),
    'HUMAN_CONFIRMED_IDENTITY_DID_NOT_TAKE_PRIORITY');
  insert into public.history_import_associations(record_id,student_id,version,context,confirmed_by,match_state)
  values(old_id,student_b,1,'assessment',actor,'confirmed');
  perform pg_temp.assert_source_read(
    not exists(select 1 from public.school_source_status_subjects where source_id=new_id),
    'CONFLICTING_HUMAN_CONFIRMATIONS_WERE_MERGED');
  delete from public.history_import_associations where record_id=old_id;

  insert into public.activities(id,kind,title,scheduled_at,created_by)
    values(activity_id,'assessment_1v1','Source read fixture',now(),actor);
  insert into public.activity_registrations(id,activity_id,lead_id,status,operated_by,assessment_started_at,assessment_completed_at)
    values(registration_id,activity_id,lead_a,'attended',actor,now()-interval '30 minutes',now());
  -- Source-backed records use the existing privileged import boundary.
  perform set_config('request.jwt.claims','{}',true);
  insert into public.history_import_batches(id,batch_key,payload_sha256,manifest)
    values(batch_id,table_key,repeat('a',64),'{}');
  insert into public.assessment_results(id,activity_registration_id,student_id,overall_level,score,assessment_band,
    result_source,result_finalized_at,source_record_id,history_revision,history_key,history_batch_id,
    source_payload_sha256,source_field_ids,history_imported_at)
    values(assessment_id,registration_id,student_a,'on_track',55,'a','teacher',now(),old_id,1,old_id,batch_id,
      repeat('a',64),array['fixture'],now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.assert_source_read(
    exists(select 1 from public.school_source_status_facts_for_subject('student:'||student_a)
      where fact->>'type'='assessment' and fact->>'certainty'='review' and fact->>'priority'='20')
      and not exists(select 1 from public.school_source_completed_assessments() where key='student:'||student_a),
    'HUMAN_REVISION_ON_OLD_SOURCE_VERSION_WAS_IGNORED');

  select jsonb_agg(f order by f::text) into single_facts
    from jsonb_array_elements(public.school_record_status_evidence(student_a,lead_a)) f;
  select jsonb_agg(f order by f::text) into batch_facts
    from public.school_record_status_evidence_batch(jsonb_build_array(jsonb_build_object('key','student:'||student_a,'student_id',student_a,'lead_id',lead_a))) b
    cross join lateral jsonb_array_elements(b.facts) f;
  perform pg_temp.assert_source_read(single_facts=batch_facts,'BATCH_AND_SINGLE_EVIDENCE_DIFFER');
  perform pg_temp.assert_source_read(
    (select count(*)=1 from jsonb_array_elements(batch_facts) f where f->>'recordId'=assessment_id::text and f->>'type'='assessment'),
    'MULTIPLE_ASSESSMENT_LINKS_DUPLICATED_A_FACT');
  update public.assessment_results set history_revision=0 where id=assessment_id;
  perform pg_temp.assert_source_read(
    exists(select 1 from public.school_source_completed_assessments() where key='student:'||student_a),
    'REVISION_CHANGE_NOT_VISIBLE_IMMEDIATELY');

  perform set_config('test.source_read.student',student_a::text,true);
  perform set_config('test.source_read.lead',lead_a::text,true);
  perform set_config('test.source_read.outsider',outsider::text,true);
  perform set_config('test.source_read.scoped_staff',scoped_staff::text,true);
end
$fixture$;

set local role authenticated;
do $permissions$
declare relation text; denied boolean;
begin
  foreach relation in array array['school_source_current_records','school_source_subject_links','school_source_current_subjects','school_source_status_subjects'] loop
    denied:=false;
    begin execute format('select 1 from public.%I limit 1',relation);
    exception when insufficient_privilege then denied:=true;end;
    perform pg_temp.assert_source_read(denied,'SOURCE_VIEW_IS_PUBLIC: '||relation);
  end loop;
  denied:=false;
  begin perform public.school_source_status_facts_for_subject('student:'||current_setting('test.source_read.student'));
  exception when insufficient_privilege then denied:=true;end;
  perform pg_temp.assert_source_read(denied,'SOURCE_HELPER_IS_PUBLIC');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.source_read.scoped_staff'),'role','authenticated','aal','aal2')::text,true);
  denied:=false;
  begin perform public.school_record_status_evidence(current_setting('test.source_read.student')::uuid,current_setting('test.source_read.lead')::uuid);
  exception when others then if sqlerrm<>'FORBIDDEN_SCOPE' then raise;end if;denied:=true;end;
  perform pg_temp.assert_source_read(denied,'STAFF_READ_ANOTHER_OWNER_SOURCE');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.source_read.outsider'),'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.assert_source_read(
    public.school_record_status_evidence(current_setting('test.source_read.student')::uuid,current_setting('test.source_read.lead')::uuid)='[]'::jsonb,
    'OUTSIDER_READ_SOURCE_EVIDENCE');
  denied:=false;
  begin perform public.school_communication_page(p_scope=>'all',p_page_size=>20);
  exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;denied:=true;end;
  perform pg_temp.assert_source_read(denied,'OUTSIDER_READ_COMMUNICATION_PAGE');
end
$permissions$;
reset role;

rollback;
