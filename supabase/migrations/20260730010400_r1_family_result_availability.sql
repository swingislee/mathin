begin;

-- R1-5 only needs a customer-safe availability projection. The full report
-- revision/review history remains R1-6; this state prevents draft or withdrawn
-- results from being misrepresented as an empty list in the family portal.
alter table public.session_family_briefs
  add column if not exists family_visibility_state text not null default 'pending',
  add column if not exists family_visibility_changed_at timestamptz not null default now();

update public.session_family_briefs brief_row
   set family_visibility_state = case
         when brief_row.published_at is not null then 'published'
         when exists (
           select 1
             from public.domain_events event_row
            where event_row.event_type = 'session_family_brief.published'
              and event_row.entity_id = brief_row.session_id
         ) then 'withdrawn'
         else 'pending'
       end,
       family_visibility_changed_at = coalesce(brief_row.published_at, brief_row.updated_at, now());

alter table public.session_family_briefs
  drop constraint if exists session_family_briefs_visibility_state_check;
alter table public.session_family_briefs
  add constraint session_family_briefs_visibility_state_check
  check (
    family_visibility_state in ('pending', 'published', 'withdrawn')
    and (family_visibility_state = 'published') = (published_at is not null)
  );

create or replace function public.sync_session_family_brief_visibility()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  next_state text;
begin
  if new.published_at is not null then
    next_state := 'published';
  elsif tg_op = 'UPDATE' and old.published_at is not null then
    next_state := 'withdrawn';
  elsif tg_op = 'UPDATE' and old.family_visibility_state = 'withdrawn' then
    next_state := 'withdrawn';
  else
    next_state := 'pending';
  end if;

  if tg_op = 'INSERT' or new.family_visibility_state is distinct from next_state then
    new.family_visibility_changed_at := now();
  end if;
  new.family_visibility_state := next_state;
  return new;
end;
$$;
revoke all on function public.sync_session_family_brief_visibility()
  from public, anon, authenticated;

drop trigger if exists session_family_briefs_sync_visibility on public.session_family_briefs;
create trigger session_family_briefs_sync_visibility
before insert or update of published_at on public.session_family_briefs
for each row execute function public.sync_session_family_brief_visibility();

-- This projection intentionally exposes only the availability state and
-- already-family-visible session metadata. Scores, comments, summaries and
-- other draft fields are absent from both the return type and query.
create or replace function public.get_my_session_review_states(
  p_from timestamptz,
  p_to timestamptz
)
returns table(
  session_id uuid,
  student_id uuid,
  student_name text,
  classroom_name text,
  lecture_name text,
  scheduled_at timestamptz,
  availability_state text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select session_row.id,
         student_row.id,
         student_row.name,
         classroom_row.name,
         session_row.title,
         session_row.scheduled_at,
         coalesce(brief_row.family_visibility_state, 'pending')
    from public.session_reviews review_row
    join public.class_sessions session_row on session_row.id = review_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.students student_row on student_row.id = review_row.student_id
    left join public.session_family_briefs brief_row on brief_row.session_id = session_row.id
   where student_row.deleted_at is null
     and session_row.deleted_at is null
     and session_row.scheduled_at >= p_from
     and session_row.scheduled_at < p_to
     and (
       student_row.user_id = auth.uid()
       or public.guardian_can(student_row.id, auth.uid(), 'grades')
     )
   order by session_row.scheduled_at desc;
$$;
revoke all on function public.get_my_session_review_states(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_my_session_review_states(timestamptz, timestamptz)
  to authenticated;

commit;
