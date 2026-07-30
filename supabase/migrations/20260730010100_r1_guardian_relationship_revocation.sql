-- R1-5 family portal: a guardian can revoke their own platform relationship.
-- The operation is serialized per student, records consent withdrawal, and
-- preserves the single-primary invariant when another guardian remains.

create or replace function public.revoke_my_guardian_relationship(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  was_primary boolean;
  promoted_guardian_id uuid;
  policy_version text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  perform 1 from public.students where id = p_student_id for update;
  select guardian_row.is_primary
    into was_primary
    from public.student_guardians guardian_row
   where guardian_row.student_id = p_student_id
     and guardian_row.guardian_id = uid
   for update;
  if not found then raise exception 'RELATIONSHIP_NOT_FOUND'; end if;

  select policy_row.version
    into policy_version
    from public.consent_policies policy_row
   where policy_row.policy_kind = 'children_privacy'
     and policy_row.required;

  if policy_version is not null then
    insert into public.consent_records(
      actor_user_id, student_id, policy_kind, policy_version,
      scope, decision, source
    )
    select uid, p_student_id, 'children_privacy', policy_version,
           scope_row.scope, 'withdrawn', 'guardian_binding'
      from unnest(array['profile','learning','video']::text[]) as scope_row(scope)
     where (
       select record_row.decision
         from public.consent_records record_row
        where record_row.actor_user_id = uid
          and record_row.student_id = p_student_id
          and record_row.policy_kind = 'children_privacy'
          and record_row.scope = scope_row.scope
        order by record_row.recorded_at desc, record_row.id desc
        limit 1
     ) = 'granted';
  end if;

  delete from public.student_guardians guardian_row
   where guardian_row.student_id = p_student_id
     and guardian_row.guardian_id = uid;

  if was_primary or not exists (
    select 1 from public.student_guardians guardian_row
     where guardian_row.student_id = p_student_id
       and guardian_row.is_primary
  ) then
    select guardian_row.guardian_id
      into promoted_guardian_id
      from public.student_guardians guardian_row
     where guardian_row.student_id = p_student_id
     order by guardian_row.created_at, guardian_row.guardian_id
     limit 1;
    if promoted_guardian_id is not null then
      update public.student_guardians
         set is_primary = true
       where student_id = p_student_id
         and guardian_id = promoted_guardian_id;
    end if;
  end if;

  perform public.emit_domain_event(
    'guardian.relationship_revoked', 'student', p_student_id,
    jsonb_build_object(
      'guardianId', uid,
      'wasPrimary', was_primary,
      'promotedGuardianId', promoted_guardian_id
    ), uid, null
  );
end
$$;

revoke all on function public.revoke_my_guardian_relationship(uuid) from public, anon, authenticated;
grant execute on function public.revoke_my_guardian_relationship(uuid) to authenticated;
