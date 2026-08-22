-- R1-Live: enrolling a new lead in a class is itself the conversion event.
-- enroll_student already promotes both lead and trialing students to enrolled;
-- keep the row-level state guard aligned with that controlled RPC contract.

create or replace function public.guard_student_state_transition()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and not (
    (old.status='lead' and new.status in ('trialing','enrolled','invalid')) or
    (old.status='trialing' and new.status in ('lead','enrolled','invalid')) or
    (old.status='enrolled' and new.status in ('paused','alumni')) or
    (old.status='paused' and new.status in ('enrolled','alumni')) or
    (old.status='alumni' and new.status='enrolled') or
    (old.status='invalid' and new.status='lead')
  ) then raise exception 'INVALID_STATUS_TRANSITION:%->%',old.status,new.status; end if;
  if new.follow_up_status is distinct from old.follow_up_status and not (
    (old.follow_up_status='pending' and new.follow_up_status in ('following','lost')) or
    (old.follow_up_status='following' and new.follow_up_status in ('invited','lost')) or
    (old.follow_up_status='invited' and new.follow_up_status in ('following','trialed','lost')) or
    (old.follow_up_status='trialed' and new.follow_up_status in ('following','signed','lost')) or
    (old.follow_up_status='lost' and new.follow_up_status='following')
  ) then raise exception 'INVALID_FOLLOWUP_TRANSITION:%->%',old.follow_up_status,new.follow_up_status; end if;
  return new;
end $$;

comment on function public.guard_student_state_transition() is
  'Allows only approved student lifecycle edges; controlled class enrollment may promote lead or trialing directly to enrolled.';
