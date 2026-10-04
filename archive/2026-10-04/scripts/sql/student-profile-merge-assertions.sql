savepoint student_merge_contract;
do $test$
#variable_conflict use_variable
declare actor uuid:=current_setting('manual_entry_test.admin')::uuid; teacher uuid:=current_setting('manual_entry_test.teacher')::uuid;
 outsider uuid:=current_setting('manual_entry_test.student')::uuid; kept uuid; source uuid; separate uuid; second uuid;
 room uuid:=gen_random_uuid(); lesson uuid:=gen_random_uuid(); followup uuid:=gen_random_uuid(); term uuid; course uuid;
 request uuid:=gen_random_uuid(); payload jsonb; work jsonb; reviewed jsonb; before_review jsonb; merged jsonb; err text;
 assessment jsonb; before_assessment jsonb; before_roster jsonb; finance_allowed boolean;
 source_record text:='merge-contract-'||gen_random_uuid(); before_source jsonb; before_attendance jsonb; before_profile jsonb; snapshot jsonb;
 old_notes bigint; old_grades bigint; balance_total numeric; lesson_total numeric; source_opportunity uuid; kept_opportunity uuid;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 kept:=public.create_student('Merge kept '||request,3::smallint,'600000009401','','manual contract','','','Keep note');
 source:=public.create_student('Merge source '||request,3::smallint,'600000009402','','manual contract','Source parent','','Source note');
 separate:=public.create_student('Separate '||request,3::smallint,'600000009403','','manual contract','','','');
 second:=public.create_student('Second '||request,3::smallint,'600000009404','','manual contract','','','');
 execute 'reset role';
 select id into term from public.school_terms order by id limit 1;
 select id into course from public.courses where status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null order by id limit 1;
 insert into public.student_follow_ups(id,student_id,author_id,content) values(followup,source,teacher,'Earlier teacher note');
 insert into public.student_grade_history(student_id,term_id,grade,recorded_by,recorded_at)
   values(kept,term,3,actor,clock_timestamp()-interval '1 day'),(source,term,3,teacher,clock_timestamp())
   on conflict(student_id,term_id) do update set grade=3,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at;
 finance_allowed:=public.has_perm(actor,'finance.account.adjust');
 if finance_allowed then
   insert into public.account_ledger(student_id,delta,reason,operator_id) values(kept,13,'Merge contract',actor),(source,17,'Merge contract',actor);
 else
   insert into public.student_accounts(student_id) values(kept),(source) on conflict do nothing;
 end if;
 insert into public.classrooms(id,name,owner_id,invite_code,capacity,course_id,term_id)
   values(room,'Merge contract class',actor,replace(room::text,'-',''),5,course,term);
 insert into public.class_sessions(id,classroom_id,title,term_id) values(lesson,room,'Merge contract lesson',term);
 insert into public.session_roster_revisions(session_id,revision,source_hash,created_by,reason) values(lesson,1,repeat('c',64),actor,'start');
 insert into public.session_roster_entries(session_id,revision,student_id,name,roster_order,seat_position) values(lesson,1,source,'Original frozen name',1,1);
 update public.class_sessions set roster_frozen_at=clock_timestamp(),roster_revision=1,roster_source_hash=repeat('c',64) where id=lesson;
 select to_jsonb(r) into before_roster from public.session_roster_entries r where session_id=lesson and revision=1 and student_id=source;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
 insert into public.session_attendance(session_id,student_id,status,note) values(lesson,source,'leave','Original attendance');
 select to_jsonb(a) into before_attendance from public.session_attendance a where session_id=lesson and student_id=source;
 insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,entity_data,student_id,search_text)
   values(source_record,repeat('a',64),'contract',source_record,repeat('b',64),'{}','{"original":"unchanged"}','matched','{}','{}',source,'Contract');
 select to_jsonb(h) into before_source from public.history_import_records h where id=source_record;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 payload:=jsonb_build_object('workspace','communication','subject',jsonb_build_object('studentId',source,'leadId',null,'version',(public.read_school_support_profile(source,null)->>'version')),
   'newPerson',null,'work',jsonb_build_object('date',current_date,'note','Earlier communication'),'acknowledgeDuplicate',false);
 work:=public.add_school_support_work_item(request,payload);
 source_opportunity:=public.save_course_opportunity(null,null,source,null,'new',course,term,'planning',null,'',null,'Earlier enrollment plan');
 payload:=jsonb_build_object('workspace','assessments','subject',jsonb_build_object('studentId',source,'leadId',null,'version',public.read_school_support_profile(source,null)->>'version'),
   'newPerson',null,'work',jsonb_build_object('scheduledAt',now(),'arrived',true,'note','Earlier assessment'));
 assessment:=public.add_school_support_work_item(gen_random_uuid(),payload);
 execute 'reset role';
 insert into public.assessment_results(activity_registration_id,student_id,teacher_observation,assessed_by)
   values((assessment->>'registrationId')::uuid,source,'Finalized observation',teacher)
   on conflict(activity_registration_id) do update set teacher_observation=excluded.teacher_observation,assessed_by=excluded.assessed_by;
 insert into public.assessment_workflow_states(registration_id,stage,updated_by,finalized_at)
   values((assessment->>'registrationId')::uuid,'handled',actor,clock_timestamp())
   on conflict(registration_id) do update set finalized_at=clock_timestamp(),stage='handled';
 select to_jsonb(a) into before_assessment from public.assessment_results a where activity_registration_id=(assessment->>'registrationId')::uuid;
 begin update public.assessment_results set teacher_observation='Unauthorized rewrite' where activity_registration_id=(assessment->>'registrationId')::uuid;
   raise exception 'FINALIZED_GUARD_DISABLED'; exception when others then get stacked diagnostics err=message_text; if err<>'ASSESSMENT_WORKFLOW_FINALIZED' then raise; end if; end;
 execute 'set local role authenticated';
 reviewed:=public.preview_student_merge(kept,source);
 if jsonb_array_length(reviewed->'blockers')<>0 then raise exception 'UNEXPECTED_MERGE_BLOCKER: %',reviewed->'blockers'; end if;
 if reviewed->'merged'->'values'->>'parentName'<>'Source parent' or (reviewed->'counts'->'communication'->>'merged')::integer<1 then raise exception 'MERGE_PREVIEW_INCOMPLETE'; end if;
 if not exists(select 1 from jsonb_array_elements(public.search_student_merge_candidates(kept,'600000009402')) c where c->>'id'=source::text) then raise exception 'MANUAL_MERGE_SEARCH_MISSING'; end if;
 before_review:=reviewed;
 execute 'reset role';
 update public.student_follow_ups set content='Changed after preview' where id=followup;
 execute 'set local role authenticated';
 begin perform public.confirm_student_merge(kept,source,before_review->>'token','{}','Same child'); raise exception 'STALE_MERGE_ACCEPTED';
   exception when others then get stacked diagnostics err=message_text; if err<>'MERGE_CHANGED' then raise; end if; end;
 reviewed:=public.preview_student_merge(kept,source);
 execute 'reset role';
 select count(*) into old_notes from public.student_follow_ups where student_id in(kept,source);
 select count(*) into old_grades from public.student_grade_history where student_id in(kept,source);
 select sum(balance),sum(lesson_balance) into balance_total,lesson_total from public.student_accounts where student_id in(kept,source);
 select to_jsonb(s) into before_profile from public.students s where id=source;
 execute 'set local role authenticated';
 merged:=public.confirm_student_merge(kept,source,reviewed->>'token','{"phone":"merged","parentName":"merged","remark":"kept"}','Checked as the same child across teachers');
 if merged->>'keptId'<>kept::text or jsonb_array_length(public.get_student_merge_history(kept))<>1 then raise exception 'MERGE_HISTORY_MISSING'; end if;
 if public.confirm_student_merge(kept,source,reviewed->>'token','{"phone":"merged","parentName":"merged","remark":"kept"}','Checked as the same child across teachers') is distinct from merged then raise exception 'MERGE_RETRY_CHANGED_RESULT'; end if;
 begin perform public.confirm_student_merge(kept,source,reviewed->>'token','{}','Retry'); raise exception 'MERGE_REAPPLIED';
   exception when others then get stacked diagnostics err=message_text; if err not in ('STUDENT_DELETED','ALREADY_MERGED') then raise; end if; end;
 begin perform public.merge_students(kept,separate); raise exception 'OLD_UNREVIEWED_MERGE_ALLOWED';
   exception when others then get stacked diagnostics err=message_text; if err<>'MERGE_PREVIEW_REQUIRED' then raise; end if; end;
 execute 'reset role';
 if not exists(select 1 from public.students where id=source and deleted_at is not null) or not exists(select 1 from public.students where id=kept and phone='600000009402' and parent_name='Source parent' and remark='Keep note') then raise exception 'PROFILE_CHOICES_NOT_APPLIED'; end if;
 if not exists(select 1 from public.student_follow_ups where id=followup and student_id=kept and author_id=teacher and content='Changed after preview') then raise exception 'NOTE_PROVENANCE_LOST'; end if;
 if not exists(select 1 from public.leads where id=(work->>'leadId')::uuid and student_id=kept) or not exists(select 1 from public.course_opportunities where id=source_opportunity and student_id=kept) then raise exception 'BUSINESS_RELINK_MISSING'; end if;
 if (select to_jsonb(a)-'student_id' from public.session_attendance a where session_id=lesson and student_id=kept) is distinct from before_attendance-'student_id' then raise exception 'ATTENDANCE_MARKER_CHANGED'; end if;
 if (select to_jsonb(r) from public.session_roster_entries r where session_id=lesson and revision=1 and student_id=source) is distinct from before_roster then raise exception 'FROZEN_ROSTER_CHANGED'; end if;
 if (select to_jsonb(a)-'student_id'-'lead_id'-'updated_at'-'history_revision' from public.assessment_results a where activity_registration_id=(assessment->>'registrationId')::uuid and student_id=kept)
   is distinct from before_assessment-'student_id'-'lead_id'-'updated_at'-'history_revision' then raise exception 'FINALIZED_ASSESSMENT_CHANGED'; end if;
 if (select to_jsonb(h) from public.history_import_records h where id=source_record) is distinct from before_source or not exists(select 1 from public.history_import_associations where record_id=source_record and student_id=kept) then raise exception 'SOURCE_PROVENANCE_CHANGED'; end if;
 if (select count(*) from public.student_follow_ups where student_id in(kept,source))<>old_notes or (select count(*) from public.student_grade_history where student_id in(kept,source))<>old_grades then raise exception 'ORIGINAL_ROWS_DELETED'; end if;
 if not exists(select 1 from public.student_accounts where student_id=source and balance=0 and lesson_balance=0)
   or not exists(select 1 from public.student_accounts where student_id=kept and balance=balance_total and lesson_balance=lesson_total) then raise exception 'ACCOUNT_TOTAL_CHANGED'; end if;
 select before_snapshot into snapshot from public.student_merge_audits where id=(merged->>'mergeId')::uuid;
 if snapshot->'merged' is distinct from before_profile then raise exception 'ORIGINAL_PROFILE_NOT_ARCHIVED'; end if;
 if not exists(select 1 from public.student_merge_audits where id=(merged->>'mergeId')::uuid and after_snapshot is not null and applied_at is not null) then raise exception 'MERGE_AUDIT_NOT_SEALED'; end if;

 -- 两份正式同轮机会产生预览冲突，确认也保持整笔零写入。
 execute 'set local role authenticated';
 kept_opportunity:=public.save_course_opportunity(null,null,separate,null,'new',course,term,'planning',null,'',null,'One record');
 source_opportunity:=public.save_course_opportunity(null,null,second,null,'new',course,term,'planning',null,'',null,'Another record');
 reviewed:=public.preview_student_merge(separate,second);
 if jsonb_array_length(reviewed->'blockers')=0 then raise exception 'OVERLAP_NOT_PREVIEWED'; end if;
 begin perform public.confirm_student_merge(separate,second,reviewed->>'token','{}','Same child'); raise exception 'COLLISION_MERGED';
   exception when others then get stacked diagnostics err=message_text; if err<>'MERGE_CONFLICT' then raise; end if; end;
 execute 'reset role';
 if exists(select 1 from public.students where id in(separate,second) and deleted_at is not null) or exists(select 1 from public.student_merges where merged_id=second) then raise exception 'FAILED_MERGE_PARTIAL_WRITE'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 begin perform public.preview_student_merge(separate,second); raise exception 'OTHER_OWNER_MERGE_ALLOWED';
   exception when others then get stacked diagnostics err=message_text; if err not in ('FORBIDDEN','FORBIDDEN_SCOPE') then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 begin perform public.search_student_merge_candidates(kept,'Merge'); raise exception 'STUDENT_MERGE_SEARCH_ALLOWED';
   exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
 execute 'reset role';
 snapshot:=mathin_internal.student_merge_snapshot(separate,second);
 snapshot:=jsonb_set(snapshot,'{kept,user_id}',to_jsonb(actor));snapshot:=jsonb_set(snapshot,'{merged,user_id}',to_jsonb(teacher));
 if not exists(select 1 from jsonb_array_elements(mathin_internal.student_merge_review(separate,second,snapshot)->'blockers') b where b->>'kind'='accounts') then raise exception 'ACCOUNT_BINDING_CONFLICT_IGNORED'; end if;
 if not finance_allowed then
   snapshot:=jsonb_set(snapshot,array['relations','student_accounts.student_id'],jsonb_build_array(jsonb_build_object('student_id',second,'balance',100,'lesson_balance',5)));
   reviewed:=mathin_internal.student_merge_review(separate,second,snapshot);
   if reviewed->'accounts'<>'null'::jsonb or not exists(select 1 from jsonb_array_elements(reviewed->'blockers') b where b->>'kind'='finance') then raise exception 'FINANCIAL_REVIEW_PERMISSION_IGNORED'; end if;
 end if;
 if has_table_privilege('authenticated','public.student_merge_audits','INSERT') or has_function_privilege('authenticated','mathin_internal.student_merge_running(uuid,uuid)','EXECUTE') then raise exception 'MERGE_PROOF_FORGEABLE'; end if;
 execute 'reset role';
end $test$;
rollback to savepoint student_merge_contract;
release savepoint student_merge_contract;
