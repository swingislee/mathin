-- P4D-4：课后视频私有存储、提交与审阅。
create table public.session_videos(
 id uuid primary key default gen_random_uuid(),session_id uuid not null references public.class_sessions(id) on delete cascade,student_id uuid not null references public.students(id) on delete cascade,
 uploaded_by uuid not null references public.profiles(id),storage_path text not null,duration_sec int,size_bytes bigint,note text not null default '',submitted_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,review_comment text not null default '',review_score smallint check(review_score between 1 and 5),deleted_at timestamptz
);
create index session_videos_session_idx on public.session_videos(session_id) where deleted_at is null;
alter table public.session_videos enable row level security;
create or replace function public.can_review_video_session(cid uuid,uid uuid)returns boolean language sql security definer stable set search_path=public,pg_temp as $$select public.is_admin(uid) or (public.has_perm(uid,'video.review') and (public.has_perm(uid,'class.view.all') or public.is_classroom_teacher(cid,uid)))$$;
revoke all on function public.can_review_video_session(uuid,uuid) from public;grant execute on function public.can_review_video_session(uuid,uuid) to authenticated;
create policy session_videos_select_scope on public.session_videos for select to authenticated using(deleted_at is null and (exists(select 1 from public.students s where s.id=student_id and s.user_id=(select auth.uid())) or public.can_access_student(student_id,(select auth.uid()))));
create policy session_videos_insert_scope on public.session_videos for insert to authenticated with check(uploaded_by=(select auth.uid()) and exists(select 1 from public.class_sessions cs join public.enrollments e on e.classroom_id=cs.classroom_id and e.student_id=student_id and e.status='active' where cs.id=session_id and ((exists(select 1 from public.students s where s.id=student_id and s.user_id=(select auth.uid()))) or public.can_review_session(cs.classroom_id,(select auth.uid())))));
create policy session_videos_update_review on public.session_videos for update to authenticated using(exists(select 1 from public.class_sessions cs where cs.id=session_id and public.can_review_video_session(cs.classroom_id,(select auth.uid())))) with check(exists(select 1 from public.class_sessions cs where cs.id=session_id and public.can_review_video_session(cs.classroom_id,(select auth.uid()))));
revoke all on public.session_videos from anon,authenticated;grant select on public.session_videos to authenticated;grant insert(id,session_id,student_id,uploaded_by,storage_path,duration_sec,size_bytes,note) on public.session_videos to authenticated;grant update(reviewed_by,reviewed_at,review_comment,review_score,deleted_at) on public.session_videos to authenticated;

insert into storage.buckets(id,name,public,file_size_limit)values('session-videos','session-videos',false,209715200)on conflict(id)do update set public=false,file_size_limit=excluded.file_size_limit;
create policy session_videos_storage_insert on storage.objects for insert to authenticated with check(bucket_id='session-videos' and (exists(select 1 from public.classroom_members cm where cm.classroom_id=(storage.foldername(name))[1]::uuid and cm.user_id=(select auth.uid())) or public.can_review_session((storage.foldername(name))[1]::uuid,(select auth.uid()))));
create policy session_videos_storage_select_staff_self on storage.objects for select to authenticated using(bucket_id='session-videos' and (exists(select 1 from public.session_videos v join public.students s on s.id=v.student_id where v.storage_path=name and s.user_id=(select auth.uid()) and v.deleted_at is null) or public.can_review_video_session((storage.foldername(name))[1]::uuid,(select auth.uid()))));

create or replace function public.get_my_video_sessions() returns table(session_id uuid,student_id uuid,classroom_id uuid,classroom_name text,lecture_name text,scheduled_at timestamptz) language sql security definer stable set search_path=public,pg_temp as $$
 select cs.id,s.id,c.id,c.name,cs.title,cs.scheduled_at from public.students s join public.enrollments e on e.student_id=s.id and e.status='active' join public.classrooms c on c.id=e.classroom_id join public.class_sessions cs on cs.classroom_id=c.id
 where s.user_id=auth.uid() and s.deleted_at is null and cs.deleted_at is null and cs.scheduled_at between now()-interval '14 days' and now() and (cs.ended_at is not null or cs.scheduled_at+coalesce(cs.duration_min,0)*interval '1 minute'<now()) order by cs.scheduled_at desc;
$$;
revoke all on function public.get_my_video_sessions() from public,anon,authenticated;grant execute on function public.get_my_video_sessions() to authenticated;

create or replace function public.get_my_reviewed_videos() returns table(video_id uuid,session_id uuid,student_id uuid,review_score smallint,review_comment text) language sql security definer stable set search_path=public,pg_temp as $$
 select v.id,v.session_id,v.student_id,v.review_score,v.review_comment from public.session_videos v join public.students s on s.id=v.student_id where v.deleted_at is null and v.reviewed_at is not null and s.deleted_at is null and (s.user_id=auth.uid() or exists(select 1 from public.student_guardians g where g.student_id=s.id and g.guardian_id=auth.uid()));
$$;
revoke all on function public.get_my_reviewed_videos() from public,anon,authenticated;grant execute on function public.get_my_reviewed_videos() to authenticated;
