-- P4D-3：课堂知识总结与逐生多维课评。
alter table public.class_sessions add column if not exists knowledge_summary text not null default '';

create table public.session_reviews(
 session_id uuid not null references public.class_sessions(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 entry_score numeric(5,1) check(entry_score between 0 and 100),
 exit_score numeric(5,1) check(exit_score between 0 and 100),
 focus smallint check(focus between 1 and 5), participation smallint check(participation between 1 and 5), mastery smallint check(mastery between 1 and 5),
 comment text not null default '', created_by uuid references public.profiles(id) on delete set null,
 updated_at timestamptz not null default now(), primary key(session_id,student_id)
);
create index session_reviews_student_idx on public.session_reviews(student_id,updated_at desc);

create or replace function public.can_review_session(cid uuid,uid uuid) returns boolean language sql security definer stable set search_path=public,pg_temp as $$
 select public.is_admin(uid) or (public.has_perm(uid,'review.write') and (public.has_perm(uid,'class.view.all') or public.is_classroom_teacher(cid,uid)));
$$;
revoke all on function public.can_review_session(uuid,uuid) from public;grant execute on function public.can_review_session(uuid,uuid) to authenticated;

alter table public.session_reviews enable row level security;
create policy session_reviews_select_scope on public.session_reviews for select to authenticated using(public.can_access_student(student_id,(select auth.uid())) or exists(select 1 from public.class_sessions cs where cs.id=session_id and public.can_review_session(cs.classroom_id,(select auth.uid()))));
create policy session_reviews_insert_scope on public.session_reviews for insert to authenticated with check(exists(select 1 from public.class_sessions cs where cs.id=session_id and public.can_review_session(cs.classroom_id,(select auth.uid()))));
create policy session_reviews_update_scope on public.session_reviews for update to authenticated using(exists(select 1 from public.class_sessions cs where cs.id=session_id and public.can_review_session(cs.classroom_id,(select auth.uid())))) with check(exists(select 1 from public.class_sessions cs where cs.id=session_id and public.can_review_session(cs.classroom_id,(select auth.uid()))));
revoke all on public.session_reviews from anon,authenticated;grant select on public.session_reviews to authenticated;grant insert(session_id,student_id,entry_score,exit_score,focus,participation,mastery,comment,created_by) on public.session_reviews to authenticated;grant update(entry_score,exit_score,focus,participation,mastery,comment,updated_at) on public.session_reviews to authenticated;

create or replace function public.save_session_reviews(p_session_id uuid,p_knowledge_summary text,p_records jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid();cid uuid;item jsonb;sid uuid;
begin
 select classroom_id into cid from public.class_sessions where id=p_session_id and deleted_at is null;
 if cid is null then raise exception 'SESSION_NOT_FOUND';end if;
 if uid is null or not public.can_review_session(cid,uid) then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>200 then raise exception 'INVALID_RECORDS';end if;
 update public.class_sessions set knowledge_summary=left(trim(coalesce(p_knowledge_summary,'')),5000) where id=p_session_id;
 for item in select value from jsonb_array_elements(p_records) loop
  sid:=(item->>'studentId')::uuid;
  if not exists(select 1 from public.enrollments e where e.classroom_id=cid and e.student_id=sid) then raise exception 'STUDENT_NOT_IN_CLASS';end if;
  insert into public.session_reviews(session_id,student_id,entry_score,exit_score,focus,participation,mastery,comment,created_by)
  values(p_session_id,sid,nullif(item->>'entryScore','')::numeric,nullif(item->>'exitScore','')::numeric,nullif(item->>'focus','')::smallint,nullif(item->>'participation','')::smallint,nullif(item->>'mastery','')::smallint,left(coalesce(item->>'comment',''),2000),uid)
  on conflict(session_id,student_id) do update set entry_score=excluded.entry_score,exit_score=excluded.exit_score,focus=excluded.focus,participation=excluded.participation,mastery=excluded.mastery,comment=excluded.comment,updated_at=now();
 end loop;
end $$;
revoke all on function public.save_session_reviews(uuid,text,jsonb) from public,anon,authenticated;grant execute on function public.save_session_reviews(uuid,text,jsonb) to authenticated;

create or replace function public.get_my_session_reviews(p_from timestamptz,p_to timestamptz)
returns table(session_id uuid,student_id uuid,student_name text,classroom_name text,lecture_name text,scheduled_at timestamptz,entry_score numeric,exit_score numeric,focus smallint,participation smallint,mastery smallint,comment text,knowledge_summary text)
language sql security definer stable set search_path=public,pg_temp as $$
 select cs.id,s.id,s.name,c.name,cs.title,cs.scheduled_at,sr.entry_score,sr.exit_score,sr.focus,sr.participation,sr.mastery,sr.comment,cs.knowledge_summary
 from public.session_reviews sr join public.class_sessions cs on cs.id=sr.session_id join public.classrooms c on c.id=cs.classroom_id join public.students s on s.id=sr.student_id
 where s.deleted_at is null and cs.deleted_at is null and cs.scheduled_at>=p_from and cs.scheduled_at<p_to and (s.user_id=auth.uid() or exists(select 1 from public.student_guardians g where g.student_id=s.id and g.guardian_id=auth.uid())) order by cs.scheduled_at desc;
$$;
revoke all on function public.get_my_session_reviews(timestamptz,timestamptz) from public,anon,authenticated;grant execute on function public.get_my_session_reviews(timestamptz,timestamptz) to authenticated;
