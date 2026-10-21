create table public.learning_mistake_rules (
  singleton boolean primary key default true check(singleton), version integer not null default 1,
  enabled boolean not null default false, classroom_enabled boolean not null default true, homework_enabled boolean not null default true,
  statuses text[] not null default array['prompted','imitated','incomplete'],
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id),
  check(cardinality(statuses) between 1 and 6 and statuses <@ array['explained','independent','prompted','imitated','incomplete','unchecked']::text[])
);
insert into public.learning_mistake_rules(singleton) values(true);
create index assignment_question_results_student_marked_idx on public.assignment_question_results(student_id,marked_at desc,question_id);
-- Classroom "unchecked" is represented by deleting a mark. Remember only explicit resets;
-- never manufacture observations for all children and questions with no recorded result.
create table public.learning_mistake_classroom_resets (
  check_id uuid not null references public.session_learning_checks(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  marked_at timestamptz not null default now(), marked_by uuid references public.profiles(id),
  primary key(check_id,student_id)
);
alter table public.learning_mistake_rules enable row level security;
alter table public.learning_mistake_classroom_resets enable row level security;
revoke all on public.learning_mistake_rules,public.learning_mistake_classroom_resets from public,anon,authenticated;
grant select on public.learning_mistake_rules,public.learning_mistake_classroom_resets to authenticated;
create policy learning_mistake_rules_staff on public.learning_mistake_rules for select to authenticated using(public.has_perm(auth.uid(),'organization.profile.manage'));
create policy learning_mistake_resets_read on public.learning_mistake_classroom_resets for select to authenticated using(public.can_read_learning_rewards(student_id));

create function mathin_internal.track_learning_check_reset() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    -- A cascading removal of the question does not create a new observation.
    if exists(select 1 from session_learning_checks where id=old.check_id) then
      insert into learning_mistake_classroom_resets(check_id,student_id,marked_at,marked_by)
        values(old.check_id,old.student_id,clock_timestamp(),coalesce(auth.uid(),old.marked_by))
        on conflict(check_id,student_id) do update set marked_at=excluded.marked_at,marked_by=excluded.marked_by;
    end if;
  else
    delete from learning_mistake_classroom_resets where check_id=new.check_id and student_id=new.student_id;
  end if;
  return null;
end $$;
create trigger session_learning_check_reset_tracking after insert or update or delete on public.session_learning_check_results
  for each row execute function mathin_internal.track_learning_check_reset();

create function public.save_learning_mistake_rules(p_version integer,p_enabled boolean,p_classroom boolean,p_homework boolean,p_statuses text[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved learning_mistake_rules;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_version is null or p_enabled is null or p_classroom is null or p_homework is null or p_statuses is null
    or cardinality(p_statuses) not between 1 and 6 or array_position(p_statuses,null) is not null
    or not p_statuses <@ array['explained','independent','prompted','imitated','incomplete','unchecked']::text[]
    or (select count(distinct s) from unnest(p_statuses) s)<>cardinality(p_statuses) then raise exception 'VALIDATION'; end if;
  select * into saved from learning_mistake_rules where singleton for update;
  if saved.version<>p_version then raise exception 'FORM_CHANGED'; end if;
  update learning_mistake_rules set version=version+1,enabled=p_enabled,classroom_enabled=p_classroom,homework_enabled=p_homework,
    statuses=p_statuses,updated_at=now(),updated_by=auth.uid() where singleton returning * into saved;
  return to_jsonb(saved);
end $$;

create function mathin_internal.learning_mistake_records(p_student uuid)
returns table(id text,kind text,question_id uuid,title text,source_id uuid,source_title text,classroom_name text,
  lesson_at timestamptz,status text,note text,marked_at timestamptz,source_page uuid,instructions text)
language sql stable set search_path=public,pg_temp as $$
  with classroom_marks as (
    select check_id,status,marked_at from session_learning_check_results where student_id=p_student
    union all
    select x.check_id,'unchecked',x.marked_at from learning_mistake_classroom_resets x where x.student_id=p_student
      and not exists(select 1 from session_learning_check_results r where r.check_id=x.check_id and r.student_id=p_student)
  )
  select 'classroom:'||q.id::text,'classroom',q.id,q.title,s.id,s.title,c.name,coalesce(s.scheduled_at,s.ended_at),
    r.status,''::text,r.marked_at,q.source_page_doc_id,''::text
    from classroom_marks r join session_learning_checks q on q.id=r.check_id
    join class_sessions s on s.id=q.session_id join classrooms c on c.id=s.classroom_id
    where s.ended_at is not null and s.deleted_at is null and s.voided_at is null and c.trashed_at is null
  union all
  select 'homework:'||q.id::text,'homework',q.id,q.title,a.id,a.title,c.name,coalesce(s.scheduled_at,a.due_at,a.created_at),
    r.status,r.note,r.marked_at,null::uuid,coalesce(a.content->>'text','')
    from assignment_question_results r join assignment_questions q on q.id=r.question_id
    join assignments a on a.id=q.assignment_id join classrooms c on c.id=a.classroom_id left join class_sessions s on s.id=a.session_id
    where r.student_id=p_student and c.trashed_at is null and (a.session_id is null or s.deleted_at is null and s.voided_at is null)
$$;

create function public.read_learning_mistake_rules() returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  return (select to_jsonb(r) from learning_mistake_rules r where singleton);
end $$;

create function public.read_learning_mistakes(p_student uuid,p_before text default null,p_item text default null,p_kind text default '',p_status text default '') returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare rules learning_mistake_rules; boundary_at timestamptz; boundary_id text; rows jsonb; is_staff boolean;
begin
  if not public.can_read_learning_rewards(p_student) then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from students where id=p_student and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  if p_kind is null or p_kind not in ('','classroom','homework') or p_status is null
    or p_status not in ('','explained','independent','prompted','imitated','incomplete','unchecked')
    or (p_before is not null and p_before !~ '^(classroom|homework):[0-9a-fA-F-]{36}$')
    or (p_item is not null and p_item !~ '^(classroom|homework):[0-9a-fA-F-]{36}$') then raise exception 'VALIDATION'; end if;
  select * into rules from learning_mistake_rules where singleton;
  is_staff:=coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false);
  if not rules.enabled and not is_staff then return jsonb_build_object('enabled',false,'items','[]'::jsonb,'next',null,'rules',to_jsonb(rules)-'updated_by'); end if;
  if p_item is not null then
    select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('included',r.status=any(rules.statuses)
      and case r.kind when 'classroom' then rules.classroom_enabled else rules.homework_enabled end)),'[]') into rows
      from mathin_internal.learning_mistake_records(p_student) r where r.id=p_item;
    if jsonb_array_length(rows)=0 then raise exception 'NOT_FOUND'; end if;
  else
    if p_before is not null then
      select marked_at,id into boundary_at,boundary_id from mathin_internal.learning_mistake_records(p_student) where id=p_before;
      if not found then raise exception 'NOT_FOUND'; end if;
    end if;
    select coalesce(jsonb_agg(to_jsonb(r)-'instructions' order by r.marked_at desc,r.id desc),'[]') into rows from (
      select x.*,true as included from mathin_internal.learning_mistake_records(p_student) x
        where x.status=any(rules.statuses) and case x.kind when 'classroom' then rules.classroom_enabled else rules.homework_enabled end
        and (p_kind='' or x.kind=p_kind) and (p_status='' or x.status=p_status)
        and (p_before is null or (x.marked_at,x.id)<(boundary_at,boundary_id))
        order by x.marked_at desc,x.id desc limit 30
    ) r;
  end if;
  return jsonb_build_object('enabled',rules.enabled,'items',rows,'next',case when p_item is null and jsonb_array_length(rows)=30 then rows->29->>'id' end,
    'rules',to_jsonb(rules)-'updated_by');
end $$;

revoke all on function mathin_internal.track_learning_check_reset(),mathin_internal.learning_mistake_records(uuid) from public,anon,authenticated;
revoke all on function public.read_learning_mistake_rules(),public.save_learning_mistake_rules(integer,boolean,boolean,boolean,text[]),public.read_learning_mistakes(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.read_learning_mistake_rules(),public.save_learning_mistake_rules(integer,boolean,boolean,boolean,text[]),public.read_learning_mistakes(uuid,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
