-- ============================================================================
-- R1-11 Notebook 生命周期安全复核 follow-up
-- 1. FK cascade 删除也逐行要求 note 已归档，避免只校验父节点的 RLS 绕过子节点。
-- 2. 审核/下架 RPC 对 NULL 决策显式返回 VALIDATION。
-- 3. 发布 revision 固定源 note version 与快照 hash，并在持有 note 行锁时核对内容。
-- ============================================================================

alter table public.notebook_post_revisions
  add column source_note_version integer not null default 0,
  add column source_snapshot_hash text;

update public.notebook_post_revisions r
   set source_note_version = n.version
  from public.posts p
  join public.notes n on n.id = p.note_id and n.owner_id = p.author_id
 where p.id = r.post_id
   and r.title = n.title
   and r.content = coalesce(n.document, '[]'::jsonb);

update public.notebook_post_revisions
   set source_snapshot_hash = encode(
     extensions.digest(convert_to(title || E'\n' || content::text, 'UTF8'), 'sha256'),
     'hex'
   );

alter table public.notebook_post_revisions
  alter column source_snapshot_hash set not null,
  add constraint notebook_post_revisions_source_note_version_check
    check (source_note_version >= 0),
  add constraint notebook_post_revisions_source_snapshot_hash_check
    check (source_snapshot_hash ~ '^[0-9a-f]{64}$');

comment on column public.notebook_post_revisions.source_note_version is
  'Locked notes.version used for this snapshot; 0 can denote a legacy revision whose exact source version was unavailable';
comment on column public.notebook_post_revisions.source_snapshot_hash is
  'SHA-256 of the revision title, a newline separator, and canonical jsonb content text';

create or replace function public.require_archived_note_before_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not old.is_archived then
    raise exception 'NOTE_NOT_ARCHIVED';
  end if;
  return old;
end;
$$;

drop trigger if exists notes_00_require_archived_before_delete on public.notes;
create trigger notes_00_require_archived_before_delete
  before delete on public.notes
  for each row execute function public.require_archived_note_before_delete();

revoke all on function public.require_archived_note_before_delete()
  from public, anon, authenticated;

-- Replace the five-argument submit contract. Keeping it callable would let clients
-- bypass source-version verification even after the application adopts the new RPC.
revoke all on function public.submit_notebook_post_revision(uuid, text, jsonb, text, text)
  from public, anon, authenticated;
drop function public.submit_notebook_post_revision(uuid, text, jsonb, text, text);

create function public.submit_notebook_post_revision(
  p_note_id uuid,
  p_expected_note_version integer,
  p_title text,
  p_content jsonb,
  p_content_html text,
  p_excerpt text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  note_row public.notes%rowtype;
  head_row public.posts%rowtype;
  post_id uuid;
  revision_id uuid := gen_random_uuid();
  revision_no integer;
  event_from text;
  snapshot_hash text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_note_id is null
     or p_expected_note_version is null or p_expected_note_version < 0
     or p_title is null or char_length(p_title) > 200
     or p_content is null or jsonb_typeof(p_content) <> 'array'
     or octet_length(p_content::text) >= 1000000
     or p_content_html is null or octet_length(p_content_html) >= 2000000
     or p_excerpt is null or char_length(p_excerpt) > 500 then
    raise exception 'VALIDATION';
  end if;
  if not public.is_feature_enabled('public_content.publish') then
    raise exception 'PUBLIC_PUBLISHING_DISABLED';
  end if;

  select * into note_row
    from public.notes
   where id = p_note_id
     and owner_id = uid
   for update;
  if note_row.id is null then raise exception 'NOT_FOUND'; end if;
  if note_row.is_archived then raise exception 'NOTE_ARCHIVED'; end if;
  if note_row.version <> p_expected_note_version then
    raise exception 'NOTE_VERSION_CONFLICT';
  end if;
  if p_title is distinct from note_row.title
     or p_content is distinct from coalesce(note_row.document, '[]'::jsonb) then
    raise exception 'SOURCE_SNAPSHOT_MISMATCH';
  end if;
  snapshot_hash := encode(
    extensions.digest(convert_to(note_row.title || E'\n' || coalesce(note_row.document, '[]'::jsonb)::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select * into head_row
    from public.posts
   where note_id = p_note_id
     and author_id = uid
   for update;

  if head_row.id is null then
    post_id := gen_random_uuid();
    revision_no := 1;
    event_from := 'draft';
    insert into public.posts (
      id, note_id, author_id, title, content, content_html, excerpt,
      hidden, review_status, lifecycle_status, moderation_status,
      current_revision_no
    ) values (
      post_id, p_note_id, uid, p_title, p_content, p_content_html, p_excerpt,
      true, 'pending', 'review', 'active', revision_no
    );
  else
    post_id := head_row.id;
    revision_no := head_row.current_revision_no + 1;
    if head_row.moderation_status = 'hidden' then
      raise exception 'MODERATION_LOCKED';
    end if;
    if head_row.lifecycle_status = 'review' then
      if exists (
        select 1
          from public.notebook_post_revisions r
         where r.id = head_row.current_revision_id
           and r.post_id = head_row.id
           and r.decision = 'pending'
           and r.source_note_version = p_expected_note_version
           and r.source_snapshot_hash = snapshot_hash
           and r.title = p_title
           and r.content = p_content
           and r.content_html = p_content_html
           and r.excerpt = p_excerpt
      ) then
        return jsonb_build_object(
          'postId', head_row.id,
          'revisionNo', head_row.current_revision_no,
          'lifecycleStatus', head_row.lifecycle_status,
          'reviewStatus', head_row.review_status,
          'moderationStatus', head_row.moderation_status
        );
      end if;
      raise exception 'ALREADY_IN_REVIEW';
    end if;
    event_from := head_row.lifecycle_status;
    if event_from in ('published', 'withdrawn') then
      insert into public.notebook_post_lifecycle_events (
        post_id, revision_id, from_status, to_status, reason, actor_id
      ) values (
        post_id, null, event_from, 'revised', 'new revision created', uid
      );
      event_from := 'revised';
    end if;
  end if;

  insert into public.notebook_post_revisions (
    id, post_id, revision_no, author_id, title, content, content_html, excerpt,
    source_note_version, source_snapshot_hash
  ) values (
    revision_id, post_id, revision_no, uid, p_title, p_content, p_content_html, p_excerpt,
    p_expected_note_version, snapshot_hash
  );

  update public.posts
     set title = p_title,
         content = p_content,
         content_html = p_content_html,
         excerpt = p_excerpt,
         hidden = true,
         lifecycle_status = 'review',
         review_status = 'pending',
         current_revision_id = revision_id,
         current_revision_no = revision_no,
         reviewed_by = null,
         reviewed_at = null,
         withdrawn_by = null,
         withdrawn_at = null,
         withdrawal_reason = null
   where id = post_id;

  insert into public.notebook_post_lifecycle_events (
    post_id, revision_id, from_status, to_status, reason, actor_id
  ) values (
    post_id, revision_id, event_from, 'review', 'submitted for review', uid
  );

  perform public.emit_domain_event(
    'notebook.post.submitted', 'post', post_id,
    jsonb_build_object(
      'noteId', p_note_id,
      'revisionNo', revision_no,
      'sourceNoteVersion', p_expected_note_version,
      'sourceSnapshotHash', snapshot_hash
    ), null, null
  );

  return jsonb_build_object(
    'postId', post_id,
    'revisionNo', revision_no,
    'lifecycleStatus', 'review',
    'reviewStatus', 'pending',
    'moderationStatus', 'active'
  );
end;
$$;

create or replace function public.review_notebook_post_revision(
  p_post_id uuid,
  p_decision text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  head_row public.posts%rowtype;
  next_status text;
  normalized_reason text := trim(coalesce(p_reason, ''));
  was_published boolean;
begin
  if uid is null or not public.is_admin(uid) then raise exception 'FORBIDDEN'; end if;
  if p_post_id is null or p_decision is null or p_decision not in ('approved', 'rejected')
     or char_length(normalized_reason) > 1000
     or (p_decision = 'rejected' and normalized_reason = '') then
    raise exception 'VALIDATION';
  end if;

  select * into head_row from public.posts where id = p_post_id for update;
  if head_row.id is null then raise exception 'NOT_FOUND'; end if;
  if p_decision = 'approved'
     and head_row.lifecycle_status = 'published'
     and head_row.review_status = 'approved'
     and exists (
       select 1 from public.notebook_post_revisions r
        where r.id = head_row.current_revision_id
          and r.post_id = head_row.id
          and r.decision = 'approved'
     ) then
    return jsonb_build_object(
      'postId', head_row.id,
      'revisionNo', head_row.current_revision_no,
      'lifecycleStatus', head_row.lifecycle_status,
      'reviewStatus', head_row.review_status,
      'moderationStatus', head_row.moderation_status
    );
  end if;
  if p_decision = 'rejected'
     and head_row.lifecycle_status in ('draft', 'revised')
     and head_row.review_status = 'rejected'
     and exists (
       select 1 from public.notebook_post_revisions r
        where r.id = head_row.current_revision_id
          and r.post_id = head_row.id
          and r.decision = 'rejected'
     ) then
    return jsonb_build_object(
      'postId', head_row.id,
      'revisionNo', head_row.current_revision_no,
      'lifecycleStatus', head_row.lifecycle_status,
      'reviewStatus', head_row.review_status,
      'moderationStatus', head_row.moderation_status
    );
  end if;
  if head_row.lifecycle_status <> 'review'
     or head_row.review_status <> 'pending'
     or head_row.current_revision_id is null then
    raise exception 'INVALID_STATE';
  end if;

  if p_decision = 'approved' then
    if head_row.moderation_status = 'hidden' then raise exception 'MODERATION_LOCKED'; end if;
    if not public.is_feature_enabled('public_content.publish') then
      raise exception 'PUBLIC_PUBLISHING_DISABLED';
    end if;
    if not exists (
      select 1 from public.notes n
       where n.id = head_row.note_id
         and n.owner_id = head_row.author_id
         and not n.is_archived
    ) then raise exception 'NOTE_ARCHIVED'; end if;

    update public.notebook_post_revisions
       set decision = 'approved', reviewed_by = uid, reviewed_at = now(),
           review_reason = normalized_reason
     where id = head_row.current_revision_id
       and post_id = head_row.id
       and decision = 'pending';
    if not found then raise exception 'INVALID_STATE'; end if;

    update public.posts
       set lifecycle_status = 'published', review_status = 'approved', hidden = false,
           reviewed_by = uid, reviewed_at = now(), published_by = uid,
           published_at = now(), withdrawn_by = null, withdrawn_at = null,
           withdrawal_reason = null
     where id = head_row.id;
    next_status := 'published';
    perform public.emit_domain_event(
      'notebook.post.published', 'post', head_row.id,
      jsonb_build_object('revisionNo', head_row.current_revision_no), null, null
    );
  else
    select exists (
      select 1 from public.notebook_post_lifecycle_events e
       where e.post_id = head_row.id
         and (e.from_status = 'published' or e.to_status = 'published')
    ) into was_published;
    next_status := case when was_published then 'revised' else 'draft' end;

    update public.notebook_post_revisions
       set decision = 'rejected', reviewed_by = uid, reviewed_at = now(),
           review_reason = normalized_reason
     where id = head_row.current_revision_id
       and post_id = head_row.id
       and decision = 'pending';
    if not found then raise exception 'INVALID_STATE'; end if;

    update public.posts
       set lifecycle_status = next_status, review_status = 'rejected', hidden = true,
           reviewed_by = uid, reviewed_at = now()
     where id = head_row.id;
    perform public.emit_domain_event(
      'notebook.post.review_rejected', 'post', head_row.id,
      jsonb_build_object('revisionNo', head_row.current_revision_no, 'reason', normalized_reason),
      null, null
    );
  end if;

  insert into public.notebook_post_lifecycle_events (
    post_id, revision_id, from_status, to_status, reason, actor_id
  ) values (
    head_row.id, head_row.current_revision_id, 'review', next_status,
    normalized_reason, uid
  );

  return jsonb_build_object(
    'postId', head_row.id,
    'revisionNo', head_row.current_revision_no,
    'lifecycleStatus', next_status,
    'reviewStatus', p_decision,
    'moderationStatus', head_row.moderation_status
  );
end;
$$;

create or replace function public.moderate_post(
  p_post_id uuid,
  p_status text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  head_row public.posts%rowtype;
  normalized_reason text := trim(coalesce(p_reason, ''));
  next_moderation text;
begin
  if uid is null or not public.is_admin(uid) then raise exception 'FORBIDDEN'; end if;
  if p_post_id is null or p_status is null or p_status not in ('approved', 'rejected', 'hidden')
     or char_length(normalized_reason) > 1000
     or (p_status <> 'approved' and normalized_reason = '') then
    raise exception 'VALIDATION';
  end if;

  select * into head_row from public.posts where id = p_post_id for update;
  if head_row.id is null then raise exception 'NOT_FOUND'; end if;
  if p_status = 'approved' and head_row.moderation_status = 'active' then
    update public.posts
       set hidden = not (
         head_row.lifecycle_status = 'published'
         and head_row.review_status = 'approved'
         and public.is_feature_enabled('public_content.publish')
         and public.notebook_post_source_is_active(head_row.note_id, head_row.author_id)
       )
     where id = head_row.id;
    return jsonb_build_object(
      'postId', head_row.id,
      'revisionNo', head_row.current_revision_no,
      'lifecycleStatus', head_row.lifecycle_status,
      'reviewStatus', head_row.review_status,
      'moderationStatus', head_row.moderation_status
    );
  end if;
  if p_status in ('hidden', 'rejected') and head_row.moderation_status = 'hidden' then
    return jsonb_build_object(
      'postId', head_row.id,
      'revisionNo', head_row.current_revision_no,
      'lifecycleStatus', head_row.lifecycle_status,
      'reviewStatus', head_row.review_status,
      'moderationStatus', head_row.moderation_status
    );
  end if;

  if p_status = 'approved' then
    next_moderation := 'active';
    update public.posts
       set moderation_status = 'active',
           hidden = not (
             head_row.lifecycle_status = 'published'
             and head_row.review_status = 'approved'
             and public.is_feature_enabled('public_content.publish')
             and public.notebook_post_source_is_active(head_row.note_id, head_row.author_id)
           ),
           moderated_by = uid, moderated_at = now(), moderation_reason = normalized_reason
     where id = head_row.id;
  else
    if head_row.lifecycle_status <> 'published'
       or head_row.review_status <> 'approved' then
      raise exception 'INVALID_STATE';
    end if;
    next_moderation := 'hidden';
    update public.posts
       set moderation_status = 'hidden', hidden = true,
           moderated_by = uid, moderated_at = now(), moderation_reason = normalized_reason
     where id = head_row.id;
  end if;

  insert into public.notebook_post_lifecycle_events (
    post_id, revision_id, from_status, to_status, reason, actor_id
  ) values (
    head_row.id, head_row.current_revision_id, head_row.lifecycle_status,
    head_row.lifecycle_status,
    left('moderation:' || p_status || ':' || normalized_reason, 1000), uid
  );
  perform public.emit_domain_event(
    'post.moderated', 'post', head_row.id,
    jsonb_build_object(
      'before', head_row.moderation_status,
      'after', next_moderation,
      'reason', normalized_reason
    ), null, null
  );

  return jsonb_build_object(
    'postId', head_row.id,
    'revisionNo', head_row.current_revision_no,
    'lifecycleStatus', head_row.lifecycle_status,
    'reviewStatus', head_row.review_status,
    'moderationStatus', next_moderation
  );
end;
$$;

revoke all on function public.submit_notebook_post_revision(uuid, integer, text, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.review_notebook_post_revision(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.moderate_post(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.submit_notebook_post_revision(uuid, integer, text, jsonb, text, text)
  to authenticated;
grant execute on function public.review_notebook_post_revision(uuid, text, text)
  to authenticated;
grant execute on function public.moderate_post(uuid, text, text)
  to authenticated;

comment on function public.submit_notebook_post_revision(uuid, integer, text, jsonb, text, text) is
  'Snapshot an owned active note only when locked source version, title, and content match';
