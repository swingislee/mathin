-- 管理人员为具体课次追加材料；教师归属、原资料与课件冻结版本保持原值。
begin;

create function public.can_supplement_session_materials(p_session_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select auth.uid() is not null
    and public.is_staff(auth.uid())
    and public.has_perm(auth.uid(), 'class.manage')
    and exists (
      select 1 from public.class_sessions s
      join public.classrooms c on c.id = s.classroom_id
      where s.id = p_session_id and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null
        and c.trashed_at is null
        and public.can_manage_classroom(c.id, auth.uid())
    );
$$;
revoke all on function public.can_supplement_session_materials(uuid) from public, anon, authenticated;
grant execute on function public.can_supplement_session_materials(uuid) to authenticated;

-- 仅 RPC 能登记本事务的一次精确行写入。触发器消费后即清空，客户端不能伪造许可。
create table mathin_internal.session_material_supplement_writes (
  transaction_id bigint not null,
  session_id uuid not null,
  actor_id uuid not null,
  previous_payload jsonb,
  next_payload jsonb not null,
  primary key (transaction_id, session_id)
);
alter table mathin_internal.session_material_supplement_writes enable row level security;
revoke all on table mathin_internal.session_material_supplement_writes from public, anon, authenticated, service_role;

create or replace function public.guard_locked_session_preparation_artifact()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  target_session_id uuid;
  target_session public.class_sessions%rowtype;
  permitted boolean := false;
begin
  target_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  select * into target_session from public.class_sessions where id = target_session_id;
  if target_session.deleted_at is not null then raise exception 'PREPARATION_LOCKED'; end if;

  if tg_op in ('INSERT', 'UPDATE') and public.can_supplement_session_materials(target_session_id) then
    delete from mathin_internal.session_material_supplement_writes permit
    where permit.transaction_id = txid_current()
      and permit.session_id = target_session_id and permit.actor_id = auth.uid()
      and permit.previous_payload is not distinct from case when tg_op = 'UPDATE' then to_jsonb(old) else null end
      and permit.next_payload = to_jsonb(new)
    returning true into permitted;
  end if;

  if (target_session.courseware_frozen_at is not null or target_session.started_at is not null)
     and not public.is_feature_enabled('teaching.preparation_archive_edit')
     and not coalesce(permitted, false) then
    raise exception 'PREPARATION_LOCKED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_locked_session_preparation_artifact() from public, anon, authenticated;

create function public.supplement_session_preparation_artifact(
  p_session_id uuid,
  p_kind text,
  p_files jsonb default '[]'::jsonb,
  p_notes text default '',
  p_video_url text default ''
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  session_row public.class_sessions%rowtype;
  artifact public.session_preparation_artifacts%rowtype;
  previous_payload jsonb;
  artifact_exists boolean;
  files jsonb := coalesce(p_files, '[]'::jsonb);
  notes text := btrim(coalesce(p_notes, ''));
  video_url text := btrim(coalesce(p_video_url, ''));
  merged_files jsonb;
  file_item jsonb;
  existing_file jsonb;
  expected_prefix text;
  added_files integer := 0;
  notes_added boolean := false;
  video_added boolean := false;
  review_revision integer;
  submitted_at timestamptz;
  reviewer uuid;
  teacher uuid;
  written_at timestamptz := clock_timestamp();
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('solution', 'lesson_plan', 'rehearsal_video')
     or jsonb_typeof(files) is distinct from 'array' or octet_length(files::text) > 32768
     or length(notes) > 5000 or length(video_url) > 1000 then
    raise exception 'VALIDATION';
  end if;
  if jsonb_array_length(files) > 10 then raise exception 'FILES_LIMIT'; end if;
  if (p_kind = 'solution' and (video_url <> '' or (jsonb_array_length(files) = 0 and notes = '')))
     or (p_kind = 'lesson_plan' and (notes <> '' or video_url <> '' or jsonb_array_length(files) = 0))
     or (p_kind = 'rehearsal_video' and (notes <> '' or jsonb_array_length(files) <> 0
       or video_url !~* '^https://[^[:space:]/?#]+[^[:space:]]*$')) then
    raise exception 'VALIDATION';
  end if;

  -- 课次锁串行化首次补交，后续基于已锁定的现值追加，避免覆盖其他人员的资料。
  select s.* into session_row from public.class_sessions s
  join public.classrooms c on c.id = s.classroom_id
  where s.id = p_session_id and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null and c.trashed_at is null
  for update of s;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_supplement_session_materials(p_session_id) then raise exception 'FORBIDDEN'; end if;

  select * into artifact from public.session_preparation_artifacts where session_id = p_session_id for update;
  artifact_exists := found;
  previous_payload := case when artifact_exists then to_jsonb(artifact) else null end;
  if not artifact_exists then
    artifact.session_id := p_session_id;
    artifact.solution_notes := '';
    artifact.solution_files := '[]'::jsonb;
    artifact.lesson_plan_files := '[]'::jsonb;
    artifact.rehearsal_video_url := '';
  end if;

  if p_kind in ('solution', 'lesson_plan') then
    expected_prefix := p_session_id::text || '/' || case when p_kind = 'solution' then 'solution' else 'lesson-plan' end || '/';
    merged_files := case when p_kind = 'solution' then artifact.solution_files else artifact.lesson_plan_files end;
    for file_item in select value from jsonb_array_elements(files)
    loop
      if jsonb_typeof(file_item) is distinct from 'object'
         or jsonb_typeof(file_item->'path') is distinct from 'string'
         or jsonb_typeof(file_item->'name') is distinct from 'string'
         or jsonb_typeof(file_item->'type') is distinct from 'string'
         or jsonb_typeof(file_item->'size') is distinct from 'number'
         or left(file_item->>'path', length(expected_prefix)) is distinct from expected_prefix
         or substring(file_item->>'path' from length(expected_prefix) + 1) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
         or length(btrim(file_item->>'name')) not between 1 and 200
         or length(file_item->>'type') > 200
         or not (case when file_item->>'size' ~ '^[0-9]{1,8}$'
           then (file_item->>'size')::integer between 0 and 12582912 else false end)
         or file_item - array['path', 'name', 'type', 'size']::text[] <> '{}'::jsonb then
        raise exception 'VALIDATION';
      end if;
      select value into existing_file from jsonb_array_elements(merged_files) where value->>'path' = file_item->>'path' limit 1;
      if found then
        if existing_file is distinct from file_item then raise exception 'MATERIAL_CONFLICT'; end if;
      else
        if not exists (
          select 1 from storage.objects object_row
          where object_row.bucket_id = 'prep-artifacts' and object_row.name = file_item->>'path'
        ) then raise exception 'VALIDATION'; end if;
        merged_files := merged_files || jsonb_build_array(file_item);
        added_files := added_files + 1;
      end if;
    end loop;
    if jsonb_array_length(merged_files) > 10 then raise exception 'FILES_LIMIT'; end if;
    if octet_length(merged_files::text) > 32768 then raise exception 'VALIDATION'; end if;
    if p_kind = 'solution' then artifact.solution_files := merged_files;
    else artifact.lesson_plan_files := merged_files;
    end if;
  end if;

  if p_kind = 'solution' and notes <> ''
     and position(E'\n\n' || notes || E'\n\n' in E'\n\n' || artifact.solution_notes || E'\n\n') = 0 then
    artifact.solution_notes := artifact.solution_notes || case when artifact.solution_notes = '' then '' else E'\n\n' end || notes;
    if length(artifact.solution_notes) > 5000 then raise exception 'NOTES_LIMIT'; end if;
    notes_added := true;
  elsif p_kind = 'rehearsal_video' then
    if btrim(artifact.rehearsal_video_url) <> '' and btrim(artifact.rehearsal_video_url) <> video_url then
      raise exception 'MATERIAL_CONFLICT';
    end if;
    if btrim(artifact.rehearsal_video_url) = '' then
      artifact.rehearsal_video_url := video_url;
      video_added := true;
    end if;
  end if;

  if added_files = 0 and not notes_added and not video_added then
    select r.revision, r.submitted_at into review_revision, submitted_at
    from public.session_preparation_reviews r where r.session_id = p_session_id and r.artifact_kind = p_kind;
    return jsonb_build_object('changed', false, 'revision', coalesce(review_revision, 0), 'submittedAt', submitted_at);
  end if;

  -- 任课归属取课次代课人与班级教师分工；已有审校指派保留原值。
  select candidate.user_id into teacher from (
    select session_row.teacher_override as user_id, 0 as priority where session_row.teacher_override is not null
    union all
    select a.user_id, case when a.responsibility = 'primary_teacher' then 1 else 2 end
    from public.classroom_staff_assignments a
    where a.classroom_id = session_row.classroom_id
      and (a.responsibility = 'assistant_teacher' or (a.responsibility = 'primary_teacher' and session_row.teacher_override is null))
  ) candidate
  join public.profiles p on p.id = candidate.user_id
  where p.role in ('staff', 'admin') and p.is_active and p.account_status = 'active'
  order by candidate.priority, candidate.user_id limit 1;

  select p.reviewer_id into reviewer from public.session_preparations p where p.session_id = p_session_id for update;
  if reviewer is null then
    if teacher is null then raise exception 'REVIEWER_NOT_AVAILABLE'; end if;
    insert into public.session_preparations (
      session_id, status, last_contributor_id, reviewer_id,
      reviewer_assignment_source, reviewer_assigned_by, reviewer_assigned_at
    ) values (p_session_id, 'in_progress', actor, teacher, 'supervisor_assigned', actor, written_at)
    on conflict (session_id) do update set
      reviewer_id = excluded.reviewer_id, reviewer_assignment_source = excluded.reviewer_assignment_source,
      reviewer_assigned_by = excluded.reviewer_assigned_by, reviewer_assigned_at = excluded.reviewer_assigned_at,
      updated_at = written_at
    where public.session_preparations.reviewer_id is null;
  end if;

  artifact.updated_by := actor;
  artifact.updated_at := written_at;
  insert into mathin_internal.session_material_supplement_writes(transaction_id, session_id, actor_id, previous_payload, next_payload)
  values(txid_current(), p_session_id, actor, previous_payload, to_jsonb(artifact));
  if artifact_exists then
    update public.session_preparation_artifacts a set
      solution_notes = artifact.solution_notes, solution_files = artifact.solution_files,
      lesson_plan_files = artifact.lesson_plan_files, rehearsal_video_url = artifact.rehearsal_video_url,
      updated_by = actor, updated_at = written_at
    where a.session_id = p_session_id;
  else
    insert into public.session_preparation_artifacts
    select (artifact).*;
  end if;

  if p_kind = 'solution' then
    insert into public.solution_records(session_id, solution_source, content, created_by, updated_by)
    values(p_session_id, 'upload', jsonb_build_object('notes', artifact.solution_notes, 'files', artifact.solution_files), actor, actor)
    on conflict (session_id) where solution_source = 'upload' do update set
      content = excluded.content, revision = public.solution_records.revision + 1,
      updated_by = actor, updated_at = written_at;
  end if;

  insert into public.session_preparation_reviews(session_id, artifact_kind, submitted_by, submitted_at)
  values(p_session_id, p_kind, actor, written_at)
  on conflict (session_id, artifact_kind) do update set
    status = 'pending', revision = public.session_preparation_reviews.revision + 1,
    submitted_by = actor, submitted_at = written_at, reviewed_by = null, reviewed_at = null, review_note = ''
  returning revision, session_preparation_reviews.submitted_at into review_revision, submitted_at;
  perform public.notify_session_preparation_reviewers(p_session_id, p_kind, review_revision, actor);
  perform public.emit_domain_event(
    'session.preparation.supplemented', 'class_session', p_session_id,
    jsonb_build_object('artifactKind', p_kind, 'revision', review_revision, 'addedFiles', added_files,
      'notesAdded', notes_added, 'videoAdded', video_added, 'teacherId', teacher),
    teacher, '/dashboard/sessions/' || p_session_id::text || '?stage=pre&focus=prep-' || p_kind
  );
  return jsonb_build_object('changed', true, 'revision', review_revision, 'submittedAt', submitted_at);
end;
$$;
revoke all on function public.supplement_session_preparation_artifact(uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.supplement_session_preparation_artifact(uuid, text, jsonb, text, text) to authenticated;

-- 增补上传入口只允许受管课次的两类附件；原文件更新、删除与公开课策略沿用原值。
create policy prep_artifacts_storage_insert_supplement on storage.objects
for insert to authenticated with check (
  bucket_id = 'prep-artifacts'
  and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(solution|lesson-plan)/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
    then public.can_supplement_session_materials(split_part(name, '/', 1)::uuid)
    else false end
);

comment on function public.supplement_session_preparation_artifact(uuid, text, jsonb, text, text) is
  '按管理作用域追加一类课次材料，保留任课教师和既有资料，真实代交人入审计，变更进入待审核。';
comment on table mathin_internal.session_material_supplement_writes is
  '补交 RPC 与归档守卫之间的一次性精确行许可；在同一事务内消费，不接收客户端写入。';
commit;
