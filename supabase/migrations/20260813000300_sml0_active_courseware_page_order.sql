-- SML-0：课件页顺序只约束仍在使用的页面。
--
-- cw_page_docs 最初同时建立了全表 UNIQUE(lecture_id, page_no) 与 active-page
-- 索引。软删除保留 page_no，导致讲次清空后再次插页，或在被删除位置插页时，
-- 会和历史行冲突。稳定 page identity 与 revision 仍由 UUID 追溯；页面顺序只属于
-- 当前未删除集合。这里用生成列把已删除页映射为 NULL，再以可延迟唯一约束
-- 保留重排 RPC 的事务语义；partial index 只负责活动页的读取顺序。

alter table public.cw_page_docs
  drop constraint if exists cw_page_docs_lecture_id_page_no_key;

drop index if exists public.cw_page_docs_lecture_page_idx;

create index cw_page_docs_lecture_page_idx
  on public.cw_page_docs (lecture_id, page_no)
  where deleted_at is null;

alter table public.cw_page_docs
  add column if not exists active_page_no integer
  generated always as (
    case when deleted_at is null then page_no else null end
  ) stored;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.cw_page_docs'::regclass
      and conname = 'cw_page_docs_active_lecture_page_key'
  ) then
    alter table public.cw_page_docs
      add constraint cw_page_docs_active_lecture_page_key
      unique (lecture_id, active_page_no)
      deferrable initially deferred;
  end if;
end;
$$;

comment on column public.cw_page_docs.active_page_no is
  'Generated active ordering key. Deleted page identities retain page_no but project NULL here.';

comment on constraint cw_page_docs_active_lecture_page_key on public.cw_page_docs is
  'Current page numbers are unique and deferrable per lecture; deleted identities do not reserve an active position.';
