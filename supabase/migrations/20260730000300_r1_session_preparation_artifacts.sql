-- R1 preparation production artifacts and completion gate.

begin;

create table if not exists public.session_preparation_artifacts (
  session_id uuid primary key references public.class_sessions(id) on delete cascade,
  solution_notes text not null default '',
  solution_files jsonb not null default '[]'::jsonb,
  lesson_plan_files jsonb not null default '[]'::jsonb,
  rehearsal_video_url text not null default '',
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint session_prep_solution_files_cap check (
    jsonb_typeof(solution_files) = 'array' and jsonb_array_length(solution_files) <= 10 and octet_length(solution_files::text) <= 32768
  ),
  constraint session_prep_lesson_files_cap check (
    jsonb_typeof(lesson_plan_files) = 'array' and jsonb_array_length(lesson_plan_files) <= 10 and octet_length(lesson_plan_files::text) <= 32768
  ),
  constraint session_prep_notes_cap check (length(solution_notes) <= 5000),
  constraint session_prep_rehearsal_url_cap check (length(rehearsal_video_url) <= 1000)
);

alter table public.session_preparation_artifacts enable row level security;
drop policy if exists session_preparation_artifacts_select_scope on public.session_preparation_artifacts;
create policy session_preparation_artifacts_select_scope on public.session_preparation_artifacts
for select to authenticated using(
  public.is_session_teacher(session_id, (select auth.uid()))
  or public.is_admin((select auth.uid()))
);
revoke all on table public.session_preparation_artifacts from anon, authenticated;
grant select on table public.session_preparation_artifacts to authenticated;

create or replace function public.validate_prep_artifact_files(
  p_session_id uuid, p_kind text, p_files jsonb
)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare item jsonb;
begin
  if p_kind not in ('solution','lesson-plan') or jsonb_typeof(p_files) <> 'array'
     or jsonb_array_length(p_files) > 10 or octet_length(p_files::text) > 32768 then
    raise exception 'VALIDATION';
  end if;
  for item in select value from jsonb_array_elements(p_files)
  loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item->>'path','') not like p_session_id::text || '/' || p_kind || '/%'
       or length(coalesce(item->>'path','')) > 500
       or length(coalesce(item->>'name','')) not between 1 and 200
       or coalesce(item->>'size','') !~ '^[0-9]+$'
       or (item->>'size')::bigint > 12582912 then
      raise exception 'VALIDATION';
    end if;
  end loop;
  return p_files;
end
$$;

create or replace function public.save_session_preparation_artifacts(
  p_session_id uuid,
  p_solution_notes text,
  p_solution_files jsonb,
  p_lesson_plan_files jsonb,
  p_rehearsal_video_url text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); session_exists boolean;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select exists(select 1 from public.class_sessions where id = p_session_id and deleted_at is null)
    into session_exists;
  if not session_exists then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if length(coalesce(p_solution_notes,'')) > 5000
     or length(coalesce(p_rehearsal_video_url,'')) > 1000
     or (btrim(coalesce(p_rehearsal_video_url,'')) <> ''
       and btrim(p_rehearsal_video_url) !~* '^https://') then
    raise exception 'VALIDATION';
  end if;
  insert into public.session_preparation_artifacts(
    session_id, solution_notes, solution_files, lesson_plan_files,
    rehearsal_video_url, updated_by
  )
  values(
    p_session_id, left(btrim(coalesce(p_solution_notes,'')),5000),
    public.validate_prep_artifact_files(p_session_id,'solution',coalesce(p_solution_files,'[]'::jsonb)),
    public.validate_prep_artifact_files(p_session_id,'lesson-plan',coalesce(p_lesson_plan_files,'[]'::jsonb)),
    left(btrim(coalesce(p_rehearsal_video_url,'')),1000), uid
  )
  on conflict(session_id) do update set
    solution_notes = excluded.solution_notes,
    solution_files = excluded.solution_files,
    lesson_plan_files = excluded.lesson_plan_files,
    rehearsal_video_url = excluded.rehearsal_video_url,
    updated_by = uid,
    updated_at = now();
end
$$;

create or replace function public.assert_session_preparation_complete(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); artifact_row public.session_preparation_artifacts%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select * into artifact_row from public.session_preparation_artifacts where session_id = p_session_id;
  if artifact_row.session_id is null
     or jsonb_array_length(artifact_row.solution_files) = 0
     or jsonb_array_length(artifact_row.lesson_plan_files) = 0
     or btrim(artifact_row.rehearsal_video_url) = '' then
    raise exception 'PREP_ARTIFACTS_REQUIRED';
  end if;
  if not exists(select 1 from public.session_learning_checks where session_id = p_session_id) then
    raise exception 'LEARNING_CHECKS_REQUIRED';
  end if;
end
$$;

revoke all on function public.validate_prep_artifact_files(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.save_session_preparation_artifacts(uuid,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.assert_session_preparation_complete(uuid) from public, anon, authenticated;
grant execute on function public.save_session_preparation_artifacts(uuid,text,jsonb,jsonb,text) to authenticated;
grant execute on function public.assert_session_preparation_complete(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'prep-artifacts','prep-artifacts',false,12582912,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists prep_artifacts_storage_insert on storage.objects;
create policy prep_artifacts_storage_insert on storage.objects
for insert to authenticated with check(
  bucket_id='prep-artifacts'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] in ('solution','lesson-plan')
  and public.is_session_teacher((storage.foldername(name))[1]::uuid,(select auth.uid()))
);
drop policy if exists prep_artifacts_storage_select on storage.objects;
create policy prep_artifacts_storage_select on storage.objects
for select to authenticated using(
  bucket_id='prep-artifacts'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and public.is_session_teacher((storage.foldername(name))[1]::uuid,(select auth.uid()))
);
drop policy if exists prep_artifacts_storage_delete on storage.objects;
create policy prep_artifacts_storage_delete on storage.objects
for delete to authenticated using(
  bucket_id='prep-artifacts'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and public.is_session_teacher((storage.foldername(name))[1]::uuid,(select auth.uid()))
);

commit;
