-- 课次教学材料的管理只读范围；审核、备课编辑与课堂控制沿用原权限。
create or replace function public.can_read_session_materials(p_session_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.class_sessions s
    join public.classrooms c on c.id = s.classroom_id
    where s.id = p_session_id and s.deleted_at is null and c.trashed_at is null
      and (public.is_session_teacher(s.id, auth.uid())
        or public.can_review_session_preparation(s.id, auth.uid())
        or public.has_perm(auth.uid(), 'class.view.all'))
  );
$$;
revoke all on function public.can_read_session_materials(uuid) from public, anon, authenticated;
grant execute on function public.can_read_session_materials(uuid) to authenticated;

create or replace function public.get_session_materials(p_session_id uuid, p_classroom_id uuid, p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s public.class_sessions%rowtype;
  a public.session_preparation_artifacts%rowtype;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_kind is null or p_kind not in ('summary','lesson_plan','solution','rehearsal_video','courseware') then raise exception 'VALIDATION'; end if;
  if not public.can_read_session_materials(p_session_id) then raise exception 'FORBIDDEN'; end if;
  select * into s from public.class_sessions where id = p_session_id and classroom_id = p_classroom_id;
  if not found then raise exception 'FORBIDDEN'; end if;
  select * into a from public.session_preparation_artifacts where session_id = s.id;
  if p_kind = 'summary' then
    result := jsonb_build_object(
      'title', s.title, 'classroomName', (select name from public.classrooms where id = s.classroom_id), 'scheduledAt', s.scheduled_at,
      'lessonPlanCount', (select count(*) from public.lesson_plans where session_id = s.id) + jsonb_array_length(coalesce(a.lesson_plan_files, '[]'::jsonb)),
      'solutionCount', (select count(*) from public.solution_records where session_id = s.id and solution_source = 'board') + jsonb_array_length(coalesce(a.solution_files, '[]'::jsonb)),
      'hasSolutionNotes', length(trim(coalesce(a.solution_notes, ''))) > 0,
      'hasVideo', length(trim(coalesce(a.rehearsal_video_url, ''))) > 0);
  elsif p_kind = 'lesson_plan' then
    result := jsonb_build_object('plan', (
      select jsonb_build_object('id', p.id, 'content', p.content, 'status', p.status, 'revision', p.revision, 'updatedAt', p.updated_at)
      from public.lesson_plans p where p.session_id = s.id
    ), 'files', coalesce(a.lesson_plan_files, '[]'::jsonb));
  elsif p_kind = 'solution' then
    result := jsonb_build_object('notes', coalesce(a.solution_notes, ''), 'files', coalesce(a.solution_files, '[]'::jsonb),
      'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'pageDocId', r.page_doc_id,
        'revision', r.revision, 'content', r.content, 'updatedAt', r.updated_at) order by r.updated_at, r.id)
        from public.solution_records r where r.session_id = s.id and r.solution_source = 'board'), '[]'::jsonb));
  elsif p_kind = 'rehearsal_video' then
    result := jsonb_build_object('url', coalesce(a.rehearsal_video_url, ''), 'updatedAt', a.updated_at);
  else
    result := jsonb_build_object('frozenAt', s.courseware_frozen_at, 'pages', case when s.courseware_frozen_at is not null then s.courseware else null end,
      'overlay', s.courseware_overlay);
  end if;
  return jsonb_build_object('kind', p_kind) || result;
end;
$$;
revoke all on function public.get_session_materials(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.get_session_materials(uuid,uuid,text) to authenticated;

drop policy lesson_plans_select_scope on public.lesson_plans;
create policy lesson_plans_select_scope on public.lesson_plans for select to authenticated using (public.can_read_session_materials(session_id));
drop policy solution_records_select_scope on public.solution_records;
create policy solution_records_select_scope on public.solution_records for select to authenticated using (public.can_read_session_materials(session_id));
drop policy session_preparation_artifacts_select_scope on public.session_preparation_artifacts;
create policy session_preparation_artifacts_select_scope on public.session_preparation_artifacts for select to authenticated using (public.can_read_session_materials(session_id));
drop policy session_preparation_reviews_select_scope on public.session_preparation_reviews;
create policy session_preparation_reviews_select_scope on public.session_preparation_reviews for select to authenticated using (public.can_read_session_materials(session_id));

drop policy prep_artifacts_storage_select on storage.objects;
create policy prep_artifacts_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'prep-artifacts' and cardinality(storage.foldername(name)) >= 2
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_read_session_materials((storage.foldername(name))[1]::uuid)
      or public.can_teach_public_class_segment((storage.foldername(name))[1]::uuid, auth.uid())
    else false end
);
