-- 合成事实验证，无账号、班级或学生造数；调用检查在事务内执行。
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='admin' and is_active order by created_at limit 1),'role','authenticated','aal','aal2')::text,true) is not null;
do $$ begin
 if public.student_assessment_is_complete('attended',null,null,'legacy',null,null,'学员情况：有兴趣','家长希望体验') then raise exception 'NOTES_ARE_NOT_ASSESSMENT';end if;
 if not public.student_assessment_is_complete('no_show',null,null,'legacy',82,null,'','') then raise exception 'ACTUAL_RESULT_SURVIVES_CONFLICTING_ATTENDANCE';end if;
 if not public.student_assessment_is_complete('attended',null,null,'legacy',null,null,'学习力测评等级：A','') then raise exception 'LEARNING_RESULT_MISSING';end if;
 if public.student_assessment_is_complete('attended',null,null,'legacy',null,null,'学习力测评等级：未填','') then raise exception 'PLACEHOLDER_RESULT';end if;
 if not public.school_contact_is_effective('{"outcome":"unreachable","source_metric_facts":{"effectiveContact":true}}',null) then raise exception 'OTHER_PHASE_EVIDENCE_MISSING';end if;
 if public.school_contact_is_effective('{"outcome":"connected","source_metric_facts":{"effectiveContact":true}}','{"outcome":"unreachable"}') then raise exception 'MANUAL_CORRECTION_NOT_RESPECTED';end if;
 if public.school_contact_is_effective('{"outcome":"unreachable"}',null) then raise exception 'FAILED_CALL_ADVANCED_STAGE';end if;
 if not public.school_contact_is_effective('{"outcome":null,"wechat_added":true}',null) then raise exception 'WECHAT_EVIDENCE_MISSING';end if;
 if public.school_contact_is_effective('{"outcome":"connected","source_metric_facts":{"supersededProjection":true}}',null) then raise exception 'SUPERSEDED_PROJECTION_VISIBLE';end if;
 if public.school_contact_sort_key(null,null,null,'x:followup')<=public.school_contact_sort_key(null,null,null,'x:confirmation') then raise exception 'FOLLOWUP_ORDER';end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='admin' and is_active order by created_at limit 1),'role','authenticated','aal','aal2')::text,true) is not null;
create temp table reconciliation_index on commit drop as select * from public.student_record_index_with_enrollments('all','',array(select e from public.business_course_enrollment_subjects e));
create temp table reconciliation_general on commit drop as select * from public.student_list_query_facts('all','','records','awaiting_assessment',null);
create temp table reconciliation_first on commit drop as select * from public.student_first_contact_page_facts('all',1,20);
do $$declare expected jsonb; begin
 if exists(select key from reconciliation_index group by key having count(*)<>1) then raise exception 'DUPLICATE_STUDENT_STAGE';end if;
 if exists(select 1 from reconciliation_index where stage is null or stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')) then raise exception 'INVALID_STAGE';end if;
 select jsonb_object_agg(stage,n) into expected from(select stage,count(*) n from reconciliation_index group by stage) s;
 if expected<>(select jsonb_object_agg(index_stage,n) from(select index_stage,count(*) n from reconciliation_general group by index_stage) s)
 or expected<>(select jsonb_object_agg(index_stage,n) from(select index_stage,count(*) n from reconciliation_first group by index_stage) s) then raise exception 'STAGE_READ_PATHS_DISAGREE';end if;
end $$;
select jsonb_build_object('contractAssertions','passed','allRecordIndex',(select count(*) from reconciliation_index),
 'generalPage',(select count(*) from reconciliation_general),'firstPage',(select count(*) from reconciliation_first),
 'stages',(select jsonb_object_agg(stage,n) from(select stage,count(*) n from reconciliation_index group by stage) s));
select jsonb_build_object('filteredPage',public.list_student_records_page('awaiting_assessment','all','','records',1,20,'{"version":2,"filters":{"sourceReview":{"kind":"enum","values":["required"]}},"sort":null}','zh','{}')->'count');
