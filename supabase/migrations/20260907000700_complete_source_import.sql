-- 完整来源包括原文件、空表和空行；身份疑点随记录保存，业务使用时校准。
create table public.history_import_files (
  sha256 text primary key check(sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint not null check(bytes >= 0),
  content bytea not null,
  imported_at timestamptz not null default now(),
  check(octet_length(content) = bytes),
  check(encode(extensions.digest(content, 'sha256'), 'hex') = sha256)
);
create table public.history_import_batch_files (
  batch_id uuid not null references public.history_import_batches(id) on delete restrict,
  source_path text not null,
  file_sha256 text not null references public.history_import_files(sha256) on delete restrict,
  metadata jsonb not null check(jsonb_typeof(metadata) = 'object'),
  primary key(batch_id, source_path)
);
alter table public.history_import_files enable row level security;
alter table public.history_import_batch_files enable row level security;
create policy history_import_files_admin_read on public.history_import_files for select to authenticated using(public.is_admin(auth.uid()));
create policy history_import_batch_files_admin_read on public.history_import_batch_files for select to authenticated using(public.is_admin(auth.uid()));
revoke all on public.history_import_files, public.history_import_batch_files from public, anon, authenticated, service_role;
grant select(sha256, bytes, imported_at) on public.history_import_files to authenticated;
grant select on public.history_import_batch_files to authenticated;
create index history_import_records_table_page_idx on public.history_import_records(source_table_id,id);
create index history_import_records_match_page_idx on public.history_import_records(match_status,id);
comment on table public.history_import_files is '按 SHA-256 保留导入原文件字节，包含原始字段定义、公式、样式及空表。';
comment on table public.history_import_batch_files is '批次覆盖每个文件路径；同字节导出复用文件内容，仍分别保留来源位置与表结构。';
