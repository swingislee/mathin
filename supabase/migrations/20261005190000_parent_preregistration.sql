-- Families express interest in real classes and activities. Staff contact them;
-- these requests never create a roster entry, formal enrollment or payment.
begin;

create table public.parent_class_publications (
  classroom_id uuid primary key references public.classrooms(id),
  title text not null check(char_length(title) between 1 and 120),
  description text not null default '' check(char_length(description)<=4000),
  booking_closes_at timestamptz not null,
  enabled boolean not null default false,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id)
);
alter table public.miniapp_activity_publications add column revision integer not null default 1;
alter table public.miniapp_activity_publications add column updated_at timestamptz not null default now();
-- Previously explicit offers keep their chosen classes visible under the class domain.
insert into public.parent_class_publications(classroom_id,title,description,booking_closes_at,enabled,revision,updated_at,updated_by)
  select distinct on(pc.classroom_id) pc.classroom_id,p.title,p.description,p.booking_closes_at,p.enabled,p.revision,p.updated_at,p.updated_by
  from public.parent_course_publication_classes pc join public.parent_course_publications p on p.id=pc.publication_id
  order by pc.classroom_id,p.updated_at desc,p.id;
alter table public.parent_course_applications drop constraint parent_course_applications_status_check;
alter table public.parent_course_applications add constraint parent_course_applications_status_check check(status in ('pending','contacted','confirmed','declined','cancelled'));

create table public.parent_registration_applications (
  id uuid primary key,
  kind text not null check(kind in ('class','activity')),
  classroom_id uuid references public.classrooms(id),
  activity_id uuid references public.activities(id),
  applicant_id uuid not null references public.profiles(id),
  student_id uuid not null references public.students(id),
  snapshot jsonb not null,
  status text not null default 'pending' check(status in ('pending','contacted','declined','cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  reply text not null default '' check(char_length(reply)<=2000),
  check((kind='class' and classroom_id is not null and activity_id is null)
    or (kind='activity' and activity_id is not null and classroom_id is null))
);
create unique index parent_registration_class_pending on public.parent_registration_applications(student_id,classroom_id) where status='pending';
create unique index parent_registration_activity_pending on public.parent_registration_applications(student_id,activity_id) where status='pending';
create index parent_registration_applicant on public.parent_registration_applications(applicant_id,created_at desc);

create table public.parent_advisor_contacts (
  grade smallint primary key check(grade between -1 and 12),
  teacher_name text not null default '' check(char_length(teacher_name)<=60),
  phone text not null check(phone ~ '^\+?[0-9][0-9 -]{5,23}$'),
  qr_path text not null check(qr_path ~ '^-?[0-9]{1,2}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id)
);
alter table public.parent_class_publications enable row level security;
alter table public.parent_registration_applications enable row level security;
alter table public.parent_advisor_contacts enable row level security;
revoke all on public.parent_class_publications,public.parent_registration_applications,public.parent_advisor_contacts from anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('parent-advisor-qrcodes','parent-advisor-qrcodes',true,1048576,array['image/png','image/jpeg','image/webp']);
create policy parent_advisor_qr_upload on storage.objects for insert to authenticated
  with check(bucket_id='parent-advisor-qrcodes' and public.has_perm(auth.uid(),'organization.profile.manage')
    and name ~ '^-?[0-9]{1,2}/[0-9a-f-]{36}\.(png|jpg|webp)$');

create function mathin_internal.parent_registration_classes(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'offeringType',c.offering_type,
    'courseId',v.id,'familyId',f.id,'familyTitle',coalesce(f.title,''),
    'grade',coalesce(c.grade,v.grade),'subject',coalesce(f.subject,''),'level',coalesce(v.class_type,''),
    'termId',c.term_id,'termName',coalesce(t.name,''),
    'campusId',campus.id,'campusName',campus.name,'roomName',coalesce(room.name,c.room),
    'remaining',case when c.capacity is null then null else greatest(c.capacity-(select count(*) from enrollments e where e.classroom_id=c.id and e.status='active'),0) end,
    'teachers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) order by a.is_primary desc,p.display_name)
      from classroom_staff_assignments a join profiles p on p.id=a.user_id
      where a.classroom_id=c.id and a.responsibility in ('primary_teacher','assistant_teacher') and p.is_active),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('at',s.scheduled_at,'duration',s.duration_min) order by s.scheduled_at)
      from class_sessions s where s.classroom_id=c.id and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null),'[]'::jsonb)
  ) order by c.name),'[]'::jsonb)
  from classrooms c left join courses v on v.id=c.course_id left join course_families f on f.id=v.family_id
  left join school_terms t on t.id=c.term_id
  left join campus_rooms room on room.id=c.default_room_id left join campuses campus on campus.id=room.campus_id
  where c.id=any(p_ids) and c.purpose='production' and c.archived_at is null and c.trashed_at is null
    and c.operational_status in ('planning','active');
$$;
revoke all on function mathin_internal.parent_registration_classes(uuid[]) from public,anon,authenticated;

create function public.miniapp_registration_catalog() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item order by updated_at desc),'[]'::jsonb) from (
    select p.updated_at,jsonb_build_object('id',p.classroom_id,'kind','class','title',p.title,'description',p.description,
      'priceCents',null,'bookingClosesAt',p.booking_closes_at,'revision',p.revision,'classes',c.items,'activity',null) item
    from parent_class_publications p cross join lateral (select mathin_internal.parent_registration_classes(array[p.classroom_id]) items) c
    where p.enabled and p.booking_closes_at>now() and jsonb_array_length(c.items)=1
    union all
    select p.updated_at,jsonb_build_object('id',a.id,'kind','activity','title',coalesce(p.title->>'zh',p.title->>'en',a.title),
      'description',coalesce(p.description->>'zh',p.description->>'en',''),'priceCents',null,
      'bookingClosesAt',coalesce(p.booking_closes_at,a.scheduled_at),'revision',p.revision,'classes','[]'::jsonb,
      'activity',jsonb_build_object('id',a.id,'targetGrades',a.target_grades,'location',a.location,'startsAt',a.scheduled_at,
        'durationMinutes',a.duration_min,'remaining',case when a.capacity is null then null else greatest(a.capacity-(select count(*) from activity_registrations r where r.activity_id=a.id and r.status in ('booked','attended')),0) end))
    from miniapp_activity_publications p join activities a on a.id=p.activity_id
    where p.enabled and a.deleted_at is null and a.record_state='current' and a.scheduled_at>now()
      and coalesce(p.booking_closes_at,a.scheduled_at)>now()
  ) offers;
$$;
revoke all on function public.miniapp_registration_catalog() from public;
grant execute on function public.miniapp_registration_catalog() to anon,authenticated;

create function public.save_parent_registration_publication(p_kind text,p_target_id uuid,p_title text,p_description text,p_booking_closes_at timestamptz,p_enabled boolean,p_revision integer) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_revision integer;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  if p_kind='class' then
    if not public.has_perm(auth.uid(),'class.manage') or not public.can_manage_classroom(p_target_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
    perform 1 from classrooms where id=p_target_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if p_enabled and jsonb_array_length(mathin_internal.parent_registration_classes(array[p_target_id]))<>1 then raise exception 'CLASS_NOT_AVAILABLE'; end if;
    select revision into v_revision from parent_class_publications where classroom_id=p_target_id;
  elsif p_kind='activity' then
    if not public.has_perm(auth.uid(),'activity.manage') then raise exception 'FORBIDDEN'; end if;
    perform 1 from activities where id=p_target_id and deleted_at is null and record_state='current' for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    select revision into v_revision from miniapp_activity_publications where activity_id=p_target_id;
    if p_enabled and exists(select 1 from activities where id=p_target_id and scheduled_at<=now()) then raise exception 'BOOKING_CLOSED'; end if;
  else raise exception 'VALIDATION'; end if;
  if p_revision is distinct from coalesce(v_revision,0) then raise exception 'FORM_CHANGED'; end if;
  if p_title is null or btrim(p_title)='' or char_length(p_title)>120 or p_description is null or char_length(p_description)>4000
    or p_enabled is null or p_booking_closes_at is null or (p_enabled and p_booking_closes_at<=now()) then raise exception 'VALIDATION'; end if;
  if p_kind='class' then
    insert into parent_class_publications(classroom_id,title,description,booking_closes_at,enabled,updated_by)
      values(p_target_id,btrim(p_title),btrim(p_description),p_booking_closes_at,p_enabled,auth.uid())
      on conflict(classroom_id) do update set title=excluded.title,description=excluded.description,booking_closes_at=excluded.booking_closes_at,
        enabled=excluded.enabled,revision=parent_class_publications.revision+1,updated_at=now(),updated_by=auth.uid();
  else
    insert into miniapp_activity_publications(activity_id,title,description,booking_closes_at,enabled)
      values(p_target_id,jsonb_build_object('zh',btrim(p_title)),jsonb_build_object('zh',btrim(p_description)),p_booking_closes_at,p_enabled)
      on conflict(activity_id) do update set title=excluded.title,description=excluded.description,booking_closes_at=excluded.booking_closes_at,
        enabled=excluded.enabled,revision=miniapp_activity_publications.revision+1,updated_at=now();
  end if;
end $$;

create function public.miniapp_apply_registration(p_id uuid,p_kind text,p_target_id uuid,p_revision integer,p_student_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_offer jsonb; v_row parent_registration_applications;
begin
  if not public.miniapp_can_participate(p_student_id) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_kind is null or p_kind not in ('class','activity') then raise exception 'VALIDATION'; end if;
  if exists(select 1 from parent_course_applications where id=p_id) then raise exception 'CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text,6843));
  select * into v_row from parent_registration_applications where id=p_id;
  if found then
    if v_row.applicant_id<>auth.uid() or v_row.student_id<>p_student_id or v_row.kind<>p_kind
      or coalesce(v_row.classroom_id,v_row.activity_id) is distinct from p_target_id
      or (v_row.snapshot->>'revision')::integer is distinct from p_revision then raise exception 'CONFLICT'; end if;
    return v_row.id;
  end if;
  -- Serialize publication changes with submission; pre-registration does not consume capacity.
  if p_kind='class' then
    perform 1 from classrooms where id=p_target_id for share;
  else perform 1 from activities where id=p_target_id for share; end if;
  select x into v_offer from jsonb_array_elements(public.miniapp_registration_catalog()) x where x->>'kind'=p_kind and x->>'id'=p_target_id::text;
  if v_offer is null then raise exception 'BOOKING_CLOSED'; end if;
  if (v_offer->>'revision')::integer is distinct from p_revision then raise exception 'FORM_CHANGED'; end if;
  if exists(select 1 from parent_registration_applications where student_id=p_student_id and kind=p_kind and coalesce(classroom_id,activity_id)=p_target_id and status='pending') then raise exception 'CONFLICT'; end if;
  insert into parent_registration_applications(id,kind,classroom_id,activity_id,applicant_id,student_id,snapshot)
    values(p_id,p_kind,case when p_kind='class' then p_target_id end,case when p_kind='activity' then p_target_id end,auth.uid(),p_student_id,v_offer);
  return p_id;
end $$;

create function mathin_internal.parent_registration_application_json(p_row public.parent_registration_applications,p_name text) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_row.id,'kind',p_row.kind,'participantId',p_row.student_id,'participantName',p_name,
    'publicationId',coalesce(p_row.classroom_id,p_row.activity_id),'classroomId',p_row.classroom_id,'activityId',p_row.activity_id,
    'title',p_row.snapshot->>'title','className',coalesce(p_row.snapshot#>>'{classes,0,name}',''),
    'priceCents',null,'status',p_row.status,'createdAt',p_row.created_at,'resolvedAt',p_row.resolved_at,'reply',p_row.reply);
$$;
revoke all on function mathin_internal.parent_registration_application_json(public.parent_registration_applications,text) from public,anon,authenticated;

create function public.miniapp_registration_applications() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.miniapp_family_ready() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(item order by created_at desc),'[]'::jsonb) from (
    select a.created_at,mathin_internal.parent_registration_application_json(a,s.name) item
      from parent_registration_applications a join students s on s.id=a.student_id
      where a.applicant_id=auth.uid() and public.miniapp_can_participate(a.student_id)
    union all
    select a.created_at,jsonb_build_object('id',a.id,'kind','class','participantId',a.student_id,'participantName',s.name,
      'publicationId',a.publication_id,'classroomId',a.classroom_id,'activityId',null,'title',a.offer_snapshot->>'title',
      'className',a.offer_snapshot#>>'{class,name}','priceCents',a.offer_snapshot->'priceCents',
      'status',a.status,'createdAt',a.created_at,'resolvedAt',a.resolved_at,'reply',a.reply)
      from parent_course_applications a join students s on s.id=a.student_id
      where a.applicant_id=auth.uid() and public.miniapp_can_participate(a.student_id)
  ) records);
end $$;

create function public.miniapp_cancel_registration(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row parent_registration_applications;
begin
  select * into v_row from parent_registration_applications where id=p_id for update;
  if not found then perform public.miniapp_cancel_course_application(p_id); return; end if;
  if v_row.applicant_id<>auth.uid() or not public.miniapp_can_participate(v_row.student_id) then raise exception 'FORBIDDEN'; end if;
  if v_row.status='cancelled' then return; end if;
  if v_row.status<>'pending' then raise exception 'CONFLICT'; end if;
  update parent_registration_applications set status='cancelled',resolved_at=now(),resolved_by=auth.uid() where id=p_id;
end $$;

create function public.review_parent_registration(p_id uuid,p_contacted boolean,p_reply text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row parent_registration_applications; v_legacy parent_course_applications;
begin
  if p_contacted is null or p_reply is null or btrim(p_reply)='' or char_length(p_reply)>2000 then raise exception 'VALIDATION'; end if;
  select * into v_row from parent_registration_applications where id=p_id for update;
  if not found then
    select * into v_legacy from parent_course_applications where id=p_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if not (public.has_perm(auth.uid(),'class.manage') or public.has_perm(auth.uid(),'enrollment.manage'))
      or not public.can_access_student(v_legacy.student_id,auth.uid()) or not public.can_manage_classroom(v_legacy.classroom_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
    if v_legacy.status=(case when p_contacted then 'contacted' else 'declined' end) then return; end if;
    if v_legacy.status<>'pending' then raise exception 'CONFLICT'; end if;
    update parent_course_applications set status=case when p_contacted then 'contacted' else 'declined' end,
      reply=btrim(p_reply),resolved_at=now(),resolved_by=auth.uid() where id=p_id;
    return;
  end if;
  if not public.can_access_student(v_row.student_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if v_row.kind='class' then
    if not (public.has_perm(auth.uid(),'class.manage') or public.has_perm(auth.uid(),'enrollment.manage')) or not public.can_manage_classroom(v_row.classroom_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
  elsif not public.has_perm(auth.uid(),'activity.register') then raise exception 'FORBIDDEN'; end if;
  if v_row.status=(case when p_contacted then 'contacted' else 'declined' end) then return; end if;
  if v_row.status<>'pending' then raise exception 'CONFLICT'; end if;
  update parent_registration_applications set status=case when p_contacted then 'contacted' else 'declined' end,
    reply=btrim(p_reply),resolved_at=now(),resolved_by=auth.uid() where id=p_id;
end $$;

create function public.parent_registration_workbench(p_kind text,p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_publish boolean; v_review boolean; v_name text; v_default_closes timestamptz; v_publication jsonb;
begin
  if p_kind='class' then
    if not public.can_manage_classroom(p_target_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
    v_publish:=public.has_perm(auth.uid(),'class.manage');
    v_review:=v_publish or public.has_perm(auth.uid(),'enrollment.manage');
    select name,now()+interval '30 days' into v_name,v_default_closes from classrooms where id=p_target_id;
    select jsonb_build_object('title',title,'description',description,'bookingClosesAt',booking_closes_at,'enabled',enabled,'revision',revision) into v_publication from parent_class_publications where classroom_id=p_target_id;
  elsif p_kind='activity' then
    v_publish:=public.has_perm(auth.uid(),'activity.manage'); v_review:=public.has_perm(auth.uid(),'activity.register');
    select title,scheduled_at into v_name,v_default_closes from activities where id=p_target_id and deleted_at is null and record_state='current';
    select jsonb_build_object('title',coalesce(title->>'zh',title->>'en',v_name),'description',coalesce(description->>'zh',description->>'en',''),
      'bookingClosesAt',coalesce(booking_closes_at,v_default_closes),'enabled',enabled,'revision',revision) into v_publication from miniapp_activity_publications where activity_id=p_target_id;
  else raise exception 'VALIDATION'; end if;
  if auth.uid() is null or not(coalesce(v_publish,false) or coalesce(v_review,false)) then raise exception 'FORBIDDEN'; end if;
  if v_name is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('name',v_name,'kind',p_kind,'targetId',p_target_id,'canPublish',v_publish,'canReview',v_review,
    'publication',coalesce(v_publication,jsonb_build_object('title',v_name,'description','','bookingClosesAt',v_default_closes,'enabled',false,'revision',0)),
    'applications',(select coalesce(jsonb_agg(item order by created_at desc),'[]'::jsonb) from (
      select a.created_at,mathin_internal.parent_registration_application_json(a,s.name) item
        from parent_registration_applications a join students s on s.id=a.student_id
        where v_review and a.kind=p_kind and coalesce(a.classroom_id,a.activity_id)=p_target_id and public.can_access_student(a.student_id,auth.uid())
      union all
      select a.created_at,jsonb_build_object('id',a.id,'kind','class','participantId',a.student_id,'participantName',s.name,
        'publicationId',a.publication_id,'classroomId',a.classroom_id,'activityId',null,'title',a.offer_snapshot->>'title',
        'className',a.offer_snapshot#>>'{class,name}','priceCents',a.offer_snapshot->'priceCents','status',a.status,
        'createdAt',a.created_at,'resolvedAt',a.resolved_at,'reply',a.reply)
        from parent_course_applications a join students s on s.id=a.student_id
        where v_review and p_kind='class' and a.classroom_id=p_target_id and public.can_access_student(a.student_id,auth.uid())
    ) records));
end $$;

create function public.miniapp_advisor_contacts() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('grade',grade,'teacherName',teacher_name,'phone',phone,'qrPath',qr_path) order by grade),'[]'::jsonb) from parent_advisor_contacts where enabled;
$$;
create function public.parent_advisor_settings() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(),'organization.profile.manage') then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('grade',grade,'teacherName',teacher_name,'phone',phone,'qrPath',qr_path,'enabled',enabled) order by grade),'[]'::jsonb) from parent_advisor_contacts);
end $$;
create function public.save_parent_advisor_contact(p_grade smallint,p_teacher_name text,p_phone text,p_qr_path text,p_enabled boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(),'organization.profile.manage') then raise exception 'FORBIDDEN'; end if;
  if p_grade is null or p_grade not between -1 and 12 or p_teacher_name is null or char_length(p_teacher_name)>60 or p_phone is null or p_phone !~ '^\+?[0-9][0-9 -]{5,23}$'
    or p_qr_path is null or p_qr_path !~ ('^'||p_grade::text||'/[0-9a-f-]{36}\.(png|jpg|webp)$') or p_enabled is null then raise exception 'VALIDATION'; end if;
  if not exists(select 1 from storage.objects where bucket_id='parent-advisor-qrcodes' and name=p_qr_path) then raise exception 'VALIDATION'; end if;
  insert into parent_advisor_contacts(grade,teacher_name,phone,qr_path,enabled,updated_by)
    values(p_grade,btrim(p_teacher_name),btrim(p_phone),p_qr_path,p_enabled,auth.uid())
    on conflict(grade) do update set teacher_name=excluded.teacher_name,phone=excluded.phone,qr_path=excluded.qr_path,
      enabled=excluded.enabled,updated_at=now(),updated_by=auth.uid();
end $$;

-- Retain older application history. Disable obsolete grouped-course publishing,
-- direct activity booking and enrollment confirmation writes for API clients.
create or replace function public.miniapp_course_catalog() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$ select public.miniapp_registration_catalog(); $$;
revoke execute on function public.save_parent_course_publication(uuid,text,text,integer,timestamptz,boolean,uuid[]),
  public.miniapp_apply_course(uuid,uuid,integer,uuid,uuid),public.review_parent_course_application(uuid,boolean,text),
  public.miniapp_book_activity(uuid,uuid) from authenticated;

revoke all on function public.save_parent_registration_publication(text,uuid,text,text,timestamptz,boolean,integer),
  public.miniapp_apply_registration(uuid,text,uuid,integer,uuid),public.miniapp_registration_applications(),public.miniapp_cancel_registration(uuid),
  public.review_parent_registration(uuid,boolean,text),public.parent_registration_workbench(text,uuid),public.parent_advisor_settings(),
  public.save_parent_advisor_contact(smallint,text,text,text,boolean) from public,anon;
grant execute on function public.save_parent_registration_publication(text,uuid,text,text,timestamptz,boolean,integer),
  public.miniapp_apply_registration(uuid,text,uuid,integer,uuid),public.miniapp_registration_applications(),public.miniapp_cancel_registration(uuid),
  public.review_parent_registration(uuid,boolean,text),public.parent_registration_workbench(text,uuid),public.parent_advisor_settings(),
  public.save_parent_advisor_contact(smallint,text,text,text,boolean) to authenticated;
revoke all on function public.miniapp_advisor_contacts() from public;
grant execute on function public.miniapp_advisor_contacts() to anon,authenticated;
notify pgrst,'reload schema';
commit;
