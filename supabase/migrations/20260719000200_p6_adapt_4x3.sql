-- P6-6：4:3 增强轨的分类、背景人工确认闸门与发布保护。
alter table public.cw_page_docs
  add column if not exists adapt_class text check (adapt_class is null or adapt_class in ('A','B','C','D','E')),
  add column if not exists adapt_reason text not null default '' check (length(adapt_reason) <= 500);

create index if not exists cw_page_docs_adapt_class_idx
  on public.cw_page_docs (adapt_class, lecture_id) where deleted_at is null;

create table if not exists public.cw_adapt_backgrounds (
  id uuid primary key default gen_random_uuid(),
  source_asset_revision_id uuid not null references public.cw_asset_revisions(id),
  derived_asset_revision_id uuid not null unique references public.cw_asset_revisions(id),
  crop_x int not null default 0 check (crop_x >= 0),
  crop_y int not null default 0 check (crop_y >= 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  note text not null default '' check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  check ((status = 'pending' and reviewed_at is null) or (status <> 'pending' and reviewed_at is not null))
);
alter table public.cw_adapt_backgrounds enable row level security;
drop policy if exists "cw_adapt_backgrounds_select_staff" on public.cw_adapt_backgrounds;
create policy "cw_adapt_backgrounds_select_staff" on public.cw_adapt_backgrounds
  for select to authenticated using (public.is_staff(auth.uid()));
revoke all on public.cw_adapt_backgrounds from anon, authenticated;
grant select on public.cw_adapt_backgrounds to authenticated;

create or replace function public.review_cw_adapt_background(p_adaptation_id uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  update public.cw_adapt_backgrounds
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = uid, reviewed_at = now(), note = left(trim(coalesce(p_note, '')), 1000)
   where id = p_adaptation_id and status = 'pending';
  if not found then raise exception 'ADAPT_BACKGROUND_NOT_PENDING'; end if;
end;
$$;
revoke all on function public.review_cw_adapt_background(uuid, boolean, text) from public, anon;
grant execute on function public.review_cw_adapt_background(uuid, boolean, text) to authenticated;

-- 自动派生页仅可在其所有 4:3 背景经人工确认后进入 release。
create or replace function public.assert_cw_adapt_release_ready() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1
      from jsonb_array_elements(new.snapshot) page_item
      join public.cw_page_revisions page_revision on page_revision.id = (page_item ->> 'revisionId')::uuid
      cross join lateral jsonb_array_elements(page_item -> 'bindings') binding_item
      join public.cw_page_asset_bindings binding on binding.page_doc_id = page_revision.page_doc_id
          and binding.binding_key = binding_item ->> 'bindingKey'
      join public.cw_asset_revisions asset_revision on asset_revision.id = (binding_item ->> 'assetRevisionId')::uuid
      left join public.cw_adapt_backgrounds adaptation on adaptation.derived_asset_revision_id = asset_revision.id
     where page_revision.origin = 'adapt-4x3'
       and binding.role = 'background'
       and asset_revision.variant = 'mathin-4x3'
       and coalesce(adaptation.status, 'pending') <> 'approved'
  ) then raise exception 'ADAPT_BACKGROUND_REVIEW_REQUIRED'; end if;
  return new;
end;
$$;
drop trigger if exists cw_lecture_releases_adapt_review_guard on public.cw_lecture_releases;
create trigger cw_lecture_releases_adapt_review_guard
  before insert on public.cw_lecture_releases
  for each row execute function public.assert_cw_adapt_release_ready();
