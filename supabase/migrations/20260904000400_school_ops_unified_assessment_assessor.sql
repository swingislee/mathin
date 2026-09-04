-- DEV-SCHOOL-OPS-1 / Phase 2 unified 1:1 assessment workbench.
-- The invitation assessor is the current execution assignment. A support user
-- may replace it until the assessment is complete. Once a teacher produces the
-- conclusion, assessment_results.assessed_by becomes the actual assessor and
-- is synchronized back to the shared workbench automatically.

create or replace function public.reassign_assessment_assessor(
  p_invitation_id uuid,
  p_assessor_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_invitation public.lead_invitation_threads%rowtype;
  v_lead_owner_id uuid;
  v_registration_id uuid;
  v_completed_at timestamptz;
  v_assessor_name text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'followup.write') then raise exception 'FORBIDDEN'; end if;

  select profile.display_name into v_assessor_name
    from public.profiles profile
   where profile.id = p_assessor_id
     and profile.role in ('staff', 'admin')
     and profile.is_active
     and public.has_perm(profile.id, 'review.write');
  if not found then raise exception 'ASSESSOR_UNAVAILABLE'; end if;

  select * into v_invitation
    from public.lead_invitation_threads
   where id = p_invitation_id
   for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_invitation.kind <> 'assessment_1v1' then raise exception 'INVALID_INVITATION'; end if;

  select lead.owner_id into v_lead_owner_id
    from public.leads lead
   where lead.id = v_invitation.lead_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_lead_owner_id is distinct from v_uid
     and not public.has_perm(v_uid, 'student.view.all') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select registration.id, registration.assessment_completed_at
    into v_registration_id, v_completed_at
    from public.activities activity
    join public.activity_registrations registration
      on registration.activity_id = activity.id
   where activity.source_invitation_id = v_invitation.id
     and activity.deleted_at is null
     and registration.status <> 'cancelled'
   order by registration.created_at
   limit 1
   for update of registration;

  if v_completed_at is not null then raise exception 'ASSESSMENT_ALREADY_COMPLETED'; end if;
  if v_invitation.state = 'cancelled'
     or (v_invitation.state = 'completed' and v_registration_id is null) then
    raise exception 'INVITATION_CLOSED';
  end if;

  if v_invitation.assessor_id is distinct from p_assessor_id then
    update public.lead_invitation_threads
       set assessor_id = p_assessor_id,
           updated_by = v_uid
     where id = v_invitation.id;

    insert into public.lead_invitation_events(
      invitation_id, from_state, to_state, channel, note, recorded_by
    ) values (
      v_invitation.id,
      v_invitation.state,
      v_invitation.state,
      'in_person',
      '临时调整测评老师为：' || v_assessor_name,
      v_uid
    );

    perform public.emit_domain_event(
      'assessment.assessor.reassigned',
      'lead_invitation',
      v_invitation.id,
      jsonb_build_object(
        'leadId', v_invitation.lead_id,
        'registrationId', v_registration_id,
        'assessorId', p_assessor_id
      ),
      v_uid,
      null
    );
  end if;

  return jsonb_build_object(
    'invitationId', v_invitation.id,
    'registrationId', v_registration_id,
    'assessorId', p_assessor_id,
    'assessorName', v_assessor_name
  );
end;
$$;

create or replace function public.sync_completed_assessment_actual_assessor()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation_id uuid;
  v_invitation_state text;
  v_previous_assessor_id uuid;
  v_actual_name text;
begin
  if new.assessed_by is null then return new; end if;

  select activity.source_invitation_id,
         invitation.state,
         invitation.assessor_id,
         profile.display_name
    into v_invitation_id, v_invitation_state, v_previous_assessor_id, v_actual_name
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
    join public.lead_invitation_threads invitation
      on invitation.id = activity.source_invitation_id
    join public.profiles profile on profile.id = new.assessed_by
   where registration.id = new.activity_registration_id
     and registration.assessment_completed_at is not null;

  if v_invitation_id is null or v_previous_assessor_id is not distinct from new.assessed_by then
    return new;
  end if;

  update public.lead_invitation_threads
     set assessor_id = new.assessed_by,
         updated_by = new.assessed_by
   where id = v_invitation_id;

  insert into public.lead_invitation_events(
    invitation_id, from_state, to_state, channel, note, recorded_by
  ) values (
    v_invitation_id,
    v_invitation_state,
    v_invitation_state,
    'in_person',
    '测评结论已由实际执行老师提交：' || v_actual_name,
    new.assessed_by
  );

  perform public.emit_domain_event(
    'assessment.actual_assessor.confirmed',
    'lead_invitation',
    v_invitation_id,
    jsonb_build_object(
      'registrationId', new.activity_registration_id,
      'assessorId', new.assessed_by
    ),
    new.assessed_by,
    null
  );

  return new;
end;
$$;

drop trigger if exists assessment_results_sync_actual_assessor on public.assessment_results;
create trigger assessment_results_sync_actual_assessor
  after insert or update of assessed_by on public.assessment_results
  for each row execute function public.sync_completed_assessment_actual_assessor();

revoke all on function public.reassign_assessment_assessor(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sync_completed_assessment_actual_assessor()
  from public, anon, authenticated;
grant execute on function public.reassign_assessment_assessor(uuid, uuid)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
