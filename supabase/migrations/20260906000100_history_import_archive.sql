-- 历史原文与当前运营事项分别存储；导入档案只建立来源和已有身份的关联。
create table public.history_import_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique check (char_length(batch_key) between 1 and 120),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  work_scope text not null default 'history_only' check (work_scope = 'history_only'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  verification jsonb not null default '{}'::jsonb check (jsonb_typeof(verification) = 'object'),
  imported_at timestamptz not null default now()
);

create table public.history_import_records (
  id text primary key check (char_length(id) between 1 and 160),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_table_id text not null,
  source_record_id text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  source_data jsonb not null check (jsonb_typeof(source_data) = 'object'),
  record_data jsonb not null check (jsonb_typeof(record_data) = 'object'),
  match_status text not null check (match_status in ('matched', 'review', 'unmatched')),
  match_data jsonb not null check (jsonb_typeof(match_data) = 'object'),
  entity_data jsonb,
  candidate_data jsonb not null default '[]'::jsonb check (jsonb_typeof(candidate_data) = 'array'),
  student_id uuid references public.students(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete restrict,
  search_text text not null,
  imported_at timestamptz not null default now(),
  unique (source_sha256, source_table_id, source_record_id),
  check (
    (match_status = 'matched' and num_nonnulls(student_id, lead_id) = 1 and entity_data is not null)
    or (match_status <> 'matched' and student_id is null and lead_id is null and entity_data is null)
  )
);

create index history_import_records_student_idx on public.history_import_records(student_id) where student_id is not null;
create index history_import_records_lead_idx on public.history_import_records(lead_id) where lead_id is not null;

create table public.history_import_batch_records (
  batch_id uuid not null references public.history_import_batches(id) on delete restrict,
  record_id text not null references public.history_import_records(id) on delete restrict,
  case_key text not null,
  primary key (batch_id, record_id)
);
create index history_import_batch_records_case_idx on public.history_import_batch_records(batch_id, case_key);

alter table public.history_import_batches enable row level security;
alter table public.history_import_records enable row level security;
alter table public.history_import_batch_records enable row level security;

create policy history_import_batches_admin_read on public.history_import_batches
  for select to authenticated using (public.is_admin(auth.uid()));
create policy history_import_records_admin_read on public.history_import_records
  for select to authenticated using (public.is_admin(auth.uid()));
create policy history_import_batch_records_admin_read on public.history_import_batch_records
  for select to authenticated using (public.is_admin(auth.uid()));

-- 写入由核对过目标的导入程序执行；普通会话只提供管理员查询。
revoke all on public.history_import_batches, public.history_import_records, public.history_import_batch_records
  from public, anon, authenticated, service_role;
grant select on public.history_import_batches, public.history_import_records, public.history_import_batch_records to authenticated;

comment on table public.history_import_records is
  '原始历史资料。来源日期与原作者保留在 record_data；imported_at 仅表示入库时间。关联身份不创建当前线索、报名、续费或待办。';
