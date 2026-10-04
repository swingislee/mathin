-- 使用现有固定账号；仅新增事务夹具，保存点回滚后不留下业务记录。
savepoint directory_card_fixtures;
create function pg_temp.assert_directory_card(sid uuid) returns jsonb language plpgsql as $$
declare expected jsonb; actual jsonb;
begin
  expected:=pg_temp.project_cards(public.list_student_directory('all',sid::text,'all','none','',1,20));
  actual:=public.list_student_directory_cards('all',sid::text,'all','none','',1,20);
  if expected is distinct from actual then raise exception 'DIRECTORY_FIXTURE_FIELDS_CHANGED';end if;
  return actual->'rows'->0;
end;$$;
do $fixture$
declare actor uuid:=current_setting('directory.cards.admin')::uuid; teacher uuid:=current_setting('directory.cards.teacher')::uuid;
  sid uuid:=gen_random_uuid(); other_sid uuid:=gen_random_uuid(); lid uuid:=gen_random_uuid(); aid uuid:=gen_random_uuid();
  rid uuid:=gen_random_uuid(); result_id uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid(); batch_id uuid:=gen_random_uuid(); source_id text:='directory-card-'||gen_random_uuid();
  card jsonb; state record; current_actor uuid:=actor;
begin
  perform set_config('request.jwt.claims','{}',true);
  insert into public.history_import_batches(id,batch_key,payload_sha256,manifest)
    values(batch_id,'directory-card-'||batch_id,repeat('b',64),'{}');
  insert into public.students(id,name,grade,phone,parent_phone,created_by,bind_code)
    values(sid,'directory-card-fixture',3,'+86 138-0000-1234 x９','',actor,public.generate_student_bind_code()),
      (other_sid,'directory-card-fixture',3,'600000008799','',actor,public.generate_student_bind_code());
  insert into public.leads(id,student_id,provisional_student_name,normalized_name,phone,phone_normalized,status,created_by,identity_confirmed_by,identity_confirmed_at)
    values(lid,sid,'directory-card-fixture','directory-card-fixture','600000008798','600000008798','uncontacted',actor,actor,now());
  insert into public.history_import_records(id,student_id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,entity_data,search_text)
    values(source_id,sid,repeat('a',64),'directory-card-fixture',source_id,repeat('b',64),'{"format":"feishu-base"}',
      '{"tableName":"2026秋季在读学员表格","cells":[{"fieldName":"学服老师","text":"fixture owner"},{"fieldName":"班型","text":"A+"}]}',
      'matched','{}','{}','directory-card-fixture');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';
  card:=pg_temp.assert_directory_card(sid);
  if card->>'phoneTail'<>'1234' or card->>'detail'<>'not_contacted' or card->'assessment'<>'null'::jsonb then raise exception 'DIRECTORY_FIRST_CONTACT_HINT';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.lead_communications(lead_id,outcome,note,recorded_by,owner_id_at_contact,occurred_at)
    values(lid,'connected','directory card fixture',actor,actor,now());
  perform set_config('request.jwt.claims','{}',true);
  insert into public.activities(id,kind,title,scheduled_at,created_by,source_record_id,history_key,history_batch_id,source_field_ids,source_payload_sha256,history_imported_at)
    values(aid,'assessment_1v1','directory-card-fixture',now(),actor,source_id,source_id,batch_id,array['fixture'],repeat('b',64),now());
  insert into public.activity_registrations(id,activity_id,student_id,lead_id,status,operated_by,source_record_id,history_key,history_batch_id,source_field_ids,source_payload_sha256,history_imported_at)
    values(rid,aid,sid,null,'booked',actor,source_id,source_id,batch_id,array['fixture'],repeat('b',64),now());
  insert into public.history_workflow_scopes(record_id,reason,current_period,source_ids,source_filename,source_sha256,resumed_at)
    values(source_id,'processed_prior_period','2026-09',array[source_id],'directory-card-fixture',repeat('a',64),now());
  insert into public.history_business_workflow_scopes(relation,record_id,source_record_id,reason)
    values('activity_registrations',rid,source_id,'history_review_required');
  for state in select * from (values
    (true,null::text,'not_booked'),(false,null,'not_booked'),(true,'continue','booked'),
    (false,'continue','booked'),(true,'archive','not_booked'),(false,'archive','not_booked')
  ) v(archived,decision,detail) loop
    update public.history_workflow_scopes set resumed_at=case when state.archived then null else now() end where record_id=source_id;
    if state.decision is null then delete from public.history_workflow_decisions where key='record:'||source_id;
    else insert into public.history_workflow_decisions(key,decision,note,actor_id) values('record:'||source_id,state.decision,'directory-card-fixture',actor)
      on conflict(key) do update set decision=excluded.decision;end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
    if card->>'stage'<>'awaiting_assessment' or card->>'detail'<>state.detail then raise exception 'DIRECTORY_HISTORY_CURRENT_RULE';end if;
    execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  end loop;
  insert into public.history_workflow_decisions(key,decision,note,actor_id) values('record:'||source_id,'continue','directory-card-fixture',actor)
    on conflict(key) do update set decision='continue';
  update public.activity_registrations set status='attended',source_enrollment_facts='{"version":1,"confirmed":true,"assessmentBand":null,"registeredOn":null}' where id=rid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
  if card->>'stage'<>'awaiting_renewal' or card->'assessment'<>'null'::jsonb then raise exception 'CLASS_BAND_IS_NOT_ASSESSMENT';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  insert into public.assessment_results(id,activity_registration_id,student_id,lead_id,score,assessment_band,assessed_on,assessed_by,result_source,source_record_id,history_key,history_batch_id,source_field_ids,source_payload_sha256,history_imported_at)
    values(result_id,rid,sid,null,82,'a_plus','2026-08-20',actor,'legacy',source_id,source_id,batch_id,array['fixture'],repeat('b',64),now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
  if card->'assessment' is distinct from '{"band":"a_plus","score":82,"at":"2026-08-20"}'::jsonb then raise exception 'REAL_ASSESSMENT_CHANGED';end if;
  if pg_temp.assert_directory_card(other_sid)->'assessment'<>'null'::jsonb then raise exception 'SAME_NAME_ASSESSMENT_LEAK';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  update public.assessment_results set result_source='quick_entry',result_finalized_at=null where id=result_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
  if card->'assessment'<>'null'::jsonb then raise exception 'DRAFT_ASSESSMENT_DISPLAYED';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  update public.assessment_results set result_finalized_at=now() where id=result_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
  if card->'assessment'->>'score'<>'82' then raise exception 'FINAL_ASSESSMENT_MISSING';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  update public.activity_registrations set status='no_show' where id=rid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
  if card->'assessment'<>'null'::jsonb then raise exception 'NO_SHOW_ASSESSMENT_DISPLAYED';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  update public.activity_registrations set status='attended' where id=rid;
  update public.history_import_records set source_data='{"format":"non-authoritative-fixture"}' where id=source_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
  if card->'assessment'<>'null'::jsonb then raise exception 'NON_AUTHORITATIVE_SOURCE_DISPLAYED';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  update public.history_import_records set source_data='{"format":"feishu-base"}' where id=source_id;

  insert into public.school_business_groups(id,name,created_by) values(gid,'directory-card-'||gid,actor);
  insert into public.school_business_group_members(group_id,user_id,added_by) values(gid,teacher,actor);
  insert into public.school_subject_groups(student_id,group_id,source_key,recorded_by) values(sid,gid,'directory-card-fixture',actor);
  current_actor:=teacher;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
  if card is null or card->>'canContact'<>'false' then raise exception 'GROUP_VIEW_GRANTED_WRITE';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  update public.school_business_group_members set removed_at=now(),removed_by=actor where group_id=gid and user_id=teacher;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
  if card is not null then raise exception 'REVOKED_GROUP_VISIBILITY_CACHED';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  insert into public.school_subject_participants(student_id,user_id,business_role,source_key,recorded_by)
    values(sid,teacher,'teacher','directory-card-fixture',actor);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_actor,'role','authenticated')::text,true); execute 'set local role authenticated';card:=pg_temp.assert_directory_card(sid);
  if card is null or (card->>'canContact')::boolean is distinct from public.has_perm(teacher,'followup.write') then raise exception 'PARTICIPANT_PERMISSION_CHANGED';end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
end;
$fixture$;
rollback to savepoint directory_card_fixtures;
