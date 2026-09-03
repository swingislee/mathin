-- Shared workbench page rail: controlled inline title rename for formal courseware.

create or replace function public.rename_cw_page(
  p_page_doc_id uuid,
  p_title text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lecture_value uuid;
  title_value text := trim(coalesce(p_title, ''));
begin
  if p_page_doc_id is null or title_value = '' or length(title_value) > 500 then
    raise exception 'VALIDATION';
  end if;

  select page.lecture_id into lecture_value
  from public.cw_page_docs page
  where page.id = p_page_doc_id
    and page.deleted_at is null
  for update;

  if not found then raise exception 'PAGE_NOT_FOUND'; end if;

  perform public.assert_cw_lecture_capability(lecture_value, 'page.edit');

  update public.cw_page_docs
  set title = title_value
  where id = p_page_doc_id;
end;
$$;

comment on function public.rename_cw_page(uuid, text) is
  'Rename one active courseware page after the unified lecture page.edit capability succeeds.';

revoke all on function public.rename_cw_page(uuid, text) from public, anon, authenticated;
grant execute on function public.rename_cw_page(uuid, text) to authenticated;
