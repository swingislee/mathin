-- 只复用 manifest 中已经存在的 Auth 身份；新增联调业务对象固定标识、purpose=test。
do $$declare parent_id uuid; admin_id uuid; actor record; sid uuid;
begin
  select id into parent_id from auth.users where email='test-parent@mathin.local';
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  if parent_id is null or admin_id is null or (select count(*) from auth.users where email in ('test-student@mathin.local','test-student-2@mathin.local','test-parent-unbound@mathin.local'))<>3 then raise exception 'FIXED_IDENTITIES_REQUIRED';end if;
  insert into public.classrooms(id,owner_id,name,invite_code,purpose)
    values('a085ac31-7000-4000-8000-000000000005',admin_id,'小程序开发联调','MINIAPP-LOCAL-20260922','test') on conflict(id) do nothing;
  for actor in select id,email from auth.users where email in ('test-student@mathin.local','test-student-2@mathin.local') order by email loop
    select id into sid from public.students where user_id=actor.id;
    if sid is null then
      sid:=case when actor.email='test-student@mathin.local' then 'a085ac31-7000-4000-8000-000000000003'::uuid else 'a085ac31-7000-4000-8000-000000000004'::uuid end;
      insert into public.students(id,name,user_id,bind_code,source,created_by)
        values(sid,case when actor.email='test-student@mathin.local' then '联调参与人一' else '联调参与人二' end,actor.id,'MINIAPP-'||sid::text,'本机小程序固定联调',admin_id);
    end if;
    insert into public.student_guardians(student_id,guardian_id,relation,scope)
      values(sid,parent_id,'固定开发关联',array['grades','video']) on conflict(student_id,guardian_id) do nothing;
    insert into public.enrollments(classroom_id,student_id,operated_by)
      values('a085ac31-7000-4000-8000-000000000005',sid,admin_id) on conflict do nothing;
  end loop;
  insert into public.assignments(id,classroom_id,title,content,due_at,created_by)
    values('a085ac31-7000-4000-8000-000000000002','a085ac31-7000-4000-8000-000000000005','记录一个发现 · 开发联调',
    '{"text":"找一组有规律的物品，拍照或录制一段视频，说明你的发现与思考过程。此练习用于本机联调。"}',now()+interval '7 days',admin_id) on conflict(id) do nothing;
end $$;
