-- ============================================================================
-- R1-11 Notebook 可追溯发布生命周期
--
-- 私人 note 是编辑源；posts 是发布头；notebook_post_revisions 保存不可变快照，
-- notebook_post_lifecycle_events 保存状态迁移。作者只能经 RPC 提交审核/撤回，
-- 管理员只能经 RPC 审核/下架/恢复，避免普通 REST 更新绕过审核或平台下架。
-- ============================================================================

alter table public.posts
  add column lifecycle_status text not null default 'published',
  add column moderation_status text not null default 'active',
  add column current_revision_id uuid,
  add column current_revision_no integer not null default 0,
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz,
  add column published_by uuid references public.profiles (id) on delete set null,
  add column withdrawn_by uuid references public.profiles (id) on delete set null,
  add column withdrawn_at timestamptz,
  add column withdrawal_reason text,
  add column moderated_by uuid references public.profiles (id) on delete set null,
  add column moderated_at timestamptz,
  add column moderation_reason text;

-- 旧 review_status 同时承载过平台下架。迁移后把两个维度拆开：
-- review_status 只记录当前 revision 的审核决定，moderation_status 记录平台锁。
update public.posts
   set moderation_status = 'hidden'
 where review_status in ('hidden', 'rejected');

update public.posts
   set review_status = 'approved'
 where review_status in ('hidden', 'rejected');

update public.posts
   set lifecycle_status = 'review',
       hidden = true
 where review_status = 'pending';

alter table public.posts drop constraint if exists posts_review_status_check;
alter table public.posts
  add constraint posts_review_status_check
    check (review_status in ('pending', 'approved', 'rejected')),
  add constraint posts_lifecycle_status_check
    check (lifecycle_status in ('draft', 'review', 'published', 'withdrawn', 'revised')),
  add constraint posts_moderation_status_check
    check (moderation_status in ('active', 'hidden')),
  add constraint posts_current_revision_no_check
    check (current_revision_no >= 0);

create table public.notebook_post_revisions (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts (id) on delete cascade,
  revision_no   integer not null check (revision_no > 0),
  author_id     uuid not null references public.profiles (id) on delete cascade,
  title         text not null check (char_length(title) <= 200),
  content       jsonb not null check (jsonb_typeof(content) = 'array'),
  content_html  text not null,
  excerpt       text not null default '' check (char_length(excerpt) <= 500),
  decision      text not null default 'pending'
                  check (decision in ('pending', 'approved', 'rejected')),
  submitted_at  timestamptz not null default now(),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  review_reason text not null default '' check (char_length(review_reason) <= 1000),
  unique (post_id, revision_no)
);

comment on table public.notebook_post_revisions is
  'Notebook 发布快照；内容字段只由提交 RPC 写入，审核只更新 decision/reviewer 字段';

create index notebook_post_revisions_post_idx
  on public.notebook_post_revisions (post_id, revision_no desc);

create table public.notebook_post_lifecycle_events (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts (id) on delete cascade,
  revision_id  uuid references public.notebook_post_revisions (id) on delete set null,
  from_status  text check (
    from_status is null
    or from_status in ('draft', 'review', 'published', 'withdrawn', 'revised')
  ),
  to_status    text not null
                 check (to_status in ('draft', 'review', 'published', 'withdrawn', 'revised')),
  reason       text not null default '' check (char_length(reason) <= 1000),
  actor_id     uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.notebook_post_lifecycle_events is
  'Notebook 发布状态追加历史；平台下架也记录同状态事件并由 moderation_status 区分';

create index notebook_post_lifecycle_events_post_idx
  on public.notebook_post_lifecycle_events (post_id, created_at, id);

-- 为既有公开快照建立 revision-1；这是迁移来源，reviewer 未知时保持 null。
insert into public.notebook_post_revisions (
  post_id, revision_no, author_id, title, content, content_html, excerpt,
  decision, submitted_at, reviewed_at
)
select
  p.id, 1, p.author_id, left(p.title, 200), p.content, p.content_html,
  left(p.excerpt, 500), p.review_status, p.published_at,
  case when p.review_status = 'approved' then p.published_at else null end
from public.posts p;

update public.posts p
   set current_revision_id = r.id,
       current_revision_no = r.revision_no,
       published_by = case when p.lifecycle_status = 'published' then p.author_id else null end,
       reviewed_at = case when p.review_status = 'approved' then p.published_at else null end
  from public.notebook_post_revisions r
 where r.post_id = p.id
   and r.revision_no = 1;

insert into public.notebook_post_lifecycle_events (
  post_id, revision_id, from_status, to_status, reason, actor_id, created_at
)
select
  p.id, p.current_revision_id, null, p.lifecycle_status,
  'legacy publication baseline', p.author_id, p.published_at
from public.posts p;

alter table public.posts
  add constraint posts_current_revision_id_fkey
  foreign key (current_revision_id)
  references public.notebook_post_revisions (id)
  on delete set null
  deferrable initially deferred;

create index posts_notebook_review_queue_idx
  on public.posts (lifecycle_status, updated_at desc)
  where lifecycle_status = 'review';

alter table public.notebook_post_revisions enable row level security;
alter table public.notebook_post_lifecycle_events enable row level security;

create or replace function public.notebook_post_source_is_active(
  p_note_id uuid,
  p_author_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.notes n
     where n.id = p_note_id
       and n.owner_id = p_author_id
       and not n.is_archived
  )
$$;

-- 公开读取必须同时满足生命周期、审核、平台状态和源笔记状态；作者与管理员可预览。
drop policy if exists "posts_select_visible" on public.posts;
drop policy if exists posts_review_status_anon on public.posts;
drop policy if exists posts_review_status_authenticated on public.posts;
create policy "posts_select_lifecycle" on public.posts
  for select using (
    (
      not hidden
      and lifecycle_status = 'published'
      and review_status = 'approved'
      and moderation_status = 'active'
      and public.notebook_post_source_is_active(note_id, author_id)
    )
    or (select auth.uid()) = author_id
    or public.is_admin((select auth.uid()))
  );

create policy "notebook_post_revisions_author_admin_read"
  on public.notebook_post_revisions
  for select to authenticated
  using (
    exists (
      select 1
        from public.posts p
       where p.id = post_id
         and (
           p.author_id = (select auth.uid())
           or public.is_admin((select auth.uid()))
         )
    )
  );

create policy "notebook_post_lifecycle_events_author_admin_read"
  on public.notebook_post_lifecycle_events
  for select to authenticated
  using (
    exists (
      select 1
        from public.posts p
       where p.id = post_id
         and (
           p.author_id = (select auth.uid())
           or public.is_admin((select auth.uid()))
         )
    )
  );

-- 所有发布头写入改走 security-definer RPC。未来误授列权限也没有 author write policy。
drop policy if exists "posts_insert_own" on public.posts;
drop policy if exists "posts_update_own" on public.posts;
drop policy if exists "posts_delete_own" on public.posts;
revoke all on public.posts from anon, authenticated;
revoke insert (note_id, author_id, title, content, content_html, excerpt)
  on public.posts from authenticated;
revoke update (note_id, title, content, content_html, excerpt, published_at, hidden)
  on public.posts from authenticated;
grant select on public.posts to anon, authenticated;

revoke all on public.notebook_post_revisions,
  public.notebook_post_lifecycle_events from anon, authenticated;
grant select on public.notebook_post_revisions,
  public.notebook_post_lifecycle_events to authenticated;

-- 私人笔记只有进入回收站后才能物理删除；删除时同事务清除发布头及历史。
drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_archived_own" on public.notes
  for delete to authenticated
  using (
    (select auth.uid()) = owner_id
    and is_archived
  );

create or replace function public.sync_notebook_post_note_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_archived then
    update public.posts
       set hidden = true
     where note_id = new.id
       and author_id = new.owner_id;
  elsif old.is_archived and not new.is_archived
        and public.is_feature_enabled('public_content.publish') then
    update public.posts
       set hidden = false
     where note_id = new.id
       and author_id = new.owner_id
       and lifecycle_status = 'published'
       and review_status = 'approved'
       and moderation_status = 'active';
  end if;
  return new;
end;
$$;

create trigger notes_sync_notebook_post_state
  after update of is_archived on public.notes
  for each row
  when (old.is_archived is distinct from new.is_archived)
  execute function public.sync_notebook_post_note_state();

create or replace function public.delete_notebook_post_with_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.posts
   where note_id = old.id
     and author_id = old.owner_id;
  return old;
end;
$$;

create trigger notes_delete_notebook_post
  before delete on public.notes
  for each row execute function public.delete_notebook_post_with_note();

-- 点赞只接受当前确实公开的发布头。
drop policy if exists "post_likes_insert_own" on public.post_likes;
create policy "post_likes_insert_own" on public.post_likes
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
        from public.posts p
       where p.id = post_id
         and not p.hidden
         and p.lifecycle_status = 'published'
         and p.review_status = 'approved'
         and p.moderation_status = 'active'
    )
  );

create or replace function public.submit_notebook_post_revision(
  p_note_id uuid,
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
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_note_id is null
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
    id, post_id, revision_no, author_id, title, content, content_html, excerpt
  ) values (
    revision_id, post_id, revision_no, uid, p_title, p_content, p_content_html, p_excerpt
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
    jsonb_build_object('noteId', p_note_id, 'revisionNo', revision_no), null, null
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
  if p_post_id is null or p_decision not in ('approved', 'rejected')
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

create or replace function public.withdraw_notebook_post(
  p_post_id uuid,
  p_reason text default 'author withdrawal'
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
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_post_id is null or normalized_reason = '' or char_length(normalized_reason) > 1000 then
    raise exception 'VALIDATION';
  end if;
  select * into head_row
    from public.posts
   where id = p_post_id
     and author_id = uid
   for update;
  if head_row.id is null then raise exception 'NOT_FOUND'; end if;
  if head_row.lifecycle_status = 'withdrawn' then
    return jsonb_build_object(
      'postId', head_row.id,
      'revisionNo', head_row.current_revision_no,
      'lifecycleStatus', head_row.lifecycle_status,
      'reviewStatus', head_row.review_status,
      'moderationStatus', head_row.moderation_status
    );
  end if;
  if head_row.lifecycle_status <> 'published' then raise exception 'INVALID_STATE'; end if;

  update public.posts
     set lifecycle_status = 'withdrawn', hidden = true,
         withdrawn_by = uid, withdrawn_at = now(), withdrawal_reason = normalized_reason
   where id = head_row.id;
  insert into public.notebook_post_lifecycle_events (
    post_id, revision_id, from_status, to_status, reason, actor_id
  ) values (
    head_row.id, head_row.current_revision_id, 'published', 'withdrawn',
    normalized_reason, uid
  );
  perform public.emit_domain_event(
    'notebook.post.withdrawn', 'post', head_row.id,
    jsonb_build_object('revisionNo', head_row.current_revision_no, 'reason', normalized_reason),
    null, null
  );

  return jsonb_build_object(
    'postId', head_row.id,
    'revisionNo', head_row.current_revision_no,
    'lifecycleStatus', 'withdrawn',
    'reviewStatus', head_row.review_status,
    'moderationStatus', head_row.moderation_status
  );
end;
$$;

-- 平台审核与内容 revision 审核分离。作者提交新 revision 时若平台锁仍在会被拒绝。
drop function if exists public.moderate_post(uuid, text, text);
create function public.moderate_post(
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
  if p_post_id is null or p_status not in ('approved', 'rejected', 'hidden')
     or char_length(normalized_reason) > 1000
     or (p_status <> 'approved' and normalized_reason = '') then
    raise exception 'VALIDATION';
  end if;

  select * into head_row from public.posts where id = p_post_id for update;
  if head_row.id is null then raise exception 'NOT_FOUND'; end if;
  if p_status = 'approved' and head_row.moderation_status = 'active' then
    -- A previous restore can intentionally remain hidden while the feature flag is
    -- off or the source note is archived. Retrying after those guards recover must
    -- recompute visibility instead of leaving an active-but-hidden head stuck.
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

revoke all on function public.sync_notebook_post_note_state() from public, anon, authenticated;
revoke all on function public.delete_notebook_post_with_note() from public, anon, authenticated;
revoke all on function public.notebook_post_source_is_active(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.submit_notebook_post_revision(uuid, text, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.review_notebook_post_revision(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.withdraw_notebook_post(uuid, text)
  from public, anon, authenticated;
revoke all on function public.moderate_post(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.submit_notebook_post_revision(uuid, text, jsonb, text, text)
  to authenticated;
grant execute on function public.review_notebook_post_revision(uuid, text, text)
  to authenticated;
grant execute on function public.withdraw_notebook_post(uuid, text)
  to authenticated;
grant execute on function public.moderate_post(uuid, text, text)
  to authenticated;
grant execute on function public.notebook_post_source_is_active(uuid, uuid)
  to anon, authenticated;

comment on function public.submit_notebook_post_revision(uuid, text, jsonb, text, text) is
  'Snapshot an owned active note and move its publication head into review';
comment on function public.review_notebook_post_revision(uuid, text, text) is
  'Admin-only approve/reject transition for the current immutable Notebook revision';
comment on function public.withdraw_notebook_post(uuid, text) is
  'Author-only published to withdrawn transition; allowed even when publishing is disabled';
comment on function public.moderate_post(uuid, text, text) is
  'Admin-only platform visibility lock, independent from revision review state';
