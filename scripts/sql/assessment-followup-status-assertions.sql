-- 固定开发身份，所有业务夹具随外层事务回滚。
do $tests$
declare
  v_admin uuid:=nullif(current_setting('mathin.assertion.admin',true),'')::uuid;
  v_support uuid:=nullif(current_setting('mathin.assertion.support',true),'')::uuid;
  v_other uuid:=nullif(current_setting('mathin.assertion.other',true),'')::uuid;
  v_teacher uuid:=nullif(current_setting('mathin.assertion.teacher',true),'')::uuid;
  v_at timestamptz:=date_trunc('day',now())+interval '1 day 2 hours'; v_slot text;
  v_lead uuid; v_invitation uuid; v_reg uuid; v_activity uuid; v_report uuid; v_r jsonb; v_revision integer;
  v_count bigint; v_enrollments bigint; v_rejected boolean; v_snapshot jsonb;
  v_entry jsonb:='{"assessmentBand":"a_plus","score":78,"strengths":"Reasoning","focusAreas":"Checking","parentConcerns":"PRIVATE_NOTE","teacherRecommendation":"Practice","recommendedClass":"Level A","route":null}';
begin
  if num_nonnulls(v_admin,v_support,v_other,v_teacher)<>4 then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,created_by)
    values('Followup status assertion','followup status assertion','0000000198','0000000198',5,v_support,v_admin) returning id into v_lead;
  v_slot:=to_char(v_at at time zone 'Asia/Shanghai','YYYY-MM-DD"@"HH24:MI');
  insert into public.lead_invitation_threads(lead_id,kind,state,scheduled_at,parent_time_options,assessor_time_options,assessor_id,created_by,updated_by)
    values(v_lead,'assessment_1v1','confirmed',v_at,array[v_slot],array[v_slot],v_teacher,v_support,v_support) returning id into v_invitation;
  select count(*) into v_enrollments from public.course_enrollments;
  perform set_config('request.jwt.claim.sub',v_support::text,true);execute 'set local role authenticated';
  v_rejected:=false;
  begin perform public.save_assessment_workflow(null,v_invitation,'visit',0,'{"stage":"handled"}');
  exception when others then if sqlerrm<>'ASSESSMENT_NAVIGATION_READ_ONLY' then raise;end if;v_rejected:=true;end;
  if not v_rejected or exists(select 1 from public.activities where source_invitation_id=v_invitation) then raise exception 'NAVIGATION_CREATED_FACTS';end if;
  v_r:=public.save_assessment_workflow(null,v_invitation,'classify',0,'{"classification":null,"parentResponse":"","reasons":[],"nextContactAt":null,"trialIntent":true}');
  v_reg:=(v_r->>'registrationId')::uuid;v_activity:=(v_r->>'activityId')::uuid;v_revision:=(v_r#>>'{state,revision}')::integer;
  if v_r#>>'{state,trial_intent}'<>'true' or v_r#>>'{state,classification}' is not null then raise exception 'TRIAL_INTEREST_ONLY_FAILED';end if;
  v_r:=public.save_assessment_workflow(v_reg,null,'classify',v_revision,'{"classification":"considering","parentResponse":"Would like a trial first","reasons":[],"nextContactAt":null,"trialIntent":true}');
  v_revision:=(v_r#>>'{state,revision}')::integer;
  if v_r#>>'{state,trial_intent}'<>'true' or v_r#>>'{state,classification}'<>'considering' or v_r#>>'{state,contacted_at}' is null
    or v_r#>>'{state,finalized_at}' is not null or v_r->>'participationStatus'<>'booked' then raise exception 'TRIAL_INTENT_WITHOUT_SCHEDULE_FAILED';end if;
  if exists(select 1 from public.activities where id=v_activity and kind<>'assessment_1v1') then raise exception 'TRIAL_INTENT_CREATED_TRIAL';end if;
  perform public.save_assessment_quick_entry(v_reg,null,v_entry,0);
  select revision into v_revision from public.assessment_workflow_states where registration_id=v_reg;
  v_r:=public.save_assessment_workflow(v_reg,null,'report',v_revision,'{}');
  v_revision:=(v_r#>>'{state,revision}')::integer;v_report:=(v_r#>>'{state,report_id}')::uuid;
  if v_report is null or v_r#>>'{state,sent_at}' is not null then raise exception 'REPORT_PREPARATION_CONFIRMED_SEND';end if;
  select payload into v_snapshot from public.assessment_reports where id=v_report;
  if v_snapshot::text like '%PRIVATE_NOTE%' then raise exception 'REPORT_EXPOSED_INTERNAL_NOTE';end if;
  v_r:=public.save_assessment_workflow(v_reg,null,'classify',v_revision,jsonb_build_object('classification',null,'parentResponse','Report explained; waiting for reply',
    'reasons','[]'::jsonb,'nextContactAt',null,'trialIntent',true,'sharedReportId',v_report));v_revision:=(v_r#>>'{state,revision}')::integer;
  if v_r#>>'{state,sent_report_id}'<>v_report::text or v_r#>>'{state,finalized_at}' is null then raise exception 'CONTACT_REPORT_CONFIRMATION_FAILED';end if;
  select count(*) into v_count from public.assessment_workflow_events where registration_id=v_reg;
  v_r:=public.save_assessment_workflow(v_reg,null,'classify',v_revision,'{"classification":"considering","parentResponse":"Follow up next week","reasons":["schedule"],"nextContactAt":null,"trialIntent":true}');
  v_revision:=(v_r#>>'{state,revision}')::integer;
  if (select count(*) from public.assessment_workflow_events where registration_id=v_reg)<>v_count+1
    or v_r#>>'{state,trial_intent}'<>'true' then raise exception 'ONGOING_CONTACT_WAS_LOCKED';end if;
  v_rejected:=false;begin perform public.save_assessment_quick_entry(v_reg,null,v_entry,1);
  exception when others then if sqlerrm<>'ASSESSMENT_WORKFLOW_FINALIZED' then raise;end if;v_rejected:=true;end;
  if not v_rejected then raise exception 'RESULT_REVISION_GUARD_LOST';end if;
  v_rejected:=false;begin perform public.save_assessment_workflow(v_reg,null,'classify',v_revision-1,'{"classification":"considering","parentResponse":"stale","reasons":[],"nextContactAt":null}');
  exception when others then if sqlerrm<>'ASSESSMENT_WORKFLOW_CONFLICT' then raise;end if;v_rejected:=true;end;
  if not v_rejected then raise exception 'STALE_CONTACT_ALLOWED';end if;
  v_rejected:=false;begin update public.assessment_workflow_states set trial_intent=false where registration_id=v_reg;
  exception when insufficient_privilege then v_rejected:=true;end;
  if not v_rejected then raise exception 'DIRECT_STATE_WRITE_ALLOWED';end if;
  execute 'reset role';perform set_config('request.jwt.claim.sub',v_other::text,true);execute 'set local role authenticated';
  if exists(select 1 from public.assessment_workflow_states where registration_id=v_reg) then raise exception 'OUT_OF_SCOPE_STATE_VISIBLE';end if;
  v_rejected:=false;begin perform public.save_assessment_workflow(v_reg,null,'classify',v_revision,'{"classification":"considering","parentResponse":"forged","reasons":[],"nextContactAt":null}');
  exception when others then if sqlerrm<>'FORBIDDEN_SCOPE' then raise;end if;v_rejected:=true;end;
  if not v_rejected then raise exception 'OUT_OF_SCOPE_CONTACT_ALLOWED';end if;
  execute 'reset role';perform set_config('request.jwt.claim.sub',v_support::text,true);execute 'set local role authenticated';
  v_r:=public.save_assessment_workflow(v_reg,null,'revise',v_revision,'{"reason":"Correct assessment evidence"}');v_revision:=(v_r#>>'{state,revision}')::integer;
  perform public.save_assessment_quick_entry(v_reg,null,jsonb_set(v_entry,'{score}','82'),1);
  select revision into v_revision from public.assessment_workflow_states where registration_id=v_reg;
  v_rejected:=false;begin perform public.save_assessment_workflow(v_reg,null,'classify',v_revision,jsonb_build_object('classification','considering','parentResponse','Old report',
    'reasons','[]'::jsonb,'nextContactAt',null,'sharedReportId',v_report));
  exception when others then if sqlerrm<>'ASSESSMENT_WORKFLOW_CONFLICT' then raise;end if;v_rejected:=true;end;
  if not v_rejected or (select payload from public.assessment_reports where id=v_report)<>v_snapshot then raise exception 'REPORT_VERSION_HISTORY_LOST';end if;
  execute 'reset role';
  v_slot:=to_char((v_at+interval '1 day') at time zone 'Asia/Shanghai','YYYY-MM-DD"@"HH24:MI');
  update public.lead_invitation_threads set scheduled_at=scheduled_at+interval '1 day',parent_time_options=array[v_slot],assessor_time_options=array[v_slot] where id=v_invitation;
  if not exists(select 1 from public.lead_invitation_threads where id=v_invitation and rescheduled_at is not null) then raise exception 'RESCHEDULE_NOT_RECORDED';end if;
  update public.activity_registrations set status='cancelled' where id=v_reg;
  execute 'set local role authenticated';v_rejected:=false;
  begin perform public.save_assessment_workflow(v_reg,null,'classify',v_revision,'{"classification":"considering","parentResponse":"cancelled","reasons":[],"nextContactAt":null}');
  exception when others then if sqlerrm<>'PARTICIPATION_UNAVAILABLE' then raise;end if;v_rejected:=true;end;
  if not v_rejected then raise exception 'CANCELLED_APPOINTMENT_REOPENED';end if;
  execute 'reset role';
  if (select count(*) from public.course_enrollments)<>v_enrollments then raise exception 'INTENT_CREATED_ENROLLMENT';end if;
end $tests$;
