-- 由本机核对脚本包在可回滚事务中；复用固定开发账号，不创建账号或学生档案。
do $tests$
declare
  v_admin uuid; v_support uuid; v_teacher uuid; v_unrelated uuid;
  v_activity uuid; v_registration uuid; v_strict uuid; v_invitation uuid; v_lead uuid; v_materialized uuid;
  v_paper uuid; v_version uuid; v_question uuid; v_event uuid; v_response jsonb; v_before jsonb;
  v_values jsonb:=jsonb_build_object('assessmentBand','a_plus','score',78,'strengths','Quick-entry strengths','focusAreas','',
    'parentConcerns','Parent feedback before teacher entry','teacherRecommendation','Support recommendation','recommendedClass','','route','continue_follow_up');
  v_rejected boolean;
  v_at timestamptz:=date_trunc('day',now())+interval '1 day 2 hours';
  v_slot text;
begin
  v_slot:=to_char(v_at at time zone 'Asia/Shanghai','YYYY-MM-DD"@"HH24:MI');
  select id into v_admin from auth.users where email='test-admin@mathin.local';
  select id into v_support from auth.users where email='test-sales@mathin.local';
  select id into v_teacher from auth.users where email='test-teacher@mathin.local';
  select id into v_unrelated from auth.users where email='test-research@mathin.local';
  if num_nonnulls(v_admin,v_support,v_teacher,v_unrelated)<>4 or not public.has_perm(v_support,'followup.write')
    or not public.has_perm(v_teacher,'review.write') then raise exception 'FIXED_ASSESSMENT_FIXTURES_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if public.is_feature_enabled('assessment.require_teacher_completion') then raise exception 'DEFAULT_MUST_BE_OPTIONAL'; end if;
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,created_by)
    values('Quick assertion lead','quick assertion lead','0000000101','0000000101',5,v_support,v_admin) returning id into v_lead;
  insert into public.lead_invitation_threads(lead_id,kind,state,scheduled_at,parent_time_options,assessor_time_options,assessor_id,created_by,updated_by)
    values(v_lead,'assessment_1v1','confirmed',v_at,array[v_slot],array[v_slot],v_teacher,v_support,v_support) returning id into v_invitation;
  insert into public.activities(kind,title,scheduled_at,created_by,source_invitation_id) values('assessment_1v1','Quick assessment assertion',now(),v_admin,v_invitation) returning id into v_activity;
  insert into public.activity_registrations(activity_id,lead_id,status,operated_by) values(v_activity,v_lead,'booked',v_admin) returning id into v_registration;
  if public.can_record_teacher_assessment(v_registration,v_support) then raise exception 'SUPPORT_MUST_NOT_HAVE_ASSIGNED_TEACHER_SCOPE'; end if;

  perform set_config('request.jwt.claim.sub',v_support::text,true);
  execute 'set local role authenticated';
  v_response:=public.save_assessment_quick_entry(v_registration,null,v_values,0);
  if v_response#>>'{assessment,result_source}'<>'quick_entry' or v_response#>>'{assessment,assessed_by}'<>v_support::text
    or v_response#>>'{entry,finalized_at}' is null or v_response#>>'{assessment,score}'<>'78'
    or not exists(select 1 from public.activity_routes where activity_registration_id=v_registration and route='continue_follow_up' and routed_by=v_support)
    then raise exception 'SUPPORT_QUICK_RESULT_FAILED' using detail=v_response::text||'; visible_route='||(exists(select 1 from public.activity_routes where activity_registration_id=v_registration))::text; end if;
  if exists(select 1 from public.activity_registrations where id=v_registration and assessment_completed_at is not null)
    then raise exception 'QUICK_ENTRY_IMPERSONATED_TEACHER_COMPLETION'; end if;
  v_rejected:=false;
  begin perform public.save_assessment_quick_entry(v_registration,null,v_values,0);
  exception when others then if position('ASSESSMENT_ENTRY_CONFLICT' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'STALE_ENTRY_ALLOWED'; end if;
  v_rejected:=false;
  begin perform public.set_feature_flag_v2('assessment.require_teacher_completion',true,now(),'support cannot change policy');
  exception when others then if position('FORBIDDEN' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'SUPPORT_CHANGED_POLICY'; end if;
  v_rejected:=false;
  begin update public.assessment_quick_entries set recorded_by=v_teacher where registration_id=v_registration;
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'QUICK_AUTHOR_FORGERY_ALLOWED'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform public.set_feature_flag_v2('assessment.require_teacher_completion',true,now(),'strict result assertion');
  if not public.is_feature_enabled('assessment.require_teacher_completion') then raise exception 'ADMIN_POLICY_DID_NOT_ENABLE'; end if;
  -- 开关开启保留既有结果，后续新的快速登记只能形成草稿。
  if not exists(select 1 from public.assessment_results where activity_registration_id=v_registration and result_finalized_at is not null)
    then raise exception 'POLICY_REMOVED_EXISTING_RESULT'; end if;
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,created_by)
    values('Strict assertion lead','strict assertion lead','0000000102','0000000102',5,v_support,v_admin) returning id into v_lead;
  insert into public.lead_invitation_threads(lead_id,kind,state,scheduled_at,parent_time_options,assessor_time_options,assessor_id,created_by,updated_by)
    values(v_lead,'assessment_1v1','confirmed',v_at,array[v_slot],array[v_slot],v_teacher,v_support,v_support) returning id into v_invitation;
  insert into public.activities(kind,title,scheduled_at,created_by,source_invitation_id) values('assessment_1v1','Strict assessment assertion',now(),v_admin,v_invitation) returning id into v_activity;
  insert into public.activity_registrations(activity_id,lead_id,status,operated_by) values(v_activity,v_lead,'booked',v_admin) returning id into v_strict;
  perform set_config('request.jwt.claim.sub',v_support::text,true);
  execute 'set local role authenticated';
  v_response:=public.save_assessment_quick_entry(v_strict,null,v_values,0);
  if v_response->'assessment'<>'null'::jsonb or v_response#>>'{entry,finalized_at}' is not null
    or v_response#>>'{entry,entry,score}'<>'78' or v_response->>'teacherRequired'<>'true' then raise exception 'STRICT_DRAFT_CONTRACT_FAILED'; end if;
  v_response:=public.get_activity_enrollment_context(v_strict,null);
  if (v_response->>'eligible')::boolean or not (v_response->>'canContactBeforeCompletion')::boolean then raise exception 'STRICT_CONTACT_ELIGIBILITY_FAILED'; end if;
  perform public.save_post_activity_contact(v_strict,gen_random_uuid(),'phone','connected','await_product','Feedback before teacher',null);
  if not exists(select 1 from public.activity_followup_contacts where registration_id=v_strict and recorded_by=v_support and note='Feedback before teacher')
    then raise exception 'CONTACT_BEFORE_TEACHER_BLOCKED'; end if;
  -- 旧 API 不能绕过开关。
  perform public.save_activity_assessment_row(v_strict,'s',90::smallint,'','','legacy caller','','');
  if exists(select 1 from public.assessment_results where activity_registration_id=v_strict) then raise exception 'LEGACY_API_BYPASSED_POLICY'; end if;
  execute 'reset role';

  -- 逐题教师仍独立完成专业记录，之后的学服保存不覆盖它。
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  insert into public.assessment_papers(title,source,created_by) values('Optional assessment assertion paper','internal',v_admin) returning id into v_paper;
  insert into public.assessment_paper_versions(paper_id,version_no,status,question_count,total_score,created_by)
    values(v_paper,1,'draft',1,10,v_admin) returning id into v_version;
  insert into public.assessment_paper_questions(paper_version_id,position,question_no,prompt,knowledge_point,max_score,quick_scores)
    values(v_version,1,'1','Assertion question','Reasoning',10,'{"explained":10,"independent":10,"prompted":6,"imitated":3,"incomplete":0}') returning id into v_question;
  update public.assessment_paper_versions set status='published',published_at=now() where id=v_version;
  perform set_config('request.jwt.claim.sub',v_teacher::text,true);
  execute 'set local role authenticated';
  perform public.bind_teacher_assessment_paper(v_strict,v_version);
  perform public.save_teacher_assessment_question(v_strict,v_question,'explained',10::smallint,'Teacher question evidence');
  if exists(select 1 from public.assessment_results where activity_registration_id=v_strict and result_finalized_at is not null)
    then raise exception 'PARTIAL_TEACHER_RESULT_FINALIZED'; end if;
  perform public.save_teacher_assessment_observation(v_strict,'Teacher-only conclusion');
  perform public.complete_teacher_assessment(v_strict);
  select to_jsonb(a) into v_before from public.assessment_results a where activity_registration_id=v_strict;
  if v_before->>'result_source'<>'teacher' or v_before->>'result_finalized_at' is null or v_before->>'assessed_by'<>v_teacher::text
    then raise exception 'TEACHER_COMPLETION_PROVENANCE_FAILED'; end if;
  perform set_config('request.jwt.claim.sub',v_support::text,true);
  perform public.save_assessment_quick_entry(v_strict,null,v_values||'{"score":65,"parentConcerns":"Later support feedback"}',2);
  if v_before is distinct from (select to_jsonb(a) from public.assessment_results a where activity_registration_id=v_strict)
    then raise exception 'SUPPORT_OVERWROTE_TEACHER_RESULT'; end if;
  if (select count(*) from public.assessment_entry_actors where registration_id=v_strict)<>2
    or not exists(select 1 from public.assessment_entry_actors where registration_id=v_strict and entry_kind='teacher' and recorded_by=v_teacher)
    or not exists(select 1 from public.assessment_entry_actors where registration_id=v_strict and entry_kind='quick_entry' and recorded_by=v_support)
    then raise exception 'CONTRIBUTORS_NOT_SEPARATE'; end if;
  v_rejected:=false;
  begin update public.assessment_entry_events set recorded_by=v_teacher where registration_id=v_strict;
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'AUDIT_UPDATE_ALLOWED'; end if;
  execute 'reset role';

  -- 非本学生范围与非员工不能读取快速登记，也不能伪造保存者。
  perform set_config('request.jwt.claim.sub',v_unrelated::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.assessment_quick_entries where registration_id=v_strict)
    or exists(select 1 from public.assessment_entry_actors where registration_id=v_strict) then raise exception 'OUT_OF_SCOPE_READ_ALLOWED'; end if;
  v_rejected:=false;
  begin perform public.save_assessment_quick_entry(v_strict,null,v_values,3);
  exception when others then if position('FORBIDDEN' in sqlerrm)=0 then raise; end if; v_rejected:=true; end;
  if not v_rejected then raise exception 'OUT_OF_SCOPE_WRITE_ALLOWED'; end if;
  execute 'reset role';

  -- 只有预约且还没有 Participation 的情况，也能先记反馈和归类；不伪造到场或逐题完成。
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,created_by)
    values('Quick assessment assertion lead','quick assessment assertion lead','0000000103','0000000103',5,v_support,v_admin) returning id into v_lead;
  insert into public.lead_invitation_threads(lead_id,kind,state,scheduled_at,parent_time_options,assessor_time_options,assessor_id,created_by,updated_by)
    values(v_lead,'assessment_1v1','confirmed',v_at,array[v_slot],array[v_slot],v_teacher,v_support,v_support) returning id into v_invitation;
  perform set_config('request.jwt.claim.sub',v_support::text,true);
  execute 'set local role authenticated';
  v_response:=public.save_assessment_quick_entry(null,v_invitation,v_values||'{"score":null,"assessmentBand":null,"strengths":"","teacherRecommendation":""}',0);
  v_materialized:=(v_response->>'registrationId')::uuid;
  if v_materialized is null or v_response->>'participationStatus'<>'booked' or v_response->'assessment'<>'null'::jsonb
    then raise exception 'INVITATION_FEEDBACK_MATERIALIZATION_FAILED'; end if;
  if not exists(select 1 from public.lead_invitation_threads where id=v_invitation and assessor_id=v_teacher)
    then raise exception 'QUICK_ENTRY_REASSIGNED_TEACHER'; end if;
  execute 'reset role';
  -- 关闭开关后，原草稿可直接生成结果，无需补填逐题信息。
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform public.set_feature_flag_v2('assessment.require_teacher_completion',false,now(),'optional result assertion');
  perform set_config('request.jwt.claim.sub',v_support::text,true);
  execute 'set local role authenticated';
  v_response:=public.save_assessment_quick_entry(v_materialized,null,v_values,1);
  if v_response#>>'{assessment,result_source}'<>'quick_entry' or v_response#>>'{entry,finalized_at}' is null
    then raise exception 'DISABLED_POLICY_DID_NOT_ALLOW_RESULT'; end if;
  execute 'reset role';
end $tests$;
