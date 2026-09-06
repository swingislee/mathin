-- 历史业务记录使用现有 Student 身份，作为续费、活动、测评、报名与沟通的历史事实。
-- 允许历史资料缺少当前流程要求的班级、场次、日期与作者；当前运营表和写入合同保持原有行为。
-- 本批为本机管理员验收入口。历史查询按业务类型读取列，来源记录只承担追溯。
create unique index history_import_records_student_source_key on public.history_import_records(id,student_id);

create table public.student_renewal_history (
  id text primary key,
  student_id uuid not null references public.students(id) on delete restrict,
  import_batch_id uuid not null references public.history_import_batches(id) on delete restrict,
  source_record_id text not null,
  source_field_ids text[] not null check (cardinality(source_field_ids)>0),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now(),
  foreign key (source_record_id,student_id) references public.history_import_records(id,student_id) on delete restrict,
period_year integer check (period_year between 1900 and 2200),
  period_key text not null check (period_key in ('summer','autumn')),
  decision_note text not null,
  outcome text not null default 'unknown' check (outcome in ('unknown','renewed','not_renewed')),
  renewal_cycle_id uuid references public.renewal_cycles(id) on delete restrict,
  class_label text not null default '',
  teacher_label text not null default ''
);
create index student_renewal_history_student_idx on public.student_renewal_history(student_id);
alter table public.student_renewal_history enable row level security;
create policy student_renewal_history_admin_read on public.student_renewal_history
  for select to authenticated using (public.is_admin((select auth.uid())));
revoke all on public.student_renewal_history from anon, authenticated, service_role;
grant select on public.student_renewal_history to authenticated;

create table public.student_activity_history (
  id text primary key,
  student_id uuid not null references public.students(id) on delete restrict,
  import_batch_id uuid not null references public.history_import_batches(id) on delete restrict,
  source_record_id text not null,
  source_field_ids text[] not null check (cardinality(source_field_ids)>0),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now(),
  foreign key (source_record_id,student_id) references public.history_import_records(id,student_id) on delete restrict,
activity_name text not null,
  activity_kind text not null check (activity_kind in ('competition','assessment_1v1','trial_class','public_class','lecture','sanbanfu')),
  activity_id uuid references public.activities(id) on delete restrict,
  registered_on date,
  occurred_on date,
  participation_status text not null check (participation_status in ('registered','attended','no_show','unknown')),
  reported_result text not null default '',
  result_link_status text not null default 'none' check (result_link_status in ('none','edition_unconfirmed','confirmed')),
  result_source_record_id text,
  result_field_ids text[] not null default '{}',
  foreign key (result_source_record_id,student_id) references public.history_import_records(id,student_id) on delete restrict,
  check ((result_link_status='none' and reported_result='' and result_source_record_id is null)
    or (result_link_status<>'none' and btrim(reported_result)<>'' and result_source_record_id is not null and cardinality(result_field_ids)>0))
);
create index student_activity_history_student_idx on public.student_activity_history(student_id);
alter table public.student_activity_history enable row level security;
create policy student_activity_history_admin_read on public.student_activity_history
  for select to authenticated using (public.is_admin((select auth.uid())));
revoke all on public.student_activity_history from anon, authenticated, service_role;
grant select on public.student_activity_history to authenticated;

create table public.student_assessment_history (
  id text primary key,
  student_id uuid not null references public.students(id) on delete restrict,
  import_batch_id uuid not null references public.history_import_batches(id) on delete restrict,
  source_record_id text not null,
  source_field_ids text[] not null check (cardinality(source_field_ids)>0),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now(),
  foreign key (source_record_id,student_id) references public.history_import_records(id,student_id) on delete restrict,
assessed_on date,
  assessment_band text not null,
  score numeric check (score between 0 and 100),
  learning_notes text not null default '',
  parent_notes text not null default '',
  activity_registration_id uuid references public.activity_registrations(id) on delete restrict
);
create index student_assessment_history_student_idx on public.student_assessment_history(student_id);
alter table public.student_assessment_history enable row level security;
create policy student_assessment_history_admin_read on public.student_assessment_history
  for select to authenticated using (public.is_admin((select auth.uid())));
revoke all on public.student_assessment_history from anon, authenticated, service_role;
grant select on public.student_assessment_history to authenticated;

create table public.student_enrollment_history (
  id text primary key,
  student_id uuid not null references public.students(id) on delete restrict,
  import_batch_id uuid not null references public.history_import_batches(id) on delete restrict,
  source_record_id text not null,
  source_field_ids text[] not null check (cardinality(source_field_ids)>0),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now(),
  foreign key (source_record_id,student_id) references public.history_import_records(id,student_id) on delete restrict,
registered_on date,
  period_label text not null,
  amount numeric(14,2) check (amount>=0),
  amount_original text not null default '',
  class_label text not null default '',
  teacher_label text not null default '',
  room_label text not null default '',
  schedule_label text not null default '',
  course_enrollment_id uuid references public.course_enrollments(id) on delete restrict
);
create index student_enrollment_history_student_idx on public.student_enrollment_history(student_id);
alter table public.student_enrollment_history enable row level security;
create policy student_enrollment_history_admin_read on public.student_enrollment_history
  for select to authenticated using (public.is_admin((select auth.uid())));
revoke all on public.student_enrollment_history from anon, authenticated, service_role;
grant select on public.student_enrollment_history to authenticated;

create table public.student_communication_history (
  id text primary key,
  student_id uuid not null references public.students(id) on delete restrict,
  import_batch_id uuid not null references public.history_import_batches(id) on delete restrict,
  source_record_id text not null,
  source_field_ids text[] not null check (cardinality(source_field_ids)>0),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now(),
  foreign key (source_record_id,student_id) references public.history_import_records(id,student_id) on delete restrict,
occurred_on date,
  context_kind text not null check (context_kind in ('renewal','assessment')),
  content text not null check (btrim(content)<>''),
  author_label text,
  date_basis text not null default 'unknown' check (date_basis in ('unknown','source_explicit'))
);
create index student_communication_history_student_idx on public.student_communication_history(student_id);
alter table public.student_communication_history enable row level security;
create policy student_communication_history_admin_read on public.student_communication_history
  for select to authenticated using (public.is_admin((select auth.uid())));
revoke all on public.student_communication_history from anon, authenticated, service_role;
grant select on public.student_communication_history to authenticated;
