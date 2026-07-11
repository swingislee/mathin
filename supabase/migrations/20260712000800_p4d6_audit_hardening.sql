-- P4D-6 审计收口：撤销旧直删旁路，补视频受控删除与本人上传列表。
drop policy if exists courses_delete_manage on public.courses;
drop policy if exists lectures_delete_manage on public.course_lectures;
revoke delete on public.courses from authenticated;
revoke delete on public.course_lectures from authenticated;
revoke update(deleted_at) on public.session_videos from authenticated;

create or replace function public.get_my_video_uploads()returns table(video_id uuid,session_id uuid,lecture_name text,submitted_at timestamptz,reviewed_at timestamptz)language sql security definer stable set search_path=public,pg_temp as $$select v.id,v.session_id,cs.title,v.submitted_at,v.reviewed_at from public.session_videos v join public.students s on s.id=v.student_id join public.class_sessions cs on cs.id=v.session_id where s.user_id=auth.uid() and v.deleted_at is null order by v.submitted_at desc$$;
create or replace function public.delete_session_video(p_video_id uuid)returns void language plpgsql security definer set search_path=public,pg_temp as $$begin update public.session_videos set deleted_at=now() where id=p_video_id and deleted_at is null and (public.is_admin(auth.uid()) or (uploaded_by=auth.uid() and reviewed_at is null));if not found then raise exception 'FORBIDDEN_OR_REVIEWED';end if;end$$;
revoke all on function public.get_my_video_uploads() from public,anon,authenticated;
revoke all on function public.delete_session_video(uuid) from public,anon,authenticated;
grant execute on function public.get_my_video_uploads() to authenticated;
grant execute on function public.delete_session_video(uuid) to authenticated;
