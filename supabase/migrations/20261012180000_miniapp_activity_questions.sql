begin;

create or replace function mathin_internal.valid_activity_page(p jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare b jsonb; k text; keys text[]; extra jsonb;
begin
  if p ? 'questions' and not mathin_internal.valid_miniapp_questions(p->'questions') then return false; end if;
  if p is null or jsonb_typeof(p)<>'object' or p->'version'<>'1'::jsonb
    or jsonb_typeof(p->'layout')<>'string' or p->>'layout' not in ('cards','continuous') or jsonb_typeof(p->'cover')<>'string'
    or jsonb_typeof(p->'blocks')<>'array' or octet_length(p::text)>200000
    or not (p ?& array['version','layout','cover','blocks'])
    or exists(select 1 from jsonb_object_keys(p) v where v not in ('version','layout','cover','blocks','listing','signup','questions')) then return false; end if;
  if jsonb_array_length(p->'blocks')>30 or char_length(p->>'cover')>120 then return false; end if;
  if p ? 'listing' then
    extra:=p->'listing';
    if jsonb_typeof(extra)<>'object' or not(extra ?& array['cover','summary','labels','sortOrder'])
      or exists(select 1 from jsonb_object_keys(extra) v where v not in ('cover','summary','labels','sortOrder'))
      or jsonb_typeof(extra->'cover')<>'string' or char_length(extra->>'cover')>120
      or jsonb_typeof(extra->'summary')<>'string' or char_length(extra->>'summary')>200
      or jsonb_typeof(extra->'labels')<>'array' or jsonb_array_length(extra->'labels')>5
      or jsonb_typeof(extra->'sortOrder')<>'number' or (extra->>'sortOrder')::numeric<>trunc((extra->>'sortOrder')::numeric)
      or abs((extra->>'sortOrder')::numeric)>9999 then return false; end if;
    if exists(select 1 from jsonb_array_elements(extra->'labels') l where jsonb_typeof(l)<>'string' or char_length(l#>>'{}') not between 1 and 24)
      or (select count(*)<>count(distinct l) from jsonb_array_elements(extra->'labels') l) then return false; end if;
  end if;
  if p ? 'signup' then
    extra:=p->'signup';
    if jsonb_typeof(extra)<>'object' or not(extra ?& array['instructions','confirmation','success'])
      or exists(select 1 from jsonb_object_keys(extra) v where v not in ('instructions','confirmation','success'))
      or jsonb_typeof(extra->'instructions')<>'string' or char_length(extra->>'instructions')>2000
      or jsonb_typeof(extra->'confirmation')<>'string' or char_length(extra->>'confirmation')>500
      or jsonb_typeof(extra->'success')<>'string' or char_length(extra->>'success')>2000 then return false; end if;
  end if;
  for b in select value from jsonb_array_elements(p->'blocks') loop
    if jsonb_typeof(b)<>'object' or not (b ?& array['id','type'])
      or (b->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    keys:=case b->>'type' when 'text' then array['id','type','title','body']
      when 'image' then array['id','type','imagePath','caption']
      when 'imageText' then array['id','type','imagePath','title','body','position'] else null end;
    if keys is null or not (b ?& keys) or exists(select 1 from jsonb_object_keys(b) v where not(v=any(keys))) then return false; end if;
    foreach k in array keys loop
      if jsonb_typeof(b->k)<>'string' then return false; end if;
    end loop;
    if char_length(b->>'title')>120 or char_length(b->>'body')>6000 or char_length(b->>'caption')>300
      or char_length(b->>'imagePath')>120 or (b->>'type'='imageText' and b->>'position' not in ('above','left','right')) then return false; end if;
  end loop;
  return (select count(*)=count(distinct value->>'id') from jsonb_array_elements(p->'blocks'));
exception when others then return false;
end $$;

create or replace function public.miniapp_activity_detail(p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare offer jsonb; page jsonb; native_kind text; page_revision integer;
begin
  select x into offer from jsonb_array_elements(public.miniapp_participant_activity_catalog()) x where x->>'id'=p_target_id::text;
  if offer is null then return null; end if;
  native_kind:=case when exists(select 1 from miniapp_short_course_publications p join classrooms c on c.id=p.classroom_id
    where c.id=p_target_id and c.offering_type='short_term_topic') then 'class' else 'activity' end;
  select published,published_revision into page,page_revision from miniapp_activity_pages where kind=native_kind and target_id=p_target_id;
  return jsonb_build_object('offer',offer,'page',page,'pageRevision',coalesce(page_revision,0));
end $$;

-- Preserve the proven identity, visibility and request-id transaction as an internal implementation.
alter function public.miniapp_participant_apply_registration(uuid,uuid,integer,uuid) set schema mathin_internal;
alter function mathin_internal.miniapp_participant_apply_registration(uuid,uuid,integer,uuid) rename to participant_apply_registration_base;
revoke all on function mathin_internal.participant_apply_registration_base(uuid,uuid,integer,uuid) from public,anon,authenticated;

create function public.miniapp_participant_apply_registration_form(p_id uuid,p_target_id uuid,p_revision integer,p_student_id uuid,p_page_revision integer,p_answers jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.parent_registration_applications; target_kind text; content jsonb; content_revision integer; fields jsonb; result uuid;
begin
  if not coalesce(public.miniapp_can_register(p_student_id,'activity'),false) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_target_id is null or p_revision is null or p_revision<1 or p_page_revision<0
    or jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text)>20000 then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text,6843));
  select * into existing from parent_registration_applications where id=p_id;
  if found then
    result:=mathin_internal.participant_apply_registration_base(p_id,p_target_id,p_revision,p_student_id);
    if coalesce(existing.snapshot#>'{registrationForm,answers}','{}'::jsonb) is distinct from p_answers
      or coalesce((existing.snapshot#>>'{registrationForm,revision}')::integer,0)<>coalesce(p_page_revision,0) then raise exception 'CONFLICT'; end if;
    return result;
  end if;
  target_kind:=case when exists(select 1 from miniapp_short_course_publications p join classrooms c on c.id=p.classroom_id
    where c.id=p_target_id and c.offering_type='short_term_topic') then 'class' else 'activity' end;
  select published,published_revision into content,content_revision from miniapp_activity_pages where kind=target_kind and target_id=p_target_id for share;
  fields:=coalesce(content->'questions','[]'::jsonb);
  if (p_page_revision is null and fields<>'[]'::jsonb) or (p_page_revision is not null and p_page_revision<>coalesce(content_revision,0)) then raise exception 'FORM_CHANGED'; end if;
  perform mathin_internal.validate_miniapp_answers(fields,p_answers);
  result:=mathin_internal.participant_apply_registration_base(p_id,p_target_id,p_revision,p_student_id);
  update parent_registration_applications set snapshot=snapshot||jsonb_build_object('registrationForm',
    jsonb_build_object('revision',coalesce(p_page_revision,0),'fields',fields,'answers',p_answers)) where id=result;
  return result;
end $$;
create function public.miniapp_participant_apply_registration(p_id uuid,p_target_id uuid,p_revision integer,p_student_id uuid) returns uuid
language sql security definer set search_path=public,pg_temp as $$
  select public.miniapp_participant_apply_registration_form(p_id,p_target_id,p_revision,p_student_id,null,'{}'::jsonb);
$$;

-- Lists carry only a small presence flag; answers are loaded explicitly and stay account/scoped-staff protected.
create or replace function mathin_internal.parent_registration_application_json(p_row public.parent_registration_applications,p_name text) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_row.id,'kind',p_row.kind,'participantId',p_row.student_id,'participantName',p_name,
    'publicationId',coalesce(p_row.classroom_id,p_row.activity_id),'classroomId',p_row.classroom_id,'activityId',p_row.activity_id,
    'title',p_row.snapshot->>'title','className',coalesce(p_row.snapshot#>>'{classes,0,name}',''),
    'priceCents',null,'status',p_row.status,'createdAt',p_row.created_at,'resolvedAt',p_row.resolved_at,'reply',p_row.reply,
    'canCancel',p_row.status='pending','hasAnswers',coalesce(jsonb_array_length(p_row.snapshot#>'{registrationForm,fields}'),0)>0);
$$;
create function public.miniapp_registration_answers(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.parent_registration_applications; allowed boolean:=false;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into r from parent_registration_applications where id=p_id;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.applicant_id=auth.uid() and public.miniapp_can_register(r.student_id,'activity') then allowed:=true;
  elsif public.can_access_student(r.student_id,auth.uid()) then
    allowed:=case r.kind
      when 'class' then public.can_manage_classroom(r.classroom_id,auth.uid()) and (public.has_perm(auth.uid(),'class.manage') or public.has_perm(auth.uid(),'enrollment.manage'))
      when 'activity' then public.has_perm(auth.uid(),'activity.register') and exists(select 1 from activities where id=r.activity_id and deleted_at is null and record_state='current')
      else false end;
  end if;
  if not coalesce(allowed,false) then raise exception 'FORBIDDEN'; end if;
  return coalesce(r.snapshot->'registrationForm','{"revision":0,"fields":[],"answers":{}}'::jsonb);
end $$;
revoke all on function public.miniapp_participant_apply_registration_form(uuid,uuid,integer,uuid,integer,jsonb),
  public.miniapp_participant_apply_registration(uuid,uuid,integer,uuid),public.miniapp_registration_answers(uuid) from public,anon,authenticated;
grant execute on function public.miniapp_participant_apply_registration_form(uuid,uuid,integer,uuid,integer,jsonb),
  public.miniapp_participant_apply_registration(uuid,uuid,integer,uuid),public.miniapp_registration_answers(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
