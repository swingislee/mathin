\set ON_ERROR_STOP on
-- R1-11：Notebook 发布所有权、归档和点赞隐私边界。全程回滚。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
\if :{?admin_id}
\else
  \echo R1 Notebook fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo R1 Notebook fixtures missing: 测试-教师
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}';
begin
  if has_table_privilege('anon', 'public.post_likes', 'SELECT') then
    failures := array_append(failures, 'anon can enumerate post_likes');
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'post_likes'
       and policyname = 'post_likes_select_own'
  ) then failures := array_append(failures, 'own-like select policy missing'); end if;
  if has_column_privilege('authenticated', 'public.posts', 'note_id', 'UPDATE') then
    failures := array_append(failures, 'authenticated can rebind posts.note_id');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'R1 Notebook structure assertions failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

-- 临时打开发布开关；版本、事件和夹具随事务一起回滚。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_feature_flag('public_content.publish', null, true, now(), 'R1 Notebook boundary audit');
reset role;

insert into public.notes(owner_id, title, document)
values
  (:'admin_id', '__R1_NOTEBOOK_ADMIN_VISIBLE__', '[]'::jsonb),
  (:'admin_id', '__R1_NOTEBOOK_ADMIN_HIDDEN__', '[]'::jsonb),
  (:'admin_id', '__R1_NOTEBOOK_ADMIN_REJECTED__', '[]'::jsonb),
  (:'teacher_id', '__R1_NOTEBOOK_TEACHER_ACTIVE__', '[]'::jsonb),
  (:'teacher_id', '__R1_NOTEBOOK_TEACHER_ARCHIVED__', '[]'::jsonb);

select id as admin_visible_note_id from public.notes where title = '__R1_NOTEBOOK_ADMIN_VISIBLE__' \gset
select id as admin_hidden_note_id from public.notes where title = '__R1_NOTEBOOK_ADMIN_HIDDEN__' \gset
select id as admin_rejected_note_id from public.notes where title = '__R1_NOTEBOOK_ADMIN_REJECTED__' \gset
select id as teacher_active_note_id from public.notes where title = '__R1_NOTEBOOK_TEACHER_ACTIVE__' \gset
select id as teacher_archived_note_id from public.notes where title = '__R1_NOTEBOOK_TEACHER_ARCHIVED__' \gset
update public.notes set is_archived = true where id = :'teacher_archived_note_id';

insert into public.posts(note_id, author_id, title, content, content_html, excerpt, hidden, review_status)
values
  (:'admin_visible_note_id', :'admin_id', '__R1_NOTEBOOK_VISIBLE_POST__', '[]'::jsonb, '<p>visible</p>', 'visible', false, 'approved'),
  (:'admin_hidden_note_id', :'admin_id', '__R1_NOTEBOOK_HIDDEN_POST__', '[]'::jsonb, '<p>hidden</p>', 'hidden', true, 'approved'),
  (:'admin_rejected_note_id', :'admin_id', '__R1_NOTEBOOK_REJECTED_POST__', '[]'::jsonb, '<p>rejected</p>', 'rejected', false, 'rejected');
select id as visible_post_id from public.posts where title = '__R1_NOTEBOOK_VISIBLE_POST__' \gset
select id as hidden_post_id from public.posts where title = '__R1_NOTEBOOK_HIDDEN_POST__' \gset
select id as rejected_post_id from public.posts where title = '__R1_NOTEBOOK_REJECTED_POST__' \gset

insert into public.post_likes(post_id, user_id)
values
  (:'visible_post_id', :'admin_id'),
  (:'visible_post_id', :'teacher_id');

-- psql variables cannot be interpolated inside dollar-quoted blocks; expose fixture UUIDs as transaction-local settings.
select set_config('r1.hidden_post_id', :'hidden_post_id', true);
select set_config('r1.rejected_post_id', :'rejected_post_id', true);
select set_config('r1.admin_visible_note_id', :'admin_visible_note_id', true);
select set_config('r1.teacher_archived_note_id', :'teacher_archived_note_id', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);

select (count(*) = 1 and bool_and(user_id = :'teacher_id')) as own_like_only
  from public.post_likes where post_id = :'visible_post_id' \gset
\if :own_like_only
\else
  \echo R1 Notebook failed: authenticated user enumerated another user's like
  select 1 / 0;
\endif

do $$
begin
  begin
    insert into public.post_likes(post_id, user_id)
    values (current_setting('r1.hidden_post_id', true)::uuid, auth.uid());
    raise exception 'R1_HIDDEN_POST_LIKE_WAS_ACCEPTED';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into public.post_likes(post_id, user_id)
    values (current_setting('r1.rejected_post_id', true)::uuid, auth.uid());
    raise exception 'R1_REJECTED_POST_LIKE_WAS_ACCEPTED';
  exception when insufficient_privilege or check_violation then null;
  end;
end
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);

do $$
begin
  begin
    insert into public.posts(note_id, author_id, title, content, content_html, excerpt)
    values (current_setting('r1.admin_visible_note_id')::uuid, auth.uid(), 'foreign note', '[]'::jsonb, '<p>x</p>', 'x');
    raise exception 'R1_FOREIGN_NOTE_PUBLISH_WAS_ACCEPTED';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into public.posts(note_id, author_id, title, content, content_html, excerpt)
    values (current_setting('r1.teacher_archived_note_id')::uuid, auth.uid(), 'archived note', '[]'::jsonb, '<p>x</p>', 'x');
    raise exception 'R1_ARCHIVED_NOTE_PUBLISH_WAS_ACCEPTED';
  exception when insufficient_privilege or check_violation then null;
  end;
end
$$;

insert into public.posts(note_id, author_id, title, content, content_html, excerpt)
values (:'teacher_active_note_id', :'teacher_id', '__R1_NOTEBOOK_OWN_POST__', '[]'::jsonb, '<p>own</p>', 'own');

do $$
begin
  begin
    update public.posts
       set note_id = current_setting('r1.admin_visible_note_id')::uuid
     where title = '__R1_NOTEBOOK_OWN_POST__';
    raise exception 'R1_POST_NOTE_REBIND_WAS_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 发布关闭时，归档仍能隐藏；恢复源笔记后不得把快照重新公开。
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
-- `is_feature_enabled()` defaults to transaction-time `now()`. Keep the
-- replacement version on that same effective timestamp so this rollback-only
-- audit observes the latest version instead of scheduling it in the future.
select public.set_feature_flag('public_content.publish', null, false, now(), 'R1 Notebook fail-closed restore audit');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
update public.notes set is_archived = true where id = :'teacher_active_note_id';
update public.posts set hidden = true where title = '__R1_NOTEBOOK_OWN_POST__';
update public.notes set is_archived = false where id = :'teacher_active_note_id';
do $$
begin
  begin
    update public.posts set hidden = false where title = '__R1_NOTEBOOK_OWN_POST__';
    raise exception 'R1_FLAG_OFF_RESTORE_REPUBLISHED_POST';
  exception when insufficient_privilege or check_violation then null;
  end;
end
$$;

rollback;
\echo R1 Notebook database assertions passed
