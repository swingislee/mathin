-- 格致未来思维：可配置登记、已公开活动预约、已发布结果及练习附件。
-- 预约复用 activity_registrations，练习复用 assignments 与 students；参与人无需登录账号。

create table public.miniapp_forms (
  slug text primary key check(slug ~ '^[a-z0-9-]{1,64}$'),
  version integer not null default 1 check(version > 0),
  title jsonb not null, description jsonb not null, privacy_notice jsonb not null,
  fields jsonb not null check(jsonb_typeof(fields)='array' and jsonb_array_length(fields) between 1 and 20),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create function public.miniapp_form_version() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then new.version := old.version+1; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger miniapp_form_version before update on public.miniapp_forms
for each row execute function public.miniapp_form_version();

create table public.miniapp_intakes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  form_slug text not null references public.miniapp_forms(slug) on delete restrict,
  form_version integer not null, form_snapshot jsonb not null, answers jsonb not null,
  source text not null default '' check(length(source)<=120),
  submitted_by uuid references public.profiles(id) on delete restrict,
  consent_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index miniapp_intakes_created_idx on public.miniapp_intakes(created_at desc);
create table public.miniapp_rate_limits (
  key text primary key, window_at timestamptz not null, attempts integer not null
);
create function public.miniapp_take_rate_limit(p_key text, p_limit integer, p_seconds integer) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
  insert into public.miniapp_rate_limits(key,window_at,attempts) values(p_key,now(),1)
  on conflict(key) do update set
    attempts=case when miniapp_rate_limits.window_at < now()-make_interval(secs=>p_seconds) then 1 else miniapp_rate_limits.attempts+1 end,
    window_at=case when miniapp_rate_limits.window_at < now()-make_interval(secs=>p_seconds) then now() else miniapp_rate_limits.window_at end
  returning attempts into n;
  return n<=p_limit;
end $$;

create function public.miniapp_submit_intake(p_request_id uuid,p_form text,p_version integer,p_answers jsonb,p_source text,p_user uuid default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.miniapp_forms; old_row public.miniapp_intakes; field jsonb; answer jsonb; item jsonb; result uuid;
begin
  select * into f from public.miniapp_forms where slug=p_form and enabled for share;
  if f.slug is null then raise exception 'NOT_FOUND'; end if;
  if f.version<>p_version then raise exception 'FORM_CHANGED'; end if;
  if p_request_id is null or jsonb_typeof(p_answers) is distinct from 'object'
    or octet_length(p_answers::text)>20000 or length(coalesce(p_source,''))>120 then raise exception 'VALIDATION'; end if;
  if exists(select 1 from jsonb_object_keys(p_answers) k where not exists(select 1 from jsonb_array_elements(f.fields) v where v->>'id'=k)) then raise exception 'VALIDATION'; end if;
  for field in select value from jsonb_array_elements(f.fields) loop
    answer:=p_answers->(field->>'id');
    if answer is null or answer='""'::jsonb or answer='[]'::jsonb then
      if coalesce((field->>'required')::boolean,false) then raise exception 'VALIDATION'; end if;
      continue;
    end if;
    if field->>'type'='multiselect' then
      if jsonb_typeof(answer)<>'array' then raise exception 'VALIDATION'; end if;
      if jsonb_array_length(answer)>30 or (select count(distinct value) from jsonb_array_elements(answer))<>jsonb_array_length(answer) then raise exception 'VALIDATION'; end if;
      for item in select value from jsonb_array_elements(answer) loop
        if not exists(select 1 from jsonb_array_elements(field->'options') opt where opt->'id'=item) then raise exception 'VALIDATION'; end if;
      end loop;
    else
      if jsonb_typeof(answer)<>'string' or length(answer#>>'{}')>(case when field->>'type'='textarea' then 2000 else 200 end)
        or (coalesce((field->>'required')::boolean,false) and btrim(answer#>>'{}')='') then raise exception 'VALIDATION'; end if;
      if field->>'type'='select' and not exists(select 1 from jsonb_array_elements(field->'options') opt where opt->'id'=answer) then raise exception 'VALIDATION'; end if;
      if field->>'type'='phone' and (answer#>>'{}') !~ '^\+?[0-9 ()-]{6,30}$' then raise exception 'VALIDATION'; end if;
      if field->>'type' not in ('text','phone','textarea','select') then raise exception 'VALIDATION'; end if;
    end if;
  end loop;
  -- 同一请求重试只返回同一条记录；不同内容使用同一请求号时拒绝覆盖。
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into old_row from public.miniapp_intakes where request_id=p_request_id;
  if old_row.id is not null then
    if old_row.form_slug<>p_form or old_row.answers<>p_answers or old_row.source<>coalesce(p_source,'') or old_row.submitted_by is distinct from p_user then raise exception 'CONFLICT'; end if;
    return old_row.id;
  end if;
  insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,source,submitted_by)
  values(p_request_id,p_form,p_version,to_jsonb(f),p_answers,coalesce(p_source,''),p_user) returning id into result;
  return result;
end $$;

create table public.miniapp_activity_publications (
  activity_id uuid primary key references public.activities(id) on delete restrict,
  title jsonb not null, description jsonb not null,
  enabled boolean not null default false, booking_closes_at timestamptz
);
create function public.miniapp_family_ready() returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('parent','student')
    and p.account_status='active' and not p.password_change_required)
    and public.has_current_required_consents(auth.uid());
$$;
create function public.miniapp_can_participate(p_student uuid,p_scope text default 'grades') returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select public.miniapp_family_ready() and exists(select 1 from public.students s where s.id=p_student and s.deleted_at is null
    and (s.user_id=auth.uid() or public.guardian_can(s.id,auth.uid(),p_scope)));
$$;
create function public.miniapp_public_activities() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item order by starts_at),'[]') from (
    select a.scheduled_at starts_at,jsonb_build_object('id',a.id,'title',p.title,'description',p.description,'location',a.location,
      'startsAt',a.scheduled_at,'durationMinutes',a.duration_min,
      'remaining',case when a.capacity is null then null else greatest(a.capacity-(select count(*) from public.activity_registrations r where r.activity_id=a.id and r.status in ('booked','attended')),0) end,
      'bookable',coalesce(p.booking_closes_at,a.scheduled_at)>now()) item
    from public.miniapp_activity_publications p join public.activities a on a.id=p.activity_id
    where p.enabled and a.deleted_at is null and a.record_state='current' and a.scheduled_at>now()
    order by a.scheduled_at limit 100
  ) rows;
$$;
create function public.miniapp_book_activity(p_activity uuid,p_student uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.activities; pub public.miniapp_activity_publications; r public.activity_registrations; result uuid;
begin
  if not public.miniapp_can_participate(p_student) then raise exception 'FORBIDDEN'; end if;
  select * into a from public.activities where id=p_activity and deleted_at is null and record_state='current' for update;
  select * into pub from public.miniapp_activity_publications where activity_id=p_activity and enabled for share;
  if a.id is null or pub.activity_id is null then raise exception 'NOT_FOUND'; end if;
  select * into r from public.activity_registrations where activity_id=p_activity and student_id=p_student;
  if r.id is not null and r.status in ('booked','attended') then return r.id; end if;
  if a.scheduled_at is null or a.scheduled_at<=now() or coalesce(pub.booking_closes_at,a.scheduled_at)<=now() then raise exception 'BOOKING_CLOSED'; end if;
  if a.capacity is not null and (select count(*) from public.activity_registrations where activity_id=p_activity and status in ('booked','attended'))>=a.capacity then raise exception 'ACTIVITY_FULL'; end if;
  if r.id is not null then
    if r.status<>'cancelled' or r.record_state<>'current' then raise exception 'CONFLICT'; end if;
    update public.activity_registrations set status='booked',operated_by=auth.uid() where id=r.id returning id into result;
  else
    insert into public.activity_registrations(activity_id,student_id,status,operated_by)
      values(p_activity,p_student,'booked',auth.uid()) returning id into result;
  end if;
  insert into public.domain_events(actor_id,event_type,entity_type,entity_id,payload)
    values(auth.uid(),'miniapp.activity_booked','activity_registration',result,jsonb_build_object('activityId',p_activity));
  return result;
end $$;
create function public.miniapp_cancel_booking(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.activity_registrations; starts_at timestamptz;
begin
  select * into r from public.activity_registrations where id=p_id;
  if r.id is null or not public.miniapp_can_participate(r.student_id) then raise exception 'FORBIDDEN'; end if;
  -- 与预约使用相同的活动锁，释放名额和重新预约保持串行。
  select scheduled_at into starts_at from public.activities where id=r.activity_id for update;
  select * into r from public.activity_registrations where id=p_id for update;
  if r.status='cancelled' then return; end if;
  if r.status<>'booked' or r.record_state<>'current' or starts_at<=now() then raise exception 'BOOKING_CLOSED'; end if;
  update public.activity_registrations set status='cancelled',operated_by=auth.uid() where id=p_id;
  insert into public.domain_events(actor_id,event_type,entity_type,entity_id,payload)
    values(auth.uid(),'miniapp.activity_cancelled','activity_registration',p_id,'{}');
end $$;
create function public.miniapp_my_bookings() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item order by starts_at desc),'[]') from (
    select a.scheduled_at starts_at,jsonb_build_object('id',r.id,'activityId',a.id,'participantId',s.id,'participantName',s.name,
      'title',p.title,'startsAt',a.scheduled_at,'location',a.location,'status',r.status) item
    from public.activity_registrations r join public.activities a on a.id=r.activity_id
    join public.miniapp_activity_publications p on p.activity_id=a.id join public.students s on s.id=r.student_id
    where a.deleted_at is null and public.miniapp_can_participate(s.id) order by a.scheduled_at desc limit 100
  ) rows;
$$;
create function public.miniapp_assessment_reports() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item order by sent_at desc),'[]') from (
    select w.sent_at,jsonb_build_object('id',p.id,'kind','assessment','title',p.payload->>'activityTitle',
      'participantName',s.name,'date',w.sent_at,'summary',coalesce(p.payload->>'teacherObservation',''),
      'strengths',coalesce(p.payload->>'strengths',''),'focusAreas',coalesce(p.payload->>'focusAreas',''),
      'recommendation',coalesce(p.payload->>'recommendation',''),'score',p.payload->'score','totalScore',p.payload->'totalScore') item
    from public.assessment_workflow_states w join public.assessment_reports p on p.id=w.sent_report_id and p.registration_id=w.registration_id
    join public.activity_registrations r on r.id=w.registration_id join public.students s on s.id=r.student_id
    where w.sent_at is not null and public.miniapp_can_participate(s.id) order by w.sent_at desc limit 100
  ) rows;
$$;

create function public.miniapp_can_practice(p_assignment uuid,p_student uuid) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select public.miniapp_can_participate(p_student) and exists(select 1 from public.assignments a
    join public.enrollments e on e.classroom_id=a.classroom_id and e.student_id=p_student and e.status='active'
    join public.classrooms c on c.id=a.classroom_id and c.trashed_at is null where a.id=p_assignment);
$$;
create table public.miniapp_practice_submissions (
  id uuid primary key,
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  note text not null default '' check(length(note)<=2000),
  upload_ids uuid[] not null check(cardinality(upload_ids) between 1 and 9),
  submitted_at timestamptz not null default now()
);
create index miniapp_practice_submission_task_idx on public.miniapp_practice_submissions(assignment_id,student_id,submitted_at desc);
create table public.miniapp_practice_uploads (
  id uuid primary key,
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  object_path text not null unique, name text not null check(length(name) between 1 and 200),
  kind text not null check(kind in ('image','video')), mime_type text not null,
  bytes bigint not null check(bytes>0 and bytes<=67108864),
  ready boolean not null default false,
  attached boolean not null default false, created_at timestamptz not null default now()
);
create function public.miniapp_reserve_upload(p_id uuid,p_assignment uuid,p_student uuid,p_path text,p_name text,p_kind text,p_mime text,p_bytes bigint) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.miniapp_can_practice(p_assignment,p_student) or (p_kind='video' and not public.miniapp_can_participate(p_student,'video')) then raise exception 'FORBIDDEN';end if;
  if p_id is null or p_kind not in ('image','video') or p_kind is null or p_bytes is null or p_bytes<=0
    or p_bytes>(case when p_kind='image' then 12582912 else 67108864 end) then raise exception 'TOO_LARGE';end if;
  if p_name is null or length(p_name) not between 1 and 200 or p_path is null
    or p_path !~ ('^'||auth.uid()::text||'/'||p_assignment::text||'/'||p_student::text||'/'||p_id::text||'\.(jpg|png|webp|heic|mp4|mov)$')
    or p_mime is null or not ((p_kind='image' and p_mime in ('image/jpeg','image/png','image/webp','image/heic')) or (p_kind='video' and p_mime in ('video/mp4','video/quicktime'))) then raise exception 'VALIDATION';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,2));
  if coalesce((select sum(bytes) from public.miniapp_practice_uploads where owner_id=auth.uid()),0)+p_bytes>1073741824 then raise exception 'TOO_LARGE';end if;
  insert into public.miniapp_practice_uploads(id,assignment_id,student_id,owner_id,object_path,name,kind,mime_type,bytes)
    values(p_id,p_assignment,p_student,auth.uid(),p_path,p_name,p_kind,p_mime,p_bytes);
  return p_id;
end $$;
create function public.miniapp_my_practices() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item order by due_at nulls last,created_at desc),'[]') from (
    select a.due_at,a.created_at,jsonb_build_object('id',a.id,'participantId',s.id,'participantName',s.name,'title',a.title,
      'instructions',coalesce(a.content->>'text',''),'dueAt',a.due_at,
      'submittedAt',(select max(x.submitted_at) from public.miniapp_practice_submissions x where x.assignment_id=a.id and x.student_id=s.id)) item
    from public.assignments a join public.enrollments e on e.classroom_id=a.classroom_id and e.status='active'
    join public.students s on s.id=e.student_id where public.miniapp_can_practice(a.id,s.id)
    order by a.due_at nulls last,a.created_at desc limit 100
  ) rows;
$$;
create function public.miniapp_submit_practice(p_id uuid,p_assignment uuid,p_student uuid,p_note text,p_uploads uuid[]) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.miniapp_practice_submissions; amount integer;
begin
  if not public.miniapp_can_practice(p_assignment,p_student) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or length(coalesce(p_note,''))>2000 or coalesce(cardinality(p_uploads),0) not between 1 and 9
    or (select count(distinct x) from unnest(p_uploads) x)<>cardinality(p_uploads) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
  select * into saved from public.miniapp_practice_submissions where id=p_id;
  if saved.id is not null then
    if saved.assignment_id<>p_assignment or saved.student_id<>p_student or saved.submitted_by<>auth.uid()
      or saved.note<>coalesce(p_note,'') or saved.upload_ids<>p_uploads then raise exception 'CONFLICT'; end if;
    return saved.id;
  end if;
  select count(*) into amount from public.miniapp_practice_uploads u
    join storage.objects o on o.bucket_id='miniapp-practice' and o.name=u.object_path
    where u.id=any(p_uploads) and u.ready and u.assignment_id=p_assignment and u.student_id=p_student and u.owner_id=auth.uid()
      and (u.kind='image' or public.miniapp_can_participate(p_student,'video'));
  if amount<>cardinality(p_uploads) then raise exception 'VALIDATION'; end if;
  insert into public.miniapp_practice_submissions(id,assignment_id,student_id,submitted_by,note,upload_ids)
    values(p_id,p_assignment,p_student,auth.uid(),coalesce(p_note,''),p_uploads);
  update public.miniapp_practice_uploads set attached=true where id=any(p_uploads);
  return p_id;
end $$;

alter table public.miniapp_forms enable row level security;
alter table public.miniapp_intakes enable row level security;
alter table public.miniapp_rate_limits enable row level security;
alter table public.miniapp_activity_publications enable row level security;
alter table public.miniapp_practice_uploads enable row level security;
alter table public.miniapp_practice_submissions enable row level security;
revoke all on public.miniapp_forms,public.miniapp_intakes,public.miniapp_rate_limits,public.miniapp_activity_publications,
  public.miniapp_practice_uploads,public.miniapp_practice_submissions from anon,authenticated;
grant select on public.miniapp_forms to anon,authenticated;
grant insert,update on public.miniapp_forms,public.miniapp_activity_publications to authenticated;
grant select on public.miniapp_intakes,public.miniapp_activity_publications,public.miniapp_practice_uploads,public.miniapp_practice_submissions to authenticated;
create policy miniapp_forms_read on public.miniapp_forms for select using(enabled or public.is_admin((select auth.uid())));
create policy miniapp_forms_manage on public.miniapp_forms for all to authenticated using(public.is_admin((select auth.uid()))) with check(public.is_admin((select auth.uid())));
create policy miniapp_publications_manage on public.miniapp_activity_publications for all to authenticated using(public.is_admin((select auth.uid()))) with check(public.is_admin((select auth.uid())));
create policy miniapp_intakes_read on public.miniapp_intakes for select to authenticated using(public.is_admin((select auth.uid())) or submitted_by=(select auth.uid()));
create policy miniapp_uploads_read on public.miniapp_practice_uploads for select to authenticated using(
  (public.miniapp_can_participate(student_id) and (kind='image' or public.miniapp_can_participate(student_id,'video')))
  or (public.is_staff((select auth.uid())) and public.can_access_student(student_id,(select auth.uid()))));
create policy miniapp_submissions_read on public.miniapp_practice_submissions for select to authenticated using(
  public.miniapp_can_participate(student_id) or (public.is_staff((select auth.uid())) and public.can_access_student(student_id,(select auth.uid()))));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('miniapp-practice','miniapp-practice',false,67108864,array['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime']);
insert into public.file_policies(bucket_id,purpose,access_mode,upload_protocol,max_bytes,owner_quota_bytes,allowed_mime_types,orphan_grace_hours,retention_days,malicious_content_policy)
values('miniapp-practice','Private practice photos and videos','signed','standard',67108864,1073741824,
  array['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime'],24,730,'signature_only');
create policy miniapp_practice_storage_read on storage.objects for select to authenticated using(bucket_id='miniapp-practice' and exists(
  select 1 from public.miniapp_practice_uploads u where u.object_path=name
    and ((public.miniapp_can_participate(u.student_id) and (u.kind='image' or public.miniapp_can_participate(u.student_id,'video')))
      or (public.is_staff((select auth.uid())) and public.can_access_student(u.student_id,(select auth.uid()))))));

revoke all on function public.miniapp_form_version(),public.miniapp_take_rate_limit(text,integer,integer),
  public.miniapp_submit_intake(uuid,text,integer,jsonb,text,uuid),public.miniapp_family_ready(),
  public.miniapp_can_participate(uuid,text),public.miniapp_public_activities(),public.miniapp_book_activity(uuid,uuid),
  public.miniapp_cancel_booking(uuid),public.miniapp_my_bookings(),public.miniapp_assessment_reports(),
  public.miniapp_can_practice(uuid,uuid),public.miniapp_my_practices(),public.miniapp_submit_practice(uuid,uuid,uuid,text,uuid[]),
  public.miniapp_reserve_upload(uuid,uuid,uuid,text,text,text,text,bigint)
  from public,anon,authenticated;
grant execute on function public.miniapp_take_rate_limit(text,integer,integer),public.miniapp_submit_intake(uuid,text,integer,jsonb,text,uuid) to service_role;
grant execute on function public.miniapp_public_activities() to anon,authenticated;
grant execute on function public.miniapp_family_ready(),public.miniapp_can_participate(uuid,text),public.miniapp_book_activity(uuid,uuid),
  public.miniapp_cancel_booking(uuid),public.miniapp_my_bookings(),public.miniapp_assessment_reports(),
  public.miniapp_can_practice(uuid,uuid),public.miniapp_my_practices(),public.miniapp_submit_practice(uuid,uuid,uuid,text,uuid[]),
  public.miniapp_reserve_upload(uuid,uuid,uuid,text,text,text,text,bigint) to authenticated;
