\set ON_ERROR_STOP on
-- R1-11：Notebook 生命周期、审核、平台下架、归档与互动边界。全程回滚。
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
  if has_table_privilege('authenticated', 'public.posts', 'INSERT')
     or has_table_privilege('authenticated', 'public.posts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.posts', 'DELETE') then
    failures := array_append(failures, 'authenticated retains direct posts writes');
  end if;
  if has_column_privilege('authenticated', 'public.posts', 'content', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'hidden', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'note_id', 'UPDATE') then
    failures := array_append(failures, 'authenticated retains column-level posts writes');
  end if;
  if has_table_privilege('authenticated', 'public.notebook_post_revisions', 'INSERT')
     or has_table_privilege('authenticated', 'public.notebook_post_lifecycle_events', 'INSERT') then
    failures := array_append(failures, 'authenticated can forge notebook history');
  end if;
  if to_regprocedure('public.submit_notebook_post_revision(uuid,integer,text,jsonb,text,text)') is null
     or to_regprocedure('public.submit_notebook_post_revision(uuid,text,jsonb,text,text)') is not null
     or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'review_notebook_post_revision'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'withdraw_notebook_post'
  ) then failures := array_append(failures, 'notebook lifecycle RPC contract missing'); end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notebook_post_revisions'
       and column_name = 'source_note_version'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notebook_post_revisions'
       and column_name = 'source_snapshot_hash'
  ) then failures := array_append(failures, 'revision source binding missing'); end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.notes'::regclass
       and tgname = 'notes_00_require_archived_before_delete'
       and not tgisinternal
  ) then failures := array_append(failures, 'cascade delete archive guard missing'); end if;
  if cardinality(failures) > 0 then
    raise exception 'R1 Notebook structure assertions failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

-- 临时打开发布开关；版本、事件和夹具随事务一起回滚。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_feature_flag('public_content.publish', null, true, now(), 'R1 Notebook lifecycle audit');
reset role;

insert into public.notes(owner_id, title, document)
values
  (:'admin_id', '__R1_NOTEBOOK_ADMIN_VISIBLE__', '[]'::jsonb),
  (:'admin_id', '__R1_NOTEBOOK_ADMIN_HIDDEN__', '[]'::jsonb),
  (:'admin_id', '__R1_NOTEBOOK_ADMIN_REJECTED__', '[]'::jsonb),
  (:'teacher_id', '__R1_NOTEBOOK_TEACHER_ACTIVE__', '[]'::jsonb),
  (:'teacher_id', '__R1_NOTEBOOK_TEACHER_ARCHIVED__', '[]'::jsonb);

insert into public.notes(owner_id, title, document, is_archived)
values (:'teacher_id', '__R1_NOTEBOOK_ARCHIVED_PARENT__', '[]'::jsonb, true)
returning id as archived_parent_note_id \gset
insert into public.notes(owner_id, parent_id, title, document, is_archived)
values (:'teacher_id', :'archived_parent_note_id'::uuid, '__R1_NOTEBOOK_ACTIVE_CHILD__', '[]'::jsonb, false)
returning id as active_child_note_id \gset

select id as admin_visible_note_id from public.notes where title = '__R1_NOTEBOOK_ADMIN_VISIBLE__' \gset
select id as admin_hidden_note_id from public.notes where title = '__R1_NOTEBOOK_ADMIN_HIDDEN__' \gset
select id as admin_rejected_note_id from public.notes where title = '__R1_NOTEBOOK_ADMIN_REJECTED__' \gset
select id as teacher_active_note_id from public.notes where title = '__R1_NOTEBOOK_TEACHER_ACTIVE__' \gset
select id as teacher_archived_note_id from public.notes where title = '__R1_NOTEBOOK_TEACHER_ARCHIVED__' \gset
update public.notes set is_archived = true where id = :'teacher_archived_note_id';

-- 数据库所有者夹具用于互动隐私负向断言；应用角色没有这些直写权限。
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

select set_config('r1.hidden_post_id', :'hidden_post_id', true);
select set_config('r1.rejected_post_id', :'rejected_post_id', true);
select set_config('r1.admin_visible_note_id', :'admin_visible_note_id', true);
select set_config('r1.teacher_active_note_id', :'teacher_active_note_id', true);
select set_config('r1.teacher_archived_note_id', :'teacher_archived_note_id', true);
select set_config('r1.archived_parent_note_id', :'archived_parent_note_id', true);
select set_config('r1.active_child_note_id', :'active_child_note_id', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);

do $$
begin
  begin
    delete from public.notes
     where id = current_setting('r1.archived_parent_note_id')::uuid;
    raise exception 'R1_ACTIVE_CASCADE_CHILD_WAS_DELETED';
  exception when others then
    if sqlerrm not like '%NOTE_NOT_ARCHIVED%' then raise; end if;
  end;
end
$$;
select (
  (select is_archived from public.notes where id = :'archived_parent_note_id'::uuid)
  and not (select is_archived from public.notes where id = :'active_child_note_id'::uuid)
  and (select parent_id from public.notes where id = :'active_child_note_id'::uuid) = :'archived_parent_note_id'::uuid
) as cascade_delete_left_tree_unchanged \gset
\if :cascade_delete_left_tree_unchanged
\else
  \echo R1 Notebook failed: archived-parent delete changed active descendant tree
  select 1 / 0;
\endif

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
  begin
    insert into public.posts(note_id, author_id, title, content, content_html, excerpt)
    values (current_setting('r1.admin_visible_note_id')::uuid, auth.uid(), 'foreign note', '[]'::jsonb, '<p>x</p>', 'x');
    raise exception 'R1_DIRECT_POST_INSERT_WAS_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_notebook_post_revision(
      current_setting('r1.teacher_archived_note_id')::uuid,
      0,
      'archived note', '[]'::jsonb, '<p>x</p>', 'x'
    );
    raise exception 'R1_ARCHIVED_NOTE_SUBMIT_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%NOTE_ARCHIVED%' then raise; end if;
  end;
end
$$;

do $$
begin
  begin
    perform public.submit_notebook_post_revision(
      current_setting('r1.teacher_active_note_id')::uuid,
      0,
      '__R1_NOTEBOOK_FORGED_SNAPSHOT__', '[]'::jsonb, '<p>forged</p>', 'forged'
    );
    raise exception 'R1_SOURCE_SNAPSHOT_MISMATCH_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%SOURCE_SNAPSHOT_MISMATCH%' then raise; end if;
  end;
end
$$;
select (count(*) = 0) as forged_snapshot_left_no_head
  from public.posts where note_id = :'teacher_active_note_id'::uuid \gset
\if :forged_snapshot_left_no_head
\else
  \echo R1 Notebook failed: forged source snapshot left publication state
  select 1 / 0;
\endif

-- 初稿：draft（私人 note）→ review → published。
update public.notes
   set title = '__R1_NOTEBOOK_OWN_POST_V1__',
       document = '[{"type":"paragraph","content":[{"type":"text","text":"v1"}]}]'::jsonb,
       version = version + 1
 where id = :'teacher_active_note_id'::uuid;
select (public.submit_notebook_post_revision(
  :'teacher_active_note_id'::uuid,
  1,
  '__R1_NOTEBOOK_OWN_POST_V1__',
  '[{"type":"paragraph","content":[{"type":"text","text":"v1"}]}]'::jsonb,
  '<p>v1</p>', 'v1'
) ->> 'postId') as own_post_id \gset
select set_config('r1.own_post_id', :'own_post_id', true);
select public.submit_notebook_post_revision(
  :'teacher_active_note_id'::uuid,
  1,
  '__R1_NOTEBOOK_OWN_POST_V1__',
  '[{"type":"paragraph","content":[{"type":"text","text":"v1"}]}]'::jsonb,
  '<p>v1</p>', 'v1'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
do $$
begin
  begin
    perform public.review_notebook_post_revision(
      current_setting('r1.own_post_id')::uuid, null, 'null decision'
    );
    raise exception 'R1_NULL_REVIEW_DECISION_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%VALIDATION%' then raise; end if;
  end;
end
$$;
select (lifecycle_status = 'review' and review_status = 'pending') as null_review_left_state_unchanged
  from public.posts where id = :'own_post_id'::uuid \gset
\if :null_review_left_state_unchanged
\else
  \echo R1 Notebook failed: NULL review decision changed state
  select 1 / 0;
\endif
select public.review_notebook_post_revision(:'own_post_id'::uuid, 'approved', 'initial review');
select public.review_notebook_post_revision(:'own_post_id'::uuid, 'approved', 'initial review retry');

-- 作者撤回后提交 revision-2；管理员退回后头状态必须为 revised。
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.withdraw_notebook_post(:'own_post_id'::uuid, 'author withdrawal test');
select public.withdraw_notebook_post(:'own_post_id'::uuid, 'author withdrawal retry');
update public.notes
   set title = '__R1_NOTEBOOK_OWN_POST_V2__', document = '[]'::jsonb, version = version + 1
 where id = :'teacher_active_note_id'::uuid;
select public.submit_notebook_post_revision(
  :'teacher_active_note_id'::uuid,
  2,
  '__R1_NOTEBOOK_OWN_POST_V2__', '[]'::jsonb, '<p>v2</p>', 'v2'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.review_notebook_post_revision(:'own_post_id'::uuid, 'rejected', 'needs revision');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (lifecycle_status = 'revised' and review_status = 'rejected') as rejection_is_revised
  from public.posts where id = :'own_post_id'::uuid \gset
\if :rejection_is_revised
\else
  \echo R1 Notebook failed: rejected published revision did not enter revised
  select 1 / 0;
\endif

-- revision-3 重新审核通过；平台下架后作者不能靠 revision-4 绕过。
update public.notes
   set title = '__R1_NOTEBOOK_OWN_POST_V3__', document = '[]'::jsonb, version = version + 1
 where id = :'teacher_active_note_id'::uuid;
do $$
begin
  begin
    perform public.submit_notebook_post_revision(
      current_setting('r1.teacher_active_note_id')::uuid,
      2,
      '__R1_NOTEBOOK_OWN_POST_V3__', '[]'::jsonb, '<p>v3</p>', 'v3'
    );
    raise exception 'R1_STALE_NOTE_VERSION_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%NOTE_VERSION_CONFLICT%' then raise; end if;
  end;
end
$$;
select (
  (select current_revision_no from public.posts where id = :'own_post_id'::uuid) = 2
  and (select count(*) from public.notebook_post_revisions where post_id = :'own_post_id'::uuid) = 2
) as stale_version_left_history_unchanged \gset
\if :stale_version_left_history_unchanged
\else
  \echo R1 Notebook failed: stale source version changed publication history
  select 1 / 0;
\endif
select public.submit_notebook_post_revision(
  :'teacher_active_note_id'::uuid,
  3,
  '__R1_NOTEBOOK_OWN_POST_V3__', '[]'::jsonb, '<p>v3</p>', 'v3'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.review_notebook_post_revision(:'own_post_id'::uuid, 'approved', 'revision approved');
do $$
begin
  begin
    perform public.moderate_post(
      current_setting('r1.own_post_id')::uuid, null, 'null moderation status'
    );
    raise exception 'R1_NULL_MODERATION_STATUS_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%VALIDATION%' then raise; end if;
  end;
end
$$;
select (moderation_status = 'active' and not hidden) as null_moderation_left_state_unchanged
  from public.posts where id = :'own_post_id'::uuid \gset
\if :null_moderation_left_state_unchanged
\else
  \echo R1 Notebook failed: NULL moderation status changed state
  select 1 / 0;
\endif
select public.moderate_post(:'own_post_id'::uuid, 'hidden', 'platform safety hold');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
do $$
begin
  begin
    perform public.submit_notebook_post_revision(
      current_setting('r1.teacher_active_note_id')::uuid,
      3,
      '__R1_NOTEBOOK_OWN_POST_V3__', '[]'::jsonb, '<p>v3</p>', 'v3'
    );
    raise exception 'R1_PLATFORM_HIDE_WAS_BYPASSED';
  exception when others then
    if sqlerrm not like '%MODERATION_LOCKED%' then raise; end if;
  end;
  begin
    update public.posts set moderation_status = 'active', hidden = false
     where id = current_setting('r1.own_post_id')::uuid;
    raise exception 'R1_DIRECT_MODERATION_UNLOCK_WAS_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.posts where id = current_setting('r1.own_post_id')::uuid;
    raise exception 'R1_DIRECT_POST_DELETE_WAS_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.moderate_post(:'own_post_id'::uuid, 'approved', 'platform hold cleared');

reset role;
select (
  (select count(*) from public.notebook_post_revisions where post_id = :'own_post_id'::uuid) = 3
  and (select array_agg(source_note_version order by revision_no) from public.notebook_post_revisions where post_id = :'own_post_id'::uuid) = array[1,2,3]
  and (select bool_and(
    source_snapshot_hash = encode(
      extensions.digest(convert_to(title || E'\n' || content::text, 'UTF8'), 'sha256'),
      'hex'
    )
  ) from public.notebook_post_revisions where post_id = :'own_post_id'::uuid)
  and (select count(*) from public.notebook_post_lifecycle_events where post_id = :'own_post_id'::uuid) >= 9
  and exists (
    select 1 from public.notebook_post_lifecycle_events
     where post_id = :'own_post_id'::uuid
       and from_status = 'draft'
       and to_status = 'review'
  )
  and (select current_revision_no from public.posts where id = :'own_post_id'::uuid) = 3
) as history_is_traceable \gset
\if :history_is_traceable
\else
  \echo R1 Notebook failed: revision/event history incomplete
  select 1 / 0;
\endif

-- 发布关闭时，归档仍会隐藏；恢复不能重发，作者撤回仍可执行。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_feature_flag('public_content.publish', null, false, now(), 'R1 Notebook fail-closed restore audit');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
update public.notes set is_archived = true where id = :'teacher_active_note_id';
update public.notes set is_archived = false where id = :'teacher_active_note_id';
select hidden as flag_off_restore_hidden from public.posts where id = :'own_post_id'::uuid \gset
\if :flag_off_restore_hidden
\else
  \echo R1 Notebook failed: flag-off note restore republished post
  select 1 / 0;
\endif

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.moderate_post(:'own_post_id'::uuid, 'approved', 'retry while publishing disabled');
select public.set_feature_flag('public_content.publish', null, true, now(), 'R1 Notebook restore retry audit');
select public.moderate_post(:'own_post_id'::uuid, 'approved', 'retry after publishing restored');
select not hidden as recovered_restore_visible from public.posts where id = :'own_post_id'::uuid \gset
\if :recovered_restore_visible
\else
  \echo R1 Notebook failed: approved retry did not recover visibility
  select 1 / 0;
\endif
select public.set_feature_flag('public_content.publish', null, false, now(), 'R1 Notebook withdrawal remains available');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.withdraw_notebook_post(:'own_post_id'::uuid, 'withdraw while publishing disabled');

rollback;
\echo R1 Notebook database assertions passed
