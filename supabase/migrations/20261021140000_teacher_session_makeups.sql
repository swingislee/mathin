-- 老师在原课下保存补课事实；补课不改写原课名单、考勤或学情。
create function public.can_record_session_makeup(p_session_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_amend_session_learning(p_session_id, p_uid);
$$;
revoke all on function public.can_record_session_makeup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.can_record_session_makeup(uuid,uuid) to authenticated;

create table public.session_makeup_records (
  id uuid primary key,
  session_id uuid not null references public.class_sessions(id) on delete restrict,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index session_makeup_records_session on public.session_makeup_records(session_id,created_at,id);
alter table public.session_makeup_records enable row level security;
revoke all on public.session_makeup_records from public,anon,authenticated;
grant select on public.session_makeup_records to authenticated;
create policy session_makeup_records_read on public.session_makeup_records for select to authenticated
  using(public.can_record_session_makeup(session_id,(select auth.uid())));

create function public.read_session_makeups(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ids uuid[];
begin
  if auth.uid() is null or not public.can_record_session_makeup(p_session_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
  ids := public.session_communication_student_ids(p_session_id);
  return jsonb_build_object(
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'attendance',a.status) order by s.name,s.id)
      from public.students s left join public.session_attendance a on a.session_id=p_session_id and a.student_id=s.id
      where s.id=any(ids)),'[]'::jsonb),
    'checks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title) order by position)
      from public.session_learning_checks where session_id=p_session_id),'[]'::jsonb),
    'records',coalesce((select jsonb_agg(m.record || jsonb_build_object('id',m.id,'revision',m.revision,
      'recordedBy',coalesce(p.display_name,''),'updatedAt',m.updated_at) order by m.created_at desc,m.id)
      from public.session_makeup_records m left join public.profiles p on p.id=m.created_by where m.session_id=p_session_id),'[]'::jsonb)
  );
end $$;

create function public.save_session_makeup(p_id uuid,p_session_id uuid,p_expected_revision integer,p_record jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid:=auth.uid(); existing public.session_makeup_records%rowtype; ids uuid[]; check_ids uuid[];
  item jsonb; result_item jsonb; student_key uuid; check_key uuid; selected_ids uuid[]:='{}';
  normalized_checks jsonb:='[]'; normalized_students jsonb:='[]'; observations jsonb; normalized jsonb;
  title_value text; note_value text; name_value text; time_value timestamptz; duration_value integer; state_value text;
begin
  if actor is null or not public.can_record_session_makeup(p_session_id,actor) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0
    or jsonb_typeof(p_record) is distinct from 'object' or octet_length(p_record::text)>1048576 then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('session-makeup:'||p_id::text,0));
  select * into existing from public.session_makeup_records where id=p_id for update;
  if existing.id is not null and existing.session_id<>p_session_id then raise exception 'FORBIDDEN'; end if;
  time_value:=(p_record->>'scheduledAt')::timestamptz;
  duration_value:=(p_record->>'durationMin')::integer;
  state_value:=p_record->>'status'; note_value:=btrim(coalesce(p_record->>'note',''));
  if time_value is null or not isfinite(time_value) or duration_value is null or duration_value not between 1 and 480
    or state_value is null or state_value not in ('planned','completed') or char_length(note_value)>2000
    or jsonb_typeof(p_record->'checks') is distinct from 'array'
    or jsonb_typeof(p_record->'students') is distinct from 'array' then raise exception 'VALIDATION'; end if;
  if jsonb_array_length(p_record->'checks')>30 or jsonb_array_length(p_record->'students') not between 1 and 200 then raise exception 'VALIDATION'; end if;
  check_ids:='{}';
  for item in select value from jsonb_array_elements(p_record->'checks') loop
    check_key:=(item->>'id')::uuid; title_value:=btrim(item->>'title');
    if check_key is null or check_key=any(check_ids) or title_value is null or char_length(title_value) not between 1 and 100 then raise exception 'VALIDATION'; end if;
    check_ids:=array_append(check_ids,check_key);
    normalized_checks:=normalized_checks||jsonb_build_array(jsonb_build_object('id',check_key,'title',title_value));
  end loop;
  ids:=public.session_communication_student_ids(p_session_id);
  for item in select value from jsonb_array_elements(p_record->'students') loop
    student_key:=(item->>'studentId')::uuid;
    if student_key is null or not(student_key=any(ids)) or student_key=any(selected_ids) then raise exception 'STUDENT_NOT_IN_SESSION'; end if;
    if item->>'attendance' is not null and item->>'attendance' not in ('present','absent','late','leave') then raise exception 'VALIDATION'; end if;
    if char_length(coalesce(item->>'note',''))>1000 or jsonb_typeof(item->'results') is distinct from 'array' then raise exception 'VALIDATION'; end if;
    if jsonb_array_length(item->'results')>30 or exists(select 1 from jsonb_array_elements(item->'results') r group by r->>'checkId' having count(*)>1) then raise exception 'VALIDATION'; end if;
    observations:='[]';
    for result_item in select value from jsonb_array_elements(item->'results') loop
      check_key:=(result_item->>'checkId')::uuid;
      if check_key is null or not(check_key=any(check_ids)) or result_item->>'status' is null
        or result_item->>'status' not in ('explained','independent','prompted','imitated','incomplete','unchecked') then raise exception 'VALIDATION'; end if;
      observations:=observations||jsonb_build_array(jsonb_build_object('checkId',check_key,'status',result_item->>'status'));
    end loop;
    select name into name_value from public.students where id=student_key;
    selected_ids:=array_append(selected_ids,student_key);
    normalized_students:=normalized_students||jsonb_build_array(jsonb_build_object('studentId',student_key,'name',coalesce(name_value,''),
      'attendance',item->>'attendance','note',btrim(coalesce(item->>'note','')),'results',observations));
  end loop;
  normalized:=jsonb_build_object('scheduledAt',time_value,'durationMin',duration_value,'status',state_value,'note',note_value,
    'checks',normalized_checks,'students',normalized_students);
  -- 同一客户端请求重试不会重复建记录；不同修订先核对版本。
  if existing.id is not null and existing.record=normalized then return public.read_session_makeups(p_session_id); end if;
  if existing.id is null then
    if p_expected_revision<>0 then raise exception 'CONFLICT'; end if;
    insert into public.session_makeup_records(id,session_id,record,created_by,updated_by) values(p_id,p_session_id,normalized,actor,actor);
  else
    if existing.revision<>p_expected_revision then raise exception 'CONFLICT'; end if;
    update public.session_makeup_records set record=normalized,revision=revision+1,updated_by=actor,updated_at=now() where id=p_id;
  end if;
  return public.read_session_makeups(p_session_id);
end $$;
revoke all on function public.read_session_makeups(uuid),public.save_session_makeup(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.read_session_makeups(uuid),public.save_session_makeup(uuid,uuid,integer,jsonb) to authenticated;
