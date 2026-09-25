-- 交互题目沿用组合页合同，作业副本与资源访问继续受业务范围约束。
create table public.homework_assets (
  binding_key text primary key check(binding_key ~ '^[0-9a-f]{64}$'),
  scope text not null check(scope in ('classroom','lecture','assignment')),
  target_id uuid not null,
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  kind text not null check(kind in ('image','h5')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index homework_assets_target on public.homework_assets(scope,target_id);
alter table public.homework_assets enable row level security;
create function public.can_read_homework_asset(p_key text,p_uid uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_uid is not null and exists(select 1 from public.homework_assets a where a.binding_key=p_key and (
    public.can_access_homework_document(a.scope,a.target_id,p_uid) or exists(
      select 1 from public.homework_documents d where public.can_access_homework_document(
        case when d.classroom_id is not null then 'classroom' when d.lecture_id is not null then 'lecture' else 'assignment' end,
        coalesce(d.classroom_id,d.lecture_id,d.assignment_id),p_uid)
      and jsonb_path_exists(d.document,'$.**.bindingKey ? (@ == $key)',jsonb_build_object('key',p_key))
    )
  ))
$$;
create policy homework_assets_read on public.homework_assets for select to authenticated using(public.can_read_homework_asset(binding_key,auth.uid()));
revoke all on public.homework_assets from anon,authenticated;
grant select on public.homework_assets to authenticated;
grant all on public.homework_assets to service_role;
create function public.homework_composition_is_valid(p_doc jsonb,p_uid uuid) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if p_doc is null or p_doc='null'::jsonb then return true; end if;
  if public.cw_courseware_composition_doc_is_valid(p_doc) is distinct from true
    or p_doc->'source' is distinct from 'null'::jsonb
    or p_doc#>'{overlay,canvas,backgroundBindingKey}' is distinct from 'null'::jsonb
    or p_doc#>'{overlay,interactions}' is distinct from '[]'::jsonb
    or exists(select 1 from jsonb_array_elements(p_doc#>'{layout,blocks}') b where b->>'type'='h5')
    or exists(select 1 from jsonb_array_elements(p_doc#>'{overlay,nodes}') n where n->>'adapter' not in ('text','rich_text','shape','image','h5') or n->'children' is distinct from '[]'::jsonb)
    or exists(select 1 from jsonb_path_query(p_doc,'$.**.bindingKey') k where jsonb_typeof(k)<>'string' or not public.can_read_homework_asset(k#>>'{}',p_uid)) then return false; end if;
  return true;
exception when others then return false;
end $$;
revoke all on function public.can_read_homework_asset(text,uuid),public.homework_composition_is_valid(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.can_read_homework_asset(text,uuid) to authenticated;

create or replace function public.save_homework_document(p_scope text,p_target_id uuid,p_revision text,p_document jsonb)
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
  if jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>12582912
    or jsonb_typeof(p_document->'questions') is distinct from 'array' or jsonb_array_length(p_document->'questions')>60
    or jsonb_typeof(p_document->'overrides') is distinct from 'array' or jsonb_array_length(p_document->'overrides')>3600
    or jsonb_typeof(p_document->'topic') is distinct from 'string' or length(p_document->>'topic')>100
    or jsonb_typeof(p_document->'instructions') is distinct from 'string' or length(p_document->>'instructions')>20000
    or jsonb_typeof(p_document->'lessonPlan') is distinct from 'string' or length(p_document->>'lessonPlan')>50000 then raise exception 'VALIDATION'; end if;
  if exists(select 1 from jsonb_array_elements(p_document->'questions') e group by e->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_document->'questions') e group by btrim(e->>'group'),btrim(e->>'label') having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_document->'overrides') e group by e->>'studentId',e->>'questionId' having count(*)>1) then raise exception 'VALIDATION'; end if;
  if p_document ? 'groups' and (jsonb_typeof(p_document->'groups') is distinct from 'array' or jsonb_array_length(p_document->'groups')>60) then raise exception 'VALIDATION'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_document->'groups','[]')) e where jsonb_typeof(e)<>'string' or length(btrim(e#>>'{}')) not between 1 and 60)
    or exists(select 1 from jsonb_array_elements_text(coalesce(p_document->'groups','[]')) e group by btrim(e) having count(*)>1) then raise exception 'VALIDATION'; end if;
  for item in select value from jsonb_array_elements(p_document->'questions') loop
    qid:=(item->>'id')::uuid;
    if qid is null or jsonb_typeof(item->'label') is distinct from 'string' or length(btrim(item->>'label')) not between 1 and 100
      or jsonb_typeof(item->'group') is distinct from 'string' or length(item->>'group')>60
      or jsonb_typeof(item->'content') is distinct from 'string' or length(item->>'content')>10000
      or jsonb_typeof(item->'answer') is distinct from 'string' or length(item->>'answer')>10000 then raise exception 'VALIDATION'; end if;
    if not public.homework_composition_is_valid(item->'composition',auth.uid()) or not public.homework_composition_is_valid(item->'answerComposition',auth.uid()) then raise exception 'VALIDATION'; end if;
    questions:=questions||jsonb_build_array(jsonb_build_object('id',qid,'label',btrim(item->>'label'),'group',btrim(item->>'group'),'content',item->>'content','answer',item->>'answer','sourceQuestionId',nullif(item->>'sourceQuestionId','')::uuid,'composition',item->'composition','answerComposition',item->'answerComposition'));
  end loop;
  if p_scope<>'assignment' and jsonb_array_length(p_document->'overrides')>0 then raise exception 'VALIDATION'; end if;
  for item in select value from jsonb_array_elements(p_document->'overrides') loop
    sid:=(item->>'studentId')::uuid; qid:=(item->>'questionId')::uuid;
    if not exists(select 1 from public.assignment_question_roster(p_target_id) where student_id=sid) or not exists(select 1 from jsonb_array_elements(questions) e where e->>'id'=qid::text)
      or jsonb_typeof(item->'content') is distinct from 'string' or length(item->>'content')>10000 then raise exception 'VALIDATION'; end if;
    if not public.homework_composition_is_valid(item->'composition',auth.uid()) then raise exception 'VALIDATION'; end if;
    overrides:=overrides||jsonb_build_array(jsonb_build_object('studentId',sid,'questionId',qid,'content',item->>'content','composition',item->'composition'));
  end loop;
  clean:=jsonb_build_object('topic',btrim(p_document->>'topic'),'instructions',p_document->>'instructions','lessonPlan',p_document->>'lessonPlan','dueAt',nullif(p_document->>'dueAt','')::timestamptz,'questions',questions,'overrides',overrides,'groups',coalesce(p_document->'groups','[]'));
  if exists(select 1 from jsonb_array_elements(questions) e where e->>'group'<>'' and not (clean->'groups') ? (e->>'group')) then
    clean:=jsonb_set(clean,'{groups}',(select jsonb_agg(name order by ord) from (select name,min(ord) ord from (select value name,ordinality ord from jsonb_array_elements_text(clean->'groups') with ordinality union all select e->>'group',1000+ordinality from jsonb_array_elements(questions) with ordinality t(e,ordinality) where e->>'group'<>'') all_groups group by name) unique_groups));
  end if;
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

create or replace function public.publish_session_template_assignment(p_session_id uuid,p_title text,p_content text default '',p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare aid uuid; class_doc jsonb; lecture_doc jsonb; layout jsonb; item jsonb; source jsonb; questions jsonb:='[]'; draft jsonb; state jsonb;
begin
  aid:=public.publish_session_assignment(p_session_id,p_title,p_content,p_due_at);
  select d.document into class_doc from public.homework_documents d join public.class_sessions s on s.classroom_id=d.classroom_id where s.id=p_session_id;
  select d.document into lecture_doc from public.homework_documents d join public.class_sessions s on s.lecture_id=d.lecture_id where s.id=p_session_id;
  layout:=case when jsonb_array_length(coalesce(class_doc->'questions','[]'))>0 then class_doc->'questions' else coalesce(lecture_doc->'questions','[]') end;
  for item in select value from jsonb_array_elements(layout) loop
    select e into source from jsonb_array_elements(coalesce(lecture_doc->'questions','[]')) e where e->>'group'=item->>'group' and e->>'label'=item->>'label';
    questions:=questions||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'label',item->>'label','group',item->>'group','content',coalesce(source->>'content',''),'answer',coalesce(source->>'answer',''),'sourceQuestionId',source->>'id','composition',source->'composition','answerComposition',source->'answerComposition'));
  end loop;
  state:=public.get_homework_document('assignment',aid);
  draft:=(state->'document')||jsonb_build_object('questions',questions,'groups',coalesce(case when jsonb_array_length(coalesce(class_doc->'questions','[]'))>0 then class_doc->'groups' else lecture_doc->'groups' end,'[]'));
  perform public.save_homework_document('assignment',aid,state->>'revision',draft);
  return aid;
end $$;
