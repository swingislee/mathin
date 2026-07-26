-- P6：把 4:3 背景的人工退回落实为可修复、可复审且不可篡改的审计链。
-- 系统 CAS 修复留下的 21 条技术记录回填为 superseded；它们不进入返工队列。

alter table public.cw_adapt_backgrounds
  add column if not exists rejection_code text,
  add column if not exists supersedes_id uuid references public.cw_adapt_backgrounds(id) on delete restrict,
  add column if not exists superseded_by_id uuid references public.cw_adapt_backgrounds(id) on delete restrict,
  add column if not exists repair_kind text;

alter table public.cw_adapt_backgrounds
  drop constraint if exists cw_adapt_backgrounds_status_check;
alter table public.cw_adapt_backgrounds
  add constraint cw_adapt_backgrounds_status_check
  check (status in ('pending', 'approved', 'rejected', 'superseded')) not valid;

update public.cw_adapt_backgrounds
   set status = 'superseded'
 where status = 'rejected'
   and note = 'P6-6 superseded during deterministic CAS repair';

alter table public.cw_adapt_backgrounds
  validate constraint cw_adapt_backgrounds_status_check;
alter table public.cw_adapt_backgrounds
  add constraint cw_adapt_backgrounds_rejection_code_check
  check (rejection_code is null or rejection_code in (
    'crop_error', 'subject_missing', 'aspect_error', 'quality_issue', 'classification_error', 'other'
  ));
alter table public.cw_adapt_backgrounds
  add constraint cw_adapt_backgrounds_rejected_reason_check
  check ((status = 'rejected') = (rejection_code is not null));
alter table public.cw_adapt_backgrounds
  add constraint cw_adapt_backgrounds_repair_kind_check
  check (repair_kind is null or repair_kind in ('manual-crop', 'manual-upload'));
alter table public.cw_adapt_backgrounds
  add constraint cw_adapt_backgrounds_supersedes_self_check
  check (supersedes_id is null or supersedes_id <> id);
alter table public.cw_adapt_backgrounds
  add constraint cw_adapt_backgrounds_superseded_by_self_check
  check (superseded_by_id is null or superseded_by_id <> id);

create unique index if not exists cw_adapt_backgrounds_supersedes_unique
  on public.cw_adapt_backgrounds(supersedes_id) where supersedes_id is not null;
create index if not exists cw_adapt_backgrounds_rework_idx
  on public.cw_adapt_backgrounds(status, superseded_by_id, reviewed_at desc);

-- 已作出的审核决定不可回写。人工退回只允许在首次修复时补一次 successor 链接。
create or replace function public.guard_cw_adapt_background_audit()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status <> 'pending' then
    if old.status = 'rejected'
       and old.superseded_by_id is null
       and new.superseded_by_id is not null
       and (to_jsonb(new) - 'superseded_by_id') = (to_jsonb(old) - 'superseded_by_id') then
      return new;
    end if;
    raise exception 'ADAPT_BACKGROUND_DECISION_IMMUTABLE';
  end if;
  return new;
end;
$$;
drop trigger if exists cw_adapt_backgrounds_audit_guard on public.cw_adapt_backgrounds;
create trigger cw_adapt_backgrounds_audit_guard
  before update on public.cw_adapt_backgrounds
  for each row execute function public.guard_cw_adapt_background_audit();

drop function if exists public.review_cw_adapt_backgrounds(uuid[], boolean, text, text);
create function public.review_cw_adapt_backgrounds(
  p_adaptation_ids uuid[],
  p_approve boolean,
  p_rejection_code text,
  p_note text
)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  requested_count integer;
  reviewed_count integer;
  clean_note text := left(trim(coalesce(p_note, '')), 1000);
begin
  if uid is null or not public.has_perm(uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  requested_count := coalesce(cardinality(p_adaptation_ids), 0);
  if requested_count < 1 or requested_count > 100
     or (select count(distinct item) from unnest(p_adaptation_ids) item) <> requested_count then
    raise exception 'INVALID_ADAPT_BACKGROUND_SELECTION';
  end if;
  if p_approve and p_rejection_code is not null then raise exception 'INVALID_REJECTION_REASON'; end if;
  if not p_approve and p_rejection_code not in (
    'crop_error', 'subject_missing', 'aspect_error', 'quality_issue', 'classification_error', 'other'
  ) then raise exception 'REJECTION_REASON_REQUIRED'; end if;
  if not p_approve and p_rejection_code = 'other' and clean_note = '' then
    raise exception 'REJECTION_NOTE_REQUIRED';
  end if;

  update public.cw_adapt_backgrounds
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = uid,
         reviewed_at = now(),
         rejection_code = case when p_approve then null else p_rejection_code end,
         note = clean_note
   where id = any(p_adaptation_ids) and status = 'pending';
  get diagnostics reviewed_count = row_count;
  if reviewed_count <> requested_count then raise exception 'ADAPT_BACKGROUND_NOT_PENDING'; end if;
  return reviewed_count;
end;
$$;

-- 旧三参调用只继续兼容“通过”；退回必须走带结构化原因的新合同。
create or replace function public.review_cw_adapt_backgrounds(
  p_adaptation_ids uuid[], p_approve boolean, p_note text default ''
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not p_approve then raise exception 'REJECTION_REASON_REQUIRED'; end if;
  return public.review_cw_adapt_backgrounds(p_adaptation_ids, true, null, p_note);
end;
$$;

drop function if exists public.review_cw_adapt_background(uuid, boolean, text, text);
create function public.review_cw_adapt_background(
  p_adaptation_id uuid, p_approve boolean, p_rejection_code text, p_note text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.review_cw_adapt_backgrounds(array[p_adaptation_id], p_approve, p_rejection_code, p_note);
end;
$$;

create or replace function public.review_cw_adapt_background(
  p_adaptation_id uuid, p_approve boolean, p_note text default ''
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not p_approve then raise exception 'REJECTION_REASON_REQUIRED'; end if;
  perform public.review_cw_adapt_backgrounds(array[p_adaptation_id], true, null, p_note);
end;
$$;

-- 当前 binding 仍选中人工退回候选时，才产生“退回待修”工作项。
create or replace function public.list_cw_adapt_background_rework_queue(
  p_course_id uuid default null,
  p_lecture_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 24
)
returns table (
  id uuid,
  crop_x integer,
  crop_y integer,
  source_asset_revision_id uuid,
  derived_asset_revision_id uuid,
  rejection_code text,
  note text,
  reviewed_at timestamptz,
  page_count integer,
  course_count integer,
  lecture_count integer,
  page_doc_id uuid,
  course_id uuid,
  course_title text,
  lecture_id uuid,
  lecture_no smallint,
  lecture_name text,
  page_no integer,
  total_count bigint
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  bounded_offset integer := greatest(coalesce(p_offset, 0), 0);
  bounded_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
begin
  if uid is null or not (
    public.has_perm(uid, 'courseware.asset.manage')
    or public.has_perm(uid, 'courseware.page.edit')
    or public.has_perm(uid, 'courseware.review')
    or public.has_perm(uid, 'courseware.release.publish')
  ) then raise exception 'FORBIDDEN'; end if;
  if p_lecture_id is not null and p_course_id is not null and not exists (
    select 1 from public.course_lectures lecture
     where lecture.id = p_lecture_id and lecture.course_id = p_course_id
  ) then raise exception 'FILTER_MISMATCH'; end if;

  return query
  with selected as (
    select adaptation.id, adaptation.crop_x, adaptation.crop_y,
      adaptation.source_asset_revision_id, adaptation.derived_asset_revision_id,
      adaptation.rejection_code, adaptation.note, adaptation.reviewed_at,
      page.id as page_doc_id, course.id as course_id, course.title as course_title,
      lecture.id as lecture_id, lecture.no as lecture_no, lecture.name as lecture_name,
      page.page_no
    from public.cw_adapt_backgrounds adaptation
    join public.cw_asset_revisions derived on derived.id = adaptation.derived_asset_revision_id
    join public.cw_page_asset_bindings binding
      on binding.shared_asset_id = derived.shared_asset_id and binding.track = 'adapted-4x3'
    join public.cw_page_docs page on page.id = binding.page_doc_id and page.deleted_at is null
    join public.course_lectures lecture on lecture.id = page.lecture_id
    join public.courses course on course.id = lecture.course_id
    join public.cw_shared_assets asset on asset.id = binding.shared_asset_id
    left join public.cw_asset_variant_heads variant
      on variant.shared_asset_id = asset.id and variant.track = 'adapted-4x3'
    where adaptation.status = 'rejected'
      and adaptation.superseded_by_id is null
      and coalesce(binding.pinned_revision_id, variant.draft_revision_id,
        variant.published_revision_id, asset.published_revision_id) = adaptation.derived_asset_revision_id
      and (p_course_id is null or course.id = p_course_id)
      and (p_lecture_id is null or lecture.id = p_lecture_id)
  ), grouped as (
    select selected.id, selected.crop_x, selected.crop_y,
      selected.source_asset_revision_id, selected.derived_asset_revision_id,
      selected.rejection_code, selected.note, selected.reviewed_at,
      count(distinct selected.page_doc_id)::integer as page_count,
      count(distinct selected.course_id)::integer as course_count,
      count(distinct selected.lecture_id)::integer as lecture_count,
      (array_agg(selected.page_doc_id order by selected.course_title, selected.lecture_no, selected.page_no))[1] as page_doc_id,
      (array_agg(selected.course_id order by selected.course_title, selected.lecture_no, selected.page_no))[1] as course_id,
      (array_agg(selected.course_title order by selected.course_title, selected.lecture_no, selected.page_no))[1] as course_title,
      (array_agg(selected.lecture_id order by selected.course_title, selected.lecture_no, selected.page_no))[1] as lecture_id,
      (array_agg(selected.lecture_no order by selected.course_title, selected.lecture_no, selected.page_no))[1] as lecture_no,
      (array_agg(selected.lecture_name order by selected.course_title, selected.lecture_no, selected.page_no))[1] as lecture_name,
      (array_agg(selected.page_no order by selected.course_title, selected.lecture_no, selected.page_no))[1] as page_no
    from selected group by selected.id, selected.crop_x, selected.crop_y,
      selected.source_asset_revision_id, selected.derived_asset_revision_id,
      selected.rejection_code, selected.note, selected.reviewed_at
  )
  select grouped.*, count(*) over() as total_count
  from grouped order by grouped.reviewed_at, grouped.id
  offset bounded_offset limit bounded_limit;
end;
$$;

-- 系统已替代与已生成 successor 的人工退回只进入只读历史。
create or replace function public.list_cw_adapt_background_history(
  p_course_id uuid default null,
  p_lecture_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 24
)
returns table (
  id uuid,
  status text,
  rejection_code text,
  note text,
  crop_x integer,
  crop_y integer,
  source_asset_revision_id uuid,
  derived_asset_revision_id uuid,
  supersedes_id uuid,
  superseded_by_id uuid,
  successor_status text,
  reviewed_at timestamptz,
  page_count integer,
  course_id uuid,
  course_title text,
  lecture_id uuid,
  lecture_no smallint,
  lecture_name text,
  page_no integer,
  total_count bigint
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  bounded_offset integer := greatest(coalesce(p_offset, 0), 0);
  bounded_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
begin
  if uid is null or not (
    public.has_perm(uid, 'courseware.asset.manage')
    or public.has_perm(uid, 'courseware.page.edit')
    or public.has_perm(uid, 'courseware.review')
    or public.has_perm(uid, 'courseware.release.publish')
  ) then raise exception 'FORBIDDEN'; end if;
  if p_lecture_id is not null and p_course_id is not null and not exists (
    select 1 from public.course_lectures lecture
     where lecture.id = p_lecture_id and lecture.course_id = p_course_id
  ) then raise exception 'FILTER_MISMATCH'; end if;

  return query
  with history as (
    select adaptation.id, adaptation.status, adaptation.rejection_code, adaptation.note,
      adaptation.crop_x, adaptation.crop_y, adaptation.source_asset_revision_id,
      adaptation.derived_asset_revision_id, adaptation.supersedes_id,
      adaptation.superseded_by_id, successor.status as successor_status,
      adaptation.reviewed_at, usage.page_count, usage.course_id, usage.course_title,
      usage.lecture_id, usage.lecture_no, usage.lecture_name, usage.page_no
    from public.cw_adapt_backgrounds adaptation
    join public.cw_asset_revisions derived on derived.id = adaptation.derived_asset_revision_id
    left join public.cw_adapt_backgrounds successor on successor.id = adaptation.superseded_by_id
    left join lateral (
      select count(distinct page.id)::integer as page_count,
        (array_agg(course.id order by course.title, lecture.no, page.page_no))[1] as course_id,
        (array_agg(course.title order by course.title, lecture.no, page.page_no))[1] as course_title,
        (array_agg(lecture.id order by course.title, lecture.no, page.page_no))[1] as lecture_id,
        (array_agg(lecture.no order by course.title, lecture.no, page.page_no))[1] as lecture_no,
        (array_agg(lecture.name order by course.title, lecture.no, page.page_no))[1] as lecture_name,
        (array_agg(page.page_no order by course.title, lecture.no, page.page_no))[1] as page_no
      from public.cw_page_asset_bindings binding
      join public.cw_page_docs page on page.id = binding.page_doc_id and page.deleted_at is null
      join public.course_lectures lecture on lecture.id = page.lecture_id
      join public.courses course on course.id = lecture.course_id
      where binding.shared_asset_id = derived.shared_asset_id and binding.track = 'adapted-4x3'
        and (p_course_id is null or course.id = p_course_id)
        and (p_lecture_id is null or lecture.id = p_lecture_id)
    ) usage on true
    where (adaptation.status = 'superseded' or adaptation.superseded_by_id is not null)
      and ((p_course_id is null and p_lecture_id is null) or usage.page_count > 0)
  )
  select history.*, count(*) over() as total_count
  from history order by history.reviewed_at desc nulls last, history.id
  offset bounded_offset limit bounded_limit;
end;
$$;

-- 裁切修复必须创建新 CAS revision + pending 候选；原退回记录只补 successor 链接。
create or replace function public.repair_cw_adapt_background(
  p_adaptation_id uuid,
  p_upload_id uuid,
  p_crop_x integer,
  p_crop_y integer,
  p_note text default ''
)
returns table(adaptation_id uuid, revision_id uuid, affected_count integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  old_adaptation public.cw_adapt_backgrounds%rowtype;
  upload public.cw_replacement_uploads%rowtype;
  derived_revision public.cw_asset_revisions%rowtype;
  source_object public.cw_asset_objects%rowtype;
  object_id uuid;
  next_revision_no integer;
  new_revision_id uuid;
  new_adaptation_id uuid;
  selected_count integer;
begin
  if uid is null or not public.has_perm(uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  if p_crop_x < 0 or p_crop_y < 0 or length(coalesce(p_note, '')) > 1000 then
    raise exception 'INVALID_ADAPT_REPAIR';
  end if;

  select * into old_adaptation from public.cw_adapt_backgrounds adaptation
   where adaptation.id = p_adaptation_id for update;
  if not found then raise exception 'ADAPT_BACKGROUND_NOT_FOUND'; end if;
  if old_adaptation.status <> 'rejected' or old_adaptation.superseded_by_id is not null then
    raise exception 'ADAPT_BACKGROUND_NOT_REPAIRABLE';
  end if;
  select * into upload from public.cw_replacement_uploads staged
   where staged.id = p_upload_id and staged.created_by = uid for update;
  if not found then raise exception 'UPLOAD_NOT_FOUND'; end if;
  if upload.expires_at <= now() then raise exception 'UPLOAD_EXPIRED'; end if;
  if upload.width * 3 <> upload.height * 4 then raise exception 'ADAPT_REPAIR_MUST_BE_4X3'; end if;

  select * into derived_revision from public.cw_asset_revisions revision
   where revision.id = old_adaptation.derived_asset_revision_id;
  select object.* into source_object
    from public.cw_asset_revisions revision
    join public.cw_asset_objects object on object.id = revision.object_id
   where revision.id = old_adaptation.source_asset_revision_id;
  if source_object.id is null then raise exception 'ADAPT_SOURCE_MISSING'; end if;
  if p_crop_x + upload.width > coalesce(source_object.width, 0)
     or p_crop_y + upload.height > coalesce(source_object.height, 0) then
    raise exception 'INVALID_ADAPT_REPAIR_CROP';
  end if;

  perform asset.id from public.cw_shared_assets asset
   where asset.id = derived_revision.shared_asset_id for update;
  perform binding.id from public.cw_page_asset_bindings binding
   where binding.shared_asset_id = derived_revision.shared_asset_id and binding.track = 'adapted-4x3' for update;
  perform variant.shared_asset_id from public.cw_asset_variant_heads variant
   where variant.shared_asset_id = derived_revision.shared_asset_id and variant.track = 'adapted-4x3' for update;

  select count(*)::integer into selected_count
    from public.cw_page_asset_bindings binding
    join public.cw_shared_assets asset on asset.id = binding.shared_asset_id
    left join public.cw_asset_variant_heads variant
      on variant.shared_asset_id = asset.id and variant.track = 'adapted-4x3'
   where binding.shared_asset_id = derived_revision.shared_asset_id
     and binding.track = 'adapted-4x3'
     and coalesce(binding.pinned_revision_id, variant.draft_revision_id,
       variant.published_revision_id, asset.published_revision_id) = old_adaptation.derived_asset_revision_id;
  if selected_count < 1 then raise exception 'ADAPT_BACKGROUND_NOT_SELECTED'; end if;

  select object.id into object_id from public.cw_asset_objects object where object.sha256 = upload.sha256 for update;
  if found then
    if not exists (
      select 1 from public.cw_asset_objects object where object.id = object_id
       and object.kind = 'image' and object.mime = upload.mime and object.byte_count = upload.byte_count
       and object.width = upload.width and object.height = upload.height and object.storage_path = upload.storage_path
    ) then raise exception 'OBJECT_METADATA_CONFLICT'; end if;
  else
    insert into public.cw_asset_objects(sha256, mime, byte_count, width, height, kind, storage_path)
    values(upload.sha256, upload.mime, upload.byte_count, upload.width, upload.height, 'image', upload.storage_path)
    returning id into object_id;
  end if;

  select coalesce(max(revision.revision_no), 0) + 1 into next_revision_no
    from public.cw_asset_revisions revision where revision.shared_asset_id = derived_revision.shared_asset_id;
  insert into public.cw_asset_revisions(
    shared_asset_id, revision_no, object_id, derived_from_revision_id, variant, note, created_by
  ) values (
    derived_revision.shared_asset_id, next_revision_no, object_id,
    old_adaptation.source_asset_revision_id, 'mathin-4x3',
    left(trim(coalesce(p_note, '')), 1000), uid
  ) returning id into new_revision_id;

  insert into public.cw_adapt_backgrounds(
    source_asset_revision_id, derived_asset_revision_id, crop_x, crop_y,
    status, supersedes_id, repair_kind, note
  ) values (
    old_adaptation.source_asset_revision_id, new_revision_id, p_crop_x, p_crop_y,
    'pending', old_adaptation.id, 'manual-crop', left(trim(coalesce(p_note, '')), 1000)
  ) returning id into new_adaptation_id;

  update public.cw_page_asset_bindings binding
     set pinned_revision_id = new_revision_id
   where binding.shared_asset_id = derived_revision.shared_asset_id
     and binding.track = 'adapted-4x3'
     and binding.pinned_revision_id = old_adaptation.derived_asset_revision_id;
  insert into public.cw_asset_variant_heads(shared_asset_id, track, draft_revision_id, published_revision_id)
  values(derived_revision.shared_asset_id, 'adapted-4x3', new_revision_id, null)
  on conflict(shared_asset_id, track) do update set
    draft_revision_id = excluded.draft_revision_id, updated_at = now();
  update public.cw_adapt_backgrounds
     set superseded_by_id = new_adaptation_id
   where id = old_adaptation.id;
  delete from public.cw_replacement_uploads where id = upload.id;

  return query select new_adaptation_id, new_revision_id, selected_count;
end;
$$;

revoke all on function public.review_cw_adapt_backgrounds(uuid[], boolean, text, text),
  public.review_cw_adapt_backgrounds(uuid[], boolean, text),
  public.review_cw_adapt_background(uuid, boolean, text, text),
  public.review_cw_adapt_background(uuid, boolean, text),
  public.list_cw_adapt_background_rework_queue(uuid, uuid, integer, integer),
  public.list_cw_adapt_background_history(uuid, uuid, integer, integer),
  public.repair_cw_adapt_background(uuid, uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.review_cw_adapt_backgrounds(uuid[], boolean, text, text),
  public.review_cw_adapt_backgrounds(uuid[], boolean, text),
  public.review_cw_adapt_background(uuid, boolean, text, text),
  public.review_cw_adapt_background(uuid, boolean, text),
  public.list_cw_adapt_background_rework_queue(uuid, uuid, integer, integer),
  public.list_cw_adapt_background_history(uuid, uuid, integer, integer),
  public.repair_cw_adapt_background(uuid, uuid, integer, integer, text)
  to authenticated;
