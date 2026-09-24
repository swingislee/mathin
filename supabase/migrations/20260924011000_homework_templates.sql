-- 班级只定义题号结构，教研维护讲次内容，课次保存独立副本及逐生调整。
create table public.homework_documents (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid unique references public.classrooms(id) on delete restrict,
  lecture_id uuid unique references public.course_lectures(id) on delete restrict,
  assignment_id uuid unique references public.assignments(id) on delete restrict,
  document jsonb not null,
  version integer not null check(version>0),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check(num_nonnulls(classroom_id,lecture_id,assignment_id)=1)
);
create table public.homework_document_revisions (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.homework_documents(id) on delete restrict,
  version integer not null,
  before_value jsonb not null,
  after_value jsonb not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(document_id,version)
);
create function public.can_access_homework_document(p_scope text,p_target_id uuid,p_uid uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_uid is not null and public.is_staff(p_uid) and case p_scope
    when 'lecture' then exists(select 1 from public.course_lectures where id=p_target_id) and public.has_perm(p_uid,'course.view') and (not p_write or public.has_perm(p_uid,'courseware.review'))
    when 'classroom' then exists(select 1 from public.classrooms c where c.id=p_target_id and c.archived_at is null and c.trashed_at is null and
      (public.is_admin(p_uid) or not p_write and public.has_perm(p_uid,'class.view.all') or exists(select 1 from public.classroom_staff_assignments a where a.classroom_id=c.id and a.user_id=p_uid and a.responsibility in ('primary_teacher','assistant_teacher'))))
      and (not p_write or public.has_perm(p_uid,'review.write'))
    when 'assignment' then case when p_write then public.can_write_assignment_questions(p_target_id,p_uid) else public.can_read_assignment_questions(p_target_id,p_uid) end
      and not exists(select 1 from public.assignments a join public.class_sessions s on s.id=a.session_id where a.id=p_target_id and s.cancelled_by is not null)
    else false end
$$;
alter table public.homework_documents enable row level security;
alter table public.homework_document_revisions enable row level security;
create policy homework_documents_read on public.homework_documents for select to authenticated using(public.can_access_homework_document(
  case when classroom_id is not null then 'classroom' when lecture_id is not null then 'lecture' else 'assignment' end,coalesce(classroom_id,lecture_id,assignment_id),auth.uid()));
create policy homework_document_revisions_read on public.homework_document_revisions for select to authenticated using(exists(select 1 from public.homework_documents where id=document_id));
revoke all on public.homework_documents,public.homework_document_revisions from anon,authenticated;
grant select on public.homework_documents,public.homework_document_revisions to authenticated;

create function public.get_homework_document(p_scope text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare doc jsonb; record_row public.homework_documents%rowtype; assignment_row public.assignments%rowtype; class_doc jsonb; lecture_doc jsonb; students jsonb:='[]';
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_access_homework_document(p_scope,p_target_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
  select * into record_row from public.homework_documents where
    case p_scope when 'classroom' then classroom_id when 'lecture' then lecture_id when 'assignment' then assignment_id end=p_target_id;
  doc:=coalesce(record_row.document,jsonb_build_object('topic','','instructions','','lessonPlan','','dueAt',null,'questions','[]'::jsonb,'overrides','[]'::jsonb));
  if p_scope='assignment' then
    select * into assignment_row from public.assignments where id=p_target_id;
    doc:=doc||jsonb_build_object('topic',assignment_row.title,'instructions',coalesce(assignment_row.content->>'text',''),'dueAt',assignment_row.due_at,
      'questions',coalesce((select jsonb_agg(coalesce((select e from jsonb_array_elements(doc->'questions') e where e->>'id'=q.id::text),jsonb_build_object('id',q.id,'label',q.title,'group','','content','','answer','','sourceQuestionId',null)) order by q.position)
        from public.assignment_questions q where q.assignment_id=p_target_id),'[]'));
    select document into class_doc from public.homework_documents where classroom_id=assignment_row.classroom_id;
    select d.document into lecture_doc from public.homework_documents d join public.class_sessions s on s.lecture_id=d.lecture_id where s.id=assignment_row.session_id;
    select coalesce(jsonb_agg(jsonb_build_object('id',student_id,'name',name) order by roster_order),'[]') into students from public.assignment_question_roster(p_target_id);
  end if;
  return jsonb_build_object('version',coalesce(record_row.version,0),'revision',md5(doc::text),'canWrite',public.can_access_homework_document(p_scope,p_target_id,auth.uid(),true),
    'document',doc,'classTemplate',class_doc,'lectureTemplate',lecture_doc,'students',students);
end $$;

create function public.save_homework_document(p_scope text,p_target_id uuid,p_revision text,p_document jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous jsonb; item jsonb; qid uuid; sid uuid; pos integer; doc_id uuid; next_version integer; clean jsonb; questions jsonb:='[]'; overrides jsonb:='[]';
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_access_homework_document(p_scope,p_target_id,auth.uid(),true) then raise exception 'FORBIDDEN'; end if;
  if p_scope='assignment' then perform 1 from public.assignments where id=p_target_id for update;
  elsif p_scope='classroom' then perform 1 from public.classrooms where id=p_target_id for update;
  else perform 1 from public.course_lectures where id=p_target_id for update; end if;
  previous:=public.get_homework_document(p_scope,p_target_id);
  if previous->>'revision' is distinct from p_revision then raise exception 'CONFLICT'; end if;
  if jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>1048576
    or jsonb_typeof(p_document->'questions') is distinct from 'array' or jsonb_array_length(p_document->'questions')>60
    or jsonb_typeof(p_document->'overrides') is distinct from 'array' or jsonb_array_length(p_document->'overrides')>3600
    or jsonb_typeof(p_document->'topic') is distinct from 'string' or length(p_document->>'topic')>100
    or jsonb_typeof(p_document->'instructions') is distinct from 'string' or length(p_document->>'instructions')>20000
    or jsonb_typeof(p_document->'lessonPlan') is distinct from 'string' or length(p_document->>'lessonPlan')>50000 then raise exception 'VALIDATION'; end if;
  if exists(select 1 from jsonb_array_elements(p_document->'questions') e group by e->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_document->'questions') e group by btrim(e->>'group'),btrim(e->>'label') having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_document->'overrides') e group by e->>'studentId',e->>'questionId' having count(*)>1) then raise exception 'VALIDATION'; end if;
  for item in select value from jsonb_array_elements(p_document->'questions') loop
    qid:=(item->>'id')::uuid;
    if qid is null or jsonb_typeof(item->'label') is distinct from 'string' or length(btrim(item->>'label')) not between 1 and 100
      or jsonb_typeof(item->'group') is distinct from 'string' or length(item->>'group')>60
      or jsonb_typeof(item->'content') is distinct from 'string' or length(item->>'content')>10000
      or jsonb_typeof(item->'answer') is distinct from 'string' or length(item->>'answer')>10000 then raise exception 'VALIDATION'; end if;
    questions:=questions||jsonb_build_array(jsonb_build_object('id',qid,'label',btrim(item->>'label'),'group',btrim(item->>'group'),'content',item->>'content','answer',item->>'answer','sourceQuestionId',nullif(item->>'sourceQuestionId','')::uuid));
  end loop;
  if p_scope<>'assignment' and jsonb_array_length(p_document->'overrides')>0 then raise exception 'VALIDATION'; end if;
  for item in select value from jsonb_array_elements(p_document->'overrides') loop
    sid:=(item->>'studentId')::uuid; qid:=(item->>'questionId')::uuid;
    if not exists(select 1 from public.assignment_question_roster(p_target_id) where student_id=sid) or not exists(select 1 from jsonb_array_elements(questions) e where e->>'id'=qid::text)
      or jsonb_typeof(item->'content') is distinct from 'string' or length(item->>'content')>10000 then raise exception 'VALIDATION'; end if;
    overrides:=overrides||jsonb_build_array(jsonb_build_object('studentId',sid,'questionId',qid,'content',item->>'content'));
  end loop;
  clean:=jsonb_build_object('topic',btrim(p_document->>'topic'),'instructions',p_document->>'instructions','lessonPlan',p_document->>'lessonPlan','dueAt',nullif(p_document->>'dueAt','')::timestamptz,'questions',questions,'overrides',overrides);
  if p_scope='assignment' then
    if length(clean->>'topic')=0 then raise exception 'VALIDATION'; end if;
    if exists(select 1 from public.assignment_questions q where q.assignment_id=p_target_id and not exists(select 1 from jsonb_array_elements(questions) e where e->>'id'=q.id::text)) then raise exception 'QUESTION_IN_USE'; end if;
    select coalesce(max(position)+1,0) into pos from public.assignment_questions where assignment_id=p_target_id;
    for item in select value from jsonb_array_elements(questions) loop
      qid:=(item->>'id')::uuid;
      if exists(select 1 from public.assignment_questions where id=qid) then
        if not exists(select 1 from public.assignment_questions where id=qid and assignment_id=p_target_id) then raise exception 'FORBIDDEN'; end if;
        update public.assignment_questions set title=item->>'label' where id=qid;
      else
        if pos>=60 then raise exception 'QUESTION_LIMIT'; end if;
        insert into public.assignment_questions(id,assignment_id,position,title,created_by) values(qid,p_target_id,pos,item->>'label',auth.uid()); pos:=pos+1;
      end if;
    end loop;
    update public.assignments set title=clean->>'topic',content=content||jsonb_build_object('text',clean->>'instructions'),due_at=(clean->>'dueAt')::timestamptz where id=p_target_id;
  end if;
  next_version:=(previous->>'version')::integer+1;
  select id into doc_id from public.homework_documents where case p_scope when 'classroom' then classroom_id when 'lecture' then lecture_id else assignment_id end=p_target_id;
  if doc_id is null then
    insert into public.homework_documents(classroom_id,lecture_id,assignment_id,document,version,updated_by)
      values(case when p_scope='classroom' then p_target_id end,case when p_scope='lecture' then p_target_id end,case when p_scope='assignment' then p_target_id end,clean,next_version,auth.uid()) returning id into doc_id;
  else update public.homework_documents set document=clean,version=next_version,updated_by=auth.uid(),updated_at=now() where id=doc_id; end if;
  insert into public.homework_document_revisions(document_id,version,before_value,after_value,actor_id) values(doc_id,next_version,previous->'document',clean,auth.uid());
  return public.get_homework_document(p_scope,p_target_id);
end $$;

create function public.publish_session_template_assignment(p_session_id uuid,p_title text,p_content text default '',p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare aid uuid; class_doc jsonb; lecture_doc jsonb; layout jsonb; item jsonb; source jsonb; questions jsonb:='[]'; draft jsonb; state jsonb;
begin
  aid:=public.publish_session_assignment(p_session_id,p_title,p_content,p_due_at);
  select d.document into class_doc from public.homework_documents d join public.class_sessions s on s.classroom_id=d.classroom_id where s.id=p_session_id;
  select d.document into lecture_doc from public.homework_documents d join public.class_sessions s on s.lecture_id=d.lecture_id where s.id=p_session_id;
  layout:=case when jsonb_array_length(coalesce(class_doc->'questions','[]'))>0 then class_doc->'questions' else coalesce(lecture_doc->'questions','[]') end;
  for item in select value from jsonb_array_elements(layout) loop
    select e into source from jsonb_array_elements(coalesce(lecture_doc->'questions','[]')) e where e->>'group'=item->>'group' and e->>'label'=item->>'label';
    questions:=questions||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'label',item->>'label','group',item->>'group','content',coalesce(source->>'content',''),'answer',coalesce(source->>'answer',''),'sourceQuestionId',source->>'id'));
  end loop;
  state:=public.get_homework_document('assignment',aid);
  draft:=(state->'document')||jsonb_build_object('questions',questions);
  perform public.save_homework_document('assignment',aid,state->>'revision',draft);
  return aid;
end $$;
revoke all on function public.can_access_homework_document(text,uuid,uuid,boolean),public.get_homework_document(text,uuid),public.save_homework_document(text,uuid,text,jsonb),public.publish_session_template_assignment(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.can_access_homework_document(text,uuid,uuid,boolean),public.get_homework_document(text,uuid),public.save_homework_document(text,uuid,text,jsonb),public.publish_session_template_assignment(uuid,text,text,timestamptz) to authenticated;
