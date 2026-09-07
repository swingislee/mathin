-- 固定开发身份、回滚事务；不创建身份或正式学生记录。
do $tests$
declare
  v_admin uuid; v_support uuid; v_teacher uuid; v_other uuid; v_activity uuid; v_reg uuid; v_lead uuid; v_invitation uuid;
  v_response jsonb; v_rev integer; v_entry_rev integer; v_report uuid; v_count bigint; v_rejected boolean; v_before jsonb; v_after jsonb; v_segment uuid; v_talk uuid;
  v_at timestamptz:=date_trunc('day',now())+interval '1 day 2 hours'; v_slot text;
  v_values jsonb:='{"assessmentBand":"a_plus","score":78,"strengths":"Reasoning","focusAreas":"Checking","parentConcerns":"INTERNAL_NOTE_EXCLUDED","teacherRecommendation":"Weekly practice","recommendedClass":"Level A","route":null}';
begin
  v_admin:=nullif(current_setting('mathin.assertion.admin',true),'')::uuid;
  v_support:=nullif(current_setting('mathin.assertion.support',true),'')::uuid;
  v_teacher:=nullif(current_setting('mathin.assertion.teacher',true),'')::uuid;
  v_other:=nullif(current_setting('mathin.assertion.other',true),'')::uuid;
  if num_nonnulls(v_admin,v_support,v_teacher,v_other)<>4 then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  v_slot:=to_char(v_at at time zone 'Asia/Shanghai','YYYY-MM-DD"@"HH24:MI');
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,created_by)
    values('Stage assertion lead','stage assertion lead','0000000191','0000000191',5,v_support,v_admin) returning id into v_lead;
  insert into public.lead_invitation_threads(lead_id,kind,state,scheduled_at,parent_time_options,assessor_time_options,assessor_id,created_by,updated_by)
    values(v_lead,'assessment_1v1','confirmed',v_at,array[v_slot],array[v_slot],v_teacher,v_support,v_support) returning id into v_invitation;
  perform set_config('request.jwt.claim.sub',v_support::text,true); execute 'set local role authenticated';
  -- 没有 Student 的预约可签到；后续阶段可跳步，不伪造专业完成。
  v_response:=public.save_assessment_workflow(null,v_invitation,'visit',0,'{"stage":"in_progress"}');
  v_reg:=(v_response->>'registrationId')::uuid; v_activity:=(v_response->>'activityId')::uuid; v_rev:=(v_response#>>'{state,revision}')::integer;
  if v_response->>'participationStatus'<>'attended' or v_response#>>'{state,arrived_at}' is null
    or exists(select 1 from public.activity_registrations where id=v_reg and (student_id is not null or assessment_completed_at is not null)) then raise exception 'ARRIVAL_CONTRACT_FAILED'; end if;
  v_response:=public.save_assessment_workflow(v_reg,null,'visit',v_rev,'{"stage":"handled"}'); v_rev:=(v_response#>>'{state,revision}')::integer;
  if v_response#>>'{state,sent_at}' is not null then raise exception 'NO_REPORT_WAS_MARKED_SENT'; end if;
  v_response:=public.save_assessment_workflow(v_reg,null,'classify',v_rev,'{"classification":"considering","parentResponse":"Waiting for a reply","reasons":["schedule"],"nextContactAt":null}'); v_rev:=(v_response#>>'{state,revision}')::integer;
  if v_response#>>'{state,finalized_at}' is null or v_response#>>'{state,sent_at}' is not null then raise exception 'EARLY_CLASSIFICATION_FAILED'; end if;
  select count(*) into v_count from public.assessment_workflow_events where registration_id=v_reg;
  v_before:=v_response->'state';
  v_response:=public.save_assessment_workflow(v_reg,null,'visit',v_rev,'{"stage":"pending"}');
  if v_response->'state'<>v_before or v_response->>'participationStatus'<>'attended'
    or (select count(*) from public.assessment_workflow_events where registration_id=v_reg)<>v_count then raise exception 'FINALIZED_CLICK_MUTATED_FACTS'; end if;
  v_rejected:=false;
  begin perform public.save_assessment_quick_entry(v_reg,null,v_values,0);
  exception when others then if position('ASSESSMENT_WORKFLOW_FINALIZED' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'QUICK_ENTRY_BYPASSED_REVISION'; end if;
  v_rejected:=false;
  begin perform public.save_assessment_workflow(v_reg,null,'revise',v_rev,'{"reason":""}');
  exception when others then if position('VALIDATION' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'EMPTY_REVISION_ALLOWED'; end if;
  v_response:=public.save_assessment_workflow(v_reg,null,'revise',v_rev,'{"reason":"Add assessment evidence"}');
  if v_response#>>'{state,finalized_at}' is not null then raise exception 'REVISION_DID_NOT_OPEN'; end if;
  v_response:=public.save_assessment_quick_entry(v_reg,null,v_values,0); v_entry_rev:=(v_response#>>'{entry,revision}')::integer;
  select revision into v_rev from public.assessment_workflow_states where registration_id=v_reg;
  if not exists(select 1 from public.assessment_workflow_states where registration_id=v_reg and stage='feedback') then raise exception 'RESULT_DID_NOT_ADVANCE'; end if;
  -- 打印快照和发送分开；报告不泄漏内部信息。
  v_response:=public.save_assessment_workflow(v_reg,null,'report',v_rev,'{}'); v_rev:=(v_response#>>'{state,revision}')::integer; v_report:=(v_response#>>'{state,report_id}')::uuid;
  if v_report is null or v_response#>>'{state,sent_at}' is not null then raise exception 'EXPORT_CONFIRMED_SEND'; end if;
  select payload into v_before from public.assessment_reports where id=v_report;
  if v_before::text like '%INTERNAL_NOTE_EXCLUDED%' or v_before ? 'phone' or v_before ? 'parentConcerns' or v_before->>'score'<>'78'
    or v_before->>'resultSource'<>'quick_entry' then raise exception 'PARENT_REPORT_WHITELIST_FAILED'; end if;
  v_response:=public.save_assessment_workflow(v_reg,null,'visit',v_rev,'{"stage":"handled"}'); v_rev:=(v_response#>>'{state,revision}')::integer;
  if v_response#>>'{state,sent_report_id}'<>v_report::text or v_response#>>'{state,sent_by}'<>v_support::text then raise exception 'SEND_VERSION_ACTOR_FAILED'; end if;
  -- 返回待测评撤回签到，保留分数、报告、家长回应与历史发送。
  v_response:=public.save_assessment_workflow(v_reg,null,'visit',v_rev,'{"stage":"pending"}'); v_rev:=(v_response#>>'{state,revision}')::integer;
  if v_response->>'participationStatus'<>'booked' or v_response#>>'{state,arrived_at}' is not null
    or v_response#>>'{state,report_id}'<>v_report::text or v_response#>>'{state,parent_response}'<>'Waiting for a reply'
    or not exists(select 1 from public.assessment_results where activity_registration_id=v_reg and score=78) then raise exception 'WITHDRAW_CHECKIN_REMOVED_EVIDENCE'; end if;
  v_rejected:=false;
  begin perform public.save_assessment_workflow(v_reg,null,'visit',v_rev-1,'{"stage":"feedback"}');
  exception when others then if position('ASSESSMENT_WORKFLOW_CONFLICT' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'STALE_STAGE_WRITE_ALLOWED'; end if;
  -- 后补专业结果使旧发送版本失效，但旧报告保持不可变。
  v_response:=public.save_assessment_quick_entry(v_reg,null,jsonb_set(v_values,'{score}','82'),v_entry_rev);
  select revision into v_rev from public.assessment_workflow_states where registration_id=v_reg;
  if exists(select 1 from public.assessment_workflow_states where registration_id=v_reg and report_id is not null) then raise exception 'OLD_REPORT_REMAINED_CURRENT'; end if;
  v_response:=public.save_assessment_workflow(v_reg,null,'report',v_rev,'{}'); v_rev:=(v_response#>>'{state,revision}')::integer;
  if v_response#>>'{state,report_id}'=v_report::text or v_response#>>'{state,sent_report_id}'<>v_report::text then raise exception 'REPORT_VERSION_REPLACED_HISTORY'; end if;
  select payload into v_after from public.assessment_reports where id=v_report;
  if v_before<>v_after then raise exception 'REPORT_SNAPSHOT_CHANGED'; end if;
  select count(*) into v_count from public.course_enrollments;
  v_response:=public.save_assessment_workflow(v_reg,null,'classify',v_rev,'{"classification":"ready_to_enroll","parentResponse":"Interested","reasons":[],"nextContactAt":null}');
  if (select count(*) from public.course_enrollments)<>v_count then raise exception 'INTENTION_CREATED_ENROLLMENT'; end if;
  v_rejected:=false;
  begin update public.assessment_workflow_states set finalized_at=null where registration_id=v_reg;
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'DIRECT_UNLOCK_ALLOWED'; end if;
  v_rejected:=false;
  begin update public.assessment_reports set payload='{}' where id=v_report;
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'REPORT_FORGERY_ALLOWED'; end if;
  execute 'reset role';
  -- 其他身份不能读报告或写阶段；老师自己的业务范围仍可显式修订。
  perform set_config('request.jwt.claim.sub',v_other::text,true); execute 'set local role authenticated';
  if exists(select 1 from public.assessment_reports where registration_id=v_reg) or exists(select 1 from public.assessment_workflow_events where registration_id=v_reg) then raise exception 'UNRELATED_READ_ALLOWED'; end if;
  v_rejected:=false;
  begin perform public.save_assessment_workflow(v_reg,null,'visit',0,'{"stage":"pending"}');
  exception when others then if position('FORBIDDEN' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'UNRELATED_WRITE_ALLOWED'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',v_teacher::text,true); execute 'set local role authenticated';
  select revision into v_rev from public.assessment_workflow_states where registration_id=v_reg;
  v_response:=public.save_assessment_workflow(v_reg,null,'revise',v_rev,'{"reason":"Teacher review"}');
  if v_response#>>'{state,updated_by}'<>v_teacher::text then raise exception 'REVISION_ACTOR_FORGED'; end if;
  execute 'reset role';
  -- 公开课测评可以出报告；其他环节的空记录不会触发测评进度。
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  insert into public.activities(kind,title,scheduled_at,created_by) values('public_class','Stage group assertion',v_at,v_admin) returning id into v_activity;
  insert into public.activity_registrations(activity_id,lead_id,status,operated_by) values(v_activity,v_lead,'booked',v_admin) returning id into v_reg;
  insert into public.public_class_segments(activity_id,kind,title,scheduled_at,duration_min,position,created_by,updated_by)
    values(v_activity,'parent_talk','Parent talk',v_at,20,1,v_admin,v_admin) returning id into v_talk;
  insert into public.public_class_participant_records(activity_id,segment_id,registration_id,updated_by)
    values(v_activity,v_talk,v_reg,v_admin) on conflict(segment_id,registration_id) do update set updated_by=excluded.updated_by;
  if exists(select 1 from public.assessment_workflow_states where registration_id=v_reg) then raise exception 'NON_ASSESSMENT_RECORD_CHANGED_WORKFLOW'; end if;
  insert into public.public_class_segments(activity_id,kind,title,scheduled_at,duration_min,position,created_by,updated_by)
    values(v_activity,'group_assessment','Group assessment',v_at,20,2,v_admin,v_admin) returning id into v_segment;
  insert into public.public_class_participant_records(activity_id,segment_id,registration_id,assessment_summary,recommendation,parent_feedback,updated_by)
    values(v_activity,v_segment,v_reg,'Group reasoning result','Continue practising','INTERNAL_GROUP_FEEDBACK',v_teacher)
    on conflict(segment_id,registration_id) do update set assessment_summary=excluded.assessment_summary,recommendation=excluded.recommendation,parent_feedback=excluded.parent_feedback,updated_by=excluded.updated_by;
  perform set_config('request.jwt.claim.sub',v_support::text,true); execute 'set local role authenticated';
  select revision into v_rev from public.assessment_workflow_states where registration_id=v_reg;
  v_response:=public.save_assessment_workflow(v_reg,null,'visit',v_rev,'{"stage":"handled"}'); v_rev:=(v_response#>>'{state,revision}')::integer;
  select payload into v_before from public.assessment_reports where id=(v_response#>>'{state,report_id}')::uuid;
  if v_before->>'resultSource'<>'activity' or v_before->>'recordedByName' is null or v_before::text like '%INTERNAL_GROUP_FEEDBACK%'
    or v_before->>'teacherObservation' not like '%Group reasoning result%' then raise exception 'GROUP_REPORT_FAILED'; end if;
  perform public.save_assessment_workflow(v_reg,null,'classify',v_rev,'{"classification":"considering","parentResponse":"Group feedback","reasons":[],"nextContactAt":null}');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  update public.public_class_participant_records set guardian_presence='attended' where segment_id=v_talk and registration_id=v_reg;
end $tests$;
