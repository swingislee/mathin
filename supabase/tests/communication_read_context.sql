\set ON_ERROR_STOP on
-- Use an identified development database. All fixtures and helper functions roll back.
begin;
set local role postgres;

create function pg_temp.assert_read_context(ok boolean,message text)
returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message;end if;end;
$$;

create function pg_temp.normalize_record_evidence(record jsonb)
returns jsonb language sql as $$
  select jsonb_set(record,'{statusEvidence}',coalesce((select jsonb_agg(f order by f::text)
    from jsonb_array_elements(record->'statusEvidence') f),'[]'::jsonb));
$$;

create function pg_temp.assert_record_context(student_id uuid,lead_id uuid,assessment_complete boolean)
returns void language plpgsql as $$
declare context record; singleton jsonb; batched jsonb;
  subject_key text:=coalesce('student:'||student_id,'lead:'||lead_id);
  subjects jsonb:=jsonb_build_array(jsonb_build_object('key',subject_key,'student_id',student_id,'lead_id',lead_id));
begin
  select * into strict context from public.school_record_read_context(subjects);
  perform pg_temp.assert_read_context(context.source_assessment_complete=assessment_complete,'SOURCE_ASSESSMENT_CONTEXT_STALE');
  perform pg_temp.assert_read_context(context.other_contact=exists(select 1 from public.school_other_contact_subjects() c where c.key=subject_key),'OTHER_CONTACT_CONTEXT_DIFFERS');
  singleton:=public.read_student_record_with_enrollments(student_id,lead_id,'{}'::public.business_course_enrollment_subjects[]);
  batched:=public.read_student_record_with_context(student_id,lead_id,'{}'::public.business_course_enrollment_subjects[],
    jsonb_build_object('statusEvidence',context.facts,'sourceAssessmentComplete',context.source_assessment_complete,'otherContact',context.other_contact));
  perform pg_temp.assert_read_context(pg_temp.normalize_record_evidence(singleton)=pg_temp.normalize_record_evidence(batched),'SINGLETON_AND_CONTEXT_RECORD_DIFFER');
end;
$$;

do $fixture$
declare
  actor uuid; scoped_staff uuid; outsider uuid;
  student_a uuid:=gen_random_uuid(); student_b uuid:=gen_random_uuid(); lead_a uuid:=gen_random_uuid();
  source_id text:='read-context-'||gen_random_uuid(); table_key text:='read-context-'||gen_random_uuid();
  activity_id uuid:=gen_random_uuid(); registration_id uuid:=gen_random_uuid(); assessment_id uuid:=gen_random_uuid(); batch_id uuid:=gen_random_uuid();
  denied boolean; context record;
begin
  select id into actor from public.profiles where role='admin' and is_active order by created_at,id limit 1;
  select id into scoped_staff from public.profiles where role='staff' and is_active
    and public.has_perm(id,'followup.view') and not public.has_perm(id,'student.view.all') order by created_at,id limit 1;
  select id into outsider from public.profiles where role in ('parent','student') and is_active order by created_at,id limit 1;
  if actor is null or scoped_staff is null or outsider is null then raise exception 'DEVELOPMENT_ROLES_REQUIRED';end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  insert into public.students(id,name,bind_code,purpose,assigned_to)
    values(student_a,'Read context fixture A',upper(left(replace(student_a::text,'-',''),8)),'test',actor),
      (student_b,'Read context fixture B',upper(left(replace(student_b::text,'-',''),8)),'test',actor);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,owner_id,created_by,purpose)
    values(lead_a,'Read context fixture',lead_a::text,'000000','000000',actor,actor,'test');
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,
    source_data,record_data,match_status,match_data,entity_data,lead_id,search_text)
    values(source_id,repeat('a',64),table_key,'row-1',repeat('a',64),
      '{"format":"feishu-base","filename":"2026-10-09-fixture.json"}',
      jsonb_build_object('tableId',table_key,'sourceRecordId','row-1','cells','[]'::jsonb),
      'matched','{}','{}',lead_a,'read context fixture');
  insert into public.school_source_status_evidence(source_record_id,payload_sha256,facts)
    values(source_id,repeat('a',64),'[{"type":"assessment","value":"complete","priority":140,"certainty":"confirmed"}]');
  perform pg_temp.assert_record_context(null,lead_a,true);

  -- Conversion is reflected in the very next page context, with the same full record.
  update public.leads set student_id=student_a,identity_confirmed_by=actor,identity_confirmed_at=now(),status='converted' where id=lead_a;
  perform pg_temp.assert_record_context(student_a,lead_a,true);
  denied:=false;
  begin perform public.school_record_read_context(jsonb_build_array(jsonb_build_object('key','mismatch','student_id',student_b,'lead_id',lead_a)));
  exception when others then if sqlerrm<>'SUBJECT_MISMATCH' then raise;end if;denied:=true;end;
  perform pg_temp.assert_read_context(denied,'CONTEXT_ACCEPTED_MISMATCHED_IDENTITIES');

  insert into public.activities(id,kind,title,scheduled_at,created_by)
    values(activity_id,'assessment_1v1','Read context fixture',now(),actor);
  insert into public.activity_registrations(id,activity_id,lead_id,status,operated_by,assessment_started_at,assessment_completed_at)
    values(registration_id,activity_id,lead_a,'attended',actor,now()-interval '30 minutes',now());
  perform set_config('request.jwt.claims','{}',true);
  insert into public.history_import_batches(id,batch_key,payload_sha256,manifest)
    values(batch_id,table_key,repeat('a',64),'{}');
  insert into public.assessment_results(id,activity_registration_id,student_id,overall_level,score,assessment_band,
    result_source,result_finalized_at,source_record_id,history_revision,history_key,history_batch_id,
    source_payload_sha256,source_field_ids,history_imported_at)
    values(assessment_id,registration_id,student_a,'on_track',55,'a','teacher',now(),source_id,1,source_id,batch_id,
      repeat('a',64),array['fixture'],now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.assert_record_context(student_a,lead_a,false);
  update public.assessment_results set history_revision=0 where id=assessment_id;
  perform pg_temp.assert_record_context(student_a,lead_a,true);

  -- Even a supplied context cannot bypass the detailed reader's subject scope.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',scoped_staff,'role','authenticated','aal','aal2')::text,true);
  denied:=false;
  begin perform public.school_record_read_context(jsonb_build_array(jsonb_build_object('key','student:'||student_a,'student_id',student_a,'lead_id',lead_a)));
  exception when others then if sqlerrm<>'FORBIDDEN_SCOPE' then raise;end if;denied:=true;end;
  perform pg_temp.assert_read_context(denied,'CONTEXT_READ_OUTSIDE_STAFF_SCOPE');
  denied:=false;
  begin perform public.read_student_record_with_context(student_a,lead_a,'{}'::public.business_course_enrollment_subjects[],
    '{"statusEvidence":[],"sourceAssessmentComplete":false,"otherContact":false}');
  exception when others then if sqlerrm<>'FORBIDDEN_SCOPE' then raise;end if;denied:=true;end;
  perform pg_temp.assert_read_context(denied,'SUPPLIED_CONTEXT_BYPASSED_SUBJECT_SCOPE');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated','aal','aal2')::text,true);
  select * into strict context from public.school_record_read_context(jsonb_build_array(jsonb_build_object('key','student:'||student_a,'student_id',student_a,'lead_id',lead_a)));
  perform pg_temp.assert_read_context(context.facts='[]'::jsonb and not context.source_assessment_complete and not context.other_contact,'OUTSIDER_READ_CONTEXT');
end
$fixture$;

set local role authenticated;
do $permissions$
declare denied boolean;
begin
  denied:=false;
  begin perform public.school_record_read_context('[]');
  exception when insufficient_privilege then denied:=true;end;
  perform pg_temp.assert_read_context(denied,'CONTEXT_HELPER_IS_PUBLIC');
  denied:=false;
  begin perform public.read_student_record_with_context(null,null,'{}'::public.business_course_enrollment_subjects[],'{}');
  exception when insufficient_privilege then denied:=true;end;
  perform pg_temp.assert_read_context(denied,'CONTEXT_READER_IS_PUBLIC');
end
$permissions$;
reset role;

rollback;
