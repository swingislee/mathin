-- 规则覆盖文字结果、空白、未到场、取消、草稿、原有数字结果及完成时间。
do $rules$
declare fixture record; actual boolean;
begin
  for fixture in select * from (values
    ('attended','legacy',null::numeric,null::text,'学员情况：已有观察','学员情况：已有观察',false,true),
    ('attended','legacy',null,null,'','家长关注：课堂专注力',false,true),
    ('attended','legacy',null,null,'','教师建议：分步练习',false,true),
    ('attended','legacy',null,null,'',E' \t\n\r'||U&'\00a0\3000',false,false),
    ('booked','legacy',null,null,'已有沟通','已有沟通',false,false),
    ('no_show','legacy',85,'a','已有沟通','已有沟通',true,false),
    ('cancelled','legacy',85,'a','已有沟通','已有沟通',true,false),
    ('attended','quick_entry',85,'a','草稿反馈','草稿反馈',false,false),
    ('attended','teacher',85,'a','草稿观察','草稿观察',false,false),
    ('attended','quick_entry',null,null,'','已完成反馈',true,true),
    ('attended','legacy',0,null,'','',false,true),
    ('attended','legacy',null,'a','','',false,true),
    ('attended','legacy',null,null,'原测评等级：未达A','原测评等级：未达A',false,true)
  ) f(status,source,score,band,strengths,feedback,finalized,expected) loop
    actual:=public.student_assessment_is_complete(fixture.status,null,case when fixture.finalized then now() end,
      fixture.source,fixture.score,fixture.band,fixture.strengths,fixture.feedback);
    if actual is distinct from fixture.expected then raise exception 'ASSESSMENT_COMPLETION_RULE_FAILED: % / %',fixture.status,fixture.source; end if;
  end loop;
  if not public.student_assessment_is_complete('attended',now(),null,'teacher',null,null,'','') then raise exception 'TEACHER_COMPLETION_LOST'; end if;
  if has_function_privilege('authenticated','public.student_assessment_is_complete(text,timestamptz,timestamptz,text,numeric,text,text,text)','EXECUTE')
    or has_function_privilege('anon','public.get_student_lifecycle(uuid,uuid)','EXECUTE') then raise exception 'PRIVATE_ASSESSMENT_RULE_EXPOSED'; end if;
end;
$rules$;

-- 同名对象分别按稳定关联读取；所有业务 fixture 在保存点内回滚。
savepoint assessment_stage_fixture;
do $fixture$
declare actor uuid; outsider uuid; subject uuid:=gen_random_uuid(); same_name uuid:=gen_random_uuid(); activity uuid:=gen_random_uuid();
  registration uuid:=gen_random_uuid(); result_id uuid:=gen_random_uuid(); row jsonb; entry jsonb; compact jsonb; page jsonb; err text;
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  select id into outsider from auth.users where email='test-teacher@mathin.local';
  if actor is null or outsider is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values(subject,'assessment-stage-fixture','assessment-stage-fixture','600000008831','600000008831','uncontacted',actor,actor),
      (same_name,'assessment-stage-fixture','assessment-stage-fixture','600000008832','600000008832','uncontacted',actor,actor);
  insert into public.activities(id,kind,title,scheduled_at,created_by) values(activity,'assessment_1v1','assessment-stage-fixture',now(),actor);
  insert into public.activity_registrations(id,activity_id,lead_id,status,operated_by) values(registration,activity,subject,'attended',actor);
  insert into public.assessment_results(id,activity_registration_id,lead_id,overall_level,strengths,parent_concerns,assessed_by,result_source)
    values(result_id,registration,subject,'developing','学生观察：按步骤完成任务','家长关注：课堂参与',actor,'legacy');
  select row_data into row from public.student_list_facts('all',subject::text,'records','awaiting_enrollment');
  entry:=public.read_student_record_subject(null,subject);
  compact:=public.list_student_record_summaries('awaiting_enrollment','all',subject::text,'records')->'rows'->0;
  page:=public.list_student_records_page('awaiting_enrollment','all',subject::text,'records',1,20,'{"version":2,"filters":{},"sort":null}','zh','{}');
  if row->>'stage'<>'awaiting_enrollment' or entry->>'stage'<>row->>'stage' or compact->>'stage'<>row->>'stage'
    or page->'rows'->0->>'stage'<>row->>'stage' or public.get_student_lifecycle(null,subject)<>row->>'stage' then raise exception 'ASSESSMENT_STAGE_READERS_DISAGREE'; end if;
  if row->>'detail'='unassigned' or entry->>'detail'='unassigned' then raise exception 'ASSESSMENT_DETAIL_REGRESSED'; end if;
  if row->>'assessmentSource'<>'assessment' or row->>'assessmentRecordId'<>result_id::text or row->>'registrationId'<>registration::text
    or entry->>'registrationId'<>registration::text then raise exception 'ASSESSMENT_CONTEXT_LOST'; end if;
  if row->>'score' is not null or row->>'assessmentBand' is not null then raise exception 'ASSESSMENT_SCORE_INVENTED'; end if;
  if public.get_student_lifecycle(null,same_name)<>'awaiting_first_contact' then raise exception 'SAME_NAME_IDENTITIES_MERGED'; end if;
  update public.assessment_results set strengths='',parent_concerns='' where id=result_id;
  if public.read_student_record_subject(null,subject)->>'stage'='awaiting_enrollment' then raise exception 'EMPTY_ASSESSMENT_ADVANCED'; end if;
  update public.assessment_results set strengths='测评草稿',result_source='quick_entry',result_finalized_at=null where id=result_id;
  if public.read_student_record_subject(null,subject)->>'stage'='awaiting_enrollment'
    or public.get_student_lifecycle(null,subject)='awaiting_enrollment' then raise exception 'ASSESSMENT_DRAFT_ADVANCED'; end if;
  update public.assessment_results set result_finalized_at=now() where id=result_id;
  if public.read_student_record_subject(null,subject)->>'stage'<>'awaiting_enrollment' then raise exception 'FINAL_ASSESSMENT_MISSING'; end if;
  update public.activity_registrations set status='no_show' where id=registration;
  if public.read_student_record_subject(null,subject)->>'stage'='awaiting_enrollment'
    or public.get_student_lifecycle(null,subject)='awaiting_enrollment' then raise exception 'NO_SHOW_ASSESSMENT_ADVANCED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin perform public.read_student_record_subject(null,subject); raise exception 'OTHER_OWNER_DETAIL_LEAK';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.get_student_lifecycle(null,subject); raise exception 'ANONYMOUS_LIFECYCLE_LEAK';
    exception when others then get stacked diagnostics err=message_text; if err<>'UNAUTHENTICATED' then raise; end if; end;
end;
$fixture$;
rollback to savepoint assessment_stage_fixture;

-- 当前与历史的真实资料只读核对：后续报名状态保持，列表、详情和阶段总数一致。
do $existing$
declare population text; stage text; expected jsonb; actual jsonb;
begin
  if exists(select 1 from assessment_stage_before b full join public.student_record_index_with_enrollments('all','',
    array(select e from public.business_course_enrollment_subjects e)) a using(key)
    where a.key is null or b.key is null or (a.stage<>b.stage and not (b.stage in ('awaiting_first_contact','awaiting_assessment') and a.stage='awaiting_enrollment')))
    then raise exception 'UNEXPECTED_STUDENT_STAGE_CHANGE'; end if;
  foreach population in array array['work','records'] loop
    foreach stage in array array['awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student'] loop
      expected:=public.list_student_record_summaries(stage,'all','',population);
      select jsonb_build_object('keys',coalesce(jsonb_agg(row_data->>'key' order by row_data->>'key') filter(where row_data is not null),'[]'::jsonb),
        'counts',(select jsonb_object_agg(index_stage,n) from (select index_stage,count(*) n from public.student_list_facts('all','',population,stage) group by index_stage) counts))
        into actual from public.student_list_facts('all','',population,stage);
      if actual->'keys' is distinct from (select coalesce(jsonb_agg(value->>'key' order by value->>'key'),'[]'::jsonb) from jsonb_array_elements(expected->'rows'))
        or actual->'counts' is distinct from expected->'counts' then raise exception 'STUDENT_LIST_COUNTS_DISAGREE: % / %',population,stage; end if;
    end loop;
  end loop;
end;
$existing$;
select jsonb_build_object('changedSubjects',(select count(*) from assessment_stage_before b
  join public.student_record_index_with_enrollments('all','',array(select e from public.business_course_enrollment_subjects e)) a using(key) where a.stage<>b.stage),
  'workCounts',(select jsonb_object_agg(index_stage,n) from (select index_stage,count(*) n from public.student_list_facts('all','','work','awaiting_enrollment') group by index_stage) c),
  'completionRules','PASS','listAndDetailAgreement','PASS','scopeChecks','PASS','fixturesRolledBack',true);
