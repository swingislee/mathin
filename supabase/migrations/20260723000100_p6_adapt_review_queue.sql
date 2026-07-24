-- P6：4:3 背景人工审校队列支持分页内的原子批量决策与页级分类覆写。
-- 每一项仍必须处于 pending；并发审校导致任一项已处理时整批回滚，避免半提交。
create or replace function public.review_cw_adapt_backgrounds(
  p_adaptation_ids uuid[],
  p_approve boolean,
  p_note text default ''
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  requested_count integer;
  reviewed_count integer;
begin
  if uid is null or not public.has_perm(uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  requested_count := coalesce(cardinality(p_adaptation_ids), 0);
  if requested_count < 1 or requested_count > 100
     or (select count(distinct item) from unnest(p_adaptation_ids) as item) <> requested_count then
    raise exception 'INVALID_ADAPT_BACKGROUND_SELECTION';
  end if;

  update public.cw_adapt_backgrounds
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = uid,
         reviewed_at = now(),
         note = left(trim(coalesce(p_note, '')), 1000)
   where id = any(p_adaptation_ids) and status = 'pending';
  get diagnostics reviewed_count = row_count;
  if reviewed_count <> requested_count then raise exception 'ADAPT_BACKGROUND_NOT_PENDING'; end if;
  return reviewed_count;
end;
$$;

create or replace function public.set_cw_adapt_page_classification(
  p_page_doc_id uuid,
  p_classification text,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'courseware.page.edit') then raise exception 'FORBIDDEN'; end if;
  if p_classification not in ('A', 'B', 'C', 'D', 'E', 'F') then raise exception 'INVALID_ADAPT_CLASSIFICATION'; end if;

  perform 1 from public.cw_page_docs where id = p_page_doc_id and deleted_at is null for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;

  -- 分类覆写只改变审校元数据与待办状态，绝不在未审校时覆盖现有 4:3 草稿或 release。
  -- 教研随后通过可视化编辑器调整该页的 adapted-4x3 草稿，再按正常流程提交/发布。
  update public.cw_page_docs set adapt_class = p_classification where id = p_page_doc_id;
  insert into public.cw_adapt_reviews(page_doc_id, classification, report, status, reviewed_by, reviewed_at, note)
  values (p_page_doc_id, p_classification, jsonb_build_object('source', 'manual-classification'), 'pending', null, null, left(trim(coalesce(p_note, '')), 1000))
  on conflict (page_doc_id) do update set
    classification = excluded.classification,
    status = 'pending',
    reviewed_by = null,
    reviewed_at = null,
    note = excluded.note;
end;
$$;

revoke all on function public.review_cw_adapt_backgrounds(uuid[], boolean, text) from public, anon;
grant execute on function public.review_cw_adapt_backgrounds(uuid[], boolean, text) to authenticated;
revoke all on function public.set_cw_adapt_page_classification(uuid, text, text) from public, anon;
grant execute on function public.set_cw_adapt_page_classification(uuid, text, text) to authenticated;
