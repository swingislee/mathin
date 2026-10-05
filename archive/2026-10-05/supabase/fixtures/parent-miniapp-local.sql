-- 仅由 parent-portal-local.mjs --configure 在已核对的 loopback 开发库执行。
insert into public.miniapp_forms(slug,title,description,privacy_notice,fields,enabled) values(
  'welcome','{"zh":"开启一次思维探索","en":"Begin an exploration"}',
  '{"zh":"留下基本信息，发现适合的探索主题与活动安排。","en":"Tell us a little about yourself to discover themes and activities."}',
  '{"zh":"你填写的信息用于联系、安排活动及后续服务。仅负责处理本次登记的工作人员可查看。请确认已获得所填写信息相关人员的同意。","en":"Your details are used for contact, activity arrangements and follow-up services. Authorized staff can access this registration. Confirm you have permission to provide these details."}',
  '[{"id":"contact_name","type":"text","label":{"zh":"怎么称呼你","en":"Your name"},"required":true},{"id":"phone","type":"phone","label":{"zh":"联系电话","en":"Contact phone"},"required":true},{"id":"interest","type":"multiselect","label":{"zh":"感兴趣的方向","en":"Areas of interest"},"required":false,"options":[{"id":"reasoning","label":{"zh":"逻辑推理","en":"Reasoning"}},{"id":"space","label":{"zh":"空间想象","en":"Spatial thinking"}},{"id":"expression","label":{"zh":"思路表达","en":"Explaining ideas"}}]},{"id":"note","type":"textarea","label":{"zh":"想补充的信息","en":"Anything to add"},"required":false}]',true
) on conflict(slug) do nothing;
do $$declare admin_id uuid; class_id uuid; student_id uuid; report_payload jsonb;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select e.classroom_id into class_id from public.enrollments e
    join public.student_guardians g on g.student_id=e.student_id
    join auth.users u on u.id=g.guardian_id and u.email='test-parent@mathin.local'
    join public.classrooms c on c.id=e.classroom_id and c.purpose='test'
    where e.status='active' limit 1;
  if admin_id is null or class_id is null then raise exception 'FIXED_ACCEPTANCE_IDENTITIES_REQUIRED';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  insert into public.activities(id,kind,title,scheduled_at,duration_min,location,capacity,created_by)
    values('a085ac31-7000-4000-8000-000000000001','lecture','小程序开发联调 · 思维探索',now()+interval '3 days',45,'本机开发环境',8,admin_id) on conflict(id) do nothing;
  insert into public.miniapp_activity_publications(activity_id,title,description,enabled)
    values('a085ac31-7000-4000-8000-000000000001','{"zh":"思维探索 · 开发联调","en":"Thinking exploration · Development"}',
      '{"zh":"本机验收活动。通过观察与推理，尝试从不同角度发现规律。","en":"A local acceptance activity: explore patterns through observation and reasoning."}',true) on conflict(activity_id) do nothing;
  insert into public.assignments(id,classroom_id,title,content,due_at,created_by)
    values('a085ac31-7000-4000-8000-000000000002',class_id,'记录一个发现 · 开发联调','{"text":"找一组有规律的物品，拍照或录制一段视频，说明你的发现与思考过程。此练习用于本机联调。"}',now()+interval '7 days',admin_id) on conflict(id) do nothing;
  select s.id into student_id from public.students s join auth.users u on u.id=s.user_id where u.email='test-student@mathin.local' and s.deleted_at is null;
  if student_id is null then raise exception 'FIXED_STUDENT_REQUIRED';end if;
  insert into public.activities(id,kind,title,scheduled_at,duration_min,location,created_by)
    values('a085ac31-7000-4000-8000-000000000006','lecture','已完成的探索 · 开发联调',now()-interval '1 day',45,'本机开发环境',admin_id) on conflict(id) do nothing;
  insert into public.activity_registrations(id,activity_id,student_id,status,operated_by)
    values('a085ac31-7000-4000-8000-000000000007','a085ac31-7000-4000-8000-000000000006',student_id,'attended',admin_id) on conflict(id) do nothing;
  report_payload := '{"activityTitle":"思维回顾 · 开发联调","teacherObservation":"这是一份仅用于本机验收的示例结果，用于查看反馈展开和记录展示。","strengths":"能够从观察中描述发现的规律。","focusAreas":"尝试用另一种方法解释同一个发现。","recommendation":"选择身边的一组物品，记录观察、猜想和验证过程。","score":null,"totalScore":null}'::jsonb;
  insert into public.assessment_reports(id,registration_id,version,payload,content_hash,created_by)
    values('a085ac31-7000-4000-8000-000000000008','a085ac31-7000-4000-8000-000000000007',1,report_payload,md5(report_payload::text),admin_id) on conflict(id) do nothing;
  insert into public.assessment_workflow_states(registration_id,stage,report_id,sent_report_id,sent_at,sent_by,updated_by)
    values('a085ac31-7000-4000-8000-000000000007','feedback','a085ac31-7000-4000-8000-000000000008','a085ac31-7000-4000-8000-000000000008',now(),admin_id,admin_id) on conflict(registration_id) do nothing;
end $$;
