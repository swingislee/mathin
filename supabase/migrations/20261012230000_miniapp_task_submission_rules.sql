begin;

create function mathin_internal.default_miniapp_task_rules() returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  select '{"version":1,"mediaTypes":["image","video"],"minFiles":1,"maxFiles":9,"noteRequired":false,"maxNoteLength":2000,"imageMaxBytes":12582912,"videoMaxBytes":67108864}'::jsonb;
$$;
create function mathin_internal.valid_miniapp_task_rules(p jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare key text;
begin
  if jsonb_typeof(p) is distinct from 'object' or p->'version' is distinct from '1'::jsonb
    or not(p ?& array['version','mediaTypes','minFiles','maxFiles','noteRequired','maxNoteLength','imageMaxBytes','videoMaxBytes'])
    or p-array['version','mediaTypes','minFiles','maxFiles','noteRequired','maxNoteLength','imageMaxBytes','videoMaxBytes']<>'{}'
    or jsonb_typeof(p->'noteRequired') is distinct from 'boolean' or jsonb_typeof(p->'mediaTypes') is distinct from 'array' then return false; end if;
  foreach key in array array['minFiles','maxFiles','maxNoteLength','imageMaxBytes','videoMaxBytes'] loop
    if jsonb_typeof(p->key) is distinct from 'number' or p->>key !~ '^[0-9]+$' then return false; end if;
  end loop;
  if (p->>'minFiles')::int not between 0 and 9 or (p->>'maxFiles')::int not between (p->>'minFiles')::int and 9
    or (p->>'maxNoteLength')::int not between 1 and 2000 or (p->>'imageMaxBytes')::bigint not between 1 and 12582912
    or (p->>'videoMaxBytes')::bigint not between 1 and 67108864 or jsonb_array_length(p->'mediaTypes')>2
    or exists(select 1 from jsonb_array_elements_text(p->'mediaTypes') v where v not in ('image','video'))
    or jsonb_array_length(p->'mediaTypes')<>(select count(distinct v) from jsonb_array_elements_text(p->'mediaTypes') v) then return false; end if;
  return case when p->>'maxFiles'='0' then p->'mediaTypes'='[]' and p->'noteRequired'='true' else jsonb_array_length(p->'mediaTypes')>0 end;
exception when others then return false;
end $$;
alter table public.assignments add column miniapp_submission_rules jsonb;
alter table public.miniapp_practice_submissions add column submission_rules jsonb;
alter table public.miniapp_practice_submissions drop constraint miniapp_practice_submissions_upload_ids_check;
alter table public.miniapp_practice_submissions add constraint miniapp_practice_submissions_upload_ids_check check(cardinality(upload_ids) between 0 and 9);
create function public.guard_assignment_miniapp_rules() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if new.miniapp_submission_rules is distinct from old.miniapp_submission_rules then raise exception 'SUBMISSION_RULES_IMMUTABLE'; end if;
  else
    new.miniapp_submission_rules:=coalesce(new.miniapp_submission_rules,mathin_internal.default_miniapp_task_rules());
    if not mathin_internal.valid_miniapp_task_rules(new.miniapp_submission_rules) then raise exception 'VALIDATION'; end if;
  end if;
  return new;
end $$;
create trigger assignments_miniapp_rules before insert or update on public.assignments for each row execute function public.guard_assignment_miniapp_rules();
grant insert(miniapp_submission_rules) on public.assignments to authenticated;

create function public.publish_session_assignment_with_rules(p_session_id uuid,p_title text,p_content text default '',p_due_at timestamptz default null,p_rules jsonb default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); cid uuid; assignment_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id into cid from class_sessions where id=p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(cid,uid) then raise exception 'FORBIDDEN'; end if;
  if length(trim(coalesce(p_title,''))) not between 1 and 100 or length(coalesce(p_content,''))>20000 then raise exception 'VALIDATION'; end if;
  insert into assignments(classroom_id,session_id,title,content,due_at,created_by,miniapp_submission_rules)
    values(cid,p_session_id,trim(p_title),jsonb_build_object('text',trim(coalesce(p_content,''))),p_due_at,uid,p_rules) returning id into assignment_id;
  update session_completion_tasks set status='done',completed_by=uid,completed_at=now(),skip_reason=null where session_id=p_session_id and kind='assignment' and status='pending';
  return assignment_id;
end $$;
-- Reuse the current homework-document publication, including its question snapshot.
do $copy$
declare definition text; body_start integer; anchor text:='aid:=public.publish_session_assignment(p_session_id,p_title,p_content,p_due_at);';
begin
  definition:=pg_get_functiondef('public.publish_session_template_assignment(uuid,text,text,timestamptz)'::regprocedure);
  body_start:=strpos(definition,E'\n RETURNS uuid');
  if body_start=0 or strpos(definition,anchor)=0 then raise exception 'ASSIGNMENT_PUBLICATION_SIGNATURE_CHANGED'; end if;
  definition:='create function public.publish_session_template_assignment_with_rules(p_session_id uuid,p_title text,p_content text default '''',p_due_at timestamptz default null,p_rules jsonb default null)'
    ||substr(definition,body_start);
  definition:=replace(definition,anchor,'aid:=public.publish_session_assignment_with_rules(p_session_id,p_title,p_content,p_due_at,p_rules);');
  execute definition;
end $copy$;
create or replace function public.publish_session_assignment(p_session_id uuid,p_title text,p_content text default '',p_due_at timestamptz default null)
returns uuid language sql security definer set search_path=public,pg_temp as $$
  select public.publish_session_assignment_with_rules(p_session_id,p_title,p_content,p_due_at,null);
$$;
create or replace function public.publish_session_template_assignment(p_session_id uuid,p_title text,p_content text default '',p_due_at timestamptz default null)
returns uuid language sql security definer set search_path=public,pg_temp as $$
  select public.publish_session_template_assignment_with_rules(p_session_id,p_title,p_content,p_due_at,null);
$$;
create function public.miniapp_task_submission_rules(p_assignment uuid,p_student uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rules jsonb;
begin
  if not public.miniapp_can_practice(p_assignment,p_student) then raise exception 'FORBIDDEN'; end if;
  select miniapp_submission_rules into rules from assignments where id=p_assignment;
  return coalesce(rules,mathin_internal.default_miniapp_task_rules());
end $$;
do $copy$ begin
  execute replace(pg_get_functiondef('public.miniapp_reserve_upload(uuid,uuid,uuid,text,text,text,text,bigint)'::regprocedure),
    'public.miniapp_reserve_upload(', 'mathin_internal.miniapp_reserve_upload_before_rules(');
end $copy$;
create or replace function public.miniapp_reserve_upload(p_id uuid,p_assignment uuid,p_student uuid,p_path text,p_name text,p_kind text,p_mime text,p_bytes bigint) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare rules jsonb:=public.miniapp_task_submission_rules(p_assignment,p_student);
begin
  if p_kind is null or not(rules->'mediaTypes' ? p_kind) or (rules->>'maxFiles')::int=0 then raise exception 'FILE_TYPE'; end if;
  if p_bytes is null or p_bytes<=0 or p_bytes>(rules->>case when p_kind='image' then 'imageMaxBytes' else 'videoMaxBytes' end)::bigint then raise exception 'TOO_LARGE'; end if;
  return mathin_internal.miniapp_reserve_upload_before_rules(p_id,p_assignment,p_student,p_path,p_name,p_kind,p_mime,p_bytes);
end $$;
create or replace function public.miniapp_my_practices() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item order by due_at nulls last,created_at desc),'[]') from (
    select a.due_at,a.created_at,jsonb_build_object('id',a.id,'participantId',s.id,'participantName',s.name,'title',a.title,
      'instructions',coalesce(a.content->>'text',''),'dueAt',a.due_at,'submissionRules',coalesce(a.miniapp_submission_rules,mathin_internal.default_miniapp_task_rules()),
      'submittedAt',(select max(x.submitted_at) from miniapp_practice_submissions x where x.assignment_id=a.id and x.student_id=s.id)) item
    from assignments a join enrollments e on e.classroom_id=a.classroom_id and e.status='active'
    join students s on s.id=e.student_id where public.miniapp_can_practice(a.id,s.id)
    order by a.due_at nulls last,a.created_at desc limit 100
  ) rows;
$$;
create or replace function public.miniapp_submit_practice(p_id uuid,p_assignment uuid,p_student uuid,p_note text,p_uploads uuid[]) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.miniapp_practice_submissions; amount integer; rules jsonb;
begin
  if not public.miniapp_can_practice(p_assignment,p_student) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or length(coalesce(p_note,''))>2000 or p_uploads is null or cardinality(p_uploads)>9
    or (select count(distinct x) from unnest(p_uploads) x)<>cardinality(p_uploads) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
  select * into saved from miniapp_practice_submissions where id=p_id;
  if saved.id is not null then
    if saved.assignment_id<>p_assignment or saved.student_id<>p_student or saved.submitted_by<>auth.uid()
      or saved.note<>coalesce(p_note,'') or saved.upload_ids<>p_uploads then raise exception 'CONFLICT'; end if;
    return saved.id;
  end if;
  rules:=public.miniapp_task_submission_rules(p_assignment,p_student);
  if cardinality(p_uploads) not between (rules->>'minFiles')::int and (rules->>'maxFiles')::int
    or length(coalesce(p_note,''))>(rules->>'maxNoteLength')::int
    or (rules->'noteRequired'='true' and btrim(coalesce(p_note,''))='')
    or (cardinality(p_uploads)=0 and btrim(coalesce(p_note,''))='') then raise exception 'VALIDATION'; end if;
  select count(*) into amount from miniapp_practice_uploads u join storage.objects o on o.bucket_id='miniapp-practice' and o.name=u.object_path
    where u.id=any(p_uploads) and u.ready and u.assignment_id=p_assignment and u.student_id=p_student and u.owner_id=auth.uid()
      and rules->'mediaTypes' ? u.kind and u.bytes<=(rules->>case when u.kind='image' then 'imageMaxBytes' else 'videoMaxBytes' end)::bigint
      and (u.kind='image' or public.miniapp_can_participate(p_student,'video'));
  if amount<>cardinality(p_uploads) then raise exception 'VALIDATION'; end if;
  insert into miniapp_practice_submissions(id,assignment_id,student_id,submitted_by,note,upload_ids,submission_rules)
    values(p_id,p_assignment,p_student,auth.uid(),coalesce(p_note,''),p_uploads,rules);
  update miniapp_practice_uploads set attached=true where id=any(p_uploads);
  return p_id;
end $$;
revoke all on function mathin_internal.default_miniapp_task_rules(),mathin_internal.valid_miniapp_task_rules(jsonb),
  mathin_internal.miniapp_reserve_upload_before_rules(uuid,uuid,uuid,text,text,text,text,bigint),public.guard_assignment_miniapp_rules(),
  public.publish_session_assignment_with_rules(uuid,text,text,timestamptz,jsonb),public.publish_session_template_assignment_with_rules(uuid,text,text,timestamptz,jsonb),
  public.miniapp_task_submission_rules(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_session_assignment_with_rules(uuid,text,text,timestamptz,jsonb),public.publish_session_template_assignment_with_rules(uuid,text,text,timestamptz,jsonb),
  public.miniapp_task_submission_rules(uuid,uuid) to authenticated,postgres;
-- Existing definer owners need the pure default helper used in the replaced listing.
grant execute on function mathin_internal.default_miniapp_task_rules() to postgres;
grant execute on function mathin_internal.miniapp_reserve_upload_before_rules(uuid,uuid,uuid,text,text,text,text,bigint) to postgres;
notify pgrst,'reload schema';
commit;
