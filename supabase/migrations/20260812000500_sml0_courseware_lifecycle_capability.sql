-- SML-0：把既有课件编辑与评审写 RPC 接入统一 lecture capability。
--
-- 旧实现已包含 revision/head/workflow 的并发锁、状态机与输入校验。这里把它们
-- 改名为不可由客户端直接执行的内部实现，并在原公开签名上增加对象级 capability
-- 包装层，避免复制两套业务逻辑。发布、rollback、freeze 与空间文档双 head 原子
-- 映射将在后续独立 migration 中收口。

begin;

create or replace function public.assert_cw_page_capability(
  p_page_doc_id uuid,
  p_capability text
)
returns uuid
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  preflight record;
  lecture_value uuid;
begin
  -- permission-first：没有对应平台权限的 actor 不得通过错误差异探测 page。
  select * into preflight
  from public.resolve_cw_lecture_capability_for(auth.uid(), null, p_capability, now());

  if preflight.denial_code is distinct from 'LECTURE_NOT_FOUND' then
    raise exception '%', preflight.denial_code using errcode = '42501';
  end if;

  select page_value.lecture_id into lecture_value
  from public.cw_page_docs page_value
  where page_value.id = p_page_doc_id;

  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  return public.assert_cw_lecture_capability(lecture_value, p_capability);
end;
$$;

comment on function public.assert_cw_page_capability(uuid, text) is
  'SML-0 内部 page→lecture capability 断言；permission-first，未授予客户端执行。';

revoke all on function public.assert_cw_page_capability(uuid, text)
  from public, anon, authenticated;

create or replace function public.assert_cw_review_cycle_capability(
  p_review_cycle_id uuid,
  p_capability text
)
returns uuid
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  preflight record;
  lecture_value uuid;
begin
  -- 与 page helper 一样先判身份/权限，再解析具体 review cycle。
  select * into preflight
  from public.resolve_cw_lecture_capability_for(auth.uid(), null, p_capability, now());

  if preflight.denial_code is distinct from 'LECTURE_NOT_FOUND' then
    raise exception '%', preflight.denial_code using errcode = '42501';
  end if;

  select cycle_value.lecture_id into lecture_value
  from public.cw_review_cycles cycle_value
  where cycle_value.id = p_review_cycle_id;

  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  return public.assert_cw_lecture_capability(lecture_value, p_capability);
end;
$$;

comment on function public.assert_cw_review_cycle_capability(uuid, text) is
  'SML-0 内部 review-cycle→lecture capability 断言；permission-first，未授予客户端执行。';

revoke all on function public.assert_cw_review_cycle_capability(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. 页面 identity / 顺序 / revision / 教学检查标记
-- ---------------------------------------------------------------------------

alter function public.reorder_cw_pages(uuid, uuid[])
  rename to reorder_cw_pages_pre_sml0_impl;
alter function public.copy_cw_page(uuid, uuid, uuid, text)
  rename to copy_cw_page_pre_sml0_impl;
alter function public.create_blank_cw_page(uuid, uuid, text)
  rename to create_blank_cw_page_pre_sml0_impl;
alter function public.soft_delete_cw_page(uuid)
  rename to soft_delete_cw_page_pre_sml0_impl;
alter function public.revert_cw_page_revision(uuid, uuid, integer, text)
  rename to revert_cw_page_revision_pre_sml0_impl;
alter function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text)
  rename to save_cw_track_page_draft_pre_sml0_impl;
alter function public.revert_cw_track_page_revision(uuid, text, uuid, integer, text)
  rename to revert_cw_track_page_revision_pre_sml0_impl;
alter function public.set_cw_page_learning_check_flag(uuid, text, boolean)
  rename to set_cw_page_learning_check_flag_pre_sml0_impl;

revoke all on function public.reorder_cw_pages_pre_sml0_impl(uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.copy_cw_page_pre_sml0_impl(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.create_blank_cw_page_pre_sml0_impl(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.soft_delete_cw_page_pre_sml0_impl(uuid)
  from public, anon, authenticated;
revoke all on function public.revert_cw_page_revision_pre_sml0_impl(uuid, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.save_cw_track_page_draft_pre_sml0_impl(uuid, text, jsonb, integer, text)
  from public, anon, authenticated;
revoke all on function public.revert_cw_track_page_revision_pre_sml0_impl(uuid, text, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.set_cw_page_learning_check_flag_pre_sml0_impl(uuid, text, boolean)
  from public, anon, authenticated;

create function public.reorder_cw_pages(p_lecture_id uuid, p_page_ids uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'page.edit');
  perform public.reorder_cw_pages_pre_sml0_impl(p_lecture_id, p_page_ids);
end;
$$;

create function public.copy_cw_page(
  p_source_page_doc_id uuid,
  p_target_lecture_id uuid,
  p_after_page_doc_id uuid default null,
  p_title text default ''
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- copy 写入目标 lecture；源页继续遵守既有 staff 读取策略。
  perform public.assert_cw_lecture_capability(p_target_lecture_id, 'page.edit');
  return public.copy_cw_page_pre_sml0_impl(
    p_source_page_doc_id,
    p_target_lecture_id,
    p_after_page_doc_id,
    p_title
  );
end;
$$;

create function public.create_blank_cw_page(
  p_lecture_id uuid,
  p_after_page_doc_id uuid default null,
  p_title text default ''
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'page.edit');
  return public.create_blank_cw_page_pre_sml0_impl(
    p_lecture_id,
    p_after_page_doc_id,
    p_title
  );
end;
$$;

create function public.soft_delete_cw_page(p_page_doc_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  perform public.soft_delete_cw_page_pre_sml0_impl(p_page_doc_id);
end;
$$;

create function public.revert_cw_page_revision(
  p_page_doc_id uuid,
  p_revision_id uuid,
  p_base_revision_no integer,
  p_note text default ''
)
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  return query
  select result.revision_id, result.revision_no
  from public.revert_cw_page_revision_pre_sml0_impl(
    p_page_doc_id,
    p_revision_id,
    p_base_revision_no,
    p_note
  ) result;
end;
$$;

create function public.save_cw_track_page_draft(
  p_page_doc_id uuid,
  p_track text,
  p_doc jsonb,
  p_base_revision_no integer,
  p_note text default ''
)
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  return query
  select result.revision_id, result.revision_no
  from public.save_cw_track_page_draft_pre_sml0_impl(
    p_page_doc_id,
    p_track,
    p_doc,
    p_base_revision_no,
    p_note
  ) result;
end;
$$;

create function public.revert_cw_track_page_revision(
  p_page_doc_id uuid,
  p_track text,
  p_revision_id uuid,
  p_base_revision_no integer,
  p_note text default ''
)
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  return query
  select result.revision_id, result.revision_no
  from public.revert_cw_track_page_revision_pre_sml0_impl(
    p_page_doc_id,
    p_track,
    p_revision_id,
    p_base_revision_no,
    p_note
  ) result;
end;
$$;

create function public.set_cw_page_learning_check_flag(
  p_page_doc_id uuid,
  p_track text,
  p_enabled boolean
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  perform public.set_cw_page_learning_check_flag_pre_sml0_impl(
    p_page_doc_id,
    p_track,
    p_enabled
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 提交 / 撤回 / 通过 / 退回评审
-- ---------------------------------------------------------------------------

alter function public.submit_cw_review(uuid, text, text)
  rename to submit_cw_review_pre_sml0_impl;
alter function public.withdraw_cw_review(uuid)
  rename to withdraw_cw_review_pre_sml0_impl;
alter function public.approve_cw_review(uuid, text, integer[])
  rename to approve_cw_review_pre_sml0_impl;
alter function public.reject_cw_review(uuid, text, integer[])
  rename to reject_cw_review_pre_sml0_impl;
alter function public.review_cw_adapt_page(uuid, text, text)
  rename to review_cw_adapt_page_pre_sml0_impl;

revoke all on function public.submit_cw_review_pre_sml0_impl(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.withdraw_cw_review_pre_sml0_impl(uuid)
  from public, anon, authenticated;
revoke all on function public.approve_cw_review_pre_sml0_impl(uuid, text, integer[])
  from public, anon, authenticated;
revoke all on function public.reject_cw_review_pre_sml0_impl(uuid, text, integer[])
  from public, anon, authenticated;
revoke all on function public.review_cw_adapt_page_pre_sml0_impl(uuid, text, text)
  from public, anon, authenticated;

-- 旧 adapt review 把“编辑 permission”混进了写入本体；外层现在以
-- review.decide 作为唯一授权，因此内部实现只保留输入与状态写入规则。
create or replace function public.review_cw_adapt_page_pre_sml0_impl(
  p_page_doc_id uuid,
  p_status text,
  p_note text default ''
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare reviewer_id uuid := auth.uid();
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'INVALID_REVIEW_STATUS';
  end if;

  update public.cw_adapt_reviews
  set status = p_status,
      reviewed_by = reviewer_id,
      reviewed_at = now(),
      note = left(trim(coalesce(p_note, '')), 1000)
  where page_doc_id = p_page_doc_id;

  if not found then raise exception 'ADAPT_REVIEW_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.review_cw_adapt_page_pre_sml0_impl(uuid, text, text)
  from public, anon, authenticated;

create function public.submit_cw_review(
  p_lecture_id uuid,
  p_track text,
  p_note text default ''
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'review.submit');
  return public.submit_cw_review_pre_sml0_impl(p_lecture_id, p_track, p_note);
end;
$$;

create function public.withdraw_cw_review(p_review_cycle_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_review_cycle_capability(p_review_cycle_id, 'review.submit');
  perform public.withdraw_cw_review_pre_sml0_impl(p_review_cycle_id);
end;
$$;

create function public.approve_cw_review(
  p_review_cycle_id uuid,
  p_note text default '',
  p_reviewed_pages integer[] default null
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_review_cycle_capability(p_review_cycle_id, 'review.decide');
  return public.approve_cw_review_pre_sml0_impl(
    p_review_cycle_id,
    p_note,
    p_reviewed_pages
  );
end;
$$;

create function public.reject_cw_review(
  p_review_cycle_id uuid,
  p_note text,
  p_reviewed_pages integer[] default null
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_review_cycle_capability(p_review_cycle_id, 'review.decide');
  perform public.reject_cw_review_pre_sml0_impl(
    p_review_cycle_id,
    p_note,
    p_reviewed_pages
  );
end;
$$;

create function public.review_cw_adapt_page(
  p_page_doc_id uuid,
  p_status text,
  p_note text default ''
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'review.decide');
  perform public.review_cw_adapt_page_pre_sml0_impl(
    p_page_doc_id,
    p_status,
    p_note
  );
end;
$$;

-- 原公开 API 保持原签名；只有 capability 包装层可由 authenticated 调用。
revoke all on function public.reorder_cw_pages(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.copy_cw_page(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_blank_cw_page(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.soft_delete_cw_page(uuid) from public, anon, authenticated;
revoke all on function public.revert_cw_page_revision(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.revert_cw_track_page_revision(uuid, text, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.set_cw_page_learning_check_flag(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.submit_cw_review(uuid, text, text) from public, anon, authenticated;
revoke all on function public.withdraw_cw_review(uuid) from public, anon, authenticated;
revoke all on function public.approve_cw_review(uuid, text, integer[]) from public, anon, authenticated;
revoke all on function public.reject_cw_review(uuid, text, integer[]) from public, anon, authenticated;
revoke all on function public.review_cw_adapt_page(uuid, text, text) from public, anon, authenticated;

grant execute on function public.reorder_cw_pages(uuid, uuid[]) to authenticated;
grant execute on function public.copy_cw_page(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.create_blank_cw_page(uuid, uuid, text) to authenticated;
grant execute on function public.soft_delete_cw_page(uuid) to authenticated;
grant execute on function public.revert_cw_page_revision(uuid, uuid, integer, text) to authenticated;
grant execute on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text) to authenticated;
grant execute on function public.revert_cw_track_page_revision(uuid, text, uuid, integer, text) to authenticated;
grant execute on function public.set_cw_page_learning_check_flag(uuid, text, boolean) to authenticated;
grant execute on function public.submit_cw_review(uuid, text, text) to authenticated;
grant execute on function public.withdraw_cw_review(uuid) to authenticated;
grant execute on function public.approve_cw_review(uuid, text, integer[]) to authenticated;
grant execute on function public.reject_cw_review(uuid, text, integer[]) to authenticated;
grant execute on function public.review_cw_adapt_page(uuid, text, text) to authenticated;

comment on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text) is
  'SML-0 capability 包装：page.edit × lecture responsibility/state；revision 规则仍由既有实现校验。';
comment on function public.submit_cw_review(uuid, text, text) is
  'SML-0 capability 包装：review.submit × lecture responsibility/state；workflow 状态机保持不变。';
comment on function public.approve_cw_review(uuid, text, integer[]) is
  'SML-0 capability 包装：review.decide × lecture responsibility/state；review cycle 状态机保持不变。';

commit;
