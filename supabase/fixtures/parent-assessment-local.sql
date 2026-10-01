-- 由 parent-assessment-fixtures-local.mjs 在已核对的 Windows loopback 开发库执行。
-- 复用本机清单中的既有身份；固定业务键首次创建，重放保留已有业务状态。
do $fixture$
declare
  v_admin uuid:=nullif(current_setting('test.parent_preview.admin_user_id'),'')::uuid;
  v_parent uuid:=nullif(current_setting('test.parent_preview.parent_user_id'),'')::uuid;
  v_teacher uuid:=nullif(current_setting('test.parent_preview.teacher_user_id'),'')::uuid;
  v_outsider uuid:=nullif(current_setting('test.parent_preview.outsider_user_id'),'')::uuid;
  v_first uuid:=nullif(current_setting('test.parent_preview.first_student_id'),'')::uuid;
  v_second uuid:=nullif(current_setting('test.parent_preview.second_student_id'),'')::uuid;
  v_class public.classrooms%rowtype;
  v_lead public.leads%rowtype;
  v_request public.lead_invitation_threads%rowtype;
  v_form public.miniapp_forms%rowtype;
  v_intake public.miniapp_intakes%rowtype;
  v_item record;
  v_field jsonb;
  v_answers jsonb:='{}';
  v_answer jsonb;
  v_day date:=(now() at time zone 'Asia/Shanghai')::date+1;
  v_options text[];
  v_request_id constant uuid:='b39b0b02-7000-4000-8000-000000000003';
  v_activity_id constant uuid:='b39b0b02-7000-4000-8000-000000000004';
  v_intake_request constant uuid:='b39b0b02-7000-4000-8000-000000000007';
begin
  if v_admin is null or v_parent is null or v_teacher is null or v_outsider is null
    or v_first is null or v_second is null or v_first=v_second then raise exception 'FIXED_PREVIEW_IDENTITIES_REQUIRED';end if;
  if not exists(select 1 from public.profiles where id=v_admin and role='admin' and is_active and account_status='active')
    or not exists(select 1 from public.profiles where id=v_parent and role='parent' and is_active and account_status='active')
    or not exists(select 1 from public.profiles where id=v_outsider and role='parent' and is_active and account_status='active')
    or not exists(select 1 from public.profiles where id=v_teacher and role='staff' and is_active and account_status='active' and public.has_perm(id,'review.write'))
    then raise exception 'FIXED_PREVIEW_ROLES_REQUIRED';end if;
  if (select count(*) from public.students s join public.profiles p on p.id=s.user_id
      where s.id in(v_first,v_second) and s.deleted_at is null and p.role='student' and p.is_active
        and (s.purpose='test' or p.purpose='test' or s.source='本机小程序固定联调'))<>2
    then raise exception 'FIXED_PREVIEW_STUDENTS_REQUIRED';end if;
  if public.guardian_can(v_first,v_outsider,'grades') or public.guardian_can(v_second,v_outsider,'grades')
    then raise exception 'FIXED_PREVIEW_OUTSIDER_REQUIRED';end if;

  select * into v_class from public.classrooms where invite_code='MINIAPP-LOCAL-20260922' for update;
  if v_class.id is null or v_class.purpose<>'test' or v_class.owner_id<>v_admin
    or v_class.operational_status<>'active' or v_class.archived_at is not null or v_class.trashed_at is not null
    then raise exception 'FIXED_PREVIEW_TEST_CLASS_REQUIRED';end if;
  if (select count(distinct student_id) from public.enrollments
      where classroom_id=v_class.id and student_id in(v_first,v_second) and status='active' and left_at is null)<>2
    then raise exception 'FIXED_PREVIEW_ENROLLMENTS_REQUIRED';end if;
  perform set_config('test.parent_preview.classroom_id',v_class.id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_parent,'role','authenticated','aal','aal2')::text,true);
  if not public.miniapp_can_participate(v_first,'grades') or not public.miniapp_can_participate(v_second,'grades')
    then raise exception 'FIXED_PREVIEW_FAMILY_SCOPE_REQUIRED';end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  for v_item in select * from (values
    ('b39b0b02-7000-4000-8000-000000000001'::uuid,v_first,'开发演示 · 测评参与人一','00000000001'),
    ('b39b0b02-7000-4000-8000-000000000002'::uuid,v_second,'开发演示 · 测评参与人二','00000000002')
  ) seed(id,student_id,label,phone) loop
    perform 1 from public.students where id=v_item.student_id for update;
    select * into v_lead from public.leads where id=v_item.id for update;
    if v_lead.id is not null and (v_lead.student_id is distinct from v_item.student_id
        or v_lead.purpose<>'test' or v_lead.created_by is distinct from v_admin) then raise exception 'PREVIEW_LEAD_OWNERSHIP_CONFLICT';end if;
    if exists(select 1 from public.leads where student_id=v_item.student_id and id<>v_item.id)
      then raise exception 'PREVIEW_LINKED_LEAD_CONFLICT';end if;
    if v_lead.id is null then
      insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,
        owner_id,student_id,identity_confirmed_by,identity_confirmed_at,created_by,purpose)
      values(v_item.id,v_item.label,public.normalize_lead_name(v_item.label),v_item.phone,v_item.phone,'contacted',
        v_admin,v_item.student_id,v_admin,now(),v_admin,'test');
    end if;
  end loop;

  if exists(select 1 from public.classroom_members where classroom_id=v_class.id and user_id=v_teacher and role<>'teacher')
    then raise exception 'PREVIEW_TEACHER_MEMBERSHIP_CONFLICT';end if;
  if not exists(select 1 from public.classroom_staff_assignments where classroom_id=v_class.id and user_id=v_teacher and responsibility='assistant_teacher')
    or not exists(select 1 from public.classroom_members where classroom_id=v_class.id and user_id=v_teacher and role='teacher') then
    perform public.assign_classroom_staff(v_class.id,v_teacher,'assistant_teacher');
  end if;

  -- 孩子一留给人工新申请；孩子二首次经真实申请与教师回复路径进入待确认。
  select * into v_request from public.lead_invitation_threads where id=v_request_id for update;
  if v_request.id is not null then
    if v_request.lead_id<>'b39b0b02-7000-4000-8000-000000000002'::uuid
      or v_request.parent_request_actor is distinct from v_parent
      or v_request.parent_request_payload->>'studentId' is distinct from v_second::text
      then raise exception 'PREVIEW_REQUEST_OWNERSHIP_CONFLICT';end if;
  else
    v_options:=array[to_char(v_day,'YYYY-MM-DD')||'@10:00',to_char(v_day+1,'YYYY-MM-DD')||'@16:00'];
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_parent,'role','authenticated','aal','aal2')::text,true);
    perform public.request_parent_assessment(v_request_id,v_second,v_teacher,v_options);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
    perform public.set_invitation_assessor_availability(v_request_id,v_options);
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  if exists(select 1 from public.activities where id=v_activity_id and (created_by is distinct from v_admin
      or kind<>'lecture' or remark<>'parent-preview-20261002 · 开发演示')) then raise exception 'PREVIEW_ACTIVITY_OWNERSHIP_CONFLICT';end if;
  insert into public.activities(id,kind,title,scheduled_at,duration_min,location,capacity,remark,created_by)
    values(v_activity_id,'lecture','开发演示 · 思维探索活动',(v_day+time '16:00') at time zone 'Asia/Shanghai',45,
      '开发演示教室',8,'parent-preview-20261002 · 开发演示',v_admin) on conflict(id) do nothing;
  insert into public.miniapp_activity_publications(activity_id,title,description,enabled)
    values(v_activity_id,'{"zh":"开发演示 · 思维探索","en":"Development demo · Thinking exploration"}',
      '{"zh":"用于开发验收的活动：观察规律、表达思路。","en":"A development activity for exploring patterns and explaining ideas."}',true)
    on conflict(activity_id) do nothing;

  for v_item in select * from (values
    ('b39b0b02-7000-4000-8000-000000000005'::uuid,'开发演示 · 观察与推理',(v_day+time '10:00') at time zone 'Asia/Shanghai'),
    ('b39b0b02-7000-4000-8000-000000000006'::uuid,'开发演示 · 空间与表达',(v_day+1+time '16:00') at time zone 'Asia/Shanghai')
  ) seed(id,title,scheduled_at) loop
    if exists(select 1 from public.class_sessions where id=v_item.id and classroom_id<>v_class.id)
      then raise exception 'PREVIEW_SESSION_OWNERSHIP_CONFLICT';end if;
    insert into public.class_sessions(id,classroom_id,term_id,title,scheduled_at,duration_min)
      values(v_item.id,v_class.id,v_class.term_id,v_item.title,v_item.scheduled_at,45) on conflict(id) do nothing;
  end loop;

  insert into public.miniapp_forms(slug,title,description,privacy_notice,fields,enabled) values(
    'welcome','{"zh":"开启一次思维探索","en":"Begin an exploration"}',
    '{"zh":"留下基本信息，发现适合的探索主题与活动安排。","en":"Tell us a little about yourself to discover themes and activities."}',
    '{"zh":"信息用于联系和活动安排。请确认已获得相关人员同意。","en":"Details are used for contact and activity arrangements. Confirm you have permission to provide them."}',
    '[{"id":"contact_name","type":"text","label":{"zh":"怎么称呼你","en":"Your name"},"required":true},{"id":"phone","type":"phone","label":{"zh":"联系电话","en":"Phone"},"required":true},{"id":"interest","type":"multiselect","label":{"zh":"感兴趣的方向","en":"Interests"},"required":false,"options":[{"id":"reasoning","label":{"zh":"逻辑推理","en":"Reasoning"}},{"id":"space","label":{"zh":"空间想象","en":"Spatial thinking"}}]},{"id":"note","type":"textarea","label":{"zh":"想补充的信息","en":"Anything to add"},"required":false}]',true
  ) on conflict(slug) do nothing;
  select * into v_form from public.miniapp_forms where slug='welcome' for share;
  if not v_form.enabled then raise exception 'PREVIEW_WELCOME_FORM_DISABLED';end if;
  select * into v_intake from public.miniapp_intakes where request_id=v_intake_request;
  if v_intake.id is not null then
    if v_intake.form_slug<>'welcome' or v_intake.source<>'parent-preview-20261002 · 开发演示'
      or v_intake.submitted_by is distinct from v_parent then raise exception 'PREVIEW_INTAKE_OWNERSHIP_CONFLICT';end if;
  else
    -- 按当前版本生成显式演示答案；表单有人工调整时沿用其字段与选项。
    for v_field in select value from jsonb_array_elements(v_form.fields) loop
      v_answer:=case v_field->>'type'
        when 'text' then to_jsonb('开发演示家长'::text)
        when 'textarea' then to_jsonb('开发演示：希望了解观察、推理与表达方面的学习安排。'::text)
        when 'phone' then to_jsonb('00000000000'::text)
        when 'select' then v_field->'options'->0->'id'
        when 'multiselect' then case when v_field->'options'->0->'id' is not null
          then jsonb_build_array(v_field->'options'->0->'id') else null end
        else null end;
      if v_answer is null then
        if coalesce((v_field->>'required')::boolean,false) then raise exception 'PREVIEW_FORM_FIELD_UNSUPPORTED';end if;
      else v_answers:=v_answers||jsonb_build_object(v_field->>'id',v_answer);end if;
    end loop;
    perform public.miniapp_submit_intake(v_intake_request,'welcome',v_form.version,v_answers,'parent-preview-20261002 · 开发演示',v_parent);
  end if;
end $fixture$;
