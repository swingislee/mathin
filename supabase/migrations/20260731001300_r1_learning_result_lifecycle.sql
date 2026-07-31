-- R1-6: immutable learning-result revisions, review lifecycle, and stage reports.
begin;

create table public.learning_result_heads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('session_result', 'video_review', 'stage_report')),
  source_key text not null check (char_length(source_key) between 1 and 240),
  student_id uuid not null references public.students(id) on delete cascade,
  term_id uuid not null references public.school_terms(id) on delete restrict,
  session_id uuid references public.class_sessions(id) on delete cascade,
  video_id uuid references public.session_videos(id) on delete cascade,
  period_start date,
  period_end date,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'published', 'withdrawn', 'revised')),
  requires_review boolean not null default false,
  current_revision_id uuid,
  published_revision_id uuid,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  withdrawn_by uuid references public.profiles(id) on delete set null,
  withdrawn_at timestamptz,
  withdrawal_reason text check (withdrawal_reason is null or char_length(withdrawal_reason) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(kind, source_key),
  constraint learning_result_heads_source_shape check (
    (kind = 'session_result' and session_id is not null and video_id is null and period_start is null and period_end is null)
    or (kind = 'video_review' and session_id is not null and video_id is not null and period_start is null and period_end is null)
    or (kind = 'stage_report' and session_id is null and video_id is null and period_start is not null and period_end is not null and period_end >= period_start)
  ),
  constraint learning_result_heads_review_kind check (requires_review = (kind = 'stage_report'))
);

create index learning_result_heads_student_idx
  on public.learning_result_heads(student_id, kind, updated_at desc);
create index learning_result_heads_session_idx
  on public.learning_result_heads(session_id, status) where session_id is not null;
create index learning_result_heads_published_idx
  on public.learning_result_heads(student_id, kind, published_at desc) where status = 'published';

create trigger learning_result_heads_set_updated_at
  before update on public.learning_result_heads
  for each row execute function public.set_updated_at();

create table public.learning_result_revisions (
  id uuid primary key default gen_random_uuid(),
  head_id uuid not null references public.learning_result_heads(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 262144),
  metric_version text check (metric_version is null or char_length(metric_version) between 1 and 100),
  data_cutoff_at timestamptz,
  timezone text check (timezone is null or char_length(timezone) between 1 and 64),
  period_start date,
  period_end date,
  dataset jsonb not null default '{}'::jsonb
    check (jsonb_typeof(dataset) = 'object' and octet_length(dataset::text) <= 262144),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(head_id, revision_no)
);
create index learning_result_revisions_head_idx
  on public.learning_result_revisions(head_id, revision_no desc);

alter table public.learning_result_heads
  add constraint learning_result_heads_current_revision_fkey
    foreign key (current_revision_id) references public.learning_result_revisions(id) on delete set null deferrable initially deferred,
  add constraint learning_result_heads_published_revision_fkey
    foreign key (published_revision_id) references public.learning_result_revisions(id) on delete set null deferrable initially deferred;

create table public.learning_result_events (
  id uuid primary key default gen_random_uuid(),
  head_id uuid not null references public.learning_result_heads(id) on delete cascade,
  revision_id uuid references public.learning_result_revisions(id) on delete set null,
  from_status text check (from_status is null or from_status in ('draft', 'review', 'published', 'withdrawn', 'revised')),
  to_status text not null check (to_status in ('draft', 'review', 'published', 'withdrawn', 'revised')),
  reason text check (reason is null or char_length(reason) <= 1000),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index learning_result_events_head_idx
  on public.learning_result_events(head_id, created_at, id);

create or replace function public.guard_learning_result_history_immutable()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  raise exception 'LEARNING_RESULT_HISTORY_IMMUTABLE';
end
$$;

create trigger learning_result_revisions_immutable
  before update or delete on public.learning_result_revisions
  for each row execute function public.guard_learning_result_history_immutable();
create trigger learning_result_events_immutable
  before update or delete on public.learning_result_events
  for each row execute function public.guard_learning_result_history_immutable();

create or replace function public.guard_learning_result_revision_ownership()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.current_revision_id is not null and not exists (
    select 1 from public.learning_result_revisions revision_row
     where revision_row.id = new.current_revision_id and revision_row.head_id = new.id
  ) then raise exception 'CURRENT_REVISION_HEAD_MISMATCH'; end if;
  if new.published_revision_id is not null and not exists (
    select 1 from public.learning_result_revisions revision_row
     where revision_row.id = new.published_revision_id and revision_row.head_id = new.id
  ) then raise exception 'PUBLISHED_REVISION_HEAD_MISMATCH'; end if;
  return new;
end
$$;
create trigger learning_result_heads_revision_ownership
  before insert or update of current_revision_id, published_revision_id on public.learning_result_heads
  for each row execute function public.guard_learning_result_revision_ownership();

create or replace function public.validate_learning_result_revision()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
declare head_kind text;
begin
  select kind into head_kind from public.learning_result_heads where id = new.head_id;
  if head_kind is null then raise exception 'RESULT_NOT_FOUND'; end if;
  if head_kind = 'stage_report' and (
    new.metric_version is null or new.data_cutoff_at is null or new.timezone is null
    or new.period_start is null or new.period_end is null or new.period_end < new.period_start
  ) then raise exception 'STAGE_REPORT_SNAPSHOT_INCOMPLETE'; end if;
  return new;
end
$$;
create trigger learning_result_revisions_validate
  before insert on public.learning_result_revisions
  for each row execute function public.validate_learning_result_revision();

alter table public.learning_result_heads enable row level security;
alter table public.learning_result_revisions enable row level security;
alter table public.learning_result_events enable row level security;

create or replace function public.can_manage_learning_result(p_student_id uuid, p_term_id uuid, p_uid uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or (
      public.has_perm(p_uid, 'review.write')
      and (
        public.has_perm(p_uid, 'class.view.all')
        or exists (
          select 1
            from public.enrollments enrollment_row
            join public.classrooms classroom_row on classroom_row.id = enrollment_row.classroom_id
           where enrollment_row.student_id = p_student_id
             and enrollment_row.status = 'active'
             and coalesce(enrollment_row.term_id, classroom_row.term_id) = p_term_id
             and public.is_classroom_teacher(classroom_row.id, p_uid)
        )
      )
    )
  )
$$;

create or replace function public.can_view_learning_result(p_student_id uuid, p_term_id uuid, p_uid uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'report.view.all')
    or public.can_manage_learning_result(p_student_id, p_term_id, p_uid)
  )
$$;

revoke all on function public.can_manage_learning_result(uuid, uuid, uuid) from public;
revoke all on function public.can_view_learning_result(uuid, uuid, uuid) from public;
grant execute on function public.can_manage_learning_result(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_view_learning_result(uuid, uuid, uuid) to authenticated;

create policy learning_result_heads_staff_select on public.learning_result_heads
  for select to authenticated
  using (public.can_view_learning_result(student_id, term_id, (select auth.uid())));

revoke all on public.learning_result_heads, public.learning_result_revisions, public.learning_result_events
  from anon, authenticated;
grant select on public.learning_result_heads to authenticated;

create or replace function public.append_learning_result_revision(
  p_head_id uuid, p_content jsonb, p_metric_version text, p_data_cutoff_at timestamptz,
  p_timezone text, p_period_start date, p_period_end date, p_dataset jsonb, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare next_revision integer; result_revision_id uuid;
begin
  perform 1 from public.learning_result_heads where id = p_head_id for update;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;
  select coalesce(max(revision_no), 0) + 1 into next_revision
    from public.learning_result_revisions where head_id = p_head_id;
  insert into public.learning_result_revisions(
    head_id, revision_no, content, metric_version, data_cutoff_at, timezone,
    period_start, period_end, dataset, created_by
  ) values (
    p_head_id, next_revision, coalesce(p_content, '{}'::jsonb), p_metric_version,
    p_data_cutoff_at, p_timezone, p_period_start, p_period_end,
    coalesce(p_dataset, '{}'::jsonb), p_actor_id
  ) returning id into result_revision_id;
  update public.learning_result_heads set current_revision_id = result_revision_id where id = p_head_id;
  return result_revision_id;
end
$$;
revoke all on function public.append_learning_result_revision(uuid,jsonb,text,timestamptz,text,date,date,jsonb,uuid)
  from public, anon, authenticated;

create or replace function public.record_learning_result_transition(
  p_head_id uuid, p_revision_id uuid, p_from_status text, p_to_status text,
  p_reason text, p_actor_id uuid, p_notify boolean default false
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare head_row public.learning_result_heads%rowtype; actor_role text; recipient record; target_link text;
begin
  select * into head_row from public.learning_result_heads where id = p_head_id;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;
  insert into public.learning_result_events(head_id, revision_id, from_status, to_status, reason, actor_id)
  values(p_head_id, p_revision_id, p_from_status, p_to_status, nullif(left(btrim(coalesce(p_reason, '')), 1000), ''), p_actor_id);
  if not p_notify then return; end if;
  select role into actor_role from public.profiles where id = p_actor_id;
  for recipient in
    select student_row.user_id as recipient_id, true as is_student
      from public.students student_row
     where student_row.id = head_row.student_id and student_row.user_id is not null
    union
    select guardian_row.guardian_id, false
      from public.student_guardians guardian_row
     where guardian_row.student_id = head_row.student_id and 'grades' = any(guardian_row.scope)
  loop
    target_link := case when recipient.is_student
      then '/dashboard/progress#learning-results'
      else '/dashboard/children?child=' || head_row.student_id::text || '#learning-results' end;
    insert into public.domain_events(
      actor_id, actor_role, target_user_id, event_type, entity_type, entity_id,
      payload, event_link, term_id
    ) values (
      p_actor_id, actor_role, recipient.recipient_id,
      'learning_result.' || p_to_status, 'learning_result', head_row.id,
      jsonb_build_object(
        'headId', head_row.id, 'revisionId', p_revision_id,
        'resultKind', head_row.kind, 'studentId', head_row.student_id
      ), target_link, head_row.term_id
    );
  end loop;
end
$$;
revoke all on function public.record_learning_result_transition(uuid,uuid,text,text,text,uuid,boolean)
  from public, anon, authenticated;

create or replace function public.save_stage_report_draft(
  p_student_id uuid, p_term_id uuid, p_period_start date, p_period_end date,
  p_title text, p_summary text, p_teacher_comment text, p_data_cutoff_at timestamptz,
  p_head_id uuid default null
) returns table(result_head_id uuid, result_revision_id uuid, result_revision_no integer, result_status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); report_timezone text; term_start date; term_end date;
  source_value text; head_row public.learning_result_heads%rowtype;
  previous_status text; next_status text; revision_id uuid; snapshot jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start
     or p_data_cutoff_at is null or p_data_cutoff_at > now() + interval '5 minutes'
     or btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_summary, '')) = '' then
    raise exception 'VALIDATION';
  end if;
  select coalesce(campus_row.timezone, organization_row.timezone), term_row.starts_on, term_row.ends_on
    into report_timezone, term_start, term_end
    from public.school_terms term_row
    join public.campuses campus_row on campus_row.id = term_row.campus_id
    join public.organizations organization_row on organization_row.id = campus_row.organization_id
   where term_row.id = p_term_id;
  if report_timezone is null then raise exception 'TERM_NOT_FOUND'; end if;
  if p_period_start < term_start or p_period_end > term_end then raise exception 'PERIOD_OUTSIDE_TERM'; end if;
  if not exists(select 1 from public.students where id = p_student_id and deleted_at is null) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;
  if not public.can_manage_learning_result(p_student_id, p_term_id, uid) then raise exception 'FORBIDDEN'; end if;

  source_value := p_student_id::text || ':' || p_term_id::text || ':' || p_period_start::text || ':' || p_period_end::text;
  if p_head_id is null then
    select * into head_row from public.learning_result_heads
     where kind = 'stage_report' and source_key = source_value for update;
    if not found then
      insert into public.learning_result_heads(
        kind, source_key, student_id, term_id, period_start, period_end,
        status, requires_review, created_by
      ) values (
        'stage_report', source_value, p_student_id, p_term_id, p_period_start, p_period_end,
        'draft', true, uid
      ) returning * into head_row;
    end if;
  else
    select * into head_row from public.learning_result_heads where id = p_head_id for update;
    if not found or head_row.kind <> 'stage_report' or head_row.source_key <> source_value then
      raise exception 'RESULT_SCOPE_MISMATCH';
    end if;
  end if;

  select jsonb_build_object(
    'attendance', (
      select jsonb_build_object(
        'total', count(*),
        'present', count(*) filter (where attendance_row.status = 'present'),
        'late', count(*) filter (where attendance_row.status = 'late'),
        'absent', count(*) filter (where attendance_row.status = 'absent'),
        'leave', count(*) filter (where attendance_row.status = 'leave')
      )
        from public.session_attendance attendance_row
        join public.class_sessions session_row on session_row.id = attendance_row.session_id
       where attendance_row.student_id = p_student_id
         and session_row.term_id = p_term_id and session_row.deleted_at is null
         and session_row.scheduled_at <= p_data_cutoff_at
         and (session_row.scheduled_at at time zone report_timezone)::date between p_period_start and p_period_end
    ),
    'reviews', (
      select jsonb_build_object(
        'count', count(*),
        'entryAverage', round(avg(review_row.entry_score), 2),
        'exitAverage', round(avg(review_row.exit_score), 2),
        'focusAverage', round(avg(review_row.focus)::numeric, 2),
        'participationAverage', round(avg(review_row.participation)::numeric, 2),
        'masteryAverage', round(avg(review_row.mastery)::numeric, 2)
      )
        from public.session_reviews review_row
        join public.class_sessions session_row on session_row.id = review_row.session_id
       where review_row.student_id = p_student_id
         and session_row.term_id = p_term_id and session_row.deleted_at is null
         and session_row.scheduled_at <= p_data_cutoff_at
         and (session_row.scheduled_at at time zone report_timezone)::date between p_period_start and p_period_end
    ),
    'videos', (
      select jsonb_build_object('reviewedCount', count(*))
        from public.session_videos video_row
        join public.class_sessions session_row on session_row.id = video_row.session_id
       where video_row.student_id = p_student_id and video_row.term_id = p_term_id
         and video_row.deleted_at is null and video_row.reviewed_at is not null
         and video_row.reviewed_at <= p_data_cutoff_at
         and (session_row.scheduled_at at time zone report_timezone)::date between p_period_start and p_period_end
    ),
    'sources', jsonb_build_object(
      'reviewSessionIds', coalesce((
        select jsonb_agg(source_row.session_id order by source_row.session_id)
          from (
            select distinct review_row.session_id
              from public.session_reviews review_row
              join public.class_sessions session_row on session_row.id = review_row.session_id
             where review_row.student_id = p_student_id and session_row.term_id = p_term_id
               and session_row.deleted_at is null and session_row.scheduled_at <= p_data_cutoff_at
               and (session_row.scheduled_at at time zone report_timezone)::date between p_period_start and p_period_end
          ) source_row
      ), '[]'::jsonb),
      'videoIds', coalesce((
        select jsonb_agg(video_row.id order by video_row.id)
          from public.session_videos video_row
          join public.class_sessions session_row on session_row.id = video_row.session_id
         where video_row.student_id = p_student_id and video_row.term_id = p_term_id
           and video_row.deleted_at is null and video_row.reviewed_at is not null
           and video_row.reviewed_at <= p_data_cutoff_at
           and (session_row.scheduled_at at time zone report_timezone)::date between p_period_start and p_period_end
      ), '[]'::jsonb)
    )
  ) into snapshot;

  previous_status := head_row.status;
  next_status := case when previous_status in ('published', 'withdrawn', 'revised') then 'revised' else 'draft' end;
  revision_id := public.append_learning_result_revision(
    head_row.id,
    jsonb_build_object(
      'title', left(btrim(p_title), 200),
      'summary', left(btrim(p_summary), 10000),
      'teacherComment', left(btrim(coalesce(p_teacher_comment, '')), 5000)
    ),
    'mathin-learning-report-v1', p_data_cutoff_at, report_timezone,
    p_period_start, p_period_end, snapshot, uid
  );
  update public.learning_result_heads
     set status = next_status, reviewed_by = null, reviewed_at = null
   where id = head_row.id;
  perform public.record_learning_result_transition(
    head_row.id, revision_id, previous_status, next_status, 'stage report saved', uid,
    previous_status in ('published', 'withdrawn')
  );
  return query
  select head_row.id, revision_id, revision_row.revision_no, next_status
    from public.learning_result_revisions revision_row where revision_row.id = revision_id;
end
$$;
revoke all on function public.save_stage_report_draft(uuid,uuid,date,date,text,text,text,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.save_stage_report_draft(uuid,uuid,date,date,text,text,text,timestamptz,uuid)
  to authenticated;

create or replace function public.submit_learning_result_review(p_head_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); head_row public.learning_result_heads%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into head_row from public.learning_result_heads where id = p_head_id for update;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;
  if not public.can_manage_learning_result(head_row.student_id, head_row.term_id, uid) then raise exception 'FORBIDDEN'; end if;
  if not head_row.requires_review or head_row.current_revision_id is null
     or head_row.status not in ('draft', 'revised') then raise exception 'INVALID_STATE'; end if;
  update public.learning_result_heads set status = 'review', reviewed_by = null, reviewed_at = null where id = p_head_id;
  perform public.record_learning_result_transition(
    p_head_id, head_row.current_revision_id, head_row.status, 'review', 'submitted for review', uid, false
  );
end
$$;
revoke all on function public.submit_learning_result_review(uuid) from public, anon, authenticated;
grant execute on function public.submit_learning_result_review(uuid) to authenticated;

create or replace function public.decide_learning_result_review(
  p_head_id uuid, p_decision text, p_note text default ''
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); head_row public.learning_result_heads%rowtype; decision_value text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  decision_value := lower(btrim(coalesce(p_decision, '')));
  if decision_value not in ('publish', 'changes_requested') then raise exception 'VALIDATION'; end if;
  select * into head_row from public.learning_result_heads where id = p_head_id for update;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;
  if not public.can_manage_learning_result(head_row.student_id, head_row.term_id, uid) then raise exception 'FORBIDDEN'; end if;
  if not head_row.requires_review or head_row.status <> 'review' or head_row.current_revision_id is null then
    raise exception 'INVALID_STATE';
  end if;
  if decision_value = 'changes_requested' then
    update public.learning_result_heads
       set status = 'draft', reviewed_by = uid, reviewed_at = now()
     where id = p_head_id;
    perform public.record_learning_result_transition(
      p_head_id, head_row.current_revision_id, 'review', 'draft', p_note, uid, false
    );
  else
    update public.learning_result_heads
       set status = 'published', published_revision_id = current_revision_id,
           reviewed_by = uid, reviewed_at = now(), published_by = uid, published_at = now(),
           withdrawn_by = null, withdrawn_at = null, withdrawal_reason = null
     where id = p_head_id;
    perform public.record_learning_result_transition(
      p_head_id, head_row.current_revision_id, 'review', 'published', p_note, uid, true
    );
  end if;
end
$$;
revoke all on function public.decide_learning_result_review(uuid,text,text) from public, anon, authenticated;
grant execute on function public.decide_learning_result_review(uuid,text,text) to authenticated;

create or replace function public.withdraw_learning_result(p_head_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); head_row public.learning_result_heads%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'VALIDATION'; end if;
  select * into head_row from public.learning_result_heads where id = p_head_id for update;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;
  if not public.can_manage_learning_result(head_row.student_id, head_row.term_id, uid) then raise exception 'FORBIDDEN'; end if;
  if head_row.status <> 'published' then raise exception 'INVALID_STATE'; end if;
  update public.learning_result_heads
     set status = 'withdrawn', withdrawn_by = uid, withdrawn_at = now(),
         withdrawal_reason = left(btrim(p_reason), 1000)
   where id = p_head_id;
  if head_row.kind = 'session_result' and not exists (
    select 1 from public.learning_result_heads other_head
     where other_head.session_id = head_row.session_id and other_head.status = 'published' and other_head.id <> p_head_id
  ) then
    update public.session_family_briefs set published_by = null, published_at = null where session_id = head_row.session_id;
  end if;
  perform public.record_learning_result_transition(
    p_head_id, head_row.published_revision_id, 'published', 'withdrawn', p_reason, uid, true
  );
end
$$;
revoke all on function public.withdraw_learning_result(uuid,text) from public, anon, authenticated;
grant execute on function public.withdraw_learning_result(uuid,text) to authenticated;

create or replace function public.get_my_stage_reports()
returns table(
  head_id uuid, student_id uuid, term_id uuid, period_start date, period_end date,
  title text, summary text, teacher_comment text, metric_version text,
  data_cutoff_at timestamptz, timezone text, published_at timestamptz, dataset jsonb
) language sql security definer stable set search_path = public, pg_temp
as $$
  select head_row.id, head_row.student_id, head_row.term_id,
         revision_row.period_start, revision_row.period_end,
         revision_row.content ->> 'title', revision_row.content ->> 'summary',
         revision_row.content ->> 'teacherComment', revision_row.metric_version,
         revision_row.data_cutoff_at, revision_row.timezone, head_row.published_at,
         revision_row.dataset
    from public.learning_result_heads head_row
    join public.learning_result_revisions revision_row on revision_row.id = head_row.published_revision_id
    join public.students student_row on student_row.id = head_row.student_id
   where head_row.kind = 'stage_report' and head_row.status = 'published'
     and student_row.deleted_at is null
     and (
       student_row.user_id = auth.uid()
       or public.guardian_can(student_row.id, auth.uid(), 'grades')
     )
   order by revision_row.period_end desc, head_row.published_at desc
$$;
revoke all on function public.get_my_stage_reports() from public, anon, authenticated;
grant execute on function public.get_my_stage_reports() to authenticated;

create or replace function public.list_learning_results_for_staff(
  p_student_id uuid default null, p_kind text default null
) returns table(
  head_id uuid, kind text, student_id uuid, term_id uuid, session_id uuid, video_id uuid,
  period_start date, period_end date, status text, requires_review boolean,
  revision_id uuid, revision_no integer, content jsonb, metric_version text,
  data_cutoff_at timestamptz, timezone text, dataset jsonb, updated_at timestamptz
) language sql security definer stable set search_path = public, pg_temp
as $$
  select head_row.id, head_row.kind, head_row.student_id, head_row.term_id,
         head_row.session_id, head_row.video_id, head_row.period_start, head_row.period_end,
         head_row.status, head_row.requires_review, revision_row.id, revision_row.revision_no,
         revision_row.content, revision_row.metric_version, revision_row.data_cutoff_at,
         revision_row.timezone, revision_row.dataset, head_row.updated_at
    from public.learning_result_heads head_row
    left join public.learning_result_revisions revision_row on revision_row.id = head_row.current_revision_id
   where (p_student_id is null or head_row.student_id = p_student_id)
     and (p_kind is null or head_row.kind = p_kind)
     and public.can_view_learning_result(head_row.student_id, head_row.term_id, auth.uid())
   order by head_row.updated_at desc, head_row.id
$$;
revoke all on function public.list_learning_results_for_staff(uuid,text) from public, anon, authenticated;
grant execute on function public.list_learning_results_for_staff(uuid,text) to authenticated;

commit;
