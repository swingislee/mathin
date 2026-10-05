-- Public course offers are explicitly selected from real teaching classes.
-- An application neither reserves a seat nor records payment or enrollment.
begin;

create table public.parent_course_publications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  price_cents integer check (price_cents >= 0),
  booking_closes_at timestamptz not null,
  enabled boolean not null default false,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id)
);
create table public.parent_course_publication_classes (
  publication_id uuid not null references public.parent_course_publications(id),
  classroom_id uuid not null references public.classrooms(id),
  primary key(publication_id,classroom_id)
);
create table public.parent_course_applications (
  id uuid primary key,
  publication_id uuid not null references public.parent_course_publications(id),
  applicant_id uuid not null references public.profiles(id),
  student_id uuid not null references public.students(id),
  classroom_id uuid not null references public.classrooms(id),
  course_id uuid not null references public.courses(id),
  term_id uuid not null references public.school_terms(id),
  offer_snapshot jsonb not null,
  status text not null default 'pending' check(status in ('pending','confirmed','declined','cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  reply text not null default '' check(char_length(reply)<=2000),
  enrollment_id uuid references public.course_enrollments(id)
);
create unique index parent_course_applications_pending on public.parent_course_applications(student_id,course_id,term_id) where status='pending';
create index parent_course_applications_applicant on public.parent_course_applications(applicant_id,created_at desc);
alter table public.parent_course_publications enable row level security;
alter table public.parent_course_publication_classes enable row level security;
alter table public.parent_course_applications enable row level security;
revoke all on public.parent_course_publications,public.parent_course_publication_classes,public.parent_course_applications from anon,authenticated;

create function mathin_internal.parent_catalog_classes(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'courseId',v.id,'familyId',v.family_id,'familyTitle',f.title,
    'grade',v.grade,'subject',f.subject,'level',v.class_type,'termId',c.term_id,'termName',t.name,
    'campusId',campus.id,'campusName',campus.name,'roomName',coalesce(room.name,c.room),
    'remaining',case when c.capacity is null then null else greatest(c.capacity-(select count(*) from enrollments e where e.classroom_id=c.id and e.status='active'),0) end,
    'teachers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) order by a.is_primary desc,p.display_name)
      from classroom_staff_assignments a join profiles p on p.id=a.user_id
      where a.classroom_id=c.id and a.responsibility in ('primary_teacher','assistant_teacher') and p.is_active),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('at',s.scheduled_at,'duration',s.duration_min) order by s.scheduled_at)
      from class_sessions s where s.classroom_id=c.id and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null),'[]'::jsonb)
  ) order by v.class_type,c.name),'[]'::jsonb)
  from classrooms c join courses v on v.id=c.course_id join course_families f on f.id=v.family_id
  join school_terms t on t.id=c.term_id
  left join campus_rooms room on room.id=c.default_room_id left join campuses campus on campus.id=room.campus_id
  where c.id=any(p_ids) and c.purpose='production' and c.offering_type='long_term_formal'
    and c.archived_at is null and c.trashed_at is null and c.operational_status in ('planning','active')
    and v.purpose='production' and v.status='enabled' and v.course_kind='curriculum' and v.trashed_at is null
    and f.purpose='production' and f.status='enabled';
$$;
revoke all on function mathin_internal.parent_catalog_classes(uuid[]) from public,anon,authenticated;

create function public.miniapp_course_catalog() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'description',p.description,
    'priceCents',p.price_cents,'bookingClosesAt',p.booking_closes_at,'revision',p.revision,'classes',classes.items) order by p.updated_at desc),'[]'::jsonb)
  from parent_course_publications p cross join lateral (
    select mathin_internal.parent_catalog_classes(array(select classroom_id from parent_course_publication_classes where publication_id=p.id)) items
  ) classes where p.enabled and p.booking_closes_at>now() and jsonb_array_length(classes.items)>0;
$$;
revoke all on function public.miniapp_course_catalog() from public;
grant execute on function public.miniapp_course_catalog() to anon,authenticated;

create function public.save_parent_course_publication(p_id uuid,p_title text,p_description text,p_price_cents integer,p_booking_closes_at timestamptz,p_enabled boolean,p_classroom_ids uuid[]) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_classes jsonb; v_id uuid:=coalesce(p_id,gen_random_uuid());
begin
  if auth.uid() is null or not public.has_perm(auth.uid(),'course.manage') then raise exception 'FORBIDDEN'; end if;
  if p_title is null or btrim(p_title)='' or char_length(p_title)>120 or p_description is null or char_length(p_description)>4000
    or p_price_cents<0 or p_booking_closes_at is null or p_enabled is null
    or cardinality(p_classroom_ids) is null or cardinality(p_classroom_ids) not between 1 and 100
    or (p_enabled and p_booking_closes_at<=now()) then raise exception 'VALIDATION'; end if;
  if exists(select 1 from unnest(p_classroom_ids) id where not public.can_manage_classroom(id,auth.uid())) then raise exception 'FORBIDDEN'; end if;
  v_classes:=mathin_internal.parent_catalog_classes(p_classroom_ids);
  if jsonb_array_length(v_classes)<>cardinality(p_classroom_ids)
    or (select count(distinct (x->>'familyId',x->>'termId',x->>'grade')) from jsonb_array_elements(v_classes) x)<>1
    then raise exception 'CLASS_TARGET_MISMATCH'; end if;
  if p_id is null then
    insert into parent_course_publications(id,title,description,price_cents,booking_closes_at,enabled,updated_by)
      values(v_id,btrim(p_title),btrim(p_description),p_price_cents,p_booking_closes_at,p_enabled,auth.uid());
  else
    perform 1 from parent_course_publications where id=p_id for update;
    if exists(select 1 from parent_course_publication_classes where publication_id=p_id and not public.can_manage_classroom(classroom_id,auth.uid())) then raise exception 'FORBIDDEN'; end if;
    update parent_course_publications set title=btrim(p_title),description=btrim(p_description),price_cents=p_price_cents,
      booking_closes_at=p_booking_closes_at,enabled=p_enabled,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=p_id;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  delete from parent_course_publication_classes where publication_id=v_id;
  insert into parent_course_publication_classes select v_id,id from unnest(p_classroom_ids) id;
  return v_id;
end $$;

create function public.miniapp_apply_course(p_id uuid,p_publication_id uuid,p_revision integer,p_classroom_id uuid,p_student_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pub parent_course_publications; v_existing parent_course_applications; v_class classrooms; v_json jsonb;
begin
  if not public.miniapp_can_participate(p_student_id) then raise exception 'FORBIDDEN'; end if;
  if p_id is null then raise exception 'VALIDATION'; end if;
  -- Serialize retries and applications for the same student without granting table writes.
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text,6842));
  select * into v_existing from parent_course_applications where id=p_id;
  if found then
    if v_existing.applicant_id<>auth.uid() or v_existing.student_id<>p_student_id or v_existing.publication_id<>p_publication_id or v_existing.classroom_id<>p_classroom_id
      or (v_existing.offer_snapshot->>'revision')::integer is distinct from p_revision then raise exception 'CONFLICT'; end if;
    return v_existing.id;
  end if;
  select * into v_pub from parent_course_publications where id=p_publication_id for share;
  if not found or not v_pub.enabled then raise exception 'NOT_FOUND'; end if;
  if v_pub.booking_closes_at<=now() then raise exception 'BOOKING_CLOSED'; end if;
  if p_revision is distinct from v_pub.revision then raise exception 'FORM_CHANGED'; end if;
  if not exists(select 1 from parent_course_publication_classes where publication_id=v_pub.id and classroom_id=p_classroom_id) then raise exception 'NOT_FOUND'; end if;
  select * into v_class from classrooms where id=p_classroom_id for update;
  v_json:=mathin_internal.parent_catalog_classes(array[p_classroom_id])->0;
  if v_json is null then raise exception 'NOT_FOUND'; end if;
  if (v_json->>'remaining')::integer=0 then raise exception 'ACTIVITY_FULL'; end if;
  if exists(select 1 from course_enrollments where student_id=p_student_id and course_id=v_class.course_id and term_id=v_class.term_id and status='active') then raise exception 'CONFLICT'; end if;
  if exists(select 1 from parent_course_applications where student_id=p_student_id and course_id=v_class.course_id and term_id=v_class.term_id and status='pending') then raise exception 'CONFLICT'; end if;
  insert into parent_course_applications(id,publication_id,applicant_id,student_id,classroom_id,course_id,term_id,offer_snapshot)
    values(p_id,v_pub.id,auth.uid(),p_student_id,p_classroom_id,v_class.course_id,v_class.term_id,
      jsonb_build_object('title',v_pub.title,'priceCents',v_pub.price_cents,'revision',v_pub.revision,'class',v_json));
  return p_id;
end $$;

create function public.miniapp_course_applications() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.miniapp_family_ready() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'participantId',a.student_id,'participantName',s.name,
    'publicationId',a.publication_id,'classroomId',a.classroom_id,'title',a.offer_snapshot->>'title','className',a.offer_snapshot->'class'->>'name',
    'priceCents',a.offer_snapshot->'priceCents','status',a.status,'createdAt',a.created_at,'resolvedAt',a.resolved_at,'reply',a.reply) order by a.created_at desc),'[]'::jsonb)
    from parent_course_applications a join students s on s.id=a.student_id
    where a.applicant_id=auth.uid() and public.miniapp_can_participate(a.student_id));
end $$;

create function public.miniapp_cancel_course_application(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row parent_course_applications;
begin
  select * into v_row from parent_course_applications where id=p_id for update;
  if not found or v_row.applicant_id<>auth.uid() or not public.miniapp_can_participate(v_row.student_id) then raise exception 'FORBIDDEN'; end if;
  if v_row.status='cancelled' then return; end if;
  if v_row.status<>'pending' then raise exception 'CONFLICT'; end if;
  update parent_course_applications set status='cancelled',resolved_at=now(),resolved_by=auth.uid() where id=p_id;
end $$;

create function public.review_parent_course_application(p_id uuid,p_confirm boolean,p_reply text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row parent_course_applications; v_opportunity uuid; v_enrollment uuid;
begin
  if auth.uid() is null or not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if p_confirm is null or p_reply is null or btrim(p_reply)='' or char_length(p_reply)>2000 then raise exception 'VALIDATION'; end if;
  select * into v_row from parent_course_applications where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.can_access_student(v_row.student_id,auth.uid()) or not public.can_manage_classroom(v_row.classroom_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if v_row.status=(case when p_confirm then 'confirmed' else 'declined' end) then return v_row.id; end if;
  if v_row.status<>'pending' then raise exception 'CONFLICT'; end if;
  if p_confirm then
    if not exists(select 1 from classrooms where id=v_row.classroom_id and course_id=v_row.course_id and term_id=v_row.term_id) then raise exception 'CLASS_TARGET_MISMATCH'; end if;
    -- Existing enrollment functions retain staff scope, active-course, capacity and audit checks.
    v_opportunity:=public.save_course_opportunity(null,null,v_row.student_id,null,'new',v_row.course_id,v_row.term_id,'committed',null,'',null,btrim(p_reply));
    v_enrollment:=public.confirm_course_enrollment(v_opportunity,btrim(p_reply));
    perform public.assign_course_enrollment(v_enrollment,v_row.classroom_id,btrim(p_reply),now());
  end if;
  update parent_course_applications set status=case when p_confirm then 'confirmed' else 'declined' end,
    reply=btrim(p_reply),resolved_at=now(),resolved_by=auth.uid(),enrollment_id=v_enrollment where id=p_id;
  return p_id;
end $$;

create function public.parent_course_admissions_workbench() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_manage boolean;
begin
  v_manage:=public.has_perm(v_uid,'course.manage');
  if v_uid is null or not (v_manage or public.has_perm(v_uid,'enrollment.manage')) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'canPublish',v_manage,
    'canConfirm',public.has_perm(v_uid,'enrollment.manage') and public.has_perm(v_uid,'followup.write'),
    'classes',case when v_manage then mathin_internal.parent_catalog_classes(array(select id from classrooms c where public.can_manage_classroom(c.id,v_uid))) else '[]'::jsonb end,
    'publications',case when v_manage then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'description',p.description,
      'priceCents',p.price_cents,'bookingClosesAt',p.booking_closes_at,'enabled',p.enabled,
      'classroomIds',array(select classroom_id from parent_course_publication_classes where publication_id=p.id)) order by p.updated_at desc),'[]'::jsonb)
      from parent_course_publications p where not exists(select 1 from parent_course_publication_classes pc where pc.publication_id=p.id and not public.can_manage_classroom(pc.classroom_id,v_uid))) else '[]'::jsonb end,
    'applications',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'participantId',a.student_id,'participantName',s.name,
      'publicationId',a.publication_id,'classroomId',a.classroom_id,'title',a.offer_snapshot->>'title','className',a.offer_snapshot->'class'->>'name',
      'priceCents',a.offer_snapshot->'priceCents','status',a.status,'createdAt',a.created_at,'resolvedAt',a.resolved_at,'reply',a.reply) order by a.created_at desc),'[]'::jsonb)
      from parent_course_applications a join students s on s.id=a.student_id
      where public.has_perm(v_uid,'enrollment.manage') and public.can_access_student(a.student_id,v_uid) and public.can_manage_classroom(a.classroom_id,v_uid))
  );
end $$;

revoke all on function public.save_parent_course_publication(uuid,text,text,integer,timestamptz,boolean,uuid[]),
  public.miniapp_apply_course(uuid,uuid,integer,uuid,uuid),public.miniapp_course_applications(),
  public.miniapp_cancel_course_application(uuid),public.review_parent_course_application(uuid,boolean,text),public.parent_course_admissions_workbench() from public,anon;
grant execute on function public.save_parent_course_publication(uuid,text,text,integer,timestamptz,boolean,uuid[]),
  public.miniapp_apply_course(uuid,uuid,integer,uuid,uuid),public.miniapp_course_applications(),
  public.miniapp_cancel_course_application(uuid),public.review_parent_course_application(uuid,boolean,text),public.parent_course_admissions_workbench() to authenticated;
notify pgrst,'reload schema';
commit;
