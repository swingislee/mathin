-- R1-5: make family-learning notifications actionable in both the student
-- and family environments. The recipient's relationship to payload.studentId
-- determines the deep link; a student must never be sent to the family-only
-- children route.

begin;

create or replace function public.apply_actionable_notification_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  event_row public.domain_events;
  payload_student_id uuid;
  recipient_is_student boolean := false;
begin
  select * into event_row from public.domain_events where id = new.source_event_id;
  if not found then return new; end if;

  begin
    payload_student_id := nullif(event_row.payload ->> 'studentId', '')::uuid;
  exception when invalid_text_representation then
    payload_student_id := null;
  end;

  if payload_student_id is not null then
    select exists(
      select 1
        from public.students student_row
       where student_row.id = payload_student_id
         and student_row.user_id = new.recipient_id
    ) into recipient_is_student;
  end if;

  new.deep_link := case
    when event_row.event_type in ('work_item.assigned', 'work_item.reassigned')
      then '/dashboard?focus=durable:' || event_row.entity_id::text
    when event_row.event_type = 'work_item.closed'
      then '/dashboard/coordination?focus=durable:' || event_row.entity_id::text
    when event_row.event_type = 'approval.requested'
      then '/dashboard?focus=approval:' || event_row.entity_id::text
    when event_row.event_type in ('approval.approved', 'approval.rejected')
      then '/dashboard/coordination?focus=approval:' || event_row.entity_id::text
    when event_row.event_type in ('leave_request.approved', 'leave_request.rejected', 'session_change.makeup')
      and recipient_is_student
      then '/dashboard/assignments#leave'
    when event_row.event_type in ('leave_request.approved', 'leave_request.rejected', 'session_change.makeup')
      and payload_student_id is not null
      then '/dashboard/children?child=' || payload_student_id::text || '#leave'
    when event_row.event_type = 'knowledge_summary.published'
      and recipient_is_student
      then '/dashboard/assignments#learning-results'
    when event_row.event_type = 'knowledge_summary.published'
      and payload_student_id is not null
      then '/dashboard/children?child=' || payload_student_id::text || '#knowledge-summary'
    else coalesce(new.deep_link, event_row.event_link)
  end;
  return new;
end
$$;

update public.notifications notification_row
   set deep_link = case
     when event_row.event_type in ('leave_request.approved', 'leave_request.rejected', 'session_change.makeup')
       and exists(
         select 1
           from public.students student_row
          where student_row.id = (event_row.payload ->> 'studentId')::uuid
            and student_row.user_id = notification_row.recipient_id
       )
       then '/dashboard/assignments#leave'
     when event_row.event_type in ('leave_request.approved', 'leave_request.rejected', 'session_change.makeup')
       then '/dashboard/children?child=' || (event_row.payload ->> 'studentId') || '#leave'
     when event_row.event_type = 'knowledge_summary.published'
       and exists(
         select 1
           from public.students student_row
          where student_row.id = (event_row.payload ->> 'studentId')::uuid
            and student_row.user_id = notification_row.recipient_id
       )
       then '/dashboard/assignments#learning-results'
     when event_row.event_type = 'knowledge_summary.published'
       then '/dashboard/children?child=' || (event_row.payload ->> 'studentId') || '#knowledge-summary'
     else notification_row.deep_link
   end
  from public.domain_events event_row
 where event_row.id = notification_row.source_event_id
   and event_row.event_type in (
     'leave_request.approved',
     'leave_request.rejected',
     'session_change.makeup',
     'knowledge_summary.published'
   )
   and (event_row.payload ->> 'studentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

revoke all on function public.apply_actionable_notification_link() from public, anon, authenticated;

commit;
