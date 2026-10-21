-- Learning points are append-only facts. Existing stars and marks are not backfilled.
create table public.learning_reward_rules (
  singleton boolean primary key default true check(singleton),
  version integer not null default 1,
  recording_started_at timestamptz not null default now(),
  stars_enabled boolean not null default false,
  points_per_star integer not null default 1 check(points_per_star between 0 and 10000),
  homework_enabled boolean not null default false,
  homework_points integer not null default 5 check(homework_points between 0 and 10000),
  homework_statuses text[] not null default array['explained','independent']::text[]
    check(cardinality(homework_statuses) between 1 and 5 and homework_statuses <@ array['explained','independent','prompted','imitated','incomplete']::text[]),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.learning_reward_rules(singleton) values(true);
create table public.learning_reward_accounts (
  student_id uuid primary key references public.students(id) on delete restrict,
  balance bigint not null default 0
);
create table public.learning_reward_ledger (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  source text not null check(source in ('star','star_undo','homework','manual','manual_undo','redeem','draw')),
  source_key text not null check(length(source_key) between 1 and 200),
  amount integer not null,
  balance_after bigint not null,
  note text not null default '' check(length(note)<=500),
  snapshot jsonb not null default '{}' check(jsonb_typeof(snapshot)='object'),
  actor_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(student_id,source,source_key)
);
create index learning_reward_ledger_student on public.learning_reward_ledger(student_id,created_at desc,id desc);
create trigger learning_reward_ledger_immutable before update or delete on public.learning_reward_ledger
  for each row execute function public.reject_immutable_security_row();

create function public.can_read_learning_rewards(p_student uuid) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(public.has_perm(auth.uid(),'organization.profile.manage') or public.miniapp_can_participate(p_student,'grades'),false);
$$;
alter table public.learning_reward_rules enable row level security;
alter table public.learning_reward_accounts enable row level security;
alter table public.learning_reward_ledger enable row level security;
revoke all on public.learning_reward_rules,public.learning_reward_accounts,public.learning_reward_ledger from public,anon,authenticated;
grant select on public.learning_reward_rules,public.learning_reward_accounts,public.learning_reward_ledger to authenticated;
create policy learning_reward_rules_read on public.learning_reward_rules for select to authenticated using(public.has_perm(auth.uid(),'organization.profile.manage'));
create policy learning_reward_accounts_read on public.learning_reward_accounts for select to authenticated using(public.can_read_learning_rewards(student_id));
create policy learning_reward_ledger_read on public.learning_reward_ledger for select to authenticated using(public.can_read_learning_rewards(student_id));

-- Every writer (including later redemption/draw commands) shares this per-child lock.
create function mathin_internal.lock_learning_rewards(p_student uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_student is null then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('learning-rewards:'||p_student::text,0));
  insert into learning_reward_accounts(student_id) values(p_student) on conflict do nothing;
end $$;

create function mathin_internal.append_learning_reward(p_id uuid,p_student uuid,p_source text,p_key text,p_amount integer,p_note text,p_snapshot jsonb,p_actor uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare existing uuid; total bigint;
begin
  perform mathin_internal.lock_learning_rewards(p_student);
  select id into existing from learning_reward_ledger where student_id=p_student and source=p_source and source_key=p_key;
  if existing is not null then return existing; end if;
  update learning_reward_accounts set balance=balance+p_amount where student_id=p_student returning balance into total;
  insert into learning_reward_ledger(id,student_id,source,source_key,amount,balance_after,note,snapshot,actor_id)
    values(p_id,p_student,p_source,p_key,p_amount,total,p_note,p_snapshot,p_actor);
  return p_id;
end $$;

create function public.save_learning_reward_rules(p_version integer,p_stars_enabled boolean,p_points_per_star integer,p_homework_enabled boolean,p_homework_points integer,p_homework_statuses text[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r learning_reward_rules;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select * into r from learning_reward_rules where singleton for update;
  if p_version is distinct from r.version then raise exception 'FORM_CHANGED'; end if;
  if p_stars_enabled is null or p_homework_enabled is null or p_points_per_star is null or p_homework_points is null
    or p_points_per_star not between 0 and 10000 or p_homework_points not between 0 and 10000
    or p_homework_statuses is null or cardinality(p_homework_statuses) not between 1 and 5
    or array_position(p_homework_statuses,null) is not null
    or not p_homework_statuses <@ array['explained','independent','prompted','imitated','incomplete']::text[] then raise exception 'VALIDATION'; end if;
  update learning_reward_rules set version=version+1,stars_enabled=p_stars_enabled,points_per_star=p_points_per_star,
    homework_enabled=p_homework_enabled,homework_points=p_homework_points,homework_statuses=p_homework_statuses,updated_at=now(),updated_by=auth.uid()
    where singleton returning * into r;
  return to_jsonb(r);
end $$;

create function mathin_internal.reward_star_event() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid; k text; r learning_reward_rules; awarded learning_reward_ledger; points integer:=0;
begin
  -- Legacy events identify login accounts, not stable children. They remain in star totals only.
  if new.type not in ('star','star_undo') or new.payload->'schemaVersion' is distinct from '2'::jsonb then return new; end if;
  sid:=(new.payload->>'studentId')::uuid;
  if sid is null or nullif(new.payload->>'awardId','') is null then return new; end if;
  k:=new.session_id::text||':'||(new.payload->>'awardId');
  perform mathin_internal.lock_learning_rewards(sid);
  select * into r from learning_reward_rules where singleton;
  if new.type='star' then
    if r.stars_enabled and not exists(select 1 from learning_reward_ledger where student_id=sid and source='star_undo' and source_key=k)
      and not exists(select 1 from session_events where created_at<r.recording_started_at and session_id=new.session_id and type='star'
          and payload->'schemaVersion'='2'::jsonb and payload->>'studentId'=sid::text and payload->>'awardId'=new.payload->>'awardId')
      and not exists(select 1 from session_events where session_id=new.session_id and type='star_undo'
        and payload->'schemaVersion'='2'::jsonb and payload->>'studentId'=sid::text and payload->>'awardId'=new.payload->>'awardId')
      then points:=r.points_per_star; end if;
    perform mathin_internal.append_learning_reward(gen_random_uuid(),sid,'star',k,points,'课堂星星',
      jsonb_build_object('rule',to_jsonb(r),'sessionId',new.session_id,'awardId',new.payload->>'awardId'),new.user_id);
  else
    select * into awarded from learning_reward_ledger where student_id=sid and source='star' and source_key=k;
    perform mathin_internal.append_learning_reward(gen_random_uuid(),sid,'star_undo',k,-coalesce(awarded.amount,0),'课堂星星撤销',
      jsonb_build_object('originalId',awarded.id,'originalRule',awarded.snapshot->'rule'),new.user_id);
  end if;
  return new;
end $$;
create trigger session_events_learning_rewards after insert on public.session_events for each row
  when(new.type in ('star','star_undo')) execute function mathin_internal.reward_star_event();

create function mathin_internal.reward_homework_mark() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare r learning_reward_rules; aid uuid; title text;
begin
  if tg_op='UPDATE' and new.status=old.status then return new; end if;
  perform mathin_internal.lock_learning_rewards(new.student_id);
  select * into r from learning_reward_rules where singleton;
  if not new.status=any(r.homework_statuses) then return new; end if;
  if tg_op='UPDATE' and old.status=any(r.homework_statuses) then return new; end if;
  select q.assignment_id,a.title into aid,title from assignment_questions q join assignments a on a.id=q.assignment_id where q.id=new.question_id;
  if exists(select 1 from assignment_questions q left join assignment_question_results x on x.question_id=q.id and x.student_id=new.student_id
    where q.assignment_id=aid and (x.status is null or not x.status=any(r.homework_statuses))) then return new; end if;
  perform mathin_internal.append_learning_reward(gen_random_uuid(),new.student_id,'homework',aid::text,
    case when r.homework_enabled then r.homework_points else 0 end,'作业奖励：'||left(title,400),
    jsonb_build_object('rule',to_jsonb(r),'assignmentId',aid,'title',title),new.marked_by);
  return new;
end $$;
create trigger assignment_results_learning_rewards after insert or update on public.assignment_question_results for each row
  execute function mathin_internal.reward_homework_mark();

create function public.grant_learning_points(p_id uuid,p_student uuid,p_amount integer,p_note text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare previous learning_reward_ledger;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_student is null or p_amount is null or p_amount not between 1 and 1000000 or p_note is null or length(btrim(p_note)) not between 1 and 500 then raise exception 'VALIDATION'; end if;
  if not exists(select 1 from students where id=p_student and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-request:'||p_id::text,0));
  select * into previous from learning_reward_ledger where id=p_id;
  if found then
    if previous.student_id<>p_student or previous.source<>'manual' or previous.amount<>p_amount or previous.note<>btrim(p_note) or previous.actor_id<>auth.uid() then raise exception 'CONFLICT'; end if;
    return previous.id;
  end if;
  return mathin_internal.append_learning_reward(p_id,p_student,'manual',p_id::text,p_amount,btrim(p_note),'{}',auth.uid());
end $$;

create function public.reverse_learning_points(p_entry uuid,p_note text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare original learning_reward_ledger;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_note is null or length(btrim(p_note)) not between 1 and 500 then raise exception 'VALIDATION'; end if;
  select * into original from learning_reward_ledger where id=p_entry and source='manual' and amount>0;
  if not found then raise exception 'NOT_FOUND'; end if;
  return mathin_internal.append_learning_reward(gen_random_uuid(),original.student_id,'manual_undo',original.id::text,-original.amount,btrim(p_note),jsonb_build_object('originalId',original.id),auth.uid());
end $$;

create function public.read_learning_points(p_student uuid,p_before uuid default null) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare total bigint; boundary learning_reward_ledger; rows jsonb; next_id uuid; rules learning_reward_rules;
begin
  if not public.can_read_learning_rewards(p_student) then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from students where id=p_student and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  select balance into total from learning_reward_accounts where student_id=p_student;
  if p_before is not null then
    select * into boundary from learning_reward_ledger where id=p_before and student_id=p_student;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into rows from (
    select id,source,amount,balance_after,note,created_at,snapshot from learning_reward_ledger where student_id=p_student and amount<>0
      and (p_before is null or (created_at,id)<(boundary.created_at,boundary.id)) order by created_at desc,id desc limit 30
  ) x;
  if jsonb_array_length(rows)=30 then next_id:=(rows->29->>'id')::uuid; end if;
  select * into rules from learning_reward_rules where singleton;
  return jsonb_build_object('balance',coalesce(total,0),'available',greatest(coalesce(total,0),0),'entries',rows,'next',next_id,
    'rules',jsonb_build_object('starsEnabled',rules.stars_enabled,'pointsPerStar',rules.points_per_star,
      'homeworkEnabled',rules.homework_enabled,'homeworkPoints',rules.homework_points,'homeworkStatuses',rules.homework_statuses));
end $$;

revoke all on function mathin_internal.lock_learning_rewards(uuid),mathin_internal.append_learning_reward(uuid,uuid,text,text,integer,text,jsonb,uuid),
  mathin_internal.reward_star_event(),mathin_internal.reward_homework_mark() from public,anon,authenticated;
revoke all on function public.can_read_learning_rewards(uuid),public.save_learning_reward_rules(integer,boolean,integer,boolean,integer,text[]),
  public.grant_learning_points(uuid,uuid,integer,text),public.reverse_learning_points(uuid,text),public.read_learning_points(uuid,uuid) from public,anon,authenticated;
grant execute on function public.can_read_learning_rewards(uuid),public.save_learning_reward_rules(integer,boolean,integer,boolean,integer,text[]),
  public.grant_learning_points(uuid,uuid,integer,text),public.reverse_learning_points(uuid,text),public.read_learning_points(uuid,uuid) to authenticated;
comment on table public.learning_reward_ledger is '不可变积分流水；零额记录是防重复凭据。撤销按原额冲回；负余额待后续收入抵扣，消费只使用正余额。';
notify pgrst,'reload schema';
