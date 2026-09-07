do $tests$
declare v_admin uuid:=current_setting('mathin.assertion.admin')::uuid; v_support uuid:=current_setting('mathin.assertion.support')::uuid;
  v_other uuid:=current_setting('mathin.assertion.other')::uuid; v_lead uuid; v_invitation uuid; v_activity uuid; v_registration uuid;
  v_teacher uuid:=current_setting('mathin.assertion.teacher')::uuid;
  v_at timestamptz:=date_trunc('day',now())+interval '1 day 2 hours'; v_slot text;
begin
  perform set_config('request.jwt.claim.sub',v_admin::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,created_by)
    values('Closed assessment assertion','closed assessment assertion','0000000199','0000000199',5,v_support,v_admin) returning id into v_lead;
  v_slot:=to_char(v_at at time zone 'Asia/Shanghai','YYYY-MM-DD"@"HH24:MI');
  insert into public.lead_invitation_threads(lead_id,kind,state,scheduled_at,parent_time_options,assessor_time_options,assessor_id,created_by,updated_by,closed_by,closed_at)
    values(v_lead,'assessment_1v1','cancelled',v_at,array[v_slot],array[v_slot],v_teacher,v_support,v_support,v_support,now()) returning id into v_invitation;
  insert into public.activities(kind,title,scheduled_at,created_by)
    values('assessment_1v1','Closed assessment assertion',now(),v_support) returning id into v_activity;
  insert into public.activity_registrations(activity_id,lead_id,status,operated_by)
    values(v_activity,v_lead,'cancelled',v_support) returning id into v_registration;
  perform set_config('request.jwt.claim.sub',v_support::text,true);execute 'set local role authenticated';
  if not exists(select 1 from public.assessment_workbench_read_order where id='invitation:'||v_invitation::text)
    or not exists(select 1 from public.assessment_workbench_read_order where id='registration:'||v_registration::text) then raise exception 'CANCELLED_ORDER_KEY_MISSING';end if;
  execute 'reset role';perform set_config('request.jwt.claim.sub',v_other::text,true);execute 'set local role authenticated';
  if exists(select 1 from public.assessment_workbench_read_order where id='invitation:'||v_invitation::text)
    is distinct from exists(select 1 from public.lead_invitation_threads where id=v_invitation)
    or exists(select 1 from public.assessment_workbench_read_order where id='registration:'||v_registration::text)
    is distinct from exists(select 1 from public.activity_registrations r join public.activities a on a.id=r.activity_id where r.id=v_registration)
    then raise exception 'CANCELLED_ORDER_SCOPE_LEAK';end if;
  execute 'reset role';
end $tests$;
