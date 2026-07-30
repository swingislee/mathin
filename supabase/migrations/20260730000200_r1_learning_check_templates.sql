-- R1 reusable teacher-owned templates for in-class learning checks.

begin;

create table if not exists public.learning_check_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_check_templates_name_cap check (length(btrim(name)) between 1 and 100),
  constraint learning_check_templates_items_cap check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 30 and octet_length(items::text) <= 16384
  )
);

create index if not exists learning_check_templates_owner_idx
  on public.learning_check_templates(owner_id, updated_at desc);

drop trigger if exists learning_check_templates_set_updated_at on public.learning_check_templates;
create trigger learning_check_templates_set_updated_at
before update on public.learning_check_templates
for each row execute function public.set_updated_at();

alter table public.learning_check_templates enable row level security;

drop policy if exists learning_check_templates_select_own on public.learning_check_templates;
create policy learning_check_templates_select_own on public.learning_check_templates
for select to authenticated using(owner_id = (select auth.uid()));

revoke all on table public.learning_check_templates from anon, authenticated;
grant select on table public.learning_check_templates to authenticated;

create or replace function public.save_learning_check_template(p_name text, p_titles jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); template_id uuid; title_value text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or jsonb_typeof(p_titles) <> 'array'
     or jsonb_array_length(p_titles) not between 1 and 30 then
    raise exception 'VALIDATION';
  end if;
  for title_value in select value from jsonb_array_elements_text(p_titles)
  loop
    if length(btrim(title_value)) not between 1 and 100 then raise exception 'VALIDATION'; end if;
  end loop;
  insert into public.learning_check_templates(owner_id, name, items)
  values(uid, left(btrim(p_name), 100), p_titles)
  returning id into template_id;
  return template_id;
end
$$;

create or replace function public.apply_learning_check_template(p_session_id uuid, p_template_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); template_items jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select items into template_items from public.learning_check_templates
   where id = p_template_id and owner_id = uid;
  if template_items is null then raise exception 'TEMPLATE_NOT_FOUND'; end if;
  perform public.replace_session_learning_checks(p_session_id, template_items);
end
$$;

create or replace function public.delete_learning_check_template(p_template_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  delete from public.learning_check_templates where id = p_template_id and owner_id = auth.uid();
  if not found then raise exception 'TEMPLATE_NOT_FOUND'; end if;
end
$$;

revoke all on function public.save_learning_check_template(text, jsonb) from public, anon, authenticated;
revoke all on function public.apply_learning_check_template(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_learning_check_template(uuid) from public, anon, authenticated;
grant execute on function public.save_learning_check_template(text, jsonb) to authenticated;
grant execute on function public.apply_learning_check_template(uuid, uuid) to authenticated;
grant execute on function public.delete_learning_check_template(uuid) to authenticated;

commit;
