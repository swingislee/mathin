-- 学生协作：参与经历保留办理范围，业务组提供可撤回的查看范围。
-- 可见范围与当前工作/历史资料状态独立；岗位 capability 继续由现有 RBAC 决定。
create table public.school_business_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  source_code text unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
insert into public.school_business_groups(name,source_code) values ('一组','1'),('二组','2'),('三组','3');

create table public.school_business_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.school_business_groups(id),
  user_id uuid not null references public.profiles(id),
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles(id),
  removed_at timestamptz
);
create unique index school_group_active_member on public.school_business_group_members(group_id,user_id) where removed_at is null;
create index school_group_members_user on public.school_business_group_members(user_id,group_id) where removed_at is null;

create table public.school_staff_business_roles (
  user_id uuid primary key references public.profiles(id),
  business_role text not null check (business_role in ('school_support','assessment_teacher','teacher')),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.school_subject_participants (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id),
  lead_id uuid references public.leads(id),
  subject_key text generated always as (coalesce('student:'||student_id::text,'lead:'||lead_id::text)) stored,
  user_id uuid not null references public.profiles(id),
  business_role text not null check (business_role in ('school_support','assessment_teacher','teacher','participant')),
  source_key text not null check (length(source_key) between 1 and 600),
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  check (num_nonnulls(student_id,lead_id)=1),
  unique(subject_key,user_id,business_role,source_key)
);
create index school_participants_student on public.school_subject_participants(student_id,user_id);
create index school_participants_lead on public.school_subject_participants(lead_id,user_id);
create index school_participants_user on public.school_subject_participants(user_id,student_id,lead_id);

create table public.school_subject_groups (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id),
  lead_id uuid references public.leads(id),
  subject_key text generated always as (coalesce('student:'||student_id::text,'lead:'||lead_id::text)) stored,
  group_id uuid not null references public.school_business_groups(id),
  source_key text not null,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  check (num_nonnulls(student_id,lead_id)=1),
  unique(subject_key,group_id,source_key)
);
create index school_subject_groups_student on public.school_subject_groups(student_id,group_id);
create index school_subject_groups_lead on public.school_subject_groups(lead_id,group_id);

create table public.school_collaboration_events (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  subject_id uuid,
  previous_values jsonb,
  saved_values jsonb not null,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now()
);

create function public.can_manage_school_groups(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(p_uid) and (public.is_admin(p_uid) or exists(
    select 1 from public.staff_role_members m join public.staff_roles r on r.id=m.role_id
    where m.user_id=p_uid and r.key='director'));
$$;

-- 以已确认的 Lead→Student 关系汇合参与经历，不按同名或同手机号推断身份。
create function public.school_subject_participant_rows(p_student_id uuid,p_lead_id uuid)
returns setof public.school_subject_participants
language sql stable security definer set search_path=public,pg_temp as $$
  with subject as (select coalesce(p_student_id,(select student_id from public.leads where id=p_lead_id)) as sid),
  refs as (select id from public.leads where id=p_lead_id or student_id=(select sid from subject))
  select p.* from public.school_subject_participants p
  where p.student_id=(select sid from subject) or p.lead_id in(select id from refs);
$$;
create function public.school_subject_is_participant(p_student_id uuid,p_lead_id uuid,p_uid uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(p_uid) and exists(select 1 from public.school_subject_participant_rows(p_student_id,p_lead_id) p where p.user_id=p_uid);
$$;
create function public.school_subject_group_rows(p_student_id uuid,p_lead_id uuid)
returns setof public.school_business_groups
language sql stable security definer set search_path=public,pg_temp as $$
  with subject as (select coalesce(p_student_id,(select student_id from public.leads where id=p_lead_id)) as sid),
  refs as (select id from public.leads where id=p_lead_id or student_id=(select sid from subject)),
  group_ids as (
    select group_id from public.school_subject_groups g where g.student_id=(select sid from subject) or g.lead_id in(select id from refs)
    union select m.group_id from public.school_subject_participant_rows(p_student_id,p_lead_id) p
      join public.school_business_group_members m on m.user_id=p.user_id and m.removed_at is null
  ) select g.* from public.school_business_groups g where g.id in(select group_id from group_ids);
$$;
create function public.school_subject_in_my_groups(p_student_id uuid,p_lead_id uuid,p_uid uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(p_uid) and exists(select 1 from public.school_subject_group_rows(p_student_id,p_lead_id) g
    join public.school_business_group_members m on m.group_id=g.id where m.user_id=p_uid and m.removed_at is null);
$$;

-- 保持旧函数的办理语义；组内查看使用单独函数，避免既有写 RPC 因读取扩权而获得编辑。
create or replace function public.can_access_student(sid uuid,uid uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(uid) and (public.is_admin(uid) or public.staff_has_perm(uid,'student.view.all')
    or (public.staff_has_perm(uid,'student.view.assigned') and (
      public.assigned_of_student(sid,uid) or public.teacher_of_student(sid,uid) or public.support_of_student(sid,uid)))
    or public.school_subject_is_participant(sid,null,uid));
$$;
create function public.can_view_school_student(p_student_id uuid,p_uid uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.can_access_student(p_student_id,p_uid) or
    (public.is_staff(p_uid) and (public.has_perm(p_uid,'followup.view') or public.has_perm(p_uid,'student.view.assigned'))
      and public.school_subject_in_my_groups(p_student_id,null,p_uid));
$$;
create function public.can_edit_school_lead(p_lead_id uuid,p_uid uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(p_uid) and exists(select 1 from public.leads l where l.id=p_lead_id and
    (l.owner_id=p_uid or public.has_perm(p_uid,'student.view.all')
      or public.school_subject_is_participant(l.student_id,l.id,p_uid)
      or l.student_id is not null and public.can_access_student(l.student_id,p_uid)));
$$;
create function public.can_view_school_lead(p_lead_id uuid,p_uid uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(p_uid) and exists(select 1 from public.leads l where l.id=p_lead_id and
    ((public.has_perm(p_uid,'followup.view') and (l.owner_id is null or public.can_edit_school_lead(l.id,p_uid)
      or public.school_subject_in_my_groups(l.student_id,l.id,p_uid)))
      or l.created_by=p_uid and public.has_perm(p_uid,'student.import')));
$$;

create function public.school_collaboration_projection(p_student_id uuid,p_lead_id uuid,p_uid uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with participants as (
    select distinct p.user_id,profile.display_name,coalesce(r.business_role,p.business_role) as business_role
    from public.school_subject_participant_rows(p_student_id,p_lead_id) p join public.profiles profile on profile.id=p.user_id
      left join public.school_staff_business_roles r on r.user_id=p.user_id
  ), groups as (select id,name from public.school_subject_group_rows(p_student_id,p_lead_id))
  select jsonb_build_object(
    'participants',coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'name',display_name,'role',business_role) order by display_name,business_role) from participants),'[]'::jsonb),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from groups),'[]'::jsonb),
    'isParticipant',public.school_subject_is_participant(p_student_id,p_lead_id,p_uid),
    'inMyGroups',public.school_subject_in_my_groups(p_student_id,p_lead_id,p_uid),
    'supportNames',coalesce((select string_agg(distinct display_name,'、' order by display_name) from participants where business_role='school_support'),''),
    'assessmentTeacherNames',coalesce((select string_agg(distinct display_name,'、' order by display_name) from participants where business_role in ('assessment_teacher','teacher')),'')
  );
$$;

-- 参与事实追加保存：调配后保留旧参与人；停用账号由 is_staff 统一拦截。
create function public.capture_school_subject_participants() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare row_data jsonb; actor_id uuid; sid uuid; lid uuid; field_name text; role_name text;
begin
  for row_data in select to_jsonb(new) union all select to_jsonb(old) where tg_op='UPDATE' loop
    sid:=case when tg_table_name='students' then (row_data->>'id')::uuid else (row_data->>'student_id')::uuid end;
    lid:=case when tg_table_name='leads' then (row_data->>'id')::uuid else (row_data->>'lead_id')::uuid end;
    if tg_table_name='assessment_results' and sid is null and lid is null then
      select student_id,lead_id into sid,lid from public.activity_registrations where id=(row_data->>'activity_registration_id')::uuid;
    end if;
    if sid is null and lid is null then continue; end if;
    foreach field_name in array tg_argv loop
      actor_id:=(row_data->>field_name)::uuid;
      if actor_id is null or not exists(select 1 from public.profiles where id=actor_id and role in ('staff','admin')) then continue; end if;
      role_name:=case when field_name in ('assessor_id','assessed_by') then 'assessment_teacher'
        when field_name in ('owner_id','assigned_to','owner_id_at_contact','owner_id_at_open') then 'school_support' else 'participant' end;
      insert into public.school_subject_participants(student_id,lead_id,user_id,business_role,source_key,recorded_by)
      values(case when lid is null then sid end,lid,actor_id,role_name,tg_table_name||':'||coalesce(row_data->>'id',row_data->>'student_id')||':'||field_name,auth.uid()) on conflict do nothing;
    end loop;
  end loop;
  return new;
end;
$$;
create trigger school_capture_lead_participants after insert or update of owner_id,student_id on public.leads
  for each row execute function public.capture_school_subject_participants('owner_id','created_by');
create trigger school_capture_student_participants after insert or update of assigned_to on public.students
  for each row execute function public.capture_school_subject_participants('assigned_to','created_by');
create trigger school_capture_contact_participants after insert or update of recorded_by on public.lead_communications
  for each row execute function public.capture_school_subject_participants('recorded_by','owner_id_at_contact');
create trigger school_capture_followup_participants after insert on public.student_follow_ups
  for each row execute function public.capture_school_subject_participants('author_id');
create trigger school_capture_invitation_participants after insert or update of assessor_id on public.lead_invitation_threads
  for each row execute function public.capture_school_subject_participants('assessor_id','created_by','owner_id_at_open');
create trigger school_capture_assessment_participants after insert or update of assessed_by on public.assessment_results
  for each row execute function public.capture_school_subject_participants('assessed_by');
create trigger school_capture_activity_participants after insert or update of operated_by on public.activity_registrations
  for each row execute function public.capture_school_subject_participants('operated_by');

-- 原生经历按明确 UUID 归集；迁移员只作为导入操作人，不冒充原表业务人员。
insert into public.school_subject_participants(student_id,lead_id,user_id,business_role,source_key)
select student_id,lead_id,user_id,business_role,source_key from (
  select null::uuid student_id,id lead_id,owner_id user_id,'school_support' business_role,'leads:'||id||':owner_id' source_key from public.leads
  union all select id,null,assigned_to,'school_support','students:'||id||':assigned_to' from public.students
  union all select null,id,created_by,'participant','leads:'||id||':created_by' from public.leads where source_record_id is null
  union all select id,null,created_by,'participant','students:'||id||':created_by' from public.students
  union all select null,lead_id,recorded_by,'participant','lead_communications:'||id||':recorded_by' from public.lead_communications
  union all select student_id,null,author_id,'participant','student_follow_ups:'||id||':author_id' from public.student_follow_ups
  union all select case when lead_id is null then student_id end,lead_id,assessed_by,'assessment_teacher','assessment_results:'||id||':assessed_by' from public.assessment_results
  union all select null,lead_id,assessor_id,'assessment_teacher','lead_invitation_threads:'||id||':assessor_id' from public.lead_invitation_threads
  union all select case when lead_id is null then student_id end,lead_id,operated_by,'participant','activity_registrations:'||id||':operated_by' from public.activity_registrations
  union all select e.student_id,null,a.user_id,case when a.responsibility='learning_support' then 'school_support' else 'teacher' end,
    'classroom:'||e.classroom_id||':'||e.id||':'||a.responsibility from public.enrollments e join public.classroom_staff_assignments a on a.classroom_id=e.classroom_id
  union all select e.student_id,null,c.owner_id,'teacher','classroom:'||c.id||':'||e.id||':teacher' from public.enrollments e join public.classrooms c on c.id=e.classroom_id
) facts where user_id is not null and num_nonnulls(student_id,lead_id)=1
  and exists(select 1 from public.profiles p where p.id=facts.user_id and p.role in ('staff','admin')) on conflict do nothing;

create function public.capture_school_classroom_participants() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare row_data jsonb; classroom uuid;
begin
  for row_data in select to_jsonb(new) union all select to_jsonb(old) where tg_op='UPDATE' loop
    classroom:=(row_data->>case when tg_table_name='classrooms' then 'id' else 'classroom_id' end)::uuid;
    insert into public.school_subject_participants(student_id,user_id,business_role,source_key,recorded_by)
      select e.student_id,a.user_id,a.business_role,'classroom:'||classroom||':'||e.id||':'||a.business_role,auth.uid()
      from public.enrollments e cross join lateral (
        select user_id,case when responsibility='learning_support' then 'school_support' else 'teacher' end business_role from public.classroom_staff_assignments where classroom_id=classroom
        union select owner_id,'teacher' from public.classrooms where id=classroom
        union select (row_data->>'user_id')::uuid,case when row_data->>'responsibility'='learning_support' then 'school_support' else 'teacher' end where tg_table_name='classroom_staff_assignments'
        union select (row_data->>'owner_id')::uuid,'teacher' where tg_table_name='classrooms'
      ) a where e.classroom_id=classroom and a.user_id is not null
        and exists(select 1 from public.profiles p where p.id=a.user_id and p.role in ('staff','admin')) on conflict do nothing;
  end loop;
  return new;
end;
$$;
create trigger school_capture_enrollment_participants after insert or update of student_id,classroom_id on public.enrollments
  for each row execute function public.capture_school_classroom_participants();
create trigger school_capture_classroom_staff_participants after insert or update on public.classroom_staff_assignments
  for each row execute function public.capture_school_classroom_participants();
create trigger school_capture_classroom_teacher_participants after update of owner_id on public.classrooms
  for each row execute function public.capture_school_classroom_participants();
revoke all on function public.capture_school_classroom_participants() from public,anon,authenticated;

-- 原始字段保留来源锚点；歧义姓名和无明确身份关联的来源继续留待核对。
create function public.refresh_school_source_collaboration() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  with refs as materialized (
    select h.id,h.student_id,null::uuid lead_id from public.history_import_records h where h.student_id is not null
    union select h.id,null,h.lead_id from public.history_import_records h where h.lead_id is not null
    union select l.source_record_id,null,l.id from public.leads l where l.source_record_id is not null
    union select a.record_id,a.student_id,null from public.history_import_associations a where a.match_state='confirmed'
  ), labels as materialized (
    select h.id,c->>'fieldName' field,btrim(c->>'text') label from public.history_import_records h
      cross join lateral jsonb_array_elements(h.record_data->'cells') c where h.source_data->>'format'='feishu-base'
      and c->>'fieldName' in ('确认人员','跟进人员','跟进人','沟通人员','学服老师','主线服务老师','报名服务老师','非在读-学服','课程顾问','学管师','跟进老师',
        '配合跟进学服老师','配合学服老师','老师','班级老师','学科老师','授课学科老师','授课老师','授课教师','带课老师','思维在读-老师','测评老师')
      and nullif(btrim(c->>'text'),'') is not null
  ), staff as (select btrim(display_name) name,(array_agg(id))[1] id from public.profiles where role in ('staff','admin') group by btrim(display_name) having count(*)=1)
  insert into public.school_subject_participants(student_id,lead_id,user_id,business_role,source_key)
    select ref.student_id,ref.lead_id,s.id,coalesce(r.business_role,case when l.field in ('老师','班级老师','学科老师','授课学科老师','授课老师','授课教师','带课老师','思维在读-老师','测评老师')
      then 'assessment_teacher' else 'school_support' end),'source:'||l.id||':'||l.field
    from refs ref join labels l on l.id=ref.id join staff s on s.name=l.label left join public.school_staff_business_roles r on r.user_id=s.id on conflict do nothing;
  with refs as (
    select h.id,h.student_id,null::uuid lead_id from public.history_import_records h where h.student_id is not null
    union select h.id,null,h.lead_id from public.history_import_records h where h.lead_id is not null
    union select l.source_record_id,null,l.id from public.leads l where l.source_record_id is not null
    union select a.record_id,a.student_id,null from public.history_import_associations a where a.match_state='confirmed'
  ) insert into public.school_subject_groups(student_id,lead_id,group_id,source_key)
    select ref.student_id,ref.lead_id,g.id,'source:'||h.id||':'||(c->>'fieldName') from refs ref join public.history_import_records h on h.id=ref.id
      cross join lateral jsonb_array_elements(h.record_data->'cells') c join public.school_business_groups g on g.source_code=
        translate(replace(btrim(c->>'text'),'组',''),'一二三','123')
    where h.source_data->>'format'='feishu-base' and c->>'fieldName' like '%组别%' on conflict do nothing;
end;
$$;
select public.refresh_school_source_collaboration();

create function public.save_school_business_group(p_id uuid,p_name text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare gid uuid; prior jsonb;
begin
  if not public.can_manage_school_groups() then raise exception 'FORBIDDEN'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'VALIDATION'; end if;
  if p_id is null then insert into public.school_business_groups(name,created_by) values(btrim(p_name),auth.uid()) returning id into gid;
  else
    select to_jsonb(g) into prior from public.school_business_groups g where id=p_id for update;
    if prior is null then raise exception 'NOT_FOUND'; end if;
    update public.school_business_groups set name=btrim(p_name) where id=p_id returning id into gid;
  end if;
  insert into public.school_collaboration_events(action,subject_id,previous_values,saved_values,recorded_by)
    values('save_group',gid,prior,jsonb_build_object('name',btrim(p_name)),auth.uid());
  return gid;
end;
$$;
create function public.set_school_business_group_member(p_group_id uuid,p_user_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.can_manage_school_groups() then raise exception 'FORBIDDEN'; end if;
  if p_active is null or not exists(select 1 from public.school_business_groups where id=p_group_id)
    or not exists(select 1 from public.profiles where id=p_user_id and role in ('staff','admin') and is_active and account_status='active') then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('school-group-member:'||p_group_id||':'||p_user_id,0));
  if p_active then
    insert into public.school_business_group_members(group_id,user_id,added_by) values(p_group_id,p_user_id,auth.uid()) on conflict do nothing;
  else update public.school_business_group_members set removed_at=now(),removed_by=auth.uid() where group_id=p_group_id and user_id=p_user_id and removed_at is null; end if;
  insert into public.school_collaboration_events(action,subject_id,saved_values,recorded_by)
    values('set_member',p_group_id,jsonb_build_object('userId',p_user_id,'active',p_active),auth.uid());
end;
$$;
create function public.set_school_staff_business_role(p_user_id uuid,p_role text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior jsonb;
begin
  if not public.can_manage_school_groups() then raise exception 'FORBIDDEN'; end if;
  if p_role is null or p_role not in ('school_support','assessment_teacher','teacher')
    or not exists(select 1 from public.profiles where id=p_user_id and role in ('staff','admin')) then raise exception 'VALIDATION'; end if;
  select to_jsonb(r) into prior from public.school_staff_business_roles r where user_id=p_user_id for update;
  insert into public.school_staff_business_roles(user_id,business_role,updated_by) values(p_user_id,p_role,auth.uid())
    on conflict(user_id) do update set business_role=excluded.business_role,updated_by=excluded.updated_by,updated_at=now();
  insert into public.school_collaboration_events(action,subject_id,previous_values,saved_values,recorded_by)
    values('set_business_role',p_user_id,prior,jsonb_build_object('role',p_role),auth.uid());
end;
$$;
create function public.add_school_subject_collaborator(p_student_id uuid,p_lead_id uuid,p_user_id uuid,p_role text,p_group_id uuid default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.can_manage_school_groups() then raise exception 'FORBIDDEN'; end if;
  if num_nonnulls(p_student_id,p_lead_id)<>1 or (p_student_id is not null and not exists(select 1 from public.students where id=p_student_id and deleted_at is null))
    or (p_lead_id is not null and not exists(select 1 from public.leads where id=p_lead_id)) then raise exception 'VALIDATION'; end if;
  if p_user_id is not null then
    if p_role is null or p_role not in ('school_support','assessment_teacher','teacher','participant')
      or not exists(select 1 from public.profiles where id=p_user_id and role in ('staff','admin') and is_active and account_status='active') then raise exception 'VALIDATION'; end if;
    insert into public.school_subject_participants(student_id,lead_id,user_id,business_role,source_key,recorded_by)
      values(p_student_id,p_lead_id,p_user_id,p_role,'manual',auth.uid()) on conflict do nothing;
  end if;
  if p_group_id is not null then
    insert into public.school_subject_groups(student_id,lead_id,group_id,source_key,recorded_by)
      values(p_student_id,p_lead_id,p_group_id,'manual',auth.uid()) on conflict do nothing;
  end if;
  if p_user_id is null and p_group_id is null then raise exception 'VALIDATION'; end if;
  insert into public.school_collaboration_events(action,subject_id,saved_values,recorded_by)
    values('add_collaborator',coalesce(p_student_id,p_lead_id),jsonb_build_object('studentId',p_student_id,'leadId',p_lead_id,'userId',p_user_id,'role',p_role,'groupId',p_group_id),auth.uid());
end;
$$;

create function public.read_school_collaboration_settings() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare manager boolean:=public.can_manage_school_groups();
begin
  if not public.is_staff(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('canManage',manager,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'memberIds',
      coalesce((select jsonb_agg(m.user_id order by m.user_id) from public.school_business_group_members m where m.group_id=g.id and m.removed_at is null),'[]'::jsonb)) order by g.name)
      from public.school_business_groups g where manager or exists(select 1 from public.school_business_group_members m where m.group_id=g.id and m.user_id=auth.uid() and m.removed_at is null)),'[]'::jsonb),
    'staff',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'role',r.business_role) order by p.display_name)
      from public.profiles p left join public.school_staff_business_roles r on r.user_id=p.id where p.role in ('staff','admin') and p.is_active and p.account_status='active'),'[]'::jsonb) else '[]'::jsonb end);
end;
$$;

do $security$
declare relation_name text; routine regprocedure;
begin
  foreach relation_name in array array['school_business_groups','school_business_group_members','school_staff_business_roles','school_subject_participants','school_subject_groups','school_collaboration_events'] loop
    execute format('alter table public.%I enable row level security',relation_name);
    execute format('revoke all on public.%I from public,anon,authenticated',relation_name);
    execute format('grant select on public.%I to authenticated',relation_name);
    execute format('create policy collaboration_manager_read on public.%I for select to authenticated using(public.can_manage_school_groups())',relation_name);
  end loop;
  for routine in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('can_manage_school_groups','school_subject_participant_rows','school_subject_is_participant','school_subject_group_rows','school_subject_in_my_groups',
      'can_view_school_student','can_edit_school_lead','can_view_school_lead','school_collaboration_projection','capture_school_subject_participants','refresh_school_source_collaboration',
      'save_school_business_group','set_school_business_group_member','set_school_staff_business_role','add_school_subject_collaborator','read_school_collaboration_settings') loop
    execute format('revoke all on function %s from public,anon,authenticated',routine);
  end loop;
end;
$security$;
grant execute on function public.can_manage_school_groups(uuid),public.school_subject_is_participant(uuid,uuid,uuid),public.school_subject_in_my_groups(uuid,uuid,uuid),
  public.can_view_school_student(uuid,uuid),public.can_edit_school_lead(uuid,uuid),public.can_view_school_lead(uuid,uuid),
  public.save_school_business_group(uuid,text),public.set_school_business_group_member(uuid,uuid,boolean),public.set_school_staff_business_role(uuid,text),
  public.add_school_subject_collaborator(uuid,uuid,uuid,text,uuid),public.read_school_collaboration_settings() to authenticated;

alter policy leads_select_pool_scope on public.leads using(public.can_view_school_lead(id,(select auth.uid())));
-- 只替换 SELECT 策略中的可见性函数；UPDATE/INSERT 继续保留可办理范围。
do $policies$
declare policy_row record;
begin
  for policy_row in select * from pg_policies where schemaname='public' and cmd='SELECT' and qual like '%can_access_student(%'
    and tablename in ('students','student_follow_ups','student_status_history','student_tag_links','activity_registrations','course_opportunities','course_enrollments') loop
    execute format('alter policy %I on public.%I using (%s)',policy_row.policyname,policy_row.tablename,
      replace(policy_row.qual,'can_access_student(','can_view_school_student('));
  end loop;
end;
$policies$;
