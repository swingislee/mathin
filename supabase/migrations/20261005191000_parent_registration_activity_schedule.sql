-- An activity needs a future scheduled time before accepting public pre-registration.
begin;
create or replace function public.save_parent_registration_publication(p_kind text,p_target_id uuid,p_title text,p_description text,p_booking_closes_at timestamptz,p_enabled boolean,p_revision integer) returns void
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
    if p_enabled and not exists(select 1 from activities where id=p_target_id and scheduled_at>now()) then raise exception 'BOOKING_CLOSED'; end if;
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

create or replace function public.parent_registration_workbench(p_kind text,p_target_id uuid) returns jsonb
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
    'publishable',case when p_kind='class' then jsonb_array_length(mathin_internal.parent_registration_classes(array[p_target_id]))=1 else exists(select 1 from activities where id=p_target_id and scheduled_at>now()) end,
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
notify pgrst,'reload schema';
commit;
