begin;

create or replace function public.validate_courseware_annotation_content(p_content jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  item jsonb;
  point jsonb;
  item_kind text;
  numeric_value numeric;
begin
  if jsonb_typeof(p_content) <> 'array'
     or jsonb_array_length(p_content) > 5000
     or octet_length(p_content::text) > 2097152 then
    raise exception 'VALIDATION';
  end if;

  for item in select value from jsonb_array_elements(p_content)
  loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION';
    end if;

    item_kind := item ->> 'kind';
    if item_kind is null then
      if (item - array['id', 'mode', 'color', 'wNorm', 'points']) <> '{}'::jsonb
         or coalesce(item ->> 'mode', '') not in ('ink', 'erase')
         or coalesce(item ->> 'color', '') not in ('ink', 'rose', 'leaf', 'crater', 'cheek', 'moon')
         or coalesce(jsonb_typeof(item -> 'wNorm'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'points'), '') <> 'array'
         or jsonb_array_length(item -> 'points') > 10000 then
        raise exception 'VALIDATION';
      end if;
      numeric_value := (item ->> 'wNorm')::numeric;
      if numeric_value <= 0 or numeric_value > 0.1 then raise exception 'VALIDATION'; end if;
      for point in select value from jsonb_array_elements(item -> 'points')
      loop
        if coalesce(jsonb_typeof(point), '') <> 'array'
           or jsonb_array_length(point) <> 2
           or coalesce(jsonb_typeof(point -> 0), '') <> 'number'
           or coalesce(jsonb_typeof(point -> 1), '') <> 'number'
           or (point ->> 0)::numeric < 0 or (point ->> 0)::numeric > 1
           or (point ->> 1)::numeric < 0 or (point ->> 1)::numeric > 1 then
          raise exception 'VALIDATION';
        end if;
      end loop;
    elsif item_kind = 'shape' then
      if (item - array['id', 'kind', 'shape', 'color', 'fill', 'strokeWidthNorm', 'x', 'y', 'width', 'height', 'rotation', 'startAngle', 'sweepAngle']) <> '{}'::jsonb
         or coalesce(item ->> 'shape', '') not in ('line', 'arrow', 'rectangle', 'ellipse', 'triangle', 'rightTriangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arc')
         or coalesce(item ->> 'color', '') not in ('ink', 'rose', 'leaf', 'crater', 'cheek', 'moon')
         or not (item ? 'fill')
         or not (
           jsonb_typeof(item -> 'fill') = 'null'
           or (
             jsonb_typeof(item -> 'fill') = 'string'
             and item ->> 'fill' in ('ink', 'rose', 'leaf', 'crater', 'cheek', 'moon')
           )
         )
         or coalesce(jsonb_typeof(item -> 'strokeWidthNorm'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'x'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'y'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'width'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'height'), '') <> 'number'
         or coalesce(jsonb_typeof(item -> 'rotation'), '') <> 'number'
         or (item ? 'startAngle' and coalesce(jsonb_typeof(item -> 'startAngle'), '') <> 'number')
         or (item ? 'sweepAngle' and coalesce(jsonb_typeof(item -> 'sweepAngle'), '') <> 'number') then
        raise exception 'VALIDATION';
      end if;
      if (item ->> 'strokeWidthNorm')::numeric <= 0 or (item ->> 'strokeWidthNorm')::numeric > 0.1
         or (item ->> 'x')::numeric < 0 or (item ->> 'x')::numeric > 1
         or (item ->> 'y')::numeric < 0 or (item ->> 'y')::numeric > 1
         or (item ->> 'width')::numeric <= 0 or (item ->> 'width')::numeric > 1.5
         or (item ->> 'height')::numeric <= 0 or (item ->> 'height')::numeric > 1.5
         or abs((item ->> 'rotation')::numeric) > 100000
         or (item ? 'startAngle' and abs((item ->> 'startAngle')::numeric) > 100000)
         or (item ? 'sweepAngle' and abs((item ->> 'sweepAngle')::numeric) > 100000) then
        raise exception 'VALIDATION';
      end if;

    else
      raise exception 'VALIDATION';
    end if;
  end loop;
  return p_content;
end;
$$;

create or replace function public.generate_solution_record_from_board(
  p_session_id uuid,
  p_page_doc_id uuid
)
returns table(solution_record_id uuid, revision integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  annotation_row public.courseware_annotations%rowtype;
  review_revision integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null
         or (
           (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
           and not public.is_feature_enabled('teaching.preparation_archive_edit')
         ))
  ) then raise exception 'PREPARATION_LOCKED'; end if;

  select * into annotation_row
    from public.courseware_annotations annotation
   where annotation.session_id = p_session_id
     and annotation.page_doc_id = p_page_doc_id
     and annotation.user_id = uid
     and annotation.annotation_type = 'board'
   for update;
  if not found or jsonb_array_length(annotation_row.content) = 0 then
    raise exception 'ANNOTATION_REQUIRED';
  end if;

  insert into public.solution_records(
    session_id, solution_source, annotation_id, page_doc_id, content,
    created_by, updated_by
  ) values (
    p_session_id, 'board', annotation_row.id, p_page_doc_id,
    jsonb_build_object(
      'annotationVersion', annotation_row.version,
      'annotationUpdatedAt', annotation_row.updated_at,
      'items', annotation_row.content
    ), uid, uid
  )
  on conflict(annotation_id) where solution_source = 'board' do update set
    content = excluded.content,
    revision = public.solution_records.revision + 1,
    updated_by = uid,
    updated_at = now()
  returning id, public.solution_records.revision
    into solution_record_id, revision;

  insert into public.session_preparation_reviews(session_id, artifact_kind, submitted_by)
    values(p_session_id, 'solution', uid)
  on conflict(session_id, artifact_kind) do update set
    status = 'pending', revision = public.session_preparation_reviews.revision + 1,
    submitted_by = uid, submitted_at = now(), reviewed_by = null,
    reviewed_at = null, review_note = ''
  returning public.session_preparation_reviews.revision into review_revision;
  perform public.notify_session_preparation_reviewers(p_session_id, 'solution', review_revision, uid);
  return next;
end;
$$;

revoke all on function public.validate_courseware_annotation_content(jsonb) from public, anon, authenticated;
revoke all on function public.generate_solution_record_from_board(uuid, uuid) from public, anon, authenticated;
grant execute on function public.generate_solution_record_from_board(uuid, uuid) to authenticated;

commit;
