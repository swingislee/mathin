-- 来源原文与待定候选始终保留；实际使用资料时记录人工归属及操作来源。
create table public.history_import_identity_candidates (
  record_id text not null references public.history_import_records(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  primary key(record_id,student_id)
);
create index history_import_identity_candidates_student_idx on public.history_import_identity_candidates(student_id,record_id);
create table public.history_import_associations (
  record_id text primary key references public.history_import_records(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  version integer not null check(version>0),
  context text not null check(context in ('student_profile','followup','activity','assessment','enrollment','renewal')),
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default clock_timestamp()
);
create index history_import_associations_student_idx on public.history_import_associations(student_id,record_id);
create table public.history_import_association_events (
  id uuid primary key default gen_random_uuid(),
  record_id text not null references public.history_import_records(id) on delete restrict,
  before_data jsonb not null,
  after_data jsonb not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp()
);
create trigger history_import_association_events_immutable before update or delete on public.history_import_association_events
for each row execute function public.guard_communication_record_revision();
alter table public.history_import_identity_candidates enable row level security;
alter table public.history_import_associations enable row level security;
alter table public.history_import_association_events enable row level security;

create function public.can_confirm_history_source() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(auth.uid()) and public.staff_has_perm(auth.uid(),'student.edit') and public.staff_has_perm(auth.uid(),'student.view.all');
$$;
create function public.history_source_is_shared(p_data jsonb) returns boolean language sql immutable set search_path=public,pg_temp as $$
  select exists(select 1 from jsonb_array_elements(p_data->'cells') c where regexp_replace(c->>'fieldName','\s*\[[A-Z]+\]$','') in ('满班人数','已报在读/人数','剩余名额','已报/预招'))
    and not exists(select 1 from jsonb_array_elements(p_data->'cells') c where regexp_replace(c->>'fieldName','\s*\[[A-Z]+\]$','') in ('学生ID','学员ID') and c->>'text' ~ '^\d+$');
$$;
create policy history_source_candidates_read on public.history_import_identity_candidates for select to authenticated using(public.can_confirm_history_source());
create policy history_source_associations_read on public.history_import_associations for select to authenticated using(public.is_staff(auth.uid()) and public.can_access_student(student_id,auth.uid()));
create policy history_source_events_admin_read on public.history_import_association_events for select to authenticated using(public.is_admin(auth.uid()));
revoke all on public.history_import_identity_candidates,public.history_import_associations,public.history_import_association_events from public,anon,authenticated,service_role;
grant select on public.history_import_identity_candidates,public.history_import_associations,public.history_import_association_events to authenticated;

create function public.get_student_source_archive(p_student_id uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare batch uuid; result jsonb; total bigint;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.is_staff(auth.uid()) or not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN';end if;
  if p_page is null or p_page<1 or p_page>100000 then raise exception 'VALIDATION';end if;
  select id into batch from public.history_import_batches where manifest->>'mode'='complete_source_import' order by imported_at desc limit 1;
  with scoped as (
    select h.id,h.record_data,h.source_data,coalesce(a.student_id,h.student_id)=p_student_id linked,coalesce(a.version,0) version
    from public.history_import_batch_records br join public.history_import_records h on h.id=br.record_id
    left join public.history_import_associations a on a.record_id=h.id
    where br.batch_id=batch and h.record_data->>'hasContent'='true' and (
      coalesce(a.student_id,h.student_id)=p_student_id or (a.record_id is null and h.student_id is null and h.lead_id is null
      and public.can_confirm_history_source() and not public.history_source_is_shared(h.record_data) and exists(select 1 from public.history_import_identity_candidates c where c.record_id=h.id and c.student_id=p_student_id)))
  ), paged as (select * from scoped order by case source_data->>'format' when 'feishu-base' then 0 else 1 end,linked desc nulls last,record_data->>'tableName',id offset (p_page-1)*20 limit 20)
  select (select count(*) from scoped),coalesce(jsonb_agg(jsonb_build_object('id',id,'title',record_data->>'tableName','source',source_data->>'filename',
    'name',record_data->>'label','dateLabel',record_data->>'dateLabel','linked',coalesce(linked,false),'version',version,
    'cells',(select coalesce(jsonb_agg(jsonb_build_object('name',c->>'fieldName','text',c->>'text')),'[]') from jsonb_array_elements(record_data->'cells') c where c->>'kind'<>'system' and btrim(coalesce(c->>'text',''))<>'')) order by case source_data->>'format' when 'feishu-base' then 0 else 1 end,linked desc nulls last,record_data->>'tableName',id),'[]') into total,result from paged;
  return jsonb_build_object('rows',result,'total',total,'page',p_page,'pageSize',20,'canConfirm',public.can_confirm_history_source());
end;
$$;

create function public.get_history_source_context(p_record_id text,p_student_id uuid default null,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare source public.history_import_records; association public.history_import_associations; target uuid; options jsonb; can_confirm boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.is_staff(auth.uid()) then raise exception 'FORBIDDEN';end if;
  if p_record_id is null or length(p_record_id)>160 or p_query is null or length(p_query)>100 then raise exception 'VALIDATION';end if;
  select * into source from public.history_import_records where id=p_record_id;
  if source.id is null or source.match_data->>'reason'='non_student_source' then raise exception 'NOT_FOUND';end if;
  select * into association from public.history_import_associations where record_id=p_record_id;
  target:=coalesce(association.student_id,source.student_id);can_confirm:=public.can_confirm_history_source();
  if target is not null then
    if not public.can_access_student(target,auth.uid()) or (p_student_id is not null and p_student_id<>target) then raise exception 'FORBIDDEN';end if;
  elsif not can_confirm then raise exception 'FORBIDDEN';end if;
  if p_student_id is not null and not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'grade',s.grade,'phone',coalesce(nullif(s.parent_phone,''),s.phone)) order by s.name,s.id),'[]') into options from (
    select s.id,s.name,s.grade,s.phone,s.parent_phone from public.students s
    where s.deleted_at is null and public.can_access_student(s.id,auth.uid()) and (
      (target is not null and s.id=target) or (target is null and (
        (p_student_id is not null and s.id=p_student_id) or
        (p_student_id is null and length(btrim(p_query))>=2 and (s.name ilike '%'||btrim(p_query)||'%' or s.phone ilike '%'||btrim(p_query)||'%' or s.parent_phone ilike '%'||btrim(p_query)||'%')) or
        (p_student_id is null and btrim(p_query)='' and exists(select 1 from public.history_import_identity_candidates c where c.record_id=p_record_id and c.student_id=s.id)))))
    order by s.name,s.id limit 25
  ) s;
  return jsonb_build_object('recordId',source.id,'title',source.record_data->>'tableName','source',source.source_data->>'filename','name',source.record_data->>'label',
    'studentId',target,'version',coalesce(association.version,0),'canConfirm',can_confirm and source.student_id is null and source.lead_id is null and not public.history_source_is_shared(source.record_data),
    'students',options,'cells',(select coalesce(jsonb_agg(jsonb_build_object('name',c->>'fieldName','text',c->>'text')),'[]') from jsonb_array_elements(source.record_data->'cells') c where c->>'kind'<>'system' and btrim(coalesce(c->>'text',''))<>''));
end;
$$;

alter table public.student_follow_ups add column context_source_record_id text references public.history_import_records(id) on delete restrict;
grant select(context_source_record_id),insert(context_source_record_id) on public.student_follow_ups to authenticated;
create index student_follow_ups_context_source_idx on public.student_follow_ups(context_source_record_id) where context_source_record_id is not null;

create function public.confirm_history_source(p_record_id text,p_student_id uuid,p_expected_version integer,p_context text default 'student_profile') returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare source public.history_import_records; previous public.history_import_associations; saved public.history_import_associations;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.can_confirm_history_source() or not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN';end if;
  if p_record_id is null or length(p_record_id)>160 or p_student_id is null or p_expected_version is null or p_expected_version<0
    or p_context is null or p_context not in ('student_profile','followup','activity','assessment','enrollment','renewal') then raise exception 'VALIDATION';end if;
  if not exists(select 1 from public.students where id=p_student_id and deleted_at is null) then raise exception 'NOT_FOUND';end if;
  select * into source from public.history_import_records where id=p_record_id for update;
  if source.id is null or source.match_data->>'reason'='non_student_source' then raise exception 'NOT_FOUND';end if;
  if public.history_source_is_shared(source.record_data) then raise exception 'SOURCE_SHARED_RECORD';end if;
  if source.student_id is not null or source.lead_id is not null then
    if source.student_id=p_student_id then return 0;end if;
    raise exception 'SOURCE_ALREADY_LINKED';
  end if;
  select * into previous from public.history_import_associations where record_id=p_record_id for update;
  if previous.student_id=p_student_id and previous.version in (p_expected_version,p_expected_version+1) then return previous.version;end if;
  if coalesce(previous.version,0)<>p_expected_version then raise exception 'VERSION_CONFLICT';end if;
  if previous.student_id is not null and previous.student_id<>p_student_id and exists(select 1 from public.student_follow_ups where context_source_record_id=p_record_id) then raise exception 'SOURCE_IN_USE';end if;
  insert into public.history_import_associations(record_id,student_id,version,context,confirmed_by)
    values(p_record_id,p_student_id,p_expected_version+1,p_context,auth.uid())
    on conflict(record_id) do update set student_id=excluded.student_id,version=excluded.version,context=excluded.context,confirmed_by=excluded.confirmed_by,confirmed_at=clock_timestamp()
    returning * into saved;
  insert into public.history_import_association_events(record_id,before_data,after_data,recorded_by)
    values(p_record_id,coalesce(to_jsonb(previous),'{}'),to_jsonb(saved),auth.uid());
  return saved.version;
end;
$$;

create function public.guard_followup_source_context() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;
begin
  if tg_op='UPDATE' and new.context_source_record_id is distinct from old.context_source_record_id then raise exception 'SOURCE_CONTEXT_IMMUTABLE';end if;
  if new.context_source_record_id is null then return new;end if;
  if new.record_state<>'current' or not public.is_staff(auth.uid()) or not public.can_access_student(new.student_id,auth.uid()) then raise exception 'FORBIDDEN';end if;
  perform 1 from public.history_import_records where id=new.context_source_record_id for share;
  select coalesce(a.student_id,h.student_id) into target from public.history_import_records h left join public.history_import_associations a on a.record_id=h.id where h.id=new.context_source_record_id;
  if target is distinct from new.student_id then raise exception 'SOURCE_ASSOCIATION_REQUIRED';end if;
  return new;
end;
$$;
create trigger student_follow_ups_source_context before insert or update on public.student_follow_ups for each row execute function public.guard_followup_source_context();
revoke all on function public.can_confirm_history_source(),public.history_source_is_shared(jsonb),public.get_student_source_archive(uuid,integer),public.get_history_source_context(text,uuid,text),public.confirm_history_source(text,uuid,integer,text),public.guard_followup_source_context() from public,anon,authenticated,service_role;
grant execute on function public.can_confirm_history_source(),public.get_student_source_archive(uuid,integer),public.get_history_source_context(text,uuid,text),public.confirm_history_source(text,uuid,integer,text) to authenticated;
