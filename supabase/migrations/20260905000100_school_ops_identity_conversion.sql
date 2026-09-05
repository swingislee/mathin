-- SCHOOL-OPS-IDENTITY-1: explicit Family / Contact / Lead / Student identity resolution.
--
-- Intake, contact and assessment flows keep writing Lead-side facts. Only the
-- confirm_lead_identity RPC may promote a Lead into the stable identity graph.
-- The mutation is idempotent, preserves every Lead/source fact, and reuses the
-- existing leads.student_id rebind trigger for assessment history.

-- ---------------------------------------------------------------------------
-- 1. Stable household and contact identities plus explicit relationships.
-- ---------------------------------------------------------------------------

create table public.families (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  status text not null default 'active' check (status in ('active','archived')),
  owner_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index families_owner_status_idx
  on public.families(owner_id, status, updated_at desc);

create trigger families_set_updated_at
  before update on public.families
  for each row execute function public.set_updated_at();

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  phone text not null default '' check (char_length(phone) <= 40),
  phone_normalized text not null default ''
    check (phone_normalized = '' or phone_normalized ~ '^[0-9]{6,20}$'),
  wechat text not null default '' check (char_length(wechat) <= 100),
  profile_id uuid unique references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_phone_idx
  on public.contacts(phone_normalized, updated_at desc)
  where phone_normalized <> '';

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

create table public.family_contacts (
  family_id uuid not null references public.families(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  role text not null default 'guardian'
    check (role in ('guardian','billing','emergency','other')),
  is_primary boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(family_id, contact_id)
);

create index family_contacts_contact_idx
  on public.family_contacts(contact_id, family_id);
create unique index family_contacts_one_primary_idx
  on public.family_contacts(family_id) where is_primary;

create table public.family_students (
  family_id uuid not null references public.families(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  is_primary boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(family_id, student_id)
);

create index family_students_student_idx
  on public.family_students(student_id, family_id);
create unique index family_students_one_primary_idx
  on public.family_students(student_id) where is_primary;

create table public.student_contacts (
  student_id uuid not null references public.students(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  relation text not null check (char_length(btrim(relation)) between 1 and 40),
  is_primary boolean not null default false,
  is_decision_maker boolean not null default false,
  preferred_channel text not null default 'phone'
    check (preferred_channel in ('phone','wechat','other')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(student_id, contact_id)
);

create index student_contacts_contact_idx
  on public.student_contacts(contact_id, student_id);
create unique index student_contacts_one_primary_idx
  on public.student_contacts(student_id) where is_primary;

create trigger student_contacts_set_updated_at
  before update on public.student_contacts
  for each row execute function public.set_updated_at();

comment on table public.families is
  'Stable household/commercial identity. Course families remain in public.course_families.';
comment on table public.contacts is
  'Contact people are independent from authenticated guardian profiles; profile_id is an optional later claim.';
comment on table public.student_contacts is
  'Explicit per-student relationship, decision-maker fact and contact preference.';

-- ---------------------------------------------------------------------------
-- 2. A converted Lead points at the resolved identity graph. Legacy rows that
--    already linked only a Student remain readable; every new RPC conversion
--    always writes all three identifiers.
-- ---------------------------------------------------------------------------

alter table public.leads
  add column family_id uuid references public.families(id) on delete restrict,
  add column contact_id uuid references public.contacts(id) on delete restrict;

create index leads_family_idx on public.leads(family_id) where family_id is not null;
create index leads_contact_idx on public.leads(contact_id) where contact_id is not null;

alter table public.leads
  drop constraint leads_identity_confirmation_check;

alter table public.leads
  add constraint leads_identity_confirmation_check check (
    (
      student_id is null
      and family_id is null
      and contact_id is null
      and identity_confirmed_by is null
      and identity_confirmed_at is null
      and status <> 'converted'
    )
    or (
      student_id is not null
      and identity_confirmed_by is not null
      and identity_confirmed_at is not null
      and (
        family_id is null and contact_id is null
        or family_id is not null and contact_id is not null and status = 'converted'
      )
    )
  );

create table public.lead_identity_conversions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  student_resolution text not null check (student_resolution in ('existing','create')),
  family_resolution text not null check (family_resolution in ('existing','create')),
  contact_resolution text not null check (contact_resolution in ('existing','create')),
  idempotency_key text not null
    check (char_length(idempotency_key) between 16 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request_summary jsonb not null check (jsonb_typeof(request_summary) = 'object'),
  result_payload jsonb not null check (jsonb_typeof(result_payload) = 'object'),
  converted_by uuid not null references public.profiles(id) on delete restrict,
  converted_at timestamptz not null default now(),
  unique(lead_id, idempotency_key)
);

create index lead_identity_conversions_student_idx
  on public.lead_identity_conversions(student_id, converted_at desc);
create index lead_identity_conversions_family_idx
  on public.lead_identity_conversions(family_id, converted_at desc);
create index lead_identity_conversions_contact_idx
  on public.lead_identity_conversions(contact_id, converted_at desc);

comment on table public.lead_identity_conversions is
  'Append-only audit and idempotency record for the one explicit Lead identity promotion.';

create or replace function public.prevent_lead_identity_conversion_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'IMMUTABLE_IDENTITY_CONVERSION';
end;
$$;

create trigger lead_identity_conversions_append_only
  before update or delete on public.lead_identity_conversions
  for each row execute function public.prevent_lead_identity_conversion_mutation();

-- ---------------------------------------------------------------------------
-- 3. Staff-only read scopes. Relationship writes remain RPC-only.
-- ---------------------------------------------------------------------------

create or replace function public.can_access_family(p_family_id uuid, p_uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null and public.is_staff(p_uid) and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'student.view.all')
    or exists (
      select 1 from public.families family_row
       where family_row.id = p_family_id and family_row.owner_id = p_uid
    )
    or exists (
      select 1 from public.family_students membership
       where membership.family_id = p_family_id
         and public.can_access_student(membership.student_id, p_uid)
    )
  );
$$;

create or replace function public.can_access_contact(p_contact_id uuid, p_uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null and public.is_staff(p_uid) and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'student.view.all')
    or exists (
      select 1 from public.family_contacts membership
       where membership.contact_id = p_contact_id
         and public.can_access_family(membership.family_id, p_uid)
    )
    or exists (
      select 1 from public.student_contacts relationship
       where relationship.contact_id = p_contact_id
         and public.can_access_student(relationship.student_id, p_uid)
    )
  );
$$;

alter table public.families enable row level security;
alter table public.contacts enable row level security;
alter table public.family_contacts enable row level security;
alter table public.family_students enable row level security;
alter table public.student_contacts enable row level security;
alter table public.lead_identity_conversions enable row level security;

create policy families_select_scope on public.families
  for select to authenticated using (
    public.can_access_family(id, (select auth.uid()))
  );

create policy contacts_select_scope on public.contacts
  for select to authenticated using (
    public.can_access_contact(id, (select auth.uid()))
  );

create policy family_contacts_select_scope on public.family_contacts
  for select to authenticated using (
    public.can_access_family(family_id, (select auth.uid()))
  );

create policy family_students_select_scope on public.family_students
  for select to authenticated using (
    public.can_access_family(family_id, (select auth.uid()))
    or public.can_access_student(student_id, (select auth.uid()))
  );

create policy student_contacts_select_scope on public.student_contacts
  for select to authenticated using (
    public.can_access_student(student_id, (select auth.uid()))
  );

create policy lead_identity_conversions_select_scope on public.lead_identity_conversions
  for select to authenticated using (
    public.can_access_family(family_id, (select auth.uid()))
    or public.can_access_student(student_id, (select auth.uid()))
  );

revoke all on public.families, public.contacts, public.family_contacts,
  public.family_students, public.student_contacts, public.lead_identity_conversions
  from public, anon, authenticated;
grant select on public.families, public.contacts, public.family_contacts,
  public.family_students, public.student_contacts, public.lead_identity_conversions
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Read-only resolution preview. It returns only candidates already visible
--    to the operator; a hidden exact duplicate is never disclosed.
-- ---------------------------------------------------------------------------

create or replace function public.get_lead_identity_options(p_lead_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lead public.leads%rowtype;
  v_wechat text := '';
  v_students jsonb := '[]'::jsonb;
  v_families jsonb := '[]'::jsonb;
  v_contacts jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'followup.view') then raise exception 'FORBIDDEN'; end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_lead.student_id is not null or v_lead.status in ('invalid','converted') then
    raise exception 'LEAD_CLOSED';
  end if;
  if v_lead.owner_id is null then raise exception 'LEAD_UNASSIGNED'; end if;
  if v_lead.owner_id <> v_uid and not public.has_perm(v_uid, 'student.view.all') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select coalesce(source.wechat_nickname, '') into v_wechat
    from public.lead_source_records source
   where source.lead_id = v_lead.id
   order by source.submitted_at desc nulls last, source.created_at desc, source.id desc
   limit 1;
  v_wechat := coalesce(v_wechat, '');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', candidate.id,
    'name', candidate.name,
    'grade', candidate.grade,
    'phone', candidate.phone,
    'parentName', candidate.parent_name,
    'parentPhone', candidate.parent_phone,
    'suggested', candidate.suggested,
    'phoneMatch', candidate.phone_match,
    'nameMatch', candidate.name_match
  ) order by candidate.suggested desc, candidate.phone_match desc, candidate.name, candidate.id), '[]'::jsonb)
  into v_students
  from (
    select student.id, student.name, student.grade, student.phone,
           student.parent_name, student.parent_phone,
           student.id = v_lead.suggested_student_id as suggested,
           public.normalize_lead_name(student.name) = v_lead.normalized_name as name_match,
           (
             public.normalize_school_ops_phone(student.phone) = v_lead.phone_normalized
             or public.normalize_school_ops_phone(student.parent_phone) = v_lead.phone_normalized
           ) as phone_match
      from public.students student
     where student.deleted_at is null
       and public.can_access_student(student.id, v_uid)
       and (
         student.id = v_lead.suggested_student_id
         or public.normalize_lead_name(student.name) = v_lead.normalized_name
         or public.normalize_school_ops_phone(student.phone) = v_lead.phone_normalized
         or public.normalize_school_ops_phone(student.parent_phone) = v_lead.phone_normalized
       )
     order by suggested desc, phone_match desc, student.name, student.id
     limit 20
  ) candidate;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', candidate.id,
    'displayName', candidate.display_name,
    'studentNames', candidate.student_names,
    'contactNames', candidate.contact_names
  ) order by candidate.display_name, candidate.id), '[]'::jsonb)
  into v_families
  from (
    select family_row.id, family_row.display_name,
           coalesce((
             select jsonb_agg(student.name order by student.name)
               from public.family_students membership
               join public.students student on student.id = membership.student_id
              where membership.family_id = family_row.id and student.deleted_at is null
           ), '[]'::jsonb) as student_names,
           coalesce((
             select jsonb_agg(contact.display_name order by contact.display_name)
               from public.family_contacts membership
               join public.contacts contact on contact.id = membership.contact_id
              where membership.family_id = family_row.id
           ), '[]'::jsonb) as contact_names
      from public.families family_row
     where family_row.status = 'active'
       and public.can_access_family(family_row.id, v_uid)
       and (
          position(v_lead.normalized_name in public.normalize_lead_name(family_row.display_name)) > 0
         or exists (
           select 1
             from public.family_contacts membership
             join public.contacts contact on contact.id = membership.contact_id
            where membership.family_id = family_row.id
              and contact.phone_normalized = v_lead.phone_normalized
         )
         or exists (
           select 1
             from public.family_students membership
             join public.students student on student.id = membership.student_id
            where membership.family_id = family_row.id
              and student.deleted_at is null
              and (
                student.id = v_lead.suggested_student_id
                or public.normalize_lead_name(student.name) = v_lead.normalized_name
                or public.normalize_school_ops_phone(student.phone) = v_lead.phone_normalized
                or public.normalize_school_ops_phone(student.parent_phone) = v_lead.phone_normalized
              )
         )
       )
     order by family_row.display_name, family_row.id
     limit 20
  ) candidate;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', candidate.id,
    'displayName', candidate.display_name,
    'phone', candidate.phone,
    'wechat', candidate.wechat,
    'familyNames', candidate.family_names
  ) order by candidate.display_name, candidate.id), '[]'::jsonb)
  into v_contacts
  from (
    select contact.id, contact.display_name, contact.phone, contact.wechat,
           coalesce((
             select jsonb_agg(family_row.display_name order by family_row.display_name)
               from public.family_contacts membership
               join public.families family_row on family_row.id = membership.family_id
              where membership.contact_id = contact.id
           ), '[]'::jsonb) as family_names
      from public.contacts contact
     where contact.phone_normalized = v_lead.phone_normalized
       and public.can_access_contact(contact.id, v_uid)
     order by contact.display_name, contact.id
     limit 20
  ) candidate;

  return jsonb_build_object(
    'lead', jsonb_build_object(
      'id', v_lead.id,
      'studentName', v_lead.provisional_student_name,
      'phone', v_lead.phone,
      'grade', v_lead.grade_hint,
      'gradeText', v_lead.grade_text,
      'wechatNickname', v_wechat,
      'ownerId', v_lead.owner_id,
      'suggestedStudentId', v_lead.suggested_student_id
    ),
    'canCreateStudent', public.has_perm(v_uid, 'student.create')
      and public.has_perm(v_uid, 'student.edit')
      and public.has_perm(v_uid, 'followup.write'),
    'students', v_students,
    'families', v_families,
    'contacts', v_contacts
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The only identity mutation. The client must choose existing/create for
--    every identity explicitly and send a stable idempotency key.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_lead_identity(
  p_lead_id uuid,
  p_idempotency_key text,
  p_identity jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lead public.leads%rowtype;
  v_prior public.lead_identity_conversions%rowtype;
  v_student_mode text;
  v_family_mode text;
  v_contact_mode text;
  v_student_id uuid;
  v_family_id uuid;
  v_contact_id uuid;
  v_student_name text;
  v_student_grade smallint;
  v_family_name text;
  v_contact_name text;
  v_contact_phone text;
  v_contact_phone_key text;
  v_contact_wechat text;
  v_relation text;
  v_is_primary_family boolean;
  v_is_primary_contact boolean;
  v_is_decision_maker boolean;
  v_preferred_channel text;
  v_allow_possible_duplicate boolean;
  v_allow_additional_relationship boolean;
  v_student_created boolean := false;
  v_family_created boolean := false;
  v_contact_created boolean := false;
  v_next_action public.lead_next_actions%rowtype;
  v_next_action_migrated boolean := false;
  v_request_hash text;
  v_request_summary jsonb;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'followup.write')
     or not public.has_perm(v_uid, 'student.edit') then
    raise exception 'FORBIDDEN';
  end if;
  if p_identity is null or jsonb_typeof(p_identity) <> 'object'
     or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 16 and 200 then
    raise exception 'INVALID_IDENTITY';
  end if;
  if jsonb_typeof(p_identity -> 'student') is distinct from 'object'
     or jsonb_typeof(p_identity -> 'family') is distinct from 'object'
     or jsonb_typeof(p_identity -> 'contact') is distinct from 'object'
     or jsonb_typeof(p_identity -> 'relationship') is distinct from 'object'
     or jsonb_typeof(p_identity #> '{student,mode}') is distinct from 'string'
     or jsonb_typeof(p_identity #> '{family,mode}') is distinct from 'string'
     or jsonb_typeof(p_identity #> '{contact,mode}') is distinct from 'string'
     or jsonb_typeof(p_identity #> '{relationship,relation}') is distinct from 'string'
     or jsonb_typeof(p_identity #> '{relationship,preferredChannel}') is distinct from 'string'
     or jsonb_typeof(p_identity #> '{relationship,isPrimaryFamily}') is distinct from 'boolean'
     or jsonb_typeof(p_identity #> '{relationship,isPrimaryContact}') is distinct from 'boolean'
     or jsonb_typeof(p_identity #> '{relationship,isDecisionMaker}') is distinct from 'boolean'
     or jsonb_typeof(p_identity -> 'allowPossibleDuplicate') is distinct from 'boolean'
     or jsonb_typeof(p_identity -> 'allowAdditionalRelationship') is distinct from 'boolean' then
    raise exception 'INVALID_IDENTITY';
  end if;

  v_student_mode := p_identity #>> '{student,mode}';
  v_family_mode := p_identity #>> '{family,mode}';
  v_contact_mode := p_identity #>> '{contact,mode}';
  v_relation := btrim(coalesce(p_identity #>> '{relationship,relation}', ''));
  v_preferred_channel := coalesce(p_identity #>> '{relationship,preferredChannel}', 'phone');
  v_is_primary_family := (p_identity #>> '{relationship,isPrimaryFamily}')::boolean;
  v_is_primary_contact := (p_identity #>> '{relationship,isPrimaryContact}')::boolean;
  v_is_decision_maker := (p_identity #>> '{relationship,isDecisionMaker}')::boolean;
  v_allow_possible_duplicate := (p_identity ->> 'allowPossibleDuplicate')::boolean;
  v_allow_additional_relationship := (p_identity ->> 'allowAdditionalRelationship')::boolean;

  if v_student_mode is null or v_student_mode not in ('existing','create')
     or v_family_mode is null or v_family_mode not in ('existing','create')
     or v_contact_mode is null or v_contact_mode not in ('existing','create')
     or char_length(v_relation) not between 1 and 40
     or v_preferred_channel not in ('phone','wechat','other') then
    raise exception 'INVALID_IDENTITY';
  end if;
  if (v_student_mode = 'existing'
        and jsonb_typeof(p_identity #> '{student,id}') is distinct from 'string')
     or (v_student_mode = 'create' and (
       jsonb_typeof(p_identity #> '{student,name}') is distinct from 'string'
       or coalesce(jsonb_typeof(p_identity #> '{student,grade}'), 'missing') not in ('number','null')
     ))
     or (v_family_mode = 'existing'
        and jsonb_typeof(p_identity #> '{family,id}') is distinct from 'string')
     or (v_family_mode = 'create'
        and jsonb_typeof(p_identity #> '{family,displayName}') is distinct from 'string')
     or (v_contact_mode = 'existing'
        and jsonb_typeof(p_identity #> '{contact,id}') is distinct from 'string')
     or (v_contact_mode = 'create' and (
       jsonb_typeof(p_identity #> '{contact,displayName}') is distinct from 'string'
       or jsonb_typeof(p_identity #> '{contact,phone}') is distinct from 'string'
       or jsonb_typeof(p_identity #> '{contact,wechat}') is distinct from 'string'
     )) then
    raise exception 'INVALID_IDENTITY';
  end if;

  begin
    if v_student_mode = 'existing' then
      v_student_id := nullif(p_identity #>> '{student,id}', '')::uuid;
    else
      v_student_grade := nullif(p_identity #>> '{student,grade}', '')::smallint;
    end if;
    if v_family_mode = 'existing' then
      v_family_id := nullif(p_identity #>> '{family,id}', '')::uuid;
    end if;
    if v_contact_mode = 'existing' then
      v_contact_id := nullif(p_identity #>> '{contact,id}', '')::uuid;
    end if;
    if (v_student_mode = 'existing' and v_student_id is null)
       or (v_family_mode = 'existing' and v_family_id is null)
       or (v_contact_mode = 'existing' and v_contact_id is null) then
      raise exception 'INVALID_IDENTITY';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_IDENTITY';
  end;

  v_request_hash := encode(
    extensions.digest(convert_to(p_identity::text, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_advisory_xact_lock(
    hashtext('lead-identity-idempotency:' || p_lead_id::text || ':' || btrim(p_idempotency_key))
  );
  select * into v_prior
    from public.lead_identity_conversions conversion
   where conversion.lead_id = p_lead_id
     and conversion.idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_prior.converted_by <> v_uid
       or v_prior.request_hash <> v_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_prior.result_payload;
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_lead.student_id is not null or v_lead.status in ('invalid','converted') then
    raise exception 'LEAD_CLOSED';
  end if;
  if v_lead.owner_id is null then raise exception 'LEAD_UNASSIGNED'; end if;
  if v_lead.owner_id <> v_uid and not public.has_perm(v_uid, 'student.view.all') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select * into v_next_action
    from public.lead_next_actions action
   where action.lead_id = v_lead.id and action.status = 'open'
   for update;

  -- Resolve Contact first so a new Student can receive the compatibility
  -- parent fields without treating the Lead phone as the child's phone.
  if v_contact_mode = 'existing' then
    select contact.display_name, contact.phone, contact.phone_normalized, contact.wechat
      into v_contact_name, v_contact_phone, v_contact_phone_key, v_contact_wechat
      from public.contacts contact
     where contact.id = v_contact_id
       and public.can_access_contact(contact.id, v_uid)
     for update;
    if not found then raise exception 'CONTACT_NOT_FOUND'; end if;
  else
    v_contact_name := btrim(coalesce(p_identity #>> '{contact,displayName}', ''));
    v_contact_phone := left(btrim(coalesce(p_identity #>> '{contact,phone}', '')), 40);
    v_contact_phone_key := public.normalize_school_ops_phone(v_contact_phone);
    v_contact_wechat := left(btrim(coalesce(p_identity #>> '{contact,wechat}', '')), 100);
    if char_length(v_contact_name) not between 1 and 100
       or char_length(v_contact_phone_key) not between 6 and 20 then
      raise exception 'INVALID_IDENTITY';
    end if;
    perform pg_advisory_xact_lock(
      hashtext('lead-identity-contact:' || v_contact_phone_key)
    );
    if not v_allow_possible_duplicate and exists (
      select 1 from public.contacts contact
       where contact.phone_normalized = v_contact_phone_key
    ) then
      raise exception 'POSSIBLE_CONTACT_DUPLICATE';
    end if;
    insert into public.contacts(
      display_name, phone, phone_normalized, wechat, created_by
    ) values (
      v_contact_name, v_contact_phone, v_contact_phone_key, v_contact_wechat, v_uid
    ) returning id into v_contact_id;
    v_contact_created := true;
  end if;

  if v_student_mode = 'existing' then
    select student.name into v_student_name
      from public.students student
     where student.id = v_student_id
       and student.deleted_at is null
       and public.can_access_student(student.id, v_uid)
     for update;
    if not found then raise exception 'STUDENT_NOT_FOUND'; end if;
  else
    if not public.has_perm(v_uid, 'student.create') then raise exception 'FORBIDDEN'; end if;
    v_student_name := btrim(coalesce(p_identity #>> '{student,name}', ''));
    if char_length(v_student_name) not between 1 and 100
       or v_student_grade is not null and v_student_grade not between 1 and 12 then
      raise exception 'INVALID_IDENTITY';
    end if;
    perform pg_advisory_xact_lock(hashtext(
      'lead-identity-student:' || public.normalize_lead_name(v_student_name)
      || ':' || coalesce(v_contact_phone_key, '')
    ));
    if not v_allow_possible_duplicate and exists (
      select 1 from public.students student
       where student.deleted_at is null
         and public.normalize_lead_name(student.name) = public.normalize_lead_name(v_student_name)
         and (
           public.normalize_school_ops_phone(student.phone) = v_contact_phone_key
           or public.normalize_school_ops_phone(student.parent_phone) = v_contact_phone_key
         )
    ) then
      raise exception 'POSSIBLE_STUDENT_DUPLICATE';
    end if;
    insert into public.students(
      name, grade, phone, source, parent_name, parent_relation, parent_phone,
      assigned_to, created_by, bind_code
    ) values (
      v_student_name, v_student_grade, '', 'Lead identity confirmation',
      v_contact_name, v_relation, v_contact_phone,
      v_lead.owner_id, v_uid, public.generate_student_bind_code()
    ) returning id into v_student_id;
    v_student_created := true;
  end if;

  if v_family_mode = 'existing' then
    select family_row.display_name into v_family_name
      from public.families family_row
     where family_row.id = v_family_id
       and family_row.status = 'active'
       and public.can_access_family(family_row.id, v_uid)
     for update;
    if not found then raise exception 'FAMILY_NOT_FOUND'; end if;
  else
    v_family_name := btrim(coalesce(p_identity #>> '{family,displayName}', ''));
    if char_length(v_family_name) not between 1 and 120 then raise exception 'INVALID_IDENTITY'; end if;
    perform pg_advisory_xact_lock(hashtext(
      'lead-identity-family:' || public.normalize_lead_name(v_family_name)
    ));
    if not v_allow_possible_duplicate and exists (
      select 1 from public.families family_row
       where family_row.status = 'active'
         and public.normalize_lead_name(family_row.display_name)
             = public.normalize_lead_name(v_family_name)
    ) then
      raise exception 'POSSIBLE_FAMILY_DUPLICATE';
    end if;
    insert into public.families(display_name, owner_id, created_by)
    values (v_family_name, v_lead.owner_id, v_uid)
    returning id into v_family_id;
    v_family_created := true;
  end if;

  -- Existing identities may be ungrouped, in which case this action explicitly
  -- creates the relationship. If either identity already belongs to a Family,
  -- the selected Family must agree; cross-household reassignment is a separate
  -- high-impact operation and cannot hide inside Lead conversion.
  if not v_allow_additional_relationship
     and v_student_mode = 'existing'
     and exists (
       select 1 from public.family_students membership
        where membership.student_id = v_student_id
     )
     and not exists (
       select 1 from public.family_students membership
        where membership.student_id = v_student_id
          and membership.family_id = v_family_id
     ) then
    raise exception 'RELATIONSHIP_CONFLICT';
  end if;
  if not v_allow_additional_relationship
     and v_contact_mode = 'existing'
     and exists (
       select 1 from public.family_contacts membership
        where membership.contact_id = v_contact_id
     )
     and not exists (
       select 1 from public.family_contacts membership
        where membership.contact_id = v_contact_id
          and membership.family_id = v_family_id
     ) then
    raise exception 'RELATIONSHIP_CONFLICT';
  end if;

  if not v_is_primary_family and not exists (
    select 1 from public.family_students membership
     where membership.student_id = v_student_id
       and membership.family_id <> v_family_id
       and membership.is_primary
  ) then
    raise exception 'PRIMARY_RELATION_REQUIRED';
  end if;
  if not v_is_primary_contact and (
    not exists (
      select 1 from public.family_contacts membership
       where membership.family_id = v_family_id
         and membership.contact_id <> v_contact_id
         and membership.is_primary
    )
    or not exists (
      select 1 from public.student_contacts relationship
       where relationship.student_id = v_student_id
         and relationship.contact_id <> v_contact_id
         and relationship.is_primary
    )
  ) then
    raise exception 'PRIMARY_RELATION_REQUIRED';
  end if;

  if v_is_primary_family then
    update public.family_students
       set is_primary = false
     where student_id = v_student_id and family_id <> v_family_id and is_primary;
  end if;
  if v_is_primary_contact then
    update public.family_contacts
       set is_primary = false
     where family_id = v_family_id and contact_id <> v_contact_id and is_primary;
    update public.student_contacts
       set is_primary = false
     where student_id = v_student_id and contact_id <> v_contact_id and is_primary;
  end if;

  insert into public.family_contacts(family_id, contact_id, role, is_primary, created_by)
  values (v_family_id, v_contact_id, 'guardian', v_is_primary_contact, v_uid)
  on conflict(family_id, contact_id) do update
    set is_primary = excluded.is_primary;

  insert into public.family_students(family_id, student_id, is_primary, created_by)
  values (v_family_id, v_student_id, v_is_primary_family, v_uid)
  on conflict(family_id, student_id) do update
    set is_primary = excluded.is_primary;

  insert into public.student_contacts(
    student_id, contact_id, relation, is_primary, is_decision_maker,
    preferred_channel, created_by
  ) values (
    v_student_id, v_contact_id, v_relation, v_is_primary_contact,
    v_is_decision_maker, v_preferred_channel, v_uid
  )
  on conflict(student_id, contact_id) do update
    set relation = excluded.relation,
        is_primary = excluded.is_primary,
        is_decision_maker = excluded.is_decision_maker,
        preferred_channel = excluded.preferred_channel;

  -- Compatibility projection for existing Student pages. Empty legacy fields
  -- are filled from the explicit Contact; existing values are never overwritten.
  -- Moving a Lead task only updates the Student due-date projection. Identity
  -- confirmation is not a Communication and must not fabricate a follow-up row
  -- or change last_follow_up_at. If the Student already has a reminder, keep the
  -- earlier deadline so neither obligation is hidden.
  update public.students
     set parent_name = case when btrim(parent_name) = '' then v_contact_name else parent_name end,
         parent_relation = case when btrim(parent_relation) = '' then v_relation else parent_relation end,
         parent_phone = case when btrim(parent_phone) = '' then v_contact_phone else parent_phone end,
         next_follow_up_at = case
           when v_next_action.id is null then next_follow_up_at
           when next_follow_up_at is null then v_next_action.due_at
           else least(next_follow_up_at, v_next_action.due_at)
         end
   where id = v_student_id;

  begin
    update public.leads
       set family_id = v_family_id,
           contact_id = v_contact_id,
           student_id = v_student_id,
           status = 'converted',
           identity_confirmed_by = v_uid,
           identity_confirmed_at = now()
     where id = v_lead.id;
  exception when unique_violation then
    -- Existing assessment/activity rebind triggers can discover that the target
    -- Student already owns another row for the same Activity. Preserve both
    -- histories and require an explicit operator resolution instead of merging.
    raise exception 'LEAD_IDENTITY_HISTORY_CONFLICT';
  end;

  v_next_action_migrated := v_next_action.id is not null;

  update public.lead_next_actions
     set status = 'completed', completed_by = v_uid, completed_at = now()
   where lead_id = v_lead.id and status = 'open';

  v_result := jsonb_build_object(
    'leadId', v_lead.id,
    'familyId', v_family_id,
    'contactId', v_contact_id,
    'studentId', v_student_id,
    'created', jsonb_build_object(
      'family', v_family_created,
      'contact', v_contact_created,
      'student', v_student_created
    ),
    'nextActionMigrated', v_next_action_migrated
  );

  -- Audit stores a minimal relationship/resolution summary. Names, phone and
  -- WeChat stay in their authoritative identity rows; request_hash is the
  -- replay comparison and avoids copying those values into another PII blob.
  v_request_summary := jsonb_build_object(
    'student', jsonb_build_object('mode', v_student_mode, 'id', v_student_id),
    'family', jsonb_build_object('mode', v_family_mode, 'id', v_family_id),
    'contact', jsonb_build_object('mode', v_contact_mode, 'id', v_contact_id),
    'relationship', jsonb_build_object(
      'relation', v_relation,
      'isPrimaryFamily', v_is_primary_family,
      'isPrimaryContact', v_is_primary_contact,
      'isDecisionMaker', v_is_decision_maker,
      'preferredChannel', v_preferred_channel
    ),
    'sourceNextAction', case when v_next_action.id is null then null else jsonb_build_object(
      'id', v_next_action.id,
      'kind', v_next_action.kind,
      'dueAt', v_next_action.due_at
    ) end,
    'possibleDuplicateAcknowledged', v_allow_possible_duplicate,
    'additionalRelationshipAcknowledged', v_allow_additional_relationship
  );

  insert into public.lead_identity_conversions(
    lead_id, family_id, contact_id, student_id,
    student_resolution, family_resolution, contact_resolution,
    idempotency_key, request_hash, request_summary, result_payload, converted_by
  ) values (
    v_lead.id, v_family_id, v_contact_id, v_student_id,
    v_student_mode, v_family_mode, v_contact_mode,
    btrim(p_idempotency_key), v_request_hash, v_request_summary, v_result, v_uid
  );

  perform public.emit_domain_event(
    'lead.identity.confirmed',
    'lead',
    v_lead.id,
    jsonb_build_object(
      'familyId', v_family_id,
      'contactId', v_contact_id,
      'studentId', v_student_id,
      'studentResolution', v_student_mode,
      'familyResolution', v_family_mode,
      'contactResolution', v_contact_mode,
      'nextActionMigrated', v_next_action_migrated,
      'nextActionKind', v_next_action.kind,
      'nextActionDueAt', v_next_action.due_at
    ),
    v_lead.owner_id,
    null
  );

  return v_result;
end;
$$;

revoke all on function public.can_access_family(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.can_access_contact(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_lead_identity_options(uuid)
  from public, anon, authenticated;
revoke all on function public.confirm_lead_identity(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.prevent_lead_identity_conversion_mutation()
  from public, anon, authenticated;

grant execute on function public.can_access_family(uuid, uuid) to authenticated;
grant execute on function public.can_access_contact(uuid, uuid) to authenticated;
grant execute on function public.get_lead_identity_options(uuid) to authenticated;
grant execute on function public.confirm_lead_identity(uuid, text, jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
