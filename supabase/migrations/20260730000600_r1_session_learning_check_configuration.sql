-- Persist whether a teacher has explicitly configured the per-session learning-check list.
-- A configured empty list must not be mistaken for an uninitialized list of release defaults.

alter table public.class_sessions
  add column if not exists learning_checks_configured_at timestamptz;

update public.class_sessions session_row
   set learning_checks_configured_at = coalesce(session_row.learning_checks_configured_at, now())
 where exists (
   select 1
     from public.session_learning_checks check_row
    where check_row.session_id = session_row.id
 );

comment on column public.class_sessions.learning_checks_configured_at is
  'Set when the teacher first changes this session learning-check list, including an explicit empty list.';

create or replace function public.replace_session_learning_checks(p_session_id uuid,p_titles jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  uid uuid:=auth.uid();
  session_row public.class_sessions%rowtype;
  item jsonb;
  title_value text;
  source_page uuid;
  item_index integer:=0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into session_row from public.class_sessions where id=p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id,uid) then raise exception 'FORBIDDEN'; end if;
  if session_row.started_at is not null then raise exception 'SESSION_ALREADY_STARTED'; end if;
  if jsonb_typeof(p_titles)<>'array' or jsonb_array_length(p_titles)>30 then raise exception 'VALIDATION'; end if;

  for item in select value from jsonb_array_elements(p_titles)
  loop
    if jsonb_typeof(item)='string' then
      title_value:=btrim(item #>> '{}');
      source_page:=null;
    elsif jsonb_typeof(item)='object' then
      title_value:=btrim(coalesce(item->>'title',''));
      begin source_page:=nullif(item->>'sourcePageId','')::uuid;
      exception when invalid_text_representation then raise exception 'VALIDATION'; end;
    else
      raise exception 'VALIDATION';
    end if;
    if length(title_value) not between 1 and 100 then raise exception 'VALIDATION'; end if;
    if source_page is not null and not exists (
      select 1 from public.cw_page_docs page
       where page.id=source_page and page.lecture_id=session_row.lecture_id and page.deleted_at is null
    ) then raise exception 'VALIDATION'; end if;
  end loop;

  if exists (
    select 1 from (
      select nullif(value->>'sourcePageId','') source_id,count(*)
        from jsonb_array_elements(p_titles)
       where jsonb_typeof(value)='object' and nullif(value->>'sourcePageId','') is not null
       group by 1 having count(*)>1
    ) duplicate
  ) then raise exception 'VALIDATION'; end if;

  delete from public.session_learning_checks where session_id=p_session_id;
  for item in select value from jsonb_array_elements(p_titles)
  loop
    if jsonb_typeof(item)='string' then
      title_value:=btrim(item #>> '{}'); source_page:=null;
    else
      title_value:=btrim(item->>'title'); source_page:=nullif(item->>'sourcePageId','')::uuid;
    end if;
    insert into public.session_learning_checks(session_id,position,title,source_page_doc_id,created_by)
    values(p_session_id,item_index,title_value,source_page,uid);
    item_index:=item_index+1;
  end loop;

  update public.class_sessions
     set learning_checks_configured_at=coalesce(learning_checks_configured_at,now())
   where id=p_session_id;
end
$$;

revoke all on function public.replace_session_learning_checks(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_session_learning_checks(uuid,jsonb) to authenticated;
