-- R1-5 family learning actions: parent-assisted homework/media, leave entry, and role-targeted notifications.

begin;

alter table public.submissions
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null;

update public.submissions set submitted_by = user_id where submitted_by is null;

create or replace function public.can_submit_student_assignment(p_student_id uuid, p_uid uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.students student_row
     where student_row.id = p_student_id
       and student_row.deleted_at is null
       and (
         student_row.user_id = p_uid
         or exists (
           select 1
             from public.student_guardians guardian_row
            where guardian_row.student_id = student_row.id
              and guardian_row.guardian_id = p_uid
              and 'grades' = any(guardian_row.scope)
         )
       )
  )
$$;

revoke all on function public.can_submit_student_assignment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_submit_student_assignment(uuid, uuid) to authenticated;

create or replace function public.get_my_pending_assignments()
returns table(
  assignment_id uuid, classroom_id uuid, classroom_name text, title text, due_at timestamptz,
  student_id uuid, student_name text
)
language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  return query
  select assignment_row.id, assignment_row.classroom_id, classroom_row.name, assignment_row.title,
         assignment_row.due_at, student_row.id, student_row.name
    from public.students student_row
    join public.enrollments enrollment_row
      on enrollment_row.student_id = student_row.id and enrollment_row.status = 'active'
    join public.classrooms classroom_row on classroom_row.id = enrollment_row.classroom_id
    join public.assignments assignment_row on assignment_row.classroom_id = classroom_row.id
   where student_row.user_id is not null
     and public.can_submit_student_assignment(student_row.id, uid)
     and not exists (
       select 1 from public.submissions submission_row
        where submission_row.assignment_id = assignment_row.id
          and submission_row.user_id = student_row.user_id
          and submission_row.submitted_at is not null
     )
   order by assignment_row.due_at asc nulls last, assignment_row.created_at desc;
end
$$;

revoke all on function public.get_my_pending_assignments() from public, anon, authenticated;
grant execute on function public.get_my_pending_assignments() to authenticated;

create or replace function public.get_customer_assignment(p_assignment_id uuid, p_student_id uuid)
returns table(
  assignment_id uuid, classroom_id uuid, classroom_name text, title text,
  content jsonb, due_at timestamptz, student_id uuid, student_name text
)
language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_submit_student_assignment(p_student_id, uid) then raise exception 'FORBIDDEN'; end if;
  return query
  select assignment_row.id, assignment_row.classroom_id, classroom_row.name, assignment_row.title,
         assignment_row.content, assignment_row.due_at, student_row.id, student_row.name
    from public.assignments assignment_row
    join public.classrooms classroom_row on classroom_row.id = assignment_row.classroom_id
    join public.enrollments enrollment_row
      on enrollment_row.classroom_id = assignment_row.classroom_id
     and enrollment_row.student_id = p_student_id
     and enrollment_row.status = 'active'
    join public.students student_row on student_row.id = enrollment_row.student_id
   where assignment_row.id = p_assignment_id
     and student_row.user_id is not null;
end
$$;

create or replace function public.get_customer_submission(p_assignment_id uuid, p_student_id uuid)
returns table(
  id uuid, user_id uuid, content jsonb, submitted_at timestamptz,
  score numeric, feedback text, graded_at timestamptz
)
language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); student_user_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_submit_student_assignment(p_student_id, uid) then raise exception 'FORBIDDEN'; end if;
  select user_id into student_user_id from public.students where id = p_student_id and deleted_at is null;
  if student_user_id is null then return; end if;
  return query
  select submission_row.id, submission_row.user_id, submission_row.content, submission_row.submitted_at,
         submission_row.score, submission_row.feedback, submission_row.graded_at
    from public.submissions submission_row
   where submission_row.assignment_id = p_assignment_id
     and submission_row.user_id = student_user_id;
end
$$;

revoke all on function public.get_customer_assignment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_customer_submission(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_customer_assignment(uuid, uuid) to authenticated;
grant execute on function public.get_customer_submission(uuid, uuid) to authenticated;

create or replace function public.validate_assignment_submission_content(
  p_assignment_id uuid, p_student_id uuid, p_content jsonb
)
returns jsonb language plpgsql security definer immutable set search_path = public, pg_temp
as $$
declare attachment jsonb; normalized jsonb := coalesce(p_content, '{}'::jsonb);
begin
  if jsonb_typeof(normalized) <> 'object' or octet_length(normalized::text) > 65536 then
    raise exception 'VALIDATION';
  end if;
  if jsonb_typeof(coalesce(normalized -> 'attachments', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(normalized -> 'attachments', '[]'::jsonb)) > 12 then
    raise exception 'VALIDATION';
  end if;
  for attachment in select value from jsonb_array_elements(coalesce(normalized -> 'attachments', '[]'::jsonb))
  loop
    if jsonb_typeof(attachment) <> 'object'
       or coalesce(attachment ->> 'path', '') not like p_assignment_id::text || '/' || p_student_id::text || '/%'
       or length(coalesce(attachment ->> 'path', '')) > 500
       or length(coalesce(attachment ->> 'name', '')) not between 1 and 200
       or coalesce(attachment ->> 'size', '') !~ '^[0-9]+$'
       or (attachment ->> 'size')::bigint > 12582912 then
      raise exception 'VALIDATION';
    end if;
  end loop;
  return jsonb_build_object(
    'text', left(coalesce(normalized ->> 'text', ''), 20000),
    'attachments', coalesce(normalized -> 'attachments', '[]'::jsonb)
  );
end
$$;

revoke all on function public.validate_assignment_submission_content(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.submit_assignment_for_student(
  p_assignment_id uuid, p_student_id uuid, p_content jsonb
)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); student_user_id uuid; submission_id uuid; clean_content jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_submit_student_assignment(p_student_id, uid) then raise exception 'FORBIDDEN'; end if;
  select student_row.user_id into student_user_id
    from public.students student_row
    join public.assignments assignment_row on assignment_row.id = p_assignment_id
    join public.enrollments enrollment_row
      on enrollment_row.classroom_id = assignment_row.classroom_id
     and enrollment_row.student_id = student_row.id
     and enrollment_row.status = 'active'
   where student_row.id = p_student_id and student_row.deleted_at is null;
  if student_user_id is null then raise exception 'STUDENT_ACCOUNT_REQUIRED'; end if;
  clean_content := public.validate_assignment_submission_content(p_assignment_id, p_student_id, p_content);
  insert into public.submissions(assignment_id, user_id, submitted_by, content, submitted_at)
  values(p_assignment_id, student_user_id, uid, clean_content, now())
  on conflict(assignment_id, user_id) do update
    set submitted_by = excluded.submitted_by, content = excluded.content, submitted_at = excluded.submitted_at
  returning id into submission_id;
  return submission_id;
end
$$;

create or replace function public.submit_assignment(p_assignment_id uuid, p_content jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); student_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select id into student_id from public.students where user_id = uid and deleted_at is null;
  if student_id is null then raise exception 'FORBIDDEN'; end if;
  perform public.submit_assignment_for_student(p_assignment_id, student_id, p_content);
end
$$;

revoke all on function public.submit_assignment_for_student(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_assignment_for_student(uuid, uuid, jsonb) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values(
  'assignment-submissions', 'assignment-submissions', false, 12582912,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict(id) do update set
  public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into public.file_policies(
  bucket_id, purpose, access_mode, upload_protocol, max_bytes, owner_quota_bytes,
  allowed_mime_types, orphan_grace_hours, retention_days, malicious_content_policy
)
values(
  'assignment-submissions', 'Compressed photos and PDFs attached to student homework submissions.',
  'signed', 'standard', 12582912, 1073741824,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'],
  24, 730, 'signature_only'
)
on conflict(bucket_id) do update set
  purpose = excluded.purpose, access_mode = excluded.access_mode,
  upload_protocol = excluded.upload_protocol, max_bytes = excluded.max_bytes,
  owner_quota_bytes = excluded.owner_quota_bytes, allowed_mime_types = excluded.allowed_mime_types,
  orphan_grace_hours = excluded.orphan_grace_hours, retention_days = excluded.retention_days,
  malicious_content_policy = excluded.malicious_content_policy, enabled = true, updated_at = now();

drop policy if exists assignment_submissions_storage_insert on storage.objects;
create policy assignment_submissions_storage_insert on storage.objects
for insert to authenticated with check(
  bucket_id = 'assignment-submissions'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
  and public.can_submit_student_assignment((storage.foldername(name))[2]::uuid, (select auth.uid()))
  and exists(
    select 1
      from public.assignments assignment_row
      join public.enrollments enrollment_row
        on enrollment_row.classroom_id = assignment_row.classroom_id
       and enrollment_row.student_id = (storage.foldername(name))[2]::uuid
       and enrollment_row.status = 'active'
     where assignment_row.id = (storage.foldername(name))[1]::uuid
  )
);

drop policy if exists assignment_submissions_storage_select on storage.objects;
create policy assignment_submissions_storage_select on storage.objects
for select to authenticated using(
  bucket_id = 'assignment-submissions'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
  and (
    public.can_submit_student_assignment((storage.foldername(name))[2]::uuid, (select auth.uid()))
    or public.is_assignment_teacher((storage.foldername(name))[1]::uuid, (select auth.uid()))
  )
);

create or replace function public.link_submission_managed_files()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare attachment jsonb;
begin
  for attachment in select value from jsonb_array_elements(coalesce(new.content -> 'attachments', '[]'::jsonb))
  loop
    update public.managed_files
       set linked_entity_type = 'submission', linked_entity_id = new.id, linked_at = coalesce(linked_at, now())
     where bucket_id = 'assignment-submissions' and object_path = attachment ->> 'path';
  end loop;
  return new;
end
$$;

drop trigger if exists submissions_link_managed_files on public.submissions;
create trigger submissions_link_managed_files
after insert or update of content on public.submissions
for each row execute function public.link_submission_managed_files();

create or replace function public.can_upload_student_media(p_student_id uuid, p_uid uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.students student_row
     where student_row.id = p_student_id and student_row.deleted_at is null
       and (
         student_row.user_id = p_uid
         or exists(
           select 1 from public.student_guardians guardian_row
            where guardian_row.student_id = student_row.id
              and guardian_row.guardian_id = p_uid
              and 'video' = any(guardian_row.scope)
         )
       )
  )
$$;

revoke all on function public.can_upload_student_media(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_upload_student_media(uuid, uuid) to authenticated;

drop policy if exists session_videos_insert_scope on public.session_videos;
create policy session_videos_insert_scope on public.session_videos
for insert to authenticated with check(
  uploaded_by = (select auth.uid())
  and exists(
    select 1 from public.class_sessions session_row
    join public.enrollments enrollment_row
      on enrollment_row.classroom_id = session_row.classroom_id
     and enrollment_row.student_id = student_id
     and enrollment_row.status = 'active'
    where session_row.id = session_id
      and (
        public.can_upload_student_media(student_id, (select auth.uid()))
        or public.can_review_session(session_row.classroom_id, (select auth.uid()))
      )
  )
);

drop policy if exists session_videos_storage_insert on storage.objects;
create policy session_videos_storage_insert on storage.objects
for insert to authenticated with check(
  bucket_id = 'session-videos'
  and exists(
    select 1 from public.enrollments enrollment_row
     where enrollment_row.classroom_id = (storage.foldername(name))[1]::uuid
       and enrollment_row.status = 'active'
       and public.can_upload_student_media(enrollment_row.student_id, (select auth.uid()))
  )
);

drop policy if exists session_videos_storage_select_staff_self on storage.objects;
create policy session_videos_storage_select_staff_self on storage.objects
for select to authenticated using(
  bucket_id = 'session-videos'
  and (
    exists(
      select 1 from public.session_videos video_row
       where video_row.storage_path = name and video_row.deleted_at is null
         and public.can_upload_student_media(video_row.student_id, (select auth.uid()))
    )
    or public.can_review_video_session((storage.foldername(name))[1]::uuid, (select auth.uid()))
  )
);

create or replace function public.get_my_video_sessions()
returns table(
  session_id uuid, student_id uuid, classroom_id uuid, classroom_name text,
  lecture_name text, scheduled_at timestamptz
)
language sql security definer stable set search_path = public, pg_temp
as $$
  select session_row.id, student_row.id, classroom_row.id, classroom_row.name,
         session_row.title, session_row.scheduled_at
    from public.students student_row
    join public.enrollments enrollment_row
      on enrollment_row.student_id = student_row.id and enrollment_row.status = 'active'
    join public.classrooms classroom_row on classroom_row.id = enrollment_row.classroom_id
    join public.class_sessions session_row on session_row.classroom_id = classroom_row.id
   where public.can_upload_student_media(student_row.id, auth.uid())
     and student_row.deleted_at is null and session_row.deleted_at is null
     and session_row.scheduled_at between now() - interval '14 days' and now()
     and (session_row.ended_at is not null
       or session_row.scheduled_at + coalesce(session_row.duration_min, 0) * interval '1 minute' < now())
   order by session_row.scheduled_at desc
$$;

create or replace function public.get_my_video_uploads()
returns table(video_id uuid, session_id uuid, lecture_name text, submitted_at timestamptz, reviewed_at timestamptz)
language sql security definer stable set search_path = public, pg_temp
as $$
  select video_row.id, video_row.session_id, session_row.title, video_row.submitted_at, video_row.reviewed_at
    from public.session_videos video_row
    join public.class_sessions session_row on session_row.id = video_row.session_id
   where video_row.uploaded_by = auth.uid() and video_row.deleted_at is null
   order by video_row.submitted_at desc
$$;

create or replace function public.notify_family_learning_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare recipient uuid; classroom_id uuid; student_id uuid; student_name text; assignment_title text;
begin
  if tg_table_name = 'assignments' then
    for student_id, student_name, recipient in
      select student_row.id, student_row.name, target.user_id
        from public.enrollments enrollment_row
        join public.students student_row on student_row.id = enrollment_row.student_id
        cross join lateral (
          select student_row.user_id as user_id
          union
          select guardian_row.guardian_id
            from public.student_guardians guardian_row
           where guardian_row.student_id = student_row.id and 'grades' = any(guardian_row.scope)
        ) target
       where enrollment_row.classroom_id = new.classroom_id
         and enrollment_row.status = 'active' and target.user_id is not null
    loop
      perform public.emit_domain_event(
        'assignment.published', 'assignment', new.id,
        jsonb_build_object('title', new.title, 'studentId', student_id, 'studentName', student_name),
        recipient, '/dashboard/assignments/' || new.id::text || '?student=' || student_id::text
      );
    end loop;
  elsif tg_table_name = 'submissions' then
    select assignment_row.classroom_id, assignment_row.title, student_row.id, student_row.name
      into classroom_id, assignment_title, student_id, student_name
      from public.assignments assignment_row
      join public.students student_row on student_row.user_id = new.user_id
     where assignment_row.id = new.assignment_id;
    if tg_op = 'INSERT' or new.submitted_at is distinct from old.submitted_at then
      for recipient in
        select member_row.user_id from public.classroom_members member_row
         where member_row.classroom_id = classroom_id and member_row.role = 'teacher'
      loop
        perform public.emit_domain_event(
          'assignment.submitted', 'submission', new.id,
          jsonb_build_object('title', assignment_title, 'studentId', student_id, 'studentName', student_name),
          recipient, '/classroom/' || classroom_id::text || '/assignment/' || new.assignment_id::text
        );
      end loop;
    end if;
    if tg_op = 'UPDATE' and new.graded_at is distinct from old.graded_at and new.graded_at is not null then
      for recipient in
        select target.user_id from (
          select new.user_id as user_id
          union
          select guardian_row.guardian_id
            from public.student_guardians guardian_row
           where guardian_row.student_id = student_id and 'grades' = any(guardian_row.scope)
        ) target where target.user_id is not null
      loop
        perform public.emit_domain_event(
          'assignment.graded', 'submission', new.id,
          jsonb_build_object('title', assignment_title, 'studentId', student_id, 'studentName', student_name, 'score', new.score),
          recipient, '/dashboard/assignments/' || new.assignment_id::text || '?student=' || student_id::text
        );
      end loop;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists assignments_notify_family on public.assignments;
create trigger assignments_notify_family after insert on public.assignments
for each row execute function public.notify_family_learning_change();

drop trigger if exists submissions_notify_family on public.submissions;
create trigger submissions_notify_family after insert or update of submitted_at, graded_at on public.submissions
for each row execute function public.notify_family_learning_change();

create or replace function public.notify_leave_request_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare recipient uuid; classroom_id uuid; student_name text;
begin
  select session_row.classroom_id, student_row.name into classroom_id, student_name
    from public.class_sessions session_row
    join public.students student_row on student_row.id = new.student_id
   where session_row.id = new.session_id;
  if tg_op = 'INSERT' then
    for recipient in
      select assignment_row.user_id
        from public.classroom_staff_assignments assignment_row
       where assignment_row.classroom_id = classroom_id
         and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher', 'learning_support')
    loop
      perform public.emit_domain_event(
        'leave_request.submitted', 'session_leave_request', new.id,
        jsonb_build_object('studentId', new.student_id, 'studentName', student_name, 'reason', new.reason),
        recipient, '/dashboard/sessions/' || new.session_id::text
      );
    end loop;
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.emit_domain_event(
      'leave_request.' || new.status, 'session_leave_request', new.id,
      jsonb_build_object('studentId', new.student_id, 'studentName', student_name, 'reason', new.reason),
      new.requested_by, '/dashboard/children?child=' || new.student_id::text || '#leave'
    );
  end if;
  return new;
end
$$;

drop trigger if exists session_leave_requests_notify_roles on public.session_leave_requests;
create trigger session_leave_requests_notify_roles
after insert or update of status on public.session_leave_requests
for each row execute function public.notify_leave_request_change();

commit;
