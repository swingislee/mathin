-- 来源包身份保持稳定；每次接收的 manifest 与单讲内容指纹独立留存。
create table public.cw_source_package_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_package_id uuid not null references public.cw_source_packages(id) on delete restrict,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  document_adapter text not null,
  labels jsonb not null,
  scope jsonb not null,
  counts jsonb not null,
  manifest jsonb,
  created_at timestamptz not null default now(),
  unique(source_package_id, manifest_sha256)
);
insert into public.cw_source_package_snapshots(source_package_id,manifest_sha256,document_adapter,labels,scope,counts)
select id,manifest_sha256,document_adapter,labels,scope,counts from public.cw_source_packages;

create table public.cw_source_lecture_imports (
  source_lecture_id uuid primary key references public.cw_source_lectures(id) on delete restrict,
  source_snapshot_id uuid not null references public.cw_source_package_snapshots(id) on delete restrict,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  native_release_id uuid not null references public.cw_lecture_releases(id) on delete restrict,
  adapted_release_id uuid not null references public.cw_lecture_releases(id) on delete restrict,
  created_at timestamptz not null default now()
);

create function public.cw_source_import_immutable() returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'CW_SOURCE_IMPORT_IMMUTABLE';
end;
$$;
create trigger cw_source_package_snapshots_immutable before update or delete on public.cw_source_package_snapshots
for each row execute function public.cw_source_import_immutable();
create trigger cw_source_lecture_imports_immutable before update or delete on public.cw_source_lecture_imports
for each row execute function public.cw_source_import_immutable();

alter table public.cw_source_package_snapshots enable row level security;
alter table public.cw_source_lecture_imports enable row level security;
create policy cw_source_package_snapshots_select_staff on public.cw_source_package_snapshots
for select to authenticated using (public.is_staff((select auth.uid())));
create policy cw_source_lecture_imports_select_staff on public.cw_source_lecture_imports
for select to authenticated using (public.is_staff((select auth.uid())));
revoke all on public.cw_source_package_snapshots, public.cw_source_lecture_imports from anon, authenticated;
grant select on public.cw_source_package_snapshots, public.cw_source_lecture_imports to authenticated;
revoke all on function public.cw_source_import_immutable() from public, anon, authenticated;
