-- Run only in a rollback transaction on the identified local development database.
create function pg_temp.expect_report_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $check$
#variable_conflict use_variable
declare actor uuid; parent_id uuid; outsider uuid; student uuid:=gen_random_uuid(); activity uuid:=gen_random_uuid(); reg uuid:=gen_random_uuid();
  report_id uuid:=gen_random_uuid(); feedback_id uuid:=gen_random_uuid(); feedback_revision uuid; sess uuid; term uuid; cfg jsonb; templates jsonb; before_template jsonb; rev integer; rows jsonb;
begin
  select id into actor from profiles where purpose='test' and role='admin' and id=(select id from auth.users where email='test-admin@mathin.local');
  select id into parent_id from profiles where purpose='test' and id=(select id from auth.users where email='test-parent@mathin.local');
  select id into outsider from profiles where purpose='test' and id=(select id from auth.users where email='test-parent-unbound@mathin.local');
  if actor is null or parent_id is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  select id,term_id into sess,term from class_sessions where term_id is not null and deleted_at is null order by scheduled_at desc limit 1;
  if sess is null then raise exception 'DEVELOPMENT_SESSION_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  cfg:=coalesce((public.miniapp_settings_workbench()->'draft'),null);
  if cfg is null or cfg='null' then
    cfg:=jsonb_build_object('version',1,'brand',jsonb_build_object('name',jsonb_build_object('zh','报告检查','en','Report fixture'),'introduction',jsonb_build_object('zh','','en',''),'image','','theme','paper'),
      'home','[]'::jsonb,'floating','[]'::jsonb,'accountGroups','[]'::jsonb,'stages',jsonb_build_array(jsonb_build_object('id','all','label',jsonb_build_object('zh','阶段','en','Stages'),
      'stages',(select jsonb_agg(jsonb_build_object('id',case when n<1 then 'k'||(n+3)::text else 'g'||n::text end,'stageNumber',n,'label',jsonb_build_object('zh',n::text,'en',n::text),'visible',true)) from generate_series(-1,12) n))));
  end if;
  templates:=jsonb_build_object('assessment',mathin_internal.default_miniapp_report_sections('assessment'),'feedback',mathin_internal.default_miniapp_report_sections('feedback'));
  cfg:=cfg||jsonb_build_object('reports',templates); rev:=(public.miniapp_settings_workbench()->>'revision')::integer;
  before_template:=public.miniapp_report_template('assessment');
  perform public.save_miniapp_settings(jsonb_set(cfg,'{reports,assessment,0,label,zh}','"草稿观察"'),rev,false);
  if public.miniapp_report_template('assessment')<>before_template then raise exception 'DRAFT_TEMPLATE_LEAK'; end if;
  perform public.save_miniapp_settings(jsonb_set(cfg,'{reports,assessment,0,label,zh}','"第一版观察"'),rev+1,true);
  insert into students(id,name,bind_code,created_by,assigned_to) values(student,'Report template fixture',student::text,actor,actor);
  insert into student_guardians(student_id,guardian_id,relation,scope,is_primary) values(student,parent_id,'监护人',array['grades','activities'],true);
  insert into activities(id,kind,title,scheduled_at,capacity,created_by) values(activity,'lecture','Report template fixture',now(),20,actor);
  insert into activity_registrations(id,activity_id,student_id,operated_by) values(reg,activity,student,actor);
  insert into assessment_reports(id,registration_id,version,payload,content_hash,created_by) values(report_id,reg,1,'{"activityTitle":"Report fixture","teacherObservation":"Observation","score":0,"totalScore":10}',report_id::text,actor);
  select miniapp_report_template into before_template from assessment_reports where id=report_id;
  if before_template#>>'{sections,0,label,zh}'<>'第一版观察' then raise exception 'ASSESSMENT_SNAPSHOT_MISSING'; end if;
  insert into assessment_workflow_states(registration_id,stage,report_id,updated_by) values(reg,'feedback',report_id,actor);
  insert into learning_result_heads(id,kind,source_key,student_id,term_id,session_id,created_by) values(feedback_id,'session_review',sess::text||':'||student::text,student,term,sess,actor);
  feedback_revision:=public.append_learning_result_revision(feedback_id,'{"comment":"Feedback fixture","exitScore":0}',null,null,null,null,null,'{}',actor);
  if (select miniapp_report_template#>>'{sections,0,label,zh}' from learning_result_revisions where id=feedback_revision)<>'课堂反馈' then raise exception 'FEEDBACK_SNAPSHOT_MISSING'; end if;
  perform public.save_miniapp_settings(jsonb_set(jsonb_set(cfg,'{reports,assessment,0,label,zh}','"第二版观察"'),'{reports,feedback,0,label,zh}','"新的反馈"'),rev+2,true);
  if (select miniapp_report_template from assessment_reports where id=report_id)<>before_template
    or (select miniapp_report_template#>>'{sections,0,label,zh}' from learning_result_revisions where id=feedback_revision)<>'课堂反馈' then raise exception 'PRIOR_TEMPLATE_CHANGED'; end if;
  perform pg_temp.expect_report_error(format('update public.learning_result_revisions set miniapp_report_template=null where id=%L',feedback_revision),'IMMUTABLE');
  perform pg_temp.expect_report_error(format('update public.assessment_reports set miniapp_report_template=null where id=%L',report_id),'ENROLLMENT_HISTORY_APPEND_ONLY');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  if exists(select 1 from jsonb_array_elements(public.miniapp_assessment_reports()) r where r->>'id'=report_id::text)
    or exists(select 1 from jsonb_array_elements(public.miniapp_feedback_reports('-infinity','infinity')) r where r->>'participantId'=student::text) then raise exception 'UNPUBLISHED_REPORT_VISIBLE'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  update assessment_workflow_states set sent_report_id=report_id,sent_at=now(),sent_by=actor where registration_id=reg;
  update learning_result_heads set status='published',published_revision_id=feedback_revision,published_by=actor,published_at=now() where id=feedback_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  select r into rows from jsonb_array_elements(public.miniapp_assessment_reports()) r where r->>'id'=report_id::text;
  if rows->'template' is distinct from before_template then raise exception 'ASSESSMENT_PROJECTED_TEMPLATE'; end if;
  select r into rows from jsonb_array_elements(public.miniapp_feedback_reports('-infinity','infinity')) r where r->>'participantId'=student::text;
  if rows#>>'{template,sections,0,label,zh}' is distinct from '课堂反馈' or rows->>'score' is distinct from '0' then raise exception 'FEEDBACK_PROJECTED_TEMPLATE'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated','aal','aal1')::text,true);
  if exists(select 1 from jsonb_array_elements(public.miniapp_assessment_reports()) r where r->>'id'=report_id::text)
    or exists(select 1 from jsonb_array_elements(public.miniapp_feedback_reports('-infinity','infinity')) r where r->>'participantId'=student::text) then raise exception 'OUTSIDER_REPORT_VISIBLE'; end if;
  if has_function_privilege('anon','public.miniapp_feedback_reports(timestamptz,timestamptz)','execute') then raise exception 'ANON_REPORT_ACCESS'; end if;
end $check$;
