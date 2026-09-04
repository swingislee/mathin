-- DEV-SCHOOL-OPS-1 / public-class teaching preparation.
--
-- Public-class checkpoints belong to one event teaching block, not to the
-- reusable microcourse itself. Teachers can therefore mark the pages they
-- want to observe during this run without changing the shared courseware.

begin;

create table public.public_class_teaching_checkpoints (
  segment_id uuid not null
    references public.public_class_segments(id) on delete cascade,
  page_doc_id uuid not null
    references public.cw_page_docs(id) on delete restrict,
  position smallint not null check (position between 1 and 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (segment_id, page_doc_id),
  unique (segment_id, position)
);

alter table public.public_class_teaching_checkpoints enable row level security;

create policy public_class_teaching_checkpoints_staff_select
  on public.public_class_teaching_checkpoints for select to authenticated
  using (
    exists (
      select 1
      from public.public_class_segments segment
      where segment.id = public_class_teaching_checkpoints.segment_id
        and public.can_record_public_class(segment.activity_id, (select auth.uid()))
    )
  );

revoke all on public.public_class_teaching_checkpoints
  from public, anon, authenticated;
grant select on public.public_class_teaching_checkpoints to authenticated;

create or replace function public.replace_public_class_teaching_checkpoints(
  p_segment_id uuid,
  p_page_doc_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_segment public.public_class_segments%rowtype;
  v_page_ids uuid[] := coalesce(p_page_doc_ids, '{}'::uuid[]);
  v_bundle jsonb;
begin
  select * into v_segment
  from public.public_class_segments segment
  where segment.id = p_segment_id
  for update;

  if not found then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  if v_segment.kind <> 'trial_lesson' then
    raise exception 'INVALID_PUBLIC_CLASS_CHECKPOINT';
  end if;
  if not public.can_teach_public_class_segment(p_segment_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if v_segment.teaching_started_at is not null then
    raise exception 'PUBLIC_CLASS_TEACHING_STARTED';
  end if;
  if cardinality(v_page_ids) > 200
     or exists (select 1 from unnest(v_page_ids) requested(page_id) where requested.page_id is null)
     or (select count(*) from unnest(v_page_ids))
        <> (select count(distinct page_id) from unnest(v_page_ids) requested(page_id)) then
    raise exception 'INVALID_PUBLIC_CLASS_CHECKPOINT';
  end if;

  v_bundle := public.get_public_class_teaching_bundle(p_segment_id);
  if exists (
    select 1
    from unnest(v_page_ids) requested(page_id)
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(v_bundle -> 'pages', '[]'::jsonb)) page(value)
      where (page.value ->> 'pageDocId')::uuid = requested.page_id
    )
  ) then
    raise exception 'INVALID_PUBLIC_CLASS_CHECKPOINT';
  end if;

  delete from public.public_class_teaching_checkpoints checkpoint
  where checkpoint.segment_id = p_segment_id;

  insert into public.public_class_teaching_checkpoints(
    segment_id,
    page_doc_id,
    position,
    created_by
  )
  select p_segment_id, requested.page_id, requested.ordinality::smallint, v_uid
  from unnest(v_page_ids) with ordinality requested(page_id, ordinality);

  perform public.emit_domain_event(
    'public_class.teaching_checkpoints.replaced',
    'public_class_segment',
    p_segment_id,
    jsonb_build_object(
      'activityId', v_segment.activity_id,
      'checkpointCount', cardinality(v_page_ids)
    ),
    null,
    null
  );
end;
$$;

revoke all on function public.replace_public_class_teaching_checkpoints(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.replace_public_class_teaching_checkpoints(uuid, uuid[])
  to authenticated;

comment on table public.public_class_teaching_checkpoints is
  'Per-run teaching checkpoints selected while previewing public-class courseware.';
comment on function public.replace_public_class_teaching_checkpoints(uuid, uuid[]) is
  'Atomically replaces ordered pre-class checkpoints for one trial-lesson block.';

notify pgrst, 'reload schema';

commit;
