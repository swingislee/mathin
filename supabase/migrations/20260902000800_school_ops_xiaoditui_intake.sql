-- SCHOOL-OPS-LEADS-1: 小地推 XLSX 只进入 Leads 线索种子池。
--
-- 这条边界是刻意的：导入不会创建 family/contact/student，也不会创建
-- activity registration、opportunity、order 或 enrollment。学生身份只能在
-- 后续电话确认环节显式建立或关联。

-- ---------------------------------------------------------------------------
-- 1. 扩展共享导入账本，保留来源文件的审计元数据。
-- ---------------------------------------------------------------------------

alter table public.data_import_batches
  drop constraint if exists data_import_batches_import_kind_check;
alter table public.data_import_batches
  add constraint data_import_batches_import_kind_check
  check (import_kind in ('students', 'staff', 'leads'));

alter table public.data_import_batches
  drop constraint if exists data_import_batches_total_rows_check;
alter table public.data_import_batches
  add constraint data_import_batches_total_rows_check
  check (total_rows between 1 and 5000);

alter table public.data_import_batches
  drop constraint if exists data_import_batches_inserted_check;
alter table public.data_import_batches
  add constraint data_import_batches_inserted_check
  check (inserted_rows between 0 and total_rows);

alter table public.data_import_rows
  drop constraint if exists data_import_rows_row_no_check;
alter table public.data_import_rows
  add constraint data_import_rows_row_no_check
  check (row_no between 1 and 5000);

alter table public.data_import_rows
  drop constraint if exists data_import_rows_normalized_key_check;
alter table public.data_import_rows
  add constraint data_import_rows_normalized_key_check
  check (length(normalized_key) between 1 and 320);

alter table public.data_import_batches
  add column source_system text,
  add column source_file_name text,
  add column source_file_hash text,
  add column source_sheet_name text,
  add column batch_label text;

alter table public.data_import_batches
  add constraint data_import_batches_source_system_check
    check (source_system is null or length(trim(source_system)) between 1 and 80),
  add constraint data_import_batches_source_file_name_check
    check (source_file_name is null or length(trim(source_file_name)) between 1 and 255),
  add constraint data_import_batches_source_file_hash_check
    check (source_file_hash is null or source_file_hash ~ '^[a-f0-9]{64}$'),
  add constraint data_import_batches_source_sheet_name_check
    check (source_sheet_name is null or length(trim(source_sheet_name)) between 1 and 120),
  add constraint data_import_batches_batch_label_check
    check (batch_label is null or length(trim(batch_label)) between 1 and 160);

-- ---------------------------------------------------------------------------
-- 2. Leads 是未确认身份的种子；来源行和意向选择独立保存。
-- ---------------------------------------------------------------------------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  provisional_student_name text not null
    check (length(trim(provisional_student_name)) between 1 and 100),
  normalized_name text not null
    check (length(normalized_name) between 1 and 100),
  phone text not null check (length(trim(phone)) between 6 and 40),
  phone_normalized text not null
    check (phone_normalized ~ '^[0-9]{6,20}$'),
  grade_hint smallint check (grade_hint is null or grade_hint between 1 and 12),
  grade_text text not null default '' check (length(grade_text) <= 40),
  status text not null default 'unassigned'
    check (status in ('unassigned','uncontacted','contacted','nurture','intent_confirmed','invalid','converted')),
  owner_id uuid references public.profiles(id) on delete set null,
  suggested_student_id uuid references public.students(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  identity_confirmed_by uuid references public.profiles(id) on delete set null,
  identity_confirmed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_exact_seed_unique unique(phone_normalized, normalized_name),
  constraint leads_identity_confirmation_check check (
    (student_id is null and identity_confirmed_by is null and identity_confirmed_at is null and status <> 'converted')
    or (student_id is not null and identity_confirmed_by is not null and identity_confirmed_at is not null)
  )
);

create index leads_pool_idx on public.leads(status, owner_id, created_at desc);
create index leads_phone_idx on public.leads(phone_normalized, created_at desc);
create index leads_suggested_student_idx on public.leads(suggested_student_id)
  where suggested_student_id is not null;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create table public.lead_source_records (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  batch_id uuid not null references public.data_import_batches(id) on delete restrict,
  row_no integer not null check (row_no between 1 and 5000),
  source_system text not null check (length(trim(source_system)) between 1 and 80),
  batch_label text not null check (length(trim(batch_label)) between 1 and 160),
  source_row integer not null check (source_row between 2 and 100000),
  submitted_at timestamptz,
  acquisition_method text not null default '' check (length(acquisition_method) <= 120),
  promoter text not null default '' check (length(promoter) <= 120),
  location_text text not null default '' check (length(location_text) <= 500),
  wechat_nickname text not null default '' check (length(wechat_nickname) <= 100),
  source_marked_duplicate boolean not null default false,
  raw_grade_text text not null default '' check (length(raw_grade_text) <= 40),
  raw_interest_text text not null default '' check (length(raw_interest_text) <= 2000),
  remark text not null default '' check (length(remark) <= 2000),
  order_number text not null default '' check (length(order_number) <= 120),
  payment_status text not null default '' check (length(payment_status) <= 80),
  payment_at timestamptz,
  created_at timestamptz not null default now(),
  unique(batch_id, row_no)
);

create index lead_source_records_lead_idx
  on public.lead_source_records(lead_id, submitted_at desc nulls last, created_at desc);
create index lead_source_records_batch_idx
  on public.lead_source_records(batch_id, row_no);

create table public.lead_interest_selections (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  source_record_id uuid not null references public.lead_source_records(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 200),
  normalized_key text not null check (length(normalized_key) between 1 and 200),
  category text not null
    check (category in ('assessment','activity','nurture','product_interest','unknown')),
  created_at timestamptz not null default now(),
  unique(source_record_id, normalized_key)
);

create index lead_interest_selections_lead_idx
  on public.lead_interest_selections(lead_id, category, created_at desc);

create table public.lead_import_row_reviews (
  batch_id uuid not null references public.data_import_batches(id) on delete cascade,
  row_no integer not null check (row_no between 1 and 5000),
  match_kind text not null check (match_kind in (
    'new','existing_seed','existing_student_hint','phone_name_conflict',
    'source_marked_duplicate','same_batch_duplicate'
  )),
  matched_lead_id uuid references public.leads(id) on delete set null,
  suggested_student_id uuid references public.students(id) on delete set null,
  decision text not null check (decision in (
    'auto_create','auto_link','pending','create_new','link_existing','skip'
  )),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  primary key(batch_id, row_no),
  constraint lead_import_row_reviews_decision_audit_check check (
    (decision in ('auto_create','auto_link','pending') and decided_by is null and decided_at is null)
    or (decision in ('create_new','link_existing','skip') and decided_by is not null and decided_at is not null)
  )
);

comment on table public.leads is
  'Unconfirmed lead seeds. Importing a lead never creates or links a student identity.';
comment on column public.leads.suggested_student_id is
  'Read-only match suggestion from intake; not an identity link.';
comment on table public.lead_source_records is
  'Immutable intake facts from a source row; payment/order fields are source claims, not Mathin transactions.';

-- ---------------------------------------------------------------------------
-- 3. 线索池按 followup 权限读取；业务表只允许 RPC 写入。
-- ---------------------------------------------------------------------------

alter table public.leads enable row level security;
alter table public.lead_source_records enable row level security;
alter table public.lead_interest_selections enable row level security;
alter table public.lead_import_row_reviews enable row level security;

create policy leads_select_pool_scope on public.leads
  for select to authenticated using (
    (
      public.has_perm((select auth.uid()), 'followup.view')
      and (
        owner_id is null
        or owner_id = (select auth.uid())
        or public.has_perm((select auth.uid()), 'student.view.all')
      )
    )
    or (
      created_by = (select auth.uid())
      and public.has_perm((select auth.uid()), 'student.import')
    )
  );

create policy lead_source_records_select_lead_scope on public.lead_source_records
  for select to authenticated using (
    exists (select 1 from public.leads lead where lead.id = lead_source_records.lead_id)
  );

create policy lead_interest_selections_select_lead_scope on public.lead_interest_selections
  for select to authenticated using (
    exists (select 1 from public.leads lead where lead.id = lead_interest_selections.lead_id)
  );

create policy lead_import_reviews_select_batch_scope on public.lead_import_row_reviews
  for select to authenticated using (
    exists (
      select 1 from public.data_import_batches batch
      where batch.id = lead_import_row_reviews.batch_id
        and (
          batch.created_by = (select auth.uid())
          or public.has_perm((select auth.uid()), 'audit.view')
        )
    )
  );

revoke all on public.leads, public.lead_source_records,
  public.lead_interest_selections, public.lead_import_row_reviews
  from public, anon, authenticated;
grant select on public.leads, public.lead_source_records,
  public.lead_interest_selections, public.lead_import_row_reviews
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. 规范化、分类与导入结果读取。
-- ---------------------------------------------------------------------------

create or replace function public.normalize_school_ops_phone(p_phone text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') ~ '^86[1-9][0-9]{10}$'
      then substring(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') from 3)
    else regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  end
$$;

create or replace function public.normalize_lead_name(p_name text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', '', 'g'))
$$;

create or replace function public.classify_lead_interest(p_interest text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_interest, '') ~ '(测评|诊断)' then 'assessment'
    when coalesce(p_interest, '') ~ '(公开课|数独|闯关|活动|体验)' then 'activity'
    when coalesce(p_interest, '') ~ '(持续关注|学习资料|资料)' then 'nurture'
    when coalesce(p_interest, '') ~ '(课程|专项课|产品|小灶|思维课|英语课)' then 'product_interest'
    else 'unknown'
  end
$$;

create or replace function public.get_lead_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_rows jsonb;
  v_new_count integer;
  v_matched_count integer;
  v_review_count integer;
  v_skipped_count integer;
  v_applied_count integer;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id;
  if v_batch.id is null or v_batch.import_kind <> 'leads' then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.created_by <> v_uid and not public.has_perm(v_uid, 'audit.view') then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'row', item.row_no,
    'sourceRow', coalesce(nullif(item.payload->>'sourceRow', '')::integer, item.row_no + 1),
    'sourceName', coalesce(item.payload->>'childName', ''),
    'sourcePhone', coalesce(item.payload->>'phone', ''),
    'status', item.row_status,
    'errors', to_jsonb(item.error_codes),
    'targetId', item.target_id,
    'matchKind', review.match_kind,
    'decision', review.decision,
    'matchedLeadId', review.matched_lead_id,
    'matchedLeadName', matched_lead.provisional_student_name,
    'suggestedStudentId', review.suggested_student_id,
    'suggestedStudentName', suggested_student.name
  ) order by item.row_no), '[]'::jsonb)
    into v_rows
    from public.data_import_rows item
    join public.lead_import_row_reviews review
      on review.batch_id = item.batch_id and review.row_no = item.row_no
    left join public.leads matched_lead on matched_lead.id = review.matched_lead_id
    left join public.students suggested_student on suggested_student.id = review.suggested_student_id
   where item.batch_id = v_batch.id;

  select
    count(*) filter (where decision in ('auto_create','create_new')),
    count(*) filter (where decision in ('auto_link','link_existing')),
    count(*) filter (where decision = 'pending'),
    count(*) filter (where decision = 'skip')
    into v_new_count, v_matched_count, v_review_count, v_skipped_count
    from public.lead_import_row_reviews
   where batch_id = v_batch.id;

  select count(*) into v_applied_count
    from public.lead_source_records where batch_id = v_batch.id;

  return jsonb_build_object(
    'batchId', v_batch.id,
    'status', v_batch.status,
    'templateVersion', v_batch.template_version,
    'inputHash', v_batch.input_hash,
    'fileName', v_batch.source_file_name,
    'fileHash', v_batch.source_file_hash,
    'sheetName', v_batch.source_sheet_name,
    'batchLabel', v_batch.batch_label,
    'total', v_batch.total_rows,
    'valid', v_batch.valid_rows,
    'dup', v_batch.duplicate_rows,
    'errorCount', v_batch.error_rows,
    'newCount', v_new_count,
    'matchedCount', v_matched_count,
    'reviewCount', v_review_count,
    'skippedCount', v_skipped_count,
    'created', v_batch.inserted_rows,
    'applied', v_applied_count,
    'expiresAt', v_batch.expires_at,
    'rows', v_rows
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Dry-run：只写导入账本和人工复核建议，不写任何业务身份对象。
-- ---------------------------------------------------------------------------

create or replace function public.preview_lead_import(
  p_template_version text,
  p_rows jsonb,
  p_idempotency_key text,
  p_input_hash text,
  p_source_system text,
  p_source_file_name text,
  p_source_sheet_name text,
  p_batch_label text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch_id uuid;
  v_existing public.data_import_batches%rowtype;
  v_fingerprint text;
  v_item jsonb;
  v_row_no integer;
  v_source_row integer;
  v_name text;
  v_name_key text;
  v_phone text;
  v_phone_key text;
  v_grade smallint;
  v_grade_text text;
  v_interest_text text;
  v_wechat text;
  v_submitted_at_text text;
  v_source_duplicate boolean;
  v_acquisition_method text;
  v_promoter text;
  v_location text;
  v_remark text;
  v_order_number text;
  v_payment_status text;
  v_payment_at_text text;
  v_errors text[];
  v_status text;
  v_match_kind text;
  v_decision text;
  v_matched_lead_id uuid;
  v_suggested_student_id uuid;
  v_valid integer := 0;
  v_duplicate integer := 0;
  v_error integer := 0;
begin
  if v_uid is null or not public.has_perm(v_uid, 'student.import') then raise exception 'FORBIDDEN'; end if;
  if p_template_version is distinct from 'xiaoditui-leads-v1' then raise exception 'INVALID_TEMPLATE'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 200 then raise exception 'INVALID_IDEMPOTENCY'; end if;
  if p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_HASH'; end if;
  if p_source_system is distinct from 'xiaoditui' then raise exception 'INVALID_SOURCE_SYSTEM'; end if;
  if length(trim(coalesce(p_source_file_name, ''))) not between 1 and 255
     or length(trim(coalesce(p_source_sheet_name, ''))) not between 1 and 120
     or length(trim(coalesce(p_batch_label, ''))) not between 1 and 160 then
    raise exception 'INVALID_SOURCE_METADATA';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'INVALID_ROWS';
  end if;

  v_fingerprint := md5(concat_ws(':', p_template_version, p_source_system,
    p_source_file_name, p_source_sheet_name, p_batch_label, p_rows::text));
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':leads:' || trim(p_idempotency_key)));
  select * into v_existing
    from public.data_import_batches
   where created_by = v_uid and import_kind = 'leads' and idempotency_key = trim(p_idempotency_key);
  if v_existing.id is not null then
    if v_existing.input_fingerprint <> v_fingerprint
       or v_existing.input_hash <> p_input_hash
       or v_existing.template_version <> p_template_version then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return public.get_lead_import_batch(v_existing.id);
  end if;

  insert into public.data_import_batches(
    import_kind, template_version, idempotency_key, input_hash, input_fingerprint,
    total_rows, valid_rows, duplicate_rows, error_rows, created_by,
    source_system, source_file_name, source_file_hash, source_sheet_name, batch_label
  ) values (
    'leads', p_template_version, trim(p_idempotency_key), p_input_hash, v_fingerprint,
    jsonb_array_length(p_rows), 0, 0, jsonb_array_length(p_rows), v_uid,
    p_source_system, trim(p_source_file_name), p_input_hash,
    trim(p_source_sheet_name), trim(p_batch_label)
  ) returning id into v_batch_id;

  for v_item, v_row_no in
    select value, ordinality::integer from jsonb_array_elements(p_rows) with ordinality
  loop
    v_errors := '{}';
    v_source_row := v_row_no + 1;
    v_name := '';
    v_phone := '';
    v_grade := null;
    v_grade_text := '';
    v_interest_text := '';
    v_wechat := '';
    v_submitted_at_text := '';
    v_source_duplicate := false;
    v_acquisition_method := '';
    v_promoter := '';
    v_location := '';
    v_remark := '';
    v_order_number := '';
    v_payment_status := '';
    v_payment_at_text := '';
    v_match_kind := 'new';
    v_decision := 'auto_create';
    v_matched_lead_id := null;
    v_suggested_student_id := null;

    if jsonb_typeof(v_item) is distinct from 'object' then
      v_errors := array_append(v_errors, 'MALFORMED_ROW');
    else
      v_name := trim(coalesce(v_item->>'childName', ''));
      v_phone := trim(coalesce(v_item->>'phone', ''));
      v_grade_text := trim(coalesce(v_item->>'gradeText', ''));
      v_interest_text := trim(coalesce(v_item->>'interestText', ''));
      v_wechat := trim(coalesce(v_item->>'wechatNickname', ''));
      v_submitted_at_text := trim(coalesce(v_item->>'submittedAt', ''));
      v_acquisition_method := trim(coalesce(v_item->>'acquisitionMethod', ''));
      v_promoter := trim(coalesce(v_item->>'promoter', ''));
      v_location := trim(coalesce(v_item->>'location', ''));
      v_remark := trim(coalesce(v_item->>'remark', ''));
      v_order_number := trim(coalesce(v_item->>'orderNumber', ''));
      v_payment_status := trim(coalesce(v_item->>'paymentStatus', ''));
      v_payment_at_text := trim(coalesce(v_item->>'paymentAt', ''));

      begin
        if v_item ? 'sourceRow' then v_source_row := (v_item->>'sourceRow')::integer; end if;
      exception when others then v_errors := array_append(v_errors, 'INVALID_SOURCE_ROW'); end;
      begin
        if v_item ? 'grade' and jsonb_typeof(v_item->'grade') <> 'null' then
          v_grade := (v_item->>'grade')::smallint;
        end if;
      exception when others then v_errors := array_append(v_errors, 'INVALID_GRADE'); end;
      begin
        if v_item ? 'sourceDuplicate' then v_source_duplicate := (v_item->>'sourceDuplicate')::boolean; end if;
      exception when others then v_errors := array_append(v_errors, 'INVALID_DUPLICATE_FLAG'); end;

      if v_source_row not between 2 and 100000 then v_errors := array_append(v_errors, 'INVALID_SOURCE_ROW'); end if;
      if v_name = '' then v_errors := array_append(v_errors, 'EMPTY_NAME'); end if;
      if length(v_name) > 100 then v_errors := array_append(v_errors, 'NAME_TOO_LONG'); end if;
      if length(v_phone) > 40 then v_errors := array_append(v_errors, 'PHONE_TOO_LONG'); end if;
      if v_grade is not null and v_grade not between 1 and 12 then v_errors := array_append(v_errors, 'INVALID_GRADE'); end if;
      if length(v_grade_text) > 40 then v_errors := array_append(v_errors, 'GRADE_TOO_LONG'); end if;
      if length(v_interest_text) > 2000 then v_errors := array_append(v_errors, 'INTEREST_TOO_LONG'); end if;
      if jsonb_typeof(v_item->'interests') is distinct from 'array' then
        v_errors := array_append(v_errors, 'INVALID_INTERESTS');
      elsif jsonb_array_length(v_item->'interests') > 20 then
        v_errors := array_append(v_errors, 'INVALID_INTERESTS');
      elsif exists (
           select 1 from jsonb_array_elements_text(v_item->'interests') interest
           where length(trim(interest)) not between 1 and 200
      ) then
        v_errors := array_append(v_errors, 'INVALID_INTERESTS');
      end if;
      if length(v_wechat) > 100 then v_errors := array_append(v_errors, 'WECHAT_TOO_LONG'); end if;
      if length(v_acquisition_method) > 120 then v_errors := array_append(v_errors, 'ACQUISITION_TOO_LONG'); end if;
      if length(v_promoter) > 120 then v_errors := array_append(v_errors, 'PROMOTER_TOO_LONG'); end if;
      if length(v_location) > 500 then v_errors := array_append(v_errors, 'LOCATION_TOO_LONG'); end if;
      if length(v_remark) > 2000 then v_errors := array_append(v_errors, 'REMARK_TOO_LONG'); end if;
      if length(v_order_number) > 120 then v_errors := array_append(v_errors, 'ORDER_NUMBER_TOO_LONG'); end if;
      if length(v_payment_status) > 80 then v_errors := array_append(v_errors, 'PAYMENT_STATUS_TOO_LONG'); end if;
      if v_submitted_at_text <> '' then
        begin perform v_submitted_at_text::timestamptz;
        exception when others then v_errors := array_append(v_errors, 'INVALID_SUBMITTED_AT'); end;
      end if;
      if v_payment_at_text <> '' then
        begin perform v_payment_at_text::timestamptz;
        exception when others then v_errors := array_append(v_errors, 'INVALID_PAYMENT_AT'); end;
      end if;
    end if;

    v_phone_key := public.normalize_school_ops_phone(v_phone);
    v_name_key := public.normalize_lead_name(v_name);
    if length(v_phone_key) not between 6 and 20 then v_errors := array_append(v_errors, 'INVALID_PHONE'); end if;

    if cardinality(v_errors) = 0 then
      select lead.id into v_matched_lead_id
        from public.leads lead
       where lead.phone_normalized = v_phone_key and lead.normalized_name = v_name_key
       order by lead.created_at
       limit 1;

      if v_matched_lead_id is not null then
        v_match_kind := 'existing_seed';
        v_decision := 'auto_link';
      else
        select student.id into v_suggested_student_id
          from public.students student
         where student.deleted_at is null
           and public.normalize_school_ops_phone(student.phone) = v_phone_key
           and public.normalize_lead_name(student.name) = v_name_key
         order by student.created_at
         limit 1;

        if v_suggested_student_id is not null then
          v_match_kind := 'existing_student_hint';
          v_decision := 'auto_create';
        elsif exists (
          select 1 from public.leads lead where lead.phone_normalized = v_phone_key
        ) then
          select lead.id into v_matched_lead_id
            from public.leads lead
           where lead.phone_normalized = v_phone_key
           order by lead.created_at
           limit 1;
          v_match_kind := 'phone_name_conflict';
          v_decision := 'pending';
        elsif exists (
          select 1 from public.students student
           where student.deleted_at is null
             and public.normalize_school_ops_phone(student.phone) = v_phone_key
        ) then
          select student.id into v_suggested_student_id
            from public.students student
           where student.deleted_at is null
             and public.normalize_school_ops_phone(student.phone) = v_phone_key
           order by student.created_at
           limit 1;
          v_match_kind := 'phone_name_conflict';
          v_decision := 'pending';
        elsif exists (
          select 1 from public.data_import_rows prior
           where prior.batch_id = v_batch_id
             and prior.normalized_key = 'lead:' || v_phone_key || ':' || v_name_key
             and prior.row_status <> 'error'
        ) then
          v_match_kind := 'same_batch_duplicate';
          v_decision := 'auto_link';
        elsif exists (
          select 1 from public.data_import_rows prior
           where prior.batch_id = v_batch_id
             and prior.normalized_key like 'lead:' || v_phone_key || ':%'
             and prior.row_status <> 'error'
        ) then
          v_match_kind := 'phone_name_conflict';
          v_decision := 'pending';
        end if;
      end if;

      if v_source_duplicate then
        v_match_kind := 'source_marked_duplicate';
        v_decision := 'pending';
      end if;
    end if;

    if cardinality(v_errors) > 0 then
      v_status := 'error';
      v_error := v_error + 1;
    elsif v_decision = 'auto_create' then
      v_status := 'valid';
      v_valid := v_valid + 1;
    else
      v_status := 'duplicate';
      v_duplicate := v_duplicate + 1;
      if v_decision = 'pending' then
        v_errors := array_append(v_errors, case v_match_kind
          when 'phone_name_conflict' then 'PHONE_MATCH_DIFFERENT_NAME'
          when 'source_marked_duplicate' then 'SOURCE_MARKED_DUPLICATE'
          else 'REVIEW_REQUIRED'
        end);
      elsif v_match_kind = 'same_batch_duplicate' then
        v_errors := array_append(v_errors, 'DUPLICATE_IN_BATCH');
      end if;
    end if;

    insert into public.data_import_rows(
      batch_id, row_no, row_status, normalized_key, payload, error_codes, target_id
    ) values (
      v_batch_id,
      v_row_no,
      v_status,
      case when v_phone_key = '' or v_name_key = ''
        then 'row:' || v_row_no::text
        else 'lead:' || v_phone_key || ':' || v_name_key end,
      jsonb_build_object(
        'sourceRow', v_source_row,
        'childName', left(v_name, 100),
        'phone', left(v_phone, 40),
        'grade', v_grade,
        'gradeText', left(v_grade_text, 40),
        'interestText', left(v_interest_text, 2000),
        'interests', case when jsonb_typeof(v_item->'interests') = 'array'
          then v_item->'interests' else '[]'::jsonb end,
        'wechatNickname', left(v_wechat, 100),
        'submittedAt', v_submitted_at_text,
        'sourceDuplicate', v_source_duplicate,
        'acquisitionMethod', left(v_acquisition_method, 120),
        'promoter', left(v_promoter, 120),
        'location', left(v_location, 500),
        'remark', left(v_remark, 2000),
        'orderNumber', left(v_order_number, 120),
        'paymentStatus', left(v_payment_status, 80),
        'paymentAt', v_payment_at_text
      ),
      v_errors,
      v_matched_lead_id
    );

    insert into public.lead_import_row_reviews(
      batch_id, row_no, match_kind, matched_lead_id, suggested_student_id, decision
    ) values (
      v_batch_id, v_row_no, v_match_kind, v_matched_lead_id,
      v_suggested_student_id, v_decision
    );
  end loop;

  update public.data_import_batches
     set valid_rows = v_valid, duplicate_rows = v_duplicate, error_rows = v_error
   where id = v_batch_id;

  perform public.emit_domain_event(
    'lead_import.validated', 'data_import_batch', v_batch_id,
    jsonb_build_object(
      'kind', 'leads', 'sourceSystem', 'xiaoditui', 'inputHash', p_input_hash,
      'total', jsonb_array_length(p_rows), 'valid', v_valid,
      'duplicates', v_duplicate, 'errors', v_error
    ), v_uid, null
  );
  return public.get_lead_import_batch(v_batch_id);
end
$$;

create or replace function public.decide_lead_import_row(
  p_batch_id uuid,
  p_row_no integer,
  p_decision text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_review public.lead_import_row_reviews%rowtype;
begin
  if v_uid is null or not public.has_perm(v_uid, 'student.import') then raise exception 'FORBIDDEN'; end if;
  if p_row_no not between 1 and 5000 then raise exception 'INVALID_ROW'; end if;
  if p_decision not in ('create_new','link_existing','skip') then raise exception 'INVALID_DECISION'; end if;

  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null or v_batch.import_kind <> 'leads' then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.created_by <> v_uid and not public.is_admin(v_uid) then raise exception 'FORBIDDEN'; end if;
  if v_batch.status <> 'validated' or v_batch.expires_at <= now() then raise exception 'BATCH_EXPIRED'; end if;

  select * into v_review
    from public.lead_import_row_reviews
   where batch_id = p_batch_id and row_no = p_row_no
   for update;
  if v_review.batch_id is null or v_review.decision <> 'pending' then raise exception 'ROW_NOT_REVIEWABLE'; end if;
  if p_decision = 'link_existing' and v_review.matched_lead_id is null then
    raise exception 'INVALID_DECISION';
  end if;

  update public.lead_import_row_reviews
     set decision = p_decision, decided_by = v_uid, decided_at = now()
   where batch_id = p_batch_id and row_no = p_row_no;

  perform public.emit_domain_event(
    'lead_import.row_decided', 'data_import_batch', p_batch_id,
    jsonb_build_object('row', p_row_no, 'matchKind', v_review.match_kind, 'decision', p_decision),
    v_uid, null
  );
  return public.get_lead_import_batch(p_batch_id);
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Apply：只建立/复用 lead seed，并追加来源记录与意向标签。
-- ---------------------------------------------------------------------------

create or replace function public.apply_lead_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_row record;
  v_phone_key text;
  v_name_key text;
  v_lead_id uuid;
  v_created_lead_id uuid;
  v_source_record_id uuid;
  v_interest text;
  v_new_leads integer := 0;
begin
  if v_uid is null or not public.has_perm(v_uid, 'student.import') then raise exception 'FORBIDDEN'; end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null or v_batch.import_kind <> 'leads' then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.created_by <> v_uid and not public.is_admin(v_uid) then raise exception 'FORBIDDEN'; end if;
  if v_batch.status = 'completed' then return public.get_lead_import_batch(v_batch.id); end if;
  if v_batch.expires_at <= now() then raise exception 'BATCH_EXPIRED'; end if;
  if v_batch.error_rows > 0 then raise exception 'BATCH_HAS_ERRORS'; end if;
  if exists (
    select 1 from public.lead_import_row_reviews
     where batch_id = v_batch.id and decision = 'pending'
  ) then raise exception 'BATCH_HAS_PENDING_REVIEWS'; end if;

  for v_row in
    select item.*, review.match_kind, review.decision,
           review.matched_lead_id, review.suggested_student_id
      from public.data_import_rows item
      join public.lead_import_row_reviews review
        on review.batch_id = item.batch_id and review.row_no = item.row_no
     where item.batch_id = v_batch.id and item.row_status <> 'error'
     order by item.row_no
     for update of item, review
  loop
    if v_row.decision = 'skip' then continue; end if;

    v_phone_key := public.normalize_school_ops_phone(v_row.payload->>'phone');
    v_name_key := public.normalize_lead_name(v_row.payload->>'childName');
    perform pg_advisory_xact_lock(hashtext('lead-seed:' || v_phone_key || ':' || v_name_key));
    v_lead_id := null;
    v_created_lead_id := null;

    if v_row.decision in ('auto_link','link_existing') and v_row.matched_lead_id is not null then
      select lead.id into v_lead_id from public.leads lead where lead.id = v_row.matched_lead_id;
    end if;

    if v_lead_id is null then
      select lead.id into v_lead_id
        from public.leads lead
       where lead.phone_normalized = v_phone_key and lead.normalized_name = v_name_key
       limit 1;
    end if;

    if v_lead_id is null then
      insert into public.leads(
        provisional_student_name, normalized_name, phone, phone_normalized,
        grade_hint, grade_text, status, owner_id, suggested_student_id, created_by
      ) values (
        left(v_row.payload->>'childName', 100),
        v_name_key,
        left(v_row.payload->>'phone', 40),
        v_phone_key,
        nullif(v_row.payload->>'grade', '')::smallint,
        left(coalesce(v_row.payload->>'gradeText', ''), 40),
        'unassigned',
        null,
        v_row.suggested_student_id,
        v_batch.created_by
      )
      on conflict (phone_normalized, normalized_name) do nothing
      returning id into v_created_lead_id;

      if v_created_lead_id is not null then
        v_lead_id := v_created_lead_id;
        v_new_leads := v_new_leads + 1;
      else
        select lead.id into v_lead_id
          from public.leads lead
         where lead.phone_normalized = v_phone_key and lead.normalized_name = v_name_key
         limit 1;
      end if;
    end if;

    if v_lead_id is null then raise exception 'INVALID_DECISION'; end if;

    update public.leads
       set grade_hint = coalesce(grade_hint, nullif(v_row.payload->>'grade', '')::smallint),
           grade_text = case when grade_text = '' then left(coalesce(v_row.payload->>'gradeText', ''), 40) else grade_text end,
           suggested_student_id = coalesce(suggested_student_id, v_row.suggested_student_id)
     where id = v_lead_id;

    v_source_record_id := null;
    insert into public.lead_source_records(
      lead_id, batch_id, row_no, source_system, batch_label, source_row, submitted_at,
      acquisition_method, promoter, location_text, wechat_nickname,
      source_marked_duplicate, raw_grade_text, raw_interest_text, remark,
      order_number, payment_status, payment_at
    ) values (
      v_lead_id,
      v_batch.id,
      v_row.row_no,
      coalesce(v_batch.source_system, 'xiaoditui'),
      coalesce(v_batch.batch_label, v_batch.source_file_name, '小地推'),
      (v_row.payload->>'sourceRow')::integer,
      nullif(v_row.payload->>'submittedAt', '')::timestamptz,
      left(coalesce(v_row.payload->>'acquisitionMethod', ''), 120),
      left(coalesce(v_row.payload->>'promoter', ''), 120),
      left(coalesce(v_row.payload->>'location', ''), 500),
      left(coalesce(v_row.payload->>'wechatNickname', ''), 100),
      coalesce((v_row.payload->>'sourceDuplicate')::boolean, false),
      left(coalesce(v_row.payload->>'gradeText', ''), 40),
      left(coalesce(v_row.payload->>'interestText', ''), 2000),
      left(coalesce(v_row.payload->>'remark', ''), 2000),
      left(coalesce(v_row.payload->>'orderNumber', ''), 120),
      left(coalesce(v_row.payload->>'paymentStatus', ''), 80),
      nullif(v_row.payload->>'paymentAt', '')::timestamptz
    )
    on conflict (batch_id, row_no) do nothing
    returning id into v_source_record_id;

    if v_source_record_id is null then
      select source.id into v_source_record_id
        from public.lead_source_records source
       where source.batch_id = v_batch.id and source.row_no = v_row.row_no;
    end if;

    for v_interest in
      select trim(value)
        from jsonb_array_elements_text(coalesce(v_row.payload->'interests', '[]'::jsonb))
    loop
      insert into public.lead_interest_selections(
        lead_id, source_record_id, label, normalized_key, category
      ) values (
        v_lead_id,
        v_source_record_id,
        v_interest,
        lower(regexp_replace(v_interest, '\s+', '', 'g')),
        public.classify_lead_interest(v_interest)
      ) on conflict (source_record_id, normalized_key) do nothing;
    end loop;

    update public.data_import_rows
       set target_id = v_lead_id, row_status = 'inserted'
     where batch_id = v_batch.id and row_no = v_row.row_no;
  end loop;

  update public.data_import_batches
     set status = 'completed', inserted_rows = v_new_leads, completed_at = now()
   where id = v_batch.id;

  perform public.emit_domain_event(
    'lead_import.completed', 'data_import_batch', v_batch.id,
    jsonb_build_object(
      'kind', 'leads', 'sourceSystem', v_batch.source_system,
      'inputHash', v_batch.input_hash, 'createdLeadSeeds', v_new_leads,
      'appliedRows', (select count(*) from public.lead_source_records where batch_id = v_batch.id)
    ), v_uid, null
  );
  return public.get_lead_import_batch(v_batch.id);
end
$$;

revoke all on function public.normalize_school_ops_phone(text) from public, anon, authenticated;
revoke all on function public.normalize_lead_name(text) from public, anon, authenticated;
revoke all on function public.classify_lead_interest(text) from public, anon, authenticated;
revoke all on function public.get_lead_import_batch(uuid) from public, anon, authenticated;
revoke all on function public.preview_lead_import(text, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.decide_lead_import_row(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.apply_lead_import(uuid) from public, anon, authenticated;
grant execute on function public.get_lead_import_batch(uuid) to authenticated;
grant execute on function public.preview_lead_import(text, jsonb, text, text, text, text, text, text) to authenticated;
grant execute on function public.decide_lead_import_row(uuid, integer, text) to authenticated;
grant execute on function public.apply_lead_import(uuid) to authenticated;
