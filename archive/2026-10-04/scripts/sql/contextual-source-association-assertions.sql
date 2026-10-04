savepoint source_association_contract;
create temp table source_association_test as select
 (select id from auth.users where email='test-admin@mathin.local') admin_id,
 (select id from auth.users where email='test-teacher@mathin.local') teacher_id,
 c.record_id,c.student_id,
 (select id from public.students s where s.id<>c.student_id and s.deleted_at is null and not public.can_access_student(s.id,(select id from auth.users where email='test-teacher@mathin.local')) limit 1) other_student_id,
 (select id from public.history_import_records x where x.student_id is null and x.lead_id is null and x.id<>c.record_id and not public.history_source_is_shared(x.record_data) limit 1) unresolved_record_id
from public.history_import_identity_candidates c join public.history_import_records h on h.id=c.record_id
where h.student_id is null and h.lead_id is null and not public.history_source_is_shared(h.record_data)
and not exists(select 1 from public.history_import_associations a where a.record_id=c.record_id)
limit 1;
grant select on source_association_test to authenticated;
do $test$ begin if not exists(select 1 from source_association_test where admin_id is not null and teacher_id is not null and other_student_id is not null and unresolved_record_id is not null) then raise exception 'FIXED_SOURCE_CONTRACT_SAMPLE_REQUIRED';end if;end $test$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) from source_association_test;
do $test$
declare c record; v integer; context jsonb;
begin
 select * into c from source_association_test;
 context:=public.get_history_source_context(c.record_id,c.student_id);
 if context->'studentId'<>'null'::jsonb or (context->>'canConfirm')::boolean is not true then raise exception 'PENDING_CONTEXT_REQUIRED';end if;
 if (public.get_student_source_archive(c.student_id)->>'total')::int<1 then raise exception 'STUDENT_SOURCE_VISIBILITY';end if;
 v:=public.confirm_history_source(c.record_id,c.student_id,0,'followup');
 if v<>1 or public.confirm_history_source(c.record_id,c.student_id,0,'followup')<>1 then raise exception 'SOURCE_CONFIRM_RETRY';end if;
 if (select count(*) from public.history_import_association_events where record_id=c.record_id)<>1 then raise exception 'SOURCE_CONFIRM_DUPLICATE_AUDIT';end if;
 if exists(select 1 from public.history_import_records where id=c.record_id and (student_id is not null or match_status='matched')) then raise exception 'SOURCE_ORIGINAL_MATCH_REWRITTEN';end if;
 begin perform public.confirm_history_source(c.record_id,c.other_student_id,0,'followup');raise exception 'STALE_SOURCE_OVERWRITE';exception when raise_exception then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 insert into public.student_follow_ups(student_id,author_id,content,kind,context_source_record_id) values(c.student_id,c.admin_id,'Source association contract','note',c.record_id);
 if not exists(select 1 from public.student_follow_ups where student_id=c.student_id and context_source_record_id=c.record_id) then raise exception 'FOLLOWUP_SOURCE_NOT_SAVED';end if;
 begin
  insert into public.student_follow_ups(student_id,author_id,content,kind,context_source_record_id) values(c.other_student_id,c.admin_id,'Source association mismatch','note',c.record_id);
  raise exception 'OTHER_STUDENT_SOURCE_USED';
 exception when raise_exception then if sqlerrm<>'SOURCE_ASSOCIATION_REQUIRED' then raise;end if;end;
 begin
  insert into public.student_follow_ups(student_id,author_id,content,kind,context_source_record_id) values(c.student_id,c.admin_id,'Unresolved source contract','note',c.unresolved_record_id);
  raise exception 'UNRESOLVED_SOURCE_USED';
 exception when raise_exception then if sqlerrm<>'SOURCE_ASSOCIATION_REQUIRED' then raise;end if;end;
 begin perform public.confirm_history_source(c.record_id,c.other_student_id,1,'followup');raise exception 'USED_SOURCE_REASSIGNED';exception when raise_exception then if sqlerrm<>'SOURCE_IN_USE' then raise;end if;end;
 context:=public.get_history_source_context(c.record_id,c.student_id);
 if context->>'studentId'<>c.student_id::text or (context->>'version')::int<>1 then raise exception 'SOURCE_PERSISTENT_CONTEXT';end if;
end $test$;
select set_config('request.jwt.claims',jsonb_build_object('sub',teacher_id,'role','authenticated')::text,true) from source_association_test;
do $test$ declare c record;begin
 select * into c from source_association_test;
 if public.can_confirm_history_source() then raise exception 'TEACHER_IDENTITY_CONFIRM_SCOPE';end if;
 if exists(select 1 from public.history_import_identity_candidates) then raise exception 'TEACHER_CANDIDATE_LEAK';end if;
 begin perform public.get_student_source_archive(c.other_student_id);raise exception 'OTHER_STUDENT_ARCHIVE_LEAK';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform public.confirm_history_source(c.record_id,c.other_student_id,0,'followup');raise exception 'TEACHER_CONFIRMED_OTHER_STUDENT';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $test$;
reset role;
do $test$ begin
 if has_function_privilege('anon','public.confirm_history_source(text,uuid,integer,text)','EXECUTE') or has_table_privilege('authenticated','public.history_import_associations','INSERT') or has_table_privilege('authenticated','public.history_import_association_events','UPDATE') then raise exception 'SOURCE_ASSOCIATION_DIRECT_WRITE';end if;
 if not public.history_source_is_shared('{"cells":[{"fieldName":"满班人数 [A]","text":"12"},{"fieldName":"学员姓名 [B]","text":"甲"}]}'::jsonb) then raise exception 'SHARED_ROSTER_SCOPE';end if;
end $test$;
rollback to savepoint source_association_contract;
select 'SOURCE_ASSOCIATIONS_PASS';
