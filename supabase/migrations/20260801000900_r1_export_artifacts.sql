-- R1-7E: separate user-rights artifacts from operational exports, enforce
-- role-specific field allowlists, expire retained payloads, and audit downloads.

begin;

create table public.user_rights_export_artifacts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.account_requests(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  subject_role text not null check (subject_role in ('student','parent','staff','admin')),
  data_scope text not null check (data_scope in ('account','account_and_learning')),
  schema_version text not null default 'mathin-user-rights-export-v1'
    check (schema_version = 'mathin-user-rights-export-v1'),
  content_text text,
  artifact_hash text not null check (artifact_hash ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 8388608),
  field_manifest jsonb not null,
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  purged_at timestamptz,
  constraint user_rights_export_manifest_shape check (
    jsonb_typeof(field_manifest) = 'object' and octet_length(field_manifest::text) <= 16384
  ),
  constraint user_rights_export_payload_state check (
    (content_text is not null and purged_at is null)
    or (content_text is null and purged_at is not null)
  )
);
create index user_rights_export_user_idx
  on public.user_rights_export_artifacts(user_id, created_at desc);
create index user_rights_export_expiry_idx
  on public.user_rights_export_artifacts(expires_at) where purged_at is null;

create table public.export_download_events (
  id uuid primary key default gen_random_uuid(),
  export_category text not null check (export_category in ('user_rights','operational')),
  export_kind text not null check (export_kind in ('account_portability_json','solution_record_webp')),
  artifact_id uuid references public.user_rights_export_artifacts(id) on delete restrict,
  resource_id uuid not null,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid references public.profiles(id) on delete restrict,
  artifact_hash text not null check (artifact_hash ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  field_manifest jsonb not null,
  downloaded_at timestamptz not null default now(),
  constraint export_download_event_category_shape check (
    (export_category = 'user_rights' and export_kind = 'account_portability_json'
      and artifact_id is not null and target_user_id is not null and resource_id = artifact_id)
    or
    (export_category = 'operational' and export_kind = 'solution_record_webp'
      and artifact_id is null and target_user_id is null)
  ),
  constraint export_download_event_manifest_shape check (
    jsonb_typeof(field_manifest) = 'object' and octet_length(field_manifest::text) <= 16384
  )
);
create index export_download_events_actor_idx
  on public.export_download_events(actor_user_id, downloaded_at desc);
create index export_download_events_target_idx
  on public.export_download_events(target_user_id, downloaded_at desc)
  where target_user_id is not null;

create trigger export_download_events_immutable
  before update or delete on public.export_download_events
  for each row execute function public.reject_immutable_security_row();

create or replace function public.user_rights_export_field_manifest(p_role text, p_scope text)
returns jsonb language sql immutable
as $$
  select jsonb_build_object(
    'schemaVersion', 'mathin-user-rights-export-v1',
    'account', jsonb_build_array('userId','displayName','role','email','accountStatus','isActive','createdAt','updatedAt'),
    'consents', jsonb_build_array('policyKind','policyVersion','scope','decision','source','recordedAt'),
    'rightsRequests', jsonb_build_array('requestId','kind','status','dataScope','decisionReason','resultSummary','dueAt','createdAt','handledAt'),
    'roleData', case p_role
      when 'student' then jsonb_build_object(
        'studentProfile', jsonb_build_array('studentId','name','gender','birthday','phone','wechat','school','grade','status','createdAt','updatedAt'),
        'enrollments', case when p_scope = 'account_and_learning' then jsonb_build_array('enrollmentId','classroomId','classroomName','status','joinedAt','leftAt') else '[]'::jsonb end,
        'attendance', case when p_scope = 'account_and_learning' then jsonb_build_array('sessionId','status','markedAt') else '[]'::jsonb end,
        'submissions', case when p_scope = 'account_and_learning' then jsonb_build_array('submissionId','assignmentId','assignmentTitle','content','submittedAt','score','feedback','gradedAt') else '[]'::jsonb end,
        'publishedLearningResults', case when p_scope = 'account_and_learning' then jsonb_build_array('resultId','kind','sessionId','periodStart','periodEnd','content','metricVersion','dataCutoffAt','timezone','publishedAt') else '[]'::jsonb end
      )
      when 'parent' then jsonb_build_object(
        'familyLinks', jsonb_build_array('studentId','studentName','relation','isPrimary','scope','linkedAt')
      )
      else jsonb_build_object(
        'staffRoles', jsonb_build_array('roleKey','roleName','grantedAt')
      )
    end,
    'explicitlyExcluded', jsonb_build_array(
      'passwords','tokens','mfaSecrets','accountLockReason','studentBindCode',
      'studentInternalRemark','studentFollowUp','guardianContactFields','otherStudents',
      'supportAudits','reviewerNotes','unpublishedLearningResults'
    )
  )
$$;

create or replace function public.build_user_rights_export_payload(
  p_user_id uuid,
  p_scope text
) returns jsonb language plpgsql security definer stable
set search_path = public, auth, pg_temp
as $$
declare
  profile_row public.profiles%rowtype;
  account_email text;
  student_id_value uuid;
  role_data jsonb := '{}'::jsonb;
  learning_data jsonb := '{}'::jsonb;
begin
  if p_scope not in ('account','account_and_learning') then raise exception 'INVALID_SCOPE'; end if;
  select * into profile_row from public.profiles where id = p_user_id;
  if profile_row.id is null then raise exception 'TARGET_NOT_FOUND'; end if;
  select user_row.email::text into account_email from auth.users user_row where user_row.id = p_user_id;

  if profile_row.role = 'student' then
    select student_row.id,
      jsonb_build_object(
        'studentProfile', jsonb_build_object(
          'studentId', student_row.id,
          'name', student_row.name,
          'gender', student_row.gender,
          'birthday', student_row.birthday,
          'phone', student_row.phone,
          'wechat', student_row.wechat,
          'school', student_row.school,
          'grade', student_row.grade,
          'status', student_row.status,
          'createdAt', student_row.created_at,
          'updatedAt', student_row.updated_at
        )
      )
      into student_id_value, role_data
      from public.students student_row
     where student_row.user_id = p_user_id and student_row.deleted_at is null
     order by student_row.created_at
     limit 1;
    role_data := coalesce(role_data, jsonb_build_object('studentProfile', null));

    if p_scope = 'account_and_learning' and student_id_value is not null then
      learning_data := jsonb_build_object(
        'enrollments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'enrollmentId', enrollment_row.id,
            'classroomId', enrollment_row.classroom_id,
            'classroomName', classroom_row.name,
            'status', enrollment_row.status,
            'joinedAt', enrollment_row.joined_at,
            'leftAt', enrollment_row.left_at
          ) order by enrollment_row.joined_at, enrollment_row.id)
          from public.enrollments enrollment_row
          join public.classrooms classroom_row on classroom_row.id = enrollment_row.classroom_id
          where enrollment_row.student_id = student_id_value
        ), '[]'::jsonb),
        'attendance', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sessionId', attendance_row.session_id,
            'status', attendance_row.status,
            'markedAt', attendance_row.marked_at
          ) order by attendance_row.marked_at, attendance_row.session_id)
          from public.session_attendance attendance_row
          where attendance_row.student_id = student_id_value
        ), '[]'::jsonb),
        'submissions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'submissionId', submission_row.id,
            'assignmentId', submission_row.assignment_id,
            'assignmentTitle', assignment_row.title,
            'content', submission_row.content,
            'submittedAt', submission_row.submitted_at,
            'score', submission_row.score,
            'feedback', submission_row.feedback,
            'gradedAt', submission_row.graded_at
          ) order by submission_row.created_at, submission_row.id)
          from public.submissions submission_row
          join public.assignments assignment_row on assignment_row.id = submission_row.assignment_id
          where submission_row.user_id = p_user_id
        ), '[]'::jsonb),
        'publishedLearningResults', coalesce((
          select jsonb_agg(jsonb_build_object(
            'resultId', head_row.id,
            'kind', head_row.kind,
            'sessionId', head_row.session_id,
            'periodStart', revision_row.period_start,
            'periodEnd', revision_row.period_end,
            'content', revision_row.content,
            'metricVersion', revision_row.metric_version,
            'dataCutoffAt', revision_row.data_cutoff_at,
            'timezone', revision_row.timezone,
            'publishedAt', head_row.published_at
          ) order by head_row.published_at, head_row.id)
          from public.learning_result_heads head_row
          join public.learning_result_revisions revision_row on revision_row.id = head_row.published_revision_id
          where head_row.student_id = student_id_value and head_row.status = 'published'
        ), '[]'::jsonb)
      );
      role_data := role_data || learning_data;
    end if;
  elsif profile_row.role = 'parent' then
    role_data := jsonb_build_object('familyLinks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'studentId', guardian_row.student_id,
        'studentName', student_row.name,
        'relation', guardian_row.relation,
        'isPrimary', guardian_row.is_primary,
        'scope', guardian_row.scope,
        'linkedAt', guardian_row.created_at
      ) order by guardian_row.created_at, guardian_row.student_id)
      from public.student_guardians guardian_row
      join public.students student_row on student_row.id = guardian_row.student_id and student_row.deleted_at is null
      where guardian_row.guardian_id = p_user_id
    ), '[]'::jsonb));
  else
    role_data := jsonb_build_object('staffRoles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'roleKey', role_row.key,
        'roleName', role_row.name,
        'grantedAt', member_row.created_at
      ) order by role_row.key)
      from public.staff_role_members member_row
      join public.staff_roles role_row on role_row.id = member_row.role_id
      where member_row.user_id = p_user_id
    ), '[]'::jsonb));
  end if;

  return jsonb_build_object(
    'schemaVersion', 'mathin-user-rights-export-v1',
    'generatedAt', now(),
    'dataScope', p_scope,
    'account', jsonb_build_object(
      'userId', profile_row.id,
      'displayName', profile_row.display_name,
      'role', profile_row.role,
      'email', account_email,
      'accountStatus', profile_row.account_status,
      'isActive', profile_row.is_active,
      'createdAt', profile_row.created_at,
      'updatedAt', profile_row.updated_at
    ),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'policyKind', consent_row.policy_kind,
        'policyVersion', consent_row.policy_version,
        'scope', consent_row.scope,
        'decision', consent_row.decision,
        'source', consent_row.source,
        'recordedAt', consent_row.recorded_at
      ) order by consent_row.recorded_at, consent_row.id)
      from public.consent_records consent_row
      where consent_row.subject_user_id = p_user_id
    ), '[]'::jsonb),
    'rightsRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'requestId', request_row.id,
        'kind', request_row.kind,
        'status', request_row.status,
        'dataScope', request_row.data_scope,
        'decisionReason', request_row.decision_reason,
        'resultSummary', request_row.result_summary,
        'dueAt', request_row.due_at,
        'createdAt', request_row.created_at,
        'handledAt', request_row.handled_at
      ) order by request_row.created_at, request_row.id)
      from public.account_requests request_row
      where request_row.user_id = p_user_id
    ), '[]'::jsonb),
    'roleData', role_data
  );
end
$$;

create or replace function public.prepare_user_rights_export(p_request_id uuid)
returns table(
  artifact_id uuid,
  artifact_hash text,
  size_bytes bigint,
  expires_at timestamptz,
  subject_role text,
  data_scope text
) language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  request_row public.account_requests%rowtype;
  existing_row public.user_rights_export_artifacts%rowtype;
  subject_role_value text;
  payload jsonb;
  serialized text;
  digest_value text;
  manifest jsonb;
  artifact_row public.user_rights_export_artifacts%rowtype;
begin
  if uid is null or not public.has_perm(uid, 'account.support.manage') then raise exception 'FORBIDDEN'; end if;
  select * into request_row from public.account_requests where id = p_request_id for update;
  if request_row.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if request_row.kind <> 'export' then raise exception 'INVALID_KIND'; end if;
  if request_row.identity_verification <> 'verified' then raise exception 'IDENTITY_NOT_VERIFIED'; end if;

  select * into existing_row from public.user_rights_export_artifacts where request_id = p_request_id;
  if existing_row.id is not null then
    return query select existing_row.id, existing_row.artifact_hash, existing_row.size_bytes,
      existing_row.expires_at, existing_row.subject_role, existing_row.data_scope;
    return;
  end if;

  if request_row.status not in ('approved','processing') then raise exception 'REQUEST_NOT_APPROVED'; end if;
  if request_row.data_scope not in ('account','account_and_learning') then raise exception 'INVALID_SCOPE'; end if;
  select role into subject_role_value from public.profiles where id = request_row.user_id;
  if subject_role_value is null then raise exception 'TARGET_NOT_FOUND'; end if;

  payload := public.build_user_rights_export_payload(request_row.user_id, request_row.data_scope);
  serialized := payload::text;
  if octet_length(serialized) > 8388608 then raise exception 'EXPORT_TOO_LARGE'; end if;
  digest_value := encode(extensions.digest(convert_to(serialized, 'UTF8'), 'sha256'), 'hex');
  manifest := public.user_rights_export_field_manifest(subject_role_value, request_row.data_scope);

  insert into public.user_rights_export_artifacts(
    request_id, user_id, subject_role, data_scope, content_text, artifact_hash,
    size_bytes, field_manifest, expires_at, created_by
  ) values (
    request_row.id, request_row.user_id, subject_role_value, request_row.data_scope,
    serialized, digest_value, octet_length(serialized), manifest, now() + interval '7 days', uid
  ) returning * into artifact_row;

  update public.account_requests
     set status = 'completed', identity_verification = 'verified',
         result_summary = 'mathin-user-rights-export-v1 artifact prepared; expires after 7 days',
         evidence_hash = digest_value, handled_by = uid, handled_at = now()
   where id = request_row.id;
  perform public.emit_domain_event(
    'account_export.ready', 'account_request', request_row.id,
    jsonb_build_object(
      'artifactId', artifact_row.id,
      'schemaVersion', artifact_row.schema_version,
      'artifactHash', artifact_row.artifact_hash,
      'expiresAt', artifact_row.expires_at
    ),
    request_row.user_id,
    '/dashboard/account-security'
  );

  return query select artifact_row.id, artifact_row.artifact_hash, artifact_row.size_bytes,
    artifact_row.expires_at, artifact_row.subject_role, artifact_row.data_scope;
end
$$;

create or replace function public.download_user_rights_export(p_artifact_id uuid)
returns table(file_name text, artifact_hash text, content_text text, expires_at timestamptz)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  artifact_row public.user_rights_export_artifacts%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into artifact_row from public.user_rights_export_artifacts where id = p_artifact_id for update;
  if artifact_row.id is null then raise exception 'EXPORT_NOT_FOUND'; end if;
  if artifact_row.user_id <> uid then raise exception 'FORBIDDEN'; end if;
  if artifact_row.expires_at <= now() then raise exception 'EXPORT_EXPIRED'; end if;
  if artifact_row.purged_at is not null or artifact_row.content_text is null then raise exception 'EXPORT_PURGED'; end if;
  if encode(extensions.digest(convert_to(artifact_row.content_text, 'UTF8'), 'sha256'), 'hex') <> artifact_row.artifact_hash
  then raise exception 'EXPORT_HASH_MISMATCH'; end if;

  insert into public.export_download_events(
    export_category, export_kind, artifact_id, resource_id, actor_user_id,
    target_user_id, artifact_hash, size_bytes, field_manifest
  ) values (
    'user_rights', 'account_portability_json', artifact_row.id, artifact_row.id,
    uid, artifact_row.user_id, artifact_row.artifact_hash, artifact_row.size_bytes,
    artifact_row.field_manifest
  );

  return query select
    'mathin-account-export-' || artifact_row.id::text || '.json',
    artifact_row.artifact_hash,
    artifact_row.content_text,
    artifact_row.expires_at;
end
$$;

create or replace function public.record_solution_record_export_download(
  p_solution_record_id uuid,
  p_artifact_hash text,
  p_size_bytes bigint
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_id_value uuid;
  source_value text;
  event_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if coalesce(p_artifact_hash, '') !~ '^[a-f0-9]{64}$'
     or p_size_bytes is null or p_size_bytes not between 1 and 20971520
  then raise exception 'VALIDATION'; end if;
  select record_row.session_id, record_row.solution_source
    into session_id_value, source_value
    from public.solution_records record_row
   where record_row.id = p_solution_record_id;
  if session_id_value is null then raise exception 'RESOURCE_NOT_FOUND'; end if;
  if source_value <> 'board' then raise exception 'INVALID_KIND'; end if;
  if not public.is_session_teacher(session_id_value, uid)
     and not public.can_review_session_preparation(session_id_value, uid)
  then raise exception 'FORBIDDEN'; end if;

  insert into public.export_download_events(
    export_category, export_kind, resource_id, actor_user_id,
    artifact_hash, size_bytes, field_manifest
  ) values (
    'operational', 'solution_record_webp', p_solution_record_id, uid,
    p_artifact_hash, p_size_bytes,
    jsonb_build_object(
      'schemaVersion', 'mathin-solution-record-export-v1',
      'fields', jsonb_build_array('sessionCourseware','pageIdentity','solutionRevision','boardItems'),
      'explicitlyExcluded', jsonb_build_array('studentProfiles','studentContacts','internalReviewNotes','accountData')
    )
  ) returning id into event_id;
  return event_id;
end
$$;

create or replace function public.purge_expired_user_rights_export_payloads(p_limit integer default 100)
returns integer language plpgsql security definer
set search_path = public, pg_temp
as $$
declare purged integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.has_perm(auth.uid(), 'system.operations.manage'))
  then raise exception 'FORBIDDEN'; end if;
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'VALIDATION'; end if;
  with targets as (
    select artifact_row.id
      from public.user_rights_export_artifacts artifact_row
     where artifact_row.expires_at <= now() and artifact_row.purged_at is null
     order by artifact_row.expires_at
     for update skip locked
     limit p_limit
  )
  update public.user_rights_export_artifacts artifact_row
     set content_text = null, purged_at = now()
    from targets where artifact_row.id = targets.id;
  get diagnostics purged = row_count;
  return purged;
end
$$;

create or replace function public.manage_account_request(
  p_request_id uuid, p_status text, p_identity_verification text,
  p_decision_reason text default null, p_result_summary text default null, p_evidence_hash text default null
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); request_row public.account_requests%rowtype;
begin
  if uid is null or not public.has_perm(uid, 'account.support.manage') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('submitted','identity_verified','approved','processing','completed','rejected','cancelled')
     or p_identity_verification not in ('pending','verified','rejected') then raise exception 'INVALID_STATUS'; end if;
  if p_status in ('approved','processing','completed') and p_identity_verification <> 'verified'
  then raise exception 'IDENTITY_NOT_VERIFIED'; end if;
  select * into request_row from public.account_requests where id = p_request_id for update;
  if request_row.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if request_row.status in ('completed','rejected','cancelled') then raise exception 'REQUEST_TERMINAL'; end if;
  if p_status = 'completed' and request_row.kind = 'export'
     and not exists(select 1 from public.user_rights_export_artifacts artifact_row where artifact_row.request_id = p_request_id)
  then raise exception 'EXPORT_ARTIFACT_REQUIRED'; end if;
  if p_status = 'completed' and request_row.kind <> 'export' and coalesce(p_evidence_hash,'') !~ '^[a-f0-9]{64}$'
  then raise exception 'EVIDENCE_REQUIRED'; end if;
  update public.account_requests
     set status = p_status,
         identity_verification = p_identity_verification,
         decision_reason = left(trim(coalesce(p_decision_reason,'')),1000),
         result_summary = left(trim(coalesce(p_result_summary,'')),2000),
         evidence_hash = p_evidence_hash,
         handled_by = uid,
         handled_at = case when p_status in ('completed','rejected','cancelled') then now() else handled_at end
   where id = p_request_id;
  perform public.emit_domain_event('account_request.' || p_status, 'account_request', p_request_id,
    jsonb_build_object('identityVerification', p_identity_verification, 'evidenceHash', p_evidence_hash), request_row.user_id, null);
end
$$;

create or replace function public.get_my_account_security_snapshot()
returns jsonb language sql security definer stable set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'accountStatus', profile_row.account_status,
    'hasCurrentRequiredConsents', public.has_current_required_consents(auth.uid()),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', policy_row.policy_kind,
        'version', policy_row.version,
        'effectiveAt', policy_row.effective_at,
        'documentPath', policy_row.document_path,
        'decision', (
          select record_row.decision from public.consent_records record_row
           where record_row.subject_user_id = auth.uid()
             and record_row.policy_kind = policy_row.policy_kind
             and record_row.policy_version = policy_row.version
             and record_row.scope = 'account'
           order by record_row.recorded_at desc, record_row.id desc limit 1
        )
      ) order by policy_row.policy_kind)
      from public.consent_policies policy_row where policy_row.required
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request_row.id, 'kind', request_row.kind, 'status', request_row.status,
        'identityVerification', request_row.identity_verification, 'dataScope', request_row.data_scope,
        'dueAt', request_row.due_at, 'createdAt', request_row.created_at
      ) order by request_row.created_at desc)
      from public.account_requests request_row where request_row.user_id = auth.uid()
    ), '[]'::jsonb),
    'exports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', artifact_row.id,
        'requestId', artifact_row.request_id,
        'schemaVersion', artifact_row.schema_version,
        'artifactHash', artifact_row.artifact_hash,
        'sizeBytes', artifact_row.size_bytes,
        'expiresAt', artifact_row.expires_at,
        'createdAt', artifact_row.created_at,
        'status', case
          when artifact_row.purged_at is not null then 'purged'
          when artifact_row.expires_at <= now() then 'expired'
          else 'ready'
        end,
        'downloadCount', (select count(*) from public.export_download_events event_row
          where event_row.artifact_id = artifact_row.id)
      ) order by artifact_row.created_at desc)
      from public.user_rights_export_artifacts artifact_row where artifact_row.user_id = auth.uid()
    ), '[]'::jsonb)
  ) from public.profiles profile_row where profile_row.id = auth.uid()
$$;

create or replace function public.get_account_support_snapshot()
returns jsonb language plpgsql security definer stable set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(),'account.support.manage') then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'activeAdmins', (select count(*) from public.profiles where role='admin' and is_active and account_status='active'),
    'adminsWithoutMfa', (select count(*) from public.profiles profile_row where profile_row.role='admin' and profile_row.is_active and profile_row.account_status='active'
      and not exists(select 1 from auth.mfa_factors factor_row where factor_row.user_id=profile_row.id and factor_row.status='verified')),
    'openRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'id',request_row.id,'userId',request_row.user_id,'kind',request_row.kind,'status',request_row.status,
      'identityVerification',request_row.identity_verification,'dataScope',request_row.data_scope,
      'dueAt',request_row.due_at,'createdAt',request_row.created_at
    ) order by request_row.created_at desc) from public.account_requests request_row
      where request_row.status in ('submitted','identity_verified','approved','processing')), '[]'::jsonb),
    'recentExports', coalesce((select jsonb_agg(jsonb_build_object(
      'id', export_row.id,
      'requestId', export_row.request_id,
      'userId', export_row.user_id,
      'subjectRole', export_row.subject_role,
      'dataScope', export_row.data_scope,
      'artifactHash', export_row.artifact_hash,
      'sizeBytes', export_row.size_bytes,
      'expiresAt', export_row.expires_at,
      'createdAt', export_row.created_at,
      'status', case
        when export_row.purged_at is not null then 'purged'
        when export_row.expires_at <= now() then 'expired'
        else 'ready'
      end,
      'downloadCount', (select count(*) from public.export_download_events event_row where event_row.artifact_id = export_row.id)
    ) order by export_row.created_at desc) from (
      select * from public.user_rights_export_artifacts order by created_at desc limit 50
    ) export_row), '[]'::jsonb),
    'recentOperationalExports', case when public.has_perm(auth.uid(), 'audit.view') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event_row.id,
        'exportKind', event_row.export_kind,
        'resourceId', event_row.resource_id,
        'actorUserId', event_row.actor_user_id,
        'artifactHash', event_row.artifact_hash,
        'sizeBytes', event_row.size_bytes,
        'downloadedAt', event_row.downloaded_at
      ) order by event_row.downloaded_at desc)
      from (select * from public.export_download_events where export_category = 'operational'
        order by downloaded_at desc limit 50) event_row
    ), '[]'::jsonb) else '[]'::jsonb end,
    'recentAudits', coalesce((select jsonb_agg(jsonb_build_object(
      'id',audit_row.id,'actorUserId',audit_row.actor_user_id,'targetUserId',audit_row.target_user_id,
      'actionType',audit_row.action_type,'result',audit_row.result,'createdAt',audit_row.created_at
    ) order by audit_row.created_at desc) from (select * from public.account_support_audits order by created_at desc limit 50) audit_row), '[]'::jsonb),
    'pendingInvitations', coalesce((select jsonb_agg(jsonb_build_object(
      'id',invitation_row.id,'email',invitation_row.email,'expiresAt',invitation_row.expires_at,'createdAt',invitation_row.created_at
    ) order by invitation_row.created_at desc) from public.staff_invitations invitation_row
      where invitation_row.status='pending' and invitation_row.expires_at>now()), '[]'::jsonb)
  );
end
$$;

alter table public.user_rights_export_artifacts enable row level security;
alter table public.export_download_events enable row level security;

create policy user_rights_export_artifacts_own_metadata
  on public.user_rights_export_artifacts for select to authenticated
  using (user_id = (select auth.uid()));
create policy export_download_events_subject_or_audit
  on public.export_download_events for select to authenticated
  using (
    target_user_id = (select auth.uid())
    or public.has_perm((select auth.uid()), 'audit.view')
  );

revoke all on public.user_rights_export_artifacts, public.export_download_events
  from public, anon, authenticated;
grant select(id, request_id, user_id, subject_role, data_scope, schema_version,
  artifact_hash, size_bytes, field_manifest, expires_at, created_at, purged_at)
  on public.user_rights_export_artifacts to authenticated;
grant select on public.export_download_events to authenticated;

revoke all on function public.user_rights_export_field_manifest(text,text) from public, anon, authenticated;
revoke all on function public.build_user_rights_export_payload(uuid,text) from public, anon, authenticated;
revoke all on function public.prepare_user_rights_export(uuid) from public, anon, authenticated;
revoke all on function public.download_user_rights_export(uuid) from public, anon, authenticated;
revoke all on function public.record_solution_record_export_download(uuid,text,bigint) from public, anon, authenticated;
revoke all on function public.purge_expired_user_rights_export_payloads(integer) from public, anon, authenticated;

grant execute on function public.prepare_user_rights_export(uuid) to authenticated;
grant execute on function public.download_user_rights_export(uuid) to authenticated;
grant execute on function public.record_solution_record_export_download(uuid,text,bigint) to authenticated;
grant execute on function public.purge_expired_user_rights_export_payloads(integer) to authenticated, service_role;

commit;
