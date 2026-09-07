-- 来源底稿与一线反馈分别保存；本流程只采集事实，不更新学生、家庭或报名。
create table public.student_profile_review_batches (
  id uuid primary key default gen_random_uuid(),
  source_hash text not null unique check (source_hash ~ '^[a-f0-9]{64}$'),
  title text not null,
  source_label text not null,
  source_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.student_profile_review_groups (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.student_profile_review_batches(id) on delete restrict,
  source_key text not null,
  label text not null,
  teacher_name text not null default '',
  teacher_id uuid references public.profiles(id) on delete restrict,
  support_id uuid references public.profiles(id) on delete restrict,
  version integer not null default 0,
  unique(batch_id, source_key)
);

create table public.student_profile_review_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.student_profile_review_groups(id) on delete restrict,
  source_key text not null,
  source_order integer not null,
  name text not null default '',
  grade text not null default '',
  enrollment_state text not null check (enrollment_state in ('in_study','pending_registration','unspecified')),
  needs_contact boolean not null,
  grade_attention boolean not null,
  unique(group_id, source_key)
);

create table public.student_profile_review_responses (
  item_id uuid not null references public.student_profile_review_items(id) on delete restrict,
  scope text not null check (scope in ('teacher','support')),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  version integer not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  primary key(item_id, scope)
);

create table public.student_profile_review_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.student_profile_review_groups(id) on delete restrict,
  item_id uuid references public.student_profile_review_items(id) on delete restrict,
  scope text not null check (scope in ('assignment','teacher','support')),
  before_data jsonb,
  after_data jsonb not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create index student_profile_review_items_group_idx on public.student_profile_review_items(group_id, source_order);
create index student_profile_review_groups_teacher_idx on public.student_profile_review_groups(teacher_id);
create index student_profile_review_groups_support_idx on public.student_profile_review_groups(support_id);

create function public.can_read_student_profile_review(p_group_id uuid, p_scope text default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(auth.uid()) and exists (
    select 1 from public.student_profile_review_groups g where g.id=p_group_id and (
      public.is_admin(auth.uid())
      or (g.teacher_id=auth.uid() and (p_scope is null or p_scope='teacher'))
      or (g.support_id=auth.uid() and (p_scope is null or p_scope='support'))
    )
  )
$$;

alter table public.student_profile_review_batches enable row level security;
alter table public.student_profile_review_groups enable row level security;
alter table public.student_profile_review_items enable row level security;
alter table public.student_profile_review_responses enable row level security;
alter table public.student_profile_review_events enable row level security;

create policy profile_review_batches_read on public.student_profile_review_batches for select to authenticated
  using (public.is_staff(auth.uid()) and (public.is_admin(auth.uid()) or exists (
    select 1 from public.student_profile_review_groups g where g.batch_id=student_profile_review_batches.id and public.can_read_student_profile_review(g.id)
  )));
create policy profile_review_groups_read on public.student_profile_review_groups for select to authenticated
  using (public.can_read_student_profile_review(id));
create policy profile_review_items_read on public.student_profile_review_items for select to authenticated
  using (public.can_read_student_profile_review(group_id));
create policy profile_review_responses_read on public.student_profile_review_responses for select to authenticated
  using (exists(select 1 from public.student_profile_review_items i where i.id=item_id and public.can_read_student_profile_review(i.group_id,scope)));
create policy profile_review_events_read on public.student_profile_review_events for select to authenticated
  using (public.is_staff(auth.uid()) and public.is_admin(auth.uid()));

revoke all on public.student_profile_review_batches, public.student_profile_review_groups,
  public.student_profile_review_items, public.student_profile_review_responses, public.student_profile_review_events from anon, authenticated;
grant select on public.student_profile_review_batches, public.student_profile_review_groups,
  public.student_profile_review_items, public.student_profile_review_responses, public.student_profile_review_events to authenticated;

create function public.assign_student_profile_review(p_group_id uuid, p_teacher_id uuid, p_support_id uuid, p_expected_version integer)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.student_profile_review_groups;
begin
  if not coalesce(public.is_staff(auth.uid()) and public.is_admin(auth.uid()),false) then raise exception 'FORBIDDEN'; end if;
  select * into g from public.student_profile_review_groups where id=p_group_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_expected_version is distinct from g.version then raise exception 'VERSION_CONFLICT'; end if;
  if (p_teacher_id is not null and not public.is_staff(p_teacher_id))
     or (p_support_id is not null and not public.is_staff(p_support_id)) then raise exception 'REVIEWER_UNAVAILABLE'; end if;
  if g.teacher_id is not distinct from p_teacher_id and g.support_id is not distinct from p_support_id then return g.version; end if;
  update public.student_profile_review_groups set teacher_id=p_teacher_id,support_id=p_support_id,version=version+1 where id=g.id;
  insert into public.student_profile_review_events(group_id,scope,before_data,after_data,recorded_by)
    values(g.id,'assignment',jsonb_build_object('teacher',g.teacher_id,'support',g.support_id,'version',g.version),
      jsonb_build_object('teacher',p_teacher_id,'support',p_support_id,'version',g.version+1),auth.uid());
  return g.version+1;
end $$;

create function public.save_student_profile_review(p_item_id uuid, p_scope text, p_expected_version integer, p_answers jsonb)
returns public.student_profile_review_responses language plpgsql security definer set search_path=public,pg_temp as $$
declare
  i public.student_profile_review_items;
  old_row public.student_profile_review_responses;
  result public.student_profile_review_responses;
  entry record;
  current_value text;
begin
  if not coalesce(public.is_staff(auth.uid()),false) then raise exception 'FORBIDDEN'; end if;
  if p_scope is null or p_scope not in ('teacher','support') or p_expected_version is null or p_expected_version<0
    or p_answers is null or jsonb_typeof(p_answers)<>'object' or p_answers='{}'::jsonb then raise exception 'VALIDATION'; end if;
  select * into i from public.student_profile_review_items where id=p_item_id;
  if not found then raise exception 'FORBIDDEN'; end if;
  -- 分配变更与保存串行；撤销分配立即撤销该班反馈权限。
  perform 1 from public.student_profile_review_groups where id=i.group_id for share;
  if not public.can_read_student_profile_review(i.group_id,p_scope) then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.student_profile_review_items where id=i.id for update;
  select * into old_row from public.student_profile_review_responses where item_id=i.id and scope=p_scope;
  for entry in select key,value from jsonb_each(p_answers) loop
    if entry.key not in ('name','grade','class','enrollment','contact')
      or (entry.key='contact' and (p_scope<>'support' or not i.needs_contact))
      or jsonb_typeof(entry.value)<>'object'
      or (entry.value - array['answer','value'])<>'{}'::jsonb
      or coalesce(entry.value->>'answer','') not in ('yes','correction','unknown')
      or (entry.value ? 'value' and jsonb_typeof(entry.value->'value')<>'string')
      or char_length(coalesce(entry.value->>'value',''))>500
      or (entry.value->>'answer'='correction' and btrim(coalesce(entry.value->>'value',''))='')
      or (entry.value->>'answer'<>'correction' and coalesce(entry.value->>'value','')<>'') then raise exception 'VALIDATION'; end if;
    current_value := case entry.key when 'name' then i.name when 'grade' then i.grade
      when 'enrollment' then case when i.enrollment_state='unspecified' then '' else i.enrollment_state end
      when 'class' then (select label from public.student_profile_review_groups where id=i.group_id)
      else '' end;
    if entry.value->>'answer'='yes' and btrim(current_value)='' then raise exception 'VALIDATION'; end if;
  end loop;
  -- 相同提交可安全重试；其他旧版本提交要求重新读取。
  if old_row.version is not null and old_row.answers = coalesce(old_row.answers,'{}') || p_answers then return old_row; end if;
  if p_expected_version is distinct from coalesce(old_row.version,0) then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.student_profile_review_responses(item_id,scope,answers,version,recorded_by)
    values(i.id,p_scope,coalesce(old_row.answers,'{}') || p_answers,coalesce(old_row.version,0)+1,auth.uid())
    on conflict(item_id,scope) do update set answers=excluded.answers,version=excluded.version,recorded_by=excluded.recorded_by,recorded_at=now()
    returning * into result;
  insert into public.student_profile_review_events(group_id,item_id,scope,before_data,after_data,recorded_by)
    values(i.group_id,i.id,p_scope,to_jsonb(old_row),to_jsonb(result),auth.uid());
  return result;
end $$;

revoke all on function public.can_read_student_profile_review(uuid,text),
  public.assign_student_profile_review(uuid,uuid,uuid,integer), public.save_student_profile_review(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.can_read_student_profile_review(uuid,text),
  public.assign_student_profile_review(uuid,uuid,uuid,integer), public.save_student_profile_review(uuid,text,integer,jsonb) to authenticated;
