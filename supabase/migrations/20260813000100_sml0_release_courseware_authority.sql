-- SML-0：课堂页序列以所选 immutable release 为唯一权威。
--
-- 每条 release 在插入时物化自包含的 CoursewarePage 投影；legacy
-- course_lectures.courseware_template 只保留为无 release 讲次的兼容输入，以及当前
-- native release 的只读投影。备课、试讲、freeze 与课堂文档预载统一解析 session
-- 实际选择的 track/release，不能再从可漂移的 legacy template 拼出另一套页面序列。

begin;

alter table public.cw_lecture_releases
  add column courseware_pages jsonb;

create function public.cw_courseware_page_is_valid(p_page jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_typeof(p_page) = 'object'
    and coalesce(p_page ->> 'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and jsonb_typeof(p_page -> 'title') = 'string'
    and length(trim(p_page ->> 'title')) between 1 and 100
    and case p_page ->> 'type'
      when 'image' then jsonb_typeof(p_page -> 'path') = 'string'
        and length(p_page ->> 'path') between 1 and 500
      when 'video' then jsonb_typeof(p_page -> 'path') = 'string'
        and length(p_page ->> 'path') between 1 and 500
      when 'game' then jsonb_typeof(p_page -> 'gameId') = 'string'
        and length(p_page ->> 'gameId') between 1 and 50
        and p_page ->> 'difficulty' in ('easy', 'medium', 'hard')
        and jsonb_typeof(p_page -> 'seed') = 'string'
        and length(p_page ->> 'seed') between 1 and 100
      when 'board' then true
      when 'doc' then coalesce(p_page ->> 'docId', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      else false
    end, false);
$$;

create function public.build_cw_release_courseware_pages(
  p_lecture_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  snapshot_count integer;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'array' then
    raise exception 'INVALID_RELEASE_SNAPSHOT';
  end if;
  snapshot_count := jsonb_array_length(p_snapshot);
  if snapshot_count < 1 or snapshot_count > 200 then
    raise exception 'INVALID_RELEASE_SNAPSHOT';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_snapshot) with ordinality entry(value, ordinal)
    where jsonb_typeof(entry.value) is distinct from 'object'
       or coalesce(entry.value ->> 'pageDocId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(entry.value ->> 'revisionId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) or (
    select count(distinct entry.value ->> 'pageDocId')
    from jsonb_array_elements(p_snapshot) entry(value)
  ) <> snapshot_count then
    raise exception 'INVALID_RELEASE_SNAPSHOT';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', page.id,
      'type', 'doc',
      'docId', page.id,
      'title', left(coalesce(nullif(trim(page.title), ''), format('P%s', entry.ordinal)), 100)
    )
    order by entry.ordinal
  )
  into result
  from jsonb_array_elements(p_snapshot) with ordinality entry(value, ordinal)
  join public.cw_page_docs page
    on page.id = (entry.value ->> 'pageDocId')::uuid
   and page.lecture_id = p_lecture_id
  join public.cw_page_revisions revision
    on revision.id = (entry.value ->> 'revisionId')::uuid
   and revision.page_doc_id = page.id;

  if result is null
     or jsonb_array_length(result) <> snapshot_count
     or octet_length(result::text) > 1048576
     or exists (
       select 1 from jsonb_array_elements(result) page(value)
       where not public.cw_courseware_page_is_valid(page.value)
     ) then
    raise exception 'RELEASE_SNAPSHOT_INCOMPLETE';
  end if;
  return result;
end;
$$;

update public.cw_lecture_releases release
set courseware_pages = public.build_cw_release_courseware_pages(
  release.lecture_id,
  release.snapshot
);

alter table public.cw_lecture_releases
  alter column courseware_pages set not null,
  add constraint cw_lecture_releases_courseware_pages_check check (
    jsonb_typeof(courseware_pages) = 'array'
    and jsonb_array_length(courseware_pages) between 1 and 200
    and octet_length(courseware_pages::text) <= 1048576
  );

create function public.fill_cw_release_courseware_pages()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  new.courseware_pages := public.build_cw_release_courseware_pages(
    new.lecture_id,
    new.snapshot
  );
  return new;
end;
$$;

create trigger cw_lecture_releases_fill_courseware_pages
  before insert on public.cw_lecture_releases
  for each row execute function public.fill_cw_release_courseware_pages();

create function public.sync_lecture_legacy_courseware_projection()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  projection jsonb;
begin
  if new.current_release_id is null then return new; end if;
  select release.courseware_pages into projection
  from public.cw_lecture_releases release
  where release.id = new.current_release_id
    and release.lecture_id = new.id
    and release.track = 'native-16x9';
  if projection is null then raise exception 'INVALID_LEGACY_RELEASE_PROJECTION'; end if;
  new.courseware_template := projection;
  return new;
end;
$$;

create trigger course_lectures_sync_release_projection
  before insert or update of current_release_id on public.course_lectures
  for each row execute function public.sync_lecture_legacy_courseware_projection();

-- 先把现有 legacy current release 投影校正；后续 native publish/rollback 由上面的
-- BEFORE trigger 在同一事务完成。没有 native current release 的讲次仍保留旧导入模板。
update public.course_lectures lecture
set courseware_template = release.courseware_pages
from public.cw_lecture_releases release
where release.id = lecture.current_release_id
  and release.lecture_id = lecture.id
  and release.track = 'native-16x9';

create function public.protect_release_backed_courseware_template()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.courseware_template is distinct from old.courseware_template
     and current_user in ('authenticated', 'anon')
     and exists (
       select 1 from public.cw_lecture_releases release
       where release.lecture_id = old.id
     ) then
    raise exception 'RELEASE_TEMPLATE_PROJECTION_READ_ONLY';
  end if;
  return new;
end;
$$;

create trigger course_lectures_protect_release_projection
  before update of courseware_template on public.course_lectures
  for each row execute function public.protect_release_backed_courseware_template();

-- rollback 的 source snapshot 与 source CoursewarePage 投影必须一起复制。旧实现只复制
-- snapshot；若 page title 在两个 release 之间改变，通用 INSERT trigger 会按当前 title
-- 重建，造成“回退内容正确但课堂页标题不属于历史 release”。
create or replace function public.rollback_cw_track_release(
  p_lecture_id uuid,
  p_track text,
  p_release_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  source_courseware jsonb;
  rollback_release_id uuid;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.rollback');
  select release.courseware_pages into source_courseware
  from public.cw_lecture_releases release
  where release.id = p_release_id
    and release.lecture_id = p_lecture_id
    and release.track = p_track;
  if source_courseware is null then raise exception 'RELEASE_NOT_FOUND'; end if;

  rollback_release_id := public.rollback_cw_track_release_pre_sml0_impl(
    p_lecture_id,
    p_track,
    p_release_id,
    p_note
  );
  update public.cw_lecture_releases
  set courseware_pages = source_courseware
  where id = rollback_release_id;
  if p_track = 'native-16x9' then
    update public.course_lectures
    set courseware_template = source_courseware
    where id = p_lecture_id and current_release_id = rollback_release_id;
  end if;
  return rollback_release_id;
end;
$$;

create or replace function public.rollback_cw_lecture_release(
  p_lecture_id uuid,
  p_release_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare release_track text;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.rollback');
  select release.track into release_track
  from public.cw_lecture_releases release
  where release.id = p_release_id and release.lecture_id = p_lecture_id;
  if not found then raise exception 'RELEASE_NOT_FOUND'; end if;
  return public.rollback_cw_track_release(
    p_lecture_id,
    release_track,
    p_release_id,
    p_note
  );
end;
$$;

-- 内部 session release 解析。已有 frozen/prepared pin 时永远读 pin；否则按
-- session override > classroom default 读取对应 track head。
create function public.resolve_cw_session_release_context(p_session_id uuid)
returns table(lecture_id uuid, track text, release_id uuid, is_frozen boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  session_row record;
  resolved_track text;
  resolved_release uuid;
begin
  select session.lecture_id,
         session.courseware_resolved,
         session.courseware_frozen_at,
         coalesce(session.courseware_track_override, classroom.courseware_track) selected_track
  into session_row
  from public.class_sessions session
  join public.classrooms classroom on classroom.id = session.classroom_id
  where session.id = p_session_id and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if jsonb_typeof(session_row.courseware_resolved) = 'object'
     and session_row.courseware_resolved ->> 'version' = 'cw-session-resolved-v1' then
    resolved_track := session_row.courseware_resolved ->> 'track';
    if resolved_track not in ('native-16x9', 'adapted-4x3') then
      raise exception 'INVALID_FROZEN_RELEASE_CONTEXT';
    end if;
    if nullif(session_row.courseware_resolved ->> 'releaseId', '') is not null then
      if session_row.courseware_resolved ->> 'releaseId'
         !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'INVALID_FROZEN_RELEASE_CONTEXT';
      end if;
      resolved_release := (session_row.courseware_resolved ->> 'releaseId')::uuid;
    end if;
  else
    resolved_track := session_row.selected_track;
    if session_row.lecture_id is not null then
      select head.current_release_id into resolved_release
      from public.cw_lecture_track_heads head
      where head.lecture_id = session_row.lecture_id
        and head.track = resolved_track;
    end if;
  end if;

  if resolved_release is not null and not exists (
    select 1 from public.cw_lecture_releases release
    where release.id = resolved_release
      and release.lecture_id = session_row.lecture_id
      and release.track = resolved_track
  ) then
    raise exception 'INVALID_FROZEN_RELEASE_CONTEXT';
  end if;

  return query select session_row.lecture_id, resolved_track, resolved_release,
    session_row.courseware_frozen_at is not null;
end;
$$;

create function public.cw_session_courseware_template(p_session_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  context record;
  result jsonb;
begin
  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.lecture_id is null then return '[]'::jsonb; end if;
  if context.release_id is not null then
    select release.courseware_pages into result
    from public.cw_lecture_releases release
    where release.id = context.release_id
      and release.lecture_id = context.lecture_id
      and release.track = context.track;
  else
    select lecture.courseware_template into result
    from public.course_lectures lecture where lecture.id = context.lecture_id;
  end if;
  if jsonb_typeof(result) is distinct from 'array' then
    raise exception 'INVALID_COURSEWARE_TEMPLATE';
  end if;
  return result;
end;
$$;

-- 备课“采纳最新 release”和开课时使用当前选择的 head；它与上面的 frozen/pinned
-- resolver 分开，避免已完成备课但尚未开课的 session 永远无法更新到新 release。
create function public.cw_session_selected_courseware_template(p_session_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  session_lecture uuid;
  selected_track text;
  selected_release uuid;
  result jsonb;
begin
  select session.lecture_id,
         coalesce(session.courseware_track_override, classroom.courseware_track)
  into session_lecture, selected_track
  from public.class_sessions session
  join public.classrooms classroom on classroom.id = session.classroom_id
  where session.id = p_session_id and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if session_lecture is null then return '[]'::jsonb; end if;

  select head.current_release_id into selected_release
  from public.cw_lecture_track_heads head
  where head.lecture_id = session_lecture and head.track = selected_track;
  if selected_release is not null then
    select release.courseware_pages into result
    from public.cw_lecture_releases release
    where release.id = selected_release
      and release.lecture_id = session_lecture
      and release.track = selected_track;
  else
    select lecture.courseware_template into result
    from public.course_lectures lecture where lecture.id = session_lecture;
  end if;
  if jsonb_typeof(result) is distinct from 'array' then
    raise exception 'INVALID_COURSEWARE_TEMPLATE';
  end if;
  return result;
end;
$$;

create function public.get_session_courseware_template(p_session_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  return public.cw_session_selected_courseware_template(p_session_id);
end;
$$;

-- 与 TypeScript healOverlay/resolveCourseware 同构：release 页保持稳定身份和不可变内容，
-- session overlay 只能排序 ref 或插入独立页面；失效/重复 ref 自愈，新增 release 页补回。
create function public.resolve_cw_courseware_overlay(p_template jsonb, p_overlay jsonb)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  template_page jsonb;
  slot jsonb;
  page_value jsonb;
  template_ids text[] := '{}';
  seen_ids text[] := '{}';
  working jsonb := '[]'::jsonb;
  result jsonb := '[]'::jsonb;
  item_id text;
  found_index integer;
  last_position integer := -1;
  insert_at integer;
begin
  if jsonb_typeof(p_template) is distinct from 'array'
     or jsonb_array_length(p_template) > 200
     or jsonb_typeof(p_overlay) is distinct from 'array'
     or jsonb_array_length(p_overlay) > 400 then
    raise exception 'INVALID_COURSEWARE_OVERLAY';
  end if;

  for template_page in select value from jsonb_array_elements(p_template) loop
    if not public.cw_courseware_page_is_valid(template_page) then
      raise exception 'INVALID_COURSEWARE_TEMPLATE';
    end if;
    item_id := template_page ->> 'id';
    if item_id = any(template_ids) then raise exception 'INVALID_COURSEWARE_TEMPLATE'; end if;
    template_ids := array_append(template_ids, item_id);
  end loop;

  for slot in select value from jsonb_array_elements(p_overlay) loop
    if jsonb_typeof(slot) is distinct from 'object' then
      raise exception 'INVALID_COURSEWARE_OVERLAY';
    elsif slot ? 'ref' then
      item_id := slot ->> 'ref';
      if item_id = any(template_ids) and not item_id = any(seen_ids) then
        seen_ids := array_append(seen_ids, item_id);
        working := working || jsonb_build_array(jsonb_build_object('ref', item_id));
      end if;
    elsif slot ? 'page' and public.cw_courseware_page_is_valid(slot -> 'page') then
      item_id := slot -> 'page' ->> 'id';
      if item_id = any(template_ids) then
        if not item_id = any(seen_ids) then
          seen_ids := array_append(seen_ids, item_id);
          working := working || jsonb_build_array(jsonb_build_object('ref', item_id));
        end if;
      else
        working := working || jsonb_build_array(jsonb_build_object('page', slot -> 'page'));
      end if;
    else
      raise exception 'INVALID_COURSEWARE_OVERLAY';
    end if;
  end loop;

  foreach item_id in array template_ids loop
    select entry.ordinal::integer - 1 into found_index
    from jsonb_array_elements(working) with ordinality entry(value, ordinal)
    where entry.value ->> 'ref' = item_id
    limit 1;
    if found_index is not null then
      last_position := found_index;
    else
      insert_at := last_position + 1;
      if insert_at >= jsonb_array_length(working) then
        working := working || jsonb_build_array(jsonb_build_object('ref', item_id));
      else
        working := jsonb_insert(
          working,
          array[insert_at::text],
          jsonb_build_object('ref', item_id),
          false
        );
      end if;
      last_position := insert_at;
    end if;
    found_index := null;
  end loop;

  for slot in select value from jsonb_array_elements(working) loop
    if slot ? 'ref' then
      select value into page_value
      from jsonb_array_elements(p_template) page(value)
      where page.value ->> 'id' = slot ->> 'ref';
      if page_value is null then raise exception 'INVALID_COURSEWARE_OVERLAY'; end if;
      result := result || jsonb_build_array(page_value);
    else
      result := result || jsonb_build_array(slot -> 'page');
    end if;
    page_value := null;
  end loop;

  if jsonb_array_length(result) > 400 or octet_length(result::text) > 1048576 then
    raise exception 'INVALID_COURSEWARE_OVERLAY';
  end if;
  return result;
end;
$$;

create or replace function public.freeze_session_courseware(
  p_session_id uuid,
  p_courseware jsonb,
  p_courseware_resolved jsonb
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  expected_release uuid;
  expected_track text;
  session_lecture uuid;
  session_overlay jsonb;
  expected_courseware jsonb;
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_courseware) is distinct from 'array' or octet_length(p_courseware::text) > 1048576
     or jsonb_typeof(p_courseware_resolved) is distinct from 'object'
     or p_courseware_resolved ->> 'version' is distinct from 'cw-session-resolved-v1'
     or jsonb_typeof(p_courseware_resolved -> 'bindings') is distinct from 'array'
     or octet_length(p_courseware_resolved::text) > 1048576 then
    raise exception 'INVALID_COURSEWARE_FREEZE';
  end if;

  select session.lecture_id,
         session.courseware_overlay,
         coalesce(session.courseware_track_override, classroom.courseware_track)
  into session_lecture, session_overlay, expected_track
  from public.class_sessions session
  join public.classrooms classroom on classroom.id = session.classroom_id
  where session.id = p_session_id and session.deleted_at is null
  for update of session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if session_lecture is not null then
    select head.current_release_id into expected_release
    from public.cw_lecture_track_heads head
    where head.lecture_id = session_lecture and head.track = expected_track;
  end if;
  if p_courseware_resolved ->> 'track' is distinct from expected_track then raise exception 'TRACK_MISMATCH'; end if;
  if (p_courseware_resolved ->> 'releaseId') is distinct from expected_release::text then raise exception 'RELEASE_MISMATCH'; end if;

  if session_lecture is not null then
    expected_courseware := public.resolve_cw_courseware_overlay(
      public.cw_session_selected_courseware_template(p_session_id),
      coalesce(session_overlay, '[]'::jsonb)
    );
    if p_courseware is distinct from expected_courseware then
      raise exception 'COURSEWARE_RELEASE_PROJECTION_MISMATCH';
    end if;
  end if;

  update public.class_sessions
  set courseware = p_courseware,
      courseware_resolved = p_courseware_resolved,
      courseware_frozen_at = now(),
      started_at = now()
  where id = p_session_id and started_at is null and courseware_frozen_at is null;
  if not found then raise exception 'ALREADY_STARTED_OR_FROZEN'; end if;
end;
$$;

create or replace function public.save_session_prepared_courseware(
  p_session_id uuid,
  p_courseware jsonb,
  p_courseware_resolved jsonb
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  started timestamptz;
  expected_release uuid;
  expected_track text;
  session_lecture uuid;
  session_overlay jsonb;
  expected_courseware jsonb;
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_courseware) is distinct from 'array' or octet_length(p_courseware::text) > 1048576
     or jsonb_typeof(p_courseware_resolved) is distinct from 'object'
     or p_courseware_resolved ->> 'version' is distinct from 'cw-session-resolved-v1'
     or jsonb_typeof(p_courseware_resolved -> 'bindings') is distinct from 'array'
     or octet_length(p_courseware_resolved::text) > 1048576 then
    raise exception 'INVALID_COURSEWARE_FREEZE';
  end if;

  select session.started_at,
         session.lecture_id,
         session.courseware_overlay,
         coalesce(session.courseware_track_override, classroom.courseware_track)
  into started, session_lecture, session_overlay, expected_track
  from public.class_sessions session
  join public.classrooms classroom on classroom.id = session.classroom_id
  where session.id = p_session_id and session.deleted_at is null
  for update of session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if started is not null then raise exception 'ALREADY_STARTED'; end if;

  if session_lecture is not null then
    select head.current_release_id into expected_release
    from public.cw_lecture_track_heads head
    where head.lecture_id = session_lecture and head.track = expected_track;
  end if;
  if p_courseware_resolved ->> 'track' is distinct from expected_track then raise exception 'TRACK_MISMATCH'; end if;
  if (p_courseware_resolved ->> 'releaseId') is distinct from expected_release::text then raise exception 'RELEASE_MISMATCH'; end if;

  expected_courseware := public.resolve_cw_courseware_overlay(
    public.cw_session_selected_courseware_template(p_session_id),
    coalesce(session_overlay, '[]'::jsonb)
  );
  if p_courseware is distinct from expected_courseware then
    raise exception 'COURSEWARE_RELEASE_PROJECTION_MISMATCH';
  end if;

  update public.class_sessions
  set courseware = p_courseware,
      courseware_resolved = p_courseware_resolved,
      courseware_frozen_at = now()
  where id = p_session_id;

  insert into public.session_preparations(
    session_id, status, source_release_id, track, prepared_by, prepared_at, auto_frozen, last_contributor_id
  ) values (
    p_session_id, 'ready', expected_release, expected_track, uid, now(), false, uid
  )
  on conflict(session_id) do update
  set status = 'ready',
      source_release_id = excluded.source_release_id,
      track = excluded.track,
      prepared_by = uid,
      prepared_at = now(),
      auto_frozen = false,
      last_contributor_id = uid,
      updated_at = now();
end;
$$;

create or replace function public.get_session_page_docs(p_session_id uuid)
returns table(page_doc_id uuid, page_no int, doc jsonb, bindings jsonb)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  context record;
  release_snapshot jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return; end if;
  select release.snapshot into release_snapshot
  from public.cw_lecture_releases release
  where release.id = context.release_id
    and release.lecture_id = context.lecture_id
    and release.track = context.track;
  if release_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;

  return query
  select page.id,
         entry.ordinal::int,
         revision.doc,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'bindingKey', binding ->> 'bindingKey',
             'objectHash', object.sha256,
             'kind', object.kind,
             'launchQuery', page_binding.launch_query
           ) order by binding ->> 'bindingKey')
           from jsonb_array_elements(entry.value -> 'bindings') binding
           join public.cw_asset_revisions asset_revision
             on asset_revision.id = (binding ->> 'assetRevisionId')::uuid
           join public.cw_asset_objects object on object.id = asset_revision.object_id
           left join public.cw_page_asset_bindings page_binding
             on page_binding.page_doc_id = page.id
            and page_binding.binding_key = binding ->> 'bindingKey'
            and page_binding.track = context.track
         ), '[]'::jsonb)
  from jsonb_array_elements(release_snapshot) with ordinality entry(value, ordinal)
  join public.cw_page_docs page on page.id = (entry.value ->> 'pageDocId')::uuid
  join public.cw_page_revisions revision
    on revision.id = (entry.value ->> 'revisionId')::uuid
   and revision.page_doc_id = page.id
  order by entry.ordinal;
end;
$$;

create or replace function public.list_session_resolved_assets(p_session_id uuid)
returns table(object_hash text, storage_path text, kind text)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  context record;
  release_snapshot jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select session.courseware_resolved into resolved
  from public.class_sessions session
  where session.id = p_session_id and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if resolved is not null and resolved ->> 'version' = 'cw-session-resolved-v1' then
    return query
    with hashes as (
      select distinct binding ->> 'objectHash' sha256
      from jsonb_array_elements(coalesce(resolved -> 'bindings', '[]'::jsonb)) binding
      where jsonb_typeof(binding) = 'object'
        and binding ->> 'objectHash' ~ '^[0-9a-f]{64}$'
    )
    select object.sha256, object.storage_path, object.kind
    from hashes
    join public.cw_asset_objects object on object.sha256 = hashes.sha256
    where object.kind <> 'h5'
    order by object.sha256;
    return;
  end if;

  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return; end if;
  select release.snapshot into release_snapshot
  from public.cw_lecture_releases release
  where release.id = context.release_id
    and release.lecture_id = context.lecture_id
    and release.track = context.track;
  if release_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;

  return query
  select distinct object.sha256, object.storage_path, object.kind
  from jsonb_array_elements(release_snapshot) entry,
       jsonb_array_elements(entry.value -> 'bindings') binding
  join public.cw_asset_revisions asset_revision
    on asset_revision.id = (binding ->> 'assetRevisionId')::uuid
  join public.cw_asset_objects object on object.id = asset_revision.object_id
  where object.kind <> 'h5'
  order by object.sha256;
end;
$$;

create or replace function public.get_session_preparation_review_courseware(p_session_id uuid)
returns table(
  classroom_id uuid,
  lecture_id uuid,
  courseware_frozen_at timestamptz,
  courseware jsonb,
  courseware_template jsonb,
  courseware_overlay jsonb
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.can_review_session_preparation(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  return query
  select session.classroom_id,
         session.lecture_id,
         session.courseware_frozen_at,
         coalesce(session.courseware, '[]'::jsonb),
         public.cw_session_courseware_template(session.id),
         coalesce(session.courseware_overlay, '[]'::jsonb)
  from public.class_sessions session
  where session.id = p_session_id and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
end;
$$;

create or replace function public.get_session_preparation_review_page_docs(p_session_id uuid)
returns table(page_doc_id uuid, page_no int, doc jsonb, bindings jsonb)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  context record;
  release_snapshot jsonb;
begin
  if uid is null or not public.can_review_session_preparation(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return; end if;
  select release.snapshot into release_snapshot
  from public.cw_lecture_releases release
  where release.id = context.release_id
    and release.lecture_id = context.lecture_id
    and release.track = context.track;
  if release_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;

  return query
  select page.id,
         entry.ordinal::int,
         revision.doc,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'bindingKey', binding ->> 'bindingKey',
             'objectHash', object.sha256,
             'kind', object.kind,
             'launchQuery', page_binding.launch_query
           ) order by binding ->> 'bindingKey')
           from jsonb_array_elements(entry.value -> 'bindings') binding
           join public.cw_asset_revisions asset_revision
             on asset_revision.id = (binding ->> 'assetRevisionId')::uuid
           join public.cw_asset_objects object on object.id = asset_revision.object_id
           left join public.cw_page_asset_bindings page_binding
             on page_binding.page_doc_id = page.id
            and page_binding.binding_key = binding ->> 'bindingKey'
            and page_binding.track = context.track
         ), '[]'::jsonb)
  from jsonb_array_elements(release_snapshot) with ordinality entry(value, ordinal)
  join public.cw_page_docs page on page.id = (entry.value ->> 'pageDocId')::uuid
  join public.cw_page_revisions revision
    on revision.id = (entry.value ->> 'revisionId')::uuid
   and revision.page_doc_id = page.id
  order by entry.ordinal;
end;
$$;

create or replace function public.list_session_preparation_review_resolved_assets(p_session_id uuid)
returns table(object_hash text, storage_path text, kind text)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  context record;
  release_snapshot jsonb;
begin
  if uid is null or not public.can_review_session_preparation(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select session.courseware_resolved into resolved
  from public.class_sessions session
  where session.id = p_session_id and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if resolved is not null and resolved ->> 'version' = 'cw-session-resolved-v1' then
    return query
    with hashes as (
      select distinct binding ->> 'objectHash' sha256
      from jsonb_array_elements(coalesce(resolved -> 'bindings', '[]'::jsonb)) binding
      where jsonb_typeof(binding) = 'object'
        and binding ->> 'objectHash' ~ '^[0-9a-f]{64}$'
    )
    select object.sha256, object.storage_path, object.kind
    from hashes
    join public.cw_asset_objects object on object.sha256 = hashes.sha256
    where object.kind <> 'h5'
    order by object.sha256;
    return;
  end if;

  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return; end if;
  select release.snapshot into release_snapshot
  from public.cw_lecture_releases release
  where release.id = context.release_id
    and release.lecture_id = context.lecture_id
    and release.track = context.track;
  if release_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;

  return query
  select distinct object.sha256, object.storage_path, object.kind
  from jsonb_array_elements(release_snapshot) entry,
       jsonb_array_elements(entry.value -> 'bindings') binding
  join public.cw_asset_revisions asset_revision
    on asset_revision.id = (binding ->> 'assetRevisionId')::uuid
  join public.cw_asset_objects object on object.id = asset_revision.object_id
  where object.kind <> 'h5'
  order by object.sha256;
end;
$$;

create or replace function public.is_session_page_doc(p_session_id uuid, p_page_doc_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  context record;
  release_snapshot jsonb;
begin
  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return false; end if;
  select release.snapshot into release_snapshot
  from public.cw_lecture_releases release
  where release.id = context.release_id
    and release.lecture_id = context.lecture_id
    and release.track = context.track;
  return exists (
    select 1 from jsonb_array_elements(coalesce(release_snapshot, '[]'::jsonb)) entry
    where entry.value ->> 'pageDocId' = p_page_doc_id::text
  );
end;
$$;

revoke all on function public.cw_courseware_page_is_valid(jsonb) from public, anon, authenticated;
revoke all on function public.build_cw_release_courseware_pages(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fill_cw_release_courseware_pages() from public, anon, authenticated;
revoke all on function public.sync_lecture_legacy_courseware_projection() from public, anon, authenticated;
revoke all on function public.protect_release_backed_courseware_template() from public, anon, authenticated;
revoke all on function public.resolve_cw_session_release_context(uuid) from public, anon, authenticated;
revoke all on function public.cw_session_courseware_template(uuid) from public, anon, authenticated;
revoke all on function public.cw_session_selected_courseware_template(uuid) from public, anon, authenticated;
revoke all on function public.resolve_cw_courseware_overlay(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.get_session_courseware_template(uuid) from public, anon, authenticated;
grant execute on function public.get_session_courseware_template(uuid) to authenticated;

comment on column public.cw_lecture_releases.courseware_pages is
  'SML-0 immutable CoursewarePage projection; order and stable page identities are frozen with snapshot.';
comment on function public.get_session_courseware_template(uuid) is
  'Returns the selected/frozen track release CoursewarePage projection; legacy template is used only when no release exists.';

commit;
