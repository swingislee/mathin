\set ON_ERROR_STOP on
-- R1-7E: field-allowlisted user-rights artifacts, expiry, download audit,
-- and domain-scoped operational export audit.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as student_user_id from public.profiles where display_name = '测试-学生' limit 1 \gset
select id as parent_id from public.profiles where display_name = '测试-家长' limit 1 \gset
select id as student_id from public.students where user_id = :'student_user_id'::uuid limit 1 \gset
select id as session_id from public.class_sessions where classroom_id in (
  select id from public.classrooms where owner_id = :'teacher_id'::uuid
) limit 1 \gset
select id as page_doc_id from public.cw_page_docs limit 1 \gset

do $$
declare failures text[] := '{}';
begin
  if not (select relrowsecurity from pg_class where oid='public.user_rights_export_artifacts'::regclass)
  then failures:=array_append(failures,'user-rights artifact RLS missing'); end if;
  if not (select relrowsecurity from pg_class where oid='public.export_download_events'::regclass)
  then failures:=array_append(failures,'export download event RLS missing'); end if;
  if has_column_privilege('authenticated','public.user_rights_export_artifacts','content_text','SELECT')
  then failures:=array_append(failures,'authenticated can bypass download audit and read artifact content'); end if;
  if has_table_privilege('authenticated','public.export_download_events','INSERT')
  then failures:=array_append(failures,'authenticated can forge download audit'); end if;
  if not has_function_privilege('authenticated','public.download_user_rights_export(uuid)','EXECUTE')
  then failures:=array_append(failures,'subject download RPC unavailable'); end if;
  if cardinality(failures)>0 then
    raise exception 'R1-7E structure assertions failed: %',array_to_string(failures,', ');
  end if;
end
$$;

insert into public.students(
  id,name,phone,wechat,parent_name,parent_phone,remark,bind_code,user_id,created_by
) values (
  '00000000-0000-4000-8000-000000009971','R1 其他学生','13900009971','other-wechat',
  '其他监护人','13900009972','R1_INTERNAL_OTHER_STUDENT_REMARK','R1OTHERSTUDENTCODE',null,:'admin_id'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_user_id', true);
select public.request_account_action('export','R1-7E student export','account_and_learning') as student_request_id \gset
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.manage_account_request(:'student_request_id'::uuid,'approved','verified','R1-7E verified',null,null);
select artifact_id,artifact_hash,size_bytes,expires_at
  from public.prepare_user_rights_export(:'student_request_id'::uuid) \gset student_export_
reset role;

do $$
declare payload text; manifest jsonb; stored_hash text; subject_student_id uuid;
begin
  select id into subject_student_id from public.students
   where user_id='00000000-0000-4000-8000-000000000004';
  select content_text,field_manifest,artifact_hash into payload,manifest,stored_hash
    from public.user_rights_export_artifacts
   where user_id='00000000-0000-4000-8000-000000000004';
  if payload not like '%"schemaVersion": "mathin-user-rights-export-v1"%'
  then raise exception 'R1_STUDENT_EXPORT_SCHEMA_MISSING'; end if;
  if payload not like '%00000000-0000-4000-8000-000000000004%'
     or payload not like '%'||subject_student_id::text||'%'
  then raise exception 'R1_STUDENT_EXPORT_OWN_SUBJECT_MISSING'; end if;
  if payload like '%R1_INTERNAL_OTHER_STUDENT_REMARK%'
     or payload like '%00000000-0000-4000-8000-000000009971%'
     or payload like '%R1OTHERSTUDENTCODE%'
  then raise exception 'R1_STUDENT_EXPORT_LEAKED_OTHER_STUDENT'; end if;
  if payload like '%"remark"%' or payload like '%"bindCode"%' or payload like '%"accountLockReason"%'
  then raise exception 'R1_STUDENT_EXPORT_LEAKED_INTERNAL_FIELD'; end if;
  if manifest#>'{explicitlyExcluded}' is null
  then raise exception 'R1_EXPORT_EXCLUSION_MANIFEST_MISSING'; end if;
  if encode(extensions.digest(convert_to(payload,'UTF8'),'sha256'),'hex') <> stored_hash
  then raise exception 'R1_STUDENT_EXPORT_HASH_MISMATCH'; end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_user_id', true);
select file_name,artifact_hash,expires_at
  from public.download_user_rights_export(:'student_export_artifact_id'::uuid) \gset downloaded_
do $$
begin
  if exists(
    select 1 from public.export_download_events event_row
    join public.user_rights_export_artifacts artifact_row on artifact_row.id=event_row.artifact_id
    where artifact_row.user_id=auth.uid() and event_row.artifact_hash<>artifact_row.artifact_hash
  ) then raise exception 'R1_SUBJECT_DOWNLOAD_HASH_CHANGED'; end if;
  if (select count(*) from public.export_download_events event_row
      join public.user_rights_export_artifacts artifact_row on artifact_row.id=event_row.artifact_id
      where artifact_row.user_id=auth.uid() and event_row.actor_user_id=auth.uid()) <> 1
  then raise exception 'R1_SUBJECT_DOWNLOAD_NOT_AUDITED'; end if;
  begin
    insert into public.export_download_events(
      export_category,export_kind,resource_id,actor_user_id,artifact_hash,size_bytes,field_manifest
    ) values ('operational','solution_record_webp',gen_random_uuid(),auth.uid(),repeat('a',64),1,'{}');
    raise exception 'R1_DIRECT_EXPORT_AUDIT_WRITE_ACCEPTED';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

-- A linked parent still cannot download the student's personal-rights artifact.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select set_config('r1.student_export_artifact_id', :'student_export_artifact_id', true);
do $$
begin
  begin
    perform public.download_user_rights_export(current_setting('r1.student_export_artifact_id')::uuid);
    raise exception 'R1_CROSS_STUDENT_EXPORT_DOWNLOAD_ACCEPTED';
  exception when others then if SQLERRM <> 'FORBIDDEN' then raise; end if; end;
end
$$;
select public.request_account_action('export','R1-7E parent export','account_and_learning') as parent_request_id \gset
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.manage_account_request(:'parent_request_id'::uuid,'approved','verified','R1-7E verified',null,null);
select artifact_id from public.prepare_user_rights_export(:'parent_request_id'::uuid) \gset parent_export_
reset role;

do $$
declare payload text;
begin
  select content_text into payload from public.user_rights_export_artifacts
   where user_id='00000000-0000-4000-8000-000000000005';
  if payload not like '%"familyLinks"%' then raise exception 'R1_PARENT_EXPORT_FAMILY_LINKS_MISSING'; end if;
  if payload like '%"birthday"%' or payload like '%"phone"%' or payload like '%"wechat"%'
     or payload like '%"learningResults"%' or payload like '%"submissions"%'
  then raise exception 'R1_PARENT_EXPORT_LEAKED_MINOR_DETAILS'; end if;
end
$$;

-- The access deadline makes an artifact unavailable even before physical purge.
update public.user_rights_export_artifacts
   set expires_at=now()-interval '1 minute'
 where id=:'student_export_artifact_id'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_user_id', true);
do $$
begin
  begin
    perform public.download_user_rights_export((select id from public.user_rights_export_artifacts where user_id='00000000-0000-4000-8000-000000000004'));
    raise exception 'R1_EXPIRED_EXPORT_DOWNLOAD_ACCEPTED';
  exception when others then if SQLERRM <> 'EXPORT_EXPIRED' then raise; end if; end;
end
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.purge_expired_user_rights_export_payloads(100) as purged_count \gset
reset role;
do $$
begin
  if exists(select 1 from public.user_rights_export_artifacts
    where user_id='00000000-0000-4000-8000-000000000004'
      and (content_text is not null or purged_at is null))
  then raise exception 'R1_EXPIRED_EXPORT_PAYLOAD_RETAINED'; end if;
end
$$;

-- Operational WebP export is immediate (no retained user-rights artifact) and
-- can only be audited by a teacher/reviewer who can read the solution record.
insert into public.courseware_annotations(
  id,session_id,page_doc_id,user_id,annotation_type,content,version
) values (
  '00000000-0000-4000-8000-000000009972',:'session_id',:'page_doc_id',:'teacher_id','board','[]',1
);
insert into public.solution_records(
  id,session_id,solution_source,annotation_id,page_doc_id,content,created_by,updated_by
) values (
  '00000000-0000-4000-8000-000000009973',:'session_id','board',
  '00000000-0000-4000-8000-000000009972',:'page_doc_id','{"items":[]}',:'teacher_id',:'teacher_id'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.record_solution_record_export_download(
  '00000000-0000-4000-8000-000000009973',repeat('b',64),4096
) as operational_audit_id \gset
reset role;
do $$
begin
  if not exists(select 1 from public.export_download_events
    where resource_id='00000000-0000-4000-8000-000000009973' and export_category='operational'
      and export_kind='solution_record_webp' and target_user_id is null and artifact_id is null)
  then raise exception 'R1_OPERATIONAL_EXPORT_NOT_AUDITED'; end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_user_id', true);
do $$
begin
  begin
    perform public.record_solution_record_export_download(
      '00000000-0000-4000-8000-000000009973',repeat('c',64),4096
    );
    raise exception 'R1_UNAUTHORIZED_OPERATIONAL_EXPORT_ACCEPTED';
  exception when others then if SQLERRM <> 'FORBIDDEN' then raise; end if; end;
  if exists(select 1 from public.export_download_events where export_category='operational')
  then raise exception 'R1_OPERATIONAL_EXPORT_AUDIT_VISIBLE_TO_STUDENT'; end if;
end
$$;
reset role;

rollback;
\echo R1-7E export artifact assertions passed
